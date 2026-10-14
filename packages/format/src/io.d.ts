import type { Clip } from './types.js';
export declare const MEDIA_TYPE = "application/vnd.radarclip";
export declare const JSON_MEDIA_TYPE = "application/vnd.radarclip+json";
/** Read a clip from `.radarclip` (raw deflate) or `.radarclip.json` bytes, a string, or a Blob. */
export declare function readClip(data: Uint8Array | ArrayBuffer | Blob | string): Promise<Clip>;
/** Serialise a clip: raw deflate (`.radarclip`, default) or plain JSON (`.radarclip.json`). */
export declare function writeClip(clip: Clip, { deflate }?: {
    deflate?: boolean | undefined;
}): Promise<Uint8Array>;
/** Structural checks a player relies on; throws with the first problem found. */
export declare function check(value: unknown): Clip;
