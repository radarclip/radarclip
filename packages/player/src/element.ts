import { readClip, type Clip } from '@radarclip/format'
import { RadarclipPlayer, type Theme } from './player.js'

const SPEEDS = [0.25, 0.5, 1, 2]
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>',
}

const CSS = `
  :host { display: block; color: var(--radarclip-fg, #e7e9ee);
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif; }
  :host(:focus) { outline: none; }
  :host(:focus-visible) .wrap { box-shadow: 0 0 0 1px var(--radarclip-fg, #e7e9ee); }
  .wrap { position: relative; background: var(--radarclip-bg, #0e1014); border: 1px solid var(--radarclip-border, #2a2f3a);
    border-radius: 8px; overflow: hidden; }
  canvas { display: block; width: 100%; aspect-ratio: 1 / 1; max-height: 78vh; max-width: 78vh; margin: 0 auto; touch-action: none; }
  .big { position: absolute; inset: 0 0 47px 0; display: flex; align-items: center; justify-content: center;
    background: transparent; border: 0; cursor: pointer; color: inherit; }
  .big span { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px;
    background: rgba(0,0,0,.7); font-weight: 600; box-shadow: 0 0 0 1px rgba(255,255,255,.25); }
  .big[hidden] { display: none; }
  .big:hover span { box-shadow: 0 0 0 1px rgba(255,255,255,.7); }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--radarclip-border, #2a2f3a);
    background: var(--radarclip-panel, #161920); }
  .bar button { font: 600 12px/1 inherit; color: inherit; background: transparent; border: 1px solid var(--radarclip-border, #2a2f3a);
    border-radius: 6px; padding: 6px 8px; cursor: pointer; display: flex; align-items: center; min-height: 30px; }
  .bar button:hover { border-color: var(--radarclip-muted, #8d95a5); }
  .bar button.play { border: 0; padding: 4px; }
  .bar button[hidden] { display: none; }
  .time { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--radarclip-muted, #8d95a5);
    min-width: 52px; text-align: right; }
  .track { position: relative; flex: 1; min-width: 60px; height: 30px; display: flex; align-items: center; }
  .track input { width: 100%; margin: 0; accent-color: var(--radarclip-fg, #e7e9ee); }
  .mark { position: absolute; top: 2px; width: 2px; height: 7px; border-radius: 1px; background: var(--radarclip-me, #ff3df2);
    pointer-events: none; transform: translateX(-1px); }
  .error { padding: 16px; color: var(--radarclip-muted, #8d95a5); }
  @media (max-width: 480px) { .bar { gap: 5px; padding: 6px; } .time { min-width: 44px; } }
`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * `<radarclip-player src="r7.radarclip">` or with the clip inline:
 * `<radarclip-player><script type="application/json">{…}</script></radarclip-player>`.
 * Colours: --radarclip-ct, -t, -me, -bg, -fg, -muted, -border, -panel.
 */
