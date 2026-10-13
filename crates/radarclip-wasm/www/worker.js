// Parses the demo off the main thread. The file is read in 16 MB slices straight into wasm
// memory, so the page never holds a second full copy, and nothing leaves the machine.
import init, { DemoLoader } from '../pkg/radarclip_wasm.js';

const ready = init();
const CHUNK = 16 << 20;
let demo = null;

onmessage = async ({ data }) => {
  await ready;
  try {
    if (data.type === 'open') {
      const { file } = data;
      demo?.free();
      demo = null;
      const t0 = performance.now();
      const loader = new DemoLoader(file.size);
      for (let off = 0; off < file.size; off += CHUNK) {
        loader.push(new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer()));
        postMessage({ type: 'progress', loaded: Math.min(off + CHUNK, file.size), size: file.size });
      }
      const t1 = performance.now();
      demo = loader.finish();
      postMessage({ type: 'info', info: JSON.parse(demo.info()), readMs: t1 - t0, parseMs: performance.now() - t1 });
    } else if (data.type === 'clip') {
      const t0 = performance.now();
      const json = demo.clip(JSON.stringify(data.request));
      postMessage({ type: 'clip', request: data.request, json, ms: performance.now() - t0 });
    }
  } catch (e) {
    postMessage({ type: 'error', message: String(e?.message ?? e) });
  }
};
