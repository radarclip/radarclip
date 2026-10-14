import type { Clip } from './types.js'

export const MEDIA_TYPE = 'application/vnd.radarclip'
export const JSON_MEDIA_TYPE = 'application/vnd.radarclip+json'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** Read a clip from `.radarclip` (raw deflate) or `.radarclip.json` bytes, a string, or a Blob. */
export async function readClip(data: Uint8Array | ArrayBuffer | Blob | string): Promise<Clip> {
  if (typeof data === 'string') return check(JSON.parse(data))
  let bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof Uint8Array ? data : new Uint8Array(data)
  let i = 0
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09 || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i++
  if (bytes[i] !== 0x7b) bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
  return check(JSON.parse(new TextDecoder().decode(bytes)))
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
  const s = c.shots
  if (!s || s.t.length !== s.p.length || s.t.length !== s.yaw.length) fail('shots arrays differ in length')
  return c
}
