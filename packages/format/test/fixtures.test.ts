import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decode, readClip, stateAt, writeClip } from '../src/index.js'

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
})

it('rejects other major versions', async () => {
  await expect(readClip('{"format":"radarclip/2"}')).rejects.toThrow(/newer reader/)
})
