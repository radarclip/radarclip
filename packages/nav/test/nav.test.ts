import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { areasNamed, labelAreas, parseNav, type Point, type Vec3 } from '../src/index.js'
import { square, writeNav } from './write.js'

// An L of three 200-unit squares: 1 → 2 east, 2 → 3 north. Edges: 0 south, 1 east, 2 north, 3 west.
const L = () => [
  square(1, 0, 0, 200, 0, [{ to: 2, edge: 1 }]),
  square(2, 200, 0, 200, 0, [{ to: 1, edge: 3 }, { to: 3, edge: 2 }]),
  square(3, 200, 200, 200, 0, [{ to: 2, edge: 0 }]),
]

describe('parseNav', () => {
  it('reads areas, links and ladders', () => {
    const nav = parseNav(writeNav(L(), [{ top: [0, 0, 100], bottom: [0, 0, 0], length: 100, topAreas: [3], bottomAreas: [1] }]))
    expect(nav.areas.map(a => a.id)).toEqual([1, 2, 3])
    expect(nav.area(2)!.corners[1]).toEqual([400, 0, 0])
    expect(nav.area(2)!.links).toEqual([{ to: 3, edge: 2 }, { to: 1, edge: 3 }])
    expect(nav.ladders[0]).toMatchObject({ length: 100, topAreas: [3], bottomAreas: [1] })
  })

  it('rejects what it cannot read', () => {
    expect(() => parseNav(new Uint8Array(8))).toThrow('not a .nav file')
    expect(() => parseNav(writeNav(L()).slice(0, 200))).toThrow('unexpected end')
  })
})

describe('areaAt', () => {
  const nav = parseNav(writeNav([square(1, 0, 0, 100, 0), square(2, 0, 0, 100, 200), square(3, 300, 0, 100, 0)]))

  it('finds the area under a point, on stacked floors the nearest in height', () => {
    expect(nav.areaAt({ x: 50, y: 50, z: 0 })!.id).toBe(1)
    expect(nav.areaAt({ x: 50, y: 50, z: 190 })!.id).toBe(2)
  })

  it('takes points just off the mesh, not far ones', () => {
    expect(nav.areaAt({ x: 150, y: 50, z: 0 })!.id).toBe(1)
    expect(nav.areaAt({ x: 1000, y: 50, z: 0 })).toBeUndefined()
  })
})

describe('route', () => {
  it('cuts the corner like a player', () => {
    const nav = parseNav(writeNav(L()))
    const r = nav.route({ x: 20, y: 100, z: 0 }, { x: 300, y: 380, z: 0 })!
    expect(r.areas).toEqual([1, 2, 3])
    expect(r.points).toEqual([[20, 100], [200, 200], [300, 380]])
    expect(r.length).toBeCloseTo(Math.hypot(180, 100) + Math.hypot(100, 180))
  })

  it('stops where it first enters a set of areas', () => {
    const nav = parseNav(writeNav(L()))
    const r = nav.route({ x: 100, y: 100, z: 0 }, [3])!
    expect(r.areas).toEqual([1, 2, 3])
    expect(r.points.at(-1)![1]).toBe(200)
    expect(nav.route({ x: 300, y: 300, z: 0 }, [3])!.length).toBe(0)
  })

  it('follows one-way links only their way', () => {
    const nav = parseNav(writeNav([square(1, 0, 0, 200, 0, [{ to: 2, edge: 1 }]), square(2, 300, 0, 200, 0)]))
    expect(nav.route({ x: 100, y: 100, z: 0 }, { x: 400, y: 100, z: 0 })).toBeDefined()
    expect(nav.route({ x: 400, y: 100, z: 0 }, { x: 100, y: 100, z: 0 })).toBeUndefined()
  })

  it('climbs ladders and counts the climb', () => {
    const areas = [square(1, 0, 0, 200, 0), square(2, 0, 400, 200, 300)]
    const nav = parseNav(writeNav(areas, [{ top: [100, 300, 300], bottom: [100, 300, 0], length: 300, topAreas: [2], bottomAreas: [1] }]))
    const up = nav.route({ x: 100, y: 100, z: 0 }, { x: 100, y: 500, z: 300 })!
    expect(up.areas).toEqual([1, 2])
    expect(up.length).toBeCloseTo(400 + 300)
    expect(nav.route({ x: 100, y: 500, z: 300 }, { x: 100, y: 100, z: 0 })).toBeDefined()
  })

  it('jumps onto boxes and drops off ledges the mesh leaves unlinked', () => {
    const nav = parseNav(writeNav([square(1, 0, 0, 200, 0), square(2, 210, 0, 100, 60), square(3, 320, 0, 100, 160)]))
    const floor = { x: 100, y: 50, z: 0 }, box = { x: 260, y: 50, z: 60 }, ledge = { x: 370, y: 50, z: 160 }
    expect(nav.route(floor, box)).toBeDefined()
    expect(nav.route(box, floor)).toBeDefined()
    expect(nav.route(box, ledge)).toBeUndefined() // 100 up is too high
    expect(nav.route(ledge, floor)!.areas).toEqual([3, 2, 1])
  })

  it('never drops through a floor onto the area below it', () => {
    // A 200-unit room on top of the north-west corner of a bigger hall, no stairs.
    const nav = parseNav(writeNav([square(1, 0, 0, 200, 200), square(2, 0, 0, 400, 0)]))
    expect(nav.route({ x: 100, y: 100, z: 200 }, { x: 300, y: 300, z: 0 })).toBeUndefined()
  })
})

