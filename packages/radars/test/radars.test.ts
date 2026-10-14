import { expect, it } from 'vitest'
import { overviews, radar } from '../src/index.js'

it('knows the active duty maps', () => {
  for (const m of ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train']) {
    expect(overviews[m], m).toBeDefined()
  }
})

it('builds image URLs and floors', () => {
  const nuke = radar('de_nuke', 'https://example.com/r/')!
  expect(nuke.image).toBe('https://example.com/r/de_nuke_radar_psd.png')
  expect(nuke.lower).toBe('https://example.com/r/de_nuke_lower_radar_psd.png')
  expect(nuke.split_z).toBe(-495)
  expect(radar('de_mirage')!.lower).toBeNull()
  expect(radar('de_nope')).toBeUndefined()
})
