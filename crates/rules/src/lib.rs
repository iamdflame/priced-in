//! The money-and-verdict rules of the market's resolution, as pure functions.
//!
//! They live outside the contract so they run under native `cargo test -p rules`, with the
//! same code the contract executes: reading a juror's answer, splitting bonds, choosing the
//! dispute window, checking per-model request extras.

use serde::de::IgnoredAny;
use serde::Deserialize;
use std::collections::BTreeMap;

pub const UNPARSEABLE: &str = "UNPARSEABLE";

#[derive(Deserialize)]
struct Completion {
    model: Option<String>,
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Option<Message>,
}

/// Only `content` is declared. `reasoning_content` is never read, so nothing a model writes
/// while thinking, and nothing evidence provokes it to think, can become a verdict.
#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

/// The verdict is the first non-empty line of the answer, and must be exactly one of the
/// three forms. Anything else is UNPARSEABLE.
pub fn verdict_of_answer(content: &str) -> &'static str {
    let line = content.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    match line {
        "VERDICT: TRUE" => "TRUE",
        "VERDICT: FALSE" => "FALSE",
        "VERDICT: INSUFFICIENT" => "INSUFFICIENT",
        _ => UNPARSEABLE,
    }
}

/// Read a signed chat completion. Refuses bytes that are not a completion and a response that
/// names another model. An answer with no usable content is a verdict of UNPARSEABLE.
/// A repeated `content` or `model` key is refused too, so one body can't say two things.
pub fn verdict_of_response(body: &[u8], requested_model: &str) -> Result<&'static str, &'static str> {
    let c: Completion = serde_json::from_slice(body).map_err(|_| "the response is not a chat completion")?;
    if c.model.as_deref() != Some(requested_model) {
        return Err("the response names a different model");
    }
    let content = c.choices.first().and_then(|x| x.message.as_ref()).and_then(|m| m.content.as_deref());
    Ok(content.map_or(UNPARSEABLE, verdict_of_answer))
}

/// How long a provisional outcome stays open to dispute, for a given open interest:
/// the first tier whose `below` the open interest is under, else `top_secs`.
pub fn window_secs(tiers: &[(u128, u64)], top_secs: u64, open_interest_micro: u128) -> u64 {
    tiers.iter().find(|t| open_interest_micro < t.0).map_or(top_secs, |t| t.1)
}

/// A dispute table is usable if thresholds rise, windows never shrink as the money grows,
/// and every window is positive.
pub fn tiers_ok(tiers: &[(u128, u64)], top_secs: u64) -> bool {
    if tiers.len() > 8 || top_secs == 0 {
        return false;
    }
    let mut last = (0u128, 1u64);
    for t in tiers {
        if t.0 <= last.0 || t.1 < last.1 || t.1 > top_secs {
            return false;
        }
        last = *t;
    }
    true
}

/// Who gets what when a challenge resolves. `stakes` is (side, bond) in order of posting.
/// Each stake on the winning side gets its bond back plus a share of the losers' bonds in
/// proportion to its bond. Nothing is taken out: the payouts sum to the total posted, except
/// that with no stake on the winning side all of it goes to the second value (the treasury).
/// Rounding dust goes to the first winning stake, so every micro-USDC is paid.
pub fn split_bonds(stakes: &[(bool, u128)], outcome: bool) -> (Vec<u128>, u128) {
    let won: u128 = stakes.iter().filter(|s| s.0 == outcome).map(|s| s.1).sum();
    let lost: u128 = stakes.iter().filter(|s| s.0 != outcome).map(|s| s.1).sum();
    if won == 0 {
        return (vec![0; stakes.len()], lost);
    }
    let mut pay: Vec<u128> = stakes.iter().map(|s| if s.0 == outcome { s.1 + lost * s.1 / won } else { 0 }).collect();
    let paid: u128 = pay.iter().sum();
    let first = stakes.iter().position(|s| s.0 == outcome && s.1 > 0).unwrap_or(0);
    pay[first] += won + lost - paid;
    (pay, 0)
}

