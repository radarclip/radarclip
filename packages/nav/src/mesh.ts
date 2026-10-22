export type Vec3 = [number, number, number]
type Vec2 = [number, number]

export interface Point {
  x: number
  y: number
  z: number
}

export interface NavArea {
  id: number
  /** The walkable polygon, in world units. */
  corners: Vec3[]
  /** Areas this one leads to, and through which of its edges (corner `edge` to `edge + 1`). */
  links: { to: number; edge: number }[]
}

/** A ladder and the areas at its ends. Ids that match no area are ignored. */
export interface Ladder {
  top: Vec3
  bottom: Vec3
  length: number
  topAreas: number[]
  bottomAreas: number[]
}

export interface Route {
  /** Area ids from start to end. */
  areas: number[]
  /** The walked line, cutting corners like a player does. */
  points: Vec2[]
  /** Ground distance along `points` plus any ladder climbed, in world units. */
  length: number
}

/** Walking distances from anywhere on the mesh to one goal, worked out once. */
export interface DistanceField {
  /**
   * The walk from `p` to the goal in world units, close to `route(p, goal).length` (a few percent
   * shorter, mostly: a straighter way); undefined when `p` is off the mesh or no way leads from it
   * to the goal.
   */
  at(p: Point): number | undefined
}

/**
 * The game's top running speed with the knife out, in units per second. Rifles run at 215–225,
 * the AWP at 200. `route.length / RUN_SPEED` is the fastest someone can get there.
 */
export const RUN_SPEED = 250

const CELL = 256
/**
 * Height steps for implicit links: below STEP players just walk up (the mesh links those, so an
 * unlinked pair at the same height is a wall or fence); up to JUMP with a crouch jump; down to
 * DROP without real harm.
 */
const STEP = 18
const JUMP = 66
const DROP = 250
/** Areas this close (ground plane) but unlinked count as a jump or drop apart. */
const GAP = 20
/** Most room between two spots of a doorway in `distancesTo`. */
const DOOR_STEP = 64

/** A map's walkable areas, how they connect, and routes through them. */
export class NavMesh {
  readonly areas: readonly NavArea[]
  private index = new Map<number, number>()
  private cx: Float64Array
  private cy: Float64Array
  private zmin: Float64Array
  private zmax: Float64Array
  /** Links by area index; `spot` marks a ladder or jump, `climb` the ladder's length. */
  private out: { to: number; edge: number; w: number; spot?: Vec2; climb?: number }[][]
  /** Ground-plane bounds by area index: x0, y0, x1, y1. */
  private box: Float64Array
  private cells = new Map<number, number[]>()
  /** Marks areas already looked at in `locate`, by the call's number. */
  private seen: Uint32Array
  private visit = 0
  private doors?: Doors

