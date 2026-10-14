# radarclip

Compact top-down replay clips of Counter-Strike 2 moments.

A demo is 200–350 MB and needs a full viewer. A radarclip holds only what a 2D view needs
(players, utility, shots, kills, bomb) for the seconds that matter: a 20 s clip is ~2 KB
compressed, a whole round ~8 KB. Small enough to keep, embed in a page, or send to your team.

- **Format:** [`spec/radarclip-1.md`](spec/radarclip-1.md), JSON Schema and reference clips in [`spec/`](spec).
- **Rust:** `radarclip-core` (format, encoder, decoder), `radarclip-parser` (CS2 demo → clips, on
  [demoparser2](https://github.com/LaihoE/demoparser)'s parser), `radarclip-cli`.
- **WebAssembly:** `radarclip-wasm` parses demos in the browser; demos never leave the machine.
- **TypeScript:** `@radarclip/format` (read/write, decode, interpolate), `@radarclip/player` (the
  bare canvas viewer, no UI) and `@radarclip/controls` (playback controls that connect to it).
- **Viewer:** [radarclip.github.io/radarclip](https://radarclip.github.io/radarclip/) — drop a demo,
  watch every round. Parsed in your browser, never uploaded (`apps/viewer`).
- **Radars:** `@radarclip/radars` knows every map's overview transform and where to load its radar.
- **Planned:** Python bindings.

## Player

```html
<radarclip-player id="p" src="r7.radarclip"></radarclip-player>
<radarclip-controls for="p"></radarclip-controls>   <!-- optional -->
<script type="module">
  import { RadarclipPlayer } from '@radarclip/player'
  import '@radarclip/controls'
  import { radars } from '@radarclip/radars'
  RadarclipPlayer.radarResolver = radars()   // or radars('https://your.host/radars')
</script>
```

Or drive a canvas yourself: `const p = new RadarclipPlayer(canvas, { radar }); await p.load(clip);
p.play(); p.seek(59.7); p.on('time', …); await p.toBlob()`. Without a radar it draws on a plain
background. Colours via `--radarclip-ct`, `-t`, `-me`, `-bg`, `-fg`, `-muted`.

## CLI

```bash
make build
target/release/radarclip info match.dem
target/release/radarclip clip match.dem -r 7 --from 45 --to 65 --mark "59.7=kill at Shop" -o r7.radarclip
```

Times are seconds after the round's freeze end (round time 1:55 = 0). `.radarclip` is raw
deflate, `.radarclip.json` readable JSON. `--anonymize` replaces player names. Demos may be
plain, `.dem.bz2` or `.dem.zst`.

## Browser

```js
import init, { DemoLoader } from './pkg/radarclip_wasm.js';
await init();
const loader = new DemoLoader(file.size);          // stream the file in slices
for (let off = 0; off < file.size; off += 16 << 20)
  loader.push(new Uint8Array(await file.slice(off, off + (16 << 20)).arrayBuffer()));
const demo = loader.finish();                      // parse (run this in a Web Worker)
JSON.parse(demo.info());                           // map, rounds, players
demo.clip(JSON.stringify({ round: 7, from: 45, to: 65, focus: ['7656…'], anonymize: true }));
```

`make serve` builds the wasm package and serves a test page on http://localhost:8765/www/.
A 342 MB demo parses in ~8 s in Chrome (wasm SIMD) and needs ~650 MB of memory; clips are then
cut in a few milliseconds.

## Develop

Rust via [rustup](https://rustup.rs) with the `wasm32-unknown-unknown` target,
`cargo install wasm-bindgen-cli --version 0.2.129` for the browser build, and
[uv](https://docs.astral.sh/uv/) for the schema check. The parser builds on a pinned commit of
our demoparser fork, [radarclip/demoparser](https://github.com/radarclip/demoparser) (branch
`radarclip`: wasm32 and protoc fixes).

```bash
make check   # Rust + TypeScript tests, schema check of the fixtures, wasm build check
make player-serve   # player test page with the reference clips
make viewer-serve   # demo viewer on http://localhost:8767
```

Node 22+ and pnpm for the TypeScript packages.

## Inspiration

Ideas, no code: [zenojunior/cs2d](https://github.com/zenojunior/cs2d),
[sparkoo/csgo-2d-demo-viewer](https://github.com/sparkoo/csgo-2d-demo-viewer),
[linus4/csgoverview](https://github.com/linus4/csgoverview), and game netcode (delta compression,
quantisation, snapshot interpolation).

## License

MIT
