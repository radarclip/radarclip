//! Read a CS2 demo once (three passes of demoparser2's parser: events, player ticks,
//! grenade paths) into a [`Match`], then cut radarclip/1 clips out of it with [`Match::clip`].

use ahash::AHashMap;
use parser::first_pass::parser_settings::{rm_user_friendly_names, ParserInputs};
use parser::parse_demo::{DemoOutput, Parser, ParsingMode};
use parser::second_pass::game_events::GameEvent;
use parser::second_pass::parser_settings::create_huffman_lookup_table;
use parser::second_pass::variants::{VarVec, Variant};
use radarclip_core::{encode_track, Clip, Event, Mark, Nade, Player, Quant, Sample, Shots, Tolerance, FORMAT};

/// Ticks between the player samples kept in memory (16 per second at 64 tick).
pub const GRID: i32 = 4;
pub const TICKRATE: u32 = 64;
/// Seconds kept after the round end.
const POST_ROUND: i32 = 3;

const EVENTS: &[&str] = &[
    "round_freeze_end", "round_end", "round_announce_match_start", "player_death", "player_hurt",
    "player_blind", "weapon_fire", "smokegrenade_detonate", "smokegrenade_expired", "inferno_startburn",
    "inferno_expire", "flashbang_detonate", "hegrenade_detonate", "bomb_planted", "bomb_defused", "bomb_exploded",
];
const TICK_PROPS: &[&str] = &["X", "Y", "Z", "yaw", "health", "armor_value", "active_weapon_name", "last_place_name", "team_num", "is_alive"];
const NOT_SHOTS: &[&str] = &["smokegrenade", "flashbang", "hegrenade", "incgrenade", "molotov", "decoy", "c4"];

#[derive(Debug, Clone)]
pub struct Round {
    pub number: u32,
    pub freeze_end: i32,
    pub end: i32,
    pub winner: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlayerInfo {
    /// Steam64 id as text, or `bot:<name>` for bots.
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy)]
struct Raw {
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
    hp: i32,
    armor: i32,
    alive: bool,
    team: u32,
    weapon: u32,
    place: u32,
}

struct GrenadeRow {
    entity: i32,
    tick: i32,
    kind: &'static str,
    owner: Option<String>,
    x: f32,
    y: f32,
    z: f32,
}

/// What to cut. Times are seconds after the round's freeze end.
#[derive(Debug, Clone)]
pub struct ClipRequest {
    pub round: u32,
    pub from: f32,
    pub to: f32,
    /// Ticks between frames; a multiple of [`GRID`].
    pub step: u32,
    /// Steam64 ids or player names; the first is drawn as "me".
    pub focus: Vec<String>,
    pub marks: Vec<(f32, String)>,
    pub title: String,
    pub quant: Quant,
    pub tolerance: Tolerance,
    /// Replace player names with "CT 1" … "T 5".
    pub anonymize: bool,
}

impl ClipRequest {
    pub fn new(round: u32, from: f32, to: f32) -> Self {
        ClipRequest {
            round, from, to, step: 8, focus: vec![], marks: vec![], title: String::new(),
            quant: Quant::default(), tolerance: Tolerance::default(), anonymize: false,
        }
    }
}

pub struct Match {
    pub map: String,
    pub tickrate: u32,
    pub rounds: Vec<Round>,
    pub players: Vec<PlayerInfo>,
    /// Per player (same order as `players`), one slot every GRID ticks.
    samples: Vec<Vec<Option<Raw>>>,
    weapons: Vec<String>,
    places: Vec<String>,
    events: Vec<GameEvent>,
    grenades: Vec<GrenadeRow>,
}

