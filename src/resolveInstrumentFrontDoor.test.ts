/**
 * MCP side of "BTC resolves to BTCUSDT" (2026-10-06).
 *
 *  1. The tool forwards an explicit `assetClass` so a caller CAN ask for the
 *     listed security sharing a crypto ticker.
 *  2. The coverage ledger honours the server's DISCLOSED canonicalisation:
 *     "BTC" requested and a BTCUSDT identity returned is BTC delivered — not
 *     "BTC not returned, may be unsupported" beside an unrequested row.
 *
 *   node --import tsx --test mcp-server/src/resolveInstrumentFrontDoor.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveInstrument } from "./proxy.js";
import { decorateForAgent } from "./agentPayload.js";

test("assetClass is forwarded to /agent/resolve-instrument", async () => {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ status: "ok", requested: ["BTC"], instruments: [] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await resolveInstrument(undefined, "BTC", "equity");
    await resolveInstrument(undefined, "BTC");
  } finally {
    globalThis.fetch = original;
  }
  assert.match(seen[0], /assetClass=equity/);
  assert.doesNotMatch(seen[1], /assetClass/);
});

const BTC_RESOLVED = {
  status: "ok",
  dataState: "measured",
  requested: ["BTC"],
  instruments: [{
    symbol: "BTCUSDT", canonicalId: "binance:crypto:BTC-USDT", canonicalInstrumentId: "binance:crypto:BTC-USDT",
    displayName: "BTC / USDT", assetClass: "crypto", venue: "BINANCE", quoteCurrency: "USDT",
    resolutionState: "resolved", resolutionBasis: "venue_asset_list", ambiguityWarning: null,
    identityVersion: 1, session: { label: "crypto_24_7", open: true, nextOpen: null },
  }],
  symbolResolutions: [{
    asked: "BTC", lookupKey: "BTCUSDT", basis: "venue-listed", disclosure: "You asked for BTC…",
    equityAlternative: { symbol: "BTC", displayName: "Grayscale Bitcoin Mini Trust ETF", note: "…" },
  }],
  unresolved: [],
  referenceHealth: { loaded: true },
};

test("a disclosed canonicalisation counts as delivering the asked symbol", () => {
  const out = decorateForAgent("fahali_resolve_instrument", {
    structuredContent: BTC_RESOLVED, content: [],
  } as any, { detail: "audit" }).structuredContent as any;
  assert.deepEqual(out.symbolCoverage.notReturned, [], "BTC must not be reported missing");
  assert.deepEqual(out.symbolCoverage.returned, ["BTC"]);
  assert.equal(out.symbolCoverage.fullyReturned, true);
});

test("without the server's disclosure the ledger does NOT infer the link", () => {
  const { symbolResolutions, ...undisclosed } = BTC_RESOLVED;
  void symbolResolutions;
  const out = decorateForAgent("fahali_resolve_instrument", {
    structuredContent: undisclosed, content: [],
  } as any, { detail: "audit" }).structuredContent as any;
  assert.deepEqual(out.symbolCoverage.notReturned, ["BTC"]);
});