export class RadarclipPlayerElement extends HTMLElement {
  static observedAttributes = ['src']
  player?: RadarclipPlayer
  private root: ShadowRoot
  private el!: Record<'canvas' | 'big' | 'play' | 'time' | 'range' | 'track' | 'speed' | 'floor' | 'zoom', HTMLElement>

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0
    const inline = this.querySelector('script[type="application/json"]')
    if (inline?.textContent && !this.player) this.load(readClip(inline.textContent))
  }

  disconnectedCallback() {
    this.player?.pause()
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'src' && value) this.load(fetch(value).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status} ${value}`)))).then(readClip))
  }

  /** Set a clip object directly. */
  set clip(clip: Clip) {
    this.load(Promise.resolve(clip))
  }

  private theme(): Partial<Theme> {
    const css = getComputedStyle(this)
    const v = (k: string) => css.getPropertyValue(`--radarclip-${k}`).trim() || undefined
    return { ct: v('ct'), t: v('t'), me: v('me'), bg: v('bg'), fg: v('fg'), muted: v('muted') }
  }

  private async load(clip: Promise<Clip>) {
    let c: Clip
    try {
      c = await clip
    } catch (e) {
      this.root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="error">${esc(String((e as Error).message ?? e))}</div></div>`
      return
    }
    this.player?.destroy()
    this.build()
    const theme = Object.fromEntries(Object.entries(this.theme()).filter(([, v]) => v)) as Partial<Theme>
    const p = (this.player = new RadarclipPlayer(this.el.canvas as HTMLCanvasElement, { theme }))
    await p.load(c)
    const range = this.el.range as HTMLInputElement
    range.min = String(p.start)
    range.max = String(p.end)
    const span = p.end - p.start || 1
    this.el.track.insertAdjacentHTML('beforeend', c.marks
      .map((m) => ({ s: m.t / c.tickrate, label: m.label }))
      .filter(({ s }) => s >= p.start && s <= p.end)
      .map(({ s, label }) => `<span class="mark" style="left:${((s - p.start) / span) * 100}%" title="${esc(label)}"></span>`)
      .join(''))
    this.el.big.querySelector('b')!.textContent = `Replay ${Math.round(span)} s`
    this.el.floor.hidden = p.split == null
    this.sync()
    p.on('time', () => this.sync())
    p.on('play', () => this.sync())
    p.on('pause', () => this.sync())
  }

  private build() {
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <canvas></canvas>
        <button class="big" type="button" aria-label="Play clip"><span>${ICON.play} <b></b></span></button>
        <div class="bar">
          <button class="play" type="button" aria-label="Play">${ICON.play}</button>
          <span class="time"></span>
          <div class="track"><input type="range" step="0.01" aria-label="Time"></div>
          <button class="speed" type="button" aria-label="Speed">1×</button>
          <button class="floor" type="button" aria-label="Floor" hidden></button>
          <button class="zoom" type="button" aria-label="Zoom">Map</button>
        </div>
      </div>`
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement
    this.el = {
      canvas: $('canvas'), big: $('.big'), play: $('.play'), time: $('.time'), range: $('input'), track: $('.track'),
      speed: $('.speed'), floor: $('.floor'), zoom: $('.zoom'),
    }
    const p = () => this.player!
    this.el.big.onclick = () => {
      this.el.big.hidden = true
      p().seek(p().start)
      p().play()
    }
    this.el.play.onclick = () => {
      this.el.big.hidden = true
      p().toggle()
    }
    this.el.range.oninput = (e) => {
      this.el.big.hidden = true
      p().pause()
      p().seek(+(e.target as HTMLInputElement).value)
    }
    this.el.speed.onclick = () => {
      p().speed = SPEEDS[(SPEEDS.indexOf(p().speed) + 1) % SPEEDS.length]
      this.sync()
    }
    this.el.floor.onclick = () => {
      p().floor = p().floor === 'upper' ? 'lower' : 'upper'
      this.sync()
    }
    this.el.zoom.onclick = () => {
      p().zoom = p().zoom === 'fit' ? 'map' : 'fit'
      this.sync()
    }
    this.onkeydown = (e) => {
      if (!this.player) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        this.el.big.hidden = true
        p().toggle()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        p().pause()
        p().seek(p().time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))
      }
    }
  }

  private sync() {
    const p = this.player!
    ;(this.el.range as HTMLInputElement).value = String(p.time)
    this.el.time.textContent = `${p.time.toFixed(1)} s`
    this.el.play.innerHTML = p.playing ? ICON.pause : ICON.play
    this.el.play.setAttribute('aria-label', p.playing ? 'Pause' : 'Play')
    if (p.playing) this.el.big.hidden = true
    this.el.speed.textContent = `${p.speed}×`
    this.el.floor.textContent = p.floor === 'upper' ? 'Upper' : 'Lower'
    this.el.zoom.textContent = p.zoom === 'fit' ? 'Map' : 'Fit'
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('radarclip-player')) {
  customElements.define('radarclip-player', RadarclipPlayerElement)
}
