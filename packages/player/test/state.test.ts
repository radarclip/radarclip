import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip } from '@radarclip/format'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RadarclipPlayer, type StateKey } from '../src/player.js'

// A canvas whose 2D context accepts every call, so the player can render in Node.
function fakeCanvas() {
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  return {
    getContext: () => ctx, clientWidth: 400, clientHeight: 400, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  } as unknown as HTMLCanvasElement
}

const fixture = join(import.meta.dirname, '../../../spec/fixtures/nuke-r2-full.radarclip.json')
let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const p = new RadarclipPlayer(fakeCanvas(), { interactive: false })
  const seen: { keys: StateKey[]; time: number; playing: boolean }[] = []
  p.onChange((state, changed) => seen.push({ keys: [...changed], time: state.time, playing: state.playing }))
  await p.load(await readClip(readFileSync(fixture, 'utf8')))
  return { p, seen }
}

it('reports a new clip as a change of everything, including the time', async () => {
  const { p, seen } = await setup()
  const last = seen.at(-1)!
  expect(last.keys).toEqual(expect.arrayContaining(['clip', 'time', 'playing', 'speed', 'zoom', 'floor']))
  expect(last.time).toBeCloseTo(p.start)
  expect(p.state.clip?.round).toBe(2)
})

it('names exactly what changed', async () => {
  const { p, seen } = await setup()
  const after = (fn: () => void) => {
    seen.length = 0
    fn()
    return seen.map((s) => s.keys)
  }
  expect(after(() => p.seek(10))).toEqual([['time']])
  expect(after(() => (p.speed = 2))).toEqual([['speed']])
  expect(after(() => (p.zoom = 'map'))).toEqual([['zoom']])
  expect(after(() => (p.floor = 'lower'))).toEqual([['floor']])
  expect(after(() => p.panBy(5, 5))).toEqual([['zoom']])
  expect(p.state.zoom).toBe('free')
})

it('reports playback frames as time and the end as stopped', async () => {
  const { p, seen } = await setup()
  p.play()
  expect(seen.at(-1)).toMatchObject({ keys: ['playing'], playing: true })
  const t0 = performance.now()
  frames.shift()!(t0)
  frames.shift()!(t0 + 1000)
  expect(seen.at(-1)!.keys).toEqual(['time'])
  expect(p.state.time).toBeCloseTo(p.start + 1, 1)
  frames.shift()!(t0 + 1e6) // far past the end
  expect(p.state).toMatchObject({ playing: false })
  expect(p.state.time).toBeCloseTo(p.end)
})

it('stops calling a listener after unsubscribing', async () => {
  const { p } = await setup()
  const fn = vi.fn()
  const off = p.onChange(fn)
  p.seek(3)
  off()
  p.seek(4)
  expect(fn).toHaveBeenCalledTimes(1)
})

it('never steps before the start when a frame is older than play()', async () => {
  const { p } = await setup()
  p.seek(p.start)
  p.play()
  // A frame timestamp from just before play() ran (browsers hand these out).
  frames.shift()!(performance.now() - 40)
  expect(p.time).toBeGreaterThanOrEqual(p.start)
  expect(p.time).toBeCloseTo(p.start)
})

it('fits frame areas into the view together with the focus players', async () => {
  const clip = await readClip(readFileSync(fixture, 'utf8'))
  const p = new RadarclipPlayer(fakeCanvas(), { interactive: false, radar: { pos_x: -3453, pos_y: 2887, scale: 7 } })
  await p.load({ ...clip, focus: [0] })
  const view = () => (p as unknown as { view: [number, number, number] }).view
  const before = view()
  // A 300-unit circle around radar px (100, 100), near the top-left corner.
  await p.load({ ...clip, focus: [0], frame: [{ x: -3453 + 7 * 100, y: 2887 - 7 * 100, r: 300 }] })
  const [x, y, size] = view()
  expect(size).toBeGreaterThan(before[2])
  expect(x).toBeLessThanOrEqual(100 - 300 / 7)
  expect(y).toBeLessThanOrEqual(100 - 300 / 7)
})
