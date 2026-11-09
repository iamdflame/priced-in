//! cargo runs `repro-wrapper <rustc> <args...>` for every compile (RUSTC_WRAPPER).
//!
//! For a wasm32-unknown-unknown crate it sets `-C metadata` to the value recorded for that crate,
//! keyed `<package>@<version> <crate name>`:
//!   PRICEDIN_REPRO_METADATA=<file>  lines "<key> <metadata>": use the recorded value
//!   PRICEDIN_REPRO_RECORD=<file>    append "<key> <metadata>" with cargo's own value (the reference host)
//!   PRICEDIN_REPRO_MISSES=<file>    append the keys that had no recorded value
//! Host crates (build scripts, proc macros) and rustc queries pass through unchanged.
use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::process::{exit, Command};

fn append(file: &str, line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(f, "{line}");
    }
}

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("repro-wrapper: no rustc given");
        exit(2);
    }
    let rustc = args.remove(0);
    let wasm = args.windows(2).any(|w| w[0] == "--target" && w[1] == "wasm32-unknown-unknown")
        || args.iter().any(|a| a == "--target=wasm32-unknown-unknown");
    let crate_name = args.windows(2).find(|w| w[0] == "--crate-name").map(|w| w[1].clone());
    if let (true, Some(name)) = (wasm, crate_name) {
        let key = format!(
            "{}@{} {}",
            env::var("CARGO_PKG_NAME").unwrap_or_default(),
            env::var("CARGO_PKG_VERSION").unwrap_or_default(),
            name
        );
        // "-C" "metadata=..." or "-Cmetadata=..."
        let at = args
            .iter()
            .enumerate()
            .find(|&(i, a)| (a.starts_with("metadata=") && i > 0 && args[i - 1] == "-C") || a.starts_with("-Cmetadata="))
            .map(|(i, _)| i);
        if let Some(i) = at {
            let prefix = if args[i].starts_with("-C") { "-Cmetadata=" } else { "metadata=" };
            let current = args[i][prefix.len()..].to_string();
            if let Ok(file) = env::var("PRICEDIN_REPRO_RECORD") {
                append(&file, &format!("{key} {current}"));
            }
            if let Ok(file) = env::var("PRICEDIN_REPRO_METADATA") {
                let text = fs::read_to_string(&file).unwrap_or_default();
                let map: HashMap<&str, &str> = text.lines().filter_map(|l| l.rsplit_once(' ')).collect();
                match map.get(key.as_str()) {
                    Some(v) => args[i] = format!("{prefix}{v}"),
                    None => {
                        if let Ok(m) = env::var("PRICEDIN_REPRO_MISSES") {
                            append(&m, &key);
                        }
                    }
                }
            }
        }
        // no -C metadata: cargo's target probe (`--crate-name ___ --print ...`), compiles nothing
    }
    match Command::new(&rustc).args(&args).status() {
        Ok(s) => exit(s.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("repro-wrapper: could not run {rustc}: {e}");
            exit(1);
        }
    }
}
