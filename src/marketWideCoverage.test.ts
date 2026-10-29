/**
 * A market-wide response cannot owe per-instrument delivery.
 *
 * Observed in production 2026-09-04 on `fahali_get_market_regime`. Calling it
 * with a symbol argument produced:
 *
 *   notReturned: [{ symbol: "BTCUSDT", reasonCode: "UNSUPPORTED_OR_NOT_RETURNED",
 *                   reason: "...this is not a calm or neutral finding" }]
 *   symbolCoverage.fullyReturned: false,  responseState: "PARTIAL"
 *
 * over a response that HAD delivered the market-wide reading the caller can
 * use. `requestedSymbolsFor` starts from `options.symbols` — the caller's own
 * tool arguments — so ANY tool called with `symbols` acquires a delivery
 * obligation, and the regime rows deliberately carry no `symbol` for the
 * projection to match (the projection keeps unsymboled rows as global context
 * and drops mismatched ones, which is why that absence is load-bearing).
 *
 * A false miss is worse than a quiet one: this is the field an agent reads to
 * decide whether it was told everything, so crying wolf here trains it to
 * ignore the field that exists to be believed.
 *
 * This could not have been caught by a source-text guard. It exists only in the
 * composed response — which is the lesson: a tool that shapes an agent payload
 * has to be CALLED, not grepped.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

/** The live regime shape: one market-wide row that carries NO symbol. */
const regimeResult = (scope: Record<string, unknown>) => ({
  structuredContent: {
    status: "ok",
    dataState: "measured",
    responseState: "OK_WITH_FINDINGS",
    regimes: [{ regime: "neutral_range_bound", trend: null, trendStrength: -0.00014 }],
    count: 1,
    scope,
  },
  content: [{ type: "text", text: "{}" }],
});

const MARKET_WIDE = { scope: "market_wide", appliesToInstrument: false, symbolFilterApplied: false };

test("a market-wide response does not manufacture a coverage miss", () => {
  const out = decorateForAgent(
    "fahali_get_market_regime",
    regimeResult(MARKET_WIDE) as any,
    { symbols: ["BTCUSDT"] } as any,
  );
  const sc = out.structuredContent as any;

  assert.deepEqual(sc.symbolCoverage.notReturned, [], "the reading WAS delivered");
  assert.deepEqual(sc.notReturned ?? [], [], "no UNSUPPORTED_OR_NOT_RETURNED entry may be invented");
  assert.notEqual(sc.responseState, "PARTIAL", "a complete market-wide answer is not partial");
});

test("NEGATIVE CONTROL — without the declaration, a real miss is still reported", () => {
  // The guard must be the EXPLICIT declaration, not a blanket amnesty. Drop
  // `appliesToInstrument` and the ledger must still catch the gap, or this
  // change would have silenced every tool's coverage reporting.
  const out = decorateForAgent(
    "fahali_get_market_regime",
    regimeResult({ scope: "explicit" }) as any,
    { symbols: ["BTCUSDT"] } as any,
  );
  const sc = out.structuredContent as any;
  assert.deepEqual(
    sc.symbolCoverage.notReturned,
    ["BTCUSDT"],
    "a response that does NOT declare itself market-wide still owes what was asked for",
  );
});

test("NEGATIVE CONTROL — an unrelated tool keeps its coverage ledger", () => {
  // Every other tool omits `appliesToInstrument`, so this must be inert for
  // them: undefined !== false.
  const out = decorateForAgent(
    "fahali_get_capital_flow",
    {
      structuredContent: { status: "ok", data: [{ symbol: "ETHUSDT" }], scope: {} },
      content: [{ type: "text", text: "{}" }],
    } as any,
    { symbols: ["BTCUSDT"] } as any,
  );
  const sc = out.structuredContent as any;
  assert.deepEqual(sc.symbolCoverage.notReturned, ["BTCUSDT"], "unrelated tools are untouched");
});
