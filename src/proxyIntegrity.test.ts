import test from "node:test";
import assert from "node:assert/strict";

import {
  getMarketSnapshot,
  updatePortfolioWatch,
} from "./proxy.js";
import { TOOL_DEFINITIONS } from "./tools.js";

async function withFetchStub<T>(
  stub: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("PATCH preserves a successful text acknowledgement as typed structured content", async () => {
  const result = await withFetchStub(
    (async () => new Response("watch updated", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })) as typeof fetch,
    () => updatePortfolioWatch(undefined, "watch-1", { name: "Risk watch" }),
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    status: "ok",
    dataState: "measured",
    responseState: "OK_WITH_FINDINGS",
    httpStatus: 200,
    responseBody: {
      kind: "text",
      mediaType: "text/plain",
      text: "watch updated",
    },
  });
});

test("PATCH emits an explicit acknowledgement for a successful empty response", async () => {
  const result = await withFetchStub(
    (async () => new Response(null, { status: 204 })) as typeof fetch,
    () => updatePortfolioWatch(undefined, "watch-1", { status: "paused" }),
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    status: "ok",
    dataState: "measured",
    responseState: "OK_WITH_FINDINGS",
    success: true,
    noContent: true,
    httpStatus: 204,
  });
  assert.notDeepEqual(result.structuredContent, { data: null });
});

test("PATCH still rejects an HTML SPA catch-all as a routing fault", async () => {
  const result = await withFetchStub(
    (async () => new Response("<!doctype html><html><body>app</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })) as typeof fetch,
    () => updatePortfolioWatch(undefined, "watch-1", { status: "active" }),
  );

  assert.equal(result.isError, true);
  assert.match(String(result.content[0] && "text" in result.content[0] ? result.content[0].text : ""), /routing or deployment fault/i);
});

test("market snapshot omits the limit upstream by default and forwards an explicit cap", async () => {
  const requestedUrls: string[] = [];
  const body = {
    total: 2,
    assets: [
      { symbol: "AAPL", price: 200 },
      { symbol: "BTCUSDT", price: 100_000 },
    ],
    indices: [],
    timestamp: 1,
  };

  await withFetchStub(
    (async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    async () => {
      const complete = await getMarketSnapshot(undefined);
      const capped = await getMarketSnapshot(undefined, { limit: 7 });
      assert.deepEqual(complete.structuredContent, body);
      assert.deepEqual(capped.structuredContent, body);
    },
  );

  assert.equal(new URL(requestedUrls[0]).searchParams.has("limit"), false);
  assert.equal(new URL(requestedUrls[1]).searchParams.get("limit"), "7");
});

test("market snapshot discovery does not silently cap, and does not overclaim coverage", () => {
  /**
   * 🔴 THIS TEST USED TO ENFORCE A FALSE CLAIM. (corrected 2026-09-04)
   *
   * It asserted the description says "Omitting limit returns the COMPLETE
   * MONITORED UNIVERSE". The real fix it was written for was a genuine one — an
   * earlier version silently defaulted to the first 50 rows — but the wording
   * chosen to repair that overshot into something untrue: the snapshot holds
   * the Binance USDT book plus a 14-name US watchlist (684 rows measured
   * 2026-09-04), against an Alpaca-eligible equity universe of 13,015. A
   * request for AMD, COIN, PLTR and MSTR returned all four unanswered.
   *
   * A guard that pins a false sentence in place is worse than no guard: it
   * makes the honest correction fail CI. The property worth protecting is that
   * omitting `limit` is not a silent cap — asserted directly below, without
   * requiring any claim about how much of the market is covered.
   */
  const tool = (TOOL_DEFINITIONS as any[]).find((entry) => entry.name === "fahali_get_market_snapshot");
  assert.ok(tool);

  assert.doesNotMatch(tool.description, /Defaults to the first 50/i);
  assert.doesNotMatch(
    tool.description,
    /complete monitored universe/i,
    "the snapshot does not cover the monitored universe and must not say it does",
  );
  // The caller must be told where coverage actually comes from.
  assert.match(tool.description, /coverage/i);

  assert.equal(tool.inputSchema.properties.limit.type, "integer");
  assert.equal(tool.inputSchema.properties.limit.minimum, 1);
  assert.equal(tool.inputSchema.properties.limit.maximum, 800);
  assert.match(
    tool.inputSchema.properties.limit.description,
    /NOT every instrument Fahali monitors/i,
    "omitting limit returns everything HELD, which is not everything monitored",
  );
});
