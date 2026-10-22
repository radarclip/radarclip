import type { Clip, Event, Nade, Shots, Side, Track } from './types.js'

export interface DecodedPlayer {
  index: number
  name: string
  side: Side
  /** Per frame; NaN where dead or absent. */
  x: Float32Array
  y: Float32Array
  z: Float32Array
  /** Degrees in [-180, 180). */
  yaw: Float32Array
  alive: Uint8Array
  hp: Int16Array
  armor: Int16Array
  /** Index into `weapons`, -1 for none. */
  weapon: Int16Array
  /** Index into `places`, -1 for none. */
  place: Int16Array
}

export interface DecodedNade {
  type: Nade['type']
  by?: number
  /** Absolute ticks and world positions of the flight. */
  t: Int32Array
  x: Float32Array
  y: Float32Array
  z: Float32Array
}

export interface Shot {
  t: number
  p: number
  yaw: number
}

/** A clip decoded for playback: absolute values, one entry per frame. */
export interface Replay {
  clip: Clip
  tickrate: number
  /** First and last frame tick. */
  start: number
  end: number
  step: number
  frames: number
  players: DecodedPlayer[]
  events: Event[]
  nades: DecodedNade[]
  shots: Shot[]
  /** Knife swings; empty when the clip has none. */
  knife: Shot[]
  /** Zeus shots; empty when the clip has none. */
  zeus: Shot[]
}

export interface PlayerState {
  x: number
  y: number
  z: number
  yaw: number
  hp: number
  armor: number
  weapon: string
  place: string
}

export const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180

function cumsum(a: number[]): number[] {
  const out = new Array<number>(a.length)
  let s = 0
  for (let i = 0; i < a.length; i++) out[i] = s += a[i]
  return out
}

function decodeTrack(index: number, name: string, side: Side, tr: Track, n: number, q: Clip['quant']): DecodedPlayer {
  const p: DecodedPlayer = {
    index, name, side,
    x: new Float32Array(n).fill(NaN), y: new Float32Array(n).fill(NaN), z: new Float32Array(n).fill(NaN),
    yaw: new Float32Array(n).fill(NaN), alive: new Uint8Array(n),
    hp: new Int16Array(n).fill(-1), armor: new Int16Array(n).fill(-1), weapon: new Int16Array(n).fill(-1), place: new Int16Array(n).fill(-1),
  }
  let state = 0
  let j = 0
  for (let f = 0; f < n; f++) {
    while (j < tr.alive.length && tr.alive[j] === f) {
      state ^= 1
      j++
    }
    p.alive[f] = state
  }

  const k = cumsum(tr.k), x = cumsum(tr.x), y = cumsum(tr.y), z = cumsum(tr.z), w = cumsum(tr.yaw)
  const set = (f: number, a: number, b: number, t: number) => {
    p.x[f] = (x[a] + (x[b] - x[a]) * t) * q.xy
    p.y[f] = (y[a] + (y[b] - y[a]) * t) * q.xy
    p.z[f] = (z[a] + (z[b] - z[a]) * t) * q.z
    const ya = wrapDeg(w[a] * q.yaw), yb = wrapDeg(w[b] * q.yaw)
    p.yaw[f] = wrapDeg(ya + wrapDeg(yb - ya) * t)
  }
  for (let i = 0; i + 1 < k.length; i++) {
    const fa = k[i], fb = k[i + 1]
    let ok = fb < n
    for (let f = fa; ok && f <= fb; f++) ok = p.alive[f] === 1
    if (!ok) continue
    for (let f = fa; f <= fb; f++) set(f, i, i + 1, fb === fa ? 0 : (f - fa) / (fb - fa))
  }
  for (let i = 0; i < k.length; i++) if (k[i] < n && p.alive[k[i]] && Number.isNaN(p.x[k[i]])) set(k[i], i, i, 0)

  const apply = (list: number[], out: Int16Array) => {
    let v = -1
    let c = 0
    for (let f = 0; f < n; f++) {
      while (c < list.length && list[c] <= f) {
        v = list[c + 1]
        c += 2
      }
      if (!Number.isNaN(p.x[f])) out[f] = v
    }
  }
  apply(tr.hp, p.hp)
  apply(tr.armor, p.armor)
  apply(tr.weapon, p.weapon)
  apply(tr.place, p.place)
  for (let f = 0; f < n; f++) if (Number.isNaN(p.x[f])) p.alive[f] = 0
  return p
}

/** Decode a clip into absolute, per-frame arrays. Throws on another major format version. */
export function decode(clip: Clip): Replay {
  const [name, major] = clip.format.split('/')
  if (name !== 'radarclip' || major !== '1') throw new Error(`unsupported format ${clip.format}`)
  const n = clip.frames
  const players = clip.players.map((p, i) => decodeTrack(i, p.name, p.side, p.track, n, clip.quant))
  const nades = clip.nades.map((g): DecodedNade => {
    const m = g.path.length >> 2
    const out = { type: g.type, by: g.by, t: new Int32Array(m), x: new Float32Array(m), y: new Float32Array(m), z: new Float32Array(m) }
    let t = 0, x = 0, y = 0, z = 0
    for (let i = 0; i < m; i++) {
      out.t[i] = t += g.path[4 * i]
      out.x[i] = x += g.path[4 * i + 1]
      out.y[i] = y += g.path[4 * i + 2]
      out.z[i] = z += g.path[4 * i + 3]
    }
    return out
  })
  const rows = (s: Shots | undefined): Shot[] => {
    let t = 0
    return s ? s.t.map((dt, i) => ({ t: (t += dt), p: s.p[i], yaw: s.yaw[i] })) : []
  }
  return {
    clip, tickrate: clip.tickrate, start: clip.start, end: clip.start + (n - 1) * clip.step, step: clip.step, frames: n,
    players, events: [...clip.events].sort((a, b) => a.t - b.t), nades,
    shots: rows(clip.shots), knife: rows(clip.knife), zeus: rows(clip.zeus),
  }
}

/** A player's state at tick `t` (fractional), interpolated between frames; null when dead or absent. */
export function stateAt(r: Replay, player: number, t: number): PlayerState | null {
  const p = r.players[player]
  if (!p) return null
  const pos = (t - r.start) / r.step
  if (pos < 0 || pos > r.frames - 1) return null
  const i = Math.floor(pos)
  if (!p.alive[i]) return null
  // Interpolate only towards a frame that has a position: on the last frame before a death the
  // next one is empty, and NaN * 0 would still be NaN.
  const next = Math.min(i + 1, r.frames - 1)
  const j = p.alive[next] ? next : i
  const f = j === i ? 0 : pos - i
  const near = f > 0.5 ? j : i
  const ya = p.yaw[i]
  return {
    x: p.x[i] + (p.x[j] - p.x[i]) * f,
    y: p.y[i] + (p.y[j] - p.y[i]) * f,
    z: p.z[i] + (p.z[j] - p.z[i]) * f,
    yaw: wrapDeg(ya + wrapDeg(p.yaw[j] - ya) * f),
    hp: p.hp[near],
    armor: p.armor[near],
    weapon: r.clip.weapons[p.weapon[near]] ?? '',
    place: r.clip.places[p.place[near]] ?? '',
  }
}
