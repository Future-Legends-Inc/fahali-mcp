/**
 * Withholding the CLAIM must not relabel the MEASUREMENT as absent.
 *
 * ── The defect, measured 2026-09-04 ─────────────────────────────────────────
 * `server/lib/covarianceArtifact.ts` returned `matrix: []`, `symbols: []` while
 * holding a validated artifact of **11,175 of 11,175 measured pairs across 150
 * symbols**, computed 25 minutes earlier. Its reason: the source window was
 * 6h32m old against a 4h ceiling — on a **45-day** measurement, with the
 * artifact's own policy note naming the cause as an ordinary equity close.
 * That is fixed at the source, and guarded in `covarianceArtifact.test.ts`.
 *
 * ── What this file guards, and a correction to why ──────────────────────────
 * `classifyAgentPayload`'s withheld branch hardcoded `dataState: noData` and
 * returned BEFORE `inspectCollections` ran — so a payload that withheld its
 * claim while still carrying its evidence was labelled "no data", and any
 * briefing built on that label tells the agent nothing was measured.
 *
 * ⚠️ It would be tidy to say this was the second layer losing the correlation
 * matrix, and that is NOT what the classifier does — measured, not assumed. A
 * payload carrying `dataState: "stale"` is caught by an EARLIER stale branch
 * and correctly comes out as `stale`, which is exactly what production returned
 * on 2026-09-04. The `noData` hardcode therefore bites a different population:
 * abstentions that are **not** stale but still carry evidence — an insufficient
 * -evidence verdict, a tie the engine declined to break — where the rows are
 * right there and the envelope calls them absent.
 *
 * ── The line being drawn ────────────────────────────────────────────────────
 * A withheld claim over EMPTY collections is still `no_data`; that is a real
 * absence and must keep reading as one. The question is not "is the claim
 * withheld" but "is there a measurement behind the refusal", answered from
 * `adapter.collections` (a declared per-tool list, not a guess) or from the
 * producer saying so outright with `evidenceRetained`.
 *
 *   node --import tsx --test mcp-server/src/withheldClaimRetainsEvidence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyAgentPayload } from "./agentPayload.js";

/** `fahali_get_correlation_matrix` declares collections ["matrix", "perSymbol"]. */
const TOOL = "fahali_get_correlation_matrix";

const abstained = (extra: Record<string, unknown>) => ({
  status: "withheld",
  claim: {
    kind: "abstention",
    basis: "absent",
    reason: "Insufficient evidence to publish a directional claim.",
  },
  ...extra,
});

const REAL_MATRIX = [[1, 0.83], [0.83, 1]];
const REAL_PER_SYMBOL = [
  { symbol: "BTCUSDT", measuredPairCount: 1, weightedMeanPeerCorrelation: 0.83 },
  { symbol: "ETHUSDT", measuredPairCount: 1, weightedMeanPeerCorrelation: 0.83 },
];

test("a withheld claim over a POPULATED collection is not 'no data'", () => {
  const c = classifyAgentPayload(TOOL, abstained({
    matrix: REAL_MATRIX,
    perSymbol: REAL_PER_SYMBOL,
  }));

  assert.equal(c.responseState, "WITHHELD", "the claim is still refused — that part was right");
  assert.notEqual(c.dataState, "no_data", "but a returned measurement is not an absence of data");
  assert.equal(c.dataState, "measured");
  assert.match(
    String(c.absence?.reason),
    /measurement IS present/i,
    "the absence note must say the data is there, or the briefing repeats the old lie",
  );
  assert.match(String(c.absence?.reason), /do not publish/i, "while still forbidding publication");
});

test("NEGATIVE CONTROL — a withheld claim over EMPTY collections is still 'no data'", () => {
  // The whole point of the fix is that it DISCRIMINATES. A genuine abstention
  // with nothing behind it must be unchanged, or this becomes a blanket
  // "everything is measured" relabel — the same defect, inverted.
  const c = classifyAgentPayload(TOOL, abstained({ matrix: [], perSymbol: [] }));

  assert.equal(c.responseState, "WITHHELD");
  assert.equal(c.dataState, "no_data", "nothing behind the refusal means nothing behind the refusal");
  assert.doesNotMatch(
    String(c.absence?.reason),
    /measurement IS present/i,
    "and it must NOT claim a measurement it does not have",
  );
});

test("the producer can declare retained evidence even where collections are empty", () => {
  // `evidenceRetained` is the explicit seam: a producer that keeps its
  // measurement somewhere the adapter does not declare as a collection can
  // still say so, rather than being silently downgraded.
  const c = classifyAgentPayload(TOOL, abstained({ matrix: [], perSymbol: [], evidenceRetained: true }));
  assert.notEqual(c.dataState, "no_data");
  assert.match(String(c.absence?.reason), /measurement IS present/i);
});

test("evidenceRetained is not assumed — the flag must actually be true", () => {
  const c = classifyAgentPayload(TOOL, abstained({ matrix: [], perSymbol: [], evidenceRetained: false }));
  assert.equal(c.dataState, "no_data", "false must not read as true, and absence must stay earned");
});

test("not_instrumented outranks retained evidence", () => {
  // "We never built this" is a stronger and more useful statement than "we have
  // rows"; collapsing it to `measured` would hide a capability gap behind data.
  const c = classifyAgentPayload(TOOL, abstained({
    dataState: "not_instrumented",
    matrix: REAL_MATRIX,
    perSymbol: REAL_PER_SYMBOL,
  }));
  assert.equal(c.dataState, "not_instrumented");
});

test("the EARLIER stale branch is unchanged — this fix did not move it", () => {
  // Recorded because the tidy story ("the envelope lost the matrix too") is
  // false, and the next reader will assume it unless the real behaviour is
  // pinned. A stale payload is classified by the stale branch, above; whether
  // its collections are full or empty makes no difference there.
  const populated = classifyAgentPayload(TOOL, abstained({
    dataState: "stale",
    matrix: REAL_MATRIX,
    perSymbol: REAL_PER_SYMBOL,
  }));
  const empty = classifyAgentPayload(TOOL, abstained({ dataState: "stale", matrix: [], perSymbol: [] }));

  assert.equal(populated.dataState, "stale");
  assert.equal(empty.dataState, "stale");
  assert.equal(populated.absence?.kind, "stale");
  assert.notEqual(populated.dataState, "no_data", "which is why the matrix fix belongs at the source");
});
