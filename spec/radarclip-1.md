# radarclip/1

A radarclip is a short top-down replay of one moment of a Counter-Strike 2 round: players,
utility, shots and kills, drawn on the map's radar. It holds only what a 2D view needs, so a
20 s clip is ~2 KB compressed instead of a 200+ MB demo.

This document is the format's single source of truth. The JSON Schema
[`radarclip-1.schema.json`](radarclip-1.schema.json) checks the structure;
[`fixtures/`](fixtures) holds reference clips every implementation must read.

## Files

| Form | Extension | Media type |
|---|---|---|
| Readable JSON (UTF-8) | `.radarclip.json` | `application/vnd.radarclip+json` |
| Raw deflate (RFC 1951) of the same JSON | `.radarclip` | `application/vnd.radarclip` |

Browsers decode `.radarclip` with `new DecompressionStream("deflate-raw")`.

## Versioning

`format` is `"radarclip/<major>"`. Within a major version the format only grows:

- New fields and event types are optional. Readers **must ignore** fields and event types they
  don't know, and a clip without them still plays.
- Renaming or removing a field, or changing a unit, needs the next major version.

## Conventions

- **Time** is counted in game **ticks** after the round's freeze end (round time 1:55 = tick 0).
  `tickrate` converts ticks to seconds.
- **Positions** in events and grenade paths are world units, rounded to integers. Player
  tracks are quantised (see `quant`).
- **Players** are referenced by their index in `players`. Clips carry no Steam IDs.
- **Δ-coded arrays** store the difference to the previous element; the first element is the
  difference to 0. Decode with a running sum.
- **Change lists** are flat `[frame, value, frame, value, …]` with absolute frame indices; a value
  holds until the next change. `-1` means "none".

## Top level

```jsonc
{
  "format": "radarclip/1",
  "map": "de_ancient",
  "title": "",                 // optional, free text
  "round": 7,                  // 1-based round number in the match
  "winner": "CT",              // "CT" | "T" | null
  "tickrate": 64,
  "start": 2880,               // tick of frame 0
  "step": 8,                   // ticks between frames
  "frames": 161,               // frame f is at tick start + f * step
  "quant": {"xy": 4, "z": 8, "yaw": 2},
  "focus": [0],                // players to keep in view; the first is "me"
  "marks": [{"t": 3821, "label": "kill at Shop"}],  // the player opens at the first mark
  "places": ["BombsiteA", "CTSpawn"],               // map place names, by index
  "weapons": ["AK-47", "knife"],                    // active weapon names, by index
  "players": [ … ],
  "events": [ … ],
  "nades": [ … ],
  "shots": { … }
}
```

## Players

```jsonc
{
  "name": "s1mple",
  "side": "CT",                // "CT" | "T"
  "track": {
    "alive": [0, 118],         // frames where the player becomes alive / dead / alive …; starts dead
    "k":   [0, 3, 2, …],       // Δ keyframe frame indices
    "x":   [-302, -7, …],      // Δ x / quant.xy
    "y":   [-280, 1, …],       // Δ y / quant.xy
    "z":   [0, -1, …],         // Δ z / quant.z
    "yaw": [-68, 3, …],        // Δ yaw / quant.yaw, each step wrapped to the shortest turn
    "hp":     [0, 100, 57, 73],      // change list: health
    "armor":  [0, 100],              // change list: armour
    "weapon": [0, 1, 40, 0],         // change list: index into `weapons`
    "place":  [0, 5, 12, 0]          // change list: index into `places`
  }
}
```

Keyframes lie inside alive spans; every span starts and ends with one. Between two keyframes of
the same span, x/y/z are linearly interpolated and yaw turns the short way round. Encoders
drop frames that interpolation reproduces within a tolerance (the reference encoder: 8 units,
6°), so a player who stands still or runs straight costs almost nothing.

Decoding a yaw: `yaw_deg = wrap(Σ yaw * quant.yaw)` with `wrap` into [-180, 180).

## Events

Sorted by `t`. Player fields are indices into `players`; a missing field means "unknown" (e.g.
world damage, a player not in the clip).

| `type` | Fields |
|---|---|
| `kill` | `attacker`, `victim`, `weapon`, `hs` (headshot), `x`, `y`, `z` (victim) |
| `hurt` | `attacker`, `victim`, `dmg`, `weapon` |
| `blind` | `victim`, `by`, `until` |
| `smoke`, `molotov` | `by`, `until`, `x`, `y`, `z` |
| `flash`, `he` | `by`, `x`, `y`, `z` |
| `plant` | `by`, `x`, `y`, `z` |
| `defuse`, `explode` | `by` |

Kills from earlier in the round are included so the map can show them. Smokes and fires still
burning and a bomb planted before the clip starts are included too.

## Nades

```jsonc
{"type": "smoke", "by": 3, "path": [2911, -217, 1682, 135, 4, 8, -9, 10, …]}
```

`type` is `smoke` | `flash` | `he` | `molotov` | `decoy`. `path` is Δ-coded `[t, x, y, z]`
quadruples of the projectile's flight.

## Shots

```jsonc
{"t": [3001, 8, 7, …], "p": [0, 0, 4, …], "yaw": [-68, -67, 91, …]}
```

Every bullet fired (no grenades, knife or C4): `t` Δ-coded, `p` the shooter, `yaw` the aim in
whole degrees. The shooter's position comes from their track at `t`.

## Radar

Clips name their `map`; the player looks up the radar image and overview transform
(`pos_x`, `pos_y`, `scale`, optional lower floor) by map name. Self-contained pages may add an
optional inline `"radar"` object with the same fields plus `image` (data URL).
