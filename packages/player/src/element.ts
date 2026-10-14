import { readClip, type Clip } from '@radarclip/format'
import { RadarclipPlayer, type PlayerEventName, type Theme } from './player.js'

const EVENTS: PlayerEventName[] = ['load', 'time', 'play', 'pause', 'ended', 'view']

/**
 * The bare viewer: a canvas that draws and plays a clip, no controls.
 *
 *     <radarclip-player src="r7.radarclip"></radarclip-player>
 *     <radarclip-player><script type="application/json">{…}</script></radarclip-player>
 *
 * `el.player` is the RadarclipPlayer; its events are re-dispatched on the element as
 * `radarclip:load`, `radarclip:time`, `radarclip:play`, `radarclip:pause`, `radarclip:ended`,
 * `radarclip:view` (detail: seconds), so controls and apps can connect to it.
 * Colours: --radarclip-ct, -t, -me, -bg, -fg, -muted.
 */
export class RadarclipPlayerElement extends HTMLElement {
  static observedAttributes = ['src']
  readonly player: RadarclipPlayer
  private loading = 0

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>
      :host { display: block; aspect-ratio: 1 / 1; background: var(--radarclip-bg, #0e1014); }
      canvas { display: block; width: 100%; height: 100%; }
    </style><canvas></canvas>`
    this.player = new RadarclipPlayer(root.querySelector('canvas')!)
    for (const name of EVENTS) {
      this.player.on(name, (seconds) => this.dispatchEvent(new CustomEvent(`radarclip:${name}`, { detail: seconds })))
    }
  }

  connectedCallback() {
    const inline = this.querySelector('script[type="application/json"]')
    if (inline?.textContent && !this.player.replay) void this.load(inline.textContent)
  }

  disconnectedCallback() {
    this.player.pause()
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'src' && value) {
      void this.load(fetch(value).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status} ${value}`)))))
    }
  }

  /** Load a clip object, `.radarclip`/`.radarclip.json` bytes, a Blob or a JSON string. */
  async load(source: Clip | Promise<Blob | string> | Blob | string | Uint8Array): Promise<void> {
    const id = ++this.loading
    try {
      const data = await source
      const clip = typeof data === 'object' && 'format' in data ? (data as Clip) : await readClip(data as Blob | string | Uint8Array)
      if (id !== this.loading) return
      this.player.setTheme(this.cssTheme())
      await this.player.load(clip)
    } catch (e) {
      this.dispatchEvent(new CustomEvent('radarclip:error', { detail: e }))
      throw e
    }
  }

  set clip(clip: Clip) {
    void this.load(clip)
  }

  private cssTheme(): Partial<Theme> {
    const css = getComputedStyle(this)
    const out: Partial<Theme> = {}
    for (const k of ['ct', 't', 'me', 'bg', 'fg', 'muted'] as const) {
      const v = css.getPropertyValue(`--radarclip-${k}`).trim()
      if (v) out[k] = v
    }
    return out
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('radarclip-player')) {
  customElements.define('radarclip-player', RadarclipPlayerElement)
}
