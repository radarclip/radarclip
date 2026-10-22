/** radarclip/1, see spec/radarclip-1.md. Times are ticks after the round's freeze end. */

export type Side = 'CT' | 'T'

export interface Clip {
  format: string
  map: string
  title?: string
  round: number
  winner: Side | null
  tickrate: number
  /** Tick of frame 0. */
  start: number
  /** Ticks between frames. */
  step: number
  frames: number
  quant: { xy: number; z: number; yaw: number }
  focus: number[]
  /** Areas to keep in view besides the focus players, e.g. where a grenade went off. */
  frame?: Area[]
  marks: Mark[]
  places: string[]
  weapons: string[]
  players: Player[]
  events: Event[]
  nades: Nade[]
  shots: Shots
  /** Knife slashes, hit or miss (stabs send no event; they show as knife hurts); left out when empty. */
  knife?: Shots
  /** Zeus shots (not in `shots`); left out when empty. */
  zeus?: Shots
  radar?: Radar
}

export interface Mark {
  t: number
  label: string
}

/** A circle on the map in world units. */
export interface Area {
  x: number
  y: number
  r: number
}

export interface Player {
  name: string
  side: Side
  track: Track
}

export interface Track {
  alive: number[]
  k: number[]
  x: number[]
  y: number[]
  z: number[]
  yaw: number[]
  hp: number[]
  armor: number[]
  weapon: number[]
  place: number[]
}

interface Pos {
  x: number
  y: number
  z: number
}

export type Event =
  | ({
      type: 'kill'; t: number; attacker?: number; victim: number; weapon: string; hs: boolean
      /** Optional, left out when they don't apply. */
      assister?: number; flashassist?: boolean; pen?: number; noscope?: boolean; smoke?: boolean; blind?: boolean
    } & Pos)
  | { type: 'hurt'; t: number; attacker?: number; victim: number; dmg: number; weapon: string }
  | { type: 'blind'; t: number; victim: number; by?: number; until: number }
  | ({ type: 'smoke' | 'molotov'; t: number; by?: number; until: number } & Pos)
  | ({ type: 'flash' | 'he' | 'plant'; t: number; by?: number } & Pos)
  | { type: 'defuse' | 'explode'; t: number; by?: number }
  /** A defuse attempt until it was finished, stopped, or ended by death, the explosion or the
   *  round end. `kit` and `done` are left out when false. */
  | { type: 'defusing'; t: number; by?: number; until: number; kit?: boolean; done?: boolean }
  /** A plant attempt until the bomb was planted (`done`) or the planter let go or died. */
  | { type: 'planting'; t: number; by?: number; until: number; done?: boolean }
  /** Who has the bomb: a pickup, or a drop with where the bomb lies. */
  | { type: 'pickup'; t: number; by?: number }
  | ({ type: 'drop'; t: number; by?: number } & Pos)

export interface Nade {
  type: 'smoke' | 'flash' | 'he' | 'molotov' | 'decoy'
  by?: number
  /** Δ-coded [t, x, y, z] quadruples. */
  path: number[]
}

export interface Shots {
  t: number[]
  p: number[]
  yaw: number[]
}

/** Radar image and the overview transform: radar px = ((x - pos_x) / scale, (pos_y - y) / scale) on 1024 px. */
export interface Radar {
  pos_x: number
  pos_y: number
  scale: number
  /** Height that splits the floors; below it a position is on the lower radar. */
  split_z?: number | null
  /** Image URL (or data URL) of the 1024 × 1024 radar. */
  image?: string
  lower?: string | null
}

/** radarclip-match/1, see spec/radarclip-match-1.md: a whole parsed match. */
export interface MatchFile {
  format: string
  map: string
  tickrate: number
  /** What made it, e.g. `radarclip 0.1.0`. */
  parser?: string
  players: MatchPlayer[]
  rounds: MatchRound[]
}

export interface MatchPlayer {
  /** Steam64 id, or the name when the demo has none. */
  key: string
  name: string
}

export interface MatchRound {
  number: number
  /** From freeze end to round end. */
  seconds: number
  winner?: Side | null
  /** `MatchPlayer.key` of each of `clip.players`, in the same order. */
  keys: string[]
  /** The full round. */
  clip: Clip
  /** Loadouts, money, sight and defuse attempts, on the clip's frames. */
  detail?: Detail
}

/** Per-round detail of a match (see spec/radarclip-match-1.md). */
export interface Detail {
  /** Loadouts by index: item names as the game calls them, sorted. */
  gear: string[][]
  /** One per clip player, same order as `clip.players`. */
  players: PlayerDetail[]
  defuses?: Defuse[]
  /** Every kill with both players exactly where they were. */
  kills?: Hit[]
  /** Every hit, the same way. */
  hits?: Hit[]
}

/** `[x, y, z, yaw]`: game units and whole degrees. */
export type Pose = [number, number, number, number]

/** A kill or hit with exact positions; `t` in ticks after the round's freeze end. */
export interface Hit {
  t: number
  victim: number
  attacker?: number
  /** The victim. */
  at: Pose
  /** The attacker; absent for world damage. */
  from?: Pose
}

/** Change lists `[frame, value, …]` on the round clip's frames. */
export interface PlayerDetail {
  /** Index into `Detail.gear`. */
  gear: number[]
  money: number[]
  /** Value of what the player carries. */
  equip: number[]
  /** 0 or 1. */
  helmet: number[]
  /** Defuse kit, 0 or 1. */
  kit: number[]
  /** Bit mask of the clip players who have this player in sight (bit i = `clip.players[i]`). */
  seen: number[]
}

/** One defuse attempt; `t` and `end` in ticks after the round's freeze end. */
export interface Defuse {
  t: number
  by?: number
  kit: boolean
  end: number
  /** The attempt defused the bomb. */
  done?: boolean
}
