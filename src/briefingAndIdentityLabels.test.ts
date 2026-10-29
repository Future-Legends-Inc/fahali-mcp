/**
 * Two more instances of the `labelsMustDeriveFromValues` invariant, both
 * measured on live payloads 2026-09-04 and both in the part of the envelope an
 * agent is most likely to repeat verbatim.
 *
 *   5. IDENTITY   `instrumentIdentitiesFor` read `row.instrumentIdentity` at the
 *                 ROW TOP LEVEL. Detection rows do not carry it there — ETHUSDT
 *                 nests it at `details.instrumentIdentity`, the anomaly rows at
 *                 `details._raw.instrumentIdentity`, BOTH declaring
 *                 `resolutionState: "resolved"` against a venue asset list.
 *                 Finding neither, the envelope fell through to a quote-suffix
 *                 PARSE and published `partial` / `canonicalId: null` plus
 *                 "Venue is missing. Do not equate this symbol with a similarly
 *                 named instrument on another market." It told an agent not to
 *                 trust an identity we had already resolved.
 *
 *   6. HEADINGS   "## Hard Evidence (Verified)" was a LITERAL, printed over any
 *                 rows at all. Live: every row `claim_tier: "detector"` beside
 *                 `matchedTrackRecord: null` whose reason was "No stratum yet
 *                 clears the headline floor" — Fahali refusing to stand behind a
 *                 record while the loudest line called the rows verified. And
 *                 "The Blind Spot" printed "nothing was flagged as missing" on a
 *                 response carrying `responseControl.omitted: {clusters: 45,
 *                 signals: 45, instruments: 52}`.
 *
 * Fixtures are transcribed from those live calls, not hand-simplified: a row
 * carrying identity at the top level would pass the pre-fix code and prove
 * nothing.
 *
 *   node --import tsx --test src/briefingAndIdentityLabels.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";
import { responseOptions } from "./responseOptions.js";

const wrap = (payload: unknown) => ({ structuredContent: payload }) as any;
const read = (out: any): any =>
  JSON.parse(out.structuredContent ? JSON.stringify(out.structuredContent) : "{}");

/** The resolved identity the producer actually attaches, verbatim. */
const RESOLVED_ETH = {
  venue: "BINANCE",
  symbol: "ETHUSDT",
  assetClass: "crypto",
  resolvedAt: "2026-09-04T07:19:32.855633Z",
  quoteCurrency: "USDT",
  identityVersion: 1,
  resolutionBasis: "venue_asset_list",
  resolutionState: "resolved",
  canonicalInstrumentId: "binance:crypto:ETH-USDT",
};

/** ETHUSDT: identity one level down, under `details`. */
const nestedAtDetails = () => ({
  signals: [
    {
      id: "44703044",
      symbol: "ETHUSDT",
      alertType: "correlation_breakdown",
      engine: "correlation",
      confidence: 33,
      severity: "high",
      details: {
        score: 3.333,
        claim_tier: "detector",
        data_state: "measured",
        engine_key: "correlation",
        instrumentIdentity: RESOLVED_ETH,
      },
    },
  ],
  status: "ACTIVE",
  dataState: "measured",
});

/** The anomaly rows: identity TWO levels down, under `details._raw`. */
const nestedAtRaw = () => ({
  signals: [
    {
      id: "44703043",
      symbol: "TOWNSUSDC",
      alertType: "multi_indicator_confluence",
      engine: "anomaly",
      confidence: 90,
      severity: "high",
      details: {
        _raw: {
          score: 9,
          engine_key: "risk_intelligence_measured",
          instrumentIdentity: {
            venue: "BINANCE",
            symbol: "TOWNSUSDC",
            assetClass: "crypto",
            quoteCurrency: "USDC",
            identityVersion: 1,
            resolutionBasis: "venue_asset_list",
            resolutionState: "resolved",
            canonicalInstrumentId: "binance:crypto:TOWNS-USDC",
          },
        },
      },
    },
  ],
  status: "ACTIVE",
  dataState: "measured",
});

const instrumentsOf = (payload: unknown): any[] =>
  read(decorateForAgent("fahali_get_realtime_alerts", wrap(payload))).instruments ?? [];

