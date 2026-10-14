import type { Clip, Event, Nade, Side } from './types.js';
export interface DecodedPlayer {
    index: number;
    name: string;
    side: Side;
    /** Per frame; NaN where dead or absent. */
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    /** Degrees in [-180, 180). */
    yaw: Float32Array;
    alive: Uint8Array;
    hp: Int16Array;
    armor: Int16Array;
    /** Index into `weapons`, -1 for none. */
    weapon: Int16Array;
    /** Index into `places`, -1 for none. */
    place: Int16Array;
}
export interface DecodedNade {
    type: Nade['type'];
    by?: number;
    /** Absolute ticks and world positions of the flight. */
    t: Int32Array;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
}
export interface Shot {
    t: number;
    p: number;
    yaw: number;
}
/** A clip decoded for playback: absolute values, one entry per frame. */
export interface Replay {
    clip: Clip;
    tickrate: number;
    /** First and last frame tick. */
    start: number;
    end: number;
    step: number;
    frames: number;
    players: DecodedPlayer[];
    events: Event[];
    nades: DecodedNade[];
    shots: Shot[];
}
export interface PlayerState {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hp: number;
    armor: number;
    weapon: string;
    place: string;
}
export declare const wrapDeg: (a: number) => number;
/** Decode a clip into absolute, per-frame arrays. Throws on another major format version. */
export declare function decode(clip: Clip): Replay;
/** A player's state at tick `t` (fractional), interpolated between frames; null when dead or absent. */
export declare function stateAt(r: Replay, player: number, t: number): PlayerState | null;