fn pass(bytes: &[u8], props: &[&str], other: &[&str], events: &[&str], ticks: Vec<i32>, grenades: bool) -> Result<DemoOutput, String> {
    let props: Vec<String> = props.iter().map(|s| s.to_string()).collect();
    let other: Vec<String> = other.iter().map(|s| s.to_string()).collect();
    let real_props = rm_user_friendly_names(&props).map_err(|e| e.to_string())?;
    let real_other = rm_user_friendly_names(&other).map_err(|e| e.to_string())?;
    let mut names = AHashMap::default();
    for (real, friendly) in real_props.iter().zip(&props).chain(real_other.iter().zip(&other)) {
        names.insert(real.clone(), friendly.clone());
    }
    let huf = create_huffman_lookup_table();
    let settings = ParserInputs {
        wanted_players: vec![],
        wanted_player_props: real_props,
        wanted_other_props: real_other,
        real_name_to_og_name: names,
        wanted_events: events.iter().map(|s| s.to_string()).collect(),
        parse_ents: true,
        wanted_ticks: ticks,
        parse_projectiles: grenades,
        parse_grenades: false,
        only_header: false,
        list_props: false,
        only_convars: false,
        huffman_lookup_table: &huf,
        order_by_steamid: false,
        wanted_prop_states: AHashMap::default(),
        fallback_bytes: None,
    };
    Parser::new(settings, ParsingMode::ForceSingleThreaded).parse_demo(bytes).map_err(|e| e.to_string())
}

fn column<'a>(out: &'a DemoOutput, name: &str) -> Option<&'a VarVec> {
    let info = out.prop_controller.prop_infos.iter().find(|p| p.prop_friendly_name == name)?;
    out.df.get(&info.id)?.data.as_ref()
}

fn num_at(col: Option<&VarVec>, i: usize) -> Option<f64> {
    match col? {
        VarVec::F32(v) => v.get(i).copied().flatten().map(f64::from),
        VarVec::I32(v) => v.get(i).copied().flatten().map(f64::from),
        VarVec::U32(v) => v.get(i).copied().flatten().map(f64::from),
        VarVec::U64(v) => v.get(i).copied().flatten().map(|x| x as f64),
        VarVec::Bool(v) => v.get(i).copied().flatten().map(|b| b as u8 as f64),
        _ => None,
    }
}

fn var_len(col: &VarVec) -> usize {
    match col {
        VarVec::F32(v) => v.len(),
        VarVec::I32(v) => v.len(),
        VarVec::U32(v) => v.len(),
        VarVec::U64(v) => v.len(),
        VarVec::Bool(v) => v.len(),
        VarVec::String(v) => v.len(),
        _ => 0,
    }
}

fn u64_at(col: Option<&VarVec>, i: usize) -> Option<u64> {
    match col? {
        VarVec::U64(v) => v.get(i).copied().flatten(),
        _ => None,
    }
}

fn str_at(col: Option<&VarVec>, i: usize) -> Option<&str> {
    match col? {
        VarVec::String(v) => v.get(i).and_then(|s| s.as_deref()),
        _ => None,
    }
}

fn player_key(steamid: Option<&str>, name: Option<&str>) -> Option<String> {
    match steamid {
        Some(s) if !s.is_empty() && s != "0" => Some(s.to_string()),
        _ => name.filter(|n| !n.is_empty()).map(|n| format!("bot:{n}")),
    }
}

fn field<'a>(e: &'a GameEvent, name: &str) -> Option<&'a Variant> {
    e.fields.iter().find(|f| f.name == name)?.data.as_ref()
}

fn fnum(e: &GameEvent, name: &str) -> Option<f64> {
    match field(e, name)? {
        Variant::F32(v) => Some(*v as f64),
        Variant::I32(v) => Some(*v as f64),
        Variant::U32(v) => Some(*v as f64),
        Variant::U64(v) => Some(*v as f64),
        Variant::Bool(v) => Some(*v as u8 as f64),
        Variant::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn fstr<'a>(e: &'a GameEvent, name: &str) -> Option<&'a str> {
    match field(e, name)? {
        Variant::String(s) => Some(s),
        _ => None,
    }
}

fn fint(e: &GameEvent, name: &str) -> i64 {
    fnum(e, name).map(|v| v.round() as i64).unwrap_or(0)
}

fn nade_kind(class: &str) -> Option<&'static str> {
    Some(match class {
        "CSmokeGrenadeProjectile" => "smoke",
        "CFlashbangProjectile" => "flash",
        "CHEGrenadeProjectile" => "he",
        "CMolotovProjectile" => "molotov",
        "CDecoyProjectile" => "decoy",
        _ => return None,
    })
}

