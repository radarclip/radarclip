import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decode, readClip, readMatch, stateAt, writeClip, writeMatch } from '../src/index.js'

const dir = join(import.meta.dirname, '../../../spec/fixtures')
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.radarclip.json'))

describe.each(fixtures)('%s', (file) => {
  const text = readFileSync(join(dir, file), 'utf8')
  const expected = JSON.parse(readFileSync(join(dir, file.replace('.radarclip.json', '.frames.json')), 'utf8'))

  it('decodes like the Rust reference decoder', async () => {
    const r = decode(await readClip(text))
    expect(r.players.length).toBe(expected.players.length)
    r.players.forEach((p, i) => {
      for (let f = 0; f < r.frames; f++) {
        const want = expected.players[i][f]
        if (want === null) {
          expect(p.alive[f], `player ${i} frame ${f}`).toBe(0)
          continue
        }
        const [x, y, z, yaw, hp, armor, weapon, place] = want
        expect(p.alive[f], `player ${i} frame ${f}`).toBe(1)
        expect(Math.abs(p.x[f] - x)).toBeLessThan(0.05)
        expect(Math.abs(p.y[f] - y)).toBeLessThan(0.05)
        expect(Math.abs(p.z[f] - z)).toBeLessThan(0.05)
        expect(Math.abs(((p.yaw[f] - yaw + 540) % 360) - 180)).toBeLessThan(0.05)
        expect([p.hp[f], p.armor[f], p.weapon[f], p.place[f]]).toEqual([hp, armor, weapon, place])
      }
    })
  })

  it('survives deflate round trip', async () => {
    const clip = await readClip(text)
    const bytes = await writeClip(clip)
    expect(bytes.length).toBeLessThan(text.length / 2)
    expect(await readClip(bytes)).toEqual(clip)
  })

  it('interpolates between frames', async () => {
    const r = decode(await readClip(text))
    const p = r.players.findIndex((pl) => pl.alive[0] && pl.alive[1])
    const a = stateAt(r, p, r.start)!, b = stateAt(r, p, r.start + r.step)!, mid = stateAt(r, p, r.start + r.step / 2)!
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 3)
    expect(stateAt(r, p, r.start - 1)).toBeNull()
  })

  it('has a position at every tick a player is alive, also right before a death', async () => {
    const r = decode(await readClip(text))
    for (const p of r.players) {
      for (let t = r.start; t <= r.end; t++) {
        const st = stateAt(r, p.index, t)
        if (st) expect(Number.isFinite(st.x) && Number.isFinite(st.y) && Number.isFinite(st.yaw), `player ${p.index} tick ${t}`).toBe(true)
      }
    }
  })
})

it('rejects other major versions', async () => {
  await expect(readClip('{"format":"radarclip/2"}')).rejects.toThrow(/newer reader/)
})

it('reads frame areas and rejects broken ones', async () => {
  const clip = JSON.parse(readFileSync(join(dir, fixtures[0]), 'utf8'))
  const frame = [{ x: -400, y: -1200, r: 1700 }]
  expect((await readClip(JSON.stringify({ ...clip, frame }))).frame).toEqual(frame)
  await expect(readClip(JSON.stringify({ ...clip, frame: [{ x: 0, y: 0 }] }))).rejects.toThrow(/frame/)
})

describe('radarclip-match/1', () => {
  const text = readFileSync(join(dir, 'nuke-r1-2.radarclip-match.json'), 'utf8')

  it('reads the reference match and every round as a clip', async () => {
    const m = await readMatch(text)
    expect(m.rounds.map((r) => r.number)).toEqual([1, 2])
    for (const r of m.rounds) {
      expect(r.keys.length).toBe(r.clip.players.length)
      expect(decode(r.clip).players.length).toBe(r.clip.players.length)
    }
  })

  it('keeps each round\'s detail next to its clip', async () => {
    const m = await readMatch(text)
    for (const r of m.rounds) {
      expect(r.detail?.players.length).toBe(r.clip.players.length)
      expect(r.detail?.gear.length).toBeGreaterThan(0)
    }
  })

  it('survives deflate round trip', async () => {
    const m = await readMatch(text)
    const bytes = await writeMatch(m)
    expect(bytes.length).toBeLessThan(text.length / 3)
    expect(await readMatch(bytes)).toEqual(m)
  })

  it('names the round whose clip is broken, and asks for a newer reader for newer formats', async () => {
    const broken = JSON.parse(text)
    broken.rounds[1].clip.players[0].track.k.pop()
    await expect(readMatch(JSON.stringify(broken))).rejects.toThrow(/round 2/)
    await expect(readMatch(JSON.stringify({ ...JSON.parse(text), format: 'radarclip-match/2' }))).rejects.toThrow(/newer reader/)
  })
})
