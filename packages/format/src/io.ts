import type { Clip, MatchFile } from './types.js'

export const MEDIA_TYPE = 'application/vnd.radarclip'
export const JSON_MEDIA_TYPE = 'application/vnd.radarclip+json'
export const MATCH_MEDIA_TYPE = 'application/vnd.radarclip-match'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

type Source = Uint8Array | ArrayBuffer | Blob | string

/** JSON from plain or raw-deflated bytes, a string, or a Blob. */
async function readJson(data: Source): Promise<unknown> {
  if (typeof data === 'string') return JSON.parse(data)
  let bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof Uint8Array ? data : new Uint8Array(data)
  let i = 0
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09 || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i++
  if (bytes[i] !== 0x7b) bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** Read a clip from `.radarclip` (raw deflate) or `.radarclip.json` bytes, a string, or a Blob. */
export async function readClip(data: Source): Promise<Clip> {
  return check(await readJson(data))
}

/**
 * Read a whole match from `.radarclip-match` (raw deflate) or `.radarclip-match.json`. Every
 * round's clip goes through the same checks (and, once there are newer clip formats, the same
 * upgrades) as `readClip`, so stored matches keep opening as the format grows.
 */
export async function readMatch(data: Source): Promise<MatchFile> {
  return checkMatch(await readJson(data))
}

/** Serialise a match: raw deflate (`.radarclip-match`, default) or plain JSON. */
export async function writeMatch(match: MatchFile, { deflate = true } = {}): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(match))
  return deflate ? pipe(json, new CompressionStream('deflate-raw')) : json
}

/** Structural checks for a match; throws with the first problem found. */
export function checkMatch(value: unknown): MatchFile {
  const m = value as MatchFile
  const fail = (msg: string): never => {
    throw new Error(`not a radarclip match: ${msg}`)
  }
  if (!m || typeof m !== 'object') fail('not an object')
  if (typeof m.format !== 'string' || !/^radarclip-match\/\d+$/.test(m.format)) fail(`format ${JSON.stringify(m.format)}`)
  if (m.format !== 'radarclip-match/1') fail(`${m.format} needs a newer reader`)
  if (!Array.isArray(m.players) || !Array.isArray(m.rounds)) fail('players and rounds must be arrays')
  for (const r of m.rounds) {
    if (!Number.isInteger(r?.number)) fail('round without a number')
    try {
      r.clip = check(r.clip)
    } catch (e) {
      fail(`round ${r.number}: ${(e as Error).message}`)
    }
    if (!Array.isArray(r.keys) || r.keys.length !== r.clip.players.length) fail(`round ${r.number}: keys must name every player of its clip`)
  }
  return m
}

/** Serialise a clip: raw deflate (`.radarclip`, default) or plain JSON (`.radarclip.json`). */
export async function writeClip(clip: Clip, { deflate = true } = {}): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(clip))
  return deflate ? pipe(json, new CompressionStream('deflate-raw')) : json
}

/** Structural checks a player relies on; throws with the first problem found. */
export function check(value: unknown): Clip {
  const c = value as Clip
  const fail = (msg: string): never => {
    throw new Error(`not a radarclip: ${msg}`)
  }
  if (!c || typeof c !== 'object') fail('not an object')
  if (typeof c.format !== 'string' || !/^radarclip\/\d+$/.test(c.format)) fail(`format ${JSON.stringify(c.format)}`)
  if (c.format !== 'radarclip/1') fail(`${c.format} needs a newer reader`)
  for (const k of ['tickrate', 'start', 'step', 'frames', 'round'] as const) if (!Number.isInteger(c[k])) fail(`${k} must be an integer`)
  if (!Array.isArray(c.players) || !Array.isArray(c.events) || !Array.isArray(c.nades)) fail('players, events and nades must be arrays')
  for (const [i, p] of c.players.entries()) {
    const t = p.track
    if (!t || [t.k, t.x, t.y, t.z, t.yaw].some((a) => !Array.isArray(a) || a.length !== t.k.length)) fail(`player ${i}: track arrays differ in length`)
  }
  const n = c.players.length
  const isPlayer = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n)
  for (const e of c.events) {
    const ev = e as Record<string, unknown>
    if (!isPlayer(ev.attacker) || !isPlayer(ev.victim) || !isPlayer(ev.by)) fail(`${String(ev.type)} event at ${String(ev.t)}: unknown player`)
  }
  if (c.frame !== undefined && (!Array.isArray(c.frame) || c.frame.some((a) => !a || ![a.x, a.y, a.r].every(Number.isFinite) || a.r < 0))) fail('frame must list areas {x, y, r}')
  const s = c.shots
  if (!s || s.t.length !== s.p.length || s.t.length !== s.yaw.length) fail('shots arrays differ in length')
  return c
}
