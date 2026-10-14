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
    let m = Match::parse(&bytes)?;
    eprintln!("parsed {} ({:.0} MB) in {:.1} s", demo.display(), bytes.len() as f64 / 1e6, t.elapsed().as_secs_f64());
    Ok(m)
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
            match output {
                None => std::io::stdout().write_all(&json).map_err(|e| e.to_string())?,
                Some(path) => {
                    let bytes = if path.to_string_lossy().ends_with(".json") {
                        json.clone()
                    } else {
                        let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
                        enc.write_all(&json).map_err(|e| e.to_string())?;
                        enc.finish().map_err(|e| e.to_string())?
                    };
                    std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
                    eprintln!("{} · {} frames · {} players · {} B ({} B JSON)", path.display(), clip.frames, clip.players.len(), bytes.len(), json.len());
                }
            }
        }
    }
    Ok(())
}
