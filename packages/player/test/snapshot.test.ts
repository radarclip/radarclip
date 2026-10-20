import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip, type Clip } from '@radarclip/format'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RadarclipPlayer, type PlayerOptions } from '../src/player.js'

// A 2D context that accepts every call and records the texts and fonts drawn.
function recordingContext() {
  const texts: { text: string; font: string }[] = []
  const ctx: Record<string | symbol, unknown> = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * 7 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'fillText') return (text: string) => texts.push({ text, font: String(t.font) })
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  return { ctx, texts }
}

function screen() {
  const rec = recordingContext()
  const canvas = {
    getContext: () => rec.ctx, clientWidth: 400, clientHeight: 400, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  } as unknown as HTMLCanvasElement
  return { canvas, texts: rec.texts }
}

// The snapshot's own canvas, as the browser's OffscreenCanvas.
let offscreen: { width: number; height: number; texts: { text: string; font: string }[] }[] = []
beforeEach(() => {
  offscreen = []
  vi.stubGlobal('OffscreenCanvas', class {
    texts: { text: string; font: string }[]
    ctx: unknown
    constructor(public width: number, public height: number) {
      const rec = recordingContext()
      this.ctx = rec.ctx
      this.texts = rec.texts
      offscreen.push(this)
    }
    getContext() { return this.ctx }
    convertToBlob() { return Promise.resolve(new Blob(['png'])) }
  })
})
afterEach(() => vi.unstubAllGlobals())

// Ancient R7: frames from tick 2880, one mark "kill" at 3821.
const ancient = () => readClip(readFileSync(join(import.meta.dirname, '../../../spec/fixtures/ancient-r7-short.radarclip.json'), 'utf8'))

async function player(clip: Clip, opts: PlayerOptions = {}) {
  const s = screen()
  const p = new RadarclipPlayer(s.canvas, { interactive: false, icon: false, ...opts })
  await p.load(clip)
  return { p, texts: s.texts }
}

it('draws a snapshot at its own size and moment, leaving the view on screen as it was', async () => {
  const { p, texts } = await player(await ancient())
  p.seek(3000 / 64)
  p.zoom = 'map'
  texts.length = 0
  const blob = await p.snapshot({ width: 1200, height: 630, time: 3900 / 64 })
  expect(blob).toBeInstanceOf(Blob)
  expect(offscreen[0]).toMatchObject({ width: 1200, height: 630 })
  expect(offscreen[0].texts.map((t) => t.text)).toContain('kill')
  expect(p.time).toBeCloseTo(3000 / 64)
  expect(p.zoom).toBe('map')
  expect(texts).toEqual([])
})

it('leaves out single HUD parts', async () => {
  const { p } = await player(await ancient())
  await p.snapshot({ width: 1200, height: 630, time: 3900 / 64, hud: { marks: false } })
  const drawn = offscreen[0].texts.map((t) => t.text)
  expect(drawn).toContain('R7')
  expect(drawn).not.toContain('kill')
})

it('hides the whole HUD with hud: false, on screen and in snapshots', async () => {
  const clip = await ancient()
  const { p, texts } = await player(clip, { hud: false })
  p.seek(3900 / 64)
  expect(texts.map((t) => t.text)).not.toContain('R7')
  await p.snapshot({ width: 600, height: 315 })
  expect(offscreen[0].texts.map((t) => t.text)).not.toContain('R7')
  await p.snapshot({ width: 600, height: 315, hud: true })
  expect(offscreen[1].texts.map((t) => t.text)).toContain('R7')
})

it('scales the HUD with hudScale', async () => {
  const { p } = await player(await ancient())
  const clockFont = async (hudScale?: number) => {
    offscreen = []
    await p.snapshot({ width: 1280, height: 640, hudScale })
    return offscreen[0].texts.find((t) => t.text === 'R7')!.font
  }
  // 1280 px wide: twice a 640 px player; the round number is 11 px there.
  expect(await clockFont()).toContain('22px')
  expect(await clockFont(2)).toContain('44px')
})
