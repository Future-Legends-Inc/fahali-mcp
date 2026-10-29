/**
 * The fact-check binds each sentence to the instrument THAT SENTENCE names.
 *
 * Observed live 2026-10-06. One multi-sentence claim:
 *
 *   "NVDA is seeing heavy institutional selling. Bitcoin is in a bearish
 *    regime. KERNEL had a volume spike today."
 *
 * came back with
 *   - "Bitcoin is in a bearish regime" CONTRADICTED, citing NVDA's upside skew.
 *     The whole-claim symbol list was passed as the hint to EVERY sentence and
 *     the first entry won, so a sentence about Bitcoin was scored against NVDA.
 *   - NVDA flagged "ambiguous asset class": the assertion carried a bare symbol
 *     and none of the identity the verdict endpoint had already resolved.
 *   - "NVDA is seeing heavy institutional selling" UNVERIFIABLE: "selling" was
 *     not a recognised directional word, although Fahali's read was upside skew.
 *   - "KERNEL had a volume spike today" UNVERIFIABLE although the tape held
 *     volume-spike detections for KERNELUSDT that day. Nothing ever looked.
 *
 * These tests drive `factCheckNarrative` end to end with a stubbed fetch,
 * because the defect lived in the orchestration, not in the pure classifier.
 *
 *   node --import tsx --test mcp-server/src/factCheckBinding.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { factCheckNarrative } from "./proxy.js";
import { timeWindowOf, symbolsInSentence } from "./factCheck.js";
import { decorateForAgent } from "./agentPayload.js";
import { responseOptions } from "./responseOptions.js";

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** What the server's front door does: majors and venue-listed bases → pair. */
const SERVER_RESOLVES: Record<string, string> = { BTC: "BTCUSDT", KERNEL: "KERNELUSDT" };

const identity = (symbol: string, assetClass: string, venue: string) => ({
  symbol, assetClass, venue, resolutionState: "resolved", resolutionBasis: "venue_asset_list",
  canonicalInstrumentId: `${venue.toLowerCase()}:${assetClass}:${symbol}`, identityVersion: 1,
});

const VERDICT_ROWS: Record<string, any> = {
  NVDA: {
    symbol: "NVDA",
    instrumentIdentity: identity("NVDA", "equity", "NASDAQ"),
    verdict: { direction: "bullish", actionability: "ACTIONABLE", abstainReason: null },
    canonical: { direction: "UPSIDE_SKEW", headline: "Range-bound with upside skew" },
  },
  BTCUSDT: {
    symbol: "BTCUSDT",
    instrumentIdentity: identity("BTCUSDT", "crypto", "BINANCE"),
    verdict: { direction: "bullish", actionability: "ACTIONABLE", abstainReason: null },
    canonical: { direction: "UPSIDE_SKEW", headline: "Range-bound with upside skew" },
  },
};

/** Rows in the LIVE shape: a volume spike is stored as multi_indicator_confluence. */
function volumeSpikeRow(symbol: string, msAgo: number) {
  return {
    id: "52728197", symbol, alertType: "multi_indicator_confluence", title: "Volume Spike",
    message: `Risk alert: Volume spike detected: 3.51 standard deviations above normal in ${symbol}`,
    timestamp: iso(msAgo),
    claimScope: { scope: "instrument" },
    details: {
      alert_type: "volume_spike", data_state: "measured",
      _raw: { alert_type: "volume_spike", measured: { z_score: 3.507 } },
      instrumentIdentity: identity(symbol, "crypto", "BINANCE"),
    },
  };
}
function regimeRow(symbol: string, regime: string, msAgo: number) {
  return {
    id: "52729037", symbol, alertType: "regime_state", title: "Market Regime Reading",
    message: `Market regime: ${regime[0] + regime.slice(1).toLowerCase()} (nowcast — state, not a forecast)`,
    timestamp: iso(msAgo),
    claimScope: { scope: "instrument" },
    details: { alert_type: "regime_state", data_state: "measured", regime_nowcast: regime, primary_regime: regime },
  };
}

type Tape = Record<string, any[]>;
const DEFAULT_TAPE: Tape = {
  BTCUSDT: [regimeRow("BTCUSDT", "BEARISH", 120_000)],
  KERNELUSDT: [regimeRow("KERNELUSDT", "BEARISH", 30_000), volumeSpikeRow("KERNELUSDT", 60_000)],
  NVDA: [],
};

