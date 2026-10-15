# radarclip-match/1

A whole parsed match: every round as a full-round [radarclip/1](radarclip-1.md) clip, plus who
played. Apps store it (for example in the browser) to reopen a match instantly and cut moments
out of it without the demo. A 24-round match is about 250 KB, 1/1000 of the demo.

[`radarclip-match-1.schema.json`](radarclip-match-1.schema.json) checks the structure;
[`fixtures/nuke-r1-2.radarclip-match.json`](fixtures/nuke-r1-2.radarclip-match.json) is a
two-round reference file (names and ids anonymised).

## Files

| Form | Extension | Media type |
|---|---|---|
| Readable JSON (UTF-8) | `.radarclip-match.json` | `application/vnd.radarclip-match+json` |
| Raw deflate (RFC 1951) of the same JSON | `.radarclip-match` | `application/vnd.radarclip-match` |

## Structure

```jsonc
{
  "format": "radarclip-match/1",
  "map": "de_nuke",
  "tickrate": 64,
  "parser": "radarclip 0.1.0",            // what made it; optional
  "players": [{"key": "7656119…", "name": "…"}],
  "rounds": [
    {"number": 1, "seconds": 82.4, "winner": "CT",
     "keys": ["7656119…", …],              // one per clip player, same order
     "clip": { "format": "radarclip/1", … }}
  ]
}
```

- `players[].key` is the Steam64 id, or the name when the demo has none. It is how apps follow
  one player across rounds; `rounds[].keys` maps each clip player to it.
- `rounds[].clip` covers the whole round, from freeze end to a few seconds after the round end,
  with the encoder's default quantisation and tolerance, no focus and no marks.
- `parser` lets an app tell a file from an older parser apart and offer to parse the demo again
  for details it has learned since (new optional clip fields, for example).

## Cutting a moment

A moment cut out of a stored round follows the same rules as one cut from the demo: frames from
the first at or after the start; kills, a plant and smokes or fires still burning from earlier in
the round stay; hurts, blinds, pops, shots and grenade flights only inside the window. Tracks are
re-encoded from the decoded frames with a 1-unit / 1° tolerance, so positions stay within a unit
of the stored round. The reference implementation is `radarclip_core::cut`, in the browser
`cutClip()` from `radarclip-wasm`.

## Versioning

`format` is `"radarclip-match/<major>"`, with the same rule as clips: within a major version the
container only grows, and readers ignore fields they don't know.

Each round's clip carries its own `format`. A reader reads every round's clip like a single
clip, so a match stays readable as long as its clips are: within `radarclip/1` that is always,
and a future `radarclip/2` reader must keep reading (or upgrading) `radarclip/1` clips, inside a
match as well as on their own.
