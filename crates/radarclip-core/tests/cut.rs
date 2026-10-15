//! Cutting a moment out of a stored full round must give what cutting from the demo gives:
//! the same positions (within a unit), the same window rules for events.

use radarclip_core::{cut, decode_track, Clip, Cut, Event};

fn nuke() -> Clip {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/fixtures/nuke-r2-full.radarclip.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn keeps_positions_frame_by_frame() {
    let round = nuke();
    let (from, to) = (10 * round.tickrate as i64, 20 * round.tickrate as i64);
    let part = cut(&round, &Cut { from, to, ..Default::default() }).unwrap();
    // The cut starts at the round's first frame at or after `from` (frames sit on the round's grid).
    let step = round.step as i64;
    assert!(part.start >= from && part.start < from + step && (part.start - round.start) % step == 0);
    assert_eq!(part.frames as i64, (to - part.start) / step + 1);
    let offset = ((part.start - round.start) / step) as usize;
    for (a, b) in round.players.iter().zip(&part.players) {
        let full = decode_track(&a.track, round.frames, round.quant);
        let cut = decode_track(&b.track, part.frames, part.quant);
        for (f, s) in cut.iter().enumerate() {
            match (full[offset + f], s) {
                (None, None) => {}
                (Some(x), Some(y)) => {
                    assert!((x.x - y.x).abs() <= 2.0 && (x.y - y.y).abs() <= 2.0, "{} frame {f}: {x:?} vs {y:?}", a.name);
                    assert_eq!((x.hp, x.armor, x.weapon, x.place), (y.hp, y.armor, y.weapon, y.place));
                }
                (x, y) => panic!("{} frame {f}: alive differs ({x:?} vs {y:?})", a.name),
            }
        }
    }
}

#[test]
fn keeps_earlier_kills_and_burning_smokes_but_only_window_hits() {
    let round = nuke();
    let (from, to) = (15 * round.tickrate as i64, 25 * round.tickrate as i64);
    let part = cut(&round, &Cut { from, to, ..Default::default() }).unwrap();
    for e in &part.events {
        match e {
            Event::Kill { t, .. } | Event::Plant { t, .. } => assert!(*t <= to),
            Event::Smoke { t, until, .. } | Event::Molotov { t, until, .. } => assert!(*t <= to && *until >= from),
            e => assert!((from..=to).contains(&e.t()), "{e:?} outside the window"),
        }
    }
    let kills = |c: &Clip| c.events.iter().filter(|e| matches!(e, Event::Kill { t, .. } if *t <= to)).count();
    assert_eq!(kills(&part), kills(&round), "kills before the window must stay on the map");
    let shots = part.shots.t.iter().scan(0, |t, d| {
        *t += d;
        Some(*t)
    });
    assert!(shots.into_iter().all(|t| (from..=to).contains(&t)));
}

#[test]
fn renames_and_focuses_like_the_parser() {
    let round = nuke();
    let part = cut(&round, &Cut { from: 0, to: 640, focus: vec![2], anonymize: true, title: Some("t".into()), ..Default::default() }).unwrap();
    assert_eq!(part.focus, vec![2]);
    assert_eq!(part.title, "t");
    let names: Vec<&str> = part.players.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["CT 1", "CT 2", "CT 3", "CT 4", "CT 5", "T 1", "T 2", "T 3", "T 4", "T 5"]);
    assert!(cut(&round, &Cut { from: 0, to: 640, focus: vec![10], ..Default::default() }).is_err());
    assert!(cut(&round, &Cut { from: 50_000, to: 60_000, ..Default::default() }).is_err());
}

#[test]
fn whole_round_cut_is_the_round() {
    let round = nuke();
    let last = round.start + (round.frames as i64 - 1) * round.step as i64;
    let again = cut(&round, &Cut { from: round.start, to: last, focus: round.focus.clone(), marks: round.marks.clone(), ..Default::default() }).unwrap();
    assert_eq!((again.start, again.frames), (round.start, round.frames));
    assert_eq!(again.events, round.events);
    assert_eq!(again.nades, round.nades);
    assert_eq!(again.shots, round.shots);
}
