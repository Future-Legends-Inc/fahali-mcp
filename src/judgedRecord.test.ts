/**
 * THE JUDGED RECORD CONTRACT.
 *
 * This file guards the one section of the briefing that carries a NUMBER a
 * customer's agent may repeat to a human. Everything else in the payload is a
 * read; this is a claim about our own accuracy, and it is the single place
 * where a rendering bug becomes a published false statement.
 *
 * 🔴 Every assertion below is on CONTENT, never on presence. That is not a
 * style note — it is the specific lesson this package already paid for. The
 * test covering `nextTools` asserted `nextTools.length >= 1`, which passed for
 * the entire life of a bug that shipped a literal `"$symbol"` to the channel
 * agents read. An assertion on a collection's SIZE passes for the whole life of
 * a bug in its CONTENTS.
 *
 *   node --import tsx --test mcp-server/src/judgedRecord.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { toJudgedRecord, attachJudgedRecord, type JudgedRecord } from "./judgedRecord.js";
import { buildAgentBriefing } from "./agentPayload.js";

/** A complete headline row, shaped exactly as /api/track-record/lead-time emits it. */
const HEADLINE = {
  engine: "risk_intelligence",
  horizon_tier: "48h",
  bar_regime: "crypto",
  day: "2026-08-21",
  measured_on: "2026-08-21T00:00:00.000Z",
  recall_pct: 26.84,
  precision_pct: 71.44,
  base_rate_pct: 32.77,
  lift_pp: 38.67,
  lead_median_hours: 22.1,
  effective_sample: 1204,
  warned_events: 331,
  publishable: true,
  // The endpoint labels what its own precision measures. `magnitude` is the
  // live value for the real headline stratum, so the fixture uses it.
  claim_family_resolved: "magnitude",
  claim_family_label:
    "Non-directional: precision is the share of calls where the move exceeded the judge bar. " +
    "It carries no direction — this is not a forecast that price will fall.",
};

const BODY = { headline: HEADLINE, dataAsOf: "2026-08-22T09:00:00.000Z", trackRecord: [] };

const brief = (rec: JudgedRecord | undefined) =>
  buildAgentBriefing("fahali_get_market_verdict", { symbol: "BTCUSDT", matchedTrackRecord: rec }).markdown;

// ── Parsing: the gate between the endpoint and anything we print ─────────────

test("a complete headline becomes a measured record, field for field", () => {
  const r = toJudgedRecord(BODY);
  assert.equal(r.state, "measured");
  if (r.state !== "measured") return;
  assert.equal(r.stratum.engine, "risk_intelligence");
  assert.equal(r.stratum.horizonTier, "48h");
  assert.equal(r.stratum.barRegime, "crypto");
  assert.equal(r.stratum.recallPct, 26.84);
  assert.equal(r.stratum.precisionPct, 71.44);
  assert.equal(r.stratum.baseRatePct, 32.77);
  assert.equal(r.stratum.claimFamily, "magnitude");
  assert.match(r.stratum.claimMeans, /not a forecast/i);
  assert.equal((r.stratum as Record<string, unknown>).liftPp, undefined);
  assert.equal(r.stratum.leadMedianHours, 22.1);
  assert.equal(r.stratum.effectiveSample, 1204);
  assert.equal(r.stratum.warnedEvents, 331);
  assert.equal(r.dataAsOf, "2026-08-22T09:00:00.000Z");
});

/**
 * The single most important test in this file. A headline that has precision
 * but no recall is not a weaker record — it is the FLATTERING one, and it is
 * exactly the shape CLAUDE.md retracted ("right ~72% of the time, and it fires
 * on roughly one in ninety qualifying events"). It must be refused whole.
 */
test("a headline missing recall is refused, and the refusal names recall", () => {
  const { recall_pct, ...noRecall } = HEADLINE;
  const r = toJudgedRecord({ ...BODY, headline: noRecall });
  assert.equal(r.state, "withheld");
  if (r.state !== "withheld") return;
  assert.match(r.reason, /recall/i);
  // And the precision figure must not survive anywhere in what we print.
  assert.doesNotMatch(brief(r), /71\.44/);
});

test("every required field is load-bearing, and each refusal names the field it lost", () => {
  const required: Array<[keyof typeof HEADLINE, RegExp]> = [
    ["engine", /engine/i],
    ["horizon_tier", /horizon tier/i],
    ["bar_regime", /bar regime/i],
    ["recall_pct", /recall/i],
    ["precision_pct", /precision/i],
    ["base_rate_pct", /base rate/i],
    // Still required, still never printed: the gate is defined in terms of it.
    ["lift_pp", /base-rate lift/i],
    ["lead_median_hours", /median lead time/i],
    ["effective_sample", /effective sample/i],
    ["warned_events", /warned events/i],
    // An unlabelled precision reads as a forecast. Refuse rather than default.
    ["claim_family_resolved", /claim family/i],
    ["claim_family_label", /what the claim family measures/i],
  ];
  for (const [field, namesIt] of required) {
    const partial: Record<string, unknown> = { ...HEADLINE };
    delete partial[field];
    const r = toJudgedRecord({ ...BODY, headline: partial });
    assert.equal(r.state, "withheld", `dropping ${field} still produced a record`);
    if (r.state !== "withheld") continue;
    assert.match(r.reason, namesIt, `the refusal for ${field} does not name it`);
  }
});

