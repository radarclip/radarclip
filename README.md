# radarclip

Compact top-down replay clips of Counter-Strike 2 moments.

A demo is 200–350 MB and needs a full viewer. A radarclip holds only what a 2D view needs
(players, utility, shots, kills, bomb) for the seconds that matter: a 20 s clip is ~2 KB
compressed, a whole round ~8 KB. Small enough to keep, embed in a page, or send to your team.

- **Format:** [`spec/radarclip-1.md`](spec/radarclip-1.md), JSON Schema and reference clips in [`spec/`](spec).
- **Rust:** `radarclip-core` (format, encoder, decoder), `radarclip-parser` (CS2 demo → clips, on
  [demoparser2](https://github.com/LaihoE/demoparser)'s parser), `radarclip-cli`.
- **Planned:** WebAssembly build for parsing in the browser (demos never leave the machine),
  Python bindings, a canvas player (`packages/`).

## CLI

```bash
make build
target/release/radarclip info match.dem
target/release/radarclip clip match.dem -r 7 --from 45 --to 65 --mark "59.7=kill at Shop" -o r7.radarclip
```

Times are seconds after the round's freeze end (round time 1:55 = 0). `.radarclip` is raw
deflate, `.radarclip.json` readable JSON. `--anonymize` replaces player names.

## Develop

Rust via [rustup](https://rustup.rs) with the `wasm32-unknown-unknown` target, and
[uv](https://docs.astral.sh/uv/) for the schema check. The parser builds on a pinned commit of
our demoparser fork, [radarclip/demoparser](https://github.com/radarclip/demoparser) (branch
`radarclip`: wasm32 and protoc fixes).

```bash
make check   # tests, schema check of the fixtures, wasm build check
```

## Inspiration

Ideas, no code: [zenojunior/cs2d](https://github.com/zenojunior/cs2d),
[sparkoo/csgo-2d-demo-viewer](https://github.com/sparkoo/csgo-2d-demo-viewer),
[linus4/csgoverview](https://github.com/linus4/csgoverview), and game netcode (delta compression,
quantisation, snapshot interpolation).

## License

MIT
