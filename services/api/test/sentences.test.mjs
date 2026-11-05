import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "../src/sentences.mjs";

const texts = (t, o) => splitSentences(t, o).sentences.map((s) => s.text);

test("splits on . ! ? and keeps decimals whole", () => {
  assert.deepEqual(texts("NEAR has 1.5 billion tokens. Is it true? Yes! It is."), ["NEAR has 1.5 billion tokens.", "Is it true?", "Yes!", "It is."]);
  assert.deepEqual(texts("Fees fell 3.2% to $0.0001. Version 2.1.4 shipped."), ["Fees fell 3.2% to $0.0001.", "Version 2.1.4 shipped."]);
});

test("abbreviations: titles, e.g., vs., initials and dotted acronyms never split", () => {
  assert.deepEqual(texts("Dr. Smith met Mr. Jones. They agreed."), ["Dr. Smith met Mr. Jones.", "They agreed."]);
  assert.deepEqual(texts("It costs $3 vs. $4 elsewhere. Some chains, e.g. NEAR, are fast."), ["It costs $3 vs. $4 elsewhere.", "Some chains, e.g. NEAR, are fast."]);
  assert.deepEqual(texts("J. K. Rowling wrote it. The U.S. Senate voted."), ["J. K. Rowling wrote it.", "The U.S. Senate voted."]);
  assert.deepEqual(texts("See No. 5 and p. 12 for that. Done."), ["See No. 5 and p. 12 for that.", "Done."]);
});

test("a word that is also an abbreviation still ends a sentence when nothing marks it", () => {
  assert.deepEqual(texts("The answer is no. That's final."), ["The answer is no.", "That's final."]);
  assert.deepEqual(texts("They work at Apple Inc. The company grew."), ["They work at Apple Inc.", "The company grew."]);
});

test("URLs, domains and emails are never split", () => {
  assert.deepEqual(texts("Read https://near.org/blog/intents.v2?a=1.2 first. Then decide."), ["Read https://near.org/blog/intents.v2?a=1.2 first.", "Then decide."]);
  assert.deepEqual(texts("Visit near.org. Mail a.b@x.com. Done"), ["Visit near.org.", "Mail a.b@x.com.", "Done"]);
  assert.deepEqual(texts("Docs at www.example.com/x.html say so."), ["Docs at www.example.com/x.html say so."]);
});

test("lowercase after a dot means the sentence continues", () => {
  assert.deepEqual(texts("Volume was approx. ten million. Fine."), ["Volume was approx. ten million.", "Fine."]);
});

test("quotes, ellipses and closing brackets stay attached", () => {
  assert.deepEqual(texts('He said "It works." Then he left... And came back (twice.) Ok.'), ['He said "It works."', "Then he left...", "And came back (twice.)", "Ok."]);
});

test("line breaks: blank lines and new lines of thought split, wrapped prose joins, bullets are stripped", () => {
  assert.deepEqual(texts("gm\nNEAR is the fastest chain\n\n- Point one is here\n- Point two is here"), ["gm", "NEAR is the fastest chain", "Point one is here", "Point two is here"]);
  assert.deepEqual(texts("Wrapped prose that\ncontinues on the next line. Next one."), ["Wrapped prose that continues on the next line.", "Next one."]);
  assert.deepEqual(texts("1. First item\r\n2) Second item"), ["First item", "Second item"]);
});

test("drops fragments with no letters or digits", () => {
  assert.deepEqual(texts("Real sentence. ... !!! 🚀🚀"), ["Real sentence."]);
  assert.deepEqual(texts("   "), []);
  assert.deepEqual(texts(""), []);
});

test("caps at 12 sentences and flags the rest", () => {
  const t = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" ");
  const r = splitSentences(t);
  assert.equal(r.sentences.length, 12);
  assert.equal(r.truncated, true);
  assert.equal(r.total, 20);
  assert.equal(r.sentences[11].text, "Sentence number 12 is here.");
  assert.equal(r.sentences[11].index, 11);
});

test("flags sentences over 600 UTF-8 bytes (the contract's limit), counting bytes not characters", () => {
  const ascii = "a".repeat(599) + ".";
  assert.equal(splitSentences(ascii).sentences[0].tooLong, false);
  assert.equal(splitSentences("a".repeat(600) + ".").sentences[0].tooLong, true);
  const multi = "é".repeat(300) + "."; // 601 bytes, 301 characters
  const s = splitSentences(multi).sentences[0];
  assert.equal(s.bytes, 601);
  assert.equal(s.tooLong, true);
});

test("deterministic: the same input gives the same output", () => {
  const t = "Dr. A said 3.5 is right. See near.org! Is it?\n\nNew para here.";
  assert.deepEqual(splitSentences(t), splitSentences(t));
});
