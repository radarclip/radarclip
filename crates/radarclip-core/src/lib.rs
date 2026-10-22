//! The radarclip/1 format: types, track encoding (quantisation, Δ-coding, keyframes) and
//! decoding. See `spec/radarclip-1.md`.

use serde::{Deserialize, Serialize};

mod cut;
pub use cut::{cut, Cut};

/// Format of a whole parsed match: every round as a full-round clip.
pub const MATCH_FORMAT: &str = "radarclip-match/1";

/// A whole parsed match (`radarclip-match/1`): every round as a full-round clip, so apps can
/// reopen a match and cut moments out of it without the demo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchFile {
    pub format: String,
    pub map: String,
    pub tickrate: u32,
    /// What made it, e.g. `radarclip 0.1.0`, so apps can offer a re-parse after parser updates.
    #[serde(default)]
    pub parser: String,
    pub players: Vec<MatchPlayer>,
    pub rounds: Vec<MatchRound>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchPlayer {
    /// Steam64 id, or the name when the demo has none.
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchRound {
    pub number: u32,
    /// From freeze end to round end.
    pub seconds: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winner: Option<String>,
    /// `MatchPlayer::key` of each of `clip.players`, in the same order.
    pub keys: Vec<String>,
    pub clip: Clip,
    /// What a replay doesn't have to draw but an analysis or a HUD can use; on the clip's frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Detail>,
}

/// Per-round detail of a match: loadouts, money, sight and defuse attempts.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Detail {
    /// Loadouts by index: item names as the game calls them, sorted (a second flashbang is
    /// listed twice).
    pub gear: Vec<Vec<String>>,
    /// One per clip player, same order as `clip.players`.
    pub players: Vec<PlayerDetail>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub defuses: Vec<Defuse>,
    /// Every kill with both players exactly where they were, from the game event.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kills: Vec<Hit>,
    /// Every hit, the same way.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hits: Vec<Hit>,
}

/// A kill or hit with the exact positions and view directions of both players at that tick
/// (clip frames are sampled, so a fast turn just before can fall between two frames).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hit {
    /// Tick after the round's freeze end, like clip events.
    pub t: i64,
    pub victim: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker: Option<u32>,
    /// Victim: x, y, z (game units), yaw (degrees).
    pub at: [i64; 4],
    /// Attacker, the same way; absent for world damage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<[i64; 4]>,
}

/// Change lists (`[frame, value, frame, value, …]`) on the round clip's frames. Values hold
/// while the player is dead.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PlayerDetail {
    /// Index into `Detail::gear`.
    pub gear: Vec<i64>,
    pub money: Vec<i64>,
    /// Value of what the player carries, as the game counts it.
    pub equip: Vec<i64>,
    /// 0 or 1.
    pub helmet: Vec<i64>,
    /// Defuse kit, 0 or 1.
    pub kit: Vec<i64>,
    /// Bit mask of the clip players who have this player in sight (bit i = `clip.players[i]`),
    /// from the game's own spotting.
    pub seen: Vec<i64>,
}

/// One defuse attempt: from the start until it was finished, stopped, or ended by death, the
/// explosion or the round end.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Defuse {
    /// Tick after the round's freeze end, like clip events.
    pub t: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<u32>,
    pub kit: bool,
    pub end: i64,
    /// The attempt defused the bomb.
    #[serde(default, skip_serializing_if = "is_false")]
    pub done: bool,
}

/// A change list from one value per frame: `[frame, value, …]` wherever the value changes;
/// `None` (no data) keeps the last value.
pub fn change_list(values: impl IntoIterator<Item = Option<i64>>) -> Vec<i64> {
    let mut out = vec![];
    let mut last = None;
    for (f, v) in values.into_iter().enumerate() {
        if let Some(v) = v {
            if last != Some(v) {
                out.push(f as i64);
                out.push(v);
                last = Some(v);
            }
        }
    }
    out
}

