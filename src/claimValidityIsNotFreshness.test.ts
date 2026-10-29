/**
 * A claim can be inside its staleness window and still be expired.
 *
 * ── Measured in production, 2026-08-30 ─────────────────────────────────────
 * `fahali_get_market_decision` returned:
 *
 *   decision.horizon                    "12h"
 *   scope.horizon                       "12h"
 *   freshness.dataAgeSeconds            241480   (67.1 hours)
 *   freshness.staleAfterSeconds         259200   (72 hours)
 *   freshnessNormalized.stale           false
 *   evidenceQuality.stale               false
 *
 * Every one of those readings is individually correct. A twelve-hour call built
 * on a 67-hour-old reading had expired roughly 55 hours earlier, and was served
 * as current, because nothing in the system compared the two numbers.
 *
 * FRESHNESS asks "is the data I read recent enough to serve?" — a query window.
 * CLAIM VALIDITY asks "is what I said still supposed to be true?" — a horizon.
 * Two correct measurements, no one comparing them.
 *
 * These tests pin the comparison, and pin that it stays SEPARATE from `stale`:
 * the remedies differ (old data is a pipeline problem; an expired claim means
 * re-ask), so merging them would erase the distinction an agent needs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

const HOUR = 3600;

/** Extract the envelope's claimValidity block for a synthetic source payload. */
function envelopeFor(data: Record<string, unknown>, options: Record<string, unknown> = {}): Record<string, any> {
  const out = decorateForAgent("fahali_get_market_decision", { structuredContent: data } as any, options as any);
  return out.structuredContent as Record<string, any>;
}

function validityFor(data: Record<string, unknown>): Record<string, any> {
  return envelopeFor(data).claimValidity as Record<string, any>;
}

test("the production case: a 12h claim on a 67h reading is reported expired", () => {
  const validity = validityFor({
    status: "ok",
    freshness: { dataAgeSeconds: 241_480, staleAfterSeconds: 259_200 },
    decision: { horizon: "12h", direction: "bearish" },
    scope: { horizon: "12h" },
  });

  assert.equal(validity.known, true);
  assert.equal(validity.expired, true, "a 12h claim on a 67h reading has expired");
  assert.equal(validity.shortestHorizonSeconds, 12 * HOUR);
  assert.equal(validity.dataAgeSeconds, 241_480);
  assert.ok(
    validity.overdueSeconds > 54 * HOUR && validity.overdueSeconds < 56 * HOUR,
    `expected roughly 55h overdue, got ${validity.overdueSeconds / HOUR}h`,
  );
  assert.match(validity.reason, /expired/i);
  assert.match(
    validity.reason,
    /separate from data staleness/i,
    "the reason must say why this differs from staleness, or a reader treats it as a duplicate",
  );
});

test("claim expiry stays SEPARATE from freshness staleness", () => {
  // The same payload: inside the 72h staleness window, past the 12h horizon.
  const out = envelopeFor({
    status: "ok",
    freshness: { dataAgeSeconds: 241_480, staleAfterSeconds: 259_200 },
    decision: { horizon: "12h" },
  });

  assert.equal(
    out.freshnessNormalized.stale,
    false,
    "freshness is measuring the query window and is correct to say not-stale",
  );
  assert.equal(
    out.claimValidity.expired,
    true,
    "claim validity is measuring the horizon and must say expired",
  );
  // Merging them would destroy the distinction: an agent needs to tell a
  // pipeline problem from a claim it should simply re-ask for.
  assert.notEqual(out.freshnessNormalized.stale, out.claimValidity.expired);
});

test("only the selected claim governs, so a projected-away sibling cannot expire it", () => {
  const out = envelopeFor({
    status: "ok",
    data: [
      {
        symbol: "BTCUSDT",
        dataAgeSeconds: 2 * HOUR,
        staleAfterSeconds: 72 * HOUR,
        verdict: { forecastHorizon: "72h", direction: "bearish", actionability: "ACTIONABLE" },
      },
      {
        symbol: "OLDUSDT",
        dataAgeSeconds: 40 * HOUR,
        staleAfterSeconds: 72 * HOUR,
        verdict: { forecastHorizon: "12h", direction: "unknown", actionability: "ABSTAIN" },
      },
    ],
  }, { detail: "brief", limit: 1 } as any);
  const validity = out.claimValidity;

  assert.equal(out.data.length, 1, "the stale sibling must actually be projected away in this control");
  assert.equal(out.data[0].symbol, "BTCUSDT");
  assert.equal(validity.selectedSymbol, "BTCUSDT");
  assert.equal(validity.shortestHorizonSeconds, 72 * HOUR);
  assert.equal(validity.dataAgeSeconds, 2 * HOUR);
  assert.equal(validity.expired, false);
  assert.notEqual(validity.basis, "shortest_horizon_in_response");
});

test("a claim inside its horizon is not reported expired", () => {
  const validity = validityFor({
    status: "ok",
    freshness: { dataAgeSeconds: 2 * HOUR, staleAfterSeconds: 259_200 },
    decision: { horizon: "12h" },
  });

  assert.equal(validity.known, true);
  assert.equal(validity.expired, false);
  assert.equal(validity.overdueSeconds, undefined, "no overdue figure when nothing is overdue");
});

test("an unknown horizon reports known:false, never expired:false", () => {
  // Absence is not validity — the same rule freshnessNormalized already follows.
  const validity = validityFor({
    status: "ok",
    freshness: { dataAgeSeconds: 5 * HOUR, staleAfterSeconds: 259_200 },
  });

  assert.equal(validity.known, false);
  assert.equal(validity.expired, undefined,
    "a missing horizon must not render as a valid claim");
  assert.match(validity.reason, /unknown — not valid/i);
});

test("an unknown age reports known:false even when a horizon is declared", () => {
  const validity = validityFor({
    status: "ok",
    decision: { horizon: "12h" },
  });

  assert.equal(validity.known, false);
  assert.equal(validity.expired, undefined);
  assert.equal(validity.shortestHorizonSeconds, 12 * HOUR,
    "the horizon it did find is still reported, so the gap is legible");
});

test("horizon units are parsed, not assumed to be hours", () => {
  // "90m" must not be read as 90 hours, which would make an expired claim valid.
  const minutes = validityFor({
    status: "ok",
    freshness: { dataAgeSeconds: 3 * HOUR, staleAfterSeconds: 259_200 },
    decision: { horizon: "90m" },
  });
  assert.equal(minutes.shortestHorizonSeconds, 90 * 60);
  assert.equal(minutes.expired, true, "3h elapsed against a 90-minute horizon is expired");

  const days = validityFor({
    status: "ok",
    freshness: { dataAgeSeconds: 3 * HOUR, staleAfterSeconds: 259_200 },
    decision: { horizon: "2d" },
  });
  assert.equal(days.shortestHorizonSeconds, 2 * 86_400);
  assert.equal(days.expired, false);
});

test("claimValidity survives the conservation check", () => {
  // The envelope drops keys it has not declared. A field stripped on the way out
  // is the same as one never written — this repo has shipped that before.
  const out = envelopeFor({
    status: "ok",
    freshness: { dataAgeSeconds: 241_480, staleAfterSeconds: 259_200 },
    decision: { horizon: "12h" },
  });

  assert.ok("claimValidity" in out, "claimValidity must reach the caller");
});
