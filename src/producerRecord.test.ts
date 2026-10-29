/**
 * The producer record, and the figure-redaction that guards it.
 *
 * The honesty-critical assertion in this file is that NO NUMBER from a withheld
 * stratum survives into the agent channel. Twice in 48h this codebase has
 * republished a retracted figure inside prose that was explaining the
 * retraction, so the test is written as a property ("no digits survive"), not
 * as a list of the strings we happen to have seen.
 *
 *   node --import tsx --test mcp-server/src/producerRecord.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { attachJudgedRecord } from "./judgedRecord.js";
import {
  VERDICT_PRODUCERS,
  buildInstrumentClassCoverage,
  buildProducerCandidateIndex,
  buildProducerIndex,
  producerRecordCandidatesFor,
  producerRecordFor,
  stripFigures,
} from "./producerRecord.js";

/** Reasons taken verbatim from the live endpoint, 2026-08-27. */
const LIVE_REASONS = [
  "precision does not beat its own base rate (46.3 vs 54.06)",
  "lift is not distinguishable from zero (+0.48pp, Wilson95 floor -1.53pp, n_eff=2080)",
  "no lead time (warned_events=0)",
  "effective sample below floor (n_eff=12, floor=30)",
  "the warning measurement has not moved since 2026-08-23: 5 consecutive daily snapshots",
  "no non-directional resolved equity rows for canonical_verdict",
];

test("producer roles reserve binding direction for the current canonical arbiter", () => {
  assert.match(VERDICT_PRODUCERS.canonical_verdict, /sole binding market-direction authority/i);
  assert.match(VERDICT_PRODUCERS.agent_verdict, /non-binding evidence.*never a direction authority/i);
  assert.match(VERDICT_PRODUCERS.committee_verdict, /non-binding evidence.*never a direction authority/i);
});

/**
 * Strip the identifiers we deliberately preserve, then assert nothing numeric
 * is left. "No digit at all" was the original rule and it was WRONG: it ate
 * `v1-identification-2026-08-23`, destroying the name of the judge rule while
 * protecting nothing — a version is not a performance figure. Caught in
 * production output, not by this suite.
 */
function performanceFiguresIn(text: string): string {
  return text
    .replace(/\bv\d+(?:[-.][A-Za-z]+)*(?:-\d{4}-\d{2}-\d{2})?\b/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
}

test("no performance figure from any live withheld reason survives redaction", () => {
  for (const reason of LIVE_REASONS) {
    const out = stripFigures(reason);
    assert.doesNotMatch(
      performanceFiguresIn(out), /\d/,
      `a figure survived redaction of: ${reason}\n  -> ${out}`,
    );
  }
});

test("a judge version and a measurement date survive — they name the rule", () => {
  const out = stripFigures(
    "correlation makes an identification claim, not a forecast - judged by v1-identification-2026-08-23 on whether the asserted state was present",
  );
  assert.match(out, /v1-identification-2026-08-23/, "the judge version must survive");
  assert.doesNotMatch(out, /\[withheld\]-identification/, "the version must not be mangled");
});

test("redaction never runs two words together", () => {
  // The production symptom: "...[withheld][withheld][withheld]on whether..."
  for (const reason of [
    ...LIVE_REASONS,
    "judged by v1-identification-2026-08-23 on whether the asserted state was present",
    "effective sample below floor (n_eff=12, floor=30) on this stratum",
  ]) {
    const out = stripFigures(reason);
    assert.doesNotMatch(out, /\]\w/, `a redaction swallowed a space: ${out}`);
    assert.doesNotMatch(out, /\]\[withheld\]\[withheld\]/, `runaway redaction: ${out}`);
  }
});

test("redaction keeps the qualitative claim — the damning half", () => {
  assert.match(stripFigures(LIVE_REASONS[0]), /precision does not beat its own base rate/);
  assert.match(stripFigures(LIVE_REASONS[1]), /lift is not distinguishable from zero/);
  assert.match(stripFigures(LIVE_REASONS[2]), /no lead time/);
  assert.match(stripFigures(LIVE_REASONS[5]), /no non-directional resolved equity rows/);
});

