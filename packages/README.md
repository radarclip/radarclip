# packages

TypeScript packages (pnpm workspace):

- `format` — `@radarclip/format`: types, `readClip`/`writeClip` (.radarclip / .radarclip.json),
  `decode` into per-frame arrays, `stateAt` interpolation. Tested against the Rust reference
  decoder output in `spec/fixtures/*.frames.json`.
- `player` — `@radarclip/player`: `RadarclipPlayer` (canvas) and the `<radarclip-player>` element.
  `www/` is a test page; `scripts/local-radars.mjs` fills `www/radars/` from locally cached radars.

Planned: `radars` — hosted radar images and overview transforms, looked up by map name.
