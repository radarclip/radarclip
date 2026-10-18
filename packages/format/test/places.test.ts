import { expect, it } from 'vitest'
import { placeName } from '../src/index.js'

it('names places as players know them', () => {
  expect(placeName('TopofMid')).toBe('Top of Mid')
  expect(placeName('BombsiteA')).toBe('Bombsite A')
  expect(placeName('SnipersNest')).toBe("Sniper's Nest")
  expect(placeName('CTSpawn')).toBe('CT Spawn')
  expect(placeName('TSpawn')).toBe('T Spawn')
})

it('splits keys the game has no name for into words', () => {
  expect(placeName('ForkLift')).toBe('Fork Lift')
  expect(placeName('CTLane2')).toBe('CT Lane 2')
  expect(placeName('Upper_Tunnel')).toBe('Upper Tunnel')
  expect(placeName('Mid')).toBe('Mid')
})
