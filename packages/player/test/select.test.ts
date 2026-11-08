import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip, readMatch, stateAt, decode, type Clip } from '@radarclip/format'
import { expect, it } from 'vitest'
import { RadarclipPlayer, type StateKey } from '../src/player.js'

function recordingCanvas() {
  const texts: string[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return (s: string) => ({ width: [...s].length * 7 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'fillText') return (text: string) => texts.push(text)
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  const canvas = {
    getContext: () => ctx, clientWidth: 400, clientHeight: 300, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
  } as unknown as HTMLCanvasElement
  return { canvas, texts }
}

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../spec/fixtures', name), 'utf8')
const ancient = () => readClip(fixture('ancient-r7-short.radarclip.json'))

async function player(clip: Clip, select = true) {
  const rec = recordingCanvas()
  const p = new RadarclipPlayer(rec.canvas, { interactive: false, icon: false, select })
  await p.load(clip)
  return { p, texts: rec.texts }
}

it('selects a player and reports it in the state', async () => {
  const { p } = await player(await ancient())
  const changes: ReadonlySet<StateKey>[] = []
  p.onChange((_, changed) => changes.push(changed))
  p.select(2)
  expect(p.selected).toBe(2)
  expect(p.state.selected).toBe(2)
  expect(changes.at(-1)?.has('selected')).toBe(true)
  p.select(99)
  expect(p.selected).toBeNull()
})

it("shows the selected player's name and HP in the HUD", async () => {
  const clip = await ancient()
  const { p, texts } = await player(clip)
  const t = 2900 / 64
  const ix = decode(clip).players.findIndex((q) => stateAt(decode(clip), q.index, 2900) != null)
  p.seek(t)
  texts.length = 0
  p.select(ix)
  const st = stateAt(p.replay, ix, 2900)!
  expect(texts).toContain(p.replay.players[ix].name)
  expect(texts).toContain(String(st.hp))
})

it('shows no HUD without the select option', async () => {
  const clip = await ancient()
  const drawn = async (select: boolean) => {
    const { p, texts } = await player(clip, select)
    p.seek(2900 / 64)
    p.select(2)
    texts.length = 0
    p.seek(2901 / 64)
    return texts.length
  }
  expect(await drawn(false)).toBeLessThan(await drawn(true))
})

it("lists the selected player's grenades from the match detail, in a fixed order", async () => {
  const match = await readMatch(fixture('nuke-r1-2.radarclip-match.json'))
  // A player who holds two flashbangs at some point of a round.
  for (const round of match.rounds) {
    const d = round.detail!
    for (let ix = 0; ix < d.players.length; ix++) {
      const list = d.players[ix].gear
      for (let i = 0; i < list.length; i += 2) {
        const gear = d.gear[list[i + 1]]
        if (gear.filter((g) => g === 'Flashbang').length < 2) continue
        const frame = list[i]
        const rep = decode(round.clip)
        const tick = rep.start + frame * rep.step
        if (!stateAt(rep, ix, tick)) continue
        const { p, texts } = await player(round.clip)
        await p.load(round.clip, d)
        p.seek(tick / rep.tickrate)
        texts.length = 0
        p.select(ix)
        // Without icons (icon: false) each grenade shows as a short word.
        const nades = texts.filter((s) => ['Smoke', 'Flash', 'HE', 'Molly', 'Inc', 'Decoy'].includes(s))
        expect(nades.filter((s) => s === 'Flash')).toHaveLength(2)
        const order = ['Smoke', 'Flash', 'HE', 'Molly', 'Inc', 'Decoy']
        expect([...nades].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(nades)
        return
      }
    }
  }
  throw new Error('no player with two flashbangs in the fixture')
})

it('clears the selection on a new clip', async () => {
  const clip = await ancient()
  const { p } = await player(clip)
  p.select(1)
  await p.load(clip)
  expect(p.selected).toBeNull()
})

it('shows heights only for players near the reference player, the selected one if any', async () => {
  const match = await readMatch(fixture('nuke-r1-2.radarclip-match.json'))
  const heightsAt = (texts: string[]) => texts.filter((s) => /[▲▼]\d+ m$/.test(s)).map((s) => s.replace(/ [▲▼]\d+ m$/, ''))
  let checked = 0
  for (const round of match.rounds) {
    const rep = decode(round.clip)
    const { p, texts } = await player(round.clip)
    for (let tick = rep.start; tick <= rep.end; tick += 64 * 2) {
      p.select(null)
      for (const ref of [null, ...rep.players.map((q) => q.index)]) {
        if (ref != null && !(stateAt(rep, ref, tick)?.hp ?? 0)) continue
        p.select(ref)
        texts.length = 0
        p.seek(tick / rep.tickrate)
        const from = ref ?? round.clip.focus?.[0]
        const at = from != null ? stateAt(rep, from, tick) : null
        for (const label of heightsAt(texts)) {
          const exact = rep.players.findIndex((q) => q.name === label)
          const ix = exact >= 0 ? exact : rep.players.findIndex((q) => q.name.startsWith(label.replace(/…$/, '')))
          const st = stateAt(rep, ix, tick)!
          expect(ix).not.toBe(from)
          expect(Math.hypot(st.x - at!.x, st.y - at!.y)).toBeLessThan(600)
          expect(Math.abs(st.z - at!.z)).toBeGreaterThanOrEqual(120)
          checked++
        }
      }
    }
  }
  // Nuke stacks floors, so some heights must show.
  expect(checked).toBeGreaterThan(0)
})
