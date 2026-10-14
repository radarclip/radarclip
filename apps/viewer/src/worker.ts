// Parses the demo off the main thread. The file is read in 16 MB slices straight into wasm
// memory, so the page never holds a second full copy. Nothing leaves the browser.
import init, { Demo, DemoLoader } from '../../../crates/radarclip-wasm/pkg/radarclip_wasm.js'

const ready = init({ module_or_path: new URL('radarclip_wasm_bg.wasm', import.meta.url) })
const CHUNK = 16 << 20
let demo: Demo | null = null

export type Request = { type: 'open'; file: File } | { type: 'clip'; id: number; request: object }
export type Response =
  | { type: 'progress'; loaded: number; size: number }
  | { type: 'info'; info: unknown; readMs: number; parseMs: number }
  | { type: 'clip'; id: number; json: string }
  | { type: 'error'; id?: number; message: string }

const post = (m: Response) => postMessage(m)

onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    await ready
    if (data.type === 'open') {
      demo?.free()
      demo = null
      const { file } = data
      const t0 = performance.now()
      const loader = new DemoLoader(file.size)
      for (let off = 0; off < file.size; off += CHUNK) {
        loader.push(new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer()))
        post({ type: 'progress', loaded: Math.min(off + CHUNK, file.size), size: file.size })
      }
      const t1 = performance.now()
      demo = loader.finish()
      post({ type: 'info', info: JSON.parse(demo.info()), readMs: t1 - t0, parseMs: performance.now() - t1 })
    } else if (data.type === 'clip') {
      if (!demo) throw new Error('no demo loaded')
      post({ type: 'clip', id: data.id, json: demo.clip(JSON.stringify(data.request)) })
    }
  } catch (e) {
    post({ type: 'error', id: data.type === 'clip' ? data.id : undefined, message: String((e as Error)?.message ?? e) })
  }
}