describe('distancesTo', () => {
  it('measures the walk route() takes, corner cut', () => {
    const nav = parseNav(writeNav(L()))
    const from = { x: 20, y: 100, z: 0 }, to = { x: 300, y: 380, z: 0 }
    expect(nav.distancesTo(to).at(from)).toBeCloseTo(nav.route(from, to)!.length)
    expect(nav.distancesTo(to).at({ x: 250, y: 300, z: 0 })).toBeCloseTo(Math.hypot(50, 80))
    // Into a set of areas, straight for the doorway's nearest point (route() heads for its middle).
    expect(nav.distancesTo([3]).at({ x: 100, y: 100, z: 0 })).toBeCloseTo(Math.hypot(100, 100))
    expect(nav.distancesTo([3]).at({ x: 300, y: 300, z: 0 })).toBe(0)
  })

  it('follows one-way links only their way', () => {
    // A ledge 100 above the floor: the drop is linked, the way back up is not.
    const nav = parseNav(writeNav([square(1, 0, 0, 200, 100, [{ to: 2, edge: 1 }]), square(2, 200, 0, 200, 0)]))
    const ledge = { x: 100, y: 100, z: 100 }, floor = { x: 300, y: 100, z: 0 }
    expect(nav.distancesTo(floor).at(ledge)).toBeCloseTo(200)
    expect(nav.distancesTo(ledge).at(floor)).toBeUndefined()
    expect(nav.distancesTo([2]).at(ledge)).toBeCloseTo(100)
    expect(nav.distancesTo([1]).at(floor)).toBeUndefined()
  })

  it('climbs ladders and counts the climb', () => {
    const areas = [square(1, 0, 0, 200, 0), square(2, 0, 400, 200, 300)]
    const nav = parseNav(writeNav(areas, [{ top: [100, 300, 300], bottom: [100, 300, 0], length: 300, topAreas: [2], bottomAreas: [1] }]))
    const low = { x: 100, y: 100, z: 0 }, high = { x: 100, y: 500, z: 300 }
    expect(nav.distancesTo(high).at(low)).toBeCloseTo(nav.route(low, high)!.length)
    expect(nav.distancesTo(low).at(high)).toBeCloseTo(400 + 300)
  })

  it('has nothing for points off the mesh or cut off from the goal', () => {
    const nav = parseNav(writeNav([...L(), square(4, 1000, 0, 200, 0)]))
    expect(nav.distancesTo([3]).at({ x: 5000, y: 0, z: 0 })).toBeUndefined()
    expect(nav.distancesTo([3]).at({ x: 1100, y: 100, z: 0 })).toBeUndefined()
    expect(nav.distancesTo({ x: 5000, y: 0, z: 0 }).at({ x: 100, y: 100, z: 0 })).toBeUndefined()
    expect(nav.distancesTo([]).at({ x: 100, y: 100, z: 0 })).toBeUndefined()
  })
})