test("a published engine reports precision WITH recall, and its stratum", () => {
  const index = buildProducerIndex({
    trackRecord: [{
      engine: "forecast_72h", horizon_tier: "72h", bar_regime: "crypto",
      precision_pct: 75.64, recall_pct: 4.11, base_rate_pct: 54.06,
      effective_sample: 1283, publishable: true, day: "2026-08-27T00:00:00.000Z",
    }],
  });
  const rec = producerRecordFor(index, "forecast_72h");
  assert.equal(rec.state, "published");
  if (rec.state !== "published") return;
  assert.equal(rec.recallPct, 4.11, "recall must travel with precision, always");
  assert.equal(rec.barRegime, "crypto");
  assert.match(rec.note, /recall/i);
});

test("all published producer strata survive the compatibility index boundary", () => {
  const rows = [
    {
      engine: "canonical_verdict", horizon_tier: "72h", bar_regime: "crypto",
      claim_family_resolved: "directional", identity_population: "verified_only", precision_pct: 61, recall_pct: 12,
      base_rate_pct: 49, effective_sample: 310, publishable: true, day: "2026-08-30",
    },
    {
      engine: "canonical_verdict", horizon_tier: "12h", bar_regime: "crypto",
      claim_family_resolved: "directional", identity_population: "verified_only", precision_pct: 64, recall_pct: 15,
      base_rate_pct: 49, effective_sample: 420, publishable: true, day: "2026-08-31",
    },
    {
      engine: "canonical_verdict", horizon_tier: "12h", bar_regime: "equity",
      claim_family_resolved: "directional", identity_population: "verified_only", precision_pct: 60, recall_pct: 11,
      base_rate_pct: 49, effective_sample: 210, publishable: true, day: "2026-08-31",
    },
  ];
  for (const trackRecord of [rows, [...rows].reverse()]) {
    const candidates = producerRecordCandidatesFor(
      buildProducerCandidateIndex({ trackRecord }),
      "canonical_verdict",
    );
    assert.equal(candidates.length, 3);
    assert.ok(candidates.every((record: any) => record.identityPopulation === "verified_only"));
    assert.deepEqual(
      candidates.map((record: any) => [record.horizonTier, record.barRegime, record.claimFamily]),
      [
        ["12h", "crypto", "directional"],
        ["12h", "equity", "directional"],
        ["72h", "crypto", "directional"],
      ],
      "candidate order must be deterministic rather than source-order dependent",
    );
  }
});

test("withheld strata remain candidates even when another stratum for the engine is published", () => {
  const candidates = producerRecordCandidatesFor(buildProducerCandidateIndex({
    identity_population: "verified_only",
    trackRecord: [{
      engine: "canonical_verdict", horizon_tier: "72h", bar_regime: "crypto",
      claim_family_resolved: "directional", identity_population: "verified_only", precision_pct: 61, recall_pct: 12,
      base_rate_pct: 49, effective_sample: 310, publishable: true, day: "2026-08-30",
    }],
    withheld: { strata: [{
      stratum: "canonical_verdict · 12h · crypto · directional",
      effectiveSample: 300,
      reason: LIVE_REASONS[0],
    }] },
  }), "canonical_verdict");
  assert.equal(candidates.length, 2);
  const withheld = candidates.find((record) => record.state === "withheld");
  assert.ok(withheld);
  assert.equal((withheld as any).horizonTier, "12h");
  assert.equal((withheld as any).barRegime, "crypto");
  assert.equal((withheld as any).claimFamily, "directional");
  assert.equal((withheld as any).identityPopulation, "verified_only");
  assert.doesNotMatch(JSON.stringify(withheld), /46\.3|54\.06/);
});

test("withheld candidates inherit the explicitly verified-only VLT envelope", () => {
  const candidates = producerRecordCandidatesFor(buildProducerCandidateIndex({
    identity_population: "verified_only",
    withheld: { strata: [{
      stratum: "canonical_verdict · 12h · crypto · directional",
      effectiveSample: 300,
      reason: LIVE_REASONS[0],
    }] },
  }), "canonical_verdict");
  assert.equal(candidates.length, 1);
  const [record] = candidates;
  assert.equal(record.state, "withheld");
  assert.equal((record as any).identityPopulation, "verified_only");
  assert.doesNotMatch(JSON.stringify(record), /46\.3|54\.06/);
});

