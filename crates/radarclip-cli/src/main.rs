use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use clap::{Parser, Subcommand};
use radarclip_parser::{ClipRequest, Match};

#[derive(Parser)]
#[command(name = "radarclip", version, about = "Cut compact 2D replay clips (radarclip/1) out of CS2 demos")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Map, rounds and players of a demo.
    Info { demo: PathBuf },
    /// Decode a clip's tracks into one row per frame (reference output for other decoders).
    Decode { clip: PathBuf },
    /// Save the whole match: every round as a full-round clip (radarclip-match/1).
    Match {
        demo: PathBuf,
        /// Only these rounds, e.g. 3 or 1-4 (for small test files).
        #[arg(long)]
        rounds: Option<String>,
        /// Replace names with "Player 1" … and Steam ids with "p1" … (for files you share).
        #[arg(long)]
        anonymize: bool,
        /// Output file: .radarclip-match.json (readable) or .radarclip-match (deflated). Default: stdout JSON.
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Indent the JSON.
        #[arg(long)]
        pretty: bool,
    },
    /// Cut a clip. Times are seconds after the round's freeze end (round time 1:55 = 0).
    Clip {
        demo: PathBuf,
        #[arg(short, long)]
        round: u32,
        #[arg(long, default_value_t = 0.0)]
        from: f32,
        #[arg(long, default_value_t = 200.0)]
        to: f32,
        /// Steam64 id or name; repeat for more. The first is drawn as "me".
        #[arg(long)]
        focus: Vec<String>,
        /// SECONDS=LABEL, e.g. --mark "59.7=kill at Shop"; repeat for more.
        #[arg(long)]
        mark: Vec<String>,
        #[arg(long, default_value = "")]
        title: String,
        /// Ticks between frames (multiple of 4; 8 = 8 frames a second at 64 tick).
        #[arg(long, default_value_t = 8)]
        step: u32,
        /// Replace player names with "CT 1" … "T 5".
        #[arg(long)]
        anonymize: bool,
        /// Output file: .radarclip.json (readable) or .radarclip (deflated). Default: stdout JSON.
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Indent the JSON.
        #[arg(long)]
        pretty: bool,
    },
}

fn main() {
    if let Err(e) = run(Cli::parse()) {
        eprintln!("radarclip: {e}");
        std::process::exit(1);
    }
}

fn load(demo: &PathBuf) -> Result<Match, String> {
    let bytes = std::fs::read(demo).map_err(|e| format!("{}: {e}", demo.display()))?;
    let t = Instant::now();
    // On a terminal, one line that updates as the parser goes.
    let tty = std::io::IsTerminal::is_terminal(&std::io::stderr());
    let m = Match::parse_with_progress(&bytes, std::rc::Rc::new(move |p: radarclip_parser::Progress| {
        if tty {
            eprint!("\r{:>3.0}%  {:<9}", p.total * 100.0, format!("{:?}", p.stage).to_lowercase());
        }
    }))?;
    if tty {
        eprint!("\r{:30}\r", "");
    }
    eprintln!("parsed {} ({:.0} MB) in {:.1} s", demo.display(), bytes.len() as f64 / 1e6, t.elapsed().as_secs_f64());
    Ok(m)
}

