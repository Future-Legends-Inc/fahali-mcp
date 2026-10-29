import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { decorateForAgent } from "./agentPayload.js";
import { assertNotBinding, assertReadingSurvives } from "./assertNotBinding.js";

const HOUR = 3_600;
const TEST_NOW_MS = Date.now();
const TEST_AS_OF = new Date(TEST_NOW_MS - 5 * 60_000).toISOString();
const TEST_SOURCE_ISSUED = new Date(TEST_NOW_MS - HOUR * 1_000).toISOString();
const TEST_SOURCE_EXPIRES = new Date(TEST_NOW_MS + 71 * HOUR * 1_000).toISOString();
const TEST_MEASURED_ON = new Date(TEST_NOW_MS - 5 * 60_000).toISOString();
const TEST_OLDER_MEASURED_ON = new Date(TEST_NOW_MS - 60 * 60_000).toISOString();

const TEST_VENUE_ALIASES: Record<string, string> = {
  NYSEARCA: "ARCA",
  "NYSE ARCA": "ARCA",
  ARCA: "ARCA",
  NASDAQGS: "NASDAQ",
  NASDAQGM: "NASDAQ",
  NASDAQCM: "NASDAQ",
  "NASDAQ GLOBAL SELECT": "NASDAQ",
  "NASDAQ GLOBAL MARKET": "NASDAQ",
  "NASDAQ CAPITAL MARKET": "NASDAQ",
  NYSEMKT: "AMEX",
  "NYSE MKT": "AMEX",
};

function testIdentityHash(identity: Record<string, unknown>): string {
  const venueInput = String(identity.venue ?? "").trim().toUpperCase().replace(/_/g, " ");
  const venue = TEST_VENUE_ALIASES[venueInput] ?? venueInput;
  const fields = [
    "fahali.instrument-identity/v1",
    identity.canonicalInstrumentId ?? "",
    identity.symbol ?? "",
    venue,
    identity.assetClass ?? "",
    identity.quoteCurrency ?? "",
    identity.resolutionState ?? "",
    identity.resolutionBasis ?? "",
    String(identity.identityVersion ?? ""),
    identity.resolvedAt ?? "",
  ];
  return createHash("sha256").update(fields.join("\x1f"), "utf8").digest("hex");
}

const publishedCanonical = (overrides: Record<string, unknown> = {}) => ({
  engine: "canonical_verdict",
  state: "published",
  quotable: true,
  horizonTier: "12h",
  barRegime: "crypto",
  precisionPct: 64,
  baseRatePct: 49,
  effectiveSample: 320,
  measuredOn: TEST_MEASURED_ON,
  claimFamily: "directional",
  identityPopulation: "verified_only",
  ...overrides,
});

const resolvedIdentity = (overrides: Record<string, unknown> = {}) => ({
  symbol: "BTCUSDT",
  canonicalInstrumentId: "binance:crypto:BTC-USDT",
  canonicalId: "binance:crypto:BTC-USDT",
  assetClass: "crypto",
  venue: "BINANCE",
  quoteCurrency: "USDT",
  resolutionState: "resolved",
  resolutionBasis: "venue_asset_list",
  identityVersion: 1,
  resolvedAt: "2026-08-31T11:50:00.000Z",
  ...overrides,
});

const IDENTITY_HASH = testIdentityHash(resolvedIdentity());

const validCanonicalRequiredSources = () => ({
  complete: true,
  authorityEligible: true,
  sources: [{
    sourceId: "forecast-btc-1",
    producer: "forecast_72h",
    instrumentIdentityStatus: "verified",
    instrumentIdentity: resolvedIdentity(),
    capturedIdentityHash: IDENTITY_HASH,
    generatedAt: TEST_SOURCE_ISSUED,
    expiresAt: TEST_SOURCE_EXPIRES,
    stale: false,
    responseState: "MEASURED",
    authorityEligible: true,
  }],
});

const validCanonicalForecast = () => ({
  issuedAt: TEST_SOURCE_ISSUED,
  expiresAt: TEST_SOURCE_EXPIRES,
  instrumentIdentity: resolvedIdentity(),
  sourceIdentityHash: IDENTITY_HASH,
  identityIntegrity: { state: "verified" },
  validity: {
    valid: true,
    issuedAt: TEST_SOURCE_ISSUED,
    expiresAt: TEST_SOURCE_EXPIRES,
    basis: "producer_issued_at_plus_horizon",
  },
});

function bindingPayload(overrides: {
  ageSeconds?: number | null;
  horizon?: string | null;
  status?: string;
  dataState?: string;
  identity?: Record<string, unknown>;
  producerRecord?: unknown;
  integrity?: Record<string, unknown>;
  conflict?: boolean;
  extra?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const age = overrides.ageSeconds === undefined ? 2 * HOUR : overrides.ageSeconds;
  const horizon = overrides.horizon === undefined ? "12h" : overrides.horizon;
  const rowIdentity = overrides.identity ?? resolvedIdentity();
  const verdict: Record<string, unknown> = {
    direction: "DOWNSIDE_SKEW",
    actionability: "ACTIONABLE",
    confidence: 0.99,
    bindingConfidenceProducer: "canonical_verdict",
    expectedMovePct: -4,
  };
  if (horizon !== null) verdict.forecastHorizon = horizon;
  const row: Record<string, unknown> = {
    symbol: "BTCUSDT",
    instrumentIdentity: rowIdentity,
    sourceIdentityHash: testIdentityHash(rowIdentity),
    canonical: {
      state: "WATCH",
      direction: "DOWNSIDE_SKEW",
      headline: "Immediate downside call",
      conflict: overrides.conflict === true,
      forecast: validCanonicalForecast(),
      requiredSourceState: validCanonicalRequiredSources(),
    },
    verdict,
    provenance: { directionProducer: "canonical_verdict" },
  };
  if (age !== null) {
    row.dataAgeSeconds = age;
    row.staleAfterSeconds = 72 * HOUR;
  }
  const decision: Record<string, unknown> = {
    state: "WATCH",
    headline: "Immediate downside call",
    direction: "DOWNSIDE_SKEW",
    actionability: "ACTIONABLE",
    binding: true,
    bindingConfidenceProducer: "canonical_verdict",
    expectedMovePct: -4,
    conflict: overrides.conflict === true,
  };
  if (horizon !== null) decision.horizon = horizon;
  return {
    status: overrides.status ?? "ok",
    dataState: overrides.dataState ?? "measured",
    asOf: TEST_AS_OF,
    instruments: [rowIdentity],
    producerRecord: overrides.producerRecord ?? publishedCanonical(),
    decision,
    data: [row],
    ...(overrides.integrity ? { integrity: overrides.integrity } : {}),
    ...(overrides.extra ?? {}),
  };
}

function decorate(
  data: Record<string, unknown>,
  tool = "fahali_get_market_decision",
  options: Record<string, unknown> = { detail: "audit" },
) {
  return decorateForAgent(tool, { structuredContent: data, content: [] } as any, options as any)
    .structuredContent as Record<string, any>;
}

function portfolioPayload(overrides: {
  action?: string;
  responseAsOf?: string;
  decisionAsOf?: string;
  decisionExpiresAt?: string | null;
  evidenceAsOf?: string | null;
  evidenceState?: string;
  identity?: Record<string, unknown>;
  positionIdentity?: Record<string, unknown> | null;
  positionIdentityHash?: string | null;
  evidenceIdentityHash?: string | null;
  canReduce?: boolean;
  positionIntegrity?: Record<string, unknown>;
  immutable?: boolean;
} = {}): Record<string, unknown> {
  const action = overrides.action ?? "REDUCE";
  const decisionAsOf = overrides.decisionAsOf ?? new Date(Date.now() - 5 * 60_000).toISOString();
  const evidenceAsOf = overrides.evidenceAsOf === undefined
    ? new Date(Date.now() - 10 * 60_000).toISOString()
    : overrides.evidenceAsOf;
  const evidenceIdentity = overrides.identity ?? resolvedIdentity();
  const positionIdentity = overrides.positionIdentity === undefined
    ? evidenceIdentity
    : overrides.positionIdentity;
  const positionIdentityHash = overrides.positionIdentityHash === undefined
    ? IDENTITY_HASH
    : overrides.positionIdentityHash;
  const evidenceIdentityHash = overrides.evidenceIdentityHash === undefined
    ? IDENTITY_HASH
    : overrides.evidenceIdentityHash;
  const decision = {
      schemaVersion: "2.0",
      watchId: "4bb0a083-810c-43de-a873-2ee211896ab8",
      asOf: decisionAsOf,
      ...(overrides.decisionExpiresAt !== undefined
        ? { expiresAt: overrides.decisionExpiresAt }
        : {}),
      state: "ACTIVE",
      action,
      headline: "BTC risk exceeded the mandate limit",
      whatToDo: "Reduce BTC exposure within the mandate.",
      positions: [{
        symbol: "BTCUSDT",
        action,
        actionBasis: "directional",
        direction: "bearish",
        evidenceAsOf,
        evidenceRef: "event-1",
        instrumentIdentity: positionIdentity,
        sourceIdentityHash: positionIdentityHash,
        ...(overrides.positionIntegrity ? { integrity: overrides.positionIntegrity } : {}),
      }],
      evidenceQuality: {
        dataState: overrides.evidenceState ?? "measured",
        measuredPositions: 1,
        stalePositions: 0,
        noReadPositions: 0,
        totalPositions: 1,
        coveragePct: 100,
      },
      mandateAssessment: {
        applied: [
          { constraint: "horizon", value: "12h", effect: "Decision horizon." },
          { constraint: "canReduce", value: overrides.canReduce ?? true, effect: "Reduction permission." },
        ],
        unmeasured: [],
      },
      mandate: {
        horizon: "12h",
        canReduce: overrides.canReduce ?? true,
        canExit: false,
        exitOnCritical: false,
      },
      thresholds: { staleAfterMinutes: 30 },
      provenance: { methodologyVersion: "watch-v1", evidenceEventIds: ["event-1"] },
  };
  return {
    status: "ok",
    dataState: overrides.evidenceState ?? "measured",
    ...(overrides.responseAsOf ? { asOf: overrides.responseAsOf } : {}),
    ...(overrides.immutable ? { immutable: true } : {}),
    verdict: {
      id: "30fdd5e8-5067-4a73-bfae-ae4049065e32",
      userId: "a09df8bf-ab21-4b06-90c9-2efcb8bcd820",
      watchId: "4bb0a083-810c-43de-a873-2ee211896ab8",
      dataAsOf: evidenceAsOf,
      decision,
      delta: {},
      decisionHash: "decision-hash",
      evidenceHash: "evidence-hash",
      evidenceSnapshot: {
        schemaVersion: "fahali.verdict-evidence/v2",
        capturedAt: evidenceAsOf,
        sources: [{
          evidenceId: "event-1",
          symbol: "BTCUSDT",
          canonicalSymbol: "BTCUSDT",
          instrumentIdentity: evidenceIdentity,
          sourceIdentityHash: evidenceIdentityHash,
          createdAt: evidenceAsOf,
        }],
      },
      contentHash: "content-hash",
      methodologyVersion: "watch-v1",
      createdAt: decisionAsOf,
    },
  };
}

test("expired selected claim loses binding authority while raw evidence remains auditable", () => {
  const sc = decorate(bindingPayload({ ageSeconds: 67 * HOUR }));

  assert.equal(sc.freshnessNormalized.stale, false, "the source can be fresh enough to serve while the claim is expired");
  assert.equal(sc.claimValidity.expired, true);
  assert.equal(sc.decisionEligibility.status, "WITHHELD");
  assert.ok(sc.decisionEligibility.reasons.some((entry: any) => entry.code === "CLAIM_EXPIRED"));
  assert.equal(sc.responseState, "WITHHELD");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.actionability, "ABSTAIN");
  assert.equal(sc.decision.expectedMovePct, null);
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.sourceDecision.direction, "DOWNSIDE_SKEW", "the original claim must remain available for audit");
  assert.equal(sc.data[0].verdict.expectedMovePct, -4, "raw evidence was deleted instead of de-promoted");
  assert.doesNotMatch(sc.agentBriefing, /Immediate downside call/);
  assert.doesNotMatch(sc.agentBriefing, /expected move -4/i);
  /*
    The briefing must say BOTH things, and the delivered half must come FIRST.

    This assertion used to be `match(/Binding decision withheld/)` — one phrase,
    and the phrase happened to be the ONLY thing the briefing said. Measured
    across 127 live envelopes on 2026-09-05, five tools declared a refusal state
    while carrying 283 rows of measured data between them; the briefing named
    none of it, because the withheld branch returned immediately. An agent read
    "withheld" and reported that it had received nothing.

    So the wording changed and this assertion got STRONGER rather than being
    relaxed to fit: it now pins the refusal AND the delivery AND their order.
  */
  const deliveredAt = sc.agentBriefing.indexOf("DELIVERED data");
  const withheldAt = sc.agentBriefing.indexOf("No binding directional call");
  assert.ok(deliveredAt >= 0, "the briefing must name the evidence this response did return");
  assert.ok(withheldAt >= 0, "and must still refuse the binding call");
  assert.ok(deliveredAt < withheldAt, "the data must be reported BEFORE the withholding, never after");
  assert.match(sc.agentBriefing, /CLAIM_EXPIRED/, "the reason stays quotable in the briefing");
});

