//! Every reference clip in spec/fixtures must load, survive a save/load round trip and
//! decode into tracks that stay inside the clip.

use radarclip_core::{decode_track, Clip, FORMAT};

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
        seen += 1;
    }
    assert!(seen >= 2, "expected fixtures in {dir}");
}
