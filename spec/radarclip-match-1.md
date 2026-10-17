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

## Detail

`rounds[].detail` (optional) holds what a replay doesn't have to draw but an analysis or a HUD can
use. It lives next to the clip, not in it, so moments cut from a round stay as small as before.

```jsonc
"detail": {
  "gear": [["AK-47", "Flashbang", "Flashbang", "Glock-18", "knife_t"], …],  // loadouts by index
  "players": [                       // one per clip player, same order
    {"gear":   [0, 3, 412, 7],       // change list: index into gear
     "money":  [0, 3600, 2, 950],    // change list: money in the bank
     "equip":  [0, 4900],            // change list: value of what the player carries
     "helmet": [0, 1],               // change list: 0 or 1
     "kit":    [0, 0],               // change list: defuse kit, 0 or 1
     "seen":   [0, 0, 236, 96, 250, 0]}  // change list: bit mask of clip players who see them
  ],
  "defuses": [{"t": 7114, "by": 3, "kit": false, "end": 7754, "done": true}],
  "kills": [{"t": 2693, "victim": 7, "attacker": 2, "at": [733, 107, 1612, -170], "from": [-496, 27, 1664, 4]}],
  "hits":  [{"t": 2481, "victim": 7, "attacker": 2, "at": [765, 180, 1612, -173], "from": [-512, 36, 1664, 6]}]
}
```

- Change lists use the round clip's frames, as in clip tracks. A value holds while the player is
  dead, so money and loadout at death stay readable.
- `gear` lists item names as the game calls them, sorted; a second flashbang appears twice. The
  bomb is `C4 Explosive`; knives keep their skin's name.
- `seen` comes from the game's own spotting (`m_bSpottedByMask`): bit `i` is set while
  `clip.players[i]` has the player in sight. It only covers enemies and is approximate, like the
  radar in the game.
- `defuses` lists every attempt in ticks after freeze end, from the start until it was finished
  (`done`), stopped, or ended by the defuser's death, the explosion or the round end. With a kit
  a defuse takes 5 s, without 10 s, so `end - t` shows how far a stopped attempt got.
- `kills` and `hits` repeat every kill and hit with both players exactly where they were at that
  tick, from the game event: `at` is the victim's `[x, y, z, yaw]`, `from` the attacker's (absent
  for world damage), in game units and whole degrees. Clip frames are sampled every few ticks,
  so a fast turn just before a hit can fall between two frames; these values don't.

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