  constructor(areas: NavArea[], readonly ladders: readonly Ladder[] = []) {
    this.areas = areas
    const n = areas.length
    this.cx = new Float64Array(n)
    this.cy = new Float64Array(n)
    this.zmin = new Float64Array(n).fill(Infinity)
    this.zmax = new Float64Array(n).fill(-Infinity)
    this.box = new Float64Array(4 * n)
    this.seen = new Uint32Array(n)
    areas.forEach((a, i) => {
      this.index.set(a.id, i)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [x, y, z] of a.corners) {
        this.cx[i] += x / a.corners.length
        this.cy[i] += y / a.corners.length
        this.zmin[i] = Math.min(this.zmin[i], z)
        this.zmax[i] = Math.max(this.zmax[i], z)
        x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y)
      }
      this.box.set([x0, y0, x1, y1], 4 * i)
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
        for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
          const k = cellKey(gx, gy), list = this.cells.get(k)
          if (list) list.push(i)
          else this.cells.set(k, [i])
        }
      }
    })
    this.out = areas.map((a, i) => {
      const seen = new Set<number>(), links = []
      for (const l of a.links) {
        const j = this.index.get(l.to)
        if (j === undefined || j === i || seen.has(j)) continue
        seen.add(j)
        links.push({ to: j, edge: l.edge, w: Math.hypot(this.cx[j] - this.cx[i], this.cy[j] - this.cy[i]) })
      }
      return links
    })
    for (const ladder of ladders) {
      const x = (ladder.top[0] + ladder.bottom[0]) / 2, y = (ladder.top[1] + ladder.bottom[1]) / 2
      const ends = (ids: number[]) => ids.map(id => this.index.get(id)).filter(i => i !== undefined)
      const tops = ends(ladder.topAreas), bottoms = ends(ladder.bottomAreas)
      const link = (a: number, b: number) => {
        if (this.out[a].some(l => l.to === b)) return
        const w = Math.hypot(this.cx[a] - x, this.cy[a] - y) + ladder.length + Math.hypot(this.cx[b] - x, this.cy[b] - y)
        this.out[a].push({ to: b, edge: -1, w, spot: [x, y], climb: ladder.length })
      }
      for (const t of tops) for (const b of bottoms) (link(t, b), link(b, t))
    }
    this.addJumps()
  }

  /**
   * The mesh leaves out jumps onto boxes and drops off ledges, which players use all the time.
   * Link areas whose edges nearly touch when the step up is jumpable or the drop survivable.
   */
  private addJumps() {
    const add: [number, number, Vec2][] = []
    for (const cell of this.cells.values()) {
      for (let p = 0; p < cell.length; p++) {
        for (let q = p + 1; q < cell.length; q++) {
          const a = cell[p], b = cell[q], near = nearestPoints(this.areas[a].corners, this.areas[b].corners)
          if (near.gap > GAP || Math.abs(near.dz) < STEP || near.dz > DROP || -near.dz > DROP) continue
          const [low, high] = near.dz > 0 ? [a, b] : [b, a]
          if (this.roofed(low, high, near.at)) continue
          if (Math.abs(near.dz) <= JUMP) add.push([low, high, near.at])
          add.push([high, low, near.at])
        }
      }
    }
    for (const [a, b, at] of add) {
      if (this.out[a].some(l => l.to === b)) continue
      const w = Math.hypot(this.cx[a] - at[0], this.cy[a] - at[1]) + Math.hypot(this.cx[b] - at[0], this.cy[b] - at[1])
      this.out[a].push({ to: b, edge: -1, w, spot: at })
    }
  }

  /**
   * Whether something walkable covers the lower area right by the spot, between the two heights:
   * then the lower area runs under a floor (stacked sites, a corridor below a ledge) and there is
   * nothing to jump or drop through.
   */
  private roofed(low: number, high: number, at: Vec2): boolean {
    const dx = this.cx[low] - at[0], dy = this.cy[low] - at[1], d = Math.hypot(dx, dy) || 1
    const x = at[0] + (dx / d) * 16, y = at[1] + (dy / d) * 16
    const from = this.zmin[low] + STEP, to = this.zmax[high] + STEP
    for (const i of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      if (i === low || this.zmax[i] <= from || this.zmin[i] > to) continue
      if (distanceToPolygon(this.areas[i].corners, x, y) === 0) return true
    }
    return false
  }

  area(id: number): NavArea | undefined {
    const i = this.index.get(id)
    return i === undefined ? undefined : this.areas[i]
  }

  /** Ids of the areas reachable directly from this one. */
  neighbours(id: number): number[] {
    const i = this.index.get(id)
    return i === undefined ? [] : this.out[i].map(l => this.areas[l.to].id)
  }

  /**
   * The area under a point. Players stand on boxes and ledges the mesh leaves out and brush past
   * its edges, so a point up to `maxDistance` away still counts; on stacked floors the one
   * nearest in height wins.
   */
  areaAt(p: Point, maxDistance = 120): NavArea | undefined {
    const i = this.locate(p, maxDistance)
    return i < 0 ? undefined : this.areas[i]
  }

  /**
   * The shortest walk from `from` to a point, or to the nearest of a set of areas (a bomb site,
   * say: the route ends where it first enters one). Undefined when either end is off the mesh or
   * no way connects them.
   */
  route(from: Point, to: Point | Iterable<number>): Route | undefined {
    const start = this.locate(from, 120)
    if (start < 0) return undefined
    const goal = new Set<number>()
    const toPoint = isPoint(to)
    if (toPoint) {
      const g = this.locate(to, 120)
      if (g < 0) return undefined
      goal.add(g)
    } else {
      for (const id of to) {
        const i = this.index.get(id)
        if (i !== undefined) goal.add(i)
      }
    }
    const corridor = this.search(start, goal)
    if (!corridor) return undefined
    const a: Vec2 = [from.x, from.y]
    let points: Vec2[]
    if (toPoint) points = this.pull(corridor, a, [to.x, to.y])
    else if (corridor.length === 1) points = [a]
    else {
      // Head for the middle of the last doorway, then stop at its nearest point.
      const [p, q] = this.portal(corridor[corridor.length - 2], corridor[corridor.length - 1])
      points = this.pull(corridor.slice(0, -1), a, mid(p, q))
      points[points.length - 1] = closestOnSegment(points[points.length - 2] ?? a, p, q)
    }
    let length = 0
    for (let k = 1; k < corridor.length; k++) length += this.link(corridor[k - 1], corridor[k]).climb ?? 0
    for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1])
    return { areas: corridor.map(i => this.areas[i].id), points, length }
  }

  /**
   * Walking distances to a point, or to the nearest of a set of areas (as in `route`), for any
   * number of starts: one search backwards from the goal instead of one `route` per start, so
   * links count only their way. It walks straight from doorway to doorway, through spots along
   * each (its ends and every `DOOR_STEP` between; a ladder or jump has one), which comes close
   * to the corner-cutting line `route` draws.
   */
  distancesTo(goal: Point | Iterable<number>): DistanceField {
    const d = (this.doors ??= this.buildDoors())
    const isGoal = new Uint8Array(this.areas.length)
    let target: Vec2 | undefined
    if (isPoint(goal)) {
      const g = this.locate(goal, 120)
      if (g < 0) return { at: () => undefined }
      isGoal[g] = 1
      target = [goal.x, goal.y]
    } else {
      for (const id of goal) {
        const i = this.index.get(id)
        if (i !== undefined) isGoal[i] = 1
      }
    }
    // Into a set of areas the walk ends on the doorway's nearest point; to a point it goes on.
    const ends = (k: number) => !target && isGoal[d.to[k]] === 1
    // dist[v]: from the doorway spot v to the goal, not counting its door's ladder.
    const dist = new Float64Array(d.x.length).fill(Infinity)
    const heap = new Heap()
    for (let k = 0; k < d.from.length; k++) {
      if (!isGoal[d.to[k]] || isGoal[d.from[k]]) continue
      for (let v = d.first[k]; v < d.first[k + 1]; v++) {
        dist[v] = target ? Math.hypot(target[0] - d.x[v], target[1] - d.y[v]) : 0
        heap.push(v, dist[v])
      }
    }
    while (heap.size) {
      const [v, dv] = heap.pop()
      if (dv > dist[v]) continue
      const k = d.door[v]
      // Every spot of every doorway into k's area leads on through v.
      for (const j of d.into[d.from[k]]) {
        if (isGoal[d.from[j]]) continue
        for (let u = d.first[j]; u < d.first[j + 1]; u++) {
          const [ex, ey] = ends(k) ? d.nearest(k, d.x[u], d.y[u]) : [d.x[v], d.y[v]]
          const du = dv + d.climb[k] + Math.hypot(ex - d.x[u], ey - d.y[u])
          if (du < dist[u]) (dist[u] = du), heap.push(u, du)
        }
      }
    }
    return {
      at: (p) => {
        const s = this.locate(p, 120)
        if (s < 0) return undefined
        if (isGoal[s]) return target ? Math.hypot(target[0] - p.x, target[1] - p.y) : 0
        let best = Infinity
        for (const k of d.outOf[s]) {
          for (let v = d.first[k]; v < d.first[k + 1]; v++) {
            if (dist[v] === Infinity) continue
            const [ex, ey] = ends(k) ? d.nearest(k, p.x, p.y) : [d.x[v], d.y[v]]
            best = Math.min(best, Math.hypot(ex - p.x, ey - p.y) + d.climb[k] + dist[v])
          }
        }
        return best === Infinity ? undefined : best
      },
    }
  }

  /**
   * Every link as a doorway, numbered, with spots along it: its ends, where a tight line bends,
   * and enough between them that a straight walk through it passes near one.
   */
  private buildDoors(): Doors {
    const d: Doors = { from: [], to: [], climb: [], first: [], outOf: [], into: [], door: [], x: [], y: [], nearest: () => [0, 0] }
    const ends: [Vec2, Vec2][] = []
    d.outOf = this.areas.map(() => [])
    d.into = this.areas.map(() => [])
    this.out.forEach((links, a) => {
      for (const l of links) {
        const [p, q] = this.portal(a, l.to), k = d.from.length
        d.from.push(a), d.to.push(l.to), d.climb.push(l.climb ?? 0), d.first.push(d.x.length)
        d.outOf[a].push(k), d.into[l.to].push(k)
        ends.push([p, q])
        const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / DOOR_STEP)
        for (let i = 0; i <= n; i++) d.door.push(k), d.x.push(p[0] + ((q[0] - p[0]) * i) / (n || 1)), d.y.push(p[1] + ((q[1] - p[1]) * i) / (n || 1))
      }
    })
    d.first.push(d.x.length)
    d.nearest = (k, x, y) => closestOnSegment([x, y], ends[k][0], ends[k][1])
    return d
  }

  private locate(p: Point, maxDistance: number): number {
    let best = -1, bestScore = Infinity
    const visit = ++this.visit, box = this.box
    const x0 = Math.floor((p.x - maxDistance) / CELL), x1 = Math.floor((p.x + maxDistance) / CELL)
    const y0 = Math.floor((p.y - maxDistance) / CELL), y1 = Math.floor((p.y + maxDistance) / CELL)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const i of this.cells.get(cellKey(x, y)) ?? []) {
          if (this.seen[i] === visit) continue
          this.seen[i] = visit
          const rise = p.z < this.zmin[i] ? this.zmin[i] - p.z : p.z > this.zmax[i] ? p.z - this.zmax[i] : 0
          // No nearer than its bounds: skip what can't beat the best so far.
          const bx = Math.max(box[4 * i] - p.x, 0, p.x - box[4 * i + 2]), by = Math.max(box[4 * i + 1] - p.y, 0, p.y - box[4 * i + 3])
          const least = Math.hypot(bx, by, rise)
          if (least >= bestScore || least > maxDistance) continue
          const score = Math.hypot(distanceToPolygon(this.areas[i].corners, p.x, p.y), rise)
          if (score < bestScore) (bestScore = score), (best = i)
        }
      }
    }
    return bestScore <= maxDistance ? best : -1
  }

  /** Dijkstra over area centres; returns area indices from start to the first goal reached. */
  private search(start: number, goal: Set<number>): number[] | undefined {
    const n = this.areas.length
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1)
    const heap = new Heap()
    dist[start] = 0
    heap.push(start, 0)
    while (heap.size) {
      const [i, d] = heap.pop()
      if (d > dist[i]) continue
      if (goal.has(i)) {
        const path = [i]
        while (path[0] !== start) path.unshift(prev[path[0]])
        return path
      }
      for (const l of this.out[i]) {
        const nd = d + l.w
        if (nd < dist[l.to]) (dist[l.to] = nd), (prev[l.to] = i), heap.push(l.to, nd)
      }
    }
    return undefined
  }

  private link(a: number, b: number) {
    return this.out[a].find(l => l.to === b)!
  }

  /** The stretch of a's edge that opens into b; for a ladder or jump, the spot where it is. */
  private portal(a: number, b: number): [Vec2, Vec2] {
    const link = this.link(a, b)
    if (link.spot) return [link.spot, link.spot]
    const poly = this.areas[a].corners, other = this.areas[b].corners
    const P = poly[link.edge], Q = poly[(link.edge + 1) % poly.length]
    const dx = Q[0] - P[0], dy = Q[1] - P[1], len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2)
    const along = (c: Vec3) => ((c[0] - P[0]) * dx + (c[1] - P[1]) * dy) / len2
    const onLine = other.filter(c => Math.abs((c[0] - P[0]) * dy - (c[1] - P[1]) * dx) / len < 24)
    const ts = (onLine.length >= 2 ? onLine : other).map(along)
    let lo = Math.max(0, Math.min(...ts)), hi = Math.min(1, Math.max(...ts))
    if (hi <= lo) (lo = 0), (hi = 1)
    return [[P[0] + dx * lo, P[1] + dy * lo], [P[0] + dx * hi, P[1] + dy * hi]]
  }

  /** String-pulls a straight-as-possible line through the corridor's doorways (simple funnel). */
  private pull(corridor: number[], start: Vec2, end: Vec2): Vec2[] {
    const portals: [Vec2, Vec2][] = [[start, start]]
    for (let k = 0; k + 1 < corridor.length; k++) {
      const a = corridor[k], [p, q] = this.portal(a, corridor[k + 1])
      // Left and right as seen walking from a's centre through the doorway.
      portals.push(cross([this.cx[a], this.cy[a]], mid(p, q), p) > 0 ? [q, p] : [p, q])
    }
    portals.push([end, end])
    const points: Vec2[] = [start]
    let apex = start, left = start, right = start, ai = 0, li = 0, ri = 0
    for (let k = 1; k < portals.length; k++) {
      const [l, r] = portals[k]
      if (cross(apex, right, r) <= 0) {
        if (same(apex, right) || cross(apex, left, r) > 0) (right = r), (ri = k)
        else {
          points.push(left)
          apex = right = left
          ai = ri = li
          k = ai
          continue
        }
      }
      if (cross(apex, left, l) >= 0) {
        if (same(apex, left) || cross(apex, right, l) < 0) (left = l), (li = k)
        else {
          points.push(right)
          apex = left = right
          ai = li = ri
          k = ai
          continue
        }
      }
    }
    points.push(end)
    return points
  }
}