test("the exact horizon boundary is expired, not one last actionable second", () => {
  const sc = decorate(bindingPayload({ ageSeconds: 12 * HOUR, horizon: "12h" }));

  assert.equal(sc.claimValidity.known, true);
  assert.equal(sc.claimValidity.expired, true);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some((entry: any) => entry.code === "CLAIM_EXPIRED"));
  assertNotBinding(sc.decision);
});

test("a future-dated selected-claim age is unknown authority, never fresh authority", () => {
  const sc = decorate(bindingPayload({ ageSeconds: -1, horizon: "12h" }));

  assert.equal(sc.claimValidity.known, false);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some((entry: any) => entry.code === "VALIDITY_UNKNOWN"));
  assertNotBinding(sc.decision);
});

test("withheld normalized decisions scrub every current instruction and CTA", () => {
  const payload = bindingPayload({ ageSeconds: 67 * HOUR });
  Object.assign(payload.decision as Record<string, unknown>, {
    whatToDo: "Sell the position now.",
    actionPlan: ["Place the order."],
    actionOptions: [{ label: "Execute" }],
    CTA: "Trade now",
  });
  const sc = decorate(payload);

  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.decision.whatToDo, undefined);
  assert.equal(sc.decision.actionPlan, undefined);
  assert.equal(sc.decision.actionOptions, undefined);
  assert.equal(sc.decision.CTA, undefined);
  assert.doesNotMatch(JSON.stringify(sc.decision), /Sell the position|Place the order|Execute|Trade now/);
  assert.equal(sc.sourceDecision.whatToDo, "Sell the position now.");
  assert.deepEqual(sc.sourceDecision.actionPlan, ["Place the order."]);
  assert.equal(sc.sourceDecision.CTA, "Trade now");
  assert.deepEqual(sc.decision.instructionAudit.removedFields, [], "top-level instructions were never merged into the selected decision");
});

test("unknown selected-claim age or horizon is not treated as valid", () => {
  for (const payload of [
    bindingPayload({ ageSeconds: null }),
    bindingPayload({ horizon: null }),
  ]) {
    const sc = decorate(payload);
    assert.equal(sc.claimValidity.known, false);
    assert.equal(sc.decisionEligibility.status, "WITHHELD");
    assert.ok(sc.decisionEligibility.reasons.some((entry: any) => entry.code === "VALIDITY_UNKNOWN"));
    assert.equal(sc.decision.actionability, "ABSTAIN");
    assertNotBinding(sc.decision);
  }
});

test("fresh exact canonical claim clears every gate — negative control for an always-withhold policy", () => {
  const sc = decorate(bindingPayload());

  assert.equal(sc.claimValidity.expired, false);
  assert.equal(sc.decisionEligibility.status, "ELIGIBLE");
  assert.equal(sc.decisionEligibility.producerEligibility.status, "published_exact_match");
  assert.equal(sc.responseState, "OK_WITH_FINDINGS");
  assert.equal(sc.decision.direction, "DOWNSIDE_SKEW");
  assert.equal(sc.decision.actionability, "ACTIONABLE");
  assert.equal(sc.decision.binding, true);
  assert.match(sc.agentBriefing, /Immediate downside call/);
});

test("a typo in required-source state cannot pass the canonical MEASURED allowlist", () => {
  const payload = bindingPayload();
  const source = (payload.data as Record<string, any>[])[0]
    .canonical.requiredSourceState.sources[0];
  source.responseState = "BANANA";

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_STATE_INVALID",
  ));
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.binding, false);
});

test("a top-level direction cannot overwrite the selected row's binding direction", () => {
  const payload = bindingPayload();
  Object.assign(payload.decision as Record<string, unknown>, {
    symbol: "BTCUSDT",
    direction: "BULLISH",
    expectedMovePct: 9,
    conflict: false,
  });

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "ELIGIBLE");
  assert.equal(sc.decision.symbol, "BTCUSDT");
  assert.equal(sc.decision.direction, "DOWNSIDE_SKEW");
  assert.equal(sc.decision.expectedMovePct, undefined);
  assert.equal(sc.decision.binding, true);
  assert.equal(sc.sourceDecision.direction, "BULLISH", "the conflicting top-level object remains audit-only");
  assert.equal(sc.data[0].canonical.direction, "DOWNSIDE_SKEW");
});

test("a top-level conflict=false cannot erase the selected row's unresolved conflict", () => {
  const payload = bindingPayload();
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.conflict = true;
  Object.assign(payload.decision as Record<string, unknown>, {
    direction: "BULLISH",
    conflict: false,
  });

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "CANONICAL_CONFLICT_UNRESOLVED",
  ));
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.sourceDecision.conflict, false);
  assert.equal(sc.data[0].canonical.conflict, true);
});

test("top-level symbol and identity cannot replace the selected row's immutable claim", () => {
  const nvdaIdentity = resolvedIdentity({
    symbol: "NVDA",
    canonicalInstrumentId: "nasdaq:equity:NVDA",
    canonicalId: "nasdaq:equity:NVDA",
    assetClass: "equity",
    venue: "NASDAQ",
    quoteCurrency: "USD",
    resolutionBasis: "provider_asset_registry",
  });
  const nvdaHash = testIdentityHash(nvdaIdentity);
  const payload = bindingPayload({
    identity: nvdaIdentity,
    producerRecord: publishedCanonical({ barRegime: "equity" }),
  });
  const row = (payload.data as Record<string, any>[])[0];
  row.symbol = "NVDA";
  row.instrumentIdentity = nvdaIdentity;
  row.sourceIdentityHash = nvdaHash;
  row.canonical.requiredSourceState = {
    ...validCanonicalRequiredSources(),
    sources: [{
      ...validCanonicalRequiredSources().sources[0],
      sourceId: "forecast-nvda-1",
      instrumentIdentity: nvdaIdentity,
      capturedIdentityHash: nvdaHash,
    }],
  };
  row.canonical.forecast = {
    ...validCanonicalForecast(),
    instrumentIdentity: nvdaIdentity,
    sourceIdentityHash: nvdaHash,
  };
  Object.assign(payload.decision as Record<string, unknown>, {
    symbol: "BTCUSDT",
    instrumentIdentity: resolvedIdentity(),
    sourceIdentityHash: IDENTITY_HASH,
    direction: "BULLISH",
    conflict: false,
  });

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "ELIGIBLE");
  assert.equal(sc.directionEligibility.selectedSymbol, "NVDA");
  assert.equal(sc.decision.symbol, "NVDA");
  assert.equal(sc.decision.instrumentIdentity.canonicalInstrumentId, "nasdaq:equity:NVDA");
  assert.equal(sc.decision.sourceIdentityHash, nvdaHash);
  assert.equal(sc.decision.direction, "DOWNSIDE_SKEW");
  assert.equal(sc.sourceDecision.symbol, "BTCUSDT");
  assert.equal(sc.sourceDecision.instrumentIdentity.canonicalInstrumentId, "binance:crypto:BTC-USDT");
});

