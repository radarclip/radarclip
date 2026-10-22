import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip, type Clip } from '@radarclip/format'
import { expect, it } from 'vitest'
import { RadarclipPlayer } from '../src/player.js'

// A canvas that accepts every call and records the colours of strokes and fills (with their alpha).
function recordingCanvas() {
  const strokes: string[] = []
  const fills: { color: string; alpha: number }[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'stroke') return () => strokes.push(String(t.strokeStyle))
      if (k === 'fill') return () => fills.push({ color: String(t.fillStyle), alpha: Number(t.globalAlpha ?? 1) })
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  const canvas = {
    getContext: () => ctx, clientWidth: 400, clientHeight: 400, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  } as unknown as HTMLCanvasElement
  return { canvas, strokes, fills }
}

async function at(clip: Clip, tick: number) {
  const rec = recordingCanvas()
  const p = new RadarclipPlayer(rec.canvas, { interactive: false })
  await p.load(clip)
  p.seek(tick / clip.tickrate)
  rec.strokes.length = rec.fills.length = 0
  p.seek((tick + 6) / clip.tickrate)
  return rec
}

const nuke = () => readClip(readFileSync(join(import.meta.dirname, '../../../spec/fixtures/nuke-r2-full.radarclip.json'), 'utf8'))
const T = '#e8a33d'

it('draws a Zeus as a white bolt, also when it misses', async () => {
  const clip = await nuke()
  const p = clip.players.findIndex((x) => x.side === 'T')
  const before = (await at(clip, 600)).strokes.filter((c) => c === '#fff').length
  clip.zeus = { t: [600], p: [p], yaw: [0] }
  const after = (await at(clip, 600)).strokes.filter((c) => c === '#fff').length
  expect(after).toBeGreaterThan(before)
})

it('draws a knife slash as a streak in the swinger’s colour, an idle one dimmer', async () => {
  const clip = await nuke()
  const p = clip.players.findIndex((x) => x.side === 'T'), v = clip.players.findIndex((x) => x.side === 'CT')
  // Streaks are the swinger's colour below full alpha (dots are drawn at full alpha).
  const streaks = async (c: Clip) => (await at(c, 70)).fills.filter((f) => f.color === T && f.alpha < 1)
  expect(await streaks(clip)).toEqual([])
  // Shortly after freeze end both teams are in spawn: a swing at nobody is idle.
  clip.knife = { t: [70], p: [p], yaw: [0] }
  expect((await streaks(clip)).map((f) => f.alpha)).toEqual([0.5])
  clip.events = [...clip.events, { type: 'hurt', t: 70, attacker: p, victim: v, dmg: 34, weapon: 'knife_t' }]
  expect((await streaks(clip)).map((f) => f.alpha)).toEqual([0.95])
})

it('draws a stab from a knife hit that no slash matches', async () => {
  const clip = await nuke()
  const p = clip.players.findIndex((x) => x.side === 'T'), v = clip.players.findIndex((x) => x.side === 'CT')
  const count = async (c: Clip) => (await at(c, 70)).fills.filter((f) => f.color === T).length
  const base = await count(clip)
  clip.events = [...clip.events, { type: 'hurt', t: 70, attacker: p, victim: v, dmg: 153, weapon: 'knife_t' }]
  expect(await count(clip)).toBeGreaterThan(base)
})