/** Doorways by number: the areas they join, any ladder climbed, and their spots (`first[k]` on). */
interface Doors {
  from: number[]
  to: number[]
  climb: number[]
  first: number[]
  outOf: number[][]
  into: number[][]
  /** Spots: their doorway and position. */
  door: number[]
  x: number[]
  y: number[]
  /** A doorway's nearest point to somewhere. */
  nearest(k: number, x: number, y: number): Vec2
}

const cellKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768)
const isPoint = (v: Point | Iterable<number>): v is Point => typeof (v as Point).x === 'number'
const mid = (p: Vec2, q: Vec2): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
const cross = (a: Vec2, b: Vec2, c: Vec2) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1])
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3

function closestOnSegment(from: Vec2, p: Vec2, q: Vec2): Vec2 {
  const dx = q[0] - p[0], dy = q[1] - p[1], len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((from[0] - p[0]) * dx + (from[1] - p[1]) * dy) / len2)) : 0
  return [p[0] + dx * t, p[1] + dy * t]
}

/** Where two polygons come closest on the ground plane: the gap, b's height over a's there, the spot. */
function nearestPoints(a: Vec3[], b: Vec3[]): { gap: number; dz: number; at: Vec2 } {
  let gap = Infinity, dz = 0, at: Vec2 = [0, 0]
  const scan = (from: Vec3[], to: Vec3[], sign: number) => {
    for (const c of from) {
      for (let i = 0, j = to.length - 1; i < to.length; j = i++) {
        const p = to[j], q = to[i], dx = q[0] - p[0], dy = q[1] - p[1], len2 = dx * dx + dy * dy
        const t = len2 ? Math.max(0, Math.min(1, ((c[0] - p[0]) * dx + (c[1] - p[1]) * dy) / len2)) : 0
        const x = p[0] + dx * t, y = p[1] + dy * t, d = Math.hypot(x - c[0], y - c[1])
        if (d < gap) (gap = d), (dz = sign * (p[2] + (q[2] - p[2]) * t - c[2])), (at = [(x + c[0]) / 2, (y + c[1]) / 2])
      }
    }
  }
  scan(a, b, 1)
  scan(b, a, -1)
  return { gap, dz, at }
}