pub const FORMAT: &str = "radarclip/1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Clip {
    pub format: String,
    pub map: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    pub round: u32,
    pub winner: Option<String>,
    pub tickrate: u32,
    pub start: i64,
    pub step: u32,
    pub frames: u32,
    pub quant: Quant,
    pub focus: Vec<u32>,
    /// Areas to keep in view besides the focus players, e.g. where a grenade went off.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frame: Vec<Area>,
    pub marks: Vec<Mark>,
    pub places: Vec<String>,
    pub weapons: Vec<String>,
    pub players: Vec<Player>,
    pub events: Vec<Event>,
    pub nades: Vec<Nade>,
    pub shots: Shots,
    /// Knife slashes, hit or miss; same shape as `shots`. Stabs send no `weapon_fire`: they show
    /// only as knife hurts.
    #[serde(default, skip_serializing_if = "Shots::is_empty")]
    pub knife: Shots,
    /// Zeus shots; same shape as `shots`, which leaves them out.
    #[serde(default, skip_serializing_if = "Shots::is_empty")]
    pub zeus: Shots,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Quant {
    pub xy: u32,
    pub z: u32,
    pub yaw: u32,
}

impl Default for Quant {
    fn default() -> Self {
        Quant { xy: 4, z: 8, yaw: 2 }
    }
}

/// How far interpolation between keyframes may miss a dropped frame.
#[derive(Debug, Clone, Copy)]
pub struct Tolerance {
    pub xy: f32,
    pub yaw: f32,
}

