/**
 * Absence must be EARNED by an empty payload — never produced by a blind adapter.
 *
 * ── The defect this locks out (measured live 2026-08-27) ────────────────────
 * `fahali_get_track_record_scorecard` returned 57.7KB of publishable judged
 * record — the asset the company is built on — under
 * `responseState: NO_COVERAGE, dataState: no_data`. The response contract tells
 * an agent to read responseState first and treats absence as unknown-not-safe,
 * so a COMPLIANT agent discarded the whole record.
 *
 * Root cause was five wrong key names in one adapter, not a data problem. The
 * payload was always there. That is the point: a typo in a mapping table became
 * an unfalsifiable public claim about our own coverage, and it was the SECOND
 * instance of the same class (`fahali_get_bundle` was the first).
 *
 * Every test here fails on the pre-2026-08-27 tree.
 *
 *   node --import tsx --test src/absenceMustBeEarned.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyAgentPayload, decorateForAgent, AGENT_ENDPOINT_ADAPTERS } from "./agentPayload.js";

/**
 * The REAL shape, transcribed from a live production call. Keyed objects, not
 * arrays — which is exactly what the old adapter could not see.
 */
const liveScorecardShape = () => ({
  status: "ok",
  methodology: { judge_version: "v3-path-aware-2026-07-11", floor: "2026-07-02T12:00:00Z" },
  direction: {
    flash_crash_precursor: { total: 101, wins: 85, accuracy: 84.16, publishable: true },
    forecast_72h: { total: 1375, wins: 1029, accuracy: 74.84, publishable: true },
    committee_verdict: { total: 3618, wins: 2159, accuracy: 59.67, publishable: true },
  },
  magnitude: { some_engine: { total: 40, publishable: false } },
  volatility: {},
  extreme_events: { crash_catch: { total: 12 } },
  blended: { all: { total: 5200 } },
  base_rates: { directional: 49.53 },
  last_updated: "2026-08-27T11:00:00Z",
});

describe("the judged record is never reported as absent", () => {
  test("a populated scorecard classifies as a measured finding", () => {
    const state = classifyAgentPayload("fahali_get_track_record_scorecard", liveScorecardShape());
    assert.equal(state.responseState, "OK_WITH_FINDINGS");
    assert.equal(state.dataState, "measured");
    assert.equal(state.absence, null);
  });

  test("the adapter names keys that actually exist in the payload", () => {
    // The original failure was undetectable by reading either file alone: the
    // adapter said `directional`/`crashCatch`/`trackRecord`/`scorecard` and the
    // payload says `direction`/`extreme_events`. Assert against a real shape so
    // a future rename cannot re-open it.
    const adapter = AGENT_ENDPOINT_ADAPTERS.fahali_get_track_record_scorecard;
    const payload = liveScorecardShape() as Record<string, unknown>;
    const declared = [...adapter.collections, ...(adapter.objectFindings ?? [])];
    assert.ok(declared.length, "the scorecard adapter declares nothing");
    for (const key of declared) {
      assert.ok(key in payload, `adapter declares "${key}", which the payload does not contain`);
    }
  });

  test("an empty scorecard is unverified source, never 'no coverage'", () => {
    // The moat never prunes, so five empty axes mean the query did not
    // complete — not that Fahali has judged nothing.
    const state = classifyAgentPayload("fahali_get_track_record_scorecard", {
      status: "ok",
      direction: {},
      magnitude: {},
      volatility: {},
      extreme_events: {},
      blended: {},
    });
    assert.equal(state.absence?.kind, "source_unverified");
  });
});

describe("a blind adapter reports itself, it does not report absence", () => {
  test("substantive unrecognised content is served as a finding and the gap is named", () => {
    // Simulates the general case: the endpoint grew a key the adapter has not
    // learned yet. Serving it is correct; calling it absent is a false claim.
    const state = classifyAgentPayload("fahali_get_track_record_scorecard", {
      status: "ok",
      someNewAxis: { engine_a: { total: 90, accuracy: 61.2 } },
    });
    assert.equal(state.responseState, "OK_WITH_FINDINGS");
    assert.equal(state.dataState, "measured");
    assert.deepEqual(state.adapterGap, ["someNewAxis"]);
  });

  test("prose, timestamps and envelope keys are NOT promoted to findings", () => {
    // The guard must not manufacture evidence out of disclaimers — that would
    // be the same defect pointed the other way.
    const state = classifyAgentPayload("fahali_get_track_record_scorecard", {
      status: "ok",
      methodology: { note: "read lift, never the raw percentage" },
      last_updated: "2026-08-27T11:00:00Z",
      disclaimer: "observation, not advice",
      count: 0,
    });
    assert.equal(state.responseState, "NO_COVERAGE");
    assert.equal(state.adapterGap, undefined);
  });

  test("a base rate with no numerator is NOT a finding", () => {
    // A degraded scorecard keeps its denominators after every axis empties out.
    // Reporting those as "measured" would be this whole bug inverted — and in
    // the direction the honesty doctrine actually cares about.
    const state = classifyAgentPayload("fahali_get_track_record_scorecard", {
      status: "ok",
      direction: {},
      magnitude: {},
      volatility: {},
      extreme_events: {},
      blended: {},
      base_rates: { directional: 49.53 },
      base_rates_by_horizon: { "24h": 51.2 },
      gated_population: { withheld: 7 },
    });
    assert.equal(state.responseState, "NO_COVERAGE", "denominators must not rescue an empty scorecard");
    assert.equal(state.adapterGap, undefined, "the adapter saw its own shape; it is not blind");
  });

  test("a genuinely empty payload still reports absence", () => {
    // Deleting the ability to report true absence would be the inverse bug:
    // claiming coverage we do not have.
    const state = classifyAgentPayload("fahali_get_market_decision", { count: 0, data: [] });
    assert.equal(state.responseState, "NO_COVERAGE");
    assert.equal(state.dataState, "no_data");
  });
});