function stub(opts: { tape?: Tape; realtimeStatus?: number; calls?: string[] } = {}): typeof fetch {
  const tape = opts.tape ?? DEFAULT_TAPE;
  return (async (input: any) => {
    const url = new URL(String(input));
    opts.calls?.push(url.pathname + url.search);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/agent/verdict") {
      const asked = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      const keys = asked.map((s) => SERVER_RESOLVES[s] ?? s);
      return json({
        data: keys.map((k) => VERDICT_ROWS[k]).filter(Boolean),
        symbolResolutions: asked.filter((s) => SERVER_RESOLVES[s]).map((s) => ({
          asked: s, lookupKey: SERVER_RESOLVES[s], basis: "venue-listed",
        })),
      });
    }
    if (url.pathname === "/api/spectra/realtime") {
      if (opts.realtimeStatus && opts.realtimeStatus !== 200) return json({ error: "forbidden" }, opts.realtimeStatus);
      const sym = url.searchParams.get("symbols") ?? "";
      const rows = tape[sym] ?? [];
      return json({
        signals: rows, clusters: [], alert_count: rows.length,
        coverage: { matched: { alerts: rows.length }, sourceTruncated: false, clamps: [] },
      });
    }
    return json({ error: "not stubbed" }, 404);
  }) as typeof fetch;
}

async function run(claim: string, symbols?: string[], f: typeof fetch = stub()) {
  const original = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const r = await factCheckNarrative(undefined, claim, symbols);
    return r.structuredContent as any;
  } finally {
    globalThis.fetch = original;
  }
}

const LIVE_CLAIM =
  "NVDA is seeing heavy institutional selling. Bitcoin is in a bearish regime. KERNEL had a volume spike today.";

test("each sentence binds to the instrument it names — Bitcoin is never scored against NVDA", async () => {
  const out = await run(LIVE_CLAIM);
  const [nvda, btc] = out.assertions;
  assert.notEqual(btc.symbol, "NVDA", "the Bitcoin sentence must not inherit NVDA from an earlier sentence");
  assert.equal(btc.symbol, "BTCUSDT", "bitcoin binds to the crypto pair the server resolved");
  assert.equal(nvda.symbol, "NVDA");
});

test("a regime claim is checked against the regime nowcast on the tape, not the forward skew", async () => {
  const out = await run(LIVE_CLAIM);
  const btc = out.assertions[1];
  assert.equal(btc.verdict, "SUPPORTED", btc.explanation);
  assert.match(String(btc.fahaliSays), /bearish/i);
  // An opposite instrument-scoped reading is a real contradiction.
  const bull = await run("Bitcoin is in a bearish regime.", undefined,
    stub({ tape: { BTCUSDT: [regimeRow("BTCUSDT", "BULLISH", 60_000)] } }));
  assert.equal(bull.assertions[0].verdict, "CONTRADICTED");
});

test("'selling' is a directional claim and is scored against Fahali's read", async () => {
  const out = await run(LIVE_CLAIM);
  const nvda = out.assertions[0];
  assert.equal(nvda.verdict, "CONTRADICTED", nvda.explanation);
  assert.match(nvda.explanation, /does not attribute|who/i, "the institutional attribution is named as unchecked");
});

test("the assertion carries the identity the verdict endpoint resolved — never 'ambiguous'", async () => {
  const out = await run(LIVE_CLAIM);
  assert.equal(out.assertions[0].instrumentIdentity?.assetClass, "equity");
  assert.equal(out.assertions[1].instrumentIdentity?.assetClass, "crypto");
});

test("a volume-spike claim is checked against the tape for the RESOLVED pair", async () => {
  const calls: string[] = [];
  const out = await run(LIVE_CLAIM, undefined, stub({ calls }));
  const kernel = out.assertions[2];
  assert.equal(kernel.symbol, "KERNELUSDT");
  assert.equal(kernel.verdict, "SUPPORTED", kernel.explanation);
  assert.equal(kernel.evidence?.[0]?.id, "52728197");
  assert.ok(calls.some((c) => c.includes("symbols=KERNELUSDT")), "the tape is read under the lookup key");
});

test("no matching detection is NO_READ — never CONTRADICTED, never 'calm'", async () => {
  const out = await run("KERNEL had a volume spike today.", undefined,
    stub({ tape: { KERNELUSDT: [regimeRow("KERNELUSDT", "BEARISH", 30_000)] } }));
  const a = out.assertions[0];
  assert.equal(a.verdict, "NO_READ");
  assert.equal(a.safeToRepeat, false);
  assert.match(a.explanation, /not evidence|not a finding/i);
});

test("a tape read that fails says the check did not run", async () => {
  const out = await run("KERNEL had a volume spike today.", undefined, stub({ realtimeStatus: 403 }));
  const a = out.assertions[0];
  assert.equal(a.verdict, "NO_READ");
  assert.match(a.explanation, /did not run/i);
});

test("a sentence naming nothing binds to nothing — unless the caller named exactly one instrument", async () => {
  const many = await run("The market is jittery and could fall.", ["NVDA", "BTC"]);
  assert.equal(many.assertions[0].symbol, undefined);
  assert.equal(many.assertions[0].verdict, "UNVERIFIABLE");
  const one = await run("It could fall from here.", ["NVDA"]);
  assert.equal(one.assertions[0].symbol, "NVDA");
  assert.equal(one.assertions[0].verdict, "CONTRADICTED");
});

