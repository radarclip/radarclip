import { decode, stateAt, type Clip, type Event, type Radar, type Replay } from '@radarclip/format'

export interface Theme {
  ct: string
  t: string
  me: string
  bg: string
  fg: string
  muted: string
}

export const DEFAULT_THEME: Theme = { ct: '#5aa9e6', t: '#e8a33d', me: '#ff3df2', bg: '#0e1014', fg: '#e7e9ee', muted: '#8d95a5' }

export type RadarSource = Radar | ((map: string) => Radar | undefined | Promise<Radar | undefined>)

export interface PlayerOptions {
  /** Radar for the clip's map; falls back to `clip.radar`, then the registry, then a plain background. */
  radar?: RadarSource
  theme?: Partial<Theme>
  /** Draw clock, kill feed and mark labels onto the canvas (default true). */
  hud?: boolean
  /** Drag to pan, wheel/pinch to zoom, double-click to reset (default true). */
  interactive?: boolean
  /** Zoom with the mouse wheel (default true). Turn off on pages that scroll past many players. */
  wheelZoom?: boolean
}

export type PlayerEventName = 'time' | 'play' | 'pause' | 'ended' | 'load' | 'view'
/** 'fit': around the focus players; 'map': the whole radar; 'free': zoomed or panned by the user. */
export type Zoom = 'fit' | 'map' | 'free'
export type Floor = 'upper' | 'lower'

const ROUND_TIME = 115
const BOMB_TIME = 40
const SMOKE_R = 144 // world units
const FIRE_R = 120
const TRACER = 520 // world units drawn for a shot that hit nobody (~13 m)
const TRACER_LIFE = 0.3 // seconds a shot stays visible
const TRAIL = 2.5 // seconds of movement drawn behind a player
const KILL_LINE = 1.5
const FEED = 5
const MIN_VIEW_WORLD = 400 // closest zoom: ~10 m across
const GRENADE_HITS = new Set(['hegrenade', 'inferno', 'molotov', 'world', 'incgrenade'])

