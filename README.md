# radarclip

Compact top-down replay clips of Counter-Strike 2 moments.

A demo is 200–350 MB and needs a full viewer. A radarclip holds only what a 2D view needs
(players, utility, shots, kills, bomb) for the seconds that matter: a 20 s clip is ~3–4 KB,
a whole round ~10 KB, a whole match ~200 KB. Small enough to keep, embed in a page, or send to
your team.

| What | Size |
| --- | --- |
| CS2 demo of one match (`.dem`) | 200–340 MB |
| Whole match, every round (`.radarclip-match`) | 170–265 KB |
| One round (`.radarclip`) | 6–16 KB |
| A 20 s moment (`.radarclip`) | 3–4.5 KB |

Measured on eight 5v5 competitive matches (17–29 rounds, 64 tick), default settings (8 frames a
second), files as written by `radarclip match` and `radarclip clip`. A match file is about
1/1200 of its demo:

| Map | Rounds | Demo | Match | Demo ÷ match |
| --- | ---: | ---: | ---: | ---: |
| Nuke | 24 | 293.0 MB | 248.5 KB | 1179× |
| Inferno | 23 | 294.4 MB | 208.4 KB | 1413× |
| Cache | 29 | 342.2 MB | 265.0 KB | 1292× |
| Cache | 24 | 254.0 MB | 222.0 KB | 1144× |
| Anubis | 19 | 223.3 MB | 167.2 KB | 1336× |
| Mirage | 18 | 211.0 MB | 188.8 KB | 1118× |
| Ancient | 19 | 210.9 MB | 179.7 KB | 1174× |
| Mirage | 17 | 199.3 MB | 180.7 KB | 1103× |

For comparison, `gzip -9` gets the 293 MB Nuke demo only down to 203 MB.

- **Format:** [`spec/radarclip-1.md`](spec/radarclip-1.md), JSON Schema and reference clips in [`spec/`](spec).
- **Rust:** `radarclip-core` (format, encoder, decoder), `radarclip-parser` (CS2 demo → clips, on
  [demoparser2](https://github.com/LaihoE/demoparser)'s parser), `radarclip-cli`.
- **WebAssembly:** `radarclip-wasm` parses demos in the browser; demos never leave the machine.
- **TypeScript:** `@radarclip/format` (read/write, decode, interpolate), `@radarclip/player` (the
  bare canvas viewer, no UI) and `@radarclip/controls` (playback controls that connect to it).
- **Viewer:** [radarclip.github.io/radarclip](https://radarclip.github.io/radarclip/) — drop a demo,
  watch every round. Parsed in your browser, never uploaded (`apps/viewer`).
- **Radars:** `@radarclip/radars` knows every map's overview transform and where to load its radar.
- **Navigation:** `@radarclip/nav` reads a map's navigation mesh: the area under a position,
  walking routes and the fastest time between two spots, callouts per area learned from demos.
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

Kill-feed icons are the game's own, loaded from jsDelivr. To serve them yourself, copy
counter-strike-icons' `cs2/panorama/images/` (`icons/equipment/`, `hud/deathnotice/`) and set
`RadarclipPlayer.iconResolver = gameIcons('https://your.host/cs2-icons/')`; `false` draws
names and radarclip's own symbols instead.
The kill feed shows the game's own weapon and kill icons, loaded at runtime from the
[counter-strike-icons](https://github.com/Juknum/counter-strike-icons) project's copies of the game
files (Valve's artwork, not part of this repo); pass `icon: (name) => url` to host them yourself, or
`icon: false` for weapon names and radarclip's drawn symbols.

## CLI

```bash
make build
target/release/radarclip info match.dem
target/release/radarclip clip match.dem -r 7 --from 45 --to 65 --mark "59.7=kill at Shop" -o r7.radarclip
target/release/radarclip match match.dem -o match.radarclip-match   # every round: ~250 KB for a 300 MB demo
```

Times are seconds after the round's freeze end (round time 1:55 = 0). `.radarclip` is raw
deflate, `.radarclip.json` readable JSON. `--anonymize` replaces player names. Demos may be
plain, `.dem.bz2` or `.dem.zst`. A whole match is [`radarclip-match/1`](spec/radarclip-match-1.md): every round as a
clip, to reopen and cut moments from without the demo.

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