impl Default for Tolerance {
    fn default() -> Self {
        Tolerance { xy: 8.0, yaw: 6.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mark {
    pub t: i64,
    pub label: String,
}

/// A circle on the map in world units.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Area {
    pub x: i64,
    pub y: i64,
    pub r: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Player {
    pub name: String,
    pub side: String,
    pub track: Track,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Track {
    pub alive: Vec<u32>,
    pub k: Vec<i64>,
    pub x: Vec<i64>,
    pub y: Vec<i64>,
    pub z: Vec<i64>,
    pub yaw: Vec<i64>,
    pub hp: Vec<i64>,
    pub armor: Vec<i64>,
    pub weapon: Vec<i64>,
    pub place: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Event {
    Kill {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attacker: Option<u32>,
        victim: u32,
        weapon: String,
        hs: bool,
        x: i64,
        y: i64,
        z: i64,
        /// The player credited with the assist.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assister: Option<u32>,
        /// The assist was a flash.
        #[serde(default, skip_serializing_if = "is_false")]
        flashassist: bool,
        /// Surfaces the bullet went through (a wallbang when above 0).
        #[serde(default, skip_serializing_if = "is_zero")]
        pen: u32,
        #[serde(default, skip_serializing_if = "is_false")]
        noscope: bool,
        /// Shot through a smoke.
        #[serde(default, skip_serializing_if = "is_false")]
        smoke: bool,
        /// The attacker was blind.
        #[serde(default, skip_serializing_if = "is_false")]
        blind: bool,
    },
    Hurt {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attacker: Option<u32>,
        victim: u32,
        dmg: i64,
        weapon: String,
    },
    Blind {
        t: i64,
        victim: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<u32>,
        until: i64,
    },
    Smoke { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32>, until: i64, x: i64, y: i64, z: i64 },
    Molotov { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32>, until: i64, x: i64, y: i64, z: i64 },
    Flash { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32>, x: i64, y: i64, z: i64 },
    He { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32>, x: i64, y: i64, z: i64 },
    Plant { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32>, x: i64, y: i64, z: i64 },
    Defuse { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32> },
    Explode { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32> },
    /// A defuse attempt from its start until it was finished, stopped, or ended by the
    /// defuser's death, the explosion or the round end.
    Defusing {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<u32>,
        until: i64,
        /// The defuser had a kit (5 s instead of 10 s).
        #[serde(default, skip_serializing_if = "is_false")]
        kit: bool,
        /// The attempt defused the bomb.
        #[serde(default, skip_serializing_if = "is_false")]
        done: bool,
    },
    /// A plant attempt from its start until the bomb was planted, or the planter let go or died.
    Planting {
        t: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<u32>,
        until: i64,
        /// The attempt planted the bomb.
        #[serde(default, skip_serializing_if = "is_false")]
        done: bool,
    },
    /// A player picked up the bomb (also when it is handed out at round start).
    Pickup { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32> },
    /// A player dropped the bomb; x/y/z is where it lies.
    Drop { t: i64, #[serde(default, skip_serializing_if = "Option::is_none")] by: Option<u32>, x: i64, y: i64, z: i64 },
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

impl Event {
    pub fn t(&self) -> i64 {
        match self {
            Event::Kill { t, .. } | Event::Hurt { t, .. } | Event::Blind { t, .. } | Event::Smoke { t, .. }
            | Event::Molotov { t, .. } | Event::Flash { t, .. } | Event::He { t, .. } | Event::Plant { t, .. }
            | Event::Defuse { t, .. } | Event::Explode { t, .. } | Event::Defusing { t, .. } | Event::Planting { t, .. }
            | Event::Pickup { t, .. } | Event::Drop { t, .. } => *t,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Nade {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<u32>,
    pub path: Vec<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Shots {
    pub t: Vec<i64>,
    pub p: Vec<u32>,
    pub yaw: Vec<i64>,
}

impl Shots {
    pub fn is_empty(&self) -> bool {
        self.t.is_empty()
    }

    /// Δ-codes `(t, p, yaw)` rows sorted by `t`.
    pub fn encode(mut rows: Vec<(i64, u32, i64)>) -> Shots {
        rows.sort_by_key(|s| s.0);
        let mut out = Shots::default();
        let mut prev = 0;
        for (t, p, yaw) in rows {
            out.t.push(t - prev);
            prev = t;
            out.p.push(p);
            out.yaw.push(yaw);
        }
        out
    }

    /// The rows with `t` inside `t0..=t1`, Δ-coded again.
    pub fn within(&self, t0: i64, t1: i64) -> Shots {
        let mut out = Shots::default();
        let (mut t, mut prev) = (0i64, 0i64);
        for (i, dt) in self.t.iter().enumerate() {
            t += dt;
            if (t0..=t1).contains(&t) {
                out.t.push(t - prev);
                prev = t;
                out.p.push(self.p[i]);
                out.yaw.push(self.yaw[i]);
            }
        }
        out
    }
}

/// One player at one frame, as read from the demo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub hp: i64,
    pub armor: i64,
    /// Index into `Clip::weapons`, -1 for none.
    pub weapon: i64,
    /// Index into `Clip::places`, -1 for none.
    pub place: i64,
}

/// Running Δ-coder: `push(v)` appends `v - previous`.
#[derive(Default)]
struct Delta {
    prev: i64,
}

impl Delta {
    fn push(&mut self, out: &mut Vec<i64>, v: i64) {
        out.push(v - self.prev);
        self.prev = v;
    }
}

/// Wrap an angle in degrees into [-180, 180).
pub fn wrap_deg(a: f32) -> f32 {
    (a + 180.0).rem_euclid(360.0) - 180.0
}

/// Encode one player's frames (`None` = dead or absent) into a track.
pub fn encode_track(frames: &[Option<Sample>], quant: Quant, tol: Tolerance) -> Track {
    let mut tr = Track::default();
    let mut keep = vec![false; frames.len()];

    // Alive spans: keyframes at both ends, the rest only where interpolation misses.
    let mut f = 0;
    while f < frames.len() {
        if frames[f].is_none() {
            f += 1;
            continue;
        }
        let a = f;
        while f < frames.len() && frames[f].is_some() {
            f += 1;
        }
        let b = f - 1;
        tr.alive.push(a as u32);
        if f < frames.len() {
            tr.alive.push(f as u32);
        }
        keep[a] = true;
        keep[b] = true;
        refine(frames, &mut keep, a, b, tol);
    }

    let (mut k, mut x, mut y, mut z, mut yaw) = (Delta::default(), Delta::default(), Delta::default(), Delta::default(), Delta::default());
    let yaw_steps = (360 / quant.yaw) as i64;
    for (i, s) in frames.iter().enumerate() {
        let Some(s) = s else { continue };
        if !keep[i] {
            continue;
        }
        k.push(&mut tr.k, i as i64);
        x.push(&mut tr.x, (s.x / quant.xy as f32).round() as i64);
        y.push(&mut tr.y, (s.y / quant.xy as f32).round() as i64);
        z.push(&mut tr.z, (s.z / quant.z as f32).round() as i64);
        // Yaw steps wrap: store the shortest turn so 179° → -179° is +1 step, not -179.
        let q = (wrap_deg(s.yaw) / quant.yaw as f32).round() as i64;
        let d = (q - yaw.prev + yaw_steps / 2).rem_euclid(yaw_steps) - yaw_steps / 2;
        tr.yaw.push(d);
        yaw.prev += d;
    }

    let mut last = [None::<i64>; 4];
    for (i, s) in frames.iter().enumerate() {
        let Some(s) = s else { continue };
        for (slot, (list, v)) in [(&mut tr.hp, s.hp), (&mut tr.armor, s.armor), (&mut tr.weapon, s.weapon), (&mut tr.place, s.place)]
            .into_iter()
            .enumerate()
        {
            if last[slot] != Some(v) {
                list.push(i as i64);
                list.push(v);
                last[slot] = Some(v);
            }
        }
    }
    tr
}

/// Douglas–Peucker over one alive span: keep the frame interpolation misses most, recurse.
fn refine(frames: &[Option<Sample>], keep: &mut [bool], a: usize, b: usize, tol: Tolerance) {
    if b <= a + 1 {
        return;
    }
    let (sa, sb) = (frames[a].unwrap(), frames[b].unwrap());
    let mut worst = (1.0f32, None);
    for i in a + 1..b {
        let s = frames[i].unwrap();
        let p = lerp(&sa, &sb, (i - a) as f32 / (b - a) as f32);
        let pos = (p.x - s.x).abs().max((p.y - s.y).abs()).max((p.z - s.z).abs()) / tol.xy;
        let ang = wrap_deg(p.yaw - s.yaw).abs() / tol.yaw;
        let score = pos.max(ang);
        if score > worst.0 {
            worst = (score, Some(i));
        }
    }
    if let (_, Some(i)) = worst {
        keep[i] = true;
        refine(frames, keep, a, i, tol);
        refine(frames, keep, i, b, tol);
    }
}

/// Position and yaw between two samples; yaw turns the short way round.
pub fn lerp(a: &Sample, b: &Sample, t: f32) -> Sample {
    Sample {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: wrap_deg(a.yaw + wrap_deg(b.yaw - a.yaw) * t),
        ..*a
    }
}

/// Decode a track back into one sample per frame (the reference decoder).
pub fn decode_track(tr: &Track, frames: u32, quant: Quant) -> Vec<Option<Sample>> {
    let n = frames as usize;
    let mut alive = vec![false; n];
    let mut state = false;
    let mut toggles = tr.alive.iter().map(|&f| f as usize).peekable();
    for (f, a) in alive.iter_mut().enumerate() {
        while toggles.peek() == Some(&f) {
            state = !state;
            toggles.next();
        }
        *a = state;
    }

    let mut keys: Vec<(usize, Sample)> = Vec::with_capacity(tr.k.len());
    let (mut f, mut x, mut y, mut z, mut yaw) = (0i64, 0i64, 0i64, 0i64, 0i64);
    for i in 0..tr.k.len() {
        f += tr.k[i];
        x += tr.x[i];
        y += tr.y[i];
        z += tr.z[i];
        yaw += tr.yaw[i];
        keys.push((f as usize, Sample {
            x: (x * quant.xy as i64) as f32,
            y: (y * quant.xy as i64) as f32,
            z: (z * quant.z as i64) as f32,
            yaw: wrap_deg((yaw * quant.yaw as i64) as f32),
            hp: 0, armor: 0, weapon: -1, place: -1,
        }));
    }

    let mut out = vec![None; n];
    for w in keys.windows(2) {
        let ((fa, a), (fb, b)) = (w[0], w[1]);
        if !(fa..=fb).all(|i| i < n && alive[i]) {
            continue;
        }
        for i in fa..=fb {
            out[i] = Some(lerp(&a, &b, if fb == fa { 0.0 } else { (i - fa) as f32 / (fb - fa) as f32 }));
        }
    }
    for &(fk, s) in &keys {
        if fk < n && alive[fk] && out[fk].is_none() {
            out[fk] = Some(s);
        }
    }

    let apply = |list: &[i64], set: &mut dyn FnMut(&mut Sample, i64), out: &mut Vec<Option<Sample>>| {
        let mut v = -1;
        let mut changes = list.chunks(2).peekable();
        for (i, s) in out.iter_mut().enumerate() {
            while let Some(c) = changes.peek() {
                if c[0] as usize > i {
                    break;
                }
                v = c[1];
                changes.next();
            }
            if let Some(s) = s {
                set(s, v);
            }
        }
    };
    apply(&tr.hp, &mut |s, v| s.hp = v, &mut out);
    apply(&tr.armor, &mut |s, v| s.armor = v, &mut out);
    apply(&tr.weapon, &mut |s, v| s.weapon = v, &mut out);
    apply(&tr.place, &mut |s, v| s.place = v, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(x: f32, y: f32, yaw: f32, hp: i64) -> Option<Sample> {
        Some(Sample { x, y, z: 0.0, yaw, hp, armor: 100, weapon: 0, place: 1 })
    }

    #[test]
    fn straight_run_needs_two_keyframes() {
        let frames: Vec<_> = (0..50).map(|i| sample(i as f32 * 30.0, 100.0, 90.0, 100)).collect();
        let tr = encode_track(&frames, Quant::default(), Tolerance::default());
        assert_eq!(tr.k.len(), 2);
        assert_eq!(tr.alive, vec![0]);
    }

    #[test]
    fn roundtrip_stays_within_tolerance() {
        let mut frames: Vec<_> = (0..200)
            .map(|i| {
                let t = i as f32 / 10.0;
                sample(t.sin() * 900.0 + t * 40.0, t.cos() * 600.0, wrap_deg(t * 70.0), 100 - (i / 20) as i64)
            })
            .collect();
        for f in &mut frames[120..140] {
            *f = None; // dead, then alive again
        }
        let (q, tol) = (Quant::default(), Tolerance::default());
        let tr = encode_track(&frames, q, tol);
        let back = decode_track(&tr, frames.len() as u32, q);
        for (a, b) in frames.iter().zip(&back) {
            match (a, b) {
                (None, None) => {}
                (Some(a), Some(b)) => {
                    assert!((a.x - b.x).abs() <= tol.xy + q.xy as f32, "x {} vs {}", a.x, b.x);
                    assert!((a.y - b.y).abs() <= tol.xy + q.xy as f32);
                    assert!(wrap_deg(a.yaw - b.yaw).abs() <= tol.yaw + q.yaw as f32, "yaw {} vs {}", a.yaw, b.yaw);
                    assert_eq!((a.hp, a.armor, a.weapon, a.place), (b.hp, b.armor, b.weapon, b.place));
                }
                _ => panic!("alive mismatch"),
            }
        }
        assert!(tr.k.len() < frames.len() / 2, "{} keyframes", tr.k.len());
    }

    #[test]
    fn yaw_wraps_the_short_way() {
        let frames = vec![sample(0.0, 0.0, 178.0, 100), sample(0.0, 0.0, -178.0, 100)];
        let tr = encode_track(&frames, Quant::default(), Tolerance::default());
        assert_eq!(tr.yaw, vec![89, 2]);
    }

    #[test]
    fn events_serialise_with_type_tag() {
        let e = Event::Defuse { t: 10, by: None };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"type":"defuse","t":10}"#);
    }

    #[test]
    fn defusing_leaves_out_what_does_not_apply() {
        let e = Event::Defusing { t: 10, by: Some(2), until: 90, kit: false, done: false };
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#"{"type":"defusing","t":10,"by":2,"until":90}"#);
        assert_eq!(serde_json::from_str::<Event>(&json).unwrap(), e);
        let done = Event::Defusing { t: 10, by: None, until: 330, kit: true, done: true };
        assert_eq!(serde_json::to_string(&done).unwrap(), r#"{"type":"defusing","t":10,"until":330,"kit":true,"done":true}"#);
    }

    #[test]
    fn bomb_events_serialise() {
        let plant = Event::Planting { t: 10, by: Some(1), until: 210, done: true };
        assert_eq!(serde_json::to_string(&plant).unwrap(), r#"{"type":"planting","t":10,"by":1,"until":210,"done":true}"#);
        let fake = Event::Planting { t: 10, by: Some(1), until: 70, done: false };
        assert_eq!(serde_json::to_string(&fake).unwrap(), r#"{"type":"planting","t":10,"by":1,"until":70}"#);
        assert_eq!(serde_json::to_string(&Event::Pickup { t: -5, by: Some(2) }).unwrap(), r#"{"type":"pickup","t":-5,"by":2}"#);
        let drop = Event::Drop { t: 40, by: Some(2), x: 1, y: 2, z: 3 };
        assert_eq!(serde_json::to_string(&drop).unwrap(), r#"{"type":"drop","t":40,"by":2,"x":1,"y":2,"z":3}"#);
        for e in [plant, fake, drop] {
            assert_eq!(serde_json::from_str::<Event>(&serde_json::to_string(&e).unwrap()).unwrap(), e);
        }
    }
}