/// Write JSON as is (`.json`) or deflated; stdout when no path. Returns the bytes written.
fn write_out(output: Option<&PathBuf>, json: &[u8]) -> Result<usize, String> {
    let Some(path) = output else {
        std::io::stdout().write_all(json).map_err(|e| e.to_string())?;
        return Ok(json.len());
    };
    let bytes = if path.to_string_lossy().ends_with(".json") {
        json.to_vec()
    } else {
        let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
        enc.write_all(json).map_err(|e| e.to_string())?;
        enc.finish().map_err(|e| e.to_string())?
    };
    std::fs::write(path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(bytes.len())
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Info { demo } => {
            let m = load(&demo)?;
            println!("{} · {} rounds · {} tick", m.map, m.rounds.len(), m.tickrate);
            for r in &m.rounds {
                let secs = (r.end - r.freeze_end) as f32 / m.tickrate as f32;
                println!("R{:<3} {:>5.1} s  winner {}", r.number, secs, r.winner.as_deref().unwrap_or("?"));
            }
            for p in &m.players {
                println!("{:<20} {}", p.key, p.name);
            }
        }
        Command::Decode { clip } => {
            let text = std::fs::read_to_string(&clip).map_err(|e| format!("{}: {e}", clip.display()))?;
            let c: radarclip_core::Clip = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let r2 = |v: f32| (v as f64 * 100.0).round() / 100.0;
            let players: Vec<Vec<serde_json::Value>> = c
                .players
                .iter()
                .map(|p| {
                    radarclip_core::decode_track(&p.track, c.frames, c.quant)
                        .into_iter()
                        .map(|s| match s {
                            None => serde_json::Value::Null,
                            Some(s) => serde_json::json!([r2(s.x), r2(s.y), r2(s.z), r2(s.yaw), s.hp, s.armor, s.weapon, s.place]),
                        })
                        .collect()
                })
                .collect();
            println!("{}", serde_json::json!({ "columns": ["x", "y", "z", "yaw", "hp", "armor", "weapon", "place"], "players": players }));
        }
        Command::Clip { demo, round, from, to, focus, mark, title, step, anonymize, output, pretty } => {
            let m = load(&demo)?;
            let mut req = ClipRequest::new(round, from, to);
            req.focus = focus;
            req.title = title;
            req.step = step;
            req.anonymize = anonymize;
            for s in mark {
                let (t, label) = s.split_once('=').unwrap_or((&s, ""));
                req.marks.push((t.parse().map_err(|_| format!("bad --mark {s:?}, expected SECONDS=LABEL"))?, label.to_string()));
            }
            let clip = m.clip(&req)?;
            let json = if pretty { serde_json::to_vec_pretty(&clip) } else { serde_json::to_vec(&clip) }.map_err(|e| e.to_string())?;
            let size = write_out(output.as_ref(), &json)?;
            if let Some(path) = &output {
                eprintln!("{} · {} frames · {} players · {} B ({} B JSON)", path.display(), clip.frames, clip.players.len(), size, json.len());
            }
        }
        Command::Match { demo, rounds, anonymize, output, pretty } => {
            let m = load(&demo)?;
            let mut file = m.export()?;
            if let Some(spec) = rounds {
                let (a, b) = spec.split_once('-').unwrap_or((&spec, &spec));
                let parse = |v: &str| v.trim().parse::<u32>().map_err(|_| format!("bad --rounds {spec:?}, expected N or N-M"));
                let (a, b) = (parse(a)?, parse(b)?);
                file.rounds.retain(|r| (a..=b).contains(&r.number));
            }
            if anonymize {
                let alias: std::collections::HashMap<String, usize> = file.players.iter().enumerate().map(|(i, p)| (p.key.clone(), i + 1)).collect();
                for (i, p) in file.players.iter_mut().enumerate() {
                    (p.key, p.name) = (format!("p{}", i + 1), format!("Player {}", i + 1));
                }
                for r in &mut file.rounds {
                    for (key, p) in r.keys.iter_mut().zip(&mut r.clip.players) {
                        let n = alias.get(key.as_str()).copied().unwrap_or(0);
                        (*key, p.name) = (format!("p{n}"), format!("Player {n}"));
                    }
                }
            }
            let json = if pretty { serde_json::to_vec_pretty(&file) } else { serde_json::to_vec(&file) }.map_err(|e| e.to_string())?;
            let size = write_out(output.as_ref(), &json)?;
            let demo_size = std::fs::metadata(&demo).map(|m| m.len()).unwrap_or(0);
            eprintln!(
                "{} rounds · {:.0} MB demo → {:.0} KB ({:.0} KB JSON), 1/{:.0}",
                file.rounds.len(), demo_size as f64 / 1e6, size as f64 / 1e3, json.len() as f64 / 1e3, demo_size as f64 / size.max(1) as f64
            );
        }
    }
    Ok(())
}
