/**
 * The envelope must read the freshness the PRODUCER actually published.
 *
 * ── The defect, measured in production 2026-09-04 ───────────────────────────
 * `fahali_get_correlation_matrix` returned THREE freshness blocks:
 *
 *   basis.computationFreshness  { state: "fresh", ageMs: 1506240,  maxAgeMs: 7200000  }
 *   basis.sourceFreshness       { state: "stale", ageMs: 23520971, maxAgeMs: 14400000 }
 *   basis.freshness             { state: "stale", staleReasons: ["source"] }
 *
 * and the envelope above them said:
 *
 *   freshnessNormalized: { known: false, contributingSources: 0,
 *     reason: "No source in this response published a freshness window,
 *              so the reading's age is unknown — not fresh." }
 *
 * Every producer had answered. The envelope reported ignorance — the same shape
 * as the R4 bundle defect `normalizedFreshness` was written to fix, surviving
 * in the one dimension that fix did not cover: not WHERE the reader looked, but
 * WHICH SPELLINGS it recognised. It knew `dataAgeSeconds`/`staleAfterSeconds`
 * while the server emits `ageMs`/`maxAgeMs` (covarianceArtifact),
 * `maxStalenessMs` (engineIntelligenceSnapshot) and `ageMinutes` (capitalFlow,
 * microstructureProxy, symbolJudgment, oracle) across 129 sites.
 *
 * ── The trap this file mainly exists to hold shut ───────────────────────────
 * The obvious fix — recognise every key that looks like an age — is a NEW
 * defect, and a worse one. `normalizedFreshness` takes the OLDEST age and the
 * TIGHTEST bar found anywhere in the payload. Rows in this product are often
 * old ON PURPOSE: a case study, a resolved outcome from the moat, a 90-day
 * precedent. Read a row's bare `ageMinutes` and that intentional age pairs with
 * some unrelated view's 10-minute bar, and a correct response reports itself
 * stale. **The age of an archived record is not the staleness of a reading.**
 *
 * So the producer's spellings are honoured only from a block that DECLARES
 * itself freshness. The negative controls below are the whole point of the
 * file: they fail if that restriction is dropped.
 *
 *   node --import tsx --test mcp-server/src/freshnessVocabulary.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

const wrap = (payload: Record<string, unknown>) =>
  decorateForAgent("fahali_get_correlation_matrix", {
    structuredContent: payload,
    content: [{ type: "text", text: "{}" }],
  } as any) as any;

const freshnessOf = (payload: Record<string, unknown>) =>
  wrap(payload).structuredContent.freshnessNormalized as Record<string, unknown>;

/** The exact `basis` block production returned on 2026-09-04T17:32Z. */
const LIVE_COVARIANCE_BASIS = {
  scope: "cross_asset",
  horizonDays: 45,
  computedAt: "2026-09-04T17:06:54.731Z",
  windowEnd: "2026-09-04T11:00:00.000Z",
  artifactMeasuredPairs: 11175,
  computationFreshness: { state: "fresh", ageMs: 1506240, maxAgeMs: 7200000 },
  sourceFreshness: {
    state: "stale",
    ageMs: 23520971,
    maxAgeMs: 14400000,
    asOf: "2026-09-04T11:00:00.000Z",
    policy: "4h aggregate ceiling because cross-asset artifacts require always-open crypto anchors",
  },
  freshness: { state: "stale", staleReasons: ["source"] },
};

test("the live covariance payload reports its age instead of claiming ignorance", () => {
  const f = freshnessOf({ symbols: ["BTCUSDT"], basis: LIVE_COVARIANCE_BASIS });

  assert.equal(f.known, true, "three published freshness blocks cannot read as 'no source published one'");
  assert.equal(f.contributingSources, 2, "both blocks carrying an age/bar pair must count");
  // 23520971ms = 6h32m. The OLDEST contributing reading, not the freshest.
  assert.equal(f.dataAgeSeconds, 23521);
  // 7200s = the TIGHTEST bar (computation's 2h), not the source's looser 4h.
  assert.equal(f.staleAfterSeconds, 7200);
  assert.equal(f.stale, true, "6h32m against a 2h bar is stale, and must say so");
  assert.equal(f.sourceUnit, "milliseconds", "report the spelling the producer chose");
});

