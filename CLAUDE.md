# radarclip: notes for agents

The README covers what the project is and how to use it. This file holds what isn't obvious
from it: checks, the parser fork, quirks of the demo data, format rules and pitfalls that cost
time before.

## Checks

- `make check` is the full gate: Rust tests, TypeScript tests and typecheck, schema check of the
  reference files, wasm build check. Cargo lives in `~/.cargo/bin` (the Makefile finds it).
- `make wasm` rebuilds `crates/radarclip-wasm/pkg` (the viewer and the private site load it);
  `pnpm build` rebuilds the TypeScript packages' `dist/`.

## The demoparser fork

The parser is `radarclip/demoparser` (branch `radarclip`), pinned by commit in `Cargo.toml`.
To change it:

1. Commit in the sibling checkout `../demoparser` on branch `radarclip`, push to its `fork` remote.
2. Bump `rev` in `Cargo.toml` and both `source` lines in `Cargo.lock`.

To build against an unpushed fork commit, pass
`--config 'patch."https://github.com/radarclip/demoparser".parser.path="../demoparser/src/parser"'`
to cargo (the original `rev` must still resolve), then `git checkout Cargo.lock`, which the
override rewrites.

## Demo data quirks

- Asking for game events empties the per-tick table, so `Match::parse` runs three passes
  (events, players every 4 ticks, grenades).
- Grenade events carry their position as lowercase `x/y/z`; player events as `user_X/Y/Z`.
- `dmg_health` can exceed the health the victim had (an AWP on 20 HP reports 115): cap it.
- `player_blind` events share the flash pop's tick and include team and self flashes.
- A grenade entity outlives its flight (a smoke until it fades): the flight ends at the last
  sample where it still moved.
- Kill details (assister, flash assist, wallbang, no-scope, smoke, blind) come from
  `player_death`; demoparser2 in Python gives the same counts and is a handy cross-check.

## Format rules

- `radarclip/1` and `radarclip-match/1` only grow: new fields are optional and left out when
  they don't apply (`skip_serializing_if`). Renaming or removing needs the next major version,
  and a `radarclip/2` reader must keep reading `/1`, also inside match files.
- A format change touches all of: `spec/*.md`, `spec/*.schema.json`, `crates/radarclip-core`,
  `packages/format/src/types.ts`, the reference files in `spec/fixtures/`, and a test.
- Regenerate reference files with the CLI and `--anonymize` (and `--focus <steamid>` where a
  focus is wanted); never commit a real Steam id, real names or local profile paths.
  `radarclip decode <clip>` rewrites the matching `*.frames.json`.

## Player pitfalls

- A canvas gradient throws on a non-finite position, and one throw blanks the whole frame (and
  stops playback): guard positions before drawing.
- Animation-frame timestamps can be older than the moment `play()` ran: never step back.
- `packages/player/test` renders on a fake canvas: stub every new context method there.
- Valve artwork (radar images, weapon and kill icons) is never committed. It loads at runtime
  from pinned jsDelivr commits and always has a fallback (plain background, weapon name, drawn
  symbol).

## Workflow

- GitButler (`but`) for every write; one branch and PR per change. Stacked PRs merge bottom-up
  only through `gh api -X PUT repos/radarclip/radarclip/pulls/<n>/merge-async -f
  merge_method=merge -f merge_action=direct_merge`; retry when a base change cancels it.
- After `but pull`, check that `git log HEAD` sits on `origin/main`: once it silently kept the
  workspace on an older base.
- PRs that change the public API (package exports and options, Rust and wasm interfaces, the
  CLI, the spec) wait for the owner's review. Others are merged once the owner has tested them.

## Checking visuals

Screenshots with headless Chrome work for the player (serve the repo root, load a fixture,
seek, screenshot). Use a fresh `--user-data-dir` per run, or it serves stale files.
`--dump-dom` fires before module scripts finish, and large fetches and Web Workers don't finish
within `--virtual-time-budget`: test the wasm path in Node instead (init the pkg with the
`.wasm` bytes).
