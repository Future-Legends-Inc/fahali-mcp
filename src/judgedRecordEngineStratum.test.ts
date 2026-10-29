import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { attachJudgedRecord } from "./judgedRecord.js";

// Board record blocks produced by the api reader from the lead-time fixture.
// Pinned equal to readEngineBoard there. Checked in local fixtures first,
// with monorepo fallback.
const fixtureUrl = existsSync(new URL("./fixtures/engineBoardRecord.engineOne.json", import.meta.url))
  ? new URL("./fixtures/engineBoardRecord.engineOne.json", import.meta.url)
  : new URL("../../server/tests/fixtures/engineBoardRecord.engineOne.json", import.meta.url);
const REC: any = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const derivedBlock = (path: string) => {
  const decl = (REC._provenance?.derived_rows ?? []).find((d: any) => d.path === path);
  if (!decl) throw new Error(`engineBoardRecord fixture: ${path} is not declared under _provenance.derived_rows`);
  return REC[path];
};
const WH_ROW = REC.withheldOnly.strata.value[0];
const PUB_ROW = derivedBlock("publishable").strata.value.find((r: any) => r.publishable === true);

const headline: any = { state: "measured", dataAsOf: "x", stratum: { engine: "early_warning_6h", horizonTier: "8h", barRegime: "crypto", recallPct: 23, precisionPct: 8.4, baseRatePct: 5, leadMedianHours: 3.9, effectiveSample: 20000, warnedEvents: 400, measuredOn: "d", claimFamily: "event_detection", claimMeans: "m" } };
const result = (data: any) => ({ content: [], structuredContent: data } as any);

test("engine tools attach the engine's OWN stratum from the payload, never the headline", () => {
  const payload = { engine: "fall_warning_8h", record: { strata: { value: [{ engine: "fall_warning_8h", horizon_tier: "8h", bar_regime: "crypto", claim_family: "event_detection", precision_pct: 9.1, base_rate_pct: 5, recall_pct: 20, lead_median_hours: 4.1, effective_sample: 400, warned_events: 80, publishable: true, day: "2026-10-12" }] }, grade: { value: { grade: "beats_chance" } } } };
  const out = attachJudgedRecord(result(payload), headline, "fahali_get_fall_warnings") as any;
  assert.equal(out.structuredContent.matchedTrackRecord.stratum.engine, "fall_warning_8h");
  assert.equal(out.structuredContent.matchedTrackRecord.stratum.precisionPct, 9.1);
  assert.equal(out.structuredContent.recordMatchReason, "engine_own_stratum");
});

test("no judged rows yet is a reason, not the headline and not silence", () => {
  const payload = { engine: "fall_warning_8h", record: { strata: { value: null, reason: "no_judged_rows_yet" }, grade: { value: null, reason: "no_judged_rows_yet" } } };
  const out = attachJudgedRecord(result(payload), headline, "fahali_get_engine_board") as any;
  assert.equal(out.structuredContent.matchedTrackRecord, null);
  assert.equal(out.structuredContent.recordMatchReason, "no_judged_rows_yet");
});

test("a withheld-only board (captured shape) attaches state withheld with the real reason, never [object Object]", () => {
  const payload = { engine: "fall_warning_8h", record: REC.withheldOnly };
  for (const tool of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    const out = attachJudgedRecord(result(payload), headline, tool) as any;
    assert.equal(out.structuredContent.matchedTrackRecord.state, "withheld");
    assert.equal(out.structuredContent.matchedTrackRecord.reason, WH_ROW.withheld_reason);
    assert.equal(out.structuredContent.matchedTrackRecord.dataAsOf, WH_ROW.day);
    assert.equal(out.structuredContent.recordMatchReason, "engine_own_stratum_withheld");
    assert.ok(!JSON.stringify(out).includes("[object Object]"));
  }
});

test("a withheld row with no withheld_reason takes verdict.reason; a non-string reason becomes withheld", () => {
  const { withheld_reason, ...noReason } = WH_ROW;
  const a = attachJudgedRecord(result({ record: { strata: { value: [noReason] } } }), headline, "fahali_get_engine_board") as any;
  assert.equal(a.structuredContent.matchedTrackRecord.reason, WH_ROW.verdict.reason);
  const b = attachJudgedRecord(result({ record: { strata: { value: [{ ...noReason, verdict: { grade: "not_measured", reason: { nested: true } } }] } } }), headline, "fahali_get_engine_board") as any;
  assert.equal(b.structuredContent.matchedTrackRecord.reason, "withheld");
  assert.ok(!JSON.stringify(b).includes("[object Object]"));
});

