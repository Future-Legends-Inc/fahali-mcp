/**
 * The renderer's job is not "make a table." It is: make a table that cannot
 * turn a missing measurement into a reassuring one.
 *
 * Run from the repo root (tsx lives there, not in mcp-server/):
 *   node --import tsx --test mcp-server/src/markdown.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toMarkdown } from "./markdown.js";

/** Cells that are empty, or hold only a dash, are the failure this file exists to catch. */
function cellsOf(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|[\s-]+\|$/.test(l.replace(/\|/g, "|")))
    .flatMap((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}

test("a bare null never renders as an empty or dashed cell", () => {
  const md = toMarkdown({ symbol: "ETH", var95: null })!;
  assert.match(md, /not reported/, "a null must say so in words");
  for (const c of cellsOf(md)) {
    assert.notEqual(c, "", "an empty cell reads as zero to a human");
    assert.notEqual(c, "-", "a dash reads as zero to a human");
    assert.notEqual(c, "—", "an em dash reads as zero to a human");
  }
});

test("a withheld envelope carries its reason into the cell", () => {
  const md = toMarkdown({
    magnitudeLift: { withheld: { reason: "denominator is unconditional on the engine's own trigger" } },
  })!;
  assert.match(md, /withheld/i);
  assert.match(md, /denominator is unconditional/);
});

test("NullReasonValue renders the value when present and the reason when not", () => {
  const present = toMarkdown({ historicalWinRate: { value: 0.71, reason: undefined } })!;
  assert.match(present, /0\.71/);

  const absent = toMarkdown({ historicalWinRate: { value: null, reason: "insufficient sample" } })!;
  assert.match(absent, /withheld/i);
  assert.match(absent, /insufficient sample/);
  assert.doesNotMatch(absent, /\bnull\b/, "the word null is not an explanation");
});

test("an unpublishable row is marked inline, next to the number it disqualifies", () => {
  const md = toMarkdown([
    { engine: "risk_intelligence", precision: 71.44, publishable: true },
    { engine: "forecast_72h", precision: 88.2, publishable: false, withheld: { reason: "n_eff below 30" } },
  ])!;
  assert.match(md, /not publishable/i, "a false publishable flag must be visible in the table");
  assert.match(md, /n_eff below 30/);
  // The number is still shown — the point is that it arrives already labelled,
  // not that it is hidden. Hiding it would make the table disagree with the JSON.
  assert.match(md, /88\.2/);
});

test("an empty list says it is empty rather than rendering nothing", () => {
  const md = toMarkdown({ alerts: [] })!;
  assert.match(md, /none returned/i);
});

test("pipes and newlines in values cannot break out of their cell", () => {
  const md = toMarkdown([{ note: "a|b", detail: "line1\nline2" }])!;
  const body = md.split("\n").filter((l) => l.startsWith("|"));
  for (const row of body) {
    // Built with fromCharCode so this assertion carries no backslash of its own:
    // the escape sequence is exactly what is under test, and a source-level
    // typo here would silently weaken the check rather than fail it.
    const ESCAPED_PIPE = String.fromCharCode(92) + "|";
    const unescaped = row.split(ESCAPED_PIPE).join("");
    assert.equal(unescaped.split("|").length, 4, `row has stray delimiters: ${row}`);
  }
});

test("a long array is truncated with an honest count, never silently", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i}`, score: i }));
  const md = toMarkdown(rows)!;
  assert.match(md, /15 further rows not shown/);
  assert.match(md, /JSON block below/);
});

test("a renderer failure degrades to null instead of taking down the tool call", () => {
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  assert.doesNotThrow(() => toMarkdown(circular));
});

test("scalars keep their meaning: booleans read as words, not as 1/0", () => {
  const md = toMarkdown({ publishable: true, degraded: false })!;
  assert.match(md, /yes/);
  assert.match(md, /no/);
});