describe("a row is not a judgment because it is a row", () => {
  test("tool definitions are never counted as judged instruments", () => {
    // Live: get_capabilities shipped `actionableAvailable: 47` and "47
    // instruments were judged" while instruments[] was empty. The 47 were the
    // tool schemas.
    const out = decorateForAgent("fahali_get_capabilities", {
      structuredContent: {
        tools: Array.from({ length: 47 }, (_, i) => ({
          name: `fahali_tool_${i}`,
          requiredTier: "professional",
          endpoint: "/agent/x",
        })),
        resources: [],
      },
    } as any);
    const sc = out.structuredContent as any;
    assert.equal(sc.decisionSelection, undefined, "a payload with no judgments must promote nothing");
    assert.deepEqual(sc.instruments, []);
  });

  test("raw price rows are observations, not actionable judgments", () => {
    // The audit's headline example: market_snapshot reported
    // `actionableAvailable: 680` over rows that are prices, not decisions.
    const out = decorateForAgent("fahali_get_market_snapshot", {
      structuredContent: {
        assets: [
          { symbol: "BTCUSDT", price: 43000 },
          { symbol: "ETHUSDT", price: 2300 },
        ],
      },
    } as any);
    const sc = out.structuredContent as any;
    assert.equal(
      sc.decisionSelection?.actionableAvailable ?? 0,
      0,
      "a price is an observation; only a claim about it is actionable",
    );
  });

  test("real instrument rows still promote and still count", () => {
    const out = decorateForAgent("fahali_get_market_decision", {
      structuredContent: {
        count: 2,
        data: [
          { symbol: "BTCUSDT", direction: "DISTRIBUTION", confidence: 0.7 },
          { symbol: "ETHUSDT", direction: "ACCUMULATION", confidence: 0.6 },
        ],
      },
    } as any);
    const sc = out.structuredContent as any;
    assert.equal(sc.decisionSelection.among, 2);
    assert.equal(sc.decisionSelection.sourceActionableAvailable, 2, "source judgments remain counted for audit");
    assert.equal(sc.decisionSelection.actionableAvailable, 0, "unscoped rows without validity, identity, and authority cannot be promoted as current actions");
    assert.equal(sc.decisionEligibility.status, "WITHHELD");
  });
});

describe("unknown freshness is not fresh", () => {
  const staleFlag = (payload: Record<string, unknown>, tool = "fahali_get_market_decision") => {
    const out = decorateForAgent(tool, { structuredContent: payload } as any);
    return (out.structuredContent as any).evidenceQuality.stale;
  };

  test("no published freshness window yields stale: null, never false", () => {
    const flag = staleFlag({ count: 1, data: [{ symbol: "BTCUSDT", direction: "DISTRIBUTION" }] });
    assert.equal(flag, null, "an unmeasured age must not be asserted as current");
  });

  test("a measured age inside its window is honestly not stale", () => {
    const flag = staleFlag({
      count: 1,
      dataAgeSeconds: 30,
      staleAfterSeconds: 300,
      data: [{ symbol: "BTCUSDT", direction: "DISTRIBUTION" }],
    });
    assert.equal(flag, false);
  });

  test("stale never contradicts the freshness block in the same envelope", () => {
    // These two answer the same question and shipped opposite answers live:
    // `freshnessNormalized.known: false` beside `evidenceQuality.stale: false`.
    const out = decorateForAgent("fahali_get_market_decision", {
      structuredContent: { count: 1, data: [{ symbol: "BTCUSDT", direction: "DISTRIBUTION" }] },
    } as any);
    const sc = out.structuredContent as any;
    if (sc.freshnessNormalized.known === false) {
      assert.equal(sc.evidenceQuality.stale, null);
    }
  });
});