test("NEGATIVE CONTROL — a row's own age must never become the response's staleness", () => {
  // Case studies are old BY DESIGN. If the reader accepts a bare `ageMinutes`
  // on a row, this 90-day case pairs with the 10-minute bar below and a
  // perfectly current response declares itself stale.
  const f = freshnessOf({
    cases: [
      { symbol: "BTCUSDT", ageMinutes: 129_600, profitPct: 4.2 },
      { symbol: "ETHUSDT", ageMinutes: 86_400, profitPct: -1.1 },
    ],
    outcomes: [{ symbol: "SOLUSDT", age_minutes: 64_800 }],
    dataFreshness: { ageMs: 60_000, maxAgeMs: 600_000 },
  });

  assert.equal(f.known, true, "the declared block still answers");
  assert.equal(f.contributingSources, 1, "only the declared block counts — the three rows must not");
  assert.equal(f.dataAgeSeconds, 60, "60s from the declared block, NOT 90 days from a case study");
  assert.equal(f.stale, false, "a current reading beside intentionally-old rows is not stale");
});

test("the container restriction DISCRIMINATES — it does not simply ignore the spelling", () => {
  // Same numbers, same shape, one difference: the key names a freshness block.
  // If this passes while the negative control above also passes, the rule is
  // reading the declaration rather than the field name.
  const asRow = freshnessOf({ observation: { ageMinutes: 240 } });
  const asBlock = freshnessOf({ observationFreshness: { ageMinutes: 240 } });

  assert.equal(asRow.known, false, "a bare row field is not a freshness declaration");
  assert.equal(asBlock.known, true, "the same field inside a declared block IS one");
  assert.equal(asBlock.dataAgeSeconds, 14_400, "240 minutes normalised to seconds");
  assert.equal(asBlock.sourceUnit, "minutes");
});

test("maxStalenessMs — engineIntelligenceSnapshot's bar spelling — is read as a bar", () => {
  const f = freshnessOf({
    engine: {
      freshness: { status: "fresh", ageMs: 30_000, maxStalenessMs: 120_000, latestExpiresAt: null },
    },
  });
  assert.equal(f.dataAgeSeconds, 30);
  assert.equal(f.staleAfterSeconds, 120, "maxStalenessMs is a staleness bar, not an age");
  assert.equal(f.stale, false);
});

test("a nested `freshness` key qualifies on its own name, at any depth", () => {
  // `freshness` needs no container test — its name IS the declaration. This is
  // the pre-existing path, kept working for producers that nest it.
  const f = freshnessOf({ views: { flow: { freshness: { ageMinutes: 45 } } } });
  assert.equal(f.known, true);
  assert.equal(f.dataAgeSeconds, 2_700);
});

test("REGRESSION — the original vocabulary still behaves exactly as before", () => {
  const f = freshnessOf({
    views: {
      regime: { dataAgeSeconds: 69, staleAfterSeconds: 600 },
      leadTime: { dataAgeHours: 1.4, staleAfterHours: 24 },
    },
  });
  assert.equal(f.contributingSources, 2);
  assert.equal(f.dataAgeSeconds, 5_040, "1.4h is older than 69s — worst case wins");
  assert.equal(f.staleAfterSeconds, 600, "600s is tighter than 24h — worst case wins");
  assert.equal(f.stale, true);
  assert.equal(f.sourceUnit, "mixed");
});

test("a payload with no freshness anywhere still says so, rather than inventing zero", () => {
  const f = freshnessOf({ symbols: ["BTCUSDT"], matrix: [[1]] });
  assert.equal(f.known, false);
  assert.equal(f.contributingSources, 0);
  assert.match(String(f.reason), /unknown — not fresh/);
});