const WEAPON: Record<string, string> = {
  m4a1_silencer: 'M4A1-S', m4a1: 'M4A4', usp_silencer: 'USP-S', hkp2000: 'P2000', ak47: 'AK-47', deagle: 'Deagle',
  awp: 'AWP', ssg08: 'Scout', galilar: 'Galil', famas: 'FAMAS', mac10: 'MAC-10', mp9: 'MP9', glock: 'Glock',
  p250: 'P250', tec9: 'Tec-9', fiveseven: 'Five-SeveN', cz75a: 'CZ75', elite: 'Dualies', hegrenade: 'HE',
  inferno: 'Molotov', sg556: 'SG 553', aug: 'AUG', ump45: 'UMP-45', p90: 'P90', mp7: 'MP7', mp5sd: 'MP5-SD',
  bizon: 'PP-Bizon', nova: 'Nova', xm1014: 'XM1014', mag7: 'MAG-7', sawedoff: 'Sawed-Off', negev: 'Negev',
  m249: 'M249', scar20: 'SCAR-20', g3sg1: 'G3SG1', revolver: 'R8', taser: 'Zeus',
}
const weaponName = (w: string) => WEAPON[w] ?? (/^knife|bayonet/.test(w) ? 'Knife' : w)
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`

/** Radars registered by map name (e.g. by a page that hosts them). */
const registry = new Map<string, Radar>()
let resolver: ((map: string) => Radar | undefined | Promise<Radar | undefined>) | undefined

interface ShotView {
  t: number
  p: number
  yaw: number
  hit?: number
}

/**
 * Draws a radarclip on a canvas and plays it back.
 *
 *     const player = new RadarclipPlayer(canvas, { radar })
 *     await player.load(clip)
 *     player.play()
 */
export class RadarclipPlayer {
  static registerRadar(map: string, radar: Radar) {
    registry.set(map, radar)
  }

  /** Fallback for maps not registered, e.g. `RadarclipPlayer.radarResolver = radars()` from @radarclip/radars. */
  static set radarResolver(fn: ((map: string) => Radar | undefined | Promise<Radar | undefined>) | undefined) {
    resolver = fn
  }

  readonly canvas: HTMLCanvasElement
  replay!: Replay
  private ctx: CanvasRenderingContext2D
  private opts: PlayerOptions
  private theme: Theme
  private radar!: Radar
  private images: { upper?: HTMLImageElement; lower?: HTMLImageElement } = {}
  private tick = 0
  private raf = 0
  private listeners = new Map<PlayerEventName, Set<(t: number) => void>>()
  private resizeObserver?: ResizeObserver
  private shots: ShotView[] = []
  private kills: Extract<Event, { type: 'kill' }>[] = []
  private fitBox: [number, number, number] = [0, 0, 1024]
  /** Visible square of the radar: x, y, size in radar px (0…1024). */
  private view: [number, number, number] = [0, 0, 1024]
  /** Mapping of the last render, to turn pointer positions back into radar px. */
  private screen = { s: 1, ox: 0, oy: 0, dpr: 1 }
  private lastMap = ''
  private _zoom: Zoom = 'fit'
  private _floor: Floor = 'upper'
  private _playing = false
  private _speed = 1

  constructor(canvas: HTMLCanvasElement, opts: PlayerOptions = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.opts = opts
    this.theme = { ...DEFAULT_THEME, ...opts.theme }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.replay && this.render())
      this.resizeObserver.observe(canvas)
    }
    if (opts.interactive !== false) this.attachPointer()
  }

  setTheme(theme: Partial<Theme>) {
    this.theme = { ...DEFAULT_THEME, ...this.opts.theme, ...theme }
    if (this.replay) this.render()
  }

  // --- loading -------------------------------------------------------------------------------

  async load(clip: Clip): Promise<void> {
    this.pause()
    const r = (this.replay = decode(clip))
    this.radar = (await this.resolveRadar(clip)) ?? this.syntheticRadar(r)
    this.images = {}
    const img = async (src?: string | null) => {
      if (!src) return undefined
      const i = new Image()
      i.decoding = 'async'
      // Hosted radars come from another origin; without CORS the canvas could not be exported.
      if (!src.startsWith('data:')) i.crossOrigin = 'anonymous'
      i.src = src
      try {
        await i.decode()
        return i
      } catch {
        return undefined
      }
    }
    ;[this.images.upper, this.images.lower] = await Promise.all([img(this.radar.image), img(this.radar.lower)])

    const hits = r.events.filter((e): e is Extract<Event, { type: 'hurt' }> => e.type === 'hurt' && !GRENADE_HITS.has(e.weapon))
    const window = 0.07 * r.tickrate
    this.shots = r.shots.map((s) => ({ ...s, hit: hits.find((h) => h.attacker === s.p && Math.abs(h.t - s.t) <= window)?.victim }))
    this.kills = r.events.filter((e): e is Extract<Event, { type: 'kill' }> => e.type === 'kill')
    this.fitBox = this.clampView(this.computeFit())
    // Keep a hand-picked view when switching rounds on the same map.
    if (!(this._zoom === 'free' && this.lastMap === clip.map)) this.applyZoom()
    this.lastMap = clip.map
    const first = clip.marks.find((m) => m.t >= r.start && m.t <= r.end)
    this.tick = first ? first.t : r.start
    const me = clip.focus.length ? stateAt(r, clip.focus[0], this.tick) : null
    this._floor = this.split != null && me && me.z < this.split ? 'lower' : 'upper'
    this.render()
    this.emit('load')
  }

  private async resolveRadar(clip: Clip): Promise<Radar | undefined> {
    const src = this.opts.radar
    if (src && typeof src === 'object') return src
    if (typeof src === 'function') {
      const r = await src(clip.map)
      if (r) return r
    }
    return clip.radar ?? registry.get(clip.map) ?? (await resolver?.(clip.map))
  }

  /** No radar: frame everything that happens on a plain background. */
  private syntheticRadar(r: Replay): Radar {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of r.players) {
      for (let f = 0; f < r.frames; f++) {
        if (!p.alive[f]) continue
        x0 = Math.min(x0, p.x[f]); x1 = Math.max(x1, p.x[f]); y0 = Math.min(y0, p.y[f]); y1 = Math.max(y1, p.y[f])
      }
    }
    if (!isFinite(x0)) return { pos_x: -2048, pos_y: 2048, scale: 4 }
    const size = Math.max(x1 - x0, y1 - y0, 1000) * 1.3
    return { pos_x: (x0 + x1) / 2 - size / 2, pos_y: (y0 + y1) / 2 + size / 2, scale: size / 1024 }
  }

  // --- playback ------------------------------------------------------------------------------

  /** Seconds after the round's freeze end (round time 1:55 = 0). */
  get time() {
    return this.tick / this.replay.tickrate
  }
  get start() {
    return this.replay.start / this.replay.tickrate
  }
  get end() {
    return this.replay.end / this.replay.tickrate
  }
  get playing() {
    return this._playing
  }

  seek(seconds: number) {
    const r = this.replay
    this.tick = Math.max(r.start, Math.min(r.end, seconds * r.tickrate))
    this.render()
    this.emit('time')
  }

  play() {
    if (this._playing || !this.replay) return
    if (this.tick >= this.replay.end) this.tick = this.replay.start
    this._playing = true
    this.emit('play')
    let last = performance.now()
    const step = (now: number) => {
      if (!this._playing) return
      this.tick += ((now - last) / 1000) * this._speed * this.replay.tickrate
      last = now
      if (this.tick >= this.replay.end) {
        this.tick = this.replay.end
        this.render()
        this.emit('time')
        this.pause()
        this.emit('ended')
        return
      }
      this.render()
      this.emit('time')
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  pause() {
    if (!this._playing) return
    this._playing = false
    cancelAnimationFrame(this.raf)
    this.emit('pause')
  }

  toggle() {
    this._playing ? this.pause() : this.play()
  }

  /** Playback rate (1 = real time). */
  get speed() {
    return this._speed
  }
  set speed(v: number) {
    this._speed = v
    this.emit('view')
  }

  get zoom() {
    return this._zoom
  }
  set zoom(z: Zoom) {
    this._zoom = z
    this.applyZoom()
    this.render()
    this.emit('view')
  }

  private applyZoom() {
    if (this._zoom === 'map') this.view = [0, 0, 1024]
    else if (this._zoom === 'fit') this.view = this.fitBox
  }

  /** Zoom by `factor` (< 1 zooms in) around a point given in CSS px on the canvas. */
  zoomAt(factor: number, cssX: number, cssY: number) {
    const [px, py] = this.toRadar(cssX, cssY)
    const [x, y, size] = this.view
    const next = this.clampSize(size * factor)
    const k = next / size
    this.setView([px - (px - x) * k, py - (py - y) * k, next])
  }

  /** Move the view by CSS px (drag direction). */
  panBy(dx: number, dy: number) {
    const { s, dpr } = this.screen
    const [x, y, size] = this.view
    this.setView([x - (dx * dpr) / s, y - (dy * dpr) / s, size])
  }

  private setView(v: [number, number, number]) {
    this.view = this.clampView(v)
    this._zoom = 'free'
    this.render()
    this.emit('view')
  }

  private clampSize(size: number) {
    return Math.min(1024, Math.max(Math.max(48, MIN_VIEW_WORLD / (this.radar?.scale ?? 5)), size))
  }

  /** Keep the view inside the radar. */
  private clampView([x, y, size]: [number, number, number]): [number, number, number] {
    size = this.clampSize(size)
    return [Math.min(Math.max(x, 0), 1024 - size), Math.min(Math.max(y, 0), 1024 - size), size]
  }

  private toRadar(cssX: number, cssY: number): [number, number] {
    const { s, ox, oy, dpr } = this.screen
    return [(cssX * dpr - ox) / s + this.view[0], (cssY * dpr - oy) / s + this.view[1]]
  }

  private attachPointer() {
    const c = this.canvas
    c.style.touchAction = 'none'
    c.style.cursor = 'grab'
    const down = new Map<number, { x: number; y: number }>()
    const local = (x: number, y: number) => {
      const r = c.getBoundingClientRect()
      return [x - r.left, y - r.top] as const
    }
    const spread = () => {
      const [a, b] = [...down.values()]
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    }
    c.addEventListener('wheel', (e) => {
      if (!this.replay || this.opts.wheelZoom === false) return
      e.preventDefault()
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      // Trackpad pinch arrives as wheel + ctrlKey with small deltas.
      this.zoomAt(Math.exp(d * (e.ctrlKey ? 0.01 : 0.002)), ...local(e.clientX, e.clientY))
    }, { passive: false })
    c.addEventListener('pointerdown', (e) => {
      if (!this.replay || (e.pointerType === 'mouse' && e.button !== 0)) return
      c.setPointerCapture(e.pointerId)
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      c.style.cursor = 'grabbing'
    })
    c.addEventListener('pointermove', (e) => {
      const p = down.get(e.pointerId)
      if (!p) return
      if (down.size === 1) {
        this.panBy(e.clientX - p.x, e.clientY - p.y)
        p.x = e.clientX
        p.y = e.clientY
        return
      }
      const before = spread()
      p.x = e.clientX
      p.y = e.clientY
      const after = spread()
      this.panBy(after.mx - before.mx, after.my - before.my)
      if (after.d > 0) this.zoomAt(before.d / after.d, ...local(after.mx, after.my))
    })
    const up = (e: PointerEvent) => {
      down.delete(e.pointerId)
      if (!down.size) c.style.cursor = 'grab'
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('dblclick', () => {
      if (this.replay) this.zoom = 'fit'
    })
  }

  get split(): number | null {
    return this.radar?.split_z ?? null
  }
  get floor() {
    return this._floor
  }
  set floor(f: Floor) {
    this._floor = f
    this.render()
    this.emit('view')
  }

  on(name: PlayerEventName, fn: (seconds: number) => void): () => void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(fn)
    return () => this.listeners.get(name)?.delete(fn)
  }

  private emit(name: PlayerEventName) {
    for (const fn of this.listeners.get(name) ?? []) fn(this.time)
  }

  /** The current frame as an image, e.g. for a preview card. */
  toBlob(type = 'image/png', quality?: number): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, type, quality))
  }

  destroy() {
    this.pause()
    this.resizeObserver?.disconnect()
    this.listeners.clear()
  }

  // --- geometry ------------------------------------------------------------------------------

  /** World → radar px (1024 × 1024). */
  private px(x: number, y: number): [number, number] {
    const r = this.radar
    return [(x - r.pos_x) / r.scale, (r.pos_y - y) / r.scale]
  }

  private onFloor(z: number | undefined) {
    if (this.split == null || z == null) return true
    return this._floor === 'lower' ? z < this.split : z >= this.split
  }

  /** Square box around the focus players and everyone they traded damage with, in radar px. */
  private computeFit(): [number, number, number] {
    const r = this.replay
    const c = r.clip
    let ids = new Set(r.players.map((p) => p.index))
    if (c.focus.length) {
      ids = new Set(c.focus)
      for (const e of r.events) {
        if ((e.type !== 'hurt' && e.type !== 'kill') || e.t < r.start) continue
        if (e.attacker != null && ids.has(e.attacker)) ids.add(e.victim)
        else if (ids.has(e.victim) && e.attacker != null) ids.add(e.attacker)
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const add = (wx: number, wy: number) => {
      const [x, y] = this.px(wx, wy)
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    for (const i of ids) {
      const p = r.players[i]
      for (let f = 0; f < r.frames; f++) if (p.alive[f]) add(p.x[f], p.y[f])
    }
    for (const k of this.kills) if (ids.has(k.victim) && k.t >= r.start) add(k.x, k.y)
    if (!isFinite(x0)) return [0, 0, 1024]
    const size = Math.min(1024, Math.max(380, Math.max(x1 - x0, y1 - y0) + 180))
    return [(x0 + x1) / 2 - size / 2, (y0 + y1) / 2 - size / 2, size]
  }

  // --- drawing -------------------------------------------------------------------------------

  private color(player: number | undefined, side?: string) {
    const r = this.replay
    if (player != null && player === r.clip.focus[0]) return this.theme.me
    side = side ?? (player != null ? r.players[player]?.side : undefined)
    return side === 'CT' ? this.theme.ct : side === 'T' ? this.theme.t : '#dddddd'
  }

  render() {
    const r = this.replay
    if (!r) return
    const cv = this.canvas
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    const cssW = cv.clientWidth || cv.width
    const cssH = cv.clientHeight || cv.height
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr)
    if (cv.width !== W || cv.height !== H) {
      cv.width = W
      cv.height = H
    }
    const g = this.ctx
    const t = this.tick
    const sec = r.tickrate
    const th = this.theme

    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = th.bg
    g.fillRect(0, 0, W, H)

    // View: a square box of radar px, fitted into the canvas.
    const [vx, vy, vs] = this.view
    const side = Math.min(W, H)
    const s = side / vs
    const ox = (W - side) / 2, oy = (H - side) / 2
    this.screen = { s, ox, oy, dpr }
    g.setTransform(s, 0, 0, s, ox - vx * s, oy - vy * s)
    const u = (dpr * Math.max(1, cssW / 640)) / s // one CSS px (a bit more on big canvases), in radar px

    const img = this._floor === 'lower' && this.images.lower ? this.images.lower : this.images.upper
    if (img) g.drawImage(img, 0, 0, 1024, 1024)

    const circle = (x: number, y: number, rad: number) => {
      g.beginPath()
      g.arc(x, y, rad, 0, Math.PI * 2)
    }
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      g.beginPath()
      g.moveTo(x1, y1)
      g.lineTo(x2, y2)
    }

    // Smokes and fires.
    for (const e of r.events) {
      if ((e.type !== 'smoke' && e.type !== 'molotov') || t < e.t || t > e.until || !this.onFloor(e.z)) continue
      const [x, y] = this.px(e.x, e.y)
      const grow = Math.min(1, (t - e.t) / (0.8 * sec))
      const fade = Math.min(1, (e.until - t) / (1.5 * sec))
      circle(x, y, ((e.type === 'smoke' ? SMOKE_R : FIRE_R) / this.radar.scale) * grow)
      g.globalAlpha = (e.type === 'smoke' ? 0.78 : 0.5) * fade
      g.fillStyle = e.type === 'smoke' ? '#cfd3d8' : '#ff5a1f'
      g.fill()
      g.globalAlpha = fade
      g.lineWidth = 1.5 * u
      g.strokeStyle = this.color(e.by)
      g.stroke()
    }
    g.globalAlpha = 1

    // Flash / HE pops.
    for (const e of r.events) {
      if (e.type !== 'flash' && e.type !== 'he') continue
      const p = (t - e.t) / (0.6 * sec)
      if (p < 0 || p > 1 || !this.onFloor(e.z)) continue
      const [x, y] = this.px(e.x, e.y)
      circle(x, y, (6 + 22 * p) * u)
      g.globalAlpha = 0.85 * (1 - p)
      g.fillStyle = e.type === 'flash' ? '#ffffff' : '#9cff57'
      g.fill()
      g.globalAlpha = 1 - p
      g.lineWidth = 1.2 * u
      g.strokeStyle = this.color(e.by)
      g.stroke()
    }
    g.globalAlpha = 1

    // Grenades in flight.
    for (const n of r.nades) {
      const m = n.t.length
      if (!m || t < n.t[0] || t > n.t[m - 1] + 0.15 * sec) continue
      const col = this.color(n.by)
      g.beginPath()
      let head: [number, number] | null = null
      for (let i = 0; i < m && n.t[i] <= t; i++) {
        if (!this.onFloor(n.z[i])) continue
        const [x, y] = this.px(n.x[i], n.y[i])
        head ? g.lineTo(x, y) : g.moveTo(x, y)
        head = [x, y]
      }
      if (!head) continue
      g.setLineDash([2 * u, 2.5 * u])
      g.lineWidth = 1.3 * u
      g.strokeStyle = col
      g.globalAlpha = 0.9
      g.stroke()
      g.setLineDash([])
      g.globalAlpha = 1
      circle(head[0], head[1], 2.6 * u)
      g.fillStyle = col
      g.fill()
      g.lineWidth = 0.8 * u
      g.strokeStyle = '#000'
      g.stroke()
    }

    // Shots: a line to the player hit, or a tracer along the aim.
    g.lineCap = 'round'
    for (const sh of this.shots) {
      const age = (t - sh.t) / sec
      if (age < 0 || age > TRACER_LIFE) continue
      const from = stateAt(r, sh.p, sh.t)
      if (!from || !this.onFloor(from.z)) continue
      const [x1, y1] = this.px(from.x, from.y)
      const v = sh.hit != null ? stateAt(r, sh.hit, sh.t) : null
      const a = (sh.yaw * Math.PI) / 180
      const [x2, y2] = v ? this.px(v.x, v.y) : this.px(from.x + TRACER * Math.cos(a), from.y + TRACER * Math.sin(a))
      line(x1, y1, x2, y2)
      g.globalAlpha = (v ? 0.9 : 0.55) * (1 - age / TRACER_LIFE)
      g.lineWidth = (v ? 1.4 : 1) * u
      g.strokeStyle = v ? '#ffffff' : this.color(sh.p)
      g.stroke()
    }
    g.globalAlpha = 1

    // Bomb.
    let bomb: { x: number; y: number; z: number; planted: number; state?: 'defuse' | 'explode' } | null = null
    for (const e of r.events) {
      if (e.t > t) break
      if (e.type === 'plant') bomb = { x: e.x, y: e.y, z: e.z, planted: e.t }
      else if ((e.type === 'defuse' || e.type === 'explode') && bomb) bomb.state = e.type
    }
    if (bomb && this.onFloor(bomb.z)) {
      const [x, y] = this.px(bomb.x, bomb.y)
      g.fillStyle = bomb.state === 'defuse' ? '#4cd28a' : bomb.state === 'explode' ? '#ff9a1f' : '#ff2b2b'
      g.fillRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u)
      g.lineWidth = 1.2 * u
      g.strokeStyle = '#fff'
      g.strokeRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u)
    }

    const labels: (() => void)[] = []
    const text = (x: number, y: number, str: string, fill: string, bold = false, alpha = 1) =>
      labels.push(() => {
        g.font = `${bold ? 700 : 500} ${9 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`
        g.globalAlpha = alpha
        g.lineWidth = 2.4 * u
        g.strokeStyle = '#000'
        g.lineJoin = 'round'
        g.strokeText(str, x, y)
        g.fillStyle = fill
        g.fillText(str, x, y)
        g.globalAlpha = 1
      })

    // Deaths so far, and attacker → victim lines right after a kill.
    const dead = new Set<number>()
    for (const k of this.kills) {
      if (k.t > t) break
      dead.add(k.victim)
      if (!this.onFloor(k.z)) continue
      const [x, y] = this.px(k.x, k.y)
      const col = this.color(k.victim)
      const d = 4.5 * u
      g.beginPath()
      g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x - d, y + d); g.lineTo(x + d, y - d)
      g.globalAlpha = 0.85
      g.lineWidth = 2.2 * u
      g.strokeStyle = col
      g.stroke()
      g.globalAlpha = 1
      text(x + 6 * u, y + 11 * u, r.players[k.victim]?.name ?? '', col, false, 0.7)
      if (t <= k.t + KILL_LINE * sec && k.attacker != null) {
        const a = stateAt(r, k.attacker, k.t)
        if (a) {
          const [ax, ay] = this.px(a.x, a.y)
          line(ax, ay, x, y)
          g.setLineDash([5 * u, 3 * u])
          g.globalAlpha = 1 - (t - k.t) / (KILL_LINE * sec)
          g.lineWidth = 1.5 * u
          g.strokeStyle = '#ff2b2b'
          g.stroke()
          g.setLineDash([])
          g.globalAlpha = 1
        }
      }
    }

    // Players: trail, view direction, blind ring, body, label.
    const focus = r.clip.focus
    const me = focus.length ? stateAt(r, focus[0], t) : null
    const bodies: (() => void)[] = []
    for (const p of r.players) {
      const st = stateAt(r, p.index, t)
      if (!st || dead.has(p.index)) continue
      const col = this.color(p.index)
      const mine = p.index === focus[0]
      const [x, y] = this.px(st.x, st.y)
      if (!this.onFloor(st.z)) {
        bodies.push(() => {
          circle(x, y, 5.5 * u)
          g.globalAlpha = 0.45
          g.lineWidth = 1.2 * u
          g.strokeStyle = col
          g.stroke()
          g.globalAlpha = 1
        })
        continue
      }
      g.beginPath()
      let started = false
      for (let q = Math.max(r.start, t - TRAIL * sec); q < t; q += r.step) {
        const a = stateAt(r, p.index, q)
        if (!a || !this.onFloor(a.z)) continue
        const [qx, qy] = this.px(a.x, a.y)
        started ? g.lineTo(qx, qy) : g.moveTo(qx, qy)
        started = true
      }
      if (started) {
        g.lineTo(x, y)
        g.globalAlpha = 0.45
        g.lineWidth = 1.3 * u
        g.strokeStyle = col
        g.stroke()
        g.globalAlpha = 1
      }
      const blind = r.events.find((e) => e.type === 'blind' && e.victim === p.index && t >= e.t && t <= e.until) as
        | Extract<Event, { type: 'blind' }>
        | undefined
      const yaw = (st.yaw * Math.PI) / 180
      bodies.push(() => {
        const L = 17 * u
        line(x, y, x + L * Math.cos(yaw), y - L * Math.sin(yaw))
        g.lineWidth = 1.4 * u
        g.strokeStyle = col
        g.stroke()
        if (blind) {
          const left = 1 - (t - blind.t) / Math.max(1, blind.until - blind.t)
          circle(x, y, 11 * u)
          g.globalAlpha = 0.35 * left
          g.fillStyle = '#fff'
          g.fill()
          g.globalAlpha = left
          g.lineWidth = 1.2 * u
          g.strokeStyle = '#fff'
          g.stroke()
          g.globalAlpha = 1
        }
        circle(x, y, (mine ? 7 : 5.5) * u)
        g.fillStyle = col
        g.fill()
        g.lineWidth = 1.2 * u
        g.strokeStyle = '#000'
        g.stroke()
      })
      let dz = ''
      if (!mine && me && Math.abs(st.z - me.z) >= 100) dz = ` ${st.z > me.z ? '▲' : '▼'}${Math.abs(Math.round((st.z - me.z) * 0.0254))} m`
      const extra = focus.includes(p.index) ? ` · ${st.weapon}${st.place ? ` · ${st.place}` : ''}` : ''
      text(x + 8 * u, y - 6 * u, `${p.name} ${st.hp}${extra}${dz}`, col, mine)
    }
    for (const b of bodies) b()
    for (const l of labels) l()

    g.setTransform(1, 0, 0, 1, 0, 0)
    if (this.opts.hud !== false) this.drawHud(t, bomb, dpr)
  }

  private drawHud(t: number, bomb: { planted: number; state?: string } | null, dpr: number) {
    const r = this.replay
    const g = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const k = dpr * Math.max(1, this.canvas.clientWidth / 640 || 1)
    const pad = 8 * k
    const font = (size: number, weight = 500, mono = false) =>
      (g.font = `${weight} ${size * k}px ${mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'system-ui, -apple-system, "Segoe UI", sans-serif'}`)
    const pill = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = 'rgba(0,0,0,.6)'
      g.beginPath()
      g.roundRect(x, y, w, h, 5 * k)
      g.fill()
    }

    // Clock: round time, or the bomb timer once planted.
    const planted = bomb && !bomb.state
    const left = planted ? BOMB_TIME - (t - bomb.planted) / r.tickrate : ROUND_TIME - t / r.tickrate
    const main = `${planted ? '💣 ' : ''}${clock(left)}`
    const sub = `R${r.clip.round}`
    font(15, 600, true)
    const wMain = g.measureText(main).width
    font(11, 500)
    const wSub = g.measureText(sub).width
    pill(pad, pad, wMain + wSub + 22 * k, 26 * k)
    font(15, 600, true)
    g.fillStyle = planted ? '#ff5a4a' : this.theme.fg
    g.textBaseline = 'middle'
    g.fillText(main, pad + 8 * k, pad + 13 * k)
    font(11, 500)
    g.fillStyle = this.theme.muted
    g.fillText(sub, pad + 14 * k + wMain, pad + 13 * k)

    // Kill feed.
    let y = pad
    for (const e of this.kills) {
      if (e.t > t || e.t <= t - FEED * r.tickrate) continue
      const a = e.attacker != null ? r.players[e.attacker]?.name : 'world'
      const v = r.players[e.victim]?.name ?? ''
      const w = `${weaponName(e.weapon)}${e.hs ? ' ◎' : ''}`
      font(12, 500)
      const wa = g.measureText(a ?? '').width, ww = g.measureText(w).width, wv = g.measureText(v).width
      const total = wa + ww + wv + 26 * k
      const x = W - pad - total
      pill(x, y, total, 22 * k)
      const mine = r.clip.focus[0] != null && (e.attacker === r.clip.focus[0] || e.victim === r.clip.focus[0])
      if (mine) {
        g.strokeStyle = this.theme.me
        g.lineWidth = k
        g.stroke()
      }
      let cx = x + 8 * k
      const cy = y + 11 * k
      g.fillStyle = this.color(e.attacker)
      g.fillText(a ?? '', cx, cy)
      cx += wa + 5 * k
      g.fillStyle = this.theme.muted
      g.fillText(w, cx, cy)
      cx += ww + 5 * k
      g.fillStyle = this.color(e.victim)
      g.fillText(v, cx, cy)
      y += 25 * k
    }

    // Mark label near its moment.
    const mark = r.clip.marks.find((m) => Math.abs(m.t - t) < 0.75 * r.tickrate)
    if (mark?.label) {
      font(12, 600)
      const w = g.measureText(mark.label).width
      pill(pad, H - pad - 24 * k, w + 16 * k, 24 * k)
      g.fillStyle = this.theme.me
      g.fillText(mark.label, pad + 8 * k, H - pad - 12 * k)
    }
    g.textBaseline = 'alphabetic'
  }
}