describe('labelAreas', () => {
  it('names areas by majority and fills the ones nobody stood on', () => {
    const nav = parseNav(writeNav([...L(), square(4, 400, 200, 200, 0, [{ to: 3, edge: 3 }])]))
    const labels = labelAreas(nav, [
      { x: 100, y: 100, z: 0, place: 'TSpawn' },
      { x: 300, y: 100, z: 0, place: 'Middle' },
      { x: 310, y: 100, z: 0, place: 'Middle' },
      { x: 320, y: 100, z: 0, place: 'TSpawn' },
      { x: 300, y: 300, z: 0, place: 'BombsiteA' },
      { x: 300, y: 310, z: 0, place: '' },
    ])
    expect(Object.fromEntries(labels)).toEqual({ 1: 'TSpawn', 2: 'Middle', 3: 'BombsiteA', 4: 'BombsiteA' })
    expect(areasNamed(labels, 'BombsiteA').sort()).toEqual([3, 4])
  })

  it('keeps a name on its floor', () => {
    // A ramp-less drop: area 2 lies 100 below area 1 and is reached by a link from it.
    const nav = parseNav(writeNav([square(1, 0, 0, 200, 100, [{ to: 2, edge: 1 }]), square(2, 200, 0, 200, 0)]))
    const labels = labelAreas(nav, [{ x: 100, y: 100, z: 100, place: 'BombsiteA' }])
    expect(Object.fromEntries(labels)).toEqual({ 1: 'BombsiteA' })
  })
})

// Real maps, when a folder of .nav files is at hand (e.g. awpy-data's navs.zip unpacked):
//   RADARCLIP_NAVS=~/navs pnpm --filter @radarclip/nav test
const dir = process.env.RADARCLIP_NAVS
describe.skipIf(!dir)('real maps', () => {
  it('reads every active duty map and routes across Mirage', () => {
    for (const map of ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train']) {
      expect(parseNav(readFileSync(join(dir!, `${map}.nav`))).areas.length, map).toBeGreaterThan(1000)
    }
    const mirage = parseNav(readFileSync(join(dir!, 'de_mirage.nav')))
    const tSpawnToCtSpawn = mirage.route({ x: 1216, y: -208, z: -160 }, { x: -1720, y: -1896, z: -264 })!
    expect(tSpawnToCtSpawn.length).toBeGreaterThan(3000)
    expect(tSpawnToCtSpawn.length).toBeLessThan(5000)
  })

  it('gives distances on Nuke close to route() lengths', () => {
    const nuke = parseNav(readFileSync(join(dir!, 'de_nuke.nav')))
    const centre = (a: { corners: Vec3[] }) => {
      const n = a.corners.length, sum = (k: number) => a.corners.reduce((v, c) => v + c[k], 0) / n
      return { x: sum(0), y: sum(1), z: sum(2) }
    }
    const near = (p: Point, r: number) => nuke.areas.filter(a => {
      const c = centre(a)
      return Math.hypot(c.x - p.x, c.y - p.y) < r && Math.abs(c.z - p.z) < 100
    }).map(a => a.id)
    // Upper A, lower B (stacked under it), T spawn, CT spawn, outside, ramp.
    const spots = [
      { x: 640, y: -760, z: -415 }, { x: 600, y: -900, z: -770 }, { x: -1840, y: -1070, z: -410 },
      { x: 2600, y: -980, z: -410 }, { x: 1050, y: -2300, z: -410 }, { x: 800, y: 200, z: -640 },
    ]
    const errors: number[] = []
    for (const [g, goal] of spots.entries()) {
      for (const target of [goal, near(goal, 300)]) {
        const field = nuke.distancesTo(target)
        for (let k = g; k < nuke.areas.length; k += 23) {
          const p = centre(nuke.areas[k]), r = nuke.route(p, target), d = field.at(p)
          expect(d === undefined, `area ${nuke.areas[k].id}`).toBe(r === undefined)
          if (r && d !== undefined && r.length > 300) errors.push((d - r.length) / r.length)
        }
      }
    }
    const abs = errors.map(Math.abs).sort((a, b) => a - b)
    expect(errors.length).toBeGreaterThan(1000)
    expect(abs[Math.floor(abs.length / 2)]).toBeLessThan(0.04)
    expect(abs[Math.floor(abs.length * 0.9)]).toBeLessThan(0.12)
    // Shorter than route() where its corridor (centre to centre) misses a straighter way.
    expect(Math.max(...errors)).toBeLessThan(0.3)
    expect(Math.min(...errors)).toBeGreaterThan(-0.5)
  })
})