test("a resolved top-level identity cannot replace a missing or unhashed selected-row capture", () => {
  for (const mutation of ["missing_identity", "missing_hash", "tampered_hash"] as const) {
    const payload = bindingPayload();
    const row = (payload.data as Record<string, any>[])[0];
    if (mutation === "missing_identity") delete row.instrumentIdentity;
    if (mutation === "missing_hash") delete row.sourceIdentityHash;
    if (mutation === "tampered_hash") row.sourceIdentityHash = "b".repeat(64);

    const sc = decorate(payload);
    assert.equal(sc.directionEligibility.status, "WITHHELD", mutation);
    assert.ok(sc.directionEligibility.reasons.some(
      (entry: any) => entry.code === "IDENTITY_INVALID",
    ), mutation);
    assertNotBinding(sc.decision, mutation);
  }
});

test("selected execution identity rejects noncanonical casing and timezone-less capture time", () => {
  const mutations: Array<[string, Record<string, unknown>]> = [
    ["symbol casing", { symbol: "btcusdt" }],
    ["quote casing", { quoteCurrency: "usdt" }],
    ["asset-class casing", { assetClass: "Crypto" }],
    ["timezone-less resolvedAt", { resolvedAt: "2026-08-31T11:50:00.000" }],
  ];
  for (const [label, mutation] of mutations) {
    const payload = bindingPayload();
    const row = (payload.data as Record<string, any>[])[0];
    const invalidIdentity = { ...resolvedIdentity(), ...mutation };
    row.instrumentIdentity = invalidIdentity;
    row.sourceIdentityHash = testIdentityHash(invalidIdentity);

    const sc = decorate(payload);
    assert.equal(sc.directionEligibility.status, "WITHHELD", label);
    assert.ok(sc.directionEligibility.reasons.some(
      (entry: any) => entry.code === "IDENTITY_INVALID",
    ), label);
    assertNotBinding(sc.decision, label);
  }
});

test("live snake_case engine-status PARTIAL survives normalization and briefing", () => {
  const sc = decorate({
    status: "PARTIAL",
    responseState: "PARTIAL",
    dataState: "measured",
    engines: [{ engine: "canonical_verdict", state: "fresh" }],
    probe_errors: [
      { source: "alert_publication_window", code: "57014" },
      { source: "spectra_signal_outcomes", code: "57014" },
    ],
    publication_window_complete: false,
    judgment_window_complete: false,
    alerts_7d_total: 0,
  }, "fahali_get_engine_status");

  assert.equal(sc.responseState, "PARTIAL");
  assert.equal(sc.dataState, "partial");
  assert.equal(sc.evidenceQuality.dataState, "partial");
  assert.equal(sc.sourceDataState, "measured");
  assert.match(sc.absence.reason, /alert_publication_window/);
  assert.match(sc.absence.reason, /spectra_signal_outcomes/);
  assert.match(sc.agentBriefing, /PARTIAL/);
  assert.match(sc.agentBriefing, /publication window incomplete/);
  assert.doesNotMatch(sc.agentBriefing, /1 measured reading returned/i);
});

test("source PARTIAL revokes a binding action without erasing its observations", () => {
  const sc = decorate(bindingPayload({
    status: "PARTIAL",
    extra: {
      responseState: "PARTIAL",
      probe_errors: [{ source: "canonical_inputs", code: "57014" }],
      judgment_window_complete: false,
    },
  }));

  assert.equal(sc.responseState, "PARTIAL", "the MCP must preserve the source's partial state");
  assert.equal(sc.dataState, "partial");
  assert.equal(sc.decisionEligibility.status, "WITHHELD");
  assert.ok(sc.decisionEligibility.reasons.some((entry: any) => entry.code === "SOURCE_PARTIAL"));
  assert.equal(sc.decision.actionability, "ABSTAIN");
  assertNotBinding(sc.decision);
  assert.equal(sc.data[0].verdict.direction, "DOWNSIDE_SKEW");
  assert.match(sc.agentBriefing, /PARTIAL/);
  assert.match(sc.agentBriefing, /canonical_inputs/);
});

test("failed probes and incomplete windows revoke authority even when source status incorrectly says ok", () => {
  for (const extra of [
    { publicationWindowComplete: false },
    { judgment_window_complete: false },
    { probeErrors: [{ source: "spectra_signal_outcomes", code: "57014" }] },
  ]) {
    const sc = decorate(bindingPayload({ extra }));
    assert.equal(sc.responseState, "PARTIAL", JSON.stringify(extra));
    assert.equal(sc.directionEligibility.status, "WITHHELD", JSON.stringify(extra));
    assert.ok(sc.directionEligibility.reasons.some(
      (entry: any) => entry.code === "SOURCE_PARTIAL",
    ), JSON.stringify(extra));
    assertNotBinding(sc.decision, JSON.stringify(extra));
    assert.ok(sc.nextActions.every((entry: any) => [
      "fahali_get_lead_time",
      "fahali_get_track_record_scorecard",
      "fahali_resolve_instrument",
      "fahali_get_engine_status",
      "fahali_get_evidence",
      "fahali_get_verdict_by_id",
      "fahali_get_verdict_history",
    ].includes(entry.tool)), JSON.stringify(sc.nextActions));
  }
});

test("stale source, unresolved identity, and failed integrity each independently revoke authority", () => {
  const cases = [
    [bindingPayload({ extra: { stale: true } }), "SOURCE_STALE"],
    [bindingPayload({ identity: resolvedIdentity({ resolutionState: "ambiguous", canonicalInstrumentId: null, canonicalId: null }) }), "IDENTITY_INVALID"],
    [bindingPayload({ integrity: { evidenceHashVerified: false } }), "EVIDENCE_INTEGRITY_INVALID"],
  ] as const;
  for (const [payload, code] of cases) {
    const sc = decorate(payload);
    assert.equal(sc.decisionEligibility.status, "WITHHELD", code);
    assert.ok(sc.decisionEligibility.reasons.some((entry: any) => entry.code === code), code);
    assert.equal(sc.decision.actionability, "ABSTAIN", code);
    assertNotBinding(sc.decision, code);
  }
});

test("below-base canonical stays non-binding at high confidence and committee cannot replace it", () => {
  const sc = decorate(bindingPayload({
    producerRecord: [
      publishedCanonical({ precisionPct: 46, baseRatePct: 49 }),
      {
        engine: "committee_verdict",
        state: "published",
        quotable: true,
        horizonTier: "12h",
        barRegime: "crypto",
        precisionPct: 70,
        baseRatePct: 49,
        effectiveSample: 1_000,
        measuredOn: "2026-08-31",
      },
    ],
  }));

  assert.equal(sc.sourceDecision.actionability, "ACTIONABLE");
  assert.equal(sc.decisionEligibility.producerEligibility.status, "below_gate");
  assert.ok(sc.decisionEligibility.reasons.some((entry: any) => entry.code === "CANONICAL_PERFORMANCE_INELIGIBLE"));
  assert.equal(sc.decision.actionability, "ABSTAIN");
  assertNotBinding(sc.decision);
});

test("the COMMITTEE can bind when it names itself and holds its own matching record", () => {
  /**
   * THE POSITIVE CONTROL for BINDING_AUTHORITIES (founder decision 2026-09-08:
   * "engines can recommend, but final verdict is assessed by this committee").
   *
   * Without this test the widening has only negative coverage — every existing
   * assertion proves the committee still CANNOT bind, which a no-op change
   * would also satisfy. That is the "a guard that copies the implementation
   * cannot falsify it" trap, and it is why this pairs with the below-base test
   * above rather than replacing it.
   */
  const payload = bindingPayload({
    producerRecord: [
      publishedCanonical({ precisionPct: 46, baseRatePct: 49 }), // canonical is BELOW base
      publishedCanonical({ engine: "committee_verdict", precisionPct: 70, effectiveSample: 1_000 }),
    ],
  });
  const row = (payload.data as Record<string, any>[])[0];
  row.provenance = { directionProducer: "committee_verdict" };
  row.verdict.bindingConfidenceProducer = "committee_verdict";

  const sc = decorate(payload);
  assert.equal(sc.decisionEligibility.bindingAuthority, "committee_verdict", "the payload names WHICH producer bound");
  assert.equal(sc.decisionEligibility.producerEligibility.status, "published_exact_match");
  assert.equal(sc.decisionEligibility.producerEligibility.engine, "committee_verdict");
  assert.equal(sc.decisionEligibility.status, "ELIGIBLE");
  assert.equal(sc.decision.binding, true, "a committee call with its own record BINDS");
  // 🔴 AND THE CANONICAL DEFICIT DID NOT LEAK IN. The canonical record here is
  // below base (46 vs 49); if the record lookup had stayed hardcoded, this
  // would have been refused on ANOTHER producer's failing homework.
  assert.ok(
    !sc.decisionEligibility.reasons.some((entry: any) => entry.code === "CANONICAL_PERFORMANCE_INELIGIBLE"),
    "the bound producer's record decides, not whichever engine the lookup used to be pinned to",
  );
});

test("a named committee WITHOUT its own record still cannot bind", () => {
  // The other half of the boundary: widening WHO may bind must not weaken WHAT
  // binding requires. Same naming as the test above, but the committee brings
  // no record of its own — only canonical's, which is not a substitute.
  const payload = bindingPayload({ producerRecord: [publishedCanonical()] });
  const row = (payload.data as Record<string, any>[])[0];
  row.provenance = { directionProducer: "committee_verdict" };
  row.verdict.bindingConfidenceProducer = "committee_verdict";

  const sc = decorate(payload);
  assert.equal(sc.decisionEligibility.status, "WITHHELD");
  assert.equal(sc.decisionEligibility.producerEligibility.status, "unavailable");
  assert.match(
    String(sc.decisionEligibility.producerEligibility.reason),
    /committee_verdict producer record/,
    "the refusal names the producer that was actually asked for",
  );
  assertNotBinding(sc.decision);
});

