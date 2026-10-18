import names from './placeNames.json' with { type: 'json' }

const table: Record<string, string> = names

/**
 * A place key from a demo (`last_place_name`: TopofMid, BombsiteA) as players know it: "Top of
 * Mid", "Bombsite A". The names are the game's own (`pnpm place-names` refreshes them), with a few
 * changed to what players say ("CT Spawn", not the game's "CT Start"). Keys the table lacks are
 * split into words: ForkLift → "Fork Lift".
 */
export function placeName(key: string): string {
  return table[key] ?? key
    .replace(/_+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .trim()
}