/** 0 inside the polygon, else the distance to its nearest edge (ground plane). */
function distanceToPolygon(poly: Vec3[], x: number, y: number): number {
  let inside = false, best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    const dx = xi - xj, dy = yi - yj, len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((x - xj) * dx + (y - yj) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(xj + dx * t - x, yj + dy * t - y))
  }
  return inside ? 0 : best
}

/** Binary min-heap of (index, priority). */
class Heap {
  private items: number[] = []
  private prio: number[] = []
  get size() { return this.items.length }
  push(item: number, p: number) {
    const a = this.items, w = this.prio
    let k = a.length
    a.push(item), w.push(p)
    while (k > 0) {
      const up = (k - 1) >> 1
      if (w[up] <= p) break
      a[k] = a[up], w[k] = w[up]
      k = up
    }
    a[k] = item, w[k] = p
  }
  pop(): [number, number] {
    const a = this.items, w = this.prio, top: [number, number] = [a[0], w[0]]
    const item = a.pop()!, p = w.pop()!
    if (a.length) {
      let k = 0
      for (;;) {
        let c = 2 * k + 1
        if (c >= a.length) break
        if (c + 1 < a.length && w[c + 1] < w[c]) c++
        if (w[c] >= p) break
        a[k] = a[c], w[k] = w[c]
        k = c
      }
      a[k] = item, w[k] = p
    }
    return top
  }
}