test("a published row missing recall is unavailable rather than called unregistered", () => {
  // Precision alone is the flattering half. A row we cannot state completely
  // is not downgraded to a partial record — it is not offered.
  const index = buildProducerIndex({
    trackRecord: [{
      engine: "forecast_72h", horizon_tier: "72h", bar_regime: "crypto",
      precision_pct: 75.64, base_rate_pct: 54.06, effective_sample: 1283, publishable: true,
    }],
  });
  assert.equal(producerRecordFor(index, "forecast_72h").state, "unavailable");
});

test("a withheld engine reports MEASURED-and-withheld, not absent", () => {
  const index = buildProducerIndex({
    withheld: { strata: [
      { stratum: "canonical_verdict · 72h · crypto", effectiveSample: 3490, reason: LIVE_REASONS[0] },
    ] },
  });
  const rec = producerRecordFor(index, "canonical_verdict");
  assert.equal(rec.state, "withheld");
  if (rec.state !== "withheld") return;
  assert.equal(rec.quotable, false);
  assert.doesNotMatch(rec.reasons.join(" "), /\d/, "a withheld record must carry no figures");
  assert.match(rec.note, /did not clear the publishability gate/);
  assert.match(rec.note, /not an absence of evidence/);
});

test("an absent candidate is unavailable unless a producer census proves zero registrations", () => {
  const index = buildProducerIndex({ withheld: { strata: [
    { stratum: "canonical_verdict · 72h · crypto", reason: LIVE_REASONS[0] },
  ] } });
  const withheld = producerRecordFor(index, "canonical_verdict");
  const missing = producerRecordFor(index, "agent_verdict");
  assert.equal(withheld.state, "withheld");
  assert.equal(missing.state, "unavailable");
  // The distinction is the whole point: one has a record that failed, while
  // an empty projection cannot prove the other producer never registered.
  assert.notEqual(withheld.note, missing.note);
  assert.match(missing.note, /does not prove the producer never registered/);
  assert.match(missing.note, /no producer-specific registration census/);
  assert.match(missing.note, /Only canonical_verdict may supply the binding market direction/);
});

test("a publishable engine is never also listed as withheld", () => {
  const index = buildProducerIndex({
    trackRecord: [{
      engine: "forecast_72h", horizon_tier: "72h", bar_regime: "crypto",
      precision_pct: 75.64, recall_pct: 4.11, base_rate_pct: 54.06,
      effective_sample: 1283, publishable: true,
    }],
    withheld: { strata: [{ stratum: "forecast_72h · 24h · equity", reason: LIVE_REASONS[2] }] },
  });
  assert.equal(producerRecordFor(index, "forecast_72h").state, "published");
});

test("a withheld stratum is never promoted into a published record", () => {
  // Re-deriving a refused number is the move that produced the retracted
  // magnitude lift. There is no path from `withheld` to `published` here.
  const index = buildProducerIndex({
    withheld: { strata: [{
      stratum: "correlation · 24h · equity", effectiveSample: 2080, reason: LIVE_REASONS[1],
    }] },
  });
  const rec = producerRecordFor(index, "correlation");
  assert.equal(rec.state, "withheld");
  assert.ok(!("precisionPct" in rec), "a withheld record must not carry a precision field at all");
});

test("an unreadable record says unknown-is-not-a-pass", () => {
  const rec = producerRecordFor(null, "canonical_verdict");
  assert.equal(rec.state, "unavailable");
  assert.match(rec.note, /Unknown is not a pass/);
});

test("engine parsing survives a mojibake'd stratum separator", () => {
  // The middot arrives mangled over the wire in production. Parsing must not
  // depend on a literal character that transport can corrupt.
  for (const sep of ["·", "Â·", "-", " "]) {
    const index = buildProducerIndex({
      withheld: { strata: [{ stratum: `leverage ${sep} 24h ${sep} equity`, reason: LIVE_REASONS[2] }] },
    });
    assert.equal(producerRecordFor(index, "leverage").state, "withheld", `separator ${JSON.stringify(sep)}`);
  }
});

