/** radarclip/1, see spec/radarclip-1.md. Times are ticks after the round's freeze end. */
export type Side = 'CT' | 'T';
export interface Clip {
    format: string;
    map: string;
    title?: string;
    round: number;
    winner: Side | null;
    tickrate: number;
    /** Tick of frame 0. */
    start: number;
    /** Ticks between frames. */
    step: number;
    frames: number;
    quant: {
        xy: number;
        z: number;
        yaw: number;
    };
    focus: number[];
    marks: Mark[];
    places: string[];
    weapons: string[];
    players: Player[];
    events: Event[];
    nades: Nade[];
    shots: Shots;
    radar?: Radar;
}
export interface Mark {
    t: number;
    label: string;
}
export interface Player {
    name: string;
    side: Side;
    track: Track;
}
export interface Track {
    alive: number[];
    k: number[];
    x: number[];
    y: number[];
    z: number[];
    yaw: number[];
    hp: number[];
    armor: number[];
    weapon: number[];
    place: number[];
}
interface Pos {
    x: number;
    y: number;
    z: number;
}
export type Event = ({
    type: 'kill';
    t: number;
    attacker?: number;
    victim: number;
    weapon: string;
    hs: boolean;
} & Pos) | {
    type: 'hurt';
    t: number;
    attacker?: number;
    victim: number;
    dmg: number;
    weapon: string;
} | {
    type: 'blind';
    t: number;
    victim: number;
    by?: number;
    until: number;
} | ({
    type: 'smoke' | 'molotov';
    t: number;
    by?: number;
    until: number;
} & Pos) | ({
    type: 'flash' | 'he' | 'plant';
    t: number;
    by?: number;
} & Pos) | {
    type: 'defuse' | 'explode';
    t: number;
    by?: number;
};
export interface Nade {
    type: 'smoke' | 'flash' | 'he' | 'molotov' | 'decoy';
    by?: number;
    /** Δ-coded [t, x, y, z] quadruples. */
    path: number[];
}
export interface Shots {
    t: number[];
    p: number[];
    yaw: number[];
}
/** Radar image and the overview transform: radar px = ((x - pos_x) / scale, (pos_y - y) / scale) on 1024 px. */
export interface Radar {
    pos_x: number;
    pos_y: number;
    scale: number;
    /** Height that splits the floors; below it a position is on the lower radar. */
    split_z?: number | null;
    /** Image URL (or data URL) of the 1024 × 1024 radar. */
    image?: string;
    lower?: string | null;
}
export {};