test("a canonical evidence object cannot authorize an explicitly agent-produced direction", () => {
  const payload = bindingPayload();
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical = {};
  row.provenance = { directionProducer: "agent_verdict" };
  row.verdict.bindingConfidenceProducer = "agent_verdict";
  (payload.decision as Record<string, unknown>).bindingConfidenceProducer = "agent_verdict";

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "CANONICAL_AUTHORITY_ABSENT",
  ));
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.actionability, "ABSTAIN");
  assert.equal(sc.data[0].verdict.direction, "DOWNSIDE_SKEW", "agent evidence must remain auditable");
});

test("a published canonical record for a different horizon is not an exact match", () => {
  const sc = decorate(bindingPayload({ producerRecord: publishedCanonical({ horizonTier: "72h" }) }));
  assert.equal(sc.decisionEligibility.producerEligibility.status, "stratum_mismatch");
  assert.equal(sc.decisionEligibility.status, "WITHHELD");
  assert.equal(sc.decision.actionability, "ABSTAIN");
});

test("canonical authority requires a verified-only judged identity population", () => {
  for (const identityPopulation of [undefined, "legacy_references_only", "mixed", "quarantined"]) {
    const record = publishedCanonical();
    if (identityPopulation === undefined) delete (record as any).identityPopulation;
    else (record as any).identityPopulation = identityPopulation;
    const sc = decorate(bindingPayload({ producerRecord: record }));
    assert.equal(sc.directionEligibility.status, "WITHHELD", String(identityPopulation));
    assert.equal(sc.directionEligibility.producerEligibility.status, "identity_population_unverified");
    assertNotBinding(sc.decision);
    assert.equal(sc.decision.actionability, "ABSTAIN");
  }

  const verified = decorate(bindingPayload({
    producerRecord: publishedCanonical({ identityPopulation: "verified_only" }),
  }));
  assert.equal(verified.directionEligibility.status, "ELIGIBLE");
  assert.equal(verified.directionEligibility.producerEligibility.identityPopulation, "verified_only");
});

test("a canonical producer record missing claimFamily cannot authorize direction", () => {
  const record = publishedCanonical();
  delete (record as any).claimFamily;

  const sc = decorate(bindingPayload({ producerRecord: record }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "stratum_mismatch");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.binding, false);
});

test("row identityStatus cannot substitute for aggregate identityPopulation", () => {
  const record = publishedCanonical();
  delete (record as any).identityPopulation;
  (record as any).identityStatus = "verified";

  const sc = decorate(bindingPayload({ producerRecord: record }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "identity_population_unverified");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.binding, false);
});

test("an invalid canonical measurement timestamp cannot authorize a current decision", () => {
  const sc = decorate(bindingPayload({
    producerRecord: publishedCanonical({ measuredOn: "not-a-timestamp" }),
  }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "invalid_measurement_time");
  assertNotBinding(sc.decision);
});

test("a future-dated canonical measurement cannot authorize a current decision", () => {
  const sc = decorate(bindingPayload({
    producerRecord: publishedCanonical({
      measuredOn: new Date(Date.now() + HOUR * 1_000).toISOString(),
    }),
  }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "future_measurement");
  assertNotBinding(sc.decision);
});

test("a canonical measurement older than the 36-hour authority window cannot bind", () => {
  const sc = decorate(bindingPayload({
    producerRecord: publishedCanonical({
      measuredOn: new Date(Date.now() - 37 * HOUR * 1_000).toISOString(),
    }),
  }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "stale_measurement");
  assertNotBinding(sc.decision);
});

test("verified-only below-gate canonical is diagnosed as performance-withheld, not population-unknown", () => {
  const sc = decorate(bindingPayload({
    producerRecord: {
      engine: "canonical_verdict",
      state: "withheld",
      quotable: false,
      reasons: ["precision does not beat its own base rate"],
      strataMeasured: 1,
      horizonTier: "12h",
      barRegime: "crypto",
      claimFamily: "directional",
      identityPopulation: "verified_only",
      note: "Measured and withheld by the performance gate.",
    },
  }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "withheld");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "CANONICAL_PERFORMANCE_INELIGIBLE",
  ));
  assert.notEqual(sc.directionEligibility.producerEligibility.status, "identity_population_unverified");
});

test("multi-stratum canonical selection is exact and independent of candidate order", () => {
  const exact = publishedCanonical({ claimFamily: "directional", measuredOn: TEST_MEASURED_ON });
  const candidates = [
    publishedCanonical({ horizonTier: "72h", claimFamily: "directional", measuredOn: TEST_OLDER_MEASURED_ON }),
    publishedCanonical({ barRegime: "equity", claimFamily: "directional", measuredOn: TEST_MEASURED_ON }),
    publishedCanonical({ claimFamily: "magnitude", measuredOn: TEST_MEASURED_ON }),
    exact,
  ];
  for (const producerRecordCandidates of [candidates, [...candidates].reverse()]) {
    const sc = decorate(bindingPayload({
      producerRecord: candidates[0],
      extra: { producerRecordCandidates },
    }));
    assert.equal(sc.directionEligibility.status, "ELIGIBLE");
    assert.equal(sc.directionEligibility.producerEligibility.status, "published_exact_match");
    assert.equal(sc.directionEligibility.producerEligibility.horizonTier, "12h");
    assert.equal(sc.directionEligibility.producerEligibility.barRegime, "crypto");
    assert.equal(sc.directionEligibility.producerEligibility.claimFamily, "directional");
  }
});

test("contradictory duplicate rows for the newest exact canonical stratum fail closed independent of order", () => {
  const aboveBase = publishedCanonical({ precisionPct: 64, baseRatePct: 49 });
  const belowBase = publishedCanonical({ precisionPct: 40, baseRatePct: 49 });

  for (const candidates of [[aboveBase, belowBase], [belowBase, aboveBase]]) {
    const sc = decorate(bindingPayload({ extra: { producerRecordCandidates: candidates } }));
    assert.equal(sc.directionEligibility.status, "WITHHELD");
    assert.equal(sc.directionEligibility.producerEligibility.status, "ambiguous_exact_stratum");
    assertNotBinding(sc.decision);
  }
});

test("no exact canonical candidate fails closed instead of using another stratum", () => {
  const sc = decorate(bindingPayload({
    producerRecord: publishedCanonical(),
    extra: {
      producerRecordCandidates: [
        publishedCanonical({ horizonTier: "72h", claimFamily: "directional" }),
        publishedCanonical({ claimFamily: "magnitude" }),
        { ...publishedCanonical({ barRegime: "equity", claimFamily: "directional" }), engine: "canonical_verdict" },
      ],
    },
  }));
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(sc.directionEligibility.producerEligibility.status, "stratum_mismatch");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.actionability, "ABSTAIN");
});

test("aggregate response freshness cannot age a projected selected row when siblings exist", () => {
  const payload = bindingPayload({
    ageSeconds: null,
    extra: { dataAgeSeconds: 2 * HOUR, staleAfterSeconds: 72 * HOUR },
  });
  payload.data = [
    ...(payload.data as Record<string, unknown>[]),
    { symbol: "ETHUSDT", verdict: { direction: "neutral", actionability: "ABSTAIN", forecastHorizon: "72h" } },
  ];
  const sc = decorate(payload);
  assert.equal(sc.claimValidity.ageBasis, "unknown");
  assert.equal(sc.claimValidity.known, false);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some((entry: any) => entry.code === "VALIDITY_UNKNOWN"));
});

test("an explicit shared-capture contract permits response-level freshness for sibling claims", () => {
  const payload = bindingPayload({
    ageSeconds: null,
    extra: {
      dataAgeSeconds: 2 * HOUR,
      staleAfterSeconds: 72 * HOUR,
      freshness: { basis: "shared_capture" },
    },
  });
  payload.data = [
    ...(payload.data as Record<string, unknown>[]),
    { symbol: "ETHUSDT", verdict: { direction: "neutral", actionability: "ABSTAIN", forecastHorizon: "72h" } },
  ];
  const sc = decorate(payload);
  assert.equal(sc.claimValidity.ageBasis, "response_level");
  assert.equal(sc.claimValidity.known, true);
  assert.equal(sc.directionEligibility.status, "ELIGIBLE");
});

test("nested committee horizon cannot re-stratum the promoted canonical claim", () => {
  const payload = bindingPayload({
    ageSeconds: 25 * HOUR,
    horizon: "72h",
    producerRecord: publishedCanonical({ horizonTier: "72h" }),
  });
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical = {
    ...row.canonical,
    horizon: "72h",
    evidence: {
      committee: { horizon: "24h", producer: "committee_verdict" },
      forecast: { horizon: "24h", producer: "forecast_24h" },
    },
  };

  const sc = decorate(payload);
  assert.equal(sc.claimValidity.shortestHorizon, "72h");
  assert.equal(sc.claimValidity.shortestHorizonSeconds, 72 * HOUR);
  assert.equal(sc.claimValidity.expired, false);
  assert.equal(sc.directionEligibility.producerEligibility.horizonTier, "72h");
  assert.equal(sc.directionEligibility.status, "ELIGIBLE");
});

test("legacy agent horizon cannot re-stratum the canonical 72h binding claim", () => {
  const payload = bindingPayload({
    horizon: "7d",
    producerRecord: publishedCanonical({ horizonTier: "72h" }),
  });
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.horizon = "72h";

  const sc = decorate(payload);
  assert.equal(sc.claimValidity.shortestHorizonSeconds, 72 * HOUR);
  assert.equal(sc.directionEligibility.producerEligibility.horizonTier, "72h");
  assert.equal(sc.directionEligibility.status, "ELIGIBLE");
});

test("a fresh verdict event cannot authorize an expired required forecast", () => {
  const payload = bindingPayload({ ageSeconds: HOUR, horizon: "12h" });
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.forecast = {
    ...validCanonicalForecast(),
    issuedAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-08-31T06:00:00.000Z",
    validity: {
      valid: true, // even a contradictory source flag cannot override the clock
      issuedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2026-08-31T06:00:00.000Z",
      basis: "producer_issued_at_plus_6h",
    },
  };
  row.canonical.requiredSourceState = {
    ...validCanonicalRequiredSources(),
    sources: [{
      ...validCanonicalRequiredSources().sources[0],
      generatedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2026-08-31T06:00:00.000Z",
    }],
  };

  const sc = decorate(payload);
  assert.equal(sc.claimValidity.expired, false, "the selected 12h event itself remains current");
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_EXPIRED",
  ));
  assertNotBinding(sc.decision);
  assert.equal(sc.data[0].canonical.forecast.validity.valid, true, "raw contradictory evidence remains auditable");
});