test("a publishable row's verdict object reaches the envelope as grade and reason strings", () => {
  const out = attachJudgedRecord(result({ record: derivedBlock("publishable") }), headline, "fahali_get_fall_warnings") as any;
  const st = out.structuredContent.matchedTrackRecord.stratum;
  assert.equal(out.structuredContent.matchedTrackRecord.state, "measured");
  assert.equal(out.structuredContent.recordMatchReason, "engine_own_stratum");
  assert.equal(st.grade, PUB_ROW.verdict.grade);
  assert.equal(st.gradeReason, PUB_ROW.verdict.reason);
  assert.equal(typeof st.grade, "string"); assert.equal(typeof st.gradeReason, "string");
  assert.equal(st.claimFamily, PUB_ROW.claim_family);
  assert.equal(out.structuredContent.ownStrataCount, derivedBlock("publishable").strata.value.length);
  assert.ok(!JSON.stringify(out).includes("[object Object]"));
});

const row = (over: any) => ({ engine: "fall_warning_8h", horizon_tier: "8h", bar_regime: "crypto", claim_family: "event_detection", precision_pct: 9, base_rate_pct: 5, recall_pct: 20, lead_median_hours: 4, effective_sample: 400, warned_events: 80, publishable: true, day: "2026-10-12", ...over });
const wrap = (rows: any[]) => ({ engine: "fall_warning_8h", record: { strata: { value: rows }, grade: { value: null, reason: "x" } } });

test("two publishable rows listed 24h-then-8h attach the 8h row, order-independent", () => {
  const a = attachJudgedRecord(result(wrap([row({ horizon_tier: "24h", precision_pct: 11 }), row({ horizon_tier: "8h", precision_pct: 9 })])), headline, "fahali_get_fall_warnings") as any;
  const b = attachJudgedRecord(result(wrap([row({ horizon_tier: "8h", precision_pct: 9 }), row({ horizon_tier: "24h", precision_pct: 11 })])), headline, "fahali_get_fall_warnings") as any;
  assert.equal(a.structuredContent.matchedTrackRecord.stratum.horizonTier, "8h");
  assert.equal(b.structuredContent.matchedTrackRecord.stratum.horizonTier, "8h");
  assert.equal(a.structuredContent.ownStrataCount, 2);
});

test("a withheld 8h beside a publishable 24h attaches the publishable 24h", () => {
  const out = attachJudgedRecord(result(wrap([{ ...WH_ROW }, row({ horizon_tier: "24h" })])), headline, "fahali_get_engine_board") as any;
  assert.equal(out.structuredContent.matchedTrackRecord.state, "measured");
  assert.equal(out.structuredContent.matchedTrackRecord.stratum.horizonTier, "24h");
  assert.equal(out.structuredContent.ownStrataCount, 2);
});

test("rows with no boolean publishable flag are strata_unreadable, never no_judged_rows_yet", () => {
  const { publishable, ...noFlag } = row({});
  const out = attachJudgedRecord(result(wrap([noFlag])), headline, "fahali_get_fall_warnings") as any;
  assert.equal(out.structuredContent.matchedTrackRecord, null);
  assert.equal(out.structuredContent.recordMatchReason, "strata_unreadable");
  const mal = attachJudgedRecord(result(wrap([row({ publishable: "yes" })])), headline, "fahali_get_fall_warnings") as any;
  assert.equal(mal.structuredContent.recordMatchReason, "strata_unreadable");
});

test("a missing or non-finite numeric attaches as null, not NaN or 0", () => {
  const { lead_median_hours, ...rest } = row({ recall_pct: "abc" });
  const out = attachJudgedRecord(result(wrap([rest])), headline, "fahali_get_fall_warnings") as any;
  assert.equal(out.structuredContent.matchedTrackRecord.stratum.leadMedianHours, null);
  assert.equal(out.structuredContent.matchedTrackRecord.stratum.recallPct, null);
  assert.equal(out.structuredContent.matchedTrackRecord.stratum.precisionPct, 9);
});
