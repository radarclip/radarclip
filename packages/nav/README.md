# @radarclip/nav

CS2 navigation meshes: which area a position is on, how areas connect, the shortest walk between
two points, and the callouts that go with each area.

```ts
import { parseNav, labelAreas, areasNamed, RUN_SPEED } from '@radarclip/nav'

const nav = parseNav(await (await fetch('/game/nav/de_mirage.nav')).arrayBuffer())

// Callouts: CS2's nav files have none, but every demo does (`last_place_name`).
const labels = labelAreas(nav, samples) // samples: {x, y, z, place} from one or more matches
const siteB = areasNamed(labels, 'BombsiteB')

const r = nav.route(player, siteB)      // ends where the walk first enters the site
if (r) console.log(`${(r.length / RUN_SPEED).toFixed(1)} s at the earliest`)
```

- `parseNav(bytes)` reads a `.nav` file (versions 31–36; the game ships 36) into a `NavMesh`.
- `nav.areaAt(point)`: the area under a point. Points just off the mesh (boxes, wall edges)
  still count; on stacked floors the area nearest in height wins.
- `nav.route(from, to)`: to a point or to the nearest of a set of areas. The line cuts corners
  like a player does (string pulling through the doorways between areas), climbs ladders, and
  takes jumps onto boxes and drops off ledges the mesh itself leaves unlinked (never through a
  floor: on Nuke, A sits right above B).
- `RUN_SPEED` is 250 units/s, the top speed with the knife out, so `length / RUN_SPEED` is the
  fastest anyone can get there. Rifles run at 215–225, the AWP at 200.
- `labelAreas(nav, samples)` names each area after the callout players had on it (majority) and
  fills the areas nobody stood on from neighbours on the same floor, a few links out at most.

## Map files

The `.nav` files are Valve's and are not shipped here. [awpy-data](https://github.com/pnxenopoulos/awpy-data)
publishes them per game version as GitHub releases (`navs.zip`, about 8 MB for every map). An
app copies the maps it needs next to its other game artwork and fetches them from there.

## How close it gets

Measured on 8 matches (Mirage, Nuke, Inferno, Ancient, Anubis, Cache):

- Every sampled player position finds an area (Nuke: 99.8%).
- Callouts learned from half the samples match the game's own for 94–97% of the rest.
- On 3-second runs, route length ÷ distance actually walked has a median of 0.99 (10th–90th
  percentile 0.94–1.16).
- As a lower bound it holds: of 20,000 trips to a bomb site, 99.6% took at least the route's
  time at `RUN_SPEED` (Anubis 97.7%, where some shortcut is still missing).
- A route takes about 0.1 ms; reading a map 40–130 ms.

Not modelled: doors, breakable walls and vents, boosts onto teammates, jump-throws and anything
else a player does beyond running, jumping, dropping and climbing.