fn intern(table: &mut Vec<String>, index: &mut AHashMap<String, u32>, s: &str) -> u32 {
    if let Some(&i) = index.get(s) {
        return i;
    }
    let i = table.len() as u32;
    table.push(s.to_string());
    index.insert(s.to_string(), i);
    i
}

impl Match {
    pub fn parse(bytes: &[u8]) -> Result<Match, String> {
        // Pass 1: game events (player props attached as user_X, attacker_yaw, …).
        let ev = pass(bytes, &["X", "Y", "Z", "yaw"], &["is_warmup_period"], EVENTS, vec![], false)?;
        let map = ev.header.as_ref().and_then(|h| h.get("map_name").cloned()).unwrap_or_default();
        let events = ev.game_events;
        let last_tick = events.iter().map(|e| e.tick).max().unwrap_or(0);

        let start = events.iter().filter(|e| e.name == "round_announce_match_start").map(|e| e.tick).max().unwrap_or(0);
        let mut starts: Vec<i32> = events
            .iter()
            .filter(|e| e.name == "round_freeze_end" && e.tick >= start && fnum(e, "is_warmup_period") != Some(1.0))
            .map(|e| e.tick)
            .collect();
        starts.sort_unstable();
        starts.dedup();
        let mut rounds: Vec<Round> = starts
            .iter()
            .enumerate()
            .map(|(i, &t)| Round { number: i as u32 + 1, freeze_end: t, end: starts.get(i + 1).copied().unwrap_or(last_tick), winner: None })
            .collect();
        let mut ended = vec![false; rounds.len()];
        for e in events.iter().filter(|e| e.name == "round_end") {
            let n = starts.partition_point(|&s| s <= e.tick);
            if n == 0 || ended[n - 1] {
                continue;
            }
            ended[n - 1] = true;
            let r = &mut rounds[n - 1];
            r.end = e.tick;
            r.winner = match field(e, "winner") {
                Some(Variant::String(s)) if s == "CT" || s == "T" => Some(s.clone()),
                Some(Variant::String(s)) if s == "3" => Some("CT".into()),
                Some(Variant::String(s)) if s == "2" => Some("T".into()),
                Some(Variant::I32(3)) | Some(Variant::U32(3)) => Some("CT".into()),
                Some(Variant::I32(2)) | Some(Variant::U32(2)) => Some("T".into()),
                _ => None,
            };
        }

        // Pass 2: player state every GRID ticks.
        let slots = (last_tick + 10 * TICKRATE as i32) / GRID + 1;
        let ticks: Vec<i32> = (0..slots).map(|s| s * GRID).collect();
        let st = pass(bytes, TICK_PROPS, &[], &[], ticks, false)?;
        let (tick, steamid, name) = (column(&st, "tick"), column(&st, "steamid"), column(&st, "name"));
        let (x, y, z, yaw) = (column(&st, "X"), column(&st, "Y"), column(&st, "Z"), column(&st, "yaw"));
        let (hp, armor, alive, team) = (column(&st, "health"), column(&st, "armor_value"), column(&st, "is_alive"), column(&st, "team_num"));
        let (weapon, place) = (column(&st, "active_weapon_name"), column(&st, "last_place_name"));
        let rows = tick.map(var_len).unwrap_or(0);

        let mut players: Vec<PlayerInfo> = vec![];
        let mut index: AHashMap<String, usize> = AHashMap::default();
        let mut samples: Vec<Vec<Option<Raw>>> = vec![];
        let (mut weapons, mut weapon_ix, mut places, mut place_ix) = (vec![], AHashMap::default(), vec![], AHashMap::default());
        for i in 0..rows {
            let Some(t) = num_at(tick, i) else { continue };
            let sid = u64_at(steamid, i).map(|s| s.to_string());
            let nm = str_at(name, i);
            let Some(key) = player_key(sid.as_deref(), nm) else { continue };
            let p = *index.entry(key.clone()).or_insert_with(|| {
                players.push(PlayerInfo { key: key.clone(), name: nm.unwrap_or_default().to_string() });
                samples.push(vec![None; slots as usize]);
                players.len() - 1
            });
            if let Some(nm) = nm.filter(|n| !n.is_empty()) {
                players[p].name = nm.to_string();
            }
            let (Some(px), Some(py), Some(pz)) = (num_at(x, i), num_at(y, i), num_at(z, i)) else { continue };
            let slot = t as usize / GRID as usize;
            if slot < samples[p].len() {
                samples[p][slot] = Some(Raw {
                    x: px as f32, y: py as f32, z: pz as f32,
                    yaw: num_at(yaw, i).unwrap_or(0.0) as f32,
                    hp: num_at(hp, i).unwrap_or(0.0) as i32,
                    armor: num_at(armor, i).unwrap_or(0.0) as i32,
                    alive: num_at(alive, i).map(|v| v > 0.0).unwrap_or(true),
                    team: num_at(team, i).unwrap_or(0.0) as u32,
                    weapon: intern(&mut weapons, &mut weapon_ix, str_at(weapon, i).unwrap_or("")),
                    place: intern(&mut places, &mut place_ix, str_at(place, i).unwrap_or("")),
                });
            }
        }

        // Pass 3: grenade projectiles, one row per tick of flight.
        let gr = pass(bytes, &[], &[], &[], vec![], true)?;
        let (gtype, gent, gtick) = (column(&gr, "grenade_type"), column(&gr, "grenade_entity_id"), column(&gr, "tick"));
        let (gx, gy, gz, gsid, gname) = (column(&gr, "x"), column(&gr, "y"), column(&gr, "z"), column(&gr, "steamid"), column(&gr, "name"));
        let mut grenades = vec![];
        for i in 0..gtick.map(var_len).unwrap_or(0) {
            let Some(kind) = str_at(gtype, i).and_then(nade_kind) else { continue };
            let (Some(t), Some(e), Some(x), Some(y), Some(z)) = (num_at(gtick, i), num_at(gent, i), num_at(gx, i), num_at(gy, i), num_at(gz, i)) else { continue };
            let sid = u64_at(gsid, i).map(|s| s.to_string());
            grenades.push(GrenadeRow {
                entity: e as i32, tick: t as i32, kind,
                owner: player_key(sid.as_deref(), str_at(gname, i)),
                x: x as f32, y: y as f32, z: z as f32,
            });
        }

        Ok(Match { map, tickrate: TICKRATE, rounds, players, samples, weapons, places, events, grenades })
    }

