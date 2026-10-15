//! Cutting a shorter clip out of a longer one, e.g. a moment out of a stored full round, without
//! going back to the demo.

use crate::{decode_track, encode_track, Clip, Event, Mark, Nade, Player, Shots, Tolerance};

/// What to cut. Times in ticks after the round's freeze end, like everything in a clip.
#[derive(Debug, Clone, Default)]
pub struct Cut {
    pub from: i64,
    pub to: i64,
    /// Indices into the clip's players; the first is the player the clip is about.
    pub focus: Vec<u32>,
    pub marks: Vec<Mark>,
    /// `None` keeps the source clip's title.
    pub title: Option<String>,
    /// Name players by side and number ("CT 1" … "T 5").
    pub anonymize: bool,
}

/// Tracks are re-encoded from frames that are already keyframe-interpolated, so a tight
/// tolerance keeps the original keyframes and adds no visible error.
const RECUT: Tolerance = Tolerance { xy: 1.0, yaw: 1.0 };

/// Cut `c.from..=c.to` out of `clip`, with the same rules the parser uses for a window: kills,
/// a plant and smokes or fires still burning from earlier in the round stay; everything else
/// (hurts, blinds, pops, shots, grenade flights) only inside the window.
pub fn cut(clip: &Clip, c: &Cut) -> Result<Clip, String> {
    let step = clip.step as i64;
    let last = clip.start + (clip.frames as i64 - 1) * step;
    let (from, to) = (c.from.max(clip.start), c.to.min(last));
    let first = (from - clip.start + step - 1).div_euclid(step);
    let end = (to - clip.start).div_euclid(step);
    if clip.frames == 0 || end < first {
        return Err(format!("empty window {}–{} ticks (clip covers {}–{})", c.from, c.to, clip.start, last));
    }
    if let Some(&bad) = c.focus.iter().find(|&&f| f as usize >= clip.players.len()) {
        return Err(format!("focus player {bad} not in the clip ({} players)", clip.players.len()));
    }
    let (i0, i1) = (first as usize, end as usize);
    let (t0, t1) = (from, to);

    let mut sides: Vec<(String, u32)> = vec![];
    let players = clip
        .players
        .iter()
        .map(|p| {
            let frames = decode_track(&p.track, clip.frames, clip.quant);
            let name = if c.anonymize {
                let n = match sides.iter_mut().find(|(s, _)| *s == p.side) {
                    Some((_, n)) => {
                        *n += 1;
                        *n
                    }
                    None => {
                        sides.push((p.side.clone(), 1));
                        1
                    }
                };
                format!("{} {n}", p.side)
            } else {
                p.name.clone()
            };
            Player { name, side: p.side.clone(), track: encode_track(&frames[i0..=i1], clip.quant, RECUT) }
        })
        .collect();

    let events = clip
        .events
        .iter()
        .filter(|e| match e {
            Event::Kill { t, .. } | Event::Plant { t, .. } => *t <= t1,
            Event::Smoke { t, until, .. } | Event::Molotov { t, until, .. } => *t <= t1 && *until >= t0,
            e => (t0..=t1).contains(&e.t()),
        })
        .cloned()
        .collect();

    let nades = clip
        .nades
        .iter()
        .filter_map(|n| {
            let (mut abs, mut path) = ([0i64; 4], vec![]);
            let mut prev = [0i64; 4];
            for q in n.path.chunks_exact(4) {
                for k in 0..4 {
                    abs[k] += q[k];
                }
                if (t0..=t1).contains(&abs[0]) {
                    for k in 0..4 {
                        path.push(abs[k] - prev[k]);
                        prev[k] = abs[k];
                    }
                }
            }
            (!path.is_empty()).then(|| Nade { kind: n.kind.clone(), by: n.by, path })
        })
        .collect();

    let mut shots = Shots::default();
    let (mut t, mut prev) = (0i64, 0i64);
    for (i, dt) in clip.shots.t.iter().enumerate() {
        t += dt;
        if (t0..=t1).contains(&t) {
            shots.t.push(t - prev);
            prev = t;
            shots.p.push(clip.shots.p[i]);
            shots.yaw.push(clip.shots.yaw[i]);
        }
    }

    Ok(Clip {
        title: c.title.clone().unwrap_or_else(|| clip.title.clone()),
        start: clip.start + first * step,
        frames: (end - first + 1) as u32,
        focus: c.focus.clone(),
        marks: c.marks.clone(),
        players,
        events,
        nades,
        shots,
        ..clip.clone()
    })
}
