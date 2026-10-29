/**
 * The guardrail's own guardrail.
 *
 * This tool is the one an agent will trust MOST, which makes a false pass from
 * it the most expensive output in the system: a hallucination that has been
 * through a checker comes out looking audited. So the tests that matter here
 * are not "does it catch bad claims" but "does it ever accidentally bless one".
 *
 *   node --import tsx --test mcp-server/src/factCheck.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { checkAssertion, splitAssertions, summarise, symbolsInClaim, type Assertion } from "./factCheck.js";

const NO_READS = new Map<string, any>();
const reads = (o: Record<string, Partial<{ direction: string; headline: string; actionability: string; abstainReason: string }>>) =>
  new Map(Object.entries(o).map(([k, v]) => [k, { direction: null, headline: null, actionability: null, abstainReason: null, ...v }]));

test("safeToRepeat is true for SUPPORTED and for nothing else", () => {
  // The single most important invariant in this file. If any other verdict can
  // set this true, the tool starts laundering guesses.
  const cases: Assertion[] = [
    checkAssertion("NVDA is set to fall.", reads({ NVDA: { direction: "DOWNSIDE_SKEW", actionability: "ACTIONABLE" } })),
    checkAssertion("NVDA is set to fall.", reads({ NVDA: { direction: "UPSIDE_SKEW", actionability: "ACTIONABLE" } })),
    checkAssertion("NVDA is set to fall.", reads({ NVDA: { direction: "INSUFFICIENT_EVIDENCE", actionability: "ABSTAIN", abstainReason: "below the floor" } })),
    checkAssertion("Dark pool prints show accumulation.", NO_READS),
    checkAssertion("Our price target is $180.", NO_READS),
    checkAssertion("The weather is nice.", NO_READS),
  ];
  for (const a of cases) {
    assert.equal(a.safeToRepeat, a.verdict === "SUPPORTED", `${a.verdict} set safeToRepeat=${a.safeToRepeat}`);
  }
});

test("NO_READ is stated as unverified, never as agreement", () => {
  const a = checkAssertion("SPY looks ready to drop.", reads({ SPY: { actionability: "ABSTAIN", abstainReason: "signals in conflict" } }));
  assert.equal(a.verdict, "NO_READ");
  assert.match(a.explanation, /NOT agreement/i);
  assert.match(a.explanation, /NOT a finding that SPY is calm/i);
  assert.doesNotMatch(a.explanation, /\bverified\b|\bconfirmed\b|\bchecks out\b/i);
});

test("a claim resting on a feed Fahali does not ingest is UNSUPPORTED_SOURCE, not CONTRADICTED", () => {
  // The distinction is the product. "We disagree" implies we looked; we cannot
  // look at a feed we do not have, and saying otherwise is its own fabrication.
  for (const s of [
    "Dark pool activity shows heavy accumulation in NVDA.",
    "On-chain data shows whales moving 14,000 BTC.",
    "Whale wallets accumulated overnight.",
    "Options flow is heavily skewed to puts.",
    "Short interest has spiked to 18%.",
    "13F filings show institutions adding.",
  ]) {
    const a = checkAssertion(s, reads({ NVDA: { direction: "DOWNSIDE_SKEW", actionability: "ACTIONABLE" }, BTC: {} }));
    assert.equal(a.verdict, "UNSUPPORTED_SOURCE", `"${s}" classified ${a.verdict}`);
    assert.match(a.explanation, /does not ingest/);
    assert.match(a.explanation, /do not repeat|do not soften/i);
  }
});

test("price targets, trade instructions and loss promises are OUT_OF_SCOPE", () => {
  const expectations: Array<[string, RegExp]> = [
    ["Our price target is $180 by year end.", /not price targets/i],
    ["NVDA will reach $200 within the month.", /not price targets/i],
    ["You should buy the dip here.", /not investment advice/i],
    ["Fahali protects your capital from drawdowns.", /no loss-prevention claim/i],
    ["The receipts are tamper-proof.", /tamper-EVIDENT/],
    ["All 18 detection engines agree.", /roster completeness is not agreement/i],
  ];
  for (const [s, why] of expectations) {
    const a = checkAssertion(s, NO_READS);
    assert.equal(a.verdict, "OUT_OF_SCOPE", `"${s}" classified ${a.verdict}`);
    assert.match(a.explanation, why);
  }
});

test("the published 18-row roster is not confused with an unanimity claim", () => {
  const a = checkAssertion("Fahali emits one telemetry row for each of its 18 canonical engine slots.", NO_READS);
  assert.notEqual(a.verdict, "OUT_OF_SCOPE");
  assert.equal(a.safeToRepeat, false, "static schema claims still need direct product evidence before repetition");
});

test("an unsourced accuracy figure is caught and sent to the judged record", () => {
  for (const s of [
    "Fahali is right 71% of the time.",
    "The engine has an accuracy of 88%.",
    "It has a 72% win rate.",
    "Precision is 90% on this setup.",
  ]) {
    const a = checkAssertion(s, NO_READS);
    assert.equal(a.verdict, "NO_READ", `"${s}" classified ${a.verdict}`);
    assert.match(a.explanation, /fahali_get_lead_time/);
    assert.match(a.explanation, /recall/i, "a precision quoted without its recall is the flattering half");
    assert.match(a.explanation, /stratum/i);
  }
});

test("direction is scored against the canonical read, both ways", () => {
  const down = reads({ NVDA: { direction: "DOWNSIDE_SKEW", actionability: "ACTIONABLE", headline: "Size is leaving beneath a flat price" } });
  const agree = checkAssertion("NVDA is likely to decline over the next day.", down);
  assert.equal(agree.verdict, "SUPPORTED");
  assert.equal(agree.safeToRepeat, true);
  assert.equal(agree.fahaliSays, "Size is leaving beneath a flat price");

  const disagree = checkAssertion("NVDA is set to rally hard.", down);
  assert.equal(disagree.verdict, "CONTRADICTED");
  assert.match(disagree.explanation, /points the other way/i);
});

test("common English words are never mistaken for tickers", () => {
  // A false ticker produces a confident NO_READ about an instrument nobody
  // mentioned — inventing coverage in the other direction.
  const found = symbolsInClaim("THE MARKET IS UP AND WE CAN SEE IT IS NOT ALL BAD FOR US");
  for (const bad of ["THE", "AND", "ALL", "NOT", "FOR", "US", "IT", "IS", "WE", "CAN", "UP"]) {
    assert.ok(!found.includes(bad), `"${bad}" was treated as an instrument`);
  }
});

test("the summary never reports safeToPublish on unchecked assertions", () => {
  const unchecked = summarise([
    { text: "a", verdict: "SUPPORTED", safeToRepeat: true, explanation: "" },
    { text: "b", verdict: "NO_READ", safeToRepeat: false, explanation: "" },
  ]);
  assert.equal(unchecked.safeToPublish, false, "one unchecked assertion must sink the whole narrative");
  assert.match(unchecked.instruction, /Unchecked is not verified/i);

  const bad = summarise([{ text: "a", verdict: "CONTRADICTED", safeToRepeat: false, explanation: "" }]);
  assert.equal(bad.safeToPublish, false);
  assert.match(bad.instruction, /DO NOT publish/);

  const good = summarise([{ text: "a", verdict: "SUPPORTED", safeToRepeat: true, explanation: "" }]);
  assert.equal(good.safeToPublish, true);
  assert.match(good.instruction, /stratum and recall/i);
});

test("a narrative splits into its individual assertions", () => {
  const parts = splitAssertions("NVDA is falling. Dark pools confirm it! Our target is $150?");
  assert.equal(parts.length, 3);
});

test("the worst verdict wins — a good sentence never rescues a bad one", () => {
  const mixed = summarise([
    { text: "a", verdict: "SUPPORTED", safeToRepeat: true, explanation: "" },
    { text: "b", verdict: "SUPPORTED", safeToRepeat: true, explanation: "" },
    { text: "c", verdict: "UNSUPPORTED_SOURCE", safeToRepeat: false, explanation: "" },
  ]);
  assert.equal(mixed.safeToPublish, false);
  assert.match(mixed.instruction, /DO NOT publish/);
});

test("out-of-scope is checked before source and direction", () => {
  // "Dark pool data says NVDA will hit $200" is BOTH. It must surface as the
  // out-of-scope refusal, because that one is unconditional — no feed would
  // make a price target answerable.
  const a = checkAssertion("Dark pool data says NVDA will reach $200.", reads({ NVDA: { direction: "UPSIDE_SKEW", actionability: "ACTIONABLE" } }));
  assert.equal(a.verdict, "OUT_OF_SCOPE");
});