test("canonical authority fails closed when required-source state is omitted", () => {
  const payload = bindingPayload();
  delete (payload.data as Record<string, any>[])[0].canonical.requiredSourceState;
  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_STATE_UNKNOWN",
  ));
  assertNotBinding(sc.decision);
});

test("an explicit canonical producer marker cannot authorize a missing canonical object", () => {
  const payload = bindingPayload();
  delete (payload.data as Record<string, any>[])[0].canonical;
  const sc = decorate(payload);

  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_STATE_UNKNOWN",
  ));
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.actionability, "ABSTAIN");
});

test("a cached payload cannot keep a required source eligible past retrieval-time expiry", () => {
  const now = Date.now();
  const payload = bindingPayload({
    extra: { asOf: new Date(now - 2 * HOUR * 1_000).toISOString() },
  });
  const source = (payload.data as Record<string, any>[])[0]
    .canonical.requiredSourceState.sources[0];
  source.generatedAt = new Date(now - 3 * HOUR * 1_000).toISOString();
  source.expiresAt = new Date(now - HOUR * 1_000).toISOString();

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_EXPIRED",
  ));
  assertNotBinding(sc.decision);
});

test("required sources and forecast identity hashes are recomputed, not format-checked", () => {
  const arbitraryHashPayload = bindingPayload();
  const arbitrarySource = (arbitraryHashPayload.data as Record<string, any>[])[0]
    .canonical.requiredSourceState.sources[0];
  arbitrarySource.capturedIdentityHash = "b".repeat(64);
  const arbitrary = decorate(arbitraryHashPayload);
  assert.equal(arbitrary.directionEligibility.status, "WITHHELD");
  assert.ok(arbitrary.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_INVALID",
  ));

  const tamperedForecastPayload = bindingPayload();
  const tamperedForecast = (tamperedForecastPayload.data as Record<string, any>[])[0]
    .canonical.forecast;
  tamperedForecast.instrumentIdentity = {
    ...tamperedForecast.instrumentIdentity,
    resolvedAt: "2026-08-31T11:51:00.000Z",
  };
  // The old hash remains syntactically valid, but no longer authenticates the
  // fixed v1 fields after resolvedAt was changed.
  const tampered = decorate(tamperedForecastPayload);
  assert.equal(tampered.directionEligibility.status, "WITHHELD");
  assert.ok(tampered.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_INVALID",
  ));
});

test("a self-validating BTC required source cannot authorize a selected NVDA claim", () => {
  const nvdaIdentity = resolvedIdentity({
    symbol: "NVDA",
    canonicalInstrumentId: "nasdaq:equity:NVDA",
    canonicalId: "nasdaq:equity:NVDA",
    assetClass: "equity",
    venue: "NASDAQ",
    quoteCurrency: "USD",
    resolutionBasis: "provider_asset_registry",
  });
  const nvdaHash = testIdentityHash(nvdaIdentity);
  const payload = bindingPayload({
    identity: nvdaIdentity,
    producerRecord: publishedCanonical({ barRegime: "equity" }),
  });
  const row = (payload.data as Record<string, any>[])[0];
  row.symbol = "NVDA";
  row.instrumentIdentity = nvdaIdentity;
  // Keep the required source as the original, internally valid BTC capture,
  // while making the forecast itself a valid NVDA capture. This isolates the
  // source-to-claim comparison from hash validation and forecast comparison.
  row.canonical.forecast = {
    ...validCanonicalForecast(),
    instrumentIdentity: nvdaIdentity,
    sourceIdentityHash: nvdaHash,
  };

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_MISMATCH" &&
      String(entry.reason).includes("forecast_72h/forecast-btc-1"),
  ));
  assert.ok(!sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_INVALID",
  ), "the BTC source is self-validating; the failure must be cross-claim identity, not hash syntax");
  assertNotBinding(sc.decision);
});

test("a self-validating ABTCUSDT forecast cannot authorize the ABTC NASDAQ equity", () => {
  const abtcEquity = resolvedIdentity({
    symbol: "ABTC",
    canonicalInstrumentId: "nasdaq:equity:ABTC",
    canonicalId: "nasdaq:equity:ABTC",
    assetClass: "equity",
    venue: "NASDAQ",
    quoteCurrency: "USD",
    resolutionBasis: "provider_asset_registry",
  });
  const abtcEquityHash = testIdentityHash(abtcEquity);
  const abtcToken = resolvedIdentity({
    symbol: "ABTCUSDT",
    canonicalInstrumentId: "binance:crypto:ABTC-USDT",
    canonicalId: "binance:crypto:ABTC-USDT",
  });
  const abtcTokenHash = testIdentityHash(abtcToken);
  const payload = bindingPayload({
    identity: abtcEquity,
    producerRecord: publishedCanonical({ barRegime: "equity" }),
  });
  const row = (payload.data as Record<string, any>[])[0];
  row.symbol = "ABTC";
  row.instrumentIdentity = abtcEquity;
  row.canonical.requiredSourceState = {
    ...validCanonicalRequiredSources(),
    sources: [{
      ...validCanonicalRequiredSources().sources[0],
      sourceId: "equity-evidence-abtc",
      instrumentIdentity: abtcEquity,
      capturedIdentityHash: abtcEquityHash,
    }],
  };
  row.canonical.forecast = {
    ...validCanonicalForecast(),
    instrumentIdentity: abtcToken,
    sourceIdentityHash: abtcTokenHash,
  };

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.ok(sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_MISMATCH" &&
      String(entry.reason).includes("required forecast"),
  ));
  assert.ok(!sc.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_INVALID",
  ), "both ABTC identities carry valid hashes; the venue/asset collision itself must revoke authority");
  assertNotBinding(sc.decision);
});

test("portfolio monitoring validates mandate and evidence while execution remains prohibited", () => {
  const sc = decorate(portfolioPayload(), "fahali_get_portfolio_decision");

  assert.equal(sc.monitoringEligibility.kind, "portfolio_monitoring");
  assert.equal(sc.monitoringEligibility.status, "ELIGIBLE");
  assert.equal(sc.monitoringEligibility.bindingAuthority, null);
  assert.equal(sc.monitoringEligibility.producerEligibility.status, "not_applicable");
  assert.equal(sc.executionEligibility.kind, "portfolio_execution");
  assert.equal(sc.executionEligibility.status, "WITHHELD");
  assert.equal(sc.executionEligibility.bindingAuthority, null);
  assert.equal(sc.executionEligibility.producerEligibility.status, "prohibited_by_operating_mode");
  assert.ok(sc.executionEligibility.reasons.some(
    (entry: any) => entry.code === "MONITOR_ONLY_NO_EXECUTION_AUTHORITY",
  ));
  assert.equal(sc.directionEligibility, undefined);
  assert.equal(sc.decision.action, null);
  assert.equal(sc.decision.legacyMonitoringValue, "REDUCE");
  assert.equal(sc.decision.monitoringEscalation, "ELEVATED");
  assert.equal(sc.decision.executionAuthority, "NONE");
  assert.equal(sc.decision.binding, false);
});

test("the exact watch-delta route shape retains immutable evidence eligibility", () => {
  const full = portfolioPayload() as Record<string, any>;
  const decision = full.verdict.decision;
  const routeShape = {
    status: full.status,
    dataState: full.dataState,
    delta: {
      watchId: decision.watchId,
      previousVerdictId: null,
      currentVerdictId: full.verdict.id,
      changed: true,
      decisionChanged: true,
      evidenceChanged: true,
      eventTypes: ["decision_changed"],
      changes: [],
      current: decision,
    },
    verdictId: full.verdict.id,
    authorityState: "bounded",
    validUntil: new Date(Date.now() + 20 * 60_000).toISOString(),
    evidenceSnapshot: full.verdict.evidenceSnapshot,
    evidenceHash: full.verdict.evidenceHash,
    decisionHash: full.verdict.decisionHash,
    methodologyVersion: full.verdict.methodologyVersion,
    refreshed: false,
  };
  const eligible = decorate(routeShape, "fahali_get_watch_delta");
  assert.equal(eligible.monitoringEligibility.status, "ELIGIBLE");
  assert.notEqual(eligible.responseState, "WITHHELD");

  const missingSnapshot = { ...routeShape } as Record<string, any>;
  delete missingSnapshot.evidenceSnapshot;
  const withheld = decorate(missingSnapshot, "fahali_get_watch_delta");
  assert.equal(withheld.monitoringEligibility.status, "WITHHELD");
  assert.ok(withheld.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "EVIDENCE_INTEGRITY_INVALID" &&
      String(entry.reason).includes("evidenceRef_not_in_snapshot"),
  ));
});

test("cached current portfolio decisions expire against retrieval time on every current surface", () => {
  const now = Date.now();
  const decisionAsOf = new Date(now - 2 * HOUR * 1_000).toISOString();
  const evidenceAsOf = new Date(now - (2 * HOUR + 5 * 60) * 1_000).toISOString();
  for (const tool of [
    "fahali_get_portfolio_decision",
    "fahali_watch_portfolio",
    "fahali_update_portfolio_watch",
    "fahali_get_watch_delta",
  ]) {
    const sc = decorate(portfolioPayload({
      responseAsOf: decisionAsOf,
      decisionAsOf,
      evidenceAsOf,
    }), tool);
    assert.equal(sc.monitoringEligibility.status, "WITHHELD", tool);
    assert.ok(sc.monitoringEligibility.reasons.some(
      (entry: any) => entry.code === "DECISION_EXPIRED",
    ), `${tool} evaluated the cached decision at its old asOf instead of retrieval time`);
    assert.equal(sc.decision.action, null, tool);
  }
});

test("an explicit portfolio expiry is a hard upper bound even while evidence is fresh", () => {
  const now = Date.now();
  const sc = decorate(portfolioPayload({
    decisionAsOf: new Date(now - 5 * 60_000).toISOString(),
    evidenceAsOf: new Date(now - 10 * 60_000).toISOString(),
    decisionExpiresAt: new Date(now - 60_000).toISOString(),
  }), "fahali_get_portfolio_decision");

  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "DECISION_EXPIRED",
  ));
  assert.ok(!sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "SOURCE_STALE",
  ), "fresh evidence should not be mislabeled stale when the decision expiry itself failed");
  assert.equal(sc.monitoringEligibility.validity.expired, true);
  assert.equal(sc.monitoringEligibility.validity.expiryBasis, "producer_expiry");
  assert.equal(sc.decision.action, null);
});