test("a non-numeric figure is not silently coerced to zero", () => {
  const r = toJudgedRecord({ ...BODY, headline: { ...HEADLINE, recall_pct: null } });
  assert.equal(r.state, "withheld");
});

test("no headline passes the endpoint's OWN reason through, not a reason we invented", () => {
  const r = toJudgedRecord({
    headline: null,
    headlineWithheldReason: "The warning record has not been recomputed recently enough to headline.",
    dataAsOf: "2026-08-22T09:00:00.000Z",
  });
  assert.equal(r.state, "withheld");
  if (r.state !== "withheld") return;
  assert.match(r.reason, /not been recomputed recently enough/);
});

test("an unreadable body is `unavailable`, which is NOT the same state as `withheld`", () => {
  const r = toJudgedRecord(null);
  assert.equal(r.state, "unavailable");
  // Conflating the two would report an outage as an editorial refusal.
  assert.notEqual(r.state, "withheld");
});

// ── Attachment: where it goes, and where it deliberately does not ────────────

test("an error result never carries a record beside it", () => {
  const err = { isError: true, content: [{ type: "text" as const, text: "boom" }] };
  const out = attachJudgedRecord(err, toJudgedRecord(BODY));
  assert.equal((out as any).structuredContent, undefined);
});

test("the lead-time payload is skipped — one stratum must not print as two readings", () => {
  const res = { content: [], structuredContent: { headline: HEADLINE, trackRecord: [] } };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_lead_time");
  assert.equal((out.structuredContent as any).matchedTrackRecord, undefined);
});

test("an unrelated payload gets no generic record and says why", () => {
  const res = { content: [], structuredContent: { symbol: "BTCUSDT", verdict: { direction: "DISTRIBUTION" } } };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_market_verdict");
  const sc = out.structuredContent as any;
  assert.equal(sc.symbol, "BTCUSDT");
  assert.equal(sc.verdict.direction, "DISTRIBUTION");
  assert.equal(sc.matchedTrackRecord, null);
  assert.match(sc.recordMatchReason, /engine/i);
});

test("a multi-view bundle never receives one generic track record", () => {
  const res = {
    content: [],
    structuredContent: {
      status: "ok",
      views: {
        market_decision: { engine: "risk_intelligence", horizon: "48h", assetClass: "crypto" },
        regime: { state: "RISK_OFF" },
      },
    },
  };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_bundle");
  const sc = out.structuredContent as any;
  assert.equal(sc.matchedTrackRecord, null);
  assert.match(sc.recordMatchReason, /multiple claim scopes|No generic record/i);
});

test("a record attaches only when engine, horizon, regime, and family match", () => {
  const res = {
    content: [],
    structuredContent: {
      symbol: "BTCUSDT",
      engine: "risk_intelligence",
      horizon: "48h",
      assetClass: "crypto",
      claim: { family: "magnitude" },
    },
  };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_market_verdict");
  const sc = out.structuredContent as any;
  assert.equal(sc.matchedTrackRecord.state, "measured");
  assert.equal(sc.matchedTrackRecord.stratum.recallPct, 26.84);
  assert.match(sc.recordMatchReason, /matched/i);
});

// ── Rendering: what an agent actually reads ──────────────────────────────────

/**
 * This test asserted `/\+38\.67pp/` — it REQUIRED the lift to be printed —
 * until 2026-08-25. The stratum it renders is `magnitude`, and §2 bans any
 * magnitude lift, so the test was pinning the banned claim in place. Changed
 * deliberately, with the negative assertion moved to its own test below.
 */
