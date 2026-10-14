// Refresh src/overviews.json from MurkyYT/cs2-map-icons (overview files extracted from the game
// depot). Only the numbers are kept; radar images stay where they are and load at runtime.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main'
const get = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r
}
const { maps } = await (await get(`${BASE}/data/available.json`)).json()
const num = (text, key) => {
  const m = text.match(new RegExp(`"${key}"\\s+"([-\\d.]+)"`))
  return m ? Number(m[1]) : undefined
}
const out = {}
for (const [map, info] of Object.entries(maps).sort()) {
  const radars = info.radar_paths ?? []
  if (!radars.some((p) => p.endsWith(`/${map}_radar_psd.png`))) continue
  let text
  try {
    text = await (await get(`${BASE}/data/radar_info/${map}.txt`)).text()
  } catch {
    continue
  }
  const [pos_x, pos_y, scale] = [num(text, 'pos_x'), num(text, 'pos_y'), num(text, 'scale')]
  if ([pos_x, pos_y, scale].some((v) => v === undefined)) continue
  const entry = { name: info.display_name ?? map, pos_x, pos_y, scale }
  const lower = text.match(/"lower"\s*(?:\/\/[^\n]*)?\s*\{[^}]*"AltitudeMax"\s+"([-\d.]+)"/)
  if (lower && radars.some((p) => p.endsWith(`/${map}_lower_radar_psd.png`))) entry.split_z = Number(lower[1])
  out[map] = entry
}
const file = join(import.meta.dirname, '../src/overviews.json')
writeFileSync(file, JSON.stringify(out, null, 1) + '\n')
console.log(`${Object.keys(out).length} maps → ${file}`)