test("equity coverage separates measured-and-withheld from nothing-to-measure", () => {
  // The distinction M3 turned on. Shape taken from the live endpoint, where
  // equity holds 9 strata with real samples and 58 with none.
  const classes = buildInstrumentClassCoverage({
    trackRecord: [{
      engine: "forecast_72h", horizon_tier: "72h", bar_regime: "crypto",
      precision_pct: 75.64, recall_pct: 4.11, base_rate_pct: 54.06,
      effective_sample: 1283, publishable: true,
    }],
    withheld: { strata: [
      { stratum: "correlation - 24h - equity", effectiveSample: 2080,
        reason: "lift is not distinguishable from zero (+0.48pp, Wilson95 floor -1.53pp, n_eff=2080)" },
      { stratum: "risk_intelligence - 48h - equity", effectiveSample: 1055,
        reason: "precision does not beat its own base rate (82.75 vs 83.31)" },
      { stratum: "anomaly - 2h - equity", effectiveSample: 0,
        reason: "no non-directional resolved equity rows for anomaly" },
    ] },
  });
  const equity = classes.find((c) => c.instrumentClass === "equity")!;
  assert.equal(equity.publishedStrata, 0);
  assert.equal(equity.measuredButWithheld, 2, "two equity strata carry a real sample");
  assert.equal(equity.noResolvedRows, 1, "one had nothing to measure — a different fact");
  const crypto = classes.find((c) => c.instrumentClass === "crypto")!;
  assert.equal(crypto.publishedStrata, 1);
});

test("no figure reaches the coverage summary either", () => {
  const classes = buildInstrumentClassCoverage({
    withheld: { strata: [
      { stratum: "correlation - 24h - equity", effectiveSample: 2080,
        reason: "lift is not distinguishable from zero (+0.48pp, Wilson95 floor -1.53pp, n_eff=2080)" },
    ] },
  });
  const shipped = JSON.stringify(classes.find((c) => c.instrumentClass === "equity")!.withheldExamples);
  assert.doesNotMatch(shipped, /\d/, `a figure reached the coverage summary: ${shipped}`);
});

test("a response that names its producer is never reported as anonymous", () => {
  // The contradiction this guards: /agent/verdict names the producer on every
  // row, while recordMatchReason two keys away said "does not name the engine
  // that produced it". Two blocks in one envelope describing one call must not
  // disagree — the same invariant already asserted for symbolCoverage vs scope.
  //
  // Behavioural on purpose. The first version of this test read judgedRecord.ts
  // off `process.cwd()` and passed from mcp-server/ while failing from the repo
  // root: a source-grep tests where a word lives, and where the runner started.
  const record = {
    state: "measured" as const,
    dataAsOf: "2026-08-27T00:00:00.000Z",
    stratum: {
      engine: "forecast_72h", horizonTier: "72h", barRegime: "crypto",
      recallPct: 4.11, precisionPct: 75.64, baseRatePct: 54.06,
      leadMedianHours: 51.21, effectiveSample: 1283, warnedEvents: 55,
      measuredOn: "2026-08-27", claimFamily: "magnitude",
      claimMeans: "a move exceeded the judge bar",
    },
  };
  const named = attachJudgedRecord(
    { structuredContent: { data: [{ provenance: { directionProducer: "canonical_verdict" } }] } } as any,
    record,
    "fahali_get_market_verdict",
  );
  const reason = String((named.structuredContent as any).recordMatchReason);
  assert.doesNotMatch(reason, /does not name the engine/,
    "the payload named canonical_verdict; the reason must not call it anonymous");
  assert.match(reason, /canonical_verdict/, "the reason must name the producer it found");
  assert.match(reason, /producerRecord/, "and must point at where that producer's own record lives");

  // The anonymous branch must still work for a payload that really names nothing.
  const anon = attachJudgedRecord(
    { structuredContent: { data: [{ verdict: { direction: "bearish" } }] } } as any,
    record,
    "fahali_get_market_verdict",
  );
  assert.match(String((anon.structuredContent as any).recordMatchReason), /does not name the engine/);
});

