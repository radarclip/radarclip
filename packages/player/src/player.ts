import { decode, stateAt, type Clip, type Event, type Radar, type Replay } from '@radarclip/format'

export interface Theme {
  ct: string
  t: string
  me: string
  bg: string
  fg: string
  muted: string
}

/** The radarclip design system's dark map colours: side colours, `focus` for the player you follow. */
export const DEFAULT_THEME: Theme = { ct: '#5aa9e6', t: '#e8a33d', me: '#9d8cff', bg: '#0e1014', fg: '#e8ebef', muted: '#9aa3ae' }

/** Text on the map: Geist when the page loads it, the system face otherwise. */
const SANS = 'Geist, system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

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
  /**
   * URL of a kill-feed icon, or `false` for weapon names and radarclip's own drawn symbols.
   * `name` is a weapon as the game names it (`ak47`, `flashbang_assist`) or a kill symbol
   * (`headshot`, `wallbang`, `noscope`, `smoke`, `blind`). Default: the game's own icons via
   * the counter-strike-icons project on jsDelivr (or `RadarclipPlayer.iconResolver`); nothing of
   * Valve's ships with radarclip.
   * An icon that fails to load falls back to the name or the drawn symbol.
   */
  icon?: ((name: string) => string | undefined) | false
}

const GAME_ICONS = 'https://cdn.jsdelivr.net/gh/Juknum/counter-strike-icons@899560e1a023fcbd1a090fa4fcbf1119a68145f2/cs2/panorama/images/'
const KILL_ICON: Record<string, string> = { headshot: 'icon_headshot', wallbang: 'penetrate', noscope: 'noscope', smoke: 'smoke_kill', blind: 'blind_kill' }
/**
 * Kill-feed icons from the game's own files (weapons and death-notice symbols), laid out under
 * `base` as in counter-strike-icons' `cs2/panorama/images/`: `icons/equipment/<weapon>.svg`,
 * `hud/deathnotice/<symbol>.svg`.
 */
export const gameIcons = (base = GAME_ICONS) => {
  const b = base.endsWith('/') ? base : `${base}/`
  return (name: string) => {
    if (KILL_ICON[name]) return `${b}hud/deathnotice/${KILL_ICON[name]}.svg`
    if (name === 'world' || !name) return undefined
    const file = name === 'knifegg' || (/^(knife|bayonet)/.test(name) && !name.startsWith('knife_')) ? 'knife' : name
    return `${b}icons/equipment/${file}.svg`
  }
}
/** Default kill-feed icons: the game's own files via jsDelivr. */
export const gameIcon = gameIcons()

/** Fallback kill symbols drawn for radarclip (1.5px outline on a 20px grid) when the game's icons don't load. */
const SYMBOL: Record<'headshot' | 'wallbang' | 'noscope' | 'smoke' | 'blind', { d: string; fill?: string; heavy?: string }> = {
  headshot: { d: 'M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3', fill: 'M12.2 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z' },
  wallbang: { d: 'M2 10h14.5M13.5 7l3.5 3-3.5 3', heavy: 'M10 3v14' },
  noscope: { d: 'M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM10 5v10M5 10h10', heavy: 'M3.5 16.5l13-13' },
  smoke: { d: 'M5.5 15.5h9a3.5 3.5 0 0 0 .4-7 4.8 4.8 0 0 0-9.3-.9A3.9 3.9 0 0 0 5.5 15.5z' },
  blind: { d: 'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM12.2 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z', heavy: 'M3.5 16.5l13-13' },
}

export type PlayerEventName = 'time' | 'play' | 'pause' | 'ended' | 'load' | 'view'

/** Everything a UI around the player needs, as one snapshot. Times in seconds after freeze end. */
export interface PlayerState {
  clip: Clip | null
  time: number
  start: number
  end: number
  playing: boolean
  speed: number
  zoom: Zoom
  floor: Floor
  /** The map has a lower floor to switch to. */
  floors: boolean
}
export type StateKey = 'clip' | 'time' | 'playing' | 'speed' | 'zoom' | 'floor'
export type ChangeListener = (state: PlayerState, changed: ReadonlySet<StateKey>) => void

const ALL_KEYS: StateKey[] = ['clip', 'time', 'playing', 'speed', 'zoom', 'floor']
const KEYS_OF: Record<PlayerEventName, StateKey[]> = {
  load: ALL_KEYS, time: ['time'], play: ['playing'], pause: ['playing'], ended: ['playing', 'time'], view: [],
}
/** 'fit': around the focus players; 'map': the whole radar; 'free': zoomed or panned by the user. */
export type Zoom = 'fit' | 'map' | 'free'
export type Floor = 'upper' | 'lower'

const ROUND_TIME = 115
const BOMB_TIME = 40
const DEFUSE = 10 // seconds to defuse without a kit
const DEFUSE_KIT = 5
const PLANT = 3.125
const ATTEMPT_STOPPED = 1.5 // seconds a plant or defuse given up stays visible
const BOMB = { planted: '#ff2b2b', defuse: '#4cd28a', explode: '#ff9a1f' }
const SMOKE_R = 144 // world units
const FIRE_R = 120
const TRACER = 520 // world units drawn for a shot that hit nobody (~13 m)
const TRACER_LIFE = 0.3 // seconds a shot stays visible
const TRAIL = 2.5 // seconds of movement drawn behind a player
const CONE = 32 // degrees either side of where a player looks
const CONE_LEN = 7.2 // cone length in player radii (the focus player's: 9.2)
const KILL_LINE = 1.5
const FEED = 5
const DMG_GAP = 1 // seconds between hits that still add to the same total
const DMG_SHOW = 1.6 // seconds a total stays after its last hit (the last 0.4 s fading)
const LABEL_FADE = 200 // ms for a label to fade out when something covers its spot, or back in
const LABEL_HOLD = 500 // ms a hidden label's spot must stay free before it comes back
const MIN_VIEW_WORLD = 400 // closest zoom: ~10 m across
const PLAYER_RADIUS = 16 // world units: the player hitbox is 32 units (~0.8 m) wide
const MIN_DOT = 4.5 // CSS px radius, so players stay easy to see at overview zoom; real size wins when zoomed in
const GRENADE_HITS = new Set(['hegrenade', 'inferno', 'molotov', 'world', 'incgrenade'])

