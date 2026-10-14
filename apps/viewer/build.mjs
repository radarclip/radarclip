// Bundles the viewer into dist/ (static site): page, app, parser worker and the wasm parser.
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const dist = join(here, 'dist')
const pkg = join(here, '../../crates/radarclip-wasm/pkg')
if (!existsSync(join(pkg, 'radarclip_wasm_bg.wasm'))) {
  console.error('missing crates/radarclip-wasm/pkg: run `make wasm` first')
  process.exit(1)
}
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist)
await build({
  entryPoints: { app: join(here, 'src/main.ts'), worker: join(here, 'src/worker.ts') },
  bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: true, outdir: dist,
  loader: { '.wasm': 'file' },
})
copyFileSync(join(pkg, 'radarclip_wasm_bg.wasm'), join(dist, 'radarclip_wasm_bg.wasm'))
copyFileSync(join(here, 'index.html'), join(dist, 'index.html'))
console.log(`viewer → ${dist}`)