test("time words set the tape window, and a window beyond the tape says so", () => {
  const now = new Date("2026-10-06T15:30:00Z");
  assert.equal(timeWindowOf("KERNEL spiked today", now).sinceIso, "2026-10-06T00:00:00.000Z");
  assert.equal(timeWindowOf("in the last 2 hours", now).sinceIso, "2026-10-06T13:30:00.000Z");
  const week = timeWindowOf("volume spiked this week", now);
  assert.equal(week.exceedsTape, true);
  assert.equal(timeWindowOf("no time words", now).stated, false);
});

test("names bind in sentence order; common words are not tickers", () => {
  assert.deepEqual(symbolsInSentence("Bitcoin and NVDA diverged."), ["BTC", "NVDA"]);
  assert.deepEqual(symbolsInSentence("THE market IS fine."), []);
});

/* ---- Through the REAL envelope, and the false-SUPPORTED paths ---------- */


async function runEnveloped(args: { claim: string; symbols?: string[] }, f: typeof fetch = stub()) {
  const original = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const r = await factCheckNarrative(undefined, args.claim, args.symbols);
    return decorateForAgent("fahali_fact_check_narrative", r as any, responseOptions({ ...args, detail: "audit" })).structuredContent as any;
  } finally {
    globalThis.fetch = original;
  }
}

test("ENVELOPE: every assertion survives the wrapper, even under a caller hint naming another symbol", async () => {
  const out = await runEnveloped({ claim: LIVE_CLAIM, symbols: ["NVDA"] });
  assert.equal(out.assertions.length, 3, "a bound sentence was filtered out of the response");
  assert.deepEqual(out.assertions.map((a: any) => a.symbol), ["NVDA", "BTCUSDT", "KERNELUSDT"]);
  const nvda = (out.instruments ?? []).find((i: any) => i.symbol === "NVDA");
  assert.ok(nvda, "NVDA identity is published");
  assert.equal(nvda.resolutionState, "resolved", "NVDA must not render as 'ambiguous asset class'");
  assert.equal(nvda.assetClass, "equity");
});

test("a sentence naming several instruments is SUPPORTED only if every one supports", async () => {
  const out = await run("KERNEL and BTC had a volume spike today.");
  const a = out.assertions[0];
  assert.equal(a.verdict, "NO_READ", "BTC had no spike, so the sentence is not confirmed");
  assert.equal(a.safeToRepeat, false);
  assert.deepEqual(a.symbols, ["KERNELUSDT", "BTCUSDT"]);
  const both = await run("KERNEL and BTC had a volume spike today.", undefined, stub({
    tape: { KERNELUSDT: [volumeSpikeRow("KERNELUSDT", 60_000)], BTCUSDT: [volumeSpikeRow("BTCUSDT", 60_000)] },
  }));
  assert.equal(both.assertions[0].verdict, "SUPPORTED");
});

test("a proxy detail row is not support, and its own cluster cannot sneak it back in", async () => {
  const proxyRow = { ...volumeSpikeRow("KERNELUSDT", 60_000), details: { ...volumeSpikeRow("KERNELUSDT", 60_000).details, data_state: "proxy" } };
  const f = (async (input: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/spectra/realtime") {
      return new Response(JSON.stringify({
        signals: [proxyRow],
        clusters: [{ symbol: "KERNELUSDT", thesis: "Volume Spike", lastSeen: proxyRow.timestamp,
          evidence: [{ alertType: "Volume Spike", message: proxyRow.message, timestamp: proxyRow.timestamp }] }],
        coverage: { sourceTruncated: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return stub()(input);
  }) as typeof fetch;
  const out = await run("KERNEL had a volume spike today.", undefined, f);
  assert.equal(out.assertions[0].verdict, "NO_READ");
});

test("a volume DRAIN never supports 'had a volume spike'", async () => {
  const drain = { ...volumeSpikeRow("KERNELUSDT", 60_000), title: "Volume Anomaly", alertType: "volume_anomaly",
    message: "Volume drain: 80% below normal", details: { alert_type: "volume_anomaly", data_state: "measured" } };
  const out = await run("KERNEL had a volume spike today.", undefined, stub({ tape: { KERNELUSDT: [drain] } }));
  assert.equal(out.assertions[0].verdict, "NO_READ");
});

test("'yesterday' ends at today 00:00 UTC — a spike from an hour ago is not yesterday's", () => {
  const now = new Date("2026-10-06T15:30:00Z");
  const w = timeWindowOf("KERNEL had a volume spike yesterday", now);
  assert.equal(w.untilIso, "2026-10-06T00:00:00.000Z");
  assert.equal(w.sinceIso, "2026-10-05T15:30:00.000Z", "clamped to the 24h tape");
  assert.equal(w.exceedsTape, true);
});
