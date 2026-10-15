//! JS bindings: load a demo (in one piece or streamed in chunks), list its rounds and players,
//! cut clips. Clips and info cross the boundary as JSON strings.

use radarclip_core::{Quant, Tolerance};
use radarclip_parser::{ClipRequest, Match, Progress};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// A parsed demo, kept in wasm memory so clips are cheap to cut.
#[wasm_bindgen]
pub struct Demo {
    m: Match,
}

/// Collects a demo chunk by chunk (e.g. from `File.slice`), so JS never holds a second full copy.
#[wasm_bindgen]
pub struct DemoLoader {
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl DemoLoader {
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize) -> DemoLoader {
        DemoLoader { bytes: Vec::with_capacity(size) }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
    }

    /// Parse what was pushed. Plain demos, .dem.bz2 and .dem.zst. `onProgress(stage, done,
    /// total)` is called every few MB: `stage` is `unpack`, `events`, `players` or `grenades`,
    /// `done` that stage's share (0…1), `total` an estimate for the whole parse (0…1).
    pub fn finish(self, #[wasm_bindgen(js_name = onProgress)] on_progress: Option<js_sys::Function>) -> Result<Demo, JsError> {
        let report: std::rc::Rc<dyn Fn(Progress)> = match on_progress {
            Some(f) => std::rc::Rc::new(move |p: Progress| {
                let stage = serde_json::to_value(p.stage).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default();
                let _ = f.call3(&JsValue::NULL, &JsValue::from_str(&stage), &JsValue::from_f64(p.done as f64), &JsValue::from_f64(p.total as f64));
            }),
            None => std::rc::Rc::new(|_| {}),
        };
        Ok(Demo { m: Match::parse_with_progress(&self.bytes, report).map_err(err)? })
    }
}

#[derive(Serialize)]
struct Info<'a> {
    map: &'a str,
    tickrate: u32,
    rounds: Vec<RoundInfo<'a>>,
    players: Vec<PlayerInfo<'a>>,
}

#[derive(Serialize)]
struct RoundInfo<'a> {
    number: u32,
    seconds: f32,
    winner: Option<&'a str>,
}

#[derive(Serialize)]
struct PlayerInfo<'a> {
    key: &'a str,
    name: &'a str,
}

/// `Demo.clip()` request; times in seconds after the round's freeze end.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    round: u32,
    #[serde(default)]
    from: f32,
    #[serde(default = "full_round")]
    to: f32,
    #[serde(default = "default_step")]
    step: u32,
    #[serde(default)]
    focus: Vec<String>,
    #[serde(default)]
    marks: Vec<(f32, String)>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    anonymize: bool,
}

fn full_round() -> f32 {
    1000.0
}

fn default_step() -> u32 {
    8
}

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
impl Demo {
    /// Parse a whole demo given as one buffer (copied into wasm memory).
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<Demo, JsError> {
        Ok(Demo { m: Match::parse(&bytes).map_err(err)? })
    }

    /// `{map, tickrate, rounds: [{number, seconds, winner}], players: [{key, name}]}` as JSON.
    pub fn info(&self) -> String {
        let m = &self.m;
        let info = Info {
            map: &m.map,
            tickrate: m.tickrate,
            rounds: m.rounds.iter().map(|r| RoundInfo {
                number: r.number,
                seconds: (r.end - r.freeze_end) as f32 / m.tickrate as f32,
                winner: r.winner.as_deref(),
            }).collect(),
            players: m.players.iter().map(|p| PlayerInfo { key: &p.key, name: &p.name }).collect(),
        };
        serde_json::to_string(&info).unwrap()
    }

    /// Cut a clip. `request` is JSON: `{round, from?, to?, step?, focus?, marks?: [[s, label]],
    /// title?, anonymize?}`. Returns the radarclip/1 JSON.
    pub fn clip(&self, request: &str) -> Result<String, JsError> {
        let r: Request = serde_json::from_str(request).map_err(err)?;
        let req = ClipRequest {
            round: r.round, from: r.from, to: r.to, step: r.step, focus: r.focus, marks: r.marks,
            title: r.title, quant: Quant::default(), tolerance: Tolerance::default(), anonymize: r.anonymize,
        };
        serde_json::to_string(&self.m.clip(&req).map_err(err)?).map_err(err)
    }
}
