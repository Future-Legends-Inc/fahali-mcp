/**
 * A WITHHELD CLAIM MUST NOT NARRATE ITSELF AS AN EMPTY RESPONSE.
 *
 * ── The defect, measured across 127 live sweep envelopes (2026-09-05) ───────
 * Five tools declared a refusal state while carrying 283 rows of measured data
 * between them — and the two worst are the ones this server's own instructions
 * name as the primary judgment surface:
 *
 *   fahali_get_market_decision   70 rows | responseState WITHHELD · dataState MEASURED
 *   fahali_get_market_verdict    70 rows | responseState WITHHELD · dataState MEASURED
 *   fahali_get_symbol_decision   45 rows | responseState WITHHELD
 *   fahali_watch_portfolio       50 rows | WITHHELD
 *   fahali_update_portfolio_watch 48 rows | WITHHELD
 *
 * `fahali_get_market_decision`'s briefing opened with "Binding decision
 * withheld." plus SIX stacked REQUIRED_SOURCE_* codes, and then returned — so
 * the 2 symbols, 6 directional producers, judged record, resolved identity,
 * evidence quality and market session in the very same payload were never
 * mentioned. An agent reading that reports it received nothing.
 *
 * ── What is NOT being changed ───────────────────────────────────────────────
 * The withholding itself is correct and is untouched. The arbiter still refuses
 * to bind without its required sources; `responseState` still reads WITHHELD;
 * a de-promoted directional headline still never returns. Only the reading
 * ORDER changed. The house rule is *withhold the CLAIM, never the DATA* — and
 * it governs the sentence as much as the payload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

const decorate = (
  data: Record<string, unknown>,
  tool = "fahali_get_market_decision",
) =>
  decorateForAgent(tool, { structuredContent: data, content: [] } as any, {
    detail: "audit",
  } as any).structuredContent as Record<string, any>;

/** A stale payload that is nonetheless FULL of readings. */
const staleButFull = () => ({
  status: "STALE",
  dataState: "stale",
  freshness: {
    dataAsOf: "2026-09-04T10:00:00.000Z",
    dataAgeSeconds: 99_999,
    staleAfterSeconds: 300,
    stale: true,
  },
  alerts: [
    { symbol: "BTCUSDT", alertType: "regime_state", message: "one" },
    { symbol: "ETHUSDT", alertType: "regime_state", message: "two" },
    { symbol: "SOLUSDT", alertType: "momentum_shift", message: "three" },
  ],
  clusters: [{ symbol: "BTCUSDT", thesis: "Market Regime Reading" }],
});

test("a STALE response names the rows it returned before it names the withholding", () => {
  const sc = decorate(staleButFull(), "fahali_get_realtime_alerts");

  // The withholding is intact — this test must never be the reason it weakens.
  assert.equal(sc.responseState, "WITHHELD");
  assert.equal(sc.dataState, "stale");

  const brief: string = sc.agentBriefing;
  const deliveredAt = brief.indexOf("DELIVERED data");
  const withheldAt = brief.search(/withheld the stale claim/i);

  assert.ok(deliveredAt >= 0, "the briefing must say the response carried data");
  assert.ok(withheldAt >= 0, "and must still say the claim was withheld");
  assert.ok(
    deliveredAt < withheldAt,
    "the data must be reported BEFORE the withholding — that ordering IS the fix",
  );
  assert.match(brief, /not the data/, "the two must be explicitly distinguished");
  assert.match(brief, /freshness/, "and the agent must be told how to judge the rows itself");
});

test("🔴 NEGATIVE CONTROL — an EMPTY withheld response must not claim it delivered anything", () => {
  // The failure mode of this fix is the mirror of the defect: announcing
  // delivery over a payload that carries nothing. That would be a fabrication,
  // and a worse one, because it reads as reassurance.
  const sc = decorate(
    {
      status: "STALE",
      dataState: "stale",
      freshness: { dataAgeSeconds: 99_999, staleAfterSeconds: 300, stale: true },
      alerts: [],
      clusters: [],
    },
    "fahali_get_realtime_alerts",
  );

  assert.equal(sc.responseState, "WITHHELD");
  assert.doesNotMatch(
    sc.agentBriefing,
    /DELIVERED data/,
    "there was nothing to deliver — saying otherwise would fabricate evidence",
  );
  assert.doesNotMatch(
    sc.agentBriefing,
    /not the data/,
    "the qualifier only makes sense when data was actually returned",
  );
});

test("the delivered summary counts PAYLOAD, never the envelope's own blocks", () => {
  // `freshness`, `coverage`, `scope`, `nextActions` and friends are added BY the
  // decorator. Counting them as data would inflate every response and make the
  // sentence meaningless — the same class as counting a catalogue as readings.
  const sc = decorate(staleButFull(), "fahali_get_realtime_alerts");
  const brief: string = sc.agentBriefing;
  const carriesLine = brief.split("\n").find((l) => l.includes("It carries")) ?? "";

  for (const envelopeKey of [
    "freshness",
    "coverage",
    "scope",
    "nextActions",
    "responseControl",
    "claimPolicy",
    "confidenceSemantics",
  ]) {
    assert.ok(
      !carriesLine.includes(`\`${envelopeKey}\``),
      `${envelopeKey} is authored by the decorator and must not be reported as payload`,
    );
  }
  assert.match(carriesLine, /`alerts`|`clusters`/, "…while the real payload blocks ARE named");
});

test("stacked eligibility reasons collapse to ONE sentence and stay whole in the JSON", () => {
  // Six REQUIRED_SOURCE_* codes as the first thing an agent reads is how the
  // payload got buried. They remain addressable; they stop being the headline.
  const sc = decorate(staleButFull(), "fahali_get_realtime_alerts");
  const thesis: string = sc.agentBriefing.split("## ")[1] ?? sc.agentBriefing;
  const codeHits = thesis.match(/REQUIRED_SOURCE_[A-Z_]+/g) ?? [];
  assert.ok(
    codeHits.length <= 1,
    `the thesis must not stack internal codes; found ${codeHits.length}`,
  );
  // And the machine-readable record is untouched.
  assert.ok(sc.absence, "absence must still carry the structured reason");
});

test("the PORTFOLIO-MONITORING withheld kind reports its data too", () => {
  /*
    A separate `decisionEligibility.kind`, and the reason this test exists as a
    fixture rather than as a read of `.sweep/`: `watch_portfolio` and
    `update_portfolio_watch` are WRITE tools, so the sweep skips them and their
    envelopes on disk are left over from an earlier run. Reading those stale
    files reported these two as still-broken when the branch had already been
    fixed — an artifact is not a measurement unless you know when it was written.
  */
  const sc = decorate(
    {
      status: "STALE",
      dataState: "stale",
      freshness: { dataAgeSeconds: 99_999, staleAfterSeconds: 300, stale: true },
      positions: [
        { symbol: "BTCUSDT", qty: 1 },
        { symbol: "ETHUSDT", qty: 2 },
      ],
      watch: { id: "w1", name: "book" },
    },
    "fahali_watch_portfolio",
  );

  assert.equal(sc.responseState, "WITHHELD", "the withholding is untouched");
  assert.doesNotMatch(
    sc.agentBriefing,
    /Binding decision withheld\./,
    "the phrasing that buried the payload must be gone from every branch",
  );
  assert.match(sc.agentBriefing, /DELIVERED data/, "and the rows it returned must be named");
});
