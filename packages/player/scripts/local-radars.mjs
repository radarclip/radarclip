// Dev helper: turn locally cached radars (Valve overview .txt + radar .png, e.g. cs2-coach's
// .cache/radars) into www/radars/<map>.json + images for the test page. Not committed: the
// images are Valve's.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [src = join(process.env.HOME, '.cache/cs2clip/radars')] = process.argv.slice(2)
const out = join(import.meta.dirname, '../www/radars')
mkdirSync(out, { recursive: true })
const num = (text, key) => Number(text.match(new RegExp(`"${key}"\\s+"([-\\d.]+)"`))?.[1])
const maps = []
for (const f of readdirSync(src).filter((f) => f.endsWith('.txt'))) {
  const map = f.slice(0, -4)
  const text = readFileSync(join(src, f), 'utf8')
  if (!existsSync(join(src, `${map}.png`))) continue
  const radar = { pos_x: num(text, 'pos_x'), pos_y: num(text, 'pos_y'), scale: num(text, 'scale'), image: `radars/${map}.png` }
  copyFileSync(join(src, `${map}.png`), join(out, `${map}.png`))
  const lower = text.match(/"lower"\s*(?:\/\/[^\n]*)?\s*\{[^}]*"AltitudeMax"\s+"([-\d.]+)"/)
  if (lower && existsSync(join(src, `${map}_lower.png`))) {
    copyFileSync(join(src, `${map}_lower.png`), join(out, `${map}_lower.png`))
    Object.assign(radar, { lower: `radars/${map}_lower.png`, split_z: Number(lower[1]) })
  }
  writeFileSync(join(out, `${map}.json`), JSON.stringify(radar))
  maps.push(map)
}
console.log(`${maps.length} radars → ${out}: ${maps.join(', ')}`)