describe("5. IDENTITY — a resolved identity must survive wherever the producer nested it", () => {
  test("identity at `details.instrumentIdentity` resolves, with no ambiguity warning", () => {
    const eth = instrumentsOf(nestedAtDetails()).find((i) => i.symbol === "ETHUSDT");
    assert.ok(eth, "ETHUSDT must appear in instruments[]");
    assert.equal(eth.resolutionState, "resolved");
    assert.equal(eth.canonicalInstrumentId, "binance:crypto:ETH-USDT");
    assert.equal(eth.venue, "BINANCE");
    assert.equal(eth.resolutionBasis, "venue_asset_list");
    // The user-visible harm: a warning telling an agent to distrust an identity
    // the producer resolved against a venue asset list.
    assert.equal(eth.ambiguityWarning, null);
  });

  test("identity at `details._raw.instrumentIdentity` resolves too", () => {
    const towns = instrumentsOf(nestedAtRaw()).find((i) => i.symbol === "TOWNSUSDC");
    assert.ok(towns);
    assert.equal(towns.resolutionState, "resolved");
    assert.equal(towns.canonicalInstrumentId, "binance:crypto:TOWNS-USDC");
    assert.equal(towns.ambiguityWarning, null);
  });

  test("a deep RESOLVED identity outranks a shallow partial one", () => {
    // First-match-wins would take the shallow `partial` and republish the very
    // downgrade this fix exists to remove.
    const payload = {
      signals: [
        {
          symbol: "ETHUSDT",
          instrumentIdentity: { symbol: "ETHUSDT", resolutionState: "partial" },
          details: { instrumentIdentity: RESOLVED_ETH },
        },
      ],
      dataState: "measured",
    };
    const eth = instrumentsOf(payload).find((i) => i.symbol === "ETHUSDT");
    assert.equal(eth.resolutionState, "resolved");
    assert.equal(eth.canonicalInstrumentId, "binance:crypto:ETH-USDT");
  });

  test("a nested identity for a DIFFERENT instrument is rejected, not adopted", () => {
    // Attaching another instrument's identity is worse than attaching none —
    // it is the exact contamination the identity contract exists to prevent.
    const payload = {
      signals: [{ symbol: "SOLUSDT", details: { instrumentIdentity: RESOLVED_ETH } }],
      dataState: "measured",
    };
    const sol = instrumentsOf(payload).find((i) => i.symbol === "SOLUSDT");
    assert.ok(sol);
    assert.notEqual(sol.canonicalInstrumentId, "binance:crypto:ETH-USDT");
    assert.notEqual(sol.venue, "BINANCE");
  });

  test("NEGATIVE CONTROL — a bare ticker with no identity anywhere stays unresolved", () => {
    // The fix must not make everything look resolved. A row that genuinely
    // carries no identity must still earn its warning.
    const payload = { signals: [{ symbol: "BEAM", alertType: "momentum_shift" }], dataState: "measured" };
    const beam = instrumentsOf(payload).find((i) => i.symbol === "BEAM");
    assert.ok(beam);
    assert.notEqual(beam.resolutionState, "resolved");
    assert.ok(beam.ambiguityWarning, "an unresolved bare ticker must still carry its warning");
  });
});

describe("6. HEADINGS — the briefing's own labels must derive from the payload", () => {
  const briefing = (tool: string, payload: unknown, args: Record<string, unknown> = {}): string =>
    read(decorateForAgent(tool, wrap(payload), responseOptions(args))).agentBriefing ?? "";

  test("detector rows with no matched record are NOT called verified", () => {
    const md = briefing("fahali_get_realtime_alerts", {
      ...nestedAtDetails(),
      matchedTrackRecord: null,
      recordMatchReason: "No stratum yet clears the headline floor.",
    });
    assert.doesNotMatch(
      md,
      /Hard Evidence \(Verified\)/,
      "raw detector output must never be headed 'Verified'",
    );
    assert.match(md, /## Evidence \(detector output — observed, NOT judged\)/);
  });

  test("the heading names the judged record when one actually matched", () => {
    const md = briefing("fahali_get_realtime_alerts", {
      ...nestedAtDetails(),
      matchedTrackRecord: { engine_key: "correlation", publishable: false },
    });
    assert.match(md, /## Evidence \(a judged record matched/);
  });

  test("a projection's omitted rows appear as a blind spot", () => {
    // The envelope RECOMPUTES responseControl, so the truncation has to be
    // driven the way production drives it — with a real limit over real rows.
    const many = {
      signals: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        symbol: `SYM${i}USDT`,
        alertType: "momentum_shift",
        severity: "high",
        details: { claim_tier: "detector" },
      })),
      status: "ACTIVE",
      dataState: "measured",
    };
    // NB: the briefing is only emitted at `audit` detail (the default). Asking
    // for `standard` returns an empty string and every assertion below would
    // vacuously "pass" a match against nothing.
    const md = briefing("fahali_get_realtime_alerts", many, { limit: 2 });
    assert.match(md, /PROJECTION/);
    assert.match(md, /10 signals/, "the omitted count must be named, not implied");
    assert.doesNotMatch(
      md,
      /That means nothing was flagged as missing/,
      "10 omitted rows is something flagged as missing",
    );
  });

  test("source-side truncation is called out as worse than a projection", () => {
    const md = briefing("fahali_get_realtime_alerts", {
      ...nestedAtDetails(),
      coverage: { sourceTruncated: true, matched: { alerts: 342015 }, returned: { alerts: 200 } },
    });
    assert.match(md, /SOURCE-SIDE TRUNCATION/);
    assert.match(md, /342015 rows match this filter and 200 were read/);
  });

  test("symbols requested but not returned are named", () => {
    // Transcribed from the live call that found this: AMD and COIN are outside
    // the snapshot's 8-name equity source, so they come back unanswered.
    const md = briefing(
      "fahali_get_market_snapshot",
      { assets: [{ symbol: "SOLUSDT", price: 103.71, change: 3.02 }], indices: [], dataState: "measured" },
      { symbols: "AMD,COIN,SOLUSDT" },
    );
    assert.match(md, /Requested but NOT returned:/);
    assert.match(md, /AMD/);
    assert.match(md, /COIN/);
  });

  test("NEGATIVE CONTROL — a payload with nothing missing keeps the fallback line", () => {
    // If every payload produced a blind spot the section would be noise and the
    // guards above would prove nothing. This is why `evidenceQuality.reason`
    // and `freshnessNormalized.reason` are NOT lifted into the section: both
    // fire on almost every payload, and two unconditional bullets above the
    // conditional ones is how a section becomes unreadable.
    const md = briefing("fahali_get_realtime_alerts", nestedAtDetails());
    assert.match(md, /That means nothing was flagged as missing/);
  });
});