const WEAPON: Record<string, string> = {
  m4a1_silencer: 'M4A1-S', m4a1: 'M4A4', usp_silencer: 'USP-S', hkp2000: 'P2000', ak47: 'AK-47', deagle: 'Deagle',
  awp: 'AWP', ssg08: 'Scout', galilar: 'Galil', famas: 'FAMAS', mac10: 'MAC-10', mp9: 'MP9', glock: 'Glock',
  p250: 'P250', tec9: 'Tec-9', fiveseven: 'Five-SeveN', cz75a: 'CZ75', elite: 'Dualies', hegrenade: 'HE',
  inferno: 'Molotov', sg556: 'SG 553', aug: 'AUG', ump45: 'UMP-45', p90: 'P90', mp7: 'MP7', mp5sd: 'MP5-SD',
  bizon: 'PP-Bizon', nova: 'Nova', xm1014: 'XM1014', mag7: 'MAG-7', sawedoff: 'Sawed-Off', negev: 'Negev',
  m249: 'M249', scar20: 'SCAR-20', g3sg1: 'G3SG1', revolver: 'R8', taser: 'Zeus',
}
/** Names on the map stay short; the full name shows on hover. */
const short = (name: string) => ([...name].length > 10 ? [...name].slice(0, 9).join('') + '…' : name)
const weaponName = (w: string) => WEAPON[w] ?? (/^knife|bayonet/.test(w) ? 'Knife' : w)
/** `#rrggbb` → `rgba()` with alpha, for gradients. */
const withAlpha = (color: string, a: number) => {
  let hex = color.trim()
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('')
  if (!/^#[0-9a-f]{6}/i.test(hex)) return color // a theme colour we can't parse: no fade
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
const DANGER = '#ff6b5e'
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)
/** Utility keeps its in-game reading (design system util-* tokens). */
const UTIL = { smoke: '#cfd3d8', fire: '#ff5a1f', flash: '#ffffff', he: '#9cff57' }
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`

/** The bomb once planted; `at` is when it was defused or exploded. */
type Bomb = { x: number; y: number; z: number; planted: number; state?: 'defuse' | 'explode'; at?: number }

/** Radars registered by map name (e.g. by a page that hosts them). */
const registry = new Map<string, Radar>()
let resolver: ((map: string) => Radar | undefined | Promise<Radar | undefined>) | undefined
let iconSource: PlayerOptions['icon']

/** Hits on one victim less than DMG_GAP apart, shown as one running total. */
interface DamageGroup {
  victim: number
  hits: { t: number; d: number }[]
  /** Tick of the kill that ended this fight, if any. */
  killAt?: number
  hs: boolean
  kill?: Extract<Event, { type: 'kill' }>
}

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

  /**
   * Kill-feed icons for every player that sets no `icon` option (same values as `icon`), e.g.
   * the game's icons from your own host: `RadarclipPlayer.iconResolver = gameIcons('/cs2-icons/')`.
   */
  static set iconResolver(fn: PlayerOptions['icon']) {
    iconSource = fn
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
  private changeListeners = new Set<ChangeListener>()
  private resizeObserver?: ResizeObserver
  private shots: ShotView[] = []
  private kills: Extract<Event, { type: 'kill' }>[] = []
  private damage: DamageGroup[] = []
  private icons = new Map<string, HTMLImageElement | null>()
  private iconTries = new Map<string, number>()
  private fitBox: [number, number, number] = [0, 0, 1024]
  /** Visible square of the radar: x, y, size in radar px (0…1024). */
  private view: [number, number, number] = [0, 0, 1024]
  /** Mapping of the last render, to turn pointer positions back into radar px. */
  private screen = { s: 1, ox: 0, oy: 0, dpr: 1 }
  /** Players drawn in the last frame (radar px), for hover. */
  private drawn: { index: number; x: number; y: number; r: number }[] = []
  private hovered: number | null = null
  /** Label fades across frames (real time, so they finish while paused), by label key. */
  private labelFade = new Map<string, { on: boolean; a: number; freeSince: number | null; at: number }>()
  private fadeRaf = 0
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
    // Web fonts arrive after the first frame; draw again once they are in.
    if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => this.replay && this.render())
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
    this.damage = this.groupDamage(r)
    this.labelFade.clear()
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

  /**
   * Running damage totals: hits on one player less than DMG_GAP apart add up. Each hit is
   * capped at the health the victim had (the game reports full weapon damage on a low player).
   */
  private groupDamage(r: Replay): DamageGroup[] {
    const groups: DamageGroup[] = []
    const open = new Map<number, DamageGroup>()
    const hp = new Map<number, number>()
    for (const e of r.events) {
      if (e.type !== 'hurt' || e.dmg <= 0) continue
      const before = hp.get(e.victim) ?? stateAt(r, e.victim, e.t - 1)?.hp ?? 100
      const d = Math.min(e.dmg, Math.max(0, before))
      hp.set(e.victim, before - d)
      if (d <= 0) continue
      let grp = open.get(e.victim)
      if (!grp || e.t - grp.hits[grp.hits.length - 1].t > DMG_GAP * r.tickrate) {
        grp = { victim: e.victim, hits: [], hs: false }
        groups.push(grp)
        open.set(e.victim, grp)
      }
      grp.hits.push({ t: e.t, d })
    }
    for (const k of r.events) {
      if (k.type !== 'kill') continue
      // The killing hit can come after the last counted one (damage beyond the health left).
      const grp = groups.find((g) => g.victim === k.victim && g.hits[0].t <= k.t + 2 && k.t - g.hits[g.hits.length - 1].t <= DMG_GAP * r.tickrate)
      if (grp) {
        grp.killAt = k.t
        grp.hs = k.hs
        grp.kill = k
      }
    }
    return groups
  }

  /** A kill-feed icon once loaded; starts the download on first use and redraws when it lands. */
  private icon(weapon: string): HTMLImageElement | null {
    if (this.icons.has(weapon)) return this.icons.get(weapon) ?? null
    const source = this.opts.icon !== undefined ? this.opts.icon : (iconSource ?? gameIcon)
    const src = source === false ? undefined : source(weapon)
    this.icons.set(weapon, null)
    if (!src || typeof Image === 'undefined' || typeof fetch === 'undefined') return null
    // The icons carry only a viewBox, which leaves an <img> without a size: read the SVG, give
    // it the viewBox's size, then decode it as an image.
    void fetch(src)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then(async (svg) => {
        const vb = /viewBox="[\d.\s-]*?\s([\d.]+)\s+([\d.]+)"/.exec(svg)
        if (vb && !/<svg[^>]*\swidth=/.test(svg)) svg = svg.replace('<svg', `<svg width="${vb[1]}" height="${vb[2]}"`)
        const img = new Image()
        img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        await img.decode()
        this.icons.set(weapon, img)
        if (this.replay) this.render()
      })
      // A cold CDN can fail the first request: try again a little later, up to three times.
      .catch(() => {
        const n = (this.iconTries.get(weapon) ?? 0) + 1
        this.iconTries.set(weapon, n)
        if (n < 3) setTimeout(() => this.icons.delete(weapon), 4000 * n)
      })
    return null
  }

  /** Where a player was at `tick`, or the last place before it with a position (up to 1 s back). */
  private lastPos(player: number, tick: number) {
    const r = this.replay
    for (let q = tick; q >= tick - r.tickrate; q -= r.step) {
      const st = stateAt(r, player, q)
      if (st && Number.isFinite(st.x) && st.x != null) return st
    }
    return null
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
      // A frame's timestamp can be a little older than the moment play() ran: never step back,
      // or the first frame lands before the clip's start and draws an empty map.
      this.tick = Math.max(this.replay.start, this.tick + (Math.max(0, now - last) / 1000) * this._speed * this.replay.tickrate)
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
    this.emit('view', ['speed'])
  }

  get zoom() {
    return this._zoom
  }
  set zoom(z: Zoom) {
    this._zoom = z
    this.applyZoom()
    this.render()
    this.emit('view', ['zoom'])
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
    this.emit('view', ['zoom'])
  }

  private clampSize(size: number) {
    return Math.min(1024, Math.max(Math.max(48, MIN_VIEW_WORLD / (this.radar?.scale ?? 5)), size))
  }

  /** Keep the view inside the radar. */
  private clampView([x, y, size]: [number, number, number]): [number, number, number] {
    size = this.clampSize(size)
    return [Math.min(Math.max(x, 0), 1024 - size), Math.min(Math.max(y, 0), 1024 - size), size]
  }

  /** Highlight the player under the pointer (full label), or none. */
  private hover(cssX: number | null, cssY = 0) {
    let hit: number | null = null
    if (cssX != null && this.replay) {
      const [x, y] = this.toRadar(cssX, cssY)
      const slack = (8 * this.screen.dpr) / this.screen.s
      let best = Infinity
      for (const d of this.drawn) {
        const dist = Math.hypot(d.x - x, d.y - y)
        if (dist <= d.r + slack && dist < best) {
          best = dist
          hit = d.index
        }
      }
    }
    if (hit === this.hovered) return
    this.hovered = hit
    this.canvas.style.cursor = hit != null ? 'pointer' : 'grab'
    this.render()
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
      if (!p) {
        if (e.pointerType === 'mouse') this.hover(...local(e.clientX, e.clientY))
        return
      }
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
    c.addEventListener('pointerleave', () => this.hover(null))
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
    this.emit('view', ['floor'])
  }

  on(name: PlayerEventName, fn: (seconds: number) => void): () => void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(fn)
    return () => this.listeners.get(name)?.delete(fn)
  }

  /**
   * One listener for every change: called with the current state and the keys that changed
   * (a new clip reports all of them). Prefer this over the single events.
   */
  onChange(fn: ChangeListener): () => void {
    this.changeListeners.add(fn)
    return () => this.changeListeners.delete(fn)
  }

  get state(): PlayerState {
    const r = this.replay
    return {
      clip: r?.clip ?? null,
      time: r ? this.time : 0,
      start: r ? this.start : 0,
      end: r ? this.end : 0,
      playing: this._playing,
      speed: this._speed,
      zoom: this._zoom,
      floor: this._floor,
      floors: this.split != null,
    }
  }

  private emit(name: PlayerEventName, keys: StateKey[] = KEYS_OF[name]) {
    for (const fn of this.listeners.get(name) ?? []) fn(this.time)
    if (!this.changeListeners.size || !keys.length) return
    const state = this.state
    const changed = new Set(keys)
    for (const fn of this.changeListeners) fn(state, changed)
  }

  /** The current frame as an image, e.g. for a preview card. */
  toBlob(type = 'image/png', quality?: number): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, type, quality))
  }

  destroy() {
    this.pause()
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.fadeRaf)
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

  /** A player's side colour, also for the focus player (their dot and the kill feed keep sides). */
  private sideColor(player: number) {
    const side = this.replay.players[player]?.side
    return side === 'CT' ? this.theme.ct : side === 'T' ? this.theme.t : this.theme.muted
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

    // Smokes and fires at their real size, outlined in the thrower's side colour, with a countdown
    // ring inside the edge for the time left. They grow in easing out (fast, then settling), the
    // ring growing and fading in with them.
    for (const e of r.events) {
      if ((e.type !== 'smoke' && e.type !== 'molotov') || t < e.t || t > e.until || !this.onFloor(e.z)) continue
      const smoke = e.type === 'smoke'
      const [x, y] = this.px(e.x, e.y)
      const k = Math.min(1, (t - e.t) / ((smoke ? 0.8 : 1) * sec))
      const grow = 1 - (1 - k) ** 3
      const fade = Math.min(1, (e.until - t) / (1.5 * sec))
      const rad = ((smoke ? SMOKE_R : FIRE_R) / this.radar.scale) * grow
      circle(x, y, rad)
      g.globalAlpha = (smoke ? 0.74 : 0.42) * fade
      g.fillStyle = smoke ? UTIL.smoke : UTIL.fire
      g.fill()
      g.globalAlpha = fade
      g.lineWidth = 1.2 * u
      g.strokeStyle = this.color(e.by)
      g.stroke()
      const rr = rad - 3 * u
      if (rr > 2 * u) {
        g.globalAlpha = fade * Math.min(1, grow * 1.4)
        circle(x, y, rr)
        g.lineWidth = 2.6 * u
        g.strokeStyle = 'rgba(14,16,20,.55)'
        g.stroke()
        g.beginPath()
        g.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, (e.until - t) / Math.max(1, e.until - e.t)))
        g.lineWidth = 2 * u
        g.strokeStyle = smoke ? '#ffffff' : '#ffd7a8'
        g.stroke()
      }
    }
    g.globalAlpha = 1

    // Flash: a starburst at the pop, then a line in the thrower's colour to every enemy it
    // blinded, for as long as they are blind. HE: an expanding ring (it leaves no area).
    for (const e of r.events) {
      if (e.type !== 'flash' && e.type !== 'he') continue
      if (t < e.t || !this.onFloor(e.z)) continue
      const [x, y] = this.px(e.x, e.y)
      const p = (t - e.t) / (0.6 * sec)
      if (e.type === 'flash') {
        const thrower = e.by != null ? r.players[e.by]?.side : undefined
        for (const b of r.events) {
          if (b.type !== 'blind' || Math.abs(b.t - e.t) > 2 || b.by !== e.by || t > b.until) continue
          if (thrower && r.players[b.victim]?.side === thrower) continue // team and self flashes stay off the map
          const v = stateAt(r, b.victim, t)
          if (!v) continue
          const [vx2, vy2] = this.px(v.x, v.y)
          line(x, y, vx2, vy2)
          g.globalAlpha = 0.7 * Math.min(1, (b.until - t) / (0.5 * sec))
          g.lineWidth = 1.2 * u
          g.strokeStyle = this.color(e.by)
          g.stroke()
          g.globalAlpha = 1
        }
        if (p <= 1) {
          const rays = (7 + 14 * p) * u
          g.globalAlpha = 1 - p
          g.lineWidth = 1.6 * u
          g.strokeStyle = UTIL.flash
          g.beginPath()
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4, r0 = rays * (i % 2 ? 0.45 : 0.3), r1 = rays * (i % 2 ? 0.75 : 1)
            g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0)
            g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
          }
          g.stroke()
          g.globalAlpha = 1
        }
      } else if (p <= 1) {
        circle(x, y, (6 + 26 * (1 - Math.pow(1 - p, 3))) * u)
        g.globalAlpha = 1 - p
        g.lineWidth = 2 * u
        g.strokeStyle = UTIL.he
        g.stroke()
        g.globalAlpha = 1
      }
    }

    // Grenades in flight: a dashed path in the thrower's colour from where it was thrown, so you
    // see where it came from, and the grenade as a dot in the same colour with a dark edge.
    for (const n of r.nades) {
      const m = n.t.length
      // A grenade stays an entity after it lands (smokes until they fade): the flight ends at
      // the last sample where it still moved.
      let land = m - 1
      while (land > 0 && Math.abs(n.x[land] - n.x[land - 1]) + Math.abs(n.y[land] - n.y[land - 1]) + Math.abs(n.z[land] - n.z[land - 1]) < 3) land--
      if (!m || t < n.t[0] || t > n.t[land]) continue
      const at = (q: number): [number, number, number] | null => {
        let i = 0
        while (i < m - 1 && n.t[i + 1] < q) i++
        const k = i < m - 1 ? Math.min(1, Math.max(0, (q - n.t[i]) / Math.max(1, n.t[i + 1] - n.t[i]))) : 0
        const j = Math.min(i + 1, m - 1)
        const z = n.z[i] + (n.z[j] - n.z[i]) * k
        if (!this.onFloor(z)) return null
        const [x, y] = this.px(n.x[i] + (n.x[j] - n.x[i]) * k, n.y[i] + (n.y[j] - n.y[i]) * k)
        return [x, y, z]
      }
      g.beginPath()
      let started = false
      for (let i = 0; i <= land && n.t[i] <= t; i++) {
        if (!this.onFloor(n.z[i])) { started = false; continue }
        const [x, y] = this.px(n.x[i], n.y[i])
        started ? g.lineTo(x, y) : g.moveTo(x, y)
        started = true
      }
      const tip = at(t)
      if (tip && started) g.lineTo(tip[0], tip[1])
      g.setLineDash([2 * u, 2.5 * u])
      g.lineWidth = 1.3 * u
      g.strokeStyle = this.color(n.by)
      g.globalAlpha = 0.9
      g.stroke()
      g.setLineDash([])
      g.globalAlpha = 1
      const head = at(t)
      if (!head) continue
      circle(head[0], head[1], 3.5 * u)
      g.fillStyle = this.color(n.by)
      g.fill()
      g.lineWidth = u
      g.strokeStyle = th.bg
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
      g.strokeStyle = this.color(sh.p)
      g.stroke()
    }
    g.globalAlpha = 1

    // Plant and defuse attempts: a ring that fills clockwise over the time the attempt needs. An
    // attempt given up stays as a white arc where it stopped, fading out, so fakes show; one that
    // succeeds closes the ring, which widens once as it fades.
    const attemptRing = (x: number, y: number, rad: number, e: { t: number; until: number; done?: boolean }, need: number, color: string) => {
      const ring = (r: number, to: number, width: number, stroke: string) => {
        g.beginPath()
        g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + to * Math.PI * 2)
        g.lineWidth = (width * rad) / 10
        g.strokeStyle = stroke
        g.stroke()
      }
      const after = (t - e.until) / sec
      if (t < e.t) return
      if (t < e.until) {
        g.globalAlpha = 1
        ring(rad, 1, 3.4, 'rgba(14,16,20,.75)')
        ring(rad, Math.min(1, (t - e.t) / need), 2.2, color)
      } else if (!e.done && after < ATTEMPT_STOPPED) {
        const fade = 1 - after / ATTEMPT_STOPPED
        g.globalAlpha = fade
        ring(rad, 1, 3.4, 'rgba(14,16,20,.75)')
        g.globalAlpha = 0.75 * fade
        // At least ~11°, so a tap shorter than a second still shows.
        ring(rad, Math.max(0.03, Math.min(1, (e.until - e.t) / need)), 2.4, '#fff')
      } else if (e.done && after < 1) {
        g.globalAlpha = 1 - after
        ring(rad * (1 + 0.6 * (1 - (1 - after) ** 3)), 1, 2.2, color)
      }
      g.globalAlpha = 1
    }

    // Bomb: carried (a badge on the carrier, drawn with the players), on the floor, or planted.
    let bomb: Bomb | null = null
    let carrier: number | undefined
    let dropped: Extract<Event, { type: 'drop' }> | null = null
    for (const e of r.events) {
      if (e.t > t) break
      if (e.type === 'plant') bomb = { x: e.x, y: e.y, z: e.z, planted: e.t }
      else if ((e.type === 'defuse' || e.type === 'explode') && bomb) Object.assign(bomb, { state: e.type, at: e.t })
      else if (e.type === 'pickup') [carrier, dropped] = [e.by, null]
      else if (e.type === 'drop') [carrier, dropped] = [undefined, e]
    }
    if (bomb) [carrier, dropped] = [undefined, null]
    // A dropped bomb: a dimmed square that sends out a ring every 2 s, so a loose bomb is easy to find.
    if (dropped && this.onFloor(dropped.z)) {
      const [x, y] = this.px(dropped.x, dropped.y)
      const k = ((t - dropped.t) / sec) % 2 / 1.2
      if (k < 1) {
        circle(x, y, (5 + 12 * (1 - (1 - k) ** 3)) * u)
        g.globalAlpha = 0.7 * (1 - k)
        g.lineWidth = 1.4 * u
        g.strokeStyle = BOMB.planted
        g.stroke()
      }
      g.globalAlpha = 0.75
      g.fillStyle = BOMB.planted
      g.fillRect(x - 4 * u, y - 4 * u, 8 * u, 8 * u)
      g.lineWidth = 1.2 * u
      g.strokeStyle = 'rgba(14,16,20,.9)'
      g.strokeRect(x - 4 * u, y - 4 * u, 8 * u, 8 * u)
      g.globalAlpha = 1
    }
    if (bomb && this.onFloor(bomb.z)) {
      const [x, y] = this.px(bomb.x, bomb.y)
      g.fillStyle = bomb.state === 'defuse' ? BOMB.defuse : bomb.state === 'explode' ? BOMB.explode : BOMB.planted
      g.fillRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u)
      g.lineWidth = 1.2 * u
      g.strokeStyle = '#fff'
      g.strokeRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u)
      // The plant that just landed widens once from here; defuses fill a ring on the bomb (5 s
      // with a kit, 10 s without). Zoomed in, the ring grows with the players.
      const rad = Math.max(10 * u, (2.2 * PLAYER_RADIUS) / this.radar.scale)
      for (const e of r.events) {
        if (e.t > t) break
        if (e.type === 'planting' && e.done) attemptRing(x, y, rad, e, PLANT * sec, BOMB.planted)
        if (e.type === 'defusing') attemptRing(x, y, rad, e, (e.kit ? DEFUSE_KIT : DEFUSE) * sec, BOMB.defuse)
      }
      g.globalAlpha = 1
    }

    // Labels are placed after everything else, highest priority first, always below their anchor.
    // A label whose spot is taken fades out instead of moving (see the placement below).
    const labels: { key: string; x: number; y: number; gap: number; str: string; fill: string; bold: boolean; alpha: number; prio: number }[] = []
    const text = (key: string, x: number, y: number, gap: number, str: string, fill: string, { bold = false, alpha = 1, prio = 0 } = {}) =>
      labels.push({ key, x, y, gap, str, fill, bold, alpha, prio })

    // Deaths so far, and attacker → victim lines right after a kill.
    // Drawn after the cones so a cone never hides a death.
    const dead = new Set<number>()
    const deaths: (() => void)[] = []
    for (const k of this.kills) {
      if (k.t > t) break
      dead.add(k.victim)
      if (!this.onFloor(k.z)) continue
      const [x, y] = this.px(k.x, k.y)
      const col = this.color(k.victim)
      const d = 4.5 * u
      text(`d${k.victim}`, x, y, d, short(r.players[k.victim]?.name ?? ''), th.fg, { alpha: 0.5, prio: -1 })
      deaths.push(() => {
        g.beginPath()
        g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x - d, y + d); g.lineTo(x + d, y - d)
        g.globalAlpha = 0.6
        g.lineWidth = 2 * u
        g.strokeStyle = col
        g.stroke()
        g.globalAlpha = 1
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
      })
    }

    // Players: trail, view direction, blind ring, body, label. Bodies are drawn at the real
    // player width, never smaller than MIN_DOT on screen.
    const R = Math.max(PLAYER_RADIUS / this.radar.scale, MIN_DOT * u)
    const edge = Math.min(1.2 * u, R * 0.3)
    const focus = r.clip.focus
    const me = focus.length ? stateAt(r, focus[0], t) : null
    const bodies: (() => void)[] = []
    const cones: (() => void)[] = []
    const drawn: typeof this.drawn = []
    // Players with a damage total on screen: their names win over bystanders'.
    const fighting = new Set(this.damage.filter((d) => t >= d.hits[0].t && t <= d.hits[d.hits.length - 1].t + DMG_SHOW * sec).map((d) => d.victim))
    for (const p of r.players) {
      const st = stateAt(r, p.index, t)
      // A canvas gradient throws on a non-finite position; never let one player blank the frame.
      if (!st || dead.has(p.index) || !Number.isFinite(st.x) || !Number.isFinite(st.y)) continue
      const mine = p.index === focus[0]
      // The focus player keeps the side colour (which team am I on?); a focus mark tells them apart.
      const col = mine ? this.sideColor(p.index) : this.color(p.index)
      const [x, y] = this.px(st.x, st.y)
      if (!this.onFloor(st.z)) {
        bodies.push(() => {
          circle(x, y, R)
          g.globalAlpha = 0.45
          g.lineWidth = edge
          g.strokeStyle = col
          g.stroke()
          g.globalAlpha = 1
        })
        continue
      }
      // Trail: the last TRAIL seconds, fading towards the past; stronger for the focus player.
      let prev: [number, number] | null = null
      const t0 = Math.max(r.start, t - TRAIL * sec)
      for (let q = t0; q <= t; q = q < t && q + r.step > t ? t : q + r.step) {
        const a = stateAt(r, p.index, q)
        if (!a || !this.onFloor(a.z)) { prev = null; continue }
        const pt = this.px(a.x, a.y)
        if (prev) {
          line(prev[0], prev[1], pt[0], pt[1])
          g.globalAlpha = (mine ? 0.12 : 0.06) + (mine ? 0.5 : 0.3) * ((q - t0) / Math.max(1, t - t0))
          g.lineWidth = (mine ? 1.6 : 1.3) * u
          g.strokeStyle = col
          g.stroke()
        }
        prev = pt
        if (q === t) break
      }
      g.globalAlpha = 1
      const blind = r.events.find((e) => e.type === 'blind' && e.victim === p.index && t >= e.t && t <= e.until) as
        | Extract<Event, { type: 'blind' }>
        | undefined
      const yaw = (st.yaw * Math.PI) / 180
      // A vision cone in the player's colour, fading out with distance; drawn under all bodies.
      cones.push(() => {
        const L = R * (mine ? CONE_LEN + 2 : CONE_LEN)
        const grad = g.createRadialGradient(x, y, 0, x, y, L)
        grad.addColorStop(0.1, withAlpha(col, mine ? 0.62 : 0.5))
        grad.addColorStop(1, withAlpha(col, 0))
        g.beginPath()
        g.moveTo(x, y)
        g.arc(x, y, L, -yaw - (CONE * Math.PI) / 180, -yaw + (CONE * Math.PI) / 180)
        g.closePath()
        g.fillStyle = grad
        g.fill()
      })
      bodies.push(() => {
        if (mine) {
          // The focus mark: a soft focus-coloured halo with a thin rim, under the blind and HP rings.
          const hr = R + 6.5 * u
          circle(x, y, hr)
          g.fillStyle = withAlpha(th.me, 0.28)
          g.fill()
          g.lineWidth = 1.4 * u
          g.strokeStyle = th.me
          g.stroke()
        }
        if (blind) {
          const left = 1 - (t - blind.t) / Math.max(1, blind.until - blind.t)
          circle(x, y, R + 5 * u)
          g.globalAlpha = 0.35 * left
          g.fillStyle = '#fff'
          g.fill()
          g.globalAlpha = left
          g.lineWidth = 1.2 * u
          g.strokeStyle = '#fff'
          g.stroke()
          g.globalAlpha = 1
        }
        // HP below 100: a ring that runs clockwise from the top.
        if (st.hp < 100) {
          const rr = R + 3 * u
          circle(x, y, rr)
          g.lineWidth = 2.2 * u
          g.strokeStyle = 'rgba(14,16,20,.7)'
          g.stroke()
          g.beginPath()
          g.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, st.hp)) / 100)
          g.lineWidth = 1.6 * u
          g.strokeStyle = st.hp < 30 ? DANGER : th.fg
          g.stroke()
        }
        circle(x, y, R)
        g.fillStyle = col
        g.fill()
        g.lineWidth = mine ? edge * 1.5 : edge
        g.strokeStyle = mine ? '#fff' : th.bg
        g.stroke()
      })
      let dz = ''
      if (!mine && me && Math.abs(st.z - me.z) >= 100) dz = ` ${st.z > me.z ? '▲' : '▼'}${Math.abs(Math.round((st.z - me.z) * 0.0254))} m`
      const hovered = p.index === this.hovered
      // Names only (HP is the ring), styled alike (the halo marks the focus player); theirs in full,
      // hover shows everything.
      let str: string
      if (hovered) str = `${p.name} · ${st.hp} HP${st.armor > 0 ? ` · ${st.armor} armor` : ''}${st.weapon ? ` · ${st.weapon}` : ''}${st.place ? ` · ${st.place}` : ''}${dz}`
      else str = `${mine ? p.name : short(p.name)}${dz}`
      text(`p${p.index}`, x, y, R + (st.hp < 100 ? 3 * u : 0), str, th.fg, { bold: hovered, alpha: hovered ? 1 : 0.92, prio: hovered ? 3 : mine ? 2 : focus.includes(p.index) ? 1 : fighting.has(p.index) ? 0.5 : 0 })
      drawn.push({ index: p.index, x, y, r: R })
    }
    this.drawn = drawn
    for (const c of cones) c()
    for (const d of deaths) d()
    for (const b of bodies) b()
    // The carrier's bomb: a small square at the top right of their dot, and while they plant, a
    // ring around them that fills in bomb red.
    const held = carrier !== undefined ? stateAt(r, carrier, t) : null
    if (held && this.onFloor(held.z)) {
      const [x, y] = this.px(held.x, held.y)
      for (const e of r.events) {
        if (e.t > t) break
        // A plant that lands widens from the bomb instead (see above).
        if (e.type === 'planting' && e.by === carrier && !(e.done && t >= e.until)) attemptRing(x, y, R + 9 * u, e, PLANT * sec, BOMB.planted)
      }
      const bx = x + R + 1.5 * u, by = y - R - 1.5 * u
      g.fillStyle = BOMB.planted
      g.fillRect(bx - 2.5 * u, by - 2.5 * u, 5 * u, 5 * u)
      g.lineWidth = 1 * u
      g.strokeStyle = 'rgba(14,16,20,.9)'
      g.strokeRect(bx - 2.5 * u, by - 2.5 * u, 5 * u, 5 * u)
    }

    // Labels sit below the dot (the space above belongs to damage numbers) and never move, so
    // they don't jump around in close fights. One whose spot is covered by a player or a
    // higher-priority label fades out, and comes back once the spot has stayed free for
    // LABEL_HOLD, so it doesn't blink. The focus player's and the hovered label always show.
    const placed: [number, number, number, number][] = drawn.map((d) => [d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r])
    const lh = 11 * u
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const fades = this.labelFade
    const seen = new Set<string>()
    let fading = false
    // Ties go to the label already showing, so two equal labels don't trade places.
    labels.sort((a, b) => b.prio - a.prio || (fades.get(b.key)?.a ?? 0) - (fades.get(a.key)?.a ?? 0) || (a.key < b.key ? -1 : 1))
    for (const l of labels) {
      seen.add(l.key)
      g.font = `${l.bold ? 600 : 500} ${9 * u}px ${SANS}`
      const w = g.measureText(l.str).width
      const off = l.gap + 2.5 * u
      const boxOf = (lx: number, ly: number): [number, number, number, number] => [lx, ly - lh * 0.8, lx + w, ly + lh * 0.2]
      const visible = (b: [number, number, number, number]) => b[0] >= vx && b[1] >= vy && b[2] <= vx + vs && b[3] <= vy + vs
      let spot: [number, number] = [l.x - w / 2, l.y + off + lh * 0.75]
      // Only at the bottom edge of the view do the always-shown labels go above instead.
      if (l.prio >= 2 && !visible(boxOf(...spot))) spot = [l.x - w / 2, l.y - off - lh * 0.25]
      const box = boxOf(...spot)
      const free = visible(box) && placed.every(([a, c, e, f]) => box[2] <= a || box[0] >= e || box[3] <= c || box[1] >= f)
      let f = fades.get(l.key)
      if (!f) fades.set(l.key, (f = { on: free, a: free ? 1 : 0, freeSince: free ? now : null, at: now }))
      if (l.prio >= 2) Object.assign(f, { on: true, a: 1, freeSince: now })
      else if (!free) Object.assign(f, { on: false, freeSince: null })
      else {
        f.freeSince ??= now
        if (!f.on && now - f.freeSince >= LABEL_HOLD) f.on = true
      }
      const step = Math.min(1, Math.max(0, now - f.at) / LABEL_FADE)
      f.a = f.on ? Math.min(1, f.a + step) : Math.max(0, f.a - step)
      f.at = now
      if (f.a !== (f.on ? 1 : 0) || (free && !f.on)) fading = true
      if (f.on) placed.push(box)
      if (f.a <= 0) continue
      g.globalAlpha = l.alpha * f.a
      g.lineWidth = 2.4 * u
      g.strokeStyle = this.theme.bg
      g.lineJoin = 'round'
      g.strokeText(l.str, spot[0], spot[1])
      g.fillStyle = l.fill
      g.fillText(l.str, spot[0], spot[1])
      g.globalAlpha = 1
    }
    for (const k of fades.keys()) if (!seen.has(k)) fades.delete(k)
    // While paused nothing else redraws: keep going until every fade has finished.
    if (fading && !this._playing && typeof requestAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.fadeRaf)
      this.fadeRaf = requestAnimationFrame(() => this.replay && !this._playing && this.render())
    }

    // Damage: one running total above each victim, bumping on every hit, floating up as it fades.
    for (const grp of this.damage) {
      const first = grp.hits[0].t, last = grp.hits[grp.hits.length - 1].t
      if (t < first || t > Math.max(last, grp.killAt ?? last) + DMG_SHOW * sec) continue
      const done = grp.hits.filter((h) => h.t <= t)
      const sum = done.reduce((a, h) => a + h.d, 0)
      const lastHit = done[done.length - 1].t
      const age = (t - Math.max(lastHit, grp.killAt != null && t >= grp.killAt ? grp.killAt : lastHit)) / sec
      if (age > DMG_SHOW) continue
      const killed = grp.killAt != null && t >= grp.killAt
      // A kill has its own position; otherwise the victim's last known one (tracks can stop a
      // few ticks before a death).
      const pos = killed && grp.kill ? grp.kill : this.lastPos(grp.victim, Math.min(t, last))
      if (!pos || !this.onFloor(pos.z)) continue
      const [x, y] = this.px(pos.x, pos.y)
      const fade = Math.min(1, (DMG_SHOW - age) / 0.4)
      const rise = 10 * u * easeOut(Math.min(1, Math.max(0, (age - (DMG_SHOW - 0.4)) / 0.4)))
      const bump = 1 + 0.3 * Math.max(0, 1 - age / 0.15)
      const str = `${killed && grp.hs ? '◎ ' : ''}${sum}`
      g.save()
      g.translate(x, y - R - 7 * u - rise)
      g.scale(bump, bump)
      g.globalAlpha = fade
      g.font = `700 ${10.5 * u}px ${SANS}`
      g.textAlign = 'center'
      g.lineJoin = 'round'
      g.lineWidth = 2.8 * u
      g.strokeStyle = th.bg
      g.strokeText(str, 0, 0)
      g.fillStyle = killed ? DANGER : '#ffffff'
      g.fillText(str, 0, 0)
      if (done.length > 1) {
        const w = g.measureText(str).width
        g.font = `500 ${8 * u}px ${MONO}`
        g.textAlign = 'left'
        const n = `×${done.length}`
        g.strokeText(n, w / 2 + 3 * u, 0)
        g.fillStyle = th.muted
        g.fillText(n, w / 2 + 3 * u, 0)
      }
      g.restore()
    }

    g.setTransform(1, 0, 0, 1, 0, 0)
    if (this.opts.hud !== false) this.drawHud(t, bomb, dpr)
  }

  private drawHud(t: number, bomb: Bomb | null, dpr: number) {
    const r = this.replay
    const g = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const k = dpr * Math.max(1, this.canvas.clientWidth / 640 || 1)
    const pad = 8 * k
    const font = (size: number, weight = 500, mono = false) =>
      (g.font = `${weight} ${size * k}px ${mono ? MONO : SANS}`)
    const pill = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = 'rgba(0,0,0,.6)'
      g.beginPath()
      g.roundRect(x, y, w, h, 5 * k)
      g.fill()
    }

    // Clock: round time, or the bomb timer once planted; it stops on the time left when the bomb
    // is defused or explodes.
    const left = bomb ? BOMB_TIME - ((bomb.at ?? t) - bomb.planted) / r.tickrate : ROUND_TIME - t / r.tickrate
    const main = clock(left)
    const sub = `R${r.clip.round}`
    font(15, 600, true)
    const wMain = g.measureText(main).width
    font(11, 500)
    const wSub = g.measureText(sub).width
    const clockRight = pad + wMain + wSub + 22 * k
    pill(pad, pad, clockRight - pad, 26 * k)
    font(15, 600, true)
    g.fillStyle = bomb ? BOMB[bomb.state ?? 'planted'] : this.theme.fg
    g.textBaseline = 'middle'
    g.fillText(main, pad + 8 * k, pad + 13 * k)
    font(11, 500)
    g.fillStyle = this.theme.muted
    g.fillText(sub, pad + 14 * k + wMain, pad + 13 * k)

    // Kill feed, in the game's order: [blind] attacker [+ flash assister] weapon [no-scope, smoke,
    // wallbang, headshot] victim. Names keep their side colours; the focus player's rows get an outline.
    const focusIx = r.clip.focus[0]
    const H_ROW = 22 * k, ICON_H = 14 * k, SYM = 13 * k, GAP = 5 * k
    const symbol = (name: keyof typeof SYMBOL, x: number, cy: number) => {
      const img = this.icon(name)
      if (img) {
        const h = SYM * 1.1, w = (img.naturalWidth / img.naturalHeight) * h || h
        g.drawImage(img, x + (SYM - w) / 2, cy - h / 2, w, h)
        return
      }
      if (typeof Path2D === 'undefined') return
      const sym = SYMBOL[name], sc = SYM / 20
      g.save()
      g.translate(x, cy - SYM / 2)
      g.scale(sc, sc)
      g.strokeStyle = this.theme.fg
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.lineWidth = 1.5
      g.stroke(new Path2D(sym.d))
      if (sym.heavy) {
        g.lineWidth = name === 'wallbang' ? 3 : 1.8
        g.stroke(new Path2D(sym.heavy))
      }
      if (sym.fill) {
        g.fillStyle = this.theme.fg
        g.fill(new Path2D(sym.fill))
      }
      g.restore()
    }
    // The feed stays in the top-right corner. A row that would reach the clock gets narrower
    // instead: first without the assister's name, then with shorter and shorter names. Weapon and
    // kill icons always stay. On narrow maps names start at 10 characters.
    const narrow = this.canvas.clientWidth > 0 && this.canvas.clientWidth < 520
    const clip = (name: string, max: number) => ([...name].length > max ? [...name].slice(0, max - 1).join('') + '…' : name)
    const clockBottom = pad + 26 * k
    let y = pad
    for (const e of this.kills) {
      if (e.t > t || e.t <= t - FEED * r.tickrate) continue
      type Part = { w: number; draw: (x: number, cy: number) => void }
      const build = (maxName: number, assisterName: boolean): Part[] => {
        const parts: Part[] = []
        const name = (ix: number | undefined, fallback: string) => {
          const full = ix != null ? r.players[ix]?.name ?? fallback : fallback
          const str = clip(full, maxName)
          font(12, ix === focusIx ? 600 : 500)
          const w = g.measureText(str).width
          const bold = ix === focusIx
          parts.push({ w, draw: (x, cy) => { font(12, bold ? 600 : 500); g.fillStyle = ix != null ? this.sideColor(ix) : this.theme.muted; g.fillText(str, x, cy) } })
        }
        const sym = (n: keyof typeof SYMBOL) => parts.push({ w: SYM, draw: (x, cy) => symbol(n, x, cy) })
        const picture = (weapon: string, h: number, mirror: boolean) => {
          const img = this.icon(weapon)
          if (img && img.naturalWidth) {
            const w = (img.naturalWidth / img.naturalHeight) * h
            parts.push({ w, draw: (x, cy) => {
              g.save()
              // The pictures point left; mirrored, the barrel points at the victim.
              if (mirror) { g.translate(x + w, cy - h / 2); g.scale(-1, 1) } else g.translate(x, cy - h / 2)
              g.drawImage(img, 0, 0, w, h)
              g.restore()
            } })
            return true
          }
          return false
        }
        if (e.blind) sym('blind')
        name(e.attacker, 'world')
        // Without the assister's name a plain assist is left out; a flash assist keeps its icon.
        if (e.assister != null && (assisterName || e.flashassist)) {
          font(12, 500)
          const plus = '+'
          parts.push({ w: g.measureText(plus).width, draw: (x, cy) => { font(12, 500); g.fillStyle = this.theme.muted; g.fillText(plus, x, cy) } })
          if (e.flashassist && !picture('flashbang_assist', SYM, false)) sym('blind')
          if (assisterName) name(e.assister, '')
        }
        if (!picture(e.weapon, ICON_H, true)) {
          const w = weaponName(e.weapon)
          font(12, 500)
          parts.push({ w: g.measureText(w).width, draw: (x, cy) => { font(12, 500); g.fillStyle = this.theme.muted; g.fillText(w, x, cy) } })
        }
        if (e.noscope) sym('noscope')
        if (e.smoke) sym('smoke')
        if ((e.pen ?? 0) > 0) sym('wallbang')
        if (e.hs) sym('headshot')
        name(e.victim, '')
        return parts
      }
      const width = (parts: Part[]) => parts.reduce((a, p) => a + p.w, 0) + GAP * (parts.length - 1) + 16 * k
      const room = (y < clockBottom + 2 * k ? W - pad - (clockRight + 8 * k) : W - 2 * pad)
      const first = narrow ? 10 : Infinity
      const tries: [number, boolean][] = [[first, true], [first, false], [10, false], [8, false], [6, false], [4, false]]
      let parts = build(first, true)
      for (const [max, assister] of tries) {
        parts = build(max, assister)
        if (width(parts) <= room) break
      }
      const total = width(parts)
      const x = W - pad - total
      pill(x, y, total, H_ROW)
      if (focusIx != null && (e.attacker === focusIx || e.victim === focusIx)) {
        g.strokeStyle = this.theme.me
        g.lineWidth = k
        g.stroke()
      }
      let cx = x + 8 * k
      const cy = y + H_ROW / 2
      for (const p of parts) {
        p.draw(cx, cy)
        cx += p.w + GAP
      }
      y += H_ROW + 3 * k
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