/// Per-model request extras are the inside of a JSON object, for example
/// `"max_tokens":1024,"reasoning_effort":"low"`, spliced into the canonical request. They may
/// tune the model but never replace what the contract fixes.
pub fn extras_ok(extras: &str) -> bool {
    if extras.is_empty() {
        return true;
    }
    if extras.len() > 512 {
        return false;
    }
    let mut body = String::with_capacity(extras.len() + 2);
    body.push('{');
    body.push_str(extras);
    body.push('}');
    match serde_json::from_str::<BTreeMap<String, IgnoredAny>>(&body) {
        Ok(m) => !["model", "messages", "temperature", "stream", "n"].iter().any(|k| m.contains_key(*k)),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: &str = "z-ai/glm-5.3-flash";

    fn body(content: &str) -> Vec<u8> {
        format!(
            "{{\"id\":\"c\",\"model\":\"{}\",\"choices\":[{{\"index\":0,\"message\":{{\"role\":\"assistant\",\"content\":{}}},\"finish_reason\":\"stop\"}}]}}",
            M,
            serde_json::to_string(content).unwrap()
        )
        .into_bytes()
    }

    #[test]
    fn answer_first_non_empty_line_exactly() {
        assert_eq!(verdict_of_answer("VERDICT: TRUE\nBecause."), "TRUE");
        assert_eq!(verdict_of_answer("\n\n  VERDICT: FALSE  \r\nBecause."), "FALSE");
        assert_eq!(verdict_of_answer("VERDICT: INSUFFICIENT"), "INSUFFICIENT");
        for bad in [
            "",
            "\n \n",
            "verdict: true",
            "VERDICT:TRUE",
            "VERDICT: TRUE.",
            "**VERDICT: TRUE**",
            "VERDICT: TRUE because",
            "I think\nVERDICT: TRUE",
            "<think>x</think>\nVERDICT: TRUE",
            "VERDICT: MAYBE",
        ] {
            assert_eq!(verdict_of_answer(bad), UNPARSEABLE, "{bad:?}");
        }
    }

    #[test]
    fn response_reads_content_only() {
        assert_eq!(verdict_of_response(&body("VERDICT: FALSE\nNo."), M), Ok("FALSE"));
        let hidden = format!("{{\"model\":\"{M}\",\"choices\":[{{\"message\":{{\"content\":\"I cannot say.\",\"reasoning_content\":\"VERDICT: TRUE\"}}}}]}}");
        assert_eq!(verdict_of_response(hidden.as_bytes(), M), Ok(UNPARSEABLE));
        let null_content = format!("{{\"model\":\"{M}\",\"choices\":[{{\"message\":{{\"content\":null,\"reasoning_content\":\"VERDICT: TRUE\"}},\"finish_reason\":\"length\"}}]}}");
        assert_eq!(verdict_of_response(null_content.as_bytes(), M), Ok(UNPARSEABLE));
        let think_true_say_false = format!("{{\"model\":\"{M}\",\"choices\":[{{\"message\":{{\"reasoning_content\":\"VERDICT: TRUE\",\"content\":\"VERDICT: FALSE\"}}}}]}}");
        assert_eq!(verdict_of_response(think_true_say_false.as_bytes(), M), Ok("FALSE"));
        let verdict_elsewhere = format!("{{\"model\":\"{M}\",\"note\":\"VERDICT: TRUE\",\"choices\":[]}}");
        assert_eq!(verdict_of_response(verdict_elsewhere.as_bytes(), M), Ok(UNPARSEABLE));
        let second_choice = format!("{{\"model\":\"{M}\",\"choices\":[{{\"message\":{{\"content\":\"no\"}}}},{{\"message\":{{\"content\":\"VERDICT: TRUE\"}}}}]}}");
        assert_eq!(verdict_of_response(second_choice.as_bytes(), M), Ok(UNPARSEABLE));
    }

    #[test]
    fn response_refuses_other_models_and_non_completions() {
        assert!(verdict_of_response(&body("VERDICT: TRUE"), "Qwen/Qwen3.8-27B").is_err());
        assert!(verdict_of_response(b"{\"choices\":[{\"message\":{\"content\":\"VERDICT: TRUE\"}}]}", M).is_err());
        assert!(verdict_of_response(b"VERDICT: TRUE", M).is_err());
        assert!(verdict_of_response(b"", M).is_err());
    }

    #[test]
    fn duplicate_keys_are_refused() {
        let twice = format!("{{\"model\":\"{M}\",\"choices\":[{{\"message\":{{\"content\":\"no\",\"content\":\"VERDICT: TRUE\"}}}}]}}");
        assert!(verdict_of_response(twice.as_bytes(), M).is_err());
        let two_models = format!("{{\"model\":\"other\",\"model\":\"{M}\",\"choices\":[]}}");
        assert!(verdict_of_response(two_models.as_bytes(), M).is_err());
    }

    #[test]
    fn windows_scale_with_open_interest() {
        let t = [(50_000_000u128, 600u64), (500_000_000, 3_600), (5_000_000_000, 21_600)];
        assert_eq!(window_secs(&t, 86_400, 0), 600);
        assert_eq!(window_secs(&t, 86_400, 49_999_999), 600);
        assert_eq!(window_secs(&t, 86_400, 50_000_000), 3_600);
        assert_eq!(window_secs(&t, 86_400, 499_999_999), 3_600);
        assert_eq!(window_secs(&t, 86_400, 500_000_000), 21_600);
        assert_eq!(window_secs(&t, 86_400, 4_999_999_999), 21_600);
        assert_eq!(window_secs(&t, 86_400, 5_000_000_000), 86_400);
        assert_eq!(window_secs(&[], 86_400, 1), 86_400);
        assert!(tiers_ok(&t, 86_400));
        assert!(!tiers_ok(&[(10, 600), (5, 700)], 800), "thresholds must rise");
        assert!(!tiers_ok(&[(10, 600), (50, 500)], 800), "windows never shrink");
        assert!(!tiers_ok(&[(10, 900)], 800), "the top window is the longest");
        assert!(!tiers_ok(&[(10, 0)], 800));
        assert!(!tiers_ok(&[], 0));
    }

    #[test]
    fn the_right_side_takes_everything() {
        // challenger TRUE $1; disputer FALSE $2; disputer TRUE $4
        let s = [(true, 1_000_000u128), (false, 2_000_000), (true, 4_000_000)];
        let (pay, treasury) = split_bonds(&s, true);
        assert_eq!(pay, vec![1_400_000, 0, 5_600_000]);
        assert_eq!(treasury, 0);
        let (pay, treasury) = split_bonds(&s, false);
        assert_eq!(pay, vec![0, 7_000_000, 0]);
        assert_eq!(treasury, 0);
    }

    #[test]
    fn nobody_right_goes_to_the_treasury() {
        let (pay, treasury) = split_bonds(&[(false, 1_000_000)], true);
        assert_eq!(pay, vec![0]);
        assert_eq!(treasury, 1_000_000);
    }

    #[test]
    fn bonds_are_conserved_to_the_micro() {
        let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for _ in 0..200_000 {
            let n = 1 + (next() % 4) as usize;
            let mut stakes = vec![];
            for _ in 0..n {
                stakes.push((next() % 2 == 0, 1 + (next() % 9_000_000_000) as u128));
            }
            let outcome = next() % 2 == 0;
            let total: u128 = stakes.iter().map(|s| s.1).sum();
            let (pay, treasury) = split_bonds(&stakes, outcome);
            assert_eq!(pay.iter().sum::<u128>() + treasury, total);
            for (s, p) in stakes.iter().zip(&pay) {
                if s.0 == outcome {
                    assert!(*p >= s.1, "a winner never loses its bond");
                } else {
                    assert_eq!(*p, 0);
                }
            }
        }
    }

    #[test]
    fn extras_tune_but_never_replace() {
        assert!(extras_ok(""));
        assert!(extras_ok("\"max_tokens\":1024,\"reasoning_effort\":\"low\""));
        assert!(extras_ok("\"chat_template_kwargs\":{\"enable_thinking\":false}"));
        assert!(!extras_ok("\"model\":\"other\""));
        assert!(!extras_ok("\"stream\":true"));
        assert!(!extras_ok("\"temperature\":1"));
        assert!(!extras_ok("\"messages\":[]"));
        assert!(!extras_ok("not json"));
        assert!(!extras_ok("\"a\":1,"));
        assert!(!extras_ok("\"a\":1},{\"b\":2"));
    }
}
