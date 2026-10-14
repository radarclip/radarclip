import type { Radar } from '@radarclip/format'
import data from './overviews.json' with { type: 'json' }

export interface Overview {
  name: string
  pos_x: number
  pos_y: number
  scale: number
  /** Below this height a position is on the lower radar (Nuke, Train, Vertigo, …). */
  split_z?: number
}

export const overviews: Record<string, Overview> = data

/**
 * Where radar images are fetched from: `<base>/<map>_radar_psd.png` and
 * `<base>/<map>_lower_radar_psd.png`. The default is MurkyYT/cs2-map-icons, which extracts them
 * from the game files. The images are Valve's; this package ships only the overview numbers.
 */
export const DEFAULT_BASE = 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars'

/** Radar for a map, or undefined when the map is unknown. */
export function radar(map: string, base = DEFAULT_BASE): Radar | undefined {
  const o = overviews[map]
  if (!o) return undefined
  const b = base.replace(/\/$/, '')
  return {
    pos_x: o.pos_x,
    pos_y: o.pos_y,
    scale: o.scale,
    split_z: o.split_z ?? null,
    image: `${b}/${map}_radar_psd.png`,
    lower: o.split_z != null ? `${b}/${map}_lower_radar_psd.png` : null,
  }
}

/** A resolver for `RadarclipPlayer`'s `radar` option or `RadarclipPlayer.radarResolver`. */
export const radars = (base = DEFAULT_BASE) => (map: string) => radar(map, base)
