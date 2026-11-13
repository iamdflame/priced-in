// ==UserScript==
// @name         Priced In on Wikipedia
// @namespace    https://isitpriced.com
// @version      1.0.0
// @description  On the Wikipedia articles Priced In covers, strikes each sentence three AI judges ruled false on NEAR mainnet, shows the corrected line, and links the ruling. Read only: no wallet, no account, nothing sent but one GET.
// @match        https://en.wikipedia.org/wiki/*
// @match        https://en.m.wikipedia.org/wiki/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      isitpriced.com
// @run-at       document-idle
// @homepageURL  https://github.com/iamdflame/priced-in/tree/main/tools/userscript
// ==/UserScript==
//
// Install: a userscript manager (Violentmonkey or Tampermonkey), then open this file's raw URL.
// It reads https://isitpriced.com/api/rulings through the manager's request (Wikipedia's Content Security
// Policy blocks a page from calling other sites) and changes only how the page looks in
// your browser. Wikipedia itself is not edited. If Wikipedia has since changed a ruled sentence, the
// banner says so instead of marking anything.
(() => {
  "use strict";
  const API = "https://isitpriced.com";
  // Wikipedia article -> Priced In page (corpus/pages/*.json, "title" -> "slug")
  const PAGES = {
    "Aave": "aave", "Avalanche (blockchain platform)": "avalanche", "Bitcoin": "bitcoin", "Cardano (blockchain platform)": "cardano",
    "Chainlink (blockchain oracle)": "chainlink", "Dai (cryptocurrency)": "dai", "Decentralized finance": "defi", "Ethereum": "ethereum",
    "Monero": "monero", "NEAR (blockchain platform)": "near", "Polkadot (blockchain platform)": "polkadot", "Polymarket": "polymarket",
    "Prediction market": "prediction-market", "Proof of stake": "proof-of-stake", "Solana (blockchain platform)": "solana",
    "Stablecoin": "stablecoin", "Tether (cryptocurrency)": "tether", "Uniswap": "uniswap", "USDC (cryptocurrency)": "usdc", "Zcash": "zcash",
  };
  const title = decodeURIComponent(location.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
  const slug = PAGES[title];
  const root = document.querySelector("#mw-content-text .mw-parser-output");
  if (!slug || !root) return;

  // The same text both ways: no-break spaces, curly quotes and odd hyphens made plain, runs of space made one.
  const plainChar = (c) => (/[   ]/.test(c) ? " " : /[‘’‚′]/.test(c) ? "'" : /[“”„″]/.test(c) ? '"' : /[‐‑‒−]/.test(c) ? "-" : c);
  const plain = (s) => [...s].map(plainChar).join("").replace(/\s+/g, " ").trim();
  const SKIP = "sup.reference, .mw-editsection, style, script, .pi-ins, .pi-badge, .pi-banner";

  /** A block's visible text, footnote markers left out, with each character's node and offset. */
  function textOf(block) {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let text = "";
    const at = [];
    let space = true;
    for (let n; (n = w.nextNode()); ) {
      const s = n.nodeValue;
      for (let i = 0; i < s.length; i++) {
        let c = plainChar(s[i]);
        if (/\s/.test(c)) { if (space) continue; c = " "; space = true; } else space = false;
        text += c;
        at.push([n, i]);
      }
    }
    return { text, at };
  }

  /** Strike one ruled sentence where it stands, and put the corrected line and the ruling after it. */
  function mark(r) {
    const want = plain(r.claim);
    const tries = [want, want.replace(/[.]$/, "")];
    for (const block of root.querySelectorAll("p, li, dd, td, blockquote")) {
      if (block.querySelector("p, li")) continue; // the innermost block holds the sentence
      const { text, at } = textOf(block);
      for (const t of tries) {
        const i = text.indexOf(t);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(at[i][0], at[i][1]);
        const [endNode, endOff] = at[i + t.length - 1];
        range.setEnd(endNode, endOff + 1);
        const del = document.createElement("del");
        del.className = "pi-del";
        del.title = "Ruled false on Priced In";
        del.appendChild(range.extractContents());
        range.insertNode(del);
        const ins = document.createElement("span");
        ins.className = "pi-ins";
        const judges = r.verdicts.filter((v) => v.verdict === "FALSE").length;
        ins.append(" ");
        if (r.correction) {
          const fix = document.createElement("ins");
          fix.textContent = r.correction.text;
          ins.append(fix, " ");
        }
        const a = document.createElement("a");
        a.className = "pi-badge";
        a.href = `${API}/c/${r.claim_id}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = `Ruled false by ${judges} AI judges on NEAR mainnet`;
        ins.append(a);
        del.after(ins);
        return true;
      }
    }
    return false;
  }

  function banner(found, total) {
    const b = document.createElement("div");
    b.className = "pi-banner";
    const gone = total - found;
    b.innerHTML = `<b>Priced In</b> · AI judges ruled ${total} sentence${total === 1 ? "" : "s"} of this article false on NEAR mainnet. `
      + (found ? `${found} ${found === 1 ? "is" : "are"} marked below. ` : "")
      + (gone ? `Wikipedia has since changed ${gone}. ` : "")
      + `<a href="${API}/p/${slug}" target="_blank" rel="noopener">Every line of this article, priced</a>`;
    root.prepend(b);
  }

  const css = document.createElement("style");
  css.textContent = `
    .pi-del { text-decoration: line-through; text-decoration-color: #C51D28; text-decoration-thickness: 2px; background: #FFEEED; color: inherit; }
    .pi-ins ins { text-decoration: none; background: #DFFAE5; color: #0b3d20; padding: 0 2px; }
    .pi-badge { display: inline-block; margin-left: 2px; padding: 0 7px; border-radius: 999px; font-size: 12px; line-height: 1.6; background: #E6F4F7; color: #006E89 !important; white-space: nowrap; }
    .pi-banner { margin: 0 0 12px; padding: 8px 12px; border: 1px solid #c8dde3; border-radius: 8px; background: #F3F9FA; font-size: 14px; line-height: 1.5; }
    .pi-banner a { color: #006E89; }
    @media (prefers-color-scheme: dark) { .skin-theme-clientpref-os .pi-del, .skin-theme-clientpref-night .pi-del { background: #3a1416; } .skin-theme-clientpref-night .pi-ins ins { background: #12351f; color: #c9f5d6; } }
  `;
  document.head.append(css);

  /** GET as JSON through the userscript manager: Tampermonkey's GM_xmlhttpRequest or Greasemonkey 4's GM.xmlHttpRequest. */
  const getJson = (url) => new Promise((ok, fail) => {
    const req = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest : null;
    if (!req) { fetch(url).then((r) => r.json()).then(ok, fail); return; }
    req({ method: "GET", url, headers: { accept: "application/json" }, onload: (r) => { try { ok(JSON.parse(r.responseText)); } catch (e) { fail(e); } }, onerror: fail });
  });

  getJson(`${API}/api/rulings`)
    .then((j) => {
      const ruled = (j.rulings || []).filter((r) => r.page === slug && r.status === "settled" && r.outcome === "FALSE");
      if (!ruled.length) return;
      let found = 0;
      for (const r of ruled) if (mark(r)) found++;
      banner(found, ruled.length);
    })
    .catch(() => { /* the article stays as Wikipedia wrote it */ });
})();