test("a portfolio decision with neither explicit nor derivable expiry fails closed", () => {
  const payload = portfolioPayload();
  (payload.verdict as any).decision.thresholds = {};
  const sc = decorate(payload, "fahali_get_portfolio_decision");

  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "VALIDITY_UNKNOWN" &&
      String(entry.reason).includes("no usable expiry"),
  ));
  assert.equal(sc.monitoringEligibility.validity.known, false);
  assert.equal(sc.decision.action, null);
});

test("an expiry in 2100 cannot authorize a threshold-less pure risk-control REDUCE", () => {
  const payload = portfolioPayload({ decisionExpiresAt: "2100-01-01T00:00:00.000Z" });
  const decision = (payload.verdict as any).decision;
  decision.thresholds = {};
  decision.positions[0].actionBasis = "risk_control";
  decision.positions[0].direction = null;

  const sc = decorate(payload, "fahali_get_portfolio_decision");
  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "VALIDITY_UNKNOWN" &&
      String(entry.reason).includes("valid staleAfterMinutes threshold"),
  ));
  assert.equal(sc.monitoringEligibility.validity.known, false);
  assert.equal(sc.decision.action, null);
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.verdict.decision.action, "REDUCE", "the rejected source action remains audit evidence");
});

test("an explicit portfolio expiry cannot exceed the threshold or hard 24-hour TTL", () => {
  const payload = portfolioPayload({ decisionExpiresAt: "2100-01-01T00:00:00.000Z" });
  const decision = (payload.verdict as any).decision;
  decision.thresholds = { staleAfterMinutes: 1_440 };
  decision.positions[0].actionBasis = "risk_control";
  decision.positions[0].direction = null;

  const sc = decorate(payload, "fahali_get_portfolio_decision");
  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "VALIDITY_UNKNOWN" &&
      String(entry.reason).includes("hard 24-hour decision TTL"),
  ));
  assert.equal(sc.decision.action, null);
  assert.equal(sc.decision.binding, false);
});

test("invalid portfolio staleness thresholds fail closed before every binding action", () => {
  for (const staleAfterMinutes of [0, 1, 1_441, "30"]) {
    const payload = portfolioPayload({
      decisionExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const decision = (payload.verdict as any).decision;
    decision.thresholds = { staleAfterMinutes };
    decision.positions[0].actionBasis = "risk_control";
    decision.positions[0].direction = null;

    const sc = decorate(payload, "fahali_get_portfolio_decision");
    assert.equal(sc.monitoringEligibility.status, "WITHHELD", String(staleAfterMinutes));
    assert.ok(sc.monitoringEligibility.reasons.some(
      (entry: any) => entry.code === "VALIDITY_UNKNOWN" &&
        String(entry.reason).includes("valid staleAfterMinutes threshold"),
    ), String(staleAfterMinutes));
    assert.equal(sc.decision.action, null, String(staleAfterMinutes));
  }
});

test("market binding rejects overlong required-source and forecast authority windows", () => {
  const sourcePayload = bindingPayload();
  (sourcePayload.data as Record<string, any>[])[0]
    .canonical.requiredSourceState.sources[0].expiresAt = "2100-01-01T00:00:00.000Z";
  const sourceResult = decorate(sourcePayload);
  assert.equal(sourceResult.directionEligibility.status, "WITHHELD");
  assert.ok(sourceResult.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_EXPIRED" &&
      String(entry.reason).includes("overlong authority window"),
  ));
  assertNotBinding(sourceResult.decision);

  const forecastPayload = bindingPayload();
  const forecast = (forecastPayload.data as Record<string, any>[])[0].canonical.forecast;
  forecast.expiresAt = "2100-01-01T00:00:00.000Z";
  forecast.validity.expiresAt = "2100-01-01T00:00:00.000Z";
  const forecastResult = decorate(forecastPayload);
  assert.equal(forecastResult.directionEligibility.status, "WITHHELD");
  assert.ok(forecastResult.directionEligibility.reasons.some(
    (entry: any) => entry.code === "REQUIRED_SOURCE_EXPIRED" &&
      String(entry.reason).includes("bounded producer-issued authority window"),
  ));
  assertNotBinding(forecastResult.decision);
});

test("operator rollback revokes market direction but cannot turn monitoring into execution", () => {
  const before = process.env.FAHALI_BINDING_DECISIONS_ENABLED;
  try {
    process.env.FAHALI_BINDING_DECISIONS_ENABLED = "false";
    const market = decorate(bindingPayload(), "fahali_get_market_decision");
    assert.equal(market.directionEligibility.status, "WITHHELD");
    assert.ok(market.directionEligibility.reasons.some(
      (entry: any) => entry.code === "OPERATOR_BINDING_DISABLED",
    ));
    assert.equal(market.decision.binding, false);
    assert.equal(market.decision.actionability, "ABSTAIN");
    assertNotBinding(market.decision);

    const portfolio = decorate(portfolioPayload(), "fahali_get_portfolio_decision");
    assert.equal(portfolio.monitoringEligibility.status, "ELIGIBLE");
    assert.ok(!portfolio.monitoringEligibility.reasons.some(
      (entry: any) => entry.code === "OPERATOR_BINDING_DISABLED",
    ));
    assert.equal(portfolio.executionEligibility.status, "WITHHELD");
    assert.ok(portfolio.executionEligibility.reasons.some(
      (entry: any) => entry.code === "MONITOR_ONLY_NO_EXECUTION_AUTHORITY",
    ));
    assert.equal(portfolio.decision.action, null);
    assert.equal(portfolio.decision.binding, false);

    // Enabling the control restores only the ordinary policy. It cannot
    // authorize an expired claim that fails the existing evidence gates.
    process.env.FAHALI_BINDING_DECISIONS_ENABLED = "true";
    const stillIneligible = decorate(bindingPayload({ ageSeconds: 67 * HOUR }));
    assert.equal(stillIneligible.directionEligibility.status, "WITHHELD");
    assert.ok(stillIneligible.directionEligibility.reasons.some((entry: any) => entry.code === "CLAIM_EXPIRED"));
    assert.ok(!stillIneligible.directionEligibility.reasons.some(
      (entry: any) => entry.code === "OPERATOR_BINDING_DISABLED",
    ));

    // The unset default preserves the existing eligibility policy.
    delete process.env.FAHALI_BINDING_DECISIONS_ENABLED;
    assert.equal(decorate(bindingPayload()).directionEligibility.status, "ELIGIBLE");
    assert.equal(
      decorate(portfolioPayload(), "fahali_get_portfolio_decision").monitoringEligibility.status,
      "ELIGIBLE",
    );
    assert.equal(
      decorate(portfolioPayload(), "fahali_get_portfolio_decision").executionEligibility.status,
      "WITHHELD",
    );

    // Invalid configured values fail closed rather than accidentally enabling
    // live binding decisions through an operator typo.
    process.env.FAHALI_BINDING_DECISIONS_ENABLED = "fasle";
    assert.equal(decorate(bindingPayload()).directionEligibility.status, "WITHHELD");
  } finally {
    if (before === undefined) delete process.env.FAHALI_BINDING_DECISIONS_ENABLED;
    else process.env.FAHALI_BINDING_DECISIONS_ENABLED = before;
  }
});

test("invalid portfolio evidence revokes monitoring validity without fabricating authority", () => {
  const sc = decorate(portfolioPayload({
    identity: resolvedIdentity({
      resolutionState: "ambiguous",
      canonicalInstrumentId: null,
      canonicalId: null,
    }),
  }), "fahali_get_portfolio_decision");

  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some((entry: any) => entry.code === "IDENTITY_INVALID"));
  assert.equal(sc.executionEligibility.status, "WITHHELD");
  assert.equal(sc.responseState, "WITHHELD");
  assert.equal(sc.decision.action, null);
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.decision.directionAuthority, null);
  assert.equal(sc.decision.executionAuthority, "NONE");
  assert.equal(sc.decision.executionAuthorityStatus, "PROHIBITED");
  assert.equal(sc.decision.whatToDo, null);
  assert.doesNotMatch(JSON.stringify(sc.decision), /Reduce BTC exposure within the mandate/);
  assert.deepEqual(sc.decision.instructionAudit.removedFields, [], "legacy instruction text never enters the normalized projection");
  assert.equal(sc.verdict.decision.whatToDo, "Reduce BTC exposure within the mandate.");
  assert.equal(sc.verdict.decision.action, "REDUCE", "the source portfolio verdict must remain audit evidence");
});

test("venue and asset-class inference cannot replace captured InstrumentIdentityV1 for monitoring validity", () => {
  const payload = portfolioPayload({ positionIdentity: null, positionIdentityHash: null });
  const position = (payload.verdict as any).decision.positions[0];
  Object.assign(position, {
    venue: "BINANCE",
    assetClass: "crypto",
    quoteCurrency: "USDT",
    canonicalInstrumentId: "binance:crypto:BTC-USDT",
    resolutionState: "resolved",
  });

  const sc = decorate(payload, "fahali_get_portfolio_decision");
  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some((entry: any) => entry.code === "IDENTITY_INVALID"));
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "EVIDENCE_INTEGRITY_INVALID",
  ));
  assert.equal(sc.decision.action, null);
  assert.equal(sc.verdict.decision.action, "REDUCE");
});

test("a failed contributing evidence hash independently revokes portfolio monitoring validity", () => {
  const sc = decorate(portfolioPayload({
    positionIntegrity: { evidenceHashVerified: false },
  }), "fahali_get_portfolio_decision");
  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some((entry: any) => entry.code === "EVIDENCE_INTEGRITY_INVALID"));
  assert.equal(sc.decision.action, null);
  assert.equal(sc.verdict.decision.action, "REDUCE");
});