test("the measured record prints the stratum, BOTH figures, the family and the date", () => {
  const md = brief(toJudgedRecord(BODY));
  assert.match(md, /## The Judged Record/);
  assert.match(md, /risk_intelligence · 48h · crypto/);
  assert.match(md, /26\.84%/); // recall
  assert.match(md, /71\.44%/); // precision
  assert.match(md, /32\.77%/); // base rate
  assert.match(md, /non-directional/i); // WHAT the precision measures
  assert.match(md, /22\.1h/); // median lead
  assert.match(md, /1,204/); // effective sample, grouped
  assert.match(md, /2026-08-21/); // measured on
  assert.match(md, /ONE stratum/); // the non-transfer warning
});

/**
 * The invariant, asserted STRUCTURALLY rather than on one example: whatever the
 * state, if a precision figure reaches the page then the recall figure is on it
 * too. A future edit that reorders or conditionally drops a line cannot pass.
 */
test("precision NEVER reaches the page without recall, in any state", () => {
  const states: Array<JudgedRecord> = [
    toJudgedRecord(BODY),
    toJudgedRecord({ ...BODY, headline: { ...HEADLINE, recall_pct: undefined } }),
    toJudgedRecord({ headline: null, headlineWithheldReason: "gate refused" }),
    toJudgedRecord(null),
  ];
  for (const s of states) {
    const md = brief(s);
    if (md.includes("71.44")) {
      assert.ok(md.includes("26.84"), `state ${s.state} printed precision without recall`);
    }
  }
});

test("a withheld record occupies the page and forbids the safety reading", () => {
  const md = brief(toJudgedRecord({ headline: null, headlineWithheldReason: "No stratum has cleared the publishability gate yet." }));
  assert.match(md, /## The Judged Record/);
  assert.match(md, /No stratum has cleared the publishability gate yet/);
  assert.match(md, /not measured/i);
  assert.match(md, /never as "no problems found"/i);
});

test("an unavailable record says it is an outage, not a refusal", () => {
  const md = brief(toJudgedRecord(undefined));
  assert.match(md, /## The Judged Record/);
  assert.match(md, /infrastructure failure/i);
  assert.match(md, /NOT a gate refusal/i);
});

test("the section is omitted only when the payload has no record field at all", () => {
  const md = buildAgentBriefing("fahali_get_market_verdict", { symbol: "BTCUSDT" }).markdown;
  assert.doesNotMatch(md, /## The Judged Record/);
});

/**
 * The directive and the payload must agree. The pre-existing wording named
 * `fahali_get_lead_time` as the only admissible source of a record figure —
 * which, once the record ships inline, would forbid quoting the number printed
 * directly above it. A directive that contradicts its own payload trains an
 * agent to disregard the directive.
 */
test("the inline record binds recall to precision without a payload directive", () => {
  const md = brief(toJudgedRecord(BODY));
  assert.match(md, /caught.*26\.84%/i);
  assert.match(md, /71\.44%/);
  assert.match(md, /not a platform-wide figure/i);
  assert.doesNotMatch(md, /SYSTEM DIRECTIVE FOR AGENT/);
});

/**
 * An engine or layer COUNT is never publishable — not the wrong one, not the
 * right one. An engine NAME is fine and is the whole point of a stratum. This
 * guards the rendered section against picking up a count as the copy evolves.
 */
test("the rendered record states an engine name and never an engine count", () => {
  const md = brief(toJudgedRecord(BODY));
  assert.match(md, /risk_intelligence/);
  assert.doesNotMatch(md, /(?<![\d+\-])\b\d{1,2}\b(?![\d+\-])[\s\-]+(?:\w+[\s\-]+){0,3}(?:engines?|layers?)\b/i);
});

// ── The banned claim: a magnitude lift, on BOTH channels ────────────────────

/**
 * 🔴 THE REGRESSION THIS FILE NOW PREVENTS (caught pre-deploy, 2026-08-25).
 *
 * v1.8.0 was one command away from shipping "+38.67pp over that base" into
 * every MCP tool response. The live headline stratum is `magnitude`, and
 * CLAUDE.md §2 lists "any magnitude lift" under Never Sayable while its
 * conditional denominator is unconfirmed.
 *
 * The agent channel is the worst place to publish a banned figure: an agent
 * restates it to a human as Fahali's own number, with our name on it.
 *
 * The record travels on TWO channels and the check must cover both — fixing
 * only the prose is the exact `claimKind`-in-routes.ts-only failure from the
 * same morning, which looked half-applied because the shared picker still
 * populated one field.
 */
test("NO LIFT FIGURE reaches the prose, whatever the endpoint sends", () => {
  const md = brief(toJudgedRecord(BODY));

  // The components stay — they are what fahaliai.com already publishes.
  assert.match(md, /26\.84%/, "recall must survive");
  assert.match(md, /71\.44%/, "precision must survive");
  assert.match(md, /32\.77%/, "the base rate must survive");

  // The subtraction does not.
  assert.doesNotMatch(md, /38\.67/, "the lift VALUE reached the agent channel");
  assert.doesNotMatch(md, /\d+(?:\.\d+)?\s*pp\b/i, "a percentage-point figure reached the agent channel");
  assert.doesNotMatch(md, /\blift\b/i, "the word lift reached the agent channel");
});

test("NO LIFT FIGURE reaches structuredContent — the channel enforcing clients read", () => {
  const r = toJudgedRecord(BODY);
  assert.equal(r.state, "measured");
  if (r.state !== "measured") return;

  const serialised = JSON.stringify(r);
  assert.doesNotMatch(serialised, /38\.67/, "the lift value survived into the structured record");
  assert.doesNotMatch(serialised, /liftPp/, "the lift FIELD survived into the structured record");
});

test("the claim family travels, so a magnitude row cannot read as a forecast", () => {
  const md = brief(toJudgedRecord(BODY));
  assert.match(md, /non-directional/i, "the family label never reached the agent");
  assert.match(md, /not a forecast/i, "the active denial is the load-bearing half");
});

/**
 * Negative control for the sourcing rule. The label is the SERVER's sentence;
 * mcp-server must print what it was handed, not a copy of its own. Feed it a
 * different sentence and that sentence must appear verbatim.
 */
test("the family sentence is SOURCED from the endpoint, never authored here", () => {
  const md = brief(
    toJudgedRecord({
      ...BODY,
      headline: { ...HEADLINE, claim_family_label: "SENTINEL-FROM-ENDPOINT-9f3a." },
    }),
  );
  assert.match(md, /SENTINEL-FROM-ENDPOINT-9f3a\./, "mcp-server substituted its own wording for the endpoint's");
});

/** The top-level `claimKind` envelope is the other channel the API returns it on. */
test("claimKind at the body root is accepted when the row omits the family", () => {
  const { claim_family_resolved, claim_family_label, ...bare } = HEADLINE;
  const r = toJudgedRecord({
    ...BODY,
    headline: bare,
    claimKind: { family: "magnitude", means: "Non-directional: it is not a forecast.", isDirectional: false },
  });
  assert.equal(r.state, "measured", "a family supplied at the root was ignored");
});

// ── The producer name: engine_key vs a display label ─────────────────────────
/**
 * 🔴 `engine_key` — THE FLEET ROSTER KEY — WAS NOT READ (R7, live 2026-08-27).
 *
 * `fahali_get_realtime_alerts` returned rows carrying `engine_key: "momentum"`
 * and `producer_id: "orchestrator:momentum"`. The matcher read `engine`,
 * `engine_name`, `alert_type` and `top_type` — collecting `statistical,
 * momentum_shift, anomaly, volume_spike` — and never `engine_key`.
 *
 * `statistical` and `anomaly` are display labels, not fleet engine keys. The
 * judged record is keyed on fleet keys, so the match could not succeed on ANY
 * realtime response: `matchedTrackRecord` was structurally null on the
 * highest-traffic surface we have, and the reason then named `statistical` as
 * the producer — a confident answer about a producer that does not exist.
 */

test("a canonical engine_key matches the stratum a display label could never reach", () => {
  const res = {
    content: [],
    structuredContent: {
      symbol: "BTCUSDT",
      // What the display layer calls it — not a fleet key, and not in the record.
      engine: "statistical",
      data: [{
        symbol: "BTCUSDT",
        engine_key: "risk_intelligence",
        horizon_tier: "48h",
        asset_class: "crypto",
        claim_family: "magnitude",
      }],
    },
  };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_market_verdict");
  const sc = out.structuredContent as any;
  assert.notEqual(sc.matchedTrackRecord, null, "engine_key names the fleet engine and must be read");
  assert.match(sc.recordMatchReason, /matched/i);
});

test("producer_id contributes its fleet key with the namespace stripped", () => {
  const res = {
    content: [],
    structuredContent: {
      symbol: "BTCUSDT",
      data: [{
        symbol: "BTCUSDT",
        // `orchestrator:momentum` normalises to `orchestrator_momentum`; the
        // fleet key is the segment after the namespace.
        producer_id: "orchestrator:risk_intelligence",
        horizon_tier: "48h",
        asset_class: "crypto",
        claim_family: "magnitude",
      }],
    },
  };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_market_verdict");
  assert.notEqual((out.structuredContent as any).matchedTrackRecord, null);
});

test("on a miss the reason names the CANONICAL key first, never the display label", () => {
  const res = {
    content: [],
    structuredContent: {
      symbol: "ERAUSDC",
      engine: "statistical",
      alert_type: "momentum_shift",
      data: [{ symbol: "ERAUSDC", engine_key: "momentum", producer_id: "orchestrator:momentum" }],
    },
  };
  const out = attachJudgedRecord(res, toJudgedRecord(BODY), "fahali_get_realtime_alerts");
  const reason: string = (out.structuredContent as any).recordMatchReason;
  const momentumAt = reason.indexOf("momentum");
  const statisticalAt = reason.indexOf("statistical");
  assert.ok(momentumAt >= 0, "the reason must name the engine that actually produced the rows");
  assert.ok(
    statisticalAt === -1 || momentumAt < statisticalAt,
    "a display label must never be the first producer an agent is sent to look up",
  );
});