test("REGRESSION: `engineNames` counts as naming the engine (contagion, 2026-08-29)", () => {
  // fahali_get_contagion_map publishes provenance.engineNames:
  // ["tail_dependence"] and provenance.source: "tail_dependence", and the
  // reason still read "This response does not name the engine that produced
  // it" — the same self-contradiction the test above pins, surviving one field
  // name later because `engines` was in the lookup set and `engineNames`
  // (normalising to `enginenames`) was not.
  const record = {
    state: "measured" as const,
    dataAsOf: "2026-08-29T00:00:00.000Z",
    stratum: {
      engine: "forecast_72h", horizonTier: "72h", barRegime: "crypto",
      recallPct: 4.11, precisionPct: 75.64, baseRatePct: 54.06,
      leadMedianHours: 51.21, effectiveSample: 1283, warnedEvents: 55,
      measuredOn: "2026-08-29", claimFamily: "magnitude",
      claimMeans: "a move exceeded the judge bar",
    },
  };
  const named = attachJudgedRecord(
    {
      structuredContent: {
        provenance: { source: "tail_dependence", engineNames: ["tail_dependence"] },
        edges: [{ source: "BTCUSDT", target: "AAVEUSDT" }],
      },
    } as any,
    record,
    "fahali_get_contagion_map",
  );
  const reason = String((named.structuredContent as any).recordMatchReason);
  assert.doesNotMatch(reason, /does not name the engine/,
    "provenance.engineNames named the producer two keys away");
  assert.match(reason, /tail_dependence/, "the reason must name the engine it actually found");

  // It must still refuse to attach the headline figure — naming the producer
  // is not the same as matching the stratum, and tail_dependence is not it.
  assert.equal((named.structuredContent as any).matchedTrackRecord, null);
});

// ── 2026-10-20: the withheld family was read from a label part that does not exist ──

const LIVE_WITHHELD_SHAPE = {
  identity_population: "verified_only",
  trackRecord: [],
  withheld: {
    strata: [
      // Exact shape served by /api/track-record/lead-time on 2026-10-20:
      // a three-part label, the family as its own field, a measured grade.
      {
        stratum: "canonical_verdict · 72h · crypto",
        effectiveSample: 8670,
        identityPopulation: "verified_only",
        claim_family: "directional",
        reason: "precision does not beat its own base rate (54.35 vs 56.73)",
        verdict: { grade: "worse_than_chance", label: "Worse than chance" },
      },
      {
        stratum: "canonical_verdict · 72h · crypto",
        effectiveSample: 0,
        identityPopulation: "verified_only",
        claim_family: null,
        reason: "no measurable crypto evidence for canonical_verdict",
        verdict: { grade: "not_measured", label: "Not measured" },
      },
    ],
  },
};

test("🔴 a withheld stratum keeps the claim family the envelope published", () => {
  const rows = buildProducerCandidateIndex(LIVE_WITHHELD_SHAPE).get("canonical_verdict") ?? [];
  const directional = rows.filter((r: any) => r.claimFamily === "directional");
  assert.equal(directional.length, 1, "the measured directional stratum is its own candidate");
  assert.equal((directional[0] as any).grade, "worse_than_chance");
  assert.equal((directional[0] as any).gradeLabel, "Worse than chance");
  // The not-measured row must NOT be folded into the measured one.
  const unlabelled = rows.filter((r: any) => r.claimFamily == null);
  assert.equal(unlabelled.length, 1);
  assert.equal((unlabelled[0] as any).grade, "not_measured");
  // The grade travels; the figures still do not.
  for (const r of rows) for (const reason of (r as any).reasons) assert.doesNotMatch(reason, /\d/);
});

test("negative control: a withheld stratum with no claim_family field stays null (never derived)", () => {
  const body = structuredClone(LIVE_WITHHELD_SHAPE);
  delete (body.withheld.strata[0] as any).claim_family;
  const rows = buildProducerCandidateIndex(body).get("canonical_verdict") ?? [];
  assert.ok(rows.every((r: any) => r.claimFamily == null));
});
