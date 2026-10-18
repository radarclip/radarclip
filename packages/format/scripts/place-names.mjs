// Refresh src/placeNames.json: the English name for each place key a demo carries
// (`last_place_name`, e.g. TopofMid → "Top of Mid"). The game takes them from the place block of
// its csgo_english.txt; we read a copy from SteamDatabase's tracking of the game files, pinned to
// a commit. Bump GAME_FILES to a newer commit of that repo to refresh. OVERRIDES replaces the
// game's name where players call a place something else. Keys missing from the table are split
// into words by placeName().
//
//   pnpm --filter @radarclip/format place-names
import { writeFileSync } from 'node:fs'

const GAME_FILES = 'SteamDatabase/GameTracking-CS2@5ab573fa8afb5b8db98869d79ed79399fca6e747'
const PATH = 'game/csgo/pak01_dir/resource/csgo_english.txt'
// The block starts with this comment and runs to the first empty line.
const START = '// Place names used in bot chatter'
// The game says "CT Start" and "T Start"; players say spawn.
const OVERRIDES = { CTSpawn: 'CT Spawn', TSpawn: 'T Spawn' }

const [repo, sha] = GAME_FILES.split('@')
const r = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${PATH}`)
if (!r.ok) throw new Error(`${r.status} ${PATH}`)
const lines = (await r.text()).split(/\r?\n/)
const from = lines.findIndex((l) => l.trim().startsWith(START))
if (from < 0) throw new Error(`no place block in ${PATH}`)

const names = {}
for (const line of lines.slice(from + 1)) {
  if (!line.trim()) break
  const m = /^\s*"([^"]+)"\s+"([^"]*)"/.exec(line)
  if (m) names[m[1]] = m[2]
}
Object.assign(names, OVERRIDES)
const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(new URL('../src/placeNames.json', import.meta.url), JSON.stringify(sorted, null, 1) + '\n')
console.log(`src/placeNames.json: ${Object.keys(sorted).length} places`)
