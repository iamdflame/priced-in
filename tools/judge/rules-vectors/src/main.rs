//! Prints test vectors for crates/rules as JSON, computed by the crate itself.
//! Response bodies are hex, so invalid UTF-8 can be a case too. Results are "TRUE", "FALSE",
//! "INSUFFICIENT", "UNPARSEABLE" or "ERR:<the crate's message>".

use rules::{extras_ok, split_bonds, tiers_ok, verdict_of_answer, verdict_of_response, window_secs};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[self.below(xs.len() as u64) as usize]
    }
}

fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 || (c as u32) >= 0x7f => {
                let mut buf = [0u16; 2];
                for u in c.encode_utf16(&mut buf) {
                    o.push_str(&format!("\\u{:04x}", u));
                }
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// A JSON string with non-ASCII characters written raw (UTF-8), as most models send them.
fn js_raw(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn res(r: Result<&str, &str>) -> String {
    match r {
        Ok(v) => js(v),
        Err(e) => js(&format!("ERR:{}", e)),
    }
}

const M: &str = "z-ai/glm-5.3-flash";

/// Pieces of a first line, including every Unicode White_Space character and a few that only
/// look like it (U+FEFF, U+200B), because Rust's trim and JavaScript's trim disagree on them.
const PIECES: &[&str] = &[
    "VERDICT: TRUE", "VERDICT: FALSE", "VERDICT: INSUFFICIENT", "VERDICT:", " ", "  ", "TRUE", "FALSE", "INSUFFICIENT",
    "\n", "\r\n", "\r", "\t", "\u{b}", "\u{c}", "\u{85}", "\u{a0}", "\u{1680}", "\u{2000}", "\u{200a}", "\u{2028}", "\u{2029}",
    "\u{202f}", "\u{205f}", "\u{3000}", "\u{feff}", "\u{200b}", "verdict: true", "**", "<think>", "</think>", "x", ".", "MAYBE",
];

fn random_answer(r: &mut Rng) -> String {
    let n = 1 + r.below(6);
    let mut s = String::new();
    for _ in 0..n {
        s.push_str(r.pick(PIECES));
    }
    s
}

fn answer_value(r: &mut Rng) -> String {
    match r.below(40) {
        0 => "null".into(),
        1 => "7".into(),
        2 => "[\"VERDICT: TRUE\"]".into(),
        3 => "{\"text\":\"VERDICT: TRUE\"}".into(),
        4..=12 => js(r.pick(&["VERDICT: TRUE\nThe source says so.", "VERDICT: FALSE\nIt does not.", "VERDICT: INSUFFICIENT", "\n VERDICT: TRUE "])),
        _ => {
            let a = random_answer(r);
            if r.below(8) == 0 {
                // the same answer written with \u escapes
                let mut o = String::from("\"");
                for u in a.encode_utf16() {
                    o.push_str(&format!("\\u{:04X}", u));
                }
                o.push('"');
                o
            } else if r.below(2) == 0 {
                js_raw(&a)
            } else {
                js(&a)
            }
        }
    }
}

fn junk(r: &mut Rng, depth: u32) -> String {
    match r.below(if depth > 3 { 6 } else { 9 }) {
        0 => "null".into(),
        1 => "true".into(),
        2 => r.pick(&["0", "-1", "3.25", "1e3", "-0", "12345678901234567890", "1e308", "1e309", "-1e400", "2.5E-3"]).into(),
        3 => js(r.pick(&["VERDICT: TRUE", "", "x", "\u{1f600}", "a\"b"])),
        4 => r.pick(&["\"\\ud800\"", "\"\\udc00\"", "\"\\ud83d\\ude00\"", "\"\\u00e9\"", "\"\\/\""]).into(),
        5 => r.pick(&["\"VERDICT: TRUE\"", "{}", "[]"]).into(),
        6 => format!("[{},{}]", junk(r, depth + 1), junk(r, depth + 1)),
        7 => format!("{{\"k\":{},\"reasoning_content\":{}}}", junk(r, depth + 1), js("VERDICT: TRUE")),
        _ => format!("{{\"a\":{}}}", junk(r, depth + 1)),
    }
}

fn message(r: &mut Rng) -> String {
    match r.below(48) {
        0 => "null".into(),
        1 => "\"VERDICT: TRUE\"".into(),
        2 => "[]".into(),
        3 => format!("[{}]", answer_value(r)),
        _ => {
            let mut fields: Vec<String> = vec![];
            if r.below(6) != 0 {
                fields.push(format!("\"content\":{}", answer_value(r)));
            }
            if r.below(2) == 0 {
                fields.push(format!("\"reasoning_content\":{}", js(r.pick(&["VERDICT: TRUE", "VERDICT: FALSE", "thinking"]))));
            }
            if r.below(3) == 0 {
                fields.push(format!("\"role\":{}", js("assistant")));
            }
            if r.below(30) == 0 {
                fields.push(format!("\"content\":{}", answer_value(r))); // a second content key
            }
            if r.below(8) == 0 {
                fields.push(format!("\"x\":{}", junk(r, 0)));
            }
            if r.below(12) == 0 {
                fields.push(format!("\"Content\":{}", js("VERDICT: TRUE")));
            }
            // shuffle
            for i in (1..fields.len()).rev() {
                let j = r.below(i as u64 + 1) as usize;
                fields.swap(i, j);
            }
            format!("{{{}}}", fields.join(","))
        }
    }
}

fn choice(r: &mut Rng) -> String {
    match r.below(48) {
        0 => "null".into(),
        1 => "\"x\"".into(),
        2 => format!("[{}]", message(r)),
        _ => {
            let mut fields: Vec<String> = vec![];
            if r.below(8) != 0 {
                fields.push(format!("\"message\":{}", message(r)));
            }
            if r.below(2) == 0 {
                fields.push("\"index\":0".into());
            }
            if r.below(3) == 0 {
                fields.push(format!("\"finish_reason\":{}", js(r.pick(&["stop", "length"]))));
            }
            if r.below(40) == 0 {
                fields.push(format!("\"message\":{}", message(r)));
            }
            if r.below(10) == 0 {
                fields.push(format!("\"delta\":{}", message(r)));
            }
            format!("{{{}}}", fields.join(","))
        }
    }
}

fn model(r: &mut Rng) -> String {
    match r.below(30) {
        0 => "null".into(),
        1 => "5".into(),
        2 => js("Qwen/Qwen3.8-27B"),
        3 => js("z-ai/glm-5.3-flash "),
        4 => "\"z-ai\\/glm-5.3-flash\"".into(),
        5 => "\"z-ai/glm-5.3-fl\\u0061sh\"".into(),
        6 => "[\"z-ai/glm-5.3-flash\"]".into(),
        _ => js(M),
    }
}

fn body(r: &mut Rng) -> Vec<u8> {
    let shape = r.below(60);
    let mut s = if shape == 0 {
        // a struct in sequence form, which serde's derive also accepts
        let n = r.below(4);
        let mut items = vec![];
        if n > 0 {
            items.push(model(r));
        }
        if n > 1 {
            items.push(format!("[{}]", choice(r)));
        }
        if n > 2 {
            items.push("1".into());
        }
        format!("[{}]", items.join(","))
    } else if shape == 1 {
        r.pick(&["", "null", "\"VERDICT: TRUE\"", "[]", "{}", "VERDICT: TRUE", "{\"model\":", "{\"model\":\"z-ai/glm-5.3-flash\",}"]).into()
    } else {
        let mut fields: Vec<String> = vec![];
        if r.below(12) != 0 {
            fields.push(format!("\"model\":{}", model(r)));
        }
        if r.below(10) != 0 {
            let c = match r.below(40) {
                0 => "null".to_string(),
                1 => "{}".to_string(),
                2 => "\"x\"".to_string(),
                _ => {
                    let k = if r.below(8) == 0 { r.below(4) } else { 1 + r.below(2) };
                    let items: Vec<String> = (0..k).map(|_| choice(r)).collect();
                    format!("[{}]", items.join(","))
                }
            };
            fields.push(format!("\"choices\":{}", c));
        }
        if r.below(3) == 0 {
            fields.push(format!("\"id\":{}", js("chatcmpl-1")));
        }
        if r.below(4) == 0 {
            fields.push(format!("\"object\":{}", js("chat.completion")));
        }
        if r.below(6) == 0 {
            fields.push(format!("\"usage\":{}", junk(r, 0)));
        }
        if r.below(60) == 0 {
            fields.push(format!("\"model\":{}", model(r)));
        }
        if r.below(60) == 0 {
            fields.push("\"choices\":[]".into());
        }
        if r.below(10) == 0 {
            fields.push(format!("\"note\":{}", js("VERDICT: TRUE")));
        }
        for i in (1..fields.len()).rev() {
            let j = r.below(i as u64 + 1) as usize;
            fields.swap(i, j);
        }
        let sep = if r.below(5) == 0 { ",\n  " } else { "," };
        format!("{{{}}}", fields.join(sep))
    };
    match r.below(100) {
        0 => s = format!("\u{feff}{}", s),
        1 => s.push_str(" x"),
        2 => s.push_str("\n\t "),
        3 => s = format!(" \r\n{}", s),
        4 => s.push_str("{}"),
        _ => {}
    }
    let mut b = s.into_bytes();
    if r.below(150) == 0 && !b.is_empty() {
        // invalid UTF-8 somewhere (inside a string or not)
        let at = r.below(b.len() as u64) as usize;
        b.insert(at, 0xff);
    }
    b
}

fn nested(depth: usize, inner: &str) -> String {
    format!("{}{}{}", "[".repeat(depth), inner, "]".repeat(depth))
}

fn main() {
    let mut r = Rng(0x2545_f491_4f6c_dd1d);
    let mut out = String::from("{\"generator\":\"tools/judge/rules-vectors (crates/rules)\",\n");

    // ---------- verdict_of_answer ----------
    let mut answers: Vec<String> = [
        "VERDICT: TRUE\nBecause.", "\n\n  VERDICT: FALSE  \r\nBecause.", "VERDICT: INSUFFICIENT", "", "\n \n", "verdict: true",
        "VERDICT:TRUE", "VERDICT: TRUE.", "**VERDICT: TRUE**", "VERDICT: TRUE because", "I think\nVERDICT: TRUE",
        "<think>x</think>\nVERDICT: TRUE", "VERDICT: MAYBE", "\u{feff}VERDICT: TRUE", "\u{85}VERDICT: TRUE", "\u{a0}VERDICT: FALSE\u{3000}",
        "VERDICT:  TRUE", "VERDICT: TRUE\r", "\rVERDICT: TRUE", "\u{2028}VERDICT: TRUE", "VERDICT: true", "VERDICT: TRUE\u{200b}",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    for _ in 0..3000 {
        answers.push(random_answer(&mut r));
    }
    out.push_str("\"answers\":[\n");
    out.push_str(&answers.iter().map(|a| format!("[{},{}]", js(a), js(verdict_of_answer(a)))).collect::<Vec<_>>().join(",\n"));
    out.push_str("],\n");

    // ---------- verdict_of_response ----------
    let mut bodies: Vec<(Vec<u8>, String)> = vec![];
    let fixed: &[&str] = &[
        "{\"id\":\"c\",\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"VERDICT: FALSE\\nNo.\"},\"finish_reason\":\"stop\"}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"I cannot say.\",\"reasoning_content\":\"VERDICT: TRUE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":null,\"reasoning_content\":\"VERDICT: TRUE\"},\"finish_reason\":\"length\"}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"reasoning_content\":\"VERDICT: TRUE\",\"content\":\"VERDICT: FALSE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"note\":\"VERDICT: TRUE\",\"choices\":[]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"no\"}},{\"message\":{\"content\":\"VERDICT: TRUE\"}}]}",
        "{\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}]}",
        "VERDICT: TRUE",
        "",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"no\",\"content\":\"VERDICT: TRUE\"}}]}",
        "{\"model\":\"other\",\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\",\"reasoning_content\":\"a\",\"reasoning_content\":\"b\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\"}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":null}",
        "[\"z-ai/glm-5.3-flash\",[{\"message\":{\"content\":\"VERDICT: TRUE\"}}]]",
        "[\"z-ai/glm-5.3-flash\"]",
        "[\"z-ai/glm-5.3-flash\",[[[\"VERDICT: TRUE\"]]]]",
        "[\"z-ai/glm-5.3-flash\",[],7]",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"usage\":1e400}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"\\ud800VERDICT: TRUE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"x\":\"\\udc00\"}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"x\":\"\\ud800\\u0041\"}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT:\\tTRUE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}]} ",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}]}}",
        "{\"model\" : \"z-ai/glm-5.3-flash\" , \"choices\" : [ { \"message\" : { \"content\" : \"VERDICT: TRUE\" } } ] }",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":01}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":1.}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":-}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":+1}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":\"\\x\"}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":\"\t\"}",
        "{'model':'z-ai/glm-5.3-flash'}",
        // raw (unescaped) non-ASCII around the verdict line: U+FEFF is not whitespace to Rust
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"\u{feff}VERDICT: TRUE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"\u{85}VERDICT: TRUE\u{3000}\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"\u{a0}\u{2028}VERDICT: FALSE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"\u{200b}VERDICT: TRUE\"}}]}",
        "\u{feff}{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}]}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":NaN}",
        "{\"model\":\"z-ai/glm-5.3-flash\",\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}],\"n\":[1,]}",
    ];
    for f in fixed {
        bodies.push((f.as_bytes().to_vec(), M.to_string()));
    }
    // nesting near serde_json's recursion limit, in an ignored field and in the content path
    for d in [125usize, 126, 127, 128, 129, 130] {
        let b = format!("{{\"model\":\"{}\",\"choices\":[{{\"message\":{{\"content\":\"VERDICT: TRUE\"}}}}],\"x\":{}}}", M, nested(d, "1"));
        bodies.push((b.into_bytes(), M.to_string()));
        let o = format!("{{\"model\":\"{}\",\"choices\":[{{\"message\":{{\"content\":\"VERDICT: TRUE\"}}}}],\"x\":{}{}}}", M, "{\"a\":".repeat(d), format!("1{}", "}".repeat(d)));
        bodies.push((o.into_bytes(), M.to_string()));
    }
    for _ in 0..4000 {
        let b = body(&mut r);
        let want = if r.below(10) == 0 { "Qwen/Qwen3.8-27B" } else { M };
        bodies.push((b, want.to_string()));
    }
    out.push_str("\"responses\":[\n");
    out.push_str(
        &bodies
            .iter()
            .map(|(b, m)| format!("[{},{},{}]", js(&hex(b)), js(m), res(verdict_of_response(b, m))))
            .collect::<Vec<_>>()
            .join(",\n"),
    );
    out.push_str("],\n");

    // ---------- split_bonds ----------
    let mut splits = vec![];
    let hand: Vec<(Vec<(bool, u128)>, bool)> = vec![
        (vec![(true, 1_000_000), (false, 2_000_000), (true, 4_000_000)], true),
        (vec![(true, 1_000_000), (false, 2_000_000), (true, 4_000_000)], false),
        (vec![(false, 1_000_000)], true),
        (vec![(true, 0), (true, 3), (false, 7)], true),
        (vec![(true, 1), (true, 1), (true, 1), (false, 2)], true),
        (vec![], true),
    ];
    for (s, o) in hand {
        splits.push((s, o));
    }
    for _ in 0..3000 {
        let n = 1 + r.below(5) as usize;
        let mut s = vec![];
        for _ in 0..n {
            let amt = match r.below(4) {
                0 => 1 + r.below(10) as u128,
                1 => 1_000_000u128 << r.below(4),
                _ => 1 + r.below(9_000_000_000) as u128,
            };
            s.push((r.below(2) == 0, amt));
        }
        splits.push((s, r.below(2) == 0));
    }
    out.push_str("\"splits\":[\n");
    out.push_str(
        &splits
            .iter()
            .map(|(s, o)| {
                let (pay, treasury) = split_bonds(s, *o);
                let st = s.iter().map(|x| format!("[{},\"{}\"]", x.0, x.1)).collect::<Vec<_>>().join(",");
                let p = pay.iter().map(|x| format!("\"{}\"", x)).collect::<Vec<_>>().join(",");
                format!("[[{}],{},[{}],\"{}\"]", st, o, p, treasury)
            })
            .collect::<Vec<_>>()
            .join(",\n"),
    );
    out.push_str("],\n");

    // ---------- window_secs and tiers_ok ----------
    let mut tiers_cases = vec![];
    let t = vec![(50_000_000u128, 600u64), (500_000_000, 3_600), (5_000_000_000, 21_600)];
    tiers_cases.push((t.clone(), 86_400u64));
    tiers_cases.push((vec![(10, 600), (5, 700)], 800));
    tiers_cases.push((vec![(10, 600), (50, 500)], 800));
    tiers_cases.push((vec![(10, 900)], 800));
    tiers_cases.push((vec![(10, 0)], 800));
    tiers_cases.push((vec![], 0));
    tiers_cases.push((vec![], 86_400));
    tiers_cases.push((vec![(2_000_000, 120)], 180));
    for _ in 0..400 {
        let n = r.below(10) as usize;
        let mut v = vec![];
        let mut a = 0u128;
        let mut w = 1u64;
        for _ in 0..n {
            a = if r.below(6) == 0 { a } else { a + 1 + r.below(1_000_000_000) as u128 };
            w = if r.below(6) == 0 { w.saturating_sub(1) } else { w + r.below(5_000) };
            v.push((a, w));
        }
        let top = if r.below(8) == 0 { 0 } else { w + r.below(3) * 1000 };
        tiers_cases.push((v, top));
    }
    out.push_str("\"tiers\":[\n");
    out.push_str(
        &tiers_cases
            .iter()
            .map(|(v, top)| {
                let probes: Vec<u128> = {
                    let mut p = vec![0u128, 1];
                    for x in v {
                        p.push(x.0.saturating_sub(1));
                        p.push(x.0);
                        p.push(x.0 + 1);
                    }
                    p.push(u128::MAX);
                    p
                };
                let ws = probes.iter().map(|oi| format!("[\"{}\",{}]", oi, window_secs(v, *top, *oi))).collect::<Vec<_>>().join(",");
                let vs = v.iter().map(|x| format!("[\"{}\",{}]", x.0, x.1)).collect::<Vec<_>>().join(",");
                format!("[[{}],{},{},[{}]]", vs, top, tiers_ok(v, *top), ws)
            })
            .collect::<Vec<_>>()
            .join(",\n"),
    );
    out.push_str("],\n");

    // ---------- extras_ok ----------
    let mut extras: Vec<String> = [
        "", "\"max_tokens\":1024,\"reasoning_effort\":\"low\"", "\"chat_template_kwargs\":{\"enable_thinking\":false}", "\"model\":\"other\"",
        "\"stream\":true", "\"temperature\":1", "\"messages\":[]", "\"n\":2", "not json", "\"a\":1,", "\"a\":1},{\"b\":2", "\"a\":1,\"a\":2",
        "\"a\":1,\"model\":2,\"model\":3", "\"Model\":1", "\"mod\\u0065l\":1", " \"a\" : 1 ", "\"a\":1}", "{\"a\":1", "\"\":1", "\"a\":[1,{\"b\":null}]",
        "\"a\":\"\\ud800\"", "\"a\":1e400", "\"top_p\":0.9,\"stop\":[\"\\n\"]",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    extras.push(format!("\"pad\":\"{}\"", "x".repeat(500)));
    extras.push(format!("\"pad\":\"{}\"", "x".repeat(510)));
    extras.push(format!("\"pad\":\"{}\"", "x".repeat(504)));
    let keys = ["max_tokens", "model", "messages", "temperature", "stream", "n", "top_p", "reasoning_effort", "seed", "stream_options"];
    for _ in 0..500 {
        let k = 1 + r.below(4);
        let mut parts = vec![];
        for _ in 0..k {
            let key = r.pick(&keys);
            let val = junk(&mut r, 2);
            parts.push(format!("\"{}\":{}", key, val));
        }
        let mut s = parts.join(",");
        if r.below(10) == 0 {
            s.push(',');
        }
        extras.push(s);
    }
    out.push_str("\"extras\":[\n");
    out.push_str(&extras.iter().map(|e| format!("[{},{}]", js(e), extras_ok(e))).collect::<Vec<_>>().join(",\n"));
    out.push_str("]}\n");
    print!("{}", out);
}
