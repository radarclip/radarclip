import type { PlayerState, RadarclipPlayerElement, StateKey } from '@radarclip/player'

const SPEEDS = [0.25, 0.5, 1, 2]
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>',
}
const CSS = `
  :host { display: block; color: var(--radarclip-fg, #e7e9ee); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--radarclip-panel, #161920);
    border-top: 1px solid var(--radarclip-border, #2a2f3a); }
  button { font: 600 12px/1 inherit; color: inherit; background: transparent; border: 1px solid var(--radarclip-border, #2a2f3a);
    border-radius: 6px; padding: 6px 8px; cursor: pointer; display: flex; align-items: center; min-height: 30px; }
  button:hover { border-color: var(--radarclip-muted, #8d95a5); }
  button.play { border: 0; padding: 4px; }
  button svg { pointer-events: none; }
  button[hidden] { display: none; }
  .time { font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--radarclip-muted, #8d95a5); min-width: 52px; text-align: right; }
  .track { position: relative; flex: 1; min-width: 60px; height: 30px; display: flex; align-items: center; }
  input { width: 100%; margin: 0; accent-color: var(--radarclip-fg, #e7e9ee); }
  .mark { position: absolute; top: 2px; width: 2px; height: 7px; border-radius: 1px; background: var(--radarclip-me, #ff3df2);
    pointer-events: none; transform: translateX(-1px); }
  @media (max-width: 480px) { .bar { gap: 5px; padding: 6px; } .time { min-width: 44px; } }
`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Play/pause, time, timeline with marks, speed, floor and zoom for a `<radarclip-player>`.
 *
 *     <radarclip-player id="p" src="r7.radarclip"></radarclip-player>
 *     <radarclip-controls for="p"></radarclip-controls>
 *
 * Or connect in code: `controls.target = playerElement`. Keyboard (on the player or the
 * controls): space/k play-pause, ←/→ ±1 s (shift ±5 s).
 */
export class RadarclipControlsElement extends HTMLElement {
  static observedAttributes = ['for']
  private root: ShadowRoot
  private el!: Record<'play' | 'time' | 'range' | 'track' | 'speed' | 'floor' | 'zoom', HTMLElement>
  private _target?: RadarclipPlayerElement
  private cleanup: (() => void)[] = []

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="bar">
        <button class="play" type="button" aria-label="Play">${ICON.play}</button>
        <span class="time"></span>
        <div class="track"><input type="range" step="0.01" aria-label="Time"></div>
        <button class="speed" type="button" aria-label="Speed">1×</button>
        <button class="floor" type="button" aria-label="Floor" hidden></button>
        <button class="zoom" type="button" aria-label="Zoom">Map</button>
      </div>`
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement
    this.el = { play: $('.play'), time: $('.time'), range: $('input'), track: $('.track'), speed: $('.speed'), floor: $('.floor'), zoom: $('.zoom') }
    const p = () => this._target?.player
    this.el.play.onclick = () => p()?.toggle()
    this.el.range.oninput = (e) => {
      p()?.pause()
      p()?.seek(+(e.target as HTMLInputElement).value)
    }
    this.el.speed.onclick = () => {
      const pl = p()
      if (pl) pl.speed = SPEEDS[(SPEEDS.indexOf(pl.speed) + 1) % SPEEDS.length]
    }
    this.el.floor.onclick = () => {
      const pl = p()
      if (pl) pl.floor = pl.floor === 'upper' ? 'lower' : 'upper'
    }
    this.el.zoom.onclick = () => {
      const pl = p()
      if (pl) pl.zoom = pl.zoom === 'fit' ? 'map' : 'fit'
    }
    this.addEventListener('keydown', (e) => this.key(e))
  }

  connectedCallback() {
    if (!this._target && this.getAttribute('for')) this.attributeChangedCallback('for', null, this.getAttribute('for'))
  }

  disconnectedCallback() {
    this.detach()
  }

  attributeChangedCallback(_name: string, _old: string | null, id: string | null) {
    if (!id || !this.isConnected) return
    const target = (this.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? document.getElementById(id)
    if (target) this.target = target as RadarclipPlayerElement
  }

  get target() {
    return this._target
  }

  set target(el: RadarclipPlayerElement | undefined) {
    this.detach()
    this._target = el
    if (!el) return
    const on = (name: string, fn: (e: Event) => void) => {
      el.addEventListener(name, fn)
      this.cleanup.push(() => el.removeEventListener(name, fn))
    }
    on('radarclip:change', (e) => {
      const { state, changed } = (e as CustomEvent<{ state: PlayerState; changed: StateKey[] }>).detail
      if (changed.includes('clip')) this.loaded(state)
      this.sync(state)
    })
    on('keydown', (e) => this.key(e as KeyboardEvent))
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0
    if (el.player.replay) {
      this.loaded(el.player.state)
      this.sync(el.player.state)
    }
  }

  private detach() {
    for (const fn of this.cleanup) fn()
    this.cleanup = []
  }

  private key(e: KeyboardEvent) {
    const p = this._target?.player
    if (!p?.replay || e.defaultPrevented) return
    if (e.key === ' ' || e.key === 'k') p.toggle()
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      p.pause()
      p.seek(p.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))
    } else return
    e.preventDefault()
  }

  /** A new clip: timeline bounds, marks, floor button. */
  private loaded(p: PlayerState) {
    const c = p.clip
    if (!c) return
    const range = this.el.range as HTMLInputElement
    range.min = String(p.start)
    range.max = String(p.end)
    const span = p.end - p.start || 1
    for (const m of this.el.track.querySelectorAll('.mark')) m.remove()
    this.el.track.insertAdjacentHTML('beforeend', c.marks
      .map((m) => ({ s: m.t / c.tickrate, label: m.label }))
      .filter(({ s }) => s >= p.start && s <= p.end)
      .map(({ s, label }) => `<span class="mark" style="left:${((s - p.start) / span) * 100}%" title="${esc(label)}"></span>`)
      .join(''))
    this.el.floor.hidden = !p.floors
  }

  /** Runs every frame while playing: only touch the DOM where something changed. Replacing a
   *  button's content under the cursor between mousedown and mouseup swallows the click. */
  private sync(p: PlayerState) {
    if (!p.clip) return
    ;(this.el.range as HTMLInputElement).value = String(p.time)
    this.text(this.el.time, `${p.time.toFixed(1)} s`)
    if (this.el.play.dataset.state !== String(p.playing)) {
      this.el.play.dataset.state = String(p.playing)
      this.el.play.innerHTML = p.playing ? ICON.pause : ICON.play
      this.el.play.setAttribute('aria-label', p.playing ? 'Pause' : 'Play')
    }
    this.text(this.el.speed, `${p.speed}×`)
    this.text(this.el.floor, p.floor === 'upper' ? 'Upper' : 'Lower')
    this.text(this.el.zoom, p.zoom === 'fit' ? 'Map' : 'Fit')
  }

  private text(el: HTMLElement, value: string) {
    if (el.textContent !== value) el.textContent = value
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('radarclip-controls')) {
  customElements.define('radarclip-controls', RadarclipControlsElement)
}
