import type { NavMesh, Point } from './mesh.js'

/** Neighbouring areas further apart in height than this are on different floors. */
const SAME_FLOOR = 48

/** Where a player stood and the callout the game showed for it (`last_place_name`). */
export interface PlaceSample extends Point {
  place: string
}

/**
 * Names every area after the callout players had while standing on it. CS2's nav files carry no
 * callouts, but every demo does, so a match or two labels most of a map. Areas nobody stood on
 * take the name of a labelled area up to `spread` links away on the same floor (a step apart in
 * height at most); further out they stay unnamed, so a name doesn't drop through a hatch or run
 * up a staircase onto another floor. "BombsiteA" and "BombsiteB" give the sites.
 */
export function labelAreas(nav: NavMesh, samples: Iterable<PlaceSample>, spread = 3): Map<number, string> {
  const votes = new Map<number, Map<string, number>>()
  for (const s of samples) {
    if (!s.place) continue
    const a = nav.areaAt(s, 64)
    if (!a) continue
    const v = votes.get(a.id) ?? new Map<string, number>()
    v.set(s.place, (v.get(s.place) ?? 0) + 1)
    votes.set(a.id, v)
  }
  const labels = new Map<number, string>()
  for (const [id, v] of votes) labels.set(id, [...v].reduce((a, b) => (b[1] > a[1] ? b : a))[0])

  // Fill the rest outwards from what was seen, ignoring one-way drops.
  const height = new Map(nav.areas.map(a => [a.id, a.corners.reduce((z, c) => z + c[2], 0) / a.corners.length]))
  const around = new Map<number, number[]>(nav.areas.map(a => [a.id, []]))
  for (const a of nav.areas) {
    for (const b of nav.neighbours(a.id)) {
      around.get(a.id)!.push(b)
      around.get(b)?.push(a.id)
    }
  }
  let front = [...labels.keys()]
  for (let hop = 0; hop < spread && front.length; hop++) {
    const next: number[] = []
    for (const id of front) {
      for (const b of around.get(id) ?? []) {
        if (labels.has(b) || Math.abs(height.get(b)! - height.get(id)!) > SAME_FLOOR) continue
        labels.set(b, labels.get(id)!)
        next.push(b)
      }
    }
    front = next
  }
  return labels
}

/** Ids of the areas carrying a callout, e.g. `areasNamed(labels, 'BombsiteB')`. */
export function areasNamed(labels: Map<number, string>, place: string): number[] {
  return [...labels].filter(([, p]) => p === place).map(([id]) => id)
}
