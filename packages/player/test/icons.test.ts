import { expect, it } from 'vitest'
import { gameIcon, gameIcons } from '../src/player.js'

it('maps weapons and kill symbols onto the game icon layout under any base', () => {
  const own = gameIcons('/cs2-icons')
  expect(own('ak47')).toBe('/cs2-icons/icons/equipment/ak47.svg')
  expect(own('bayonet')).toBe('/cs2-icons/icons/equipment/knife.svg')
  expect(own('knife_karambit')).toBe('/cs2-icons/icons/equipment/knife_karambit.svg')
  expect(own('headshot')).toBe('/cs2-icons/hud/deathnotice/icon_headshot.svg')
  expect(own('world')).toBeUndefined()
  expect(gameIcon('awp')).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/.+\/icons\/equipment\/awp\.svg$/)
})
