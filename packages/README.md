# packages

TypeScript packages (pnpm workspace):

- `format` — `@radarclip/format`: types, `readClip`/`writeClip` (.radarclip / .radarclip.json),
  `decode` into per-frame arrays, `stateAt` interpolation. Tested against the Rust reference
  decoder output in `spec/fixtures/*.frames.json`.
- `player` — `@radarclip/player`: the bare viewer. `RadarclipPlayer` (canvas + API) and the
  `<radarclip-player>` element, no buttons; events are re-dispatched as `radarclip:*` DOM events.
  `www/` is a test page; `scripts/local-radars.mjs` fills `www/radars/` from locally cached radars.
- `controls` — `@radarclip/controls`: `<radarclip-controls for="player-id">`, play/pause,
  timeline with marks, speed, floor, zoom and keyboard, connected through the player's API.

- `radars` — `@radarclip/radars`: overview transforms (position, scale, floor split) for every
  map with a radar, and image URLs. Images are Valve's and are not shipped: they load at runtime
  from a configurable base (default: MurkyYT/cs2-map-icons, which extracts them from the game).
  `pnpm --filter @radarclip/radars update` refreshes the numbers.
- `nav` — `@radarclip/nav`: navigation meshes. Reads a map's `.nav` file, finds the area under a
  point, walking routes and distances (ladders, jumps and drops included), and names areas after
  the callouts players had on them in demos. The `.nav` files are Valve's and are not shipped;
  awpy-data publishes them per game version.
