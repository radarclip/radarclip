import { NavMesh, type Ladder, type NavArea, type Vec3 } from './mesh.js'

const MAGIC = 0xfeedface

/**
 * Reads a CS2 `.nav` file (format versions 31–36; the game ships 36). Only what routing needs is
 * kept: each area's polygon, the areas it leads to, and ladders. Layout as read by
 * ValveResourceFormat's `NavMeshFile`.
 */
export function parseNav(data: ArrayBuffer | Uint8Array): NavMesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const r = new Reader(bytes)
  if (r.u32() !== MAGIC) throw new Error('nav: not a .nav file')
  const version = r.u32()
  if (version < 31 || version > 36) throw new Error(`nav: unsupported version ${version}`)
  r.skip(4 + 1) // sub-version, analysed
  for (let i = r.u16(); i > 0; i--) r.skip(r.u16()) // place names (shipped maps have none)
  r.skip(1)
  if (version >= 36) r.kv3()

  const corners: Vec3[] = []
  for (let i = r.u32(); i > 0; i--) corners.push([r.f32(), r.f32(), r.f32()])
  const polygons: Vec3[][] = []
  for (let i = r.u32(); i > 0; i--) {
    const poly: Vec3[] = []
    for (let n = r.u8(); n > 0; n--) poly.push(at(corners, r.u32(), 'corner'))
    if (version >= 35) r.skip(4)
    polygons.push(poly)
  }
  if (version >= 32 && r.u32() & 1) r.skip(12 * r.u32()) // per-corner gravity
  if (version >= 35) for (let i = r.u32(); i > 0; i--) (r.cstring(), r.skip(48)) // movable meshes
  if (version >= 36) r.kv3()

  const areas: NavArea[] = []
  for (let i = r.u32(); i > 0; i--) {
    const id = r.u32()
    r.skip(8 + 1) // attribute flags, hull
    const poly = at(polygons, r.u32(), 'polygon')
    r.skip(4)
    const links: NavArea['links'] = []
    for (let edge = 0; edge < poly.length; edge++) {
      for (let n = r.u32(); n > 0; n--) {
        links.push({ to: r.u32(), edge })
        r.skip(4)
      }
    }
    r.skip(13 * r.u8()) // hiding spots
    if (r.u32() !== 0) throw new Error('nav: encounter paths are not supported')
    r.skip(4 * r.u32()) // ladders above
    r.skip(4 * r.u32()) // ladders below
    areas.push({ id, corners: poly, links })
  }

  const ladders: Ladder[] = []
  for (let i = r.u32(); i > 0; i--) {
    r.skip(4 + 4) // id, width
    const top: Vec3 = [r.f32(), r.f32(), r.f32()], bottom: Vec3 = [r.f32(), r.f32(), r.f32()]
    const length = r.f32()
    r.skip(4) // direction
    const topAreas = [r.u32(), r.u32(), r.u32(), r.u32()], bottomAreas = [r.u32()]
    if (version >= 33) bottomAreas.push(r.u32(), r.u32())
    // 0 means no area
    ladders.push({ top, bottom, length, topAreas: topAreas.filter(id => id), bottomAreas: bottomAreas.filter(id => id) })
  }
  return new NavMesh(areas, ladders)
}

function at<T>(list: T[], i: number, what: string): T {
  const v = list[i]
  if (v === undefined) throw new Error(`nav: ${what} ${i} out of range`)
  return v
}

class Reader {
  private view: DataView
  private p = 0
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  private need(n: number) {
    if (this.p + n > this.bytes.byteLength) throw new Error('nav: unexpected end of file')
    const at = this.p
    this.p += n
    return at
  }
  skip(n: number) { this.need(n) }
  u8() { return this.view.getUint8(this.need(1)) }
  u16() { return this.view.getUint16(this.need(2), true) }
  u32() { return this.view.getUint32(this.need(4), true) }
  i32() { return this.view.getInt32(this.need(4), true) }
  f32() { return this.view.getFloat32(this.need(4), true) }
  cstring() { while (this.u8() !== 0); }

  /** Steps over an embedded KV3 document; the ones in shipped navs are empty placeholders. */
  kv3() {
    this.p = (this.p + 7) & ~7
    const magic = this.u32(), version = magic & 0xff
    if ((magic & 0xffffff00) >>> 0 !== 0x4b563300 || version < 2 || version > 5) {
      throw new Error(`nav: unsupported KV3 header ${magic.toString(16)}`)
    }
    this.skip(16) // format GUID
    const method = this.u32()
    this.skip(4 + 16 + 4) // dictionary id and frame size, counts, object and array counts
    const unc = this.i32(), cmp = this.i32(), blocks = this.i32(), blobs = this.i32()
    if (blocks || blobs) throw new Error('nav: KV3 document with blocks is not supported')
    let blockBytes = 0
    if (version >= 4) (this.skip(4), (blockBytes = this.i32()))
    let body = method === 0 ? unc : cmp
    if (version >= 5) {
      const u1 = this.i32(), c1 = this.i32(), u2 = this.i32(), c2 = this.i32()
      this.skip(32)
      body = method === 0 ? u1 + u2 : c1 + c2
    }
    this.skip(body + blockBytes)
  }
}