test("matching arbitrary position and evidence hashes cannot authorize monitoring validity", () => {
  const arbitraryHash = "b".repeat(64);
  const sc = decorate(portfolioPayload({
    positionIdentityHash: arbitraryHash,
    evidenceIdentityHash: arbitraryHash,
  }), "fahali_get_portfolio_decision");

  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "EVIDENCE_INTEGRITY_INVALID",
  ));
  assert.equal(sc.decision.action, null);
});

test("a recomputed hash cannot rescue an identity with the wrong canonical terminal", () => {
  const invalidIdentity = resolvedIdentity({
    canonicalInstrumentId: "binance:crypto:ETH-USDT",
    canonicalId: "binance:crypto:ETH-USDT",
  });
  const invalidHash = testIdentityHash(invalidIdentity);
  const sc = decorate(portfolioPayload({
    identity: invalidIdentity,
    positionIdentity: invalidIdentity,
    positionIdentityHash: invalidHash,
    evidenceIdentityHash: invalidHash,
  }), "fahali_get_portfolio_decision");

  assert.equal(sc.monitoringEligibility.status, "WITHHELD");
  assert.ok(sc.monitoringEligibility.reasons.some((entry: any) => entry.code === "IDENTITY_INVALID"));
  assert.ok(sc.monitoringEligibility.reasons.some(
    (entry: any) => entry.code === "EVIDENCE_INTEGRITY_INVALID",
  ));
  assert.equal(sc.decision.action, null);
});

test("historical replay preserves stored verdict bytes but never presents its action as current", () => {
  const payload = portfolioPayload({
    responseAsOf: "2026-08-31T14:00:00.000Z",
    decisionAsOf: "2026-08-31T12:00:00.000Z",
    evidenceAsOf: "2026-08-31T11:55:00.000Z",
    immutable: true,
  });
  const before = JSON.stringify(payload.verdict);
  const sc = decorate(payload, "fahali_get_verdict_by_id");

  assert.equal(JSON.stringify(sc.verdict), before, "immutable stored verdict changed during replay decoration");
  assert.equal(sc.responseState, "OK_WITH_FINDINGS", "historical truth must not be rewritten as a current failure");
  assert.equal(sc.currentActionEligibility.kind, "historical_replay");
  assert.equal(sc.currentActionEligibility.status, "WITHHELD");
  assert.ok(sc.currentActionEligibility.reasons.some((entry: any) => entry.code === "HISTORICAL_RECORD_ONLY"));
  assert.ok(sc.currentActionEligibility.reasons.some((entry: any) => entry.code === "SOURCE_STALE"));
  assert.equal(sc.executionEligibility, undefined);
  assert.equal(sc.directionEligibility, undefined);
  assert.equal(sc.decision.action, null);
  assert.equal(sc.decision.historicalAction, "REDUCE");
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.decision.currentlyActionable, false);
  assert.equal(sc.decision.decisionState, "immutable_historical_replay");
  assert.equal(sc.decision.whatToDo, null);
  assert.doesNotMatch(JSON.stringify(sc.decision), /Reduce BTC exposure within the mandate/);
  assert.equal(sc.verdict.decision.whatToDo, "Reduce BTC exposure within the mandate.");
  assert.match(sc.agentBriefing, /Immutable historical decision replay/);
  assert.match(sc.agentBriefing, /Do not execute the historical action/);

  const compact = decorate(payload, "fahali_get_verdict_by_id", { detail: "brief", limit: 1 });
  assert.equal(JSON.stringify(compact.verdict), before, "compact projection truncated immutable verdict bytes");
});

test("even a just-recorded immutable replay cannot become a current action", () => {
  const now = new Date().toISOString();
  const payload = portfolioPayload({
    responseAsOf: now,
    decisionAsOf: now,
    evidenceAsOf: now,
    immutable: true,
  });
  const sc = decorate(payload, "fahali_get_verdict_by_id");

  assert.equal(sc.currentActionEligibility.status, "WITHHELD");
  assert.ok(sc.currentActionEligibility.reasons.some(
    (entry: any) => entry.code === "HISTORICAL_RECORD_ONLY",
  ));
  assert.equal(sc.decision.action, null);
  assert.equal(sc.decision.currentlyActionable, false);
  assert.match(sc.agentBriefing, /Do not execute the historical action/);
});

test("verdict chronology is audit-only even when a stored row contains an action", () => {
  const recorded = {
    id: "11111111-1111-4111-8111-111111111111",
    watchId: "22222222-2222-4222-8222-222222222222",
    dataAsOf: "2026-08-31T12:00:00.000Z",
    decision: {
      state: "ACTIVE",
      action: "REDUCE",
      whatToDo: "Reduce BTC exposure under the mandate that was active then.",
      binding: true,
    },
    contentHash: "a".repeat(64),
  };
  const before = JSON.stringify(recorded);
  const sc = decorate({
    status: "ok",
    dataState: "measured",
    asOf: TEST_AS_OF,
    items: [recorded],
  }, "fahali_get_verdict_history");

  assert.equal(JSON.stringify(sc.items[0]), before, "history decoration rewrote an immutable row");
  assert.equal(sc.responseState, "OK_WITH_FINDINGS");
  assert.equal(sc.currentActionEligibility.kind, "historical_replay");
  assert.equal(sc.currentActionEligibility.status, "WITHHELD");
  assert.equal(sc.currentActionEligibility.bindingAuthority, null);
  assert.ok(sc.currentActionEligibility.reasons.some(
    (entry: any) => entry.code === "HISTORICAL_RECORD_ONLY",
  ));
  assert.equal(sc.executionEligibility, undefined);
  assert.equal(sc.directionEligibility, undefined);
  assert.match(sc.agentBriefing, /Immutable historical decision replay/);
  assert.match(sc.agentBriefing, /Do not execute the historical action/);
});

test("empty verdict history remains an explicit no-record state", () => {
  const sc = decorate({
    status: "ok",
    dataState: "no_data",
    asOf: TEST_AS_OF,
    items: [],
  }, "fahali_get_verdict_history");

  assert.equal(sc.decisionEligibility.status, "NOT_APPLICABLE");
  assert.equal(sc.currentActionEligibility, undefined);
  assert.equal(sc.responseState, "OK_NO_FINDINGS");
  assert.doesNotMatch(sc.agentBriefing, /Immutable historical decision replay/);
});

test("observation-only tools remain measured without a horizon, identity, or producer record", () => {
  const sc = decorate({
    dataState: "measured",
    data: [{
      symbol: "BTCUSDT",
      netFlowUsd: 125_000,
      claim: { kind: "observation", basis: "candle-derived imbalance" },
    }],
  }, "fahali_get_capital_flow");

  assert.equal(sc.responseState, "OK_WITH_FINDINGS");
  assert.equal(sc.dataState, "measured");
  assert.equal(sc.decisionEligibility.status, "NOT_APPLICABLE");
  assert.equal(sc.data[0].netFlowUsd, 125_000);
});

/* ──────────────────────────────────────────────────────────────────────────
 * A WITHHELD CALL IS NOT AN ABSENT READING (2026-09-03)
 *
 * Measured on production: `fahali_get_symbol_decision("NVDA")` returned
 * `decision.headline: "Binding decision withheld"` while the SAME payload carried
 * `data[0].canonical.headline: "Watch — upside skew"` — the exact sentence
 * app.fahaliai.com was rendering for NVDA at that moment. The arbiter had a
 * reading and no directional call; the human surface showed the reading, the
 * agent surface showed nothing. One arbiter, two opposite impressions.
 *
 * The endpoint was never the problem — the reading was already in the payload,
 * 173KB deep. `withholdDecision` overwrote it.
 * ────────────────────────────────────────────────────────────────────────── */

/** A fresh payload withheld for a missing required source — NVDA's actual shape. */
function readingWithheldForMissingSource() {
  const payload = bindingPayload();
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.requiredSourceState.sources[0].responseState = "BANANA";
  // The arbiter has a reading, and no call in it.
  row.canonical.direction = "INSUFFICIENT_EVIDENCE";
  row.canonical.headline = "Watch — upside skew";
  (payload.decision as Record<string, unknown>).direction = "INSUFFICIENT_EVIDENCE";
  (payload.decision as Record<string, unknown>).headline = "Watch — upside skew";
  return payload;
}

test("the arbiter's reading survives a withheld binding call", () => {
  const sc = decorate(readingWithheldForMissingSource());

  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assert.equal(
    sc.decision.headline,
    "Watch — upside skew",
    "the agent must see the same reading the app renders",
  );
  // Everything that makes it a CALL stays refused.
  assert.equal(sc.decision.state, "WITHHOLD");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.decision.actionability, "ABSTAIN");
  assert.equal(sc.decision.headlineIsBinding, false);
  assert.match(sc.decision.headlineMeaning ?? "", /NOT a directional call/i);
});

test("a DIRECTIONAL reading is surfaced with the call withheld, not erased", () => {
  /**
   * 🔴 THIS TEST WAS INVERTED WITH THE CODE (2026-09-08, founder instruction).
   *
   * It previously required `headline === "Binding decision withheld"` on the
   * grounds that "a DOWNSIDE_SKEW headline is a call". That conflated the
   * READING with the CALL. The reading is what the arbiter observed; the call
   * is authority to act on it. Only the second needs a performance record, and
   * only the second is withheld here.
   *
   * The cost of the old rule, measured in production the same day: BTCUSDT
   * returned `headline: "Watch — the forecast skews downside, the analysts
   * lean bullish"` beside `direction: null`, and every stronger read was
   * flattened to "Binding decision withheld" — so the clearer the arbiter's
   * view, the less of it reached the agent.
   *
   * What must still hold is everything that converts a lean into an action,
   * and `assertNotBinding` checks all of it.
   */
  // 🔴 NOTE THE FIXTURE. The first version of this test mutated `payload.decision`
  // and passed against BOTH a working direction gate and a deleted one — the base
  // decision is built from the SELECTED ROW (`data[0].canonical`), so mutating the
  // top-level `decision` never reached the code under test. A test that cannot fail
  // is worse than no test: it reports the guard as covered.
  //
  // Withheld for a MISSING SOURCE, not expiry, so the direction gate is the only
  // thing standing between a lapsed "Immediate downside call" and the agent.
  const payload = bindingPayload();
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.requiredSourceState.sources[0].responseState = "BANANA";

  const sc = decorate(payload);
  assert.equal(sc.directionEligibility.status, "WITHHELD");
  assertReadingSurvives(sc.decision);
  assert.equal(
    sc.decision.headline,
    "Immediate downside call",
    "the arbiter's own reading reaches the agent; only the authority to act on it is withheld",
  );
  assert.equal(sc.decision.headlineIsBinding, false, "and the payload says the reading is not a call");
  assert.match(
    String(sc.decision.headlineMeaning),
    /NOT a directional call/,
    "the reading must carry, in words, what it is not",
  );
  assert.ok(
    String(sc.decision.abstainReason).length > 0,
    "and why — a refusal that names no reason is the defect this whole gate exists to avoid",
  );
  assert.equal(sc.sourceDecision.headline, "Immediate downside call", "still auditable at the source");

  // 🔴 NEGATIVE CONTROL. Promotion must remain gated on something. An EXPIRED
  // claim is a lapsed observation, not a current reading, and the very next
  // test asserts it stays suppressed — without that pair, this change would
  // read as "promote everything", which is not what was authorised.
  assert.equal(sc.decision.binding, false);
});

