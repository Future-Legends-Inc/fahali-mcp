/**
 * COVERAGE MUST SEE EVERY COLLECTION THE PAYLOAD SHIPPED.
 *
 * Measured on production 2026-09-03. `fahali_get_market_snapshot` was asked for
 * eight symbols. SPY, QQQ, GLD and TLT came back in `notReturned` with
 *
 *   "It may be unsupported or unavailable; this is not a calm or neutral finding."
 *
 * while all four sat in `indices[]` of that same response, priced. The tool
 * declares `collections: ["assets", "indices"]`, but `rowsOf` returns the FIRST
 * non-empty collection — `assets` — so `indices` was never scanned.
 *
 * `conservationSatisfied` was `true` and that was not a second bug: it asks
 * whether every requested symbol landed in SOME bucket. It cannot see misfiling.
 * The bucketing is what had to be fixed.
 *
 * Negative-controlled: reverting `symbolsIn` to `rowsOf` fails these.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decorateForAgent } from "./agentPayload.js";

function snapshot() {
  return {
    status: "ok",
    dataState: "measured",
    asOf: new Date().toISOString(),
    assets: [
      { symbol: "BTCUSDT", price: 79008.28 },
      { symbol: "ETHUSDT", price: 2439.88 },
      { symbol: "NVDA", price: 228.27 },
      { symbol: "AAPL", price: 201.11 },
    ],
    indices: [
      { symbol: "SPY", price: 768.4 },
      { symbol: "QQQ", price: 712.57 },
      { symbol: "TLT", price: 82.18 },
      { symbol: "GLD", price: 409.93 },
    ],
  };
}

const decorate = (data: Record<string, unknown>, symbols: string[]) =>
  decorateForAgent(
    "fahali_get_market_snapshot",
    { structuredContent: data, content: [] } as any,
    { detail: "audit", symbols } as any,
  ).structuredContent as Record<string, any>;

test("a symbol served in indices[] is not reported as unavailable", () => {
  const requested = ["BTCUSDT", "ETHUSDT", "NVDA", "AAPL", "SPY", "QQQ", "TLT", "GLD"];
  const sc = decorate(snapshot(), requested);

  const notReturned = (sc.symbolCoverage?.notReturned ?? []) as string[];
  for (const sym of ["SPY", "QQQ", "TLT", "GLD"]) {
    assert.ok(
      !notReturned.includes(sym),
      `${sym} was priced in indices[] and must not be reported missing (notReturned=${notReturned.join()})`,
    );
    assert.ok(
      (sc.symbolCoverage?.returned ?? []).includes(sym),
      `${sym} must be counted as returned`,
    );
  }
  assert.equal(sc.symbolCoverage?.notReturnedCount ?? notReturned.length, 0);
});

test("a genuinely absent symbol is still reported missing", () => {
  // The control: the fix must not turn the ledger into a rubber stamp.
  const sc = decorate(snapshot(), ["SPY", "NVDA", "FAKEUSDT"]);
  const notReturned = (sc.symbolCoverage?.notReturned ?? []) as string[];
  assert.ok(notReturned.includes("FAKEUSDT"), "an absent symbol must still be named");
  assert.ok(!notReturned.includes("SPY"));
  assert.ok(!notReturned.includes("NVDA"));
});

test("conservation still holds once the bucketing is right", () => {
  const requested = ["BTCUSDT", "SPY", "QQQ"];
  const sc = decorate(snapshot(), requested);
  assert.equal(sc.symbolCoverage?.conservationSatisfied, true);
  assert.equal(sc.symbolCoverage?.fullyReturned, true);
});

