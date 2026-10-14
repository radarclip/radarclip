# packages

TypeScript packages (pnpm workspace):

- `format` — `@radarclip/format`: types, `readClip`/`writeClip` (.radarclip / .radarclip.json),
  `decode` into per-frame arrays, `stateAt` interpolation. Tested against the Rust reference
  decoder output in `spec/fixtures/*.frames.json`.
- `player` — `@radarclip/player`: `RadarclipPlayer` (canvas) and the `<radarclip-player>` element.
  `www/` is a test page; `scripts/local-radars.mjs` fills `www/radars/` from locally cached radars.

- `radars` — `@radarclip/radars`: overview transforms (position, scale, floor split) for every
  map with a radar, and image URLs. Images are Valve's and are not shipped: they load at runtime
  from a configurable base (default: MurkyYT/cs2-map-icons, which extracts them from the game).
  `pnpm --filter @radarclip/radars update` refreshes the numbers.
