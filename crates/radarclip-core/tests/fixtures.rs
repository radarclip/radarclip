//! Every reference clip in spec/fixtures must load, survive a save/load round trip and
//! decode into tracks that stay inside the clip.

use radarclip_core::{decode_track, Clip, Event, FORMAT};

#[test]
fn fixtures_load_and_roundtrip() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/fixtures");
    let mut seen = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if !path.to_string_lossy().ends_with(".radarclip.json") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let clip: Clip = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        assert_eq!(clip.format, FORMAT);
        let again: Clip = serde_json::from_str(&serde_json::to_string(&clip).unwrap()).unwrap();
        assert_eq!(clip, again, "{}", path.display());
        for p in &clip.players {
            let frames = decode_track(&p.track, clip.frames, clip.quant);
            assert_eq!(frames.len(), clip.frames as usize);
            for s in frames.iter().flatten() {
                assert!(s.weapon < clip.weapons.len() as i64 && s.place < clip.places.len() as i64);
            }
        }
        // Positioned events must have a real position (regression: grenade events at the origin).
        for e in &clip.events {
            let at_origin = match e {
                Event::Smoke { x, y, z, .. } | Event::Molotov { x, y, z, .. } | Event::Flash { x, y, z, .. }
                | Event::He { x, y, z, .. } | Event::Plant { x, y, z, .. } | Event::Kill { x, y, z, .. } => (*x, *y, *z) == (0, 0, 0),
                _ => false,
            };
            assert!(!at_origin, "{}: {e:?} at the map origin", path.display());
        }
        seen += 1;
    }
    assert!(seen >= 2, "expected fixtures in {dir}");
}

/// Optional kill fields stay out of the JSON when they don't apply, and read back when they do.
#[test]
fn kill_details_are_optional() {
    let plain: Event = serde_json::from_str(r#"{"type":"kill","t":5,"attacker":1,"victim":2,"weapon":"ak47","hs":true,"x":1,"y":2,"z":3}"#).unwrap();
    let json = serde_json::to_string(&plain).unwrap();
    for key in ["assister", "flashassist", "pen", "noscope", "smoke", "blind"] {
        assert!(!json.contains(key), "{key} written for a plain kill: {json}");
    }
    let full = r#"{"type":"kill","t":5,"attacker":1,"victim":2,"weapon":"awp","hs":false,"x":1,"y":2,"z":3,"assister":4,"flashassist":true,"pen":2,"noscope":true,"smoke":true,"blind":true}"#;
    let e: Event = serde_json::from_str(full).unwrap();
    let Event::Kill { assister, flashassist, pen, noscope, smoke, blind, .. } = &e else { panic!("not a kill") };
    assert_eq!((*assister, *flashassist, *pen, *noscope, *smoke, *blind), (Some(4), true, 2, true, true, true));
    assert_eq!(serde_json::from_str::<Event>(&serde_json::to_string(&e).unwrap()).unwrap(), e);
}

/// The reference match file loads, survives a round trip, and names every clip player.
#[test]
fn match_fixture_loads_and_roundtrips() {
    use radarclip_core::{MatchFile, MATCH_FORMAT};
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/fixtures/nuke-r1-2.radarclip-match.json");
    let m: MatchFile = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(m.format, MATCH_FORMAT);
    assert_eq!(m.rounds.len(), 2);
    for r in &m.rounds {
        assert_eq!(r.clip.format, FORMAT);
        assert_eq!(r.keys.len(), r.clip.players.len());
        assert!(r.keys.iter().all(|k| m.players.iter().any(|p| &p.key == k)), "round {}: unknown key", r.number);
    }
    let again: MatchFile = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
    assert_eq!(m, again);
}

/// Every round of the reference match has detail that fits its clip: one entry per clip player,
/// change lists in frame order inside the clip, gear indices in range, sight masks over the clip's
/// players, defuse attempts that end after they start.
#[test]
fn match_fixture_detail_fits_its_clips() {
    use radarclip_core::MatchFile;
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/fixtures/nuke-r1-2.radarclip-match.json");
    let m: MatchFile = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    for r in &m.rounds {
        let d = r.detail.as_ref().unwrap_or_else(|| panic!("round {} has no detail", r.number));
        let n = r.clip.players.len();
        assert_eq!(d.players.len(), n, "round {}", r.number);
        for p in &d.players {
            for (name, list) in [("gear", &p.gear), ("money", &p.money), ("equip", &p.equip), ("helmet", &p.helmet), ("kit", &p.kit), ("seen", &p.seen)] {
                assert_eq!(list.len() % 2, 0, "round {} {name}: odd change list", r.number);
                let frames: Vec<i64> = list.chunks(2).map(|c| c[0]).collect();
                assert!(frames.windows(2).all(|w| w[0] < w[1]), "round {} {name}: frames out of order", r.number);
                assert!(frames.iter().all(|&f| f >= 0 && f < r.clip.frames as i64), "round {} {name}: frame outside the clip", r.number);
            }
            assert!(p.gear.chunks(2).all(|c| (c[1] as usize) < d.gear.len()), "round {}: gear index out of range", r.number);
            assert!(p.seen.chunks(2).all(|c| c[1] >= 0 && c[1] < 1 << n), "round {}: sight mask beyond the clip players", r.number);
            assert!(p.money.chunks(2).any(|c| c[1] > 0), "round {}: no money", r.number);
        }
        assert!(d.gear.iter().all(|g| g.windows(2).all(|w| w[0] <= w[1])), "loadouts are sorted");
        for x in &d.defuses {
            assert!(x.end >= x.t, "defuse ends before it starts");
        }
        // One exact kill per kill event, with the victim where the event says.
        let kills: Vec<_> = r.clip.events.iter().filter_map(|e| match e { radarclip_core::Event::Kill { t, victim, x, y, .. } => Some((*t, *victim, *x, *y)), _ => None }).collect();
        assert_eq!(d.kills.len(), kills.len(), "round {}", r.number);
        for (k, (t, victim, x, y)) in d.kills.iter().zip(&kills) {
            assert_eq!((k.t, k.victim, k.at[0], k.at[1]), (*t, *victim, *x, *y), "round {}", r.number);
        }
        assert!(!d.hits.is_empty() && d.hits.iter().all(|h| (h.victim as usize) < n));
    }
}

#[test]
fn change_lists_keep_the_last_value_over_gaps() {
    use radarclip_core::change_list;
    assert_eq!(change_list([Some(800), Some(800), None, Some(800), Some(200), None]), vec![0, 800, 4, 200]);
    assert!(change_list([None, None]).is_empty());
}
