import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClip, type Clip } from '@radarclip/format'
import { describe, expect, it } from 'vitest'
import { RadarclipPlayer, wrap } from '../src/player.js'

// 7 px per character, like a narrow 12px face.
const measure = (s: string) => [...s].length * 7

describe('wrap', () => {
  it('keeps a short text on one line', () => {
    expect(wrap('Takes mid alone', 200, 3, measure)).toEqual(['Takes mid alone'])
  })

  it('breaks at spaces, never wider than the line', () => {
    const lines = wrap('No trade: your team is still at spawn when you peek', 140, 3, measure)
    expect(lines).toEqual(['No trade: your team', 'is still at spawn', 'when you peek'])
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(140)
  })

  it('ends the last line in an ellipsis when the text needs more lines', () => {
    const lines = wrap('one two three four five six seven eight nine ten', 70, 2, measure)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(70)
  })

  it('cuts a word that is wider than a line on its own', () => {
    const lines = wrap('Schlangenederschlangeneder dies', 105, 3, measure)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(105)
    expect(lines.join('').replace(/ /g, '')).toBe('Schlangenederschlangenederdies')
  })
})

function recordingCanvas(width = 400) {
  const texts: { text: string; x: number }[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (k === 'measureText') return (s: string) => ({ width: measure(s) })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'fillText') return (text: string, x: number) => texts.push({ text, x })
      return () => {}
    },
    set: (t, k, v) => ((t[k] = v), true),
  })
  const canvas = {
    getContext: () => ctx, clientWidth: width, clientHeight: 300, width: 0, height: 0, style: {},
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 300 }),
  } as unknown as HTMLCanvasElement
  return { canvas, texts }
}

async function at(clip: Clip, seconds: number, width = 400) {
  const rec = recordingCanvas(width)
  const p = new RadarclipPlayer(rec.canvas, { interactive: false, icon: false })
  await p.load(clip)
  rec.texts.length = 0
  p.seek(seconds)
  return rec.texts.map((t) => t.text)
}

// Ancient R7: frames from tick 2880, one mark "kill" at 3821.
const ancient = () => readClip(readFileSync(join(import.meta.dirname, '../../../spec/fixtures/ancient-r7-short.radarclip.json'), 'utf8'))

it('shows the round number under the clock', async () => {
  const texts = await at(await ancient(), 2900 / 64)
  expect(texts).toContain('R7')
})

it('keeps a mark label on screen from its mark until the clip ends', async () => {
  const clip = await ancient()
  expect(await at(clip, 3800 / 64)).not.toContain('kill')
  expect(await at(clip, 3821 / 64)).toContain('kill')
  expect(await at(clip, 4100 / 64)).toContain('kill')
})

it('wraps a long mark label within the canvas', async () => {
  const clip = await ancient()
  const label = 'You peek mid alone while your team is still at spawn, so nobody can trade the kill and the round is lost from there'
  clip.marks = [{ t: 3821, label }]
  const texts = await at(clip, 3900 / 64, 300)
  const lines = texts.filter((t) => label.includes(t.replace(/…$/, '')) && t.length > 3)
  expect(lines.length).toBeGreaterThan(1)
  // Pill padding 30 px and 8 px insets on both sides: lines stay within 300 − 46.
  for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(300 - 46)
})
