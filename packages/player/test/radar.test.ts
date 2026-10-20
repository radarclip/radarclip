import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip } from '@radarclip/format'
import { expect, it } from 'vitest'
import { RadarclipPlayer } from '../src/player.js'

// A canvas that records drawImage calls.
function recordingCanvas() {
  const draws: unknown[][] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'drawImage') return (...args: unknown[]) => draws.push(args)
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  const canvas = {
    getContext: () => ctx, clientWidth: 400, clientHeight: 400, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  } as unknown as HTMLCanvasElement
  return { canvas, draws }
}

it('leaves out the radar image’s outermost pixels, so a frame in the artwork shows no seam', async () => {
  const rec = recordingCanvas()
  const p = new RadarclipPlayer(rec.canvas, { interactive: false, icon: false })
  await p.load(await readClip(readFileSync(join(import.meta.dirname, '../../../spec/fixtures/ancient-r7-short.radarclip.json'), 'utf8')))
  const radar = { width: 2048, height: 2048 } as HTMLImageElement
  ;(p as unknown as { images: { upper?: HTMLImageElement } }).images = { upper: radar }
  rec.draws.length = 0
  p.seek(p.start)
  const draw = rec.draws.find((d) => d[0] === radar)
  expect(draw).toEqual([radar, 2, 2, 2044, 2044, 1, 1, 1022, 1022])
})
