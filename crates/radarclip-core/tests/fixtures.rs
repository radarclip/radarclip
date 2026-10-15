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