    pub fn clip(&self, req: &ClipRequest) -> Result<Clip, String> {
        let round = self.rounds.get((req.round as usize).wrapping_sub(1)).ok_or_else(|| format!("round {} not in 1..{}", req.round, self.rounds.len()))?;
        if req.step == 0 || req.step as i32 % GRID != 0 {
            return Err(format!("step must be a multiple of {GRID} ticks"));
        }
        let tr = self.tickrate as f32;
        let r0 = round.freeze_end;
        let t0 = r0.max(r0 + (req.from * tr).round() as i32);
        let t1 = (round.end + POST_ROUND * self.tickrate as i32).min(r0 + (req.to * tr).round() as i32);
        let first = (t0 + GRID - 1) / GRID * GRID;
        if t1 < first {
            return Err(format!("empty window: R{} {}–{} s", req.round, req.from, req.to));
        }
        let ticks: Vec<i32> = (first..=t1).step_by(req.step as usize).collect();
        let raw = |p: usize, t: i32| self.samples[p].get((t / GRID) as usize).copied().flatten();

        // Players on a team during the window, CT first, then by name.
        let mut members: Vec<(usize, &'static str)> = (0..self.players.len())
            .filter_map(|p| {
                let team = ticks.iter().find_map(|&t| raw(p, t).map(|r| r.team).filter(|&s| s == 2 || s == 3))?;
                Some((p, if team == 3 { "CT" } else { "T" }))
            })
            .collect();
        members.sort_by(|a, b| a.1.cmp(b.1).then_with(|| self.players[a.0].name.to_lowercase().cmp(&self.players[b.0].name.to_lowercase())));
        let idx: AHashMap<&str, u32> = members.iter().enumerate().map(|(i, &(p, _))| (self.players[p].key.as_str(), i as u32)).collect();

        let (mut weapons, mut weapon_ix, mut places, mut place_ix) = (vec![], AHashMap::default(), vec![], AHashMap::default());
        let mut sides_seen: AHashMap<&str, u32> = AHashMap::default();
        let mut players = vec![];
        for &(p, side) in &members {
            let frames: Vec<Option<Sample>> = ticks
                .iter()
                .map(|&t| {
                    let r = raw(p, t).filter(|r| r.alive && r.hp > 0)?;
                    let w = &self.weapons[r.weapon as usize];
                    let pl = &self.places[r.place as usize];
                    Some(Sample {
                        x: r.x, y: r.y, z: r.z, yaw: r.yaw, hp: r.hp as i64, armor: r.armor as i64,
                        weapon: if w.is_empty() { -1 } else { intern(&mut weapons, &mut weapon_ix, w) as i64 },
                        place: if pl.is_empty() { -1 } else { intern(&mut places, &mut place_ix, pl) as i64 },
                    })
                })
                .collect();
            let n = sides_seen.entry(side).or_insert(0);
            *n += 1;
            let name = if req.anonymize { format!("{side} {n}") } else { self.players[p].name.clone() };
            players.push(Player { name, side: side.to_string(), track: encode_track(&frames, req.quant, req.tolerance) });
        }

        let mut focus = vec![];
        for f in &req.focus {
            let hit = members.iter().position(|&(p, _)| self.players[p].key == *f || self.players[p].name.eq_ignore_ascii_case(f));
            focus.push(hit.ok_or_else(|| format!("focus player {f:?} not in R{}", req.round))? as u32);
        }

        let who = |e: &GameEvent, prefix: &str| -> Option<u32> {
            let key = player_key(fstr(e, &format!("{prefix}_steamid")), fstr(e, &format!("{prefix}_name")))?;
            idx.get(key.as_str()).copied()
        };
        let rel = |t: i32| (t - r0) as i64;
        let inside = |e: &GameEvent| e.tick >= t0 && e.tick <= t1;
        let pos = |e: &GameEvent, p: &str| (fint(e, &format!("{p}X")), fint(e, &format!("{p}Y")), fint(e, &format!("{p}Z")));

        let mut events = vec![];
        let mut shots: Vec<(i64, u32, i64)> = vec![];
        for e in &self.events {
            let t = rel(e.tick);
            match e.name.as_str() {
                // Deaths from the whole round so far stay on the map.
                "player_death" if e.tick >= r0 && e.tick <= t1 => {
                    let Some(victim) = who(e, "user") else { continue };
                    let (x, y, z) = pos(e, "user_");
                    events.push(Event::Kill {
                        t, attacker: who(e, "attacker"), victim, x, y, z,
                        weapon: fstr(e, "weapon").unwrap_or_default().to_string(),
                        hs: fnum(e, "headshot") == Some(1.0),
                    });
                }
                "player_hurt" if inside(e) => {
                    let Some(victim) = who(e, "user") else { continue };
                    events.push(Event::Hurt {
                        t, attacker: who(e, "attacker"), victim, dmg: fint(e, "dmg_health"),
                        weapon: fstr(e, "weapon").unwrap_or_default().to_string(),
                    });
                }
                "player_blind" if inside(e) => {
                    let duration = fnum(e, "blind_duration").unwrap_or(0.0);
                    let Some(victim) = who(e, "user") else { continue };
                    if duration >= 0.3 {
                        events.push(Event::Blind { t, victim, by: who(e, "attacker"), until: t + (duration * tr as f64).round() as i64 });
                    }
                }
                "flashbang_detonate" | "hegrenade_detonate" if inside(e) => {
                    let (x, y, z) = pos(e, "");
                    let by = who(e, "user");
                    events.push(if e.name == "flashbang_detonate" { Event::Flash { t, by, x, y, z } } else { Event::He { t, by, x, y, z } });
                }
                // Smokes and fires still burning when the clip starts count too.
                "smokegrenade_detonate" | "inferno_startburn" if e.tick >= r0 && e.tick <= t1 => {
                    let (end_name, life) = if e.name == "smokegrenade_detonate" { ("smokegrenade_expired", 20.0) } else { ("inferno_expire", 7.0) };
                    let ent = fnum(e, "entityid");
                    let until = self
                        .events
                        .iter()
                        .find(|x| x.name == end_name && x.tick >= e.tick && fnum(x, "entityid") == ent)
                        .map(|x| x.tick)
                        .unwrap_or(e.tick + (life * tr) as i32);
                    if until < t0 {
                        continue;
                    }
                    let (x, y, z) = pos(e, "");
                    let (by, until) = (who(e, "user"), rel(until));
                    events.push(if end_name == "smokegrenade_expired" { Event::Smoke { t, by, until, x, y, z } } else { Event::Molotov { t, by, until, x, y, z } });
                }
                // A bomb planted before the clip starts is still on the ground.
                "bomb_planted" if e.tick >= r0 && e.tick <= t1 => {
                    let (x, y, z) = pos(e, "user_");
                    events.push(Event::Plant { t, by: who(e, "user"), x, y, z });
                }
                "bomb_defused" if inside(e) => events.push(Event::Defuse { t, by: who(e, "user") }),
                "bomb_exploded" if inside(e) => events.push(Event::Explode { t, by: who(e, "user") }),
                "weapon_fire" if inside(e) => {
                    let w = fstr(e, "weapon").unwrap_or_default().trim_start_matches("weapon_");
                    if NOT_SHOTS.contains(&w) || w.starts_with("knife") || w == "bayonet" {
                        continue;
                    }
                    if let Some(p) = who(e, "user") {
                        shots.push((t, p, fnum(e, "user_yaw").unwrap_or(0.0).round() as i64));
                    }
                }
                _ => {}
            }
        }
        events.sort_by_key(|e| e.t());
        shots.sort_by_key(|s| s.0);
        let mut out_shots = Shots::default();
        let mut prev = 0;
        for (t, p, yaw) in shots {
            out_shots.t.push(t - prev);
            prev = t;
            out_shots.p.push(p);
            out_shots.yaw.push(yaw);
        }

        // Grenade flights in the window: ~16 points a second is plenty for a curve.
        let mut flights: Vec<(i32, Vec<&GrenadeRow>)> = vec![];
        for g in self.grenades.iter().filter(|g| g.tick >= t0 && g.tick <= t1) {
            match flights.iter_mut().find(|(e, rows)| *e == g.entity && rows[0].kind == g.kind) {
                Some((_, rows)) => rows.push(g),
                None => flights.push((g.entity, vec![g])),
            }
        }
        let mut nades = vec![];
        for (_, mut rows) in flights {
            rows.sort_by_key(|g| g.tick);
            let last = rows.len() - 1;
            let mut path = vec![];
            let mut prev = [0i64; 4];
            for (i, g) in rows.iter().enumerate() {
                if i % 4 != 0 && i != last {
                    continue;
                }
                let cur = [rel(g.tick), g.x.round() as i64, g.y.round() as i64, g.z.round() as i64];
                path.extend(cur.iter().zip(prev).map(|(c, p)| c - p));
                prev = cur;
            }
            let by = rows[0].owner.as_deref().and_then(|k| idx.get(k).copied());
            nades.push(Nade { kind: rows[0].kind.to_string(), by, path });
        }

        Ok(Clip {
            format: FORMAT.to_string(),
            map: self.map.clone(),
            title: req.title.clone(),
            round: round.number,
            winner: round.winner.clone(),
            tickrate: self.tickrate,
            start: rel(first),
            step: req.step,
            frames: ticks.len() as u32,
            quant: req.quant,
            focus,
            marks: req.marks.iter().map(|(t, label)| Mark { t: (t * tr).round() as i64, label: label.clone() }).collect(),
            places,
            weapons,
            players,
            events,
            nades,
            shots: out_shots,
        })
    }
}
