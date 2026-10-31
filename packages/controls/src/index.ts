import type { PlayerState, RadarclipPlayerElement, StateKey } from '@radarclip/player'

const SPEEDS = [0.25, 0.5, 1, 2]
const ICON = {
  // radarclip's own icons (the design system's Icons card): 20 px grid, 1.5 px stroke, square caps.
  // Play/pause is the bar's one borderless control, so it shows at the grid's full 20 px.
  play: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M6 4l10 6-10 6z"/></svg>',
  pause: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M7 4v12 M13 4v12"/></svg>',
  // Zoom buttons show where a click goes: the whole radar, or back around the players.
  map: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M3 5l4.5-2 5 2 4.5-2v12l-4.5 2-5-2-4.5 2z M7.5 3v12 M12.5 5v12"/></svg>',
  fit: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M3 7V3h4 M13 3h4v4 M17 13v4h-4 M7 17H3v-4"/><circle cx="10" cy="10" r="1.5"/></svg>',
  // Floor buttons show the floor on screen: two stacked floors, that one filled.
  upper: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M10 3l7 3.5-7 3.5-7-3.5z" fill="currentColor"/><path d="M3 13.5l7 3.5 7-3.5"/></svg>',
  lower: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M10 3l7 3.5-7 3.5-7-3.5z"/><path d="M10 10l7 3.5-7 3.5-7-3.5z" fill="currentColor"/></svg>',
}
const CSS = `
  :host { display: block; color: var(--radarclip-fg, #e8ebef); font: 13px/1.4 Geist, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--radarclip-panel, #14171c);
    border-top: 1px solid var(--radarclip-line, #2a2f38); }
  button { font: 600 12px/1 inherit; color: inherit; background: transparent; border: 1px solid var(--radarclip-border, #5b6470);
    border-radius: 6px; padding: 6px 8px; cursor: pointer; display: flex; align-items: center; min-height: 30px; }
  button:hover { border-color: var(--radarclip-muted, #9aa3ae); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--radarclip-me, #9d8cff); outline-offset: 2px; }
  button.play { border: 0; padding: 4px; }
  button svg { pointer-events: none; }
  button[hidden] { display: none; }
  /* Every label a button can show sits in one grid cell, so the button keeps the widest one's
     width and the timeline doesn't jump when the label changes. */
  .stack { display: inline-grid; justify-items: center; }
  .stack > * { grid-area: 1 / 1; }
  .stack > [aria-hidden] { visibility: hidden; }
  /* The knob is drawn here, not by the browser, so its width is known: its centre runs from
     thumb/2 to 100% − thumb/2, and the rail's fill and the marks use the same formula. The rail
     sits under the marks and the input on top of both, so only its knob shows. */
  .track { --thumb: 24px; position: relative; flex: 1; min-width: 60px; height: 30px; display: flex; align-items: center; }
  .rail { --at: calc(var(--thumb) / 2 + var(--f, 0) * (100% - var(--thumb))); position: absolute; left: 0; right: 0;
    top: calc(50% - 3px); height: 6px; border-radius: 3px; pointer-events: none; background: linear-gradient(to right,
    var(--radarclip-me, #9d8cff) var(--at), color-mix(in srgb, var(--radarclip-fg, #e8ebef) 18%, transparent) var(--at)); }
  input { position: relative; z-index: 1; width: 100%; height: 16px; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer; }
  input::-webkit-slider-runnable-track { height: 6px; background: transparent; }
  input::-moz-range-track { height: 6px; background: transparent; }
  input::-webkit-slider-thumb { -webkit-appearance: none; width: var(--thumb); height: 16px; margin-top: -5px; border: 0;
    border-radius: 8px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.5); }
  input::-moz-range-thumb { width: var(--thumb); height: 16px; border: 0; border-radius: 8px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.5); }
  /* A ring on the rail, the same dot that leads the mark label on the map; filled once played. */
  .mark { position: absolute; top: calc(50% - 4.5px); width: 9px; height: 9px; box-sizing: border-box; border-radius: 50%;
    border: 2px solid var(--radarclip-me, #9d8cff); background: var(--radarclip-panel, #14171c); pointer-events: none;
    transform: translateX(-4.5px); left: calc(var(--thumb) / 2 + var(--f) * (100% - var(--thumb))); }
  .mark.seen { background: #fff; }
  @media (max-width: 480px) { .bar { gap: 5px; padding: 6px; } }
`
const stack = (labels: string[], current: string) =>
  `<span class="stack"><span class="v">${current}</span>${labels.map((l) => `<span aria-hidden="true">${l}</span>`).join('')}</span>`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Play/pause, timeline with marks, speed, floor and zoom for a `<radarclip-player>`.
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
  private el!: Record<'play' | 'range' | 'track' | 'speed' | 'floor' | 'zoom', HTMLElement>
  private _target?: RadarclipPlayerElement
  private cleanup: (() => void)[] = []

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="bar">
        <button class="play" type="button" aria-label="Play">${ICON.play}</button>
        <div class="track"><div class="rail"></div><input type="range" step="0.01" aria-label="Time"></div>
        <button class="speed" type="button" aria-label="Speed">${stack(SPEEDS.map((s) => `${s}×`), '1×')}</button>
        <button class="floor" type="button" hidden></button>
        <button class="zoom" type="button" data-to="map" aria-label="Show the whole map" title="Show the whole map">${ICON.map}</button>
      </div>`
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement
    this.el = { play: $('.play'), range: $('input'), track: $('.track'), speed: $('.speed'), floor: $('.floor'), zoom: $('.zoom') }
    const p = () => this._target?.player
    this.el.play.onclick = () => p()?.toggle()
    // Scrubbing pauses while the knob moves and resumes on release if it was playing.
    this.el.range.onpointerdown = () => {
      const pl = p()
      if (!pl?.playing) return
      pl.pause()
      const resume = () => {
        removeEventListener('pointerup', resume)
        removeEventListener('pointercancel', resume)
        if (pl.time < pl.end) pl.play()
      }
      addEventListener('pointerup', resume)
      addEventListener('pointercancel', resume)
    }
    this.el.range.oninput = (e) => p()?.seek(+(e.target as HTMLInputElement).value)
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
    // With the controls defined first, the player may not be upgraded yet: show it once it is.
    const show = () => {
      if (this._target !== el || !el.player?.replay) return
      this.loaded(el.player.state)
      this.sync(el.player.state)
    }
    if (el.player) show()
    else void customElements.whenDefined(el.localName).then(show)
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
      .map(({ s, label }) => `<span class="mark" style="--f:${(s - p.start) / span}" data-s="${s}" title="${esc(label)}"></span>`)
      .join(''))
    this.el.floor.hidden = !p.floors
  }

  /** Runs every frame while playing: only touch the DOM where something changed. Replacing a
   *  button's content under the cursor between mousedown and mouseup swallows the click. */
  private sync(p: PlayerState) {
    if (!p.clip) return
    ;(this.el.range as HTMLInputElement).value = String(p.time)
    this.el.track.style.setProperty('--f', String((p.time - p.start) / (p.end - p.start || 1)))
    for (const m of this.el.track.querySelectorAll<HTMLElement>('.mark')) m.classList.toggle('seen', +m.dataset.s! <= p.time)
    // The time itself is the round clock on the map; the slider still tells screen readers.
    this.el.range.setAttribute('aria-valuetext', `${p.time.toFixed(1)} s`)
    if (this.el.play.dataset.state !== String(p.playing)) {
      this.el.play.dataset.state = String(p.playing)
      this.el.play.innerHTML = p.playing ? ICON.pause : ICON.play
      this.el.play.setAttribute('aria-label', p.playing ? 'Pause' : 'Play')
    }
    this.text(this.el.speed.querySelector('.v')!, `${p.speed}×`)
    if (this.el.floor.dataset.floor !== p.floor) {
      this.el.floor.dataset.floor = p.floor
      this.el.floor.innerHTML = ICON[p.floor]
      const label = p.floor === 'upper' ? 'Upper floor: show the lower one' : 'Lower floor: show the upper one'
      this.el.floor.setAttribute('aria-label', label)
      this.el.floor.title = label
    }
    const to = p.zoom === 'fit' ? 'map' : 'fit'
    if (this.el.zoom.dataset.to !== to) {
      this.el.zoom.dataset.to = to
      this.el.zoom.innerHTML = ICON[to]
      const label = to === 'map' ? 'Show the whole map' : 'Zoom to the players'
      this.el.zoom.setAttribute('aria-label', label)
      this.el.zoom.title = label
    }
  }

  private text(el: HTMLElement, value: string) {
    if (el.textContent !== value) el.textContent = value
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('radarclip-controls')) {
  customElements.define('radarclip-controls', RadarclipControlsElement)
}