test("an expired reading is not restated as a current one", () => {
  // Non-directional, so the direction gate lets it through; the EXPIRY gate is the
  // only thing left. Mutating the selected row is what makes that true.
  const payload = bindingPayload({ ageSeconds: 67 * HOUR });
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.direction = "INSUFFICIENT_EVIDENCE";
  row.canonical.headline = "Watch — upside skew";

  const sc = decorate(payload);
  assert.ok(
    sc.decisionEligibility.reasons.some((entry: any) => String(entry.code).includes("EXPIRED")),
    "this fixture must be withheld for expiry or it tests the wrong gate",
  );
  assert.equal(
    sc.decision.headline,
    "Binding decision withheld",
    "non-directional does not make a lapsed observation current",
  );
});

test("every withhold code survives into the reason text", () => {
  // Two independent failures at once, so truncating the list is detectable. With a
  // single-code fixture this assertion is vacuous — which is exactly how the first
  // version of it passed while the builder was dropping reasons.
  const payload = bindingPayload({ ageSeconds: 67 * HOUR });
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.requiredSourceState.sources[0].responseState = "BANANA";

  const sc = decorate(payload);
  const codes: string[] = (sc.decisionEligibility.reasons ?? []).map((r: any) => String(r.code));
  assert.ok(codes.length >= 2, `fixture must produce >= 2 codes, got ${codes.length}: ${codes.join()}`);

  const reason = String(sc.decision.abstainReason ?? "");
  for (const code of codes) {
    assert.ok(reason.includes(code), `code ${code} must remain in the reason text`);
  }
});

test("REQUIRED_SOURCE_EXPIRED must not block the reading — production's actual shape", () => {
  /*
   * 🔴 THIS IS THE BUG PRODUCTION CAUGHT AND THE UNIT TESTS DID NOT.
   *
   * The expiry guard was written as `.includes("EXPIRED")`, which also matches
   * REQUIRED_SOURCE_EXPIRED — "a required INPUT is missing or lapsed", which is
   * the exact case the promotion exists for. Live NVDA on 2026-09-03 carried
   * CANONICAL_PERFORMANCE_INELIGIBLE + REQUIRED_SOURCE_{EXPIRED, IDENTITY_INVALID,
   * IDENTITY_MISMATCH, STATE_INVALID} and NO claim expiry at all, so the fix
   * deployed and did nothing.
   *
   * Both existing fixtures missed it: the expiry one emits CLAIM_EXPIRED, and the
   * missing-source one emits no EXPIRED code. Neither reproduced the live set.
   * This one does: an expired required forecast, with the claim itself current.
   */
  const payload = bindingPayload({ ageSeconds: HOUR, horizon: "12h" });
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.requiredSourceState = {
    ...validCanonicalRequiredSources(),
    sources: [{
      ...validCanonicalRequiredSources().sources[0],
      generatedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2026-08-31T06:00:00.000Z",
    }],
  };
  row.canonical.direction = "INSUFFICIENT_EVIDENCE";
  row.canonical.headline = "Watch — upside skew";

  const sc = decorate(payload);
  assert.equal(sc.claimValidity.expired, false, "the claim itself must be current or this tests the wrong gate");
  assert.ok(
    sc.decisionEligibility.reasons.some((e: any) => String(e.code).includes("EXPIRED")),
    "fixture must carry a REQUIRED_SOURCE_*EXPIRED code",
  );
  assert.ok(
    !sc.decisionEligibility.reasons.some((e: any) => String(e.code) === "CLAIM_EXPIRED"),
    "and must NOT carry CLAIM_EXPIRED",
  );

  assert.equal(
    sc.decision.headline,
    "Watch — upside skew",
    "a missing required INPUT does not make the arbiter's current reading lapsed",
  );
  assertNotBinding(sc.decision, "the call stays withheld");
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.decision.headlineIsBinding, false);
});

/**
 * A FORECAST MAY REST ON AN IDENTITY-VERIFIED SUBSET.
 *
 * Regression guard for the 2026-09-14 finding: the api-server accepted a
 * partial-coverage forecast as authority-eligible (forecastAuthority.ts,
 * fixed 2026-09-07) while THIS envelope still demanded
 * identityIntegrity.state === "verified". Measured on production that day,
 * BTCUSDT and ETHUSDT each carried an ACTIONABLE bearish row backed by a
 * publishable record (n_eff 939) and were withheld here anyway.
 *
 * The positive case below is the exact production shape. The negative controls
 * exist because a guard that only proves the happy path would also pass if the
 * bar were removed entirely rather than narrowed.
 */
const PRODUCTION_PARTIAL_INTEGRITY = {
  state: "partial",
  admittedState: "verified",
  admissionPolicy: "verified-voters-v1",
  requested: { predictions: 70, alerts: 50 },
  admitted: { predictions: 50, alerts: 6 },
  excludedCount: 44,
  lifecycleFilteredCount: 20,
};

function payloadWithIntegrity(integrity: unknown): Record<string, unknown> {
  const payload = bindingPayload();
  const row = (payload.data as Record<string, any>[])[0];
  row.canonical.forecast.identityIntegrity = integrity;
  return payload;
}

test("a verified SUBSET of voters still carries forecast authority", () => {
  const sc = decorate(payloadWithIntegrity(PRODUCTION_PARTIAL_INTEGRITY));
  assert.ok(
    !sc.decisionEligibility.reasons.some(
      (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_INVALID",
    ),
    "a non-empty exclusion ledger is honest accounting, not an integrity failure",
  );
  assert.equal(sc.decisionEligibility.status, "ELIGIBLE");
  assert.equal(sc.decision.binding, true);
});

test("zero exclusions still passes, unchanged", () => {
  const sc = decorate(payloadWithIntegrity({ state: "verified" }));
  assert.equal(sc.decision.binding, true);
});

// ---- negative controls: each must STILL withhold -------------------------
const mustWithhold: Array<[string, unknown]> = [
  ["admittedState is not verified", {
    ...PRODUCTION_PARTIAL_INTEGRITY, admittedState: "partial",
  }],
  ["an unrecognised admission policy", {
    ...PRODUCTION_PARTIAL_INTEGRITY, admissionPolicy: "anything-goes-v9",
  }],
  ["no voter was admitted at all", {
    ...PRODUCTION_PARTIAL_INTEGRITY, admitted: { predictions: 0, alerts: 0 },
  }],
  ["state withheld means nothing verified", {
    ...PRODUCTION_PARTIAL_INTEGRITY, state: "withheld",
  }],
  ["a missing count is unknown, never zero", {
    ...PRODUCTION_PARTIAL_INTEGRITY, admitted: { predictions: 50 },
  }],
  ["a non-integer count is refused", {
    ...PRODUCTION_PARTIAL_INTEGRITY, admitted: { predictions: 50, alerts: "6" },
  }],
  ["a negative count is refused", {
    ...PRODUCTION_PARTIAL_INTEGRITY, admitted: { predictions: 50, alerts: -1 },
  }],
  ["no integrity block at all", null],
  ["an empty integrity block", {}],
];

for (const [label, integrity] of mustWithhold) {
  test(`forecast authority is refused when ${label}`, () => {
    const sc = decorate(payloadWithIntegrity(integrity));
    assert.ok(
      sc.decisionEligibility.reasons.some(
        (entry: any) => entry.code === "REQUIRED_SOURCE_IDENTITY_INVALID",
      ),
      `expected REQUIRED_SOURCE_IDENTITY_INVALID when ${label}`,
    );
    assertNotBinding(sc.decision);
  });
}

test("🔴 2026-10-20: an exact withheld directional stratum is refused on its record, not as a stratum mismatch", () => {
  // Live BTCUSDT reported "stratum_mismatch" because the withheld candidate's
  // claimFamily had been dropped. The stratum matched exactly; its record is
  // what refused it, and the refusal must say so with the measured grade.
  const withheld = {
    engine: "canonical_verdict", state: "withheld", quotable: false,
    reasons: ["precision does not beat its own base rate"], strataMeasured: 1,
    horizonTier: "24h", barRegime: "crypto", claimFamily: "directional",
    identityPopulation: "verified_only",
    grade: "worse_than_chance", gradeLabel: "Worse than chance",
    note: "withheld",
  };
  const base = publishedCanonical();
  Object.assign(withheld, { horizonTier: base.horizonTier, barRegime: base.barRegime });
  const sc = decorate(bindingPayload({ producerRecord: withheld }));
  const pe = sc.decisionEligibility.producerEligibility;
  assert.equal(pe.status, "withheld");
  assert.equal(pe.recordGrade, "worse_than_chance");
  assert.match(String(pe.reason), /worse than chance/);
  assert.equal(sc.decisionEligibility.status, "WITHHELD");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.actionability, "ABSTAIN");

  // Negative control: the same record without its family is still a mismatch.
  const unlabelled = { ...withheld, claimFamily: null };
  const sc2 = decorate(bindingPayload({ producerRecord: unlabelled }));
  assert.equal(sc2.decisionEligibility.producerEligibility.status, "stratum_mismatch");
});
