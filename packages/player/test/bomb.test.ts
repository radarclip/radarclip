import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip, type Clip } from '@radarclip/format'
import { expect, it } from 'vitest'
import { RadarclipPlayer } from '../src/player.js'

const DEFUSE = '#4cd28a'
const BOMB = '#ff2b2b'

// A canvas that accepts every call and records strokes and filled rectangles (with their colour)
// and text.
function recordingCanvas() {
  const strokes: string[] = []
  const rects: string[] = []
  const texts: { text: string; color: string }[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'stroke') return () => strokes.push(String(t.strokeStyle))
      if (k === 'fillText') return (text: string) => texts.push({ text, color: String(t.fillStyle) })
      if (k === 'fillRect') return () => rects.push(String(t.fillStyle))
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  const canvas = {
    getContext: () => ctx, clientWidth: 400, clientHeight: 400, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  } as unknown as HTMLCanvasElement
  return { canvas, strokes, rects, texts }
}

async function at(clip: Clip, seconds: number) {
  const rec = recordingCanvas()
  const p = new RadarclipPlayer(rec.canvas, { interactive: false })
  await p.load(clip)
  rec.strokes.length = rec.rects.length = rec.texts.length = 0
  p.seek(seconds)
  return rec
}

// Nuke R2: the bomb handed out in freeze time, planted from tick 1139 to 1339, one defuse without
// a kit from 2553 to 3193 (done).
const nuke = () => readClip(readFileSync(join(import.meta.dirname, '../../../spec/fixtures/nuke-r2-full.radarclip.json'), 'utf8'))

it('fills a ring on the bomb while someone defuses, and keeps the bomb timer running', async () => {
  const clip = await nuke()
  const during = await at(clip, 2873 / 64)
  expect(during.strokes).toContain(DEFUSE)
  expect(during.texts).toContainEqual({ text: '0:17', color: '#ff2b2b' })
  const before = await at(clip, 2500 / 64)
  expect(before.strokes).not.toContain(DEFUSE)
})

it('stops the bomb timer in defuse green on the time that was left', async () => {
  const after = await at(await nuke(), 3300 / 64)
  expect(after.texts).toContainEqual({ text: '0:12', color: DEFUSE })
})

it('shows an attempt given up for a moment, then lets it go', async () => {
  const clip = await nuke()
  // The same round with a fake: an attempt with a kit, let go after one second.
  clip.events.push({ type: 'defusing', t: 2300, by: 4, until: 2364, kit: true })
  clip.events.sort((a, b) => a.t - b.t)
  const white = (s: string[]) => s.filter((c) => c === '#fff').length
  const quiet = white((await at(clip, 2500 / 64)).strokes)
  expect(white((await at(clip, 2380 / 64)).strokes)).toBeGreaterThan(quiet)
  expect((await at(clip, 2350 / 64)).strokes).toContain(DEFUSE)
})

it('marks the carrier, then fills a red ring while they plant', async () => {
  const clip = await nuke()
  const carried = await at(clip, 600 / 64)
  expect(carried.rects).toContain(BOMB)
  expect(carried.strokes).not.toContain(BOMB)
  expect((await at(clip, 1239 / 64)).strokes).toContain(BOMB)
})

it('shows a dropped bomb on the floor instead of on a player', async () => {
  const clip = await nuke()
  const plant = clip.events.find((e) => e.type === 'plant')!
  if (plant.type !== 'plant') throw new Error('no plant')
  clip.events.push({ type: 'drop', t: 500, x: plant.x, y: plant.y, z: plant.z }, { type: 'pickup', t: 900, by: 4 })
  clip.events.sort((a, b) => a.t - b.t)
  const lying = await at(clip, 520 / 64)
  expect(lying.rects).toContain(BOMB)
  expect(lying.strokes).toContain(BOMB) // the pulse
  expect((await at(clip, 400 / 64)).strokes).not.toContain(BOMB)
})
