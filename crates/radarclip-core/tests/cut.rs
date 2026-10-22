//! Cutting a moment out of a stored full round must give what cutting from the demo gives:
//! the same positions (within a unit), the same window rules for events.

use radarclip_core::{cut, decode_track, Area, Clip, Cut, Event, Shots};

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
            Event::Smoke { t, until, .. } | Event::Molotov { t, until, .. } | Event::Defusing { t, until, .. } | Event::Planting { t, until, .. } => {
                assert!(*t <= to && *until >= from)
            }
            Event::Pickup { .. } | Event::Drop { .. } => {}
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
fn keeps_frame_areas_and_leaves_them_out_when_empty() {
    let round = nuke();
    let frame = vec![Area { x: -400, y: -1200, r: 1700 }];
    let part = cut(&round, &Cut { from: 0, to: 640, frame: frame.clone(), ..Default::default() }).unwrap();
    assert_eq!(part.frame, frame);
    let json = serde_json::to_value(&part).unwrap();
    assert_eq!(json["frame"], serde_json::json!([{"x": -400, "y": -1200, "r": 1700}]));
    let plain = cut(&round, &Cut { from: 0, to: 640, ..Default::default() }).unwrap();
    assert!(serde_json::to_value(&plain).unwrap().get("frame").is_none());
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

#[test]
fn keeps_a_defuse_attempt_while_it_runs() {
    let round = nuke();
    let attempt = round.events.iter().find(|e| matches!(e, Event::Defusing { .. })).expect("Nuke R2 has a defuse").clone();
    let Event::Defusing { t, until, .. } = attempt else { unreachable!() };
    let has = |from, to| cut(&round, &Cut { from, to, ..Default::default() }).unwrap().events.contains(&attempt);
    assert!(has(t + 64, until - 64), "an attempt started before the window stays");
    assert!(has(until - 64, until + 640));
    assert!(!has(t - 640, t - 64), "not before it starts");
    assert!(!has(until + 64, until + 640), "not after it ended");
}

#[test]
fn keeps_who_has_the_bomb() {
    let round = nuke();
    let carry = |c: &Clip| c.events.iter().filter(|e| matches!(e, Event::Pickup { .. } | Event::Drop { .. })).cloned().collect::<Vec<_>>();
    let all = carry(&round);
    assert!(!all.is_empty() && all[0].t() < 0, "the bomb is handed out in freeze time");
    for from in [0, 10 * 64, 40 * 64] {
        let part = carry(&cut(&round, &Cut { from, to: from + 640, ..Default::default() }).unwrap());
        let before: Vec<_> = part.iter().filter(|e| e.t() < from).collect();
        assert_eq!(before.len(), 1, "exactly the last pickup or drop before {from}");
        assert_eq!(Some(before[0]), all.iter().filter(|e| e.t() < from).last());
        assert!(part.iter().all(|e| e.t() < from || e.t() <= from + 640));
    }
}

#[test]
fn keeps_a_plant_attempt_while_it_runs() {
    let round = nuke();
    let attempt = round.events.iter().find(|e| matches!(e, Event::Planting { .. })).expect("Nuke R2 has a plant").clone();
    let Event::Planting { t, until, done, .. } = attempt else { unreachable!() };
    assert!(done && until - t == 200, "a plant takes 3.125 s");
    let has = |from, to| cut(&round, &Cut { from, to, ..Default::default() }).unwrap().events.contains(&attempt);
    assert!(has(t + 64, t + 128));
    assert!(!has(until + 64, until + 640));
}

/// Knife swings and Zeus shots are optional: absent in older clips, left out when empty, and cut
/// to the window like shots.
#[test]
fn knife_and_zeus_are_optional_and_cut_to_the_window() {
    let mut round = nuke();
    round.knife = Shots::default();
    round.zeus = Shots::default();
    let json = serde_json::to_string(&round).unwrap();
    assert!(!json.contains("\"knife\":{") && !json.contains("\"zeus\":{"), "empty keys written");
    let tr = round.tickrate as i64;
    round.knife = Shots::encode(vec![(12 * tr, 0, 90), (5 * tr, 1, -45), (30 * tr, 2, 180)]);
    round.zeus = Shots::encode(vec![(18 * tr, 3, 0)]);
    let back: Clip = serde_json::from_str(&serde_json::to_string(&round).unwrap()).unwrap();
    assert_eq!((&back.knife, &back.zeus), (&round.knife, &round.zeus));
    let part = cut(&round, &Cut { from: 10 * tr, to: 20 * tr, ..Default::default() }).unwrap();
    assert_eq!(part.knife, Shots { t: vec![12 * tr], p: vec![0], yaw: vec![90] });
    assert_eq!(part.zeus, Shots { t: vec![18 * tr], p: vec![3], yaw: vec![0] });
}
