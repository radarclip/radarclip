// Writes small .nav files for tests (version 36, empty KV3 blocks), so no game file is needed.
type V3 = [number, number, number]
export interface TestArea { id: number; corners: V3[]; links?: { to: number; edge: number }[] }
export interface TestLadder { top: V3; bottom: V3; length: number; topAreas: number[]; bottomAreas: number[] }

export function writeNav(areas: TestArea[], ladders: TestLadder[] = []): Uint8Array {
  const out: number[] = []
  const buf = new DataView(new ArrayBuffer(8))
  const u8 = (v: number) => out.push(v & 0xff)
  const u16 = (v: number) => (buf.setUint16(0, v, true), out.push(...new Uint8Array(buf.buffer, 0, 2)))
  const u32 = (v: number) => (buf.setUint32(0, v >>> 0, true), out.push(...new Uint8Array(buf.buffer, 0, 4)))
  const f32 = (v: number) => (buf.setFloat32(0, v, true), out.push(...new Uint8Array(buf.buffer, 0, 4)))
  const kv3 = () => {
    while (out.length % 8) u8(0)
    u32(0x4b563305)
    for (let i = 0; i < 16; i++) u8(0) // GUID
    u32(0) // uncompressed
    for (let i = 0; i < 4 + 16 + 4 + 16 + 8 + 16 + 32; i++) u8(0) // all sizes and counts zero
  }
  u32(0xfeedface), u32(36), u32(1), u8(1), u16(0), u8(1)
  kv3()
  const corners = areas.flatMap(a => a.corners)
  u32(corners.length)
  for (const c of corners) c.forEach(f32)
  u32(areas.length)
  let k = 0
  for (const a of areas) {
    u8(a.corners.length)
    for (let i = 0; i < a.corners.length; i++) u32(k++)
    u32(0xffffffff)
  }
  u32(0) // no corner gravity
  u32(0) // no movable meshes
  kv3()
  u32(areas.length)
  areas.forEach((a, i) => {
    u32(a.id), u32(0), u32(0), u8(0), u32(i), f32(0)
    for (let e = 0; e < a.corners.length; e++) {
      const links = (a.links ?? []).filter(l => l.edge === e)
      u32(links.length)
      for (const l of links) u32(l.to), u32(0)
    }
    u8(0), u32(0), u32(0), u32(0)
  })
  u32(ladders.length)
  ladders.forEach((l, i) => {
    u32(i + 1), f32(32)
    l.top.forEach(f32), l.bottom.forEach(f32)
    f32(l.length), u32(0)
    for (let j = 0; j < 4; j++) u32(l.topAreas[j] ?? 0)
    for (let j = 0; j < 3; j++) u32(l.bottomAreas[j] ?? 0)
  })
  return new Uint8Array(out)
}

/** An axis-aligned square area; edges run (x0,y0) → (x1,y0) → (x1,y1) → (x0,y1), numbered 0–3. */
export function square(id: number, x0: number, y0: number, size: number, z = 0, links: { to: number; edge: number }[] = []): TestArea {
  const x1 = x0 + size, y1 = y0 + size
  return { id, corners: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], links }
}
