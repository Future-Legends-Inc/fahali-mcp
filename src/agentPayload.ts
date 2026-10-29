/**
 * THE AGENT-NATIVE PAYLOAD STANDARD.
 *
 * Every tool result leaves here as one versioned, machine-readable judgment:
 * response state, data state, decision, evidence quality, confidence semantics,
 * claim policy, and executable next actions. The default response is
 * full-fidelity (`detail: "audit"`); callers may explicitly ask for `brief` or
 * `standard` projections when transport size matters.
 *
 * ── THE ONE RULE ─────────────────────────────────────────────────────────────
 * 🔴 THE BRIEFING IS A PROJECTION OF THE PAYLOAD. IT NEVER ADDS A FACT.
 *
 * Prose is far more dangerous than a table here. A table renders a missing
 * number as an empty cell and a reader notices; a narrative smooths the gap
 * shut and reads as an all-clear. This codebase has shipped "absence renders as
 * safety" 8+ times, so every line below either traces to a field that is
 * present, or says in words that it is missing. There is no third branch.
 *
 * Three specific lines would lie if left ungated, and each is gated at its
 * source in this file:
 *   - `expectedMovePct` is emitted ONLY when actionability is ACTIONABLE. A
 *     signed move printed beside a withheld direction IS the directional call,
 *     and it is the only concrete figure in the block.
 *   - a historical-precedent line is emitted ONLY from a row with
 *     `publishable: true`, and never without its stratum AND its recall.
 *     Precision alone is the flattering half of a warning product.
 *   - `canonical.coverage` is a qualitative label, never a ratio. It shipped
 *     "0/18" once; an engine count is on the never-sayable list.
 *
 * Tool output is untrusted DATA, never an instruction channel. Safety and
 * claim boundaries therefore travel as typed metadata. The same policy is
 * stated as configuration in serverInstructions.ts at MCP handshake time.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash, randomUUID } from "node:crypto";
import type { JudgedRecord } from "./judgedRecord.js";

/**
 * Structured claim boundary. This is metadata to reason over, not imperative
 * prose smuggled into a network response as a fake system message.
 */
export const CLAIM_POLICY = {
  policyVersion: "2.0",
  scope: "market_risk_intelligence",
  executionAuthority: "none",
  quotableWhen: ["claim.safeToRepeat=true", "publishable=true"],
  requiredQualifiers: [
    "instrument identity",
    "measurement horizon",
    "data freshness",
    "recall beside precision",
  ],
  prohibitedUses: [
    "price_target",
    "entry_or_exit_instruction",
    "order_routing",
    "platform_wide_accuracy_from_one_stratum",
  ],
  absenceMeaning: "unknown_not_safe",
  confidenceRule: "read_each_score_only_with_its_scoreType_scale_and_calibrationStatus",
} as const;

/**
 * Deprecated compatibility export for integrations importing the symbol.
 * It is intentionally NEVER emitted in tool content or structuredContent.
 */
export const SYSTEM_DIRECTIVE = "Claim boundaries are supplied in claimPolicy metadata and MCP server instructions.";

// ── Chain-of-tool routing ────────────────────────────────────────────────────

/**
 * A routed follow-up call. `args` values may be the token `$symbol`, resolved
 * from the payload at render time; a recommendation whose required arg cannot
 * be resolved is DROPPED rather than emitted with a placeholder.
 *
 * 🔴 Every `tool` here and every key in `args` is asserted against the real
 * TOOL_DEFINITIONS by `agentPayload.test.ts`. That test is not ceremony: the
 * brief that commissioned this file proposed
 * `fahali_get_contagion_map(symbols=[...])`, and that tool takes NO arguments.
 * Agents fire these calls autonomously with nobody reviewing them first, so a
 * plausible-looking wrong signature is worse here than anywhere else.
 */
export type NextToolCall = {
  tool: string;
  args?: Record<string, string>;
  why: string;
  requiredTier?: string;
};

export type ResponseDetail = "brief" | "standard" | "audit";
export const DEFAULT_RESPONSE_DETAIL: ResponseDetail = "audit";
// Keep the MCP's current-authority window identical to
// server/lib/canonicalPerformanceAuthority.ts. The MCP is a separately built
// package (rootDir=src), so it cannot import the server module directly.
const CANONICAL_MAX_RECORD_AGE_MS = 36 * 60 * 60 * 1_000;
// Canonical inputs are forecast/committee claims whose longest authorized
// producer window is 72h. A syntactically future expiry is not authority when
// the producer made it arbitrarily long.
const CANONICAL_REQUIRED_SOURCE_MAX_TTL_MS = 72 * 60 * 60 * 1_000;
// Watch thresholds are normalized by server/agentMonitoring/evaluate.ts to
// 5..1440 minutes. Re-check the wire value because MCP payloads are untrusted,
// and retain an independent absolute cap so an upstream threshold change cannot
// silently create indefinitely actionable cached decisions.
const PORTFOLIO_MIN_STALE_AFTER_MINUTES = 5;
const PORTFOLIO_MAX_STALE_AFTER_MINUTES = 1_440;
const PORTFOLIO_MAX_DECISION_TTL_MS = 24 * 60 * 60 * 1_000;
export type AgentToolContract = {
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
  _meta?: { requiredTier?: string; disabled?: boolean };
};
export type AgentAuthContext = {
  credentialType: "oauth" | "api_key" | "process_key" | "none";
  expiresAt: string | null;
  secondsRemaining: number | null;
  refreshSupported: boolean;
};
export type AgentDecorationOptions = {
  detail?: ResponseDetail;
  limit?: number;
  includeWithheld?: boolean;
  symbols?: string[];
  since?: string;
  toolCatalog?: AgentToolContract[];
  auth?: AgentAuthContext;
  /**
   * Instruments the caller named in the REQUEST BODY, read from the tool
   * arguments rather than from the response.
   *
   * `callerSuppliedInstruments` alone reads the RESPONSE, which only works for
   * tools that echo the book back (`requestedPositions`, `requestedShocks`).
   * `watch_portfolio` does not — it returns the created watch — so a caller who
   * named 2 positions got `requestScope: "universe"` with `requested: []` and a
   * ledger that could account for nothing. Passing what the ARGUMENTS said
   * closes that without making a supplied book into a filter.
   */
  suppliedInstruments?: string[];
};

const R = (tool: string, why: string, args?: Record<string, string>): NextToolCall => ({ tool, why, args });

/** The judged record. Reachable from everything, because every number owes it. */
const TO_RECORD = R("fahali_get_lead_time", "check what this engine's judged record actually is before quoting any figure");

const ROUTES: Record<string, NextToolCall[]> = {
  fahali_get_bundle: [
    R("fahali_get_market_decision", "resolve the bundle into binding market decisions", { symbols: "$symbols" }),
    R("fahali_get_portfolio_risk", "apply the market bundle to the connected book"),
    R("fahali_get_lead_time", "inspect the exact judged record behind any claim"),
  ],
  fahali_get_market_verdict: [
    R("fahali_get_forecast", "get the forward probabilities and uncertainty cone behind this read", { symbol: "$symbol" }),
    R("fahali_get_contagion_map", "see whether this is one name or a chain of names moving together"),
    TO_RECORD,
  ],
  fahali_get_market_decision: [
    R("fahali_get_symbol_decision", "inspect the binding decision for the leading named instrument", { symbol: "$symbol" }),
    R("fahali_get_portfolio_risk", "apply the market decision to the connected book"),
    TO_RECORD,
  ],
  fahali_get_symbol_decision: [
    R("fahali_get_forecast", "inspect the forward distribution behind this binding symbol decision", { symbol: "$symbol" }),
    R("fahali_get_contagion_map", "see whether this instrument is isolated or part of a downside chain"),
    TO_RECORD,
  ],
  fahali_get_forecast: [
    R("fahali_get_symbol_decision", "compare the forward read against the canonical arbiter's current call", { symbol: "$symbol" }),
    R("fahali_get_capital_flow", "compare the forecast with the latest measured 60-minute buy-versus-sell dollar imbalance", { symbol: "$symbol" }),
    TO_RECORD,
  ],
  fahali_get_portfolio_risk: [
    R("fahali_get_portfolio_metrics", "inspect the measured exposure and risk metrics without creating persistent monitoring state"),
    R("fahali_run_shock_test", "revalue the book position by position against a named shock"),
    R("fahali_get_contagion_map", "find which holdings break together rather than independently"),
    R("fahali_get_realtime_alerts", "see what is firing on these names right now"),
  ],
  fahali_list_connected_accounts: [
    R("fahali_get_portfolio_risk", "analyze the connected book after confirming which accounts are available"),
    R("fahali_run_shock_test", "apply a named shock to the connected positions"),
    R("fahali_get_bundle", "combine the book context with the current market decision"),
  ],
  fahali_get_realtime_alerts: [
    R("fahali_get_market_decision", "turn the firing alerts into binding decisions with confidence and abstentions", { symbols: "$symbols" }),
    R("fahali_get_highest_conviction_signals", "rank what is worth acting on rather than reading every alert"),
    TO_RECORD,
  ],
  fahali_get_contagion_map: [
    R("fahali_get_correlation_matrix", "measure the requested book's pairwise historical co-movement and coverage"),
    R("fahali_get_portfolio_risk", "map the chain onto the book actually held"),
    R("fahali_run_shock_test", "price what a break in the lead name does to everything downstream"),
  ],
  fahali_get_capital_flow: [
    R("fahali_get_microstructure_proxy", "see the order-book behaviour underneath the flow"),
    R("fahali_get_symbol_decision", "check whether the arbiter agrees with this backward-looking flow observation", { symbol: "$symbol" }),
    R("fahali_get_unusual_money_movement", "compare this symbol with the strongest order-flow imbalances across the monitored universe", { symbols: "$symbol" }),
  ],
  fahali_get_microstructure_proxy: [
    R("fahali_get_capital_flow", "get the latest measured 60-minute dollar imbalance beside the book behaviour", { symbol: "$symbol" }),
    R("fahali_get_symbol_decision", "resolve this into a directional call or an abstention", { symbol: "$symbol" }),
    TO_RECORD,
  ],
  fahali_get_flash_crash_risk: [
    R("fahali_get_market_regime", "establish whether the whole tape is in a state where this matters"),
    R("fahali_get_contagion_map", "check whether the flagged names are linked or independent"),
    TO_RECORD,
  ],
  fahali_get_detection_activity: [
    R("fahali_get_highest_conviction_signals", "narrow raw detection volume to what cleared conviction"),
    R("fahali_get_market_decision", "get the arbiter's judgment on the most active names"),
    R("fahali_get_market_regime", "check what regime is producing this activity level"),
  ],
  fahali_get_unusual_money_movement: [
    R("fahali_get_capital_flow", "inspect the measured 60-minute dollar imbalance for the leading symbol", { symbol: "$symbol" }),
    R("fahali_get_market_decision", "check whether the canonical market judgment agrees with the imbalance", { symbols: "$symbols" }),
    TO_RECORD,
  ],
  // Deprecated calls still receive safe routing while existing integrations migrate.
  fahali_get_whale_activity: [
    R("fahali_get_unusual_money_movement", "use the canonical participant-agnostic order-flow tool"),
    R("fahali_get_capital_flow", "inspect the measured 60-minute dollar imbalance for the leading symbol", { symbol: "$symbol" }),
    TO_RECORD,
  ],
  fahali_get_market_risk_score: [
    R("fahali_get_portfolio_risk", "apply the score to a real book"),
    R("fahali_get_contagion_map", "see which exposures share a downside chain"),
    TO_RECORD,
  ],
  fahali_get_correlation_matrix: [
    R("fahali_get_contagion_map", "turn pairwise co-movement into the chain structure"),
    R("fahali_run_shock_test", "price the co-movement against a named shock"),
    R("fahali_get_market_regime", "co-movement is regime-dependent; establish the regime"),
  ],
  fahali_get_market_sentiment: [
    R("fahali_get_symbol_decision", "sentiment is not a call; get the arbiter's judgment", { symbol: "$symbol" }),
    R("fahali_get_capital_flow", "compare tone with the latest measured buy-versus-sell dollar imbalance", { symbol: "$symbol" }),
    TO_RECORD,
  ],
  fahali_get_highest_conviction_signals: [
    R("fahali_get_market_decision", "resolve the top names into binding judgments with abstentions marked", { symbols: "$symbols" }),
    R("fahali_get_forecast", "get the probability cone on the leading name", { symbol: "$symbol" }),
    TO_RECORD,
  ],
  fahali_get_market_snapshot: [
    R("fahali_get_market_decision", "get binding judgments on the names that stand out", { symbols: "$symbols" }),
    R("fahali_get_realtime_alerts", "see what is firing across the universe right now"),
    R("fahali_get_market_regime", "establish the regime the snapshot sits in"),
  ],
  fahali_get_engine_status: [
    TO_RECORD,
    R("fahali_get_track_record_scorecard", "engine health is not engine skill; read the judged scorecard"),
    R("fahali_get_detection_activity", "confirm the fleet is actually producing detections"),
  ],
  fahali_get_fall_warnings: [
    R("fahali_get_engine_board", "read the generic board for the same engine", { engine: "fall_warning_8h" }),
    R("fahali_get_lead_time", "read the judged record this engine will appear in"),
  ],
  fahali_get_engine_board: [
    R("fahali_get_fall_warnings", "read the dedicated 8-hour fall-warning board when the engine asked for is fall_warning_8h"),
    R("fahali_get_engine_status", "check the health of every engine"),
  ],
  fahali_list_resources: [
    R("fahali_fetch_resource", "fetch any path this catalogue lists", { resource: "/api/situations" }),
    R("fahali_get_market_decision", "a purpose-built tool beats a generic fetch when one covers the question"),
  ],
  fahali_fetch_resource: [
    R("fahali_list_resources", "see every other readable path, and what each one requires"),
    R("fahali_get_market_decision", "turn a raw resource read into a binding judgment"),
  ],
  fahali_get_case_studies: [
    TO_RECORD,
    R("fahali_get_track_record_scorecard", "case studies are examples; the scorecard is the denominator"),
    R("fahali_get_market_decision", "compare a historical case against the current judgment"),
  ],
  fahali_resolve_instrument: [
    R("fahali_get_symbol_decision", "now that identity is settled, get the binding judgment for it", { symbol: "$symbol" }),
    R("fahali_get_market_snapshot", "see the current tape for the resolved instrument"),
  ],
  fahali_get_track_record_scorecard: [
    TO_RECORD,
    R("fahali_get_case_studies", "see individual judged calls, hits and misses alike"),
    R("fahali_get_engine_status", "check which engines are currently reporting"),
  ],
  fahali_get_lead_time: [
    R("fahali_get_track_record_scorecard", "read base-rate lift alongside the lead-time strata"),
    R("fahali_get_case_studies", "see the individual judged calls behind the record"),
    R("fahali_get_market_decision", "apply the record to Fahali's current judgment"),
  ],
  fahali_get_portfolio_metrics: [
    R("fahali_get_portfolio_risk", "metrics describe the book; the risk read judges it"),
    R("fahali_run_shock_test", "revalue the book against a named shock"),
    R("fahali_get_contagion_map", "find the co-movement the metrics average away"),
  ],
  fahali_get_market_regime: [
    R("fahali_get_market_decision", "regime sets context; get the binding market judgment"),
    R("fahali_get_flash_crash_risk", "check which names are assembling a break setup in this regime"),
    TO_RECORD,
  ],
  fahali_get_sector_rotation: [
    R("fahali_get_capital_flow", "compare relative price leadership with measured 60-minute buy/sell imbalance"),
    R("fahali_get_market_mood", "read the leadership change against how fearful or greedy prices are"),
    TO_RECORD,
  ],
  fahali_get_market_mood: [
    R("fahali_get_market_decision", "mood describes conditions; get the binding market judgment"),
    R("fahali_get_market_regime", "compare the price-based mood with the detected regime"),
    TO_RECORD,
  ],
  fahali_get_visual_intelligence: [
    R("fahali_get_market_decision", "resolve the visual read into a binding judgment", { symbols: "$symbols" }),
    R("fahali_get_realtime_alerts", "see the live alerts behind the picture"),
    TO_RECORD,
  ],
  fahali_analyze_custom_portfolio: [
    R("fahali_run_shock_test", "revalue these positions against a named shock"),
    R("fahali_get_contagion_map", "find which of these names break together"),
    TO_RECORD,
  ],
  fahali_run_shock_test: [
    R("fahali_get_portfolio_risk", "compare the shocked book against its current standing read"),
    R("fahali_get_contagion_map", "check the co-movement assumptions the shock depends on"),
    TO_RECORD,
  ],
  fahali_get_market_briefing: [
    R("fahali_get_market_decision", "get binding decisions behind the briefing", { symbols: "$symbols" }),
    R("fahali_get_realtime_alerts", "see what has fired since the briefing was composed"),
    TO_RECORD,
  ],
  fahali_daily_brief: [
    R("fahali_get_market_briefing", "get the fuller intraday briefing"),
    R("fahali_get_highest_conviction_signals", "narrow the brief to what cleared conviction"),
    TO_RECORD,
  ],
  fahali_fact_check_narrative: [
    R("fahali_get_market_decision", "get the binding judgment on the symbols this claim names", { symbols: "$symbols" }),
    TO_RECORD,
    R("fahali_get_case_studies", "ground the claim in individual judged calls, misses included"),
  ],
  fahali_get_capabilities: [
    R("fahali_get_market_decision", "start with Fahali's binding market judgment"),
    R("fahali_get_symbol_decision", "get one binding instrument judgment", { symbol: "$symbol" }),
    R("fahali_list_portfolio_watches", "resume an existing autonomous portfolio workflow before creating another"),
  ],
  fahali_watch_portfolio: [
    R("fahali_get_portfolio_decision", "read the complete monitor-only risk assessment for the new watch", { watch_id: "$watch_id" }),
    R("fahali_get_watch_delta", "see exactly what changed from the prior persisted judgment", { watch_id: "$watch_id" }),
  ],
  fahali_list_portfolio_watches: [
    R("fahali_get_portfolio_decision", "open the latest monitor-only assessment for the selected watch", { watch_id: "$watch_id" }),
    R("fahali_get_verdict_history", "inspect the immutable record for the selected watch", { watch_id: "$watch_id" }),
    R("fahali_list_risk_subscriptions", "check how changes from each watch are delivered", { watch_id: "$watch_id" }),
  ],
  fahali_update_portfolio_watch: [
    R("fahali_get_portfolio_decision", "read the re-evaluated decision under the updated mandate", { watch_id: "$watch_id" }),
    R("fahali_get_watch_delta", "see which conclusion changed because of the update", { watch_id: "$watch_id" }),
    R("fahali_get_verdict_history", "verify that the prior decision remains replayable", { watch_id: "$watch_id" }),
  ],
  fahali_get_portfolio_decision: [
    R("fahali_get_watch_delta", "separate the new evidence from a repeated conclusion", { watch_id: "$watch_id" }),
    R("fahali_get_verdict_history", "replay the judgments that led here", { watch_id: "$watch_id" }),
  ],
  fahali_get_watch_delta: [
    R("fahali_get_portfolio_decision", "read the complete current decision after the delta", { watch_id: "$watch_id" }),
    R("fahali_get_verdict_history", "place this change in its immutable timeline", { watch_id: "$watch_id" }),
    R("fahali_list_risk_subscriptions", "confirm that the right channel receives future changes", { watch_id: "$watch_id" }),
  ],
  fahali_get_active_incidents: [
    R("fahali_get_incident_timeline", "replay every judgment inside the incident's own window", { incident_id: "$incident_id" }),
    R("fahali_acknowledge_incident", "stop the escalation clock once a human or agent has taken this on", { incident_id: "$incident_id" }),
    R("fahali_get_portfolio_decision", "read the full current assessment behind the breach", { watch_id: "$watch_id" }),
  ],
  fahali_acknowledge_incident: [
    R("fahali_get_incident_timeline", "confirm what Fahali judged across the incident so far", { incident_id: "$incident_id" }),
    R("fahali_get_watch_delta", "check whether the breach has since changed", { watch_id: "$watch_id" }),
    R("fahali_get_active_incidents", "see what else is still unanswered"),
  ],
  fahali_get_incident_timeline: [
    R("fahali_get_verdict_by_id", "open one verdict from the timeline with its evidence", { verdict_id: "$verdict_id" }),
    R("fahali_acknowledge_incident", "record that this incident has been taken on", { incident_id: "$incident_id" }),
    R("fahali_get_active_incidents", "return to everything still open"),
  ],
  fahali_get_verdict_history: [
    R("fahali_get_watch_delta", "compare the historical chain with a fresh watch evaluation", { watch_id: "$watch_id" }),
    R("fahali_get_portfolio_decision", "return from replay to the current monitor-only assessment", { watch_id: "$watch_id" }),
    TO_RECORD,
  ],
  fahali_get_verdict_by_id: [
    R("fahali_get_evidence", "retrieve the compact content-addressed evidence behind this verdict", { verdict_id: "$verdict_id" }),
    R("fahali_get_verdict_history", "inspect the judgments immediately before and after this verdict", { watch_id: "$watch_id" }),
    R("fahali_get_portfolio_decision", "compare this immutable replay with the current decision", { watch_id: "$watch_id" }),
  ],
  fahali_get_evidence: [
    R("fahali_get_verdict_by_id", "replay the complete immutable decision this evidence supported", { verdict_id: "$verdict_id" }),
    R("fahali_get_verdict_history", "place the evidence revision in its decision chronology", { watch_id: "$watch_id" }),
    TO_RECORD,
  ],
  fahali_subscribe_risk: [
    R("fahali_list_risk_subscriptions", "verify the stored channel without exposing its secret", { watch_id: "$watch_id" }),
    R("fahali_get_watch_delta", "see the exact event shape the subscription will receive", { watch_id: "$watch_id" }),
  ],
  fahali_list_risk_subscriptions: [
    R("fahali_get_watch_delta", "inspect the latest deliverable change", { watch_id: "$watch_id" }),
    R("fahali_list_portfolio_watches", "map each subscription back to its mandate"),
  ],
  fahali_update_subscription: [
    R("fahali_list_risk_subscriptions", "confirm the channel's new state and health"),
    R("fahali_get_watch_delta", "inspect the next payload's decision delta", { watch_id: "$watch_id" }),
  ],
  fahali_unsubscribe_risk: [
    R("fahali_list_risk_subscriptions", "confirm delivery stopped while the audit row remains"),
    R("fahali_get_portfolio_decision", "continue monitoring on demand without outbound delivery", { watch_id: "$watch_id" }),
  ],
  fahali_save_memory: [
    R("fahali_search_memories", "confirm what is now stored under this session", { query: "$key" }),
    R("fahali_list_agent_sessions", "see which sessions hold memory"),
  ],
  fahali_search_memories: [
    // NOT routed to `save_memory`: it requires `key` and `value`, and there is
    // no honest way to fill them from a search result — we would be inventing
    // the content the agent is about to persist. A write tool is only ever
    // routed to when every required argument is resolvable from the payload.
    R("fahali_list_agent_sessions", "widen the search to the other sessions that hold memory"),
    R("fahali_get_market_decision", "check what Fahali says now about the symbols these memories name", { symbols: "$symbols" }),
  ],
  fahali_create_alert: [
    R("fahali_get_realtime_alerts", "confirm the alert landed on the live wire"),
    R("fahali_get_symbol_decision", "check the binding judgment on the symbol just flagged", { symbol: "$symbol" }),
  ],
  fahali_list_agent_sessions: [
    R("fahali_search_memories", "read what a session actually stored", { query: "$symbol" }),
    // Same rule as above: `save_memory` needs a key AND a value, and neither is
    // derivable from a session listing.
    R("fahali_get_market_briefing", "get the current market read to write into a session"),
  ],
};

// ── Payload readers. These only ever READ; nothing here invents a value. ─────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(15)) : null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(Number(v.toPrecision(15)));
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

const RESPONSE_STATES = {
  findings: "OK_WITH_FINDINGS",
  empty: "OK_NO_FINDINGS",
  partial: "PARTIAL",
  withheld: "WITHHELD",
  noCoverage: "NO_COVERAGE",
  error: "ERROR",
} as const;

const DATA_STATES = {
  measured: "measured",
  partial: "partial",
  noData: "no_data",
  notInstrumented: "not_instrumented",
  stale: "stale",
  error: "error",
} as const;

type EmptyKind = "measured_empty" | "user_empty" | "no_coverage" | "source_unverified";

/**
 * The renderer used to guess an endpoint's rows from a short global list. That
 * made a populated `assets`, `regimes`, `history`, or `caseStudies` response
 * look like NO_COVERAGE, while a prose summary beside an empty `signals` array
 * looked like a finding. Keep the response-shape contract explicit per tool.
 *
 * `emptyKind` is deliberately endpoint-specific:
 * - measured_empty: the source ran and no qualifying market finding matched;
 * - user_empty: the authenticated user's collection is valid and currently empty;
 * - no_coverage: the requested judgment cannot be made without rows;
 * - source_unverified: the upstream route currently has a catch-to-empty path,
 *   so an empty payload cannot prove that the source was healthy.
 */
export type AgentEndpointAdapter = {
  collections: readonly string[];
  objectFindings?: readonly string[];
  readingKeys?: readonly string[];
  zeroEvidenceKeys?: readonly string[];
  emptyKind: EmptyKind;
  operation?: "create" | "update" | "delete";
};

export const AGENT_ENDPOINT_ADAPTERS: Record<string, AgentEndpointAdapter> = {
  fahali_get_market_verdict: { collections: ["data"], emptyKind: "no_coverage" },
  fahali_get_market_decision: { collections: ["data"], emptyKind: "no_coverage" },
  fahali_get_symbol_decision: { collections: ["data"], emptyKind: "no_coverage" },
  fahali_get_forecast: { collections: ["evidence", "drivers"], objectFindings: ["forecast"], emptyKind: "no_coverage" },
  // A symbol absent from the venue listings is a MEASURED empty: we looked and
  // it is not listed. That is a different fact from the reference failing to
  // load, which the payload reports separately via referenceHealth.loaded.
  fahali_resolve_instrument: { collections: ["instruments"], emptyKind: "measured_empty" },
  fahali_get_microstructure_proxy: { collections: ["data"], emptyKind: "no_coverage" },
  fahali_get_flash_crash_risk: { collections: ["signals"], emptyKind: "measured_empty" },
  fahali_get_detection_activity: {
    collections: [],
    readingKeys: ["recentDetections", "symbolsWithRecentDetections"],
    zeroEvidenceKeys: ["recentDetections", "symbolsWithRecentDetections"],
    emptyKind: "source_unverified",
  },
  fahali_get_unusual_money_movement: { collections: ["data"], emptyKind: "no_coverage" },
  fahali_get_market_risk_score: {
    collections: ["observations"],
    readingKeys: ["score", "detectionCount"],
    zeroEvidenceKeys: ["detectionCount"],
    emptyKind: "source_unverified",
  },
  fahali_get_correlation_matrix: { collections: ["matrix", "perSymbol"], emptyKind: "source_unverified" },
  fahali_get_market_sentiment: { collections: ["history", "entries"], emptyKind: "source_unverified" },
  fahali_get_highest_conviction_signals: { collections: ["items", "verdicts"], emptyKind: "measured_empty" },
  fahali_get_market_snapshot: { collections: ["assets", "indices"], emptyKind: "source_unverified" },
  fahali_get_engine_status: { collections: ["engines"], emptyKind: "source_unverified" },
  // The engine-board envelope (server/lib/engineBoard.ts). A finding is a LIVE
  // entry (state standing/in_progress with a finite p), derived into `findings`
  // by decorateForAgent and by classifyEngineBoard; a quiet board is a measured
  // empty, never a finding. `board.reason` is declared only so a null board
  // (which always carries a reason) is recognised as the adapter's OWN shape: an
  // earned absence, not an adapterGap over the record block. It is a string, so
  // it can never itself count as a finding.
  fahali_get_fall_warnings: { collections: ["findings"], objectFindings: ["board.reason"], emptyKind: "source_unverified" },
  fahali_get_engine_board: { collections: ["findings"], objectFindings: ["board.reason"], emptyKind: "source_unverified" },
  fahali_get_case_studies: { collections: ["caseStudies", "cases"], emptyKind: "measured_empty" },
  /*
    The catalogue tools. `fahali_fetch_resource` returns whatever the fetched
    resource returns, so it declares NO collections on purpose: a declared key
    that does not match the payload is how 57.7KB of judged record was once
    hidden. With none declared it lands on the adapterGap path, which reports
    OK_WITH_FINDINGS over a real payload — verified 2026-09-05 against a
    situations-shaped body — rather than claiming NO_COVERAGE over data.
  */
  fahali_list_resources: { collections: ["resources", "excluded"], emptyKind: "measured_empty" },
  fahali_fetch_resource: { collections: [], emptyKind: "source_unverified" },
  /**
   * 🔴 EVERY DECLARED KEY HERE WAS WRONG, AND IT HID THE MOAT (2026-08-27).
   *
   * The endpoint returns `direction` (19 engines), `magnitude` (42 strata),
   * `volatility`, `extreme_events`, `blended`, `base_rates` — all OBJECTS keyed
   * by engine. The adapter declared `directional` (≠ `direction`), `crashCatch`
   * (≠ `extreme_events`), and `trackRecord`/`rows`/`scorecard`, none of which
   * exist in the payload at all. `inspectCollections` also skips non-arrays, so
   * even the two names that DID match (`magnitude`, `volatility`) were dropped
   * for being keyed objects rather than arrays.
   *
   * Nothing was ever seen, so 57.7KB of publishable judged record — the single
   * asset the company is built on — shipped as `NO_COVERAGE / no_data`. The
   * response contract tells an agent to read responseState first and treats
   * absence as unknown-not-safe, so a COMPLIANT agent discarded the record.
   *
   * These keys are `objectFindings`, not `collections`, deliberately: they are
   * strata maps keyed by engine, not instrument rows. Feeding them to `rows`
   * would make 19 engine strata look like 19 judged instruments — the same
   * defect this file just fixed on `fahali_get_capabilities`.
   */
  fahali_get_track_record_scorecard: {
    collections: [],
    objectFindings: ["direction", "magnitude", "volatility", "extreme_events", "blended"],
    emptyKind: "source_unverified",
  },
  fahali_get_portfolio_metrics: {
    collections: [],
    readingKeys: ["cascadeRisk", "liquidityStress", "leverageStress", "sentimentMomentum"],
    emptyKind: "no_coverage",
  },
  fahali_get_market_regime: { collections: ["regimes"], emptyKind: "source_unverified" },
  fahali_get_market_mood: { collections: [], objectFindings: ["equity", "crypto"], emptyKind: "source_unverified" },
  fahali_get_sector_rotation: { collections: ["groups"], emptyKind: "source_unverified" },
  fahali_get_visual_intelligence: { collections: ["nodes", "flows"], emptyKind: "source_unverified" },
  fahali_get_realtime_alerts: { collections: ["alerts", "signals", "clusters"], emptyKind: "measured_empty" },
  fahali_get_portfolio_risk: { collections: ["positions", "data"], objectFindings: ["portfolio"], emptyKind: "no_coverage" },
  fahali_analyze_custom_portfolio: { collections: ["positions", "data"], objectFindings: ["portfolio"], emptyKind: "no_coverage" },
  fahali_get_contagion_map: { collections: ["nodes", "edges", "clusters"], emptyKind: "source_unverified" },
  fahali_get_capital_flow: { collections: ["data", "flows"], emptyKind: "no_coverage" },
  fahali_run_shock_test: {
    collections: ["requestedShocks", "simulations", "recentRiskObservations"],
    objectFindings: ["requestedScenario", "compoundResult", "requestedShock", "worstCase"],
    emptyKind: "no_coverage",
  },
  fahali_get_market_briefing: {
    collections: ["priorityRiskClusters", "topOpportunities", "alerts", "signals"],
    objectFindings: ["detectionActivity"],
    readingKeys: ["marketRiskScore", "alertVolume.count"],
    zeroEvidenceKeys: ["alertVolume.count"],
    emptyKind: "source_unverified",
  },
  fahali_daily_brief: {
    collections: ["alerts", "changes", "headlines"],
    objectFindings: ["brief", "alert_activity", "top_signal"],
    readingKeys: ["risk_score"],
    zeroEvidenceKeys: ["alert_activity.new_alerts_24h", "alert_activity.symbols_affected"],
    emptyKind: "source_unverified",
  },
  fahali_save_memory: { collections: [], objectFindings: ["memory"], readingKeys: ["success"], emptyKind: "no_coverage", operation: "update" },
  fahali_search_memories: { collections: ["data", "memories"], emptyKind: "source_unverified" },
  fahali_create_alert: { collections: [], objectFindings: ["alert"], readingKeys: ["success"], emptyKind: "no_coverage", operation: "create" },
  fahali_list_agent_sessions: { collections: ["data", "sessions"], emptyKind: "source_unverified" },
  fahali_fact_check_narrative: { collections: ["assertions", "results"], emptyKind: "no_coverage" },
  fahali_list_connected_accounts: { collections: ["accounts"], emptyKind: "user_empty" },
  fahali_get_bundle: { collections: ["results", "views"], objectFindings: ["bundle"], emptyKind: "no_coverage" },
  fahali_get_capabilities: { collections: ["tools", "resources"], objectFindings: ["capabilities"], emptyKind: "measured_empty" },
  fahali_watch_portfolio: { collections: [], objectFindings: ["watch", "verdict"], emptyKind: "no_coverage", operation: "create" },
  fahali_list_portfolio_watches: { collections: ["watches"], emptyKind: "user_empty" },
  fahali_update_portfolio_watch: { collections: [], objectFindings: ["watch", "verdict", "delta"], emptyKind: "no_coverage", operation: "update" },
  fahali_get_portfolio_decision: { collections: [], objectFindings: ["watch", "verdict", "delta"], emptyKind: "no_coverage" },
  fahali_get_watch_delta: { collections: [], objectFindings: ["delta"], emptyKind: "no_coverage" },
  // `user_empty`, never `no_coverage`: an empty incident list is a MEASURED fact
  // about this account's ledger — nothing is open — and must not be reported as
  // missing coverage, which an agent would read as "Fahali could not tell".
  fahali_get_active_incidents: { collections: ["incidents"], emptyKind: "user_empty" },
  fahali_acknowledge_incident: { collections: [], objectFindings: ["incident"], emptyKind: "no_coverage", operation: "update" },
  // `no_coverage`, unlike the incident LIST above: an incident is opened BY a
  // verdict and that verdict is always inside the window, so an empty timeline
  // is not a normal user state — it means the read did not land.
  fahali_get_incident_timeline: { collections: ["timeline"], objectFindings: ["incident"], emptyKind: "no_coverage" },
  fahali_get_verdict_history: { collections: ["items", "verdicts"], emptyKind: "user_empty" },
  fahali_get_verdict_by_id: { collections: [], objectFindings: ["verdict"], emptyKind: "no_coverage" },
  fahali_get_evidence: { collections: ["sourceEvents"], objectFindings: ["immutableSnapshot", "integrity"], emptyKind: "no_coverage" },
  fahali_subscribe_risk: { collections: [], objectFindings: ["subscription"], emptyKind: "no_coverage", operation: "create" },
  fahali_list_risk_subscriptions: { collections: ["subscriptions"], emptyKind: "user_empty" },
  fahali_update_subscription: { collections: [], objectFindings: ["subscription"], emptyKind: "no_coverage", operation: "update" },
  fahali_unsubscribe_risk: { collections: [], objectFindings: ["subscription"], readingKeys: ["unsubscribed", "success"], emptyKind: "no_coverage", operation: "delete" },
  fahali_get_lead_time: { collections: ["trackRecord"], objectFindings: ["headline"], emptyKind: "no_coverage" },
};

/**
 * A bundle's views are RAW upstream payloads.
 *
 * Decoration happens exactly once, at the outer dispatch seam in index.ts, so
 * by the time the bundle envelope is built no view has been classified and no
 * view carries a responseState of its own. The bundle therefore has to derive
 * its state from its children — and to classify a child it needs that child's
 * TOOL identity, because adapters are per-tool and `views.regime` is a view
 * name, not a tool name.
 *
 * Kept beside the adapters deliberately: a view missing from this map would
 * fall through to the permissive default adapter and read as coverage we
 * cannot prove. This object is the SINGLE source of bundle view names —
 * index.ts derives both its accepted-name set and the type of its dispatch
 * map from it, so adding a view in one place without the other is a COMPILE
 * error rather than a silently unclassifiable view. `satisfies` (not an
 * annotation) is what keeps the keys literal enough for that to work.
 */
export const BUNDLE_VIEW_TOOLS = {
  briefing: "fahali_get_market_briefing",
  market_decision: "fahali_get_market_decision",
  risk_score: "fahali_get_market_risk_score",
  regime: "fahali_get_market_regime",
  conviction: "fahali_get_highest_conviction_signals",
  portfolio: "fahali_get_portfolio_risk",
  accounts: "fahali_list_connected_accounts",
  realtime: "fahali_get_realtime_alerts",
  lead_time: "fahali_get_lead_time",
  engine_status: "fahali_get_engine_status",
  daily_brief: "fahali_daily_brief",
} satisfies Record<string, string>;

export type BundleViewName = keyof typeof BUNDLE_VIEW_TOOLS;

const ADAPTER_ALIASES: Record<string, string> = {
  fahali_get_72h_forecast: "fahali_get_forecast",
  fahali_get_dark_pool_activity: "fahali_get_microstructure_proxy",
  fahali_get_smart_money_dashboard: "fahali_get_detection_activity",
  fahali_get_whale_activity: "fahali_get_unusual_money_movement",
  fahali_get_institutional_risk_score: "fahali_get_market_risk_score",
  save_memory: "fahali_save_memory",
  search_memories: "fahali_search_memories",
  create_alert: "fahali_create_alert",
  list_agent_sessions: "fahali_list_agent_sessions",
};

function adapterFor(tool: string): AgentEndpointAdapter {
  return AGENT_ENDPOINT_ADAPTERS[ADAPTER_ALIASES[tool] ?? tool] ?? {
    collections: ["data", "items", "rows"],
    emptyKind: "no_coverage",
  };
}

function statusText(d: Record<string, unknown>): string {
  return String(d.status ?? d.state ?? d.calculationStatus ?? "").trim().toUpperCase();
}

function claimOf(d: Record<string, unknown>): Record<string, unknown> | null {
  return isObj(d.claim) ? d.claim : null;
}

function valueAtPath(d: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = d;
  for (const part of path.split(".")) {
    if (!isObj(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function sourceStatusFor(d: Record<string, unknown>): string | null {
  for (const value of [d.status, d.calculationStatus, d.calculation_status]) {
    const text = str(value);
    if (text) return text;
  }
  return null;
}

function sourceErrorReason(d: Record<string, unknown>): string | null {
  const statusWords = [d.status, d.state, d.calculationStatus, d.calculation_status]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter(Boolean);
  const errorObject = isObj(d.error) ? d.error : null;
  const explicit = str(errorObject?.message) ?? str(errorObject?.code) ?? str(d.error) ?? str(d.errorCode) ?? str(d.error_code);
  if (explicit) return explicit;
  if (String(d.dataState ?? d.data_state ?? "").trim().toLowerCase() === DATA_STATES.error) return "source_reported_error";
  if (d.queryFailed === true || d.query_failed === true) return "source_query_failed";
  const failed = statusWords.find((value) =>
    /^(ERROR|FAILED|NO_POOL|QUERY_FAILED|UPSTREAM_ERROR|DATABASE_ERROR|UNAVAILABLE_ERROR)$/.test(value) ||
    /(?:^|_)(?:QUERY|SOURCE|DATABASE|UPSTREAM)_FAILED$/.test(value),
  );
  return failed?.toLowerCase() ?? null;
}

function isExplicitSourcePartial(d: Record<string, unknown>): boolean {
  const probeErrors = d.probeErrors ?? d.probe_errors;
  return statusText(d) === "PARTIAL" ||
    String(d.responseState ?? "").trim().toUpperCase() === RESPONSE_STATES.partial ||
    String(d.dataState ?? d.data_state ?? "").trim().toLowerCase() === DATA_STATES.partial ||
    d.publicationWindowComplete === false || d.publication_window_complete === false ||
    d.judgmentWindowComplete === false || d.judgment_window_complete === false ||
    (Array.isArray(probeErrors) && probeErrors.length > 0);
}

function sourcePartialReason(d: Record<string, unknown>): string {
  const probeErrors = d.probeErrors ?? d.probe_errors;
  const failed = Array.isArray(probeErrors)
    ? probeErrors
        .map((entry) => isObj(entry)
          ? str(entry.source ?? entry.probe ?? entry.code ?? entry.message)
          : str(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const incomplete = [
    d.publicationWindowComplete === false || d.publication_window_complete === false
      ? "publication window incomplete"
      : null,
    d.judgmentWindowComplete === false || d.judgment_window_complete === false
      ? "judgment window incomplete"
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  const detail = [...failed.map((entry) => `failed probe: ${entry}`), ...incomplete];
  return detail.length
    ? `The source explicitly returned PARTIAL (${detail.join("; ")}). Returned measurements remain evidence, but incomplete probes and windows are unknown rather than measured zeros.`
    : "The source explicitly returned PARTIAL. Returned measurements remain evidence, but the unresolved source scope is unknown rather than measured.";
}

function isStalePayload(d: Record<string, unknown>): boolean {
  if (d.stale === true || d.isStale === true) return true;
  if (String(d.dataState ?? d.data_state ?? "").trim().toLowerCase() === DATA_STATES.stale) return true;
  const freshness = isObj(d.freshness) ? d.freshness : {};
  const dataAgeHours = num(d.dataAgeHours ?? d.data_age_hours ?? freshness.dataAgeHours ?? freshness.data_age_hours);
  const staleAfterHours = num(d.staleAfterHours ?? d.stale_after_hours ?? freshness.staleAfterHours ?? freshness.stale_after_hours);
  if (dataAgeHours !== null && staleAfterHours !== null && dataAgeHours > staleAfterHours) return true;
  return [d.status, d.state, d.calculationStatus, d.calculation_status]
    .some((value) => /(?:^|_)STALE(?:_|$)/.test(String(value ?? "").trim().toUpperCase()));
}

/**
 * One freshness block, always in seconds, whatever unit the source chose.
 *
 * Re-audit M2: a single bundle envelope carried dataAgeSeconds/
 * staleAfterSeconds on the regime view and dataAgeHours/staleAfterHours on the
 * lead-time view. Both are correct in isolation; together they invite a
 * consumer to compare 41 against 3 and conclude the lead-time read is fresher.
 *
 * The source's own block stays exactly as it is — this is additive, and it
 * reports `known: false` rather than substituting a comfortable zero when the
 * source published no freshness at all.
 */
/**
 * A block that NAMES itself freshness: `freshness`, `sourceFreshness`,
 * `computationFreshness`, `dataFreshness`…
 *
 * 🔑 This test is the whole safety property of the producer-native spellings
 * below, so it must stay narrow. `normalizedFreshness` takes the OLDEST age and
 * the TIGHTEST bar found anywhere in the payload. Accept a bare `ageMinutes`
 * sitting on a data ROW and a deliberately-historical row — a 90-day case
 * study, a resolved outcome from the moat — pairs its age with some other
 * view's 10-minute bar and reports the whole response stale. **The age of an
 * archived record is not the staleness of a reading.** A block that declares
 * itself freshness is asserting the first meaning; a row field named "age" is
 * not.
 */
const FRESHNESS_BLOCK_KEY = /freshness$/i;

/**
 * One level's own freshness signals, in seconds. No recursion.
 *
 * ── The defect (measured 2026-09-04) ────────────────────────────────────────
 * `fahali_get_correlation_matrix` published THREE freshness blocks —
 * `basis.computationFreshness` (fresh, 25min), `basis.sourceFreshness` (stale,
 * 6.5h vs a 4h ceiling) and `basis.freshness` — and the envelope above them
 * said *"No source in this response published a freshness window, so the
 * reading's age is unknown."* Every producer had answered; the envelope
 * reported ignorance, which is the same shape as R4 above.
 *
 * Cause: this function recognised only `dataAge{Seconds,Hours}` /
 * `staleAfter{Seconds,Hours}`, while the server emits `ageMs`/`maxAgeMs`
 * (covarianceArtifact, engineIntelligenceSnapshot), `maxStalenessMs`, and
 * `ageMinutes` (capitalFlow, microstructureProxy, symbolJudgment, oracle) —
 * 129 emission sites the normaliser could not see. Three comments in
 * `server/` already flagged the `ageMinutes` half of this gap; each was worked
 * around locally by adding a second, differently-spelled block rather than
 * teaching the reader the producer's own spelling.
 *
 * @param containerKey the key this object was reached through, or null at the
 *   root. Producer-native spellings are honoured only when it names a freshness
 *   block — see FRESHNESS_BLOCK_KEY for why that restriction is load-bearing.
 */
function freshnessAtLevel(
  d: Record<string, unknown>,
  containerKey?: string | null,
): { age: number | null; staleAfter: number | null; unit: "seconds" | "hours" | "minutes" | "milliseconds" | null } {
  const freshness = isObj(d.freshness) ? d.freshness : {};
  const seconds = num(d.dataAgeSeconds ?? d.data_age_seconds ?? freshness.dataAgeSeconds ?? freshness.data_age_seconds);
  const hours = num(d.dataAgeHours ?? d.data_age_hours ?? freshness.dataAgeHours ?? freshness.data_age_hours);
  const staleSeconds = num(d.staleAfterSeconds ?? d.stale_after_seconds ?? freshness.staleAfterSeconds ?? freshness.stale_after_seconds);
  const staleHours = num(d.staleAfterHours ?? d.stale_after_hours ?? freshness.staleAfterHours ?? freshness.stale_after_hours);

  // `d` itself only when it declares itself a freshness block; the nested
  // `freshness` key always qualifies, because its name IS the declaration.
  const blocks: Record<string, unknown>[] = [freshness];
  if (FRESHNESS_BLOCK_KEY.test(containerKey ?? "")) blocks.unshift(d);
  const pick = (...keys: string[]): number | null => {
    for (const block of blocks) {
      for (const key of keys) {
        const value = num(block[key]);
        if (value !== null) return value;
      }
    }
    return null;
  };
  const ageMs = pick("ageMs", "age_ms");
  const ageMinutes = pick("ageMinutes", "age_minutes");
  const ageSeconds = pick("ageSeconds", "age_seconds");
  const ageHours = pick("ageHours", "age_hours");
  // Three bar spellings are live: maxAgeMs (covarianceArtifact),
  // maxStalenessMs (engineIntelligenceSnapshot), staleAfter* (the envelope's own).
  const barMs = pick("maxAgeMs", "max_age_ms", "maxStalenessMs", "max_staleness_ms");

  // Ordered most- to least-precise, so a block publishing several spellings
  // reports the one that loses the least.
  const ageCandidates: [number | null, number, "seconds" | "hours" | "minutes" | "milliseconds"][] = [
    [seconds, 1, "seconds"],
    [ageSeconds, 1, "seconds"],
    [ageMs, 1 / 1000, "milliseconds"],
    [ageMinutes, 60, "minutes"],
    [hours, 3600, "hours"],
    [ageHours, 3600, "hours"],
  ];
  const matchedAge = ageCandidates.find(([value]) => value !== null);
  const barCandidates: [number | null, number][] = [
    [staleSeconds, 1],
    [barMs, 1 / 1000],
    [staleHours, 3600],
  ];
  const matchedBar = barCandidates.find(([value]) => value !== null);

  return {
    age: matchedAge ? Math.round((matchedAge[0] as number) * matchedAge[1]) : null,
    staleAfter: matchedBar ? Math.round((matchedBar[0] as number) * matchedBar[1]) : null,
    // The unit the SOURCE chose, reported so `sourceUnit: "mixed"` stays true.
    // Everything above is already normalised to seconds.
    unit: matchedAge?.[2] ?? (matchedBar ? "seconds" : null),
  };
}

/**
 * Envelope freshness, derived from the WHOLE body — worst case across every
 * contributing source.
 *
 * ── The defect (R4) ─────────────────────────────────────────────────────────
 * This read the top level only. A bundle whose `views.regime` published
 * `dataAgeSeconds: 69` and whose `views.lead_time` published `dataAgeHours:
 * 1.4` produced an envelope saying "this source published no freshness window,
 * so the reading's age is unknown". Both children had answered; the parent
 * reported ignorance. It appeared on all five audited calls.
 *
 * Identical root cause to N1 — an envelope field DEFAULTED instead of DERIVED —
 * surviving in the one field `viewStates` did not cover. A composite's state
 * must come from its children, and freshness is a state.
 *
 * 🔑 WORST CASE, not average, and not first-found. Freshness is a safety
 * property: a payload is exactly as current as its OLDEST contributing source,
 * and exactly as tolerant as its TIGHTEST staleness window. Averaging would let
 * one fresh view launder a stale one, which is how a day-old equity read gets
 * acted on as though it were live. Mixed units are the reason this field
 * exists, so everything is normalised to seconds before comparison.
 */
function normalizedFreshness(d: Record<string, unknown>): Record<string, unknown> {
  let oldest: number | null = null;
  let tightest: number | null = null;
  let sources = 0;
  const units = new Set<string>();

  // The KEY a level was reached through is carried down, because it is what
  // distinguishes a declared freshness block from a data row that happens to
  // carry an age. Array items inherit their array's key, so a
  // `freshnessChecks: [...]` collection is read and a `cases: [...]` one is not.
  const walk = (v: unknown, depth: number, key: string | null): void => {
    if (depth > 4 || !isObj(v)) return;
    const level = freshnessAtLevel(v, key);
    if (level.age !== null || level.staleAfter !== null) {
      sources++;
      if (level.unit) units.add(level.unit);
      if (level.age !== null) oldest = oldest === null ? level.age : Math.max(oldest, level.age);
      if (level.staleAfter !== null) tightest = tightest === null ? level.staleAfter : Math.min(tightest, level.staleAfter);
    }
    for (const [childKey, child] of Object.entries(v)) {
      if (isObj(child)) walk(child, depth + 1, childKey);
      else if (Array.isArray(child)) for (const item of child.slice(0, 25)) walk(item, depth + 1, childKey);
    }
  };
  walk(d, 0, null);

  if (oldest === null && tightest === null) {
    return {
      known: false,
      unit: "seconds",
      contributingSources: 0,
      reason: "No source in this response published a freshness window, so the reading's age is unknown — not fresh.",
    };
  }
  const age: number | null = oldest;
  const limit: number | null = tightest;
  return {
    known: true,
    unit: "seconds",
    dataAgeSeconds: age,
    staleAfterSeconds: limit,
    stale: age !== null && limit !== null ? age > limit : null,
    contributingSources: sources,
    basis: sources > 1 ? "worst_case_across_sources" : "single_source",
    sourceUnit: units.size > 1 ? "mixed" : ([...units][0] ?? null),
    ...(sources > 1
      ? { note: "Derived from every source in this response: the age is the OLDEST contributing reading and the staleness window is the TIGHTEST. A fresher view in the same payload does not make an older one current." }
      : {}),
  };
}

/** Parse a horizon expressed as "12h", "72h", "90m", "2d", or a bare number of hours. */
function horizonToSeconds(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw * 3600);
  const text = String(raw ?? "").trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days)?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2] ?? "h";
  const perUnit = unit.startsWith("m") ? 60 : unit.startsWith("d") ? 86_400 : 3600;
  return Math.round(value * perUnit);
}

/**
 * Has the CLAIM expired — a different question from whether the DATA is stale.
 *
 * ── The defect, measured in production 2026-08-30 ───────────────────────────
 * `fahali_get_market_decision` returned `decision.horizon: "12h"` and
 * `scope.horizon: "12h"` on data with `dataAgeSeconds: 241480` — 67.1 hours old
 * — and reported `freshnessNormalized.stale: false`, because `staleAfterSeconds`
 * was 259200 (72h). Both readings were individually correct. The 12-hour claim
 * had expired roughly 55 hours earlier and was served as current.
 *
 * The two quantities answer different questions:
 *   FRESHNESS       "is the data I read recent enough to serve?"  — a query window
 *   CLAIM VALIDITY  "is what I said still supposed to be true?"   — a horizon
 *
 * Nothing compared them, so an agent could act on an expired call with no signal
 * that anything was wrong. This is additive and NEVER folded into `stale`:
 * merging them would destroy the distinction, and a consumer needs to tell "the
 * data is old" from "the claim has run out" because the remedies differ — the
 * first is a pipeline problem, the second means re-ask.
 *
 * This reader is deliberately scoped to ONE selected claim. Projection and
 * selection happen before it is called; rows that did not survive projection
 * cannot expire the row the caller actually received. Multiple horizon fields
 * inside the selected claim still use the shortest declared horizon.
 *
 * An unknown horizon reports `known: false` and NEVER `expired: false` — absence
 * is not validity, the same rule freshness already follows.
 */
function claimValidity(d: Record<string, unknown>, ageSeconds: number | null): Record<string, unknown> {
  let shortest: number | null = null;
  let shortestLabel: unknown = null;
  let sources = 0;

  const walk = (v: unknown, depth: number): void => {
    if (depth > 4 || !isObj(v)) return;
    for (const [key, value] of Object.entries(v)) {
      if (/^(?:forecast)?horizon(?:hours|min|minutes|tier)?$/i.test(key) && !isObj(value) && !Array.isArray(value)) {
        const seconds = horizonToSeconds(value);
        if (seconds !== null) {
          sources++;
          if (shortest === null || seconds < shortest) {
            shortest = seconds;
            shortestLabel = value;
          }
        }
      }
      if (isObj(value)) walk(value, depth + 1);
      // Arrays represent sibling claims. The caller passes the selected claim,
      // so descending into an array would re-introduce the cross-row defect this
      // function exists to close.
    }
  };
  walk(d, 0);

  if (shortest === null) {
    return {
      known: false,
      reason: "No claim in this response declared a horizon, so whether it is still "
        + "in force is unknown — not valid.",
    };
  }
  if (ageSeconds === null) {
    return {
      known: false,
      shortestHorizon: shortestLabel,
      shortestHorizonSeconds: shortest,
      reason: "This response declares a horizon but no source published its age, so "
        + "whether the claim has expired cannot be determined — not valid.",
    };
  }
  if (ageSeconds < 0) {
    return {
      known: false,
      shortestHorizon: shortestLabel,
      shortestHorizonSeconds: shortest,
      reason: "The selected claim reports a negative age, so its source timestamp is future-dated or internally inconsistent. Current authority is unknown — not valid.",
    };
  }

  const horizonSeconds: number = shortest;
  // Authority ends at the horizon boundary. Treating equality as current gave
  // an already-expired claim one extra actionable second and disagreed with
  // every explicit expiresAt gate in this module (`expiresAt <= now`).
  const expired = ageSeconds >= horizonSeconds;
  const overdueSeconds = expired ? ageSeconds - horizonSeconds : 0;
  return {
    known: true,
    unit: "seconds",
    shortestHorizon: shortestLabel,
    shortestHorizonSeconds: horizonSeconds,
    dataAgeSeconds: ageSeconds,
    expired,
    ...(expired ? { overdueSeconds } : {}),
    contributingClaims: sources,
    basis: sources > 1 ? "shortest_horizon_on_selected_claim" : "selected_claim",
    reason: expired
      ? `This claim declared a ${String(shortestLabel)} horizon and the reading behind it `
        + `is ${Math.round(ageSeconds / 3600)}h old, so it expired about `
        + `${Math.round(overdueSeconds / 3600)}h ago. Re-ask rather than acting on it. `
        + `Claim expiry is separate from data staleness: a response can be inside its `
        + `staleness window and still be past its horizon.`
      : `Within its declared ${String(shortestLabel)} horizon `
        + `(reading is ${Math.round(ageSeconds / 3600)}h old).`,
  };
}

function isWithheldPayload(tool: string, d: Record<string, unknown>): boolean {
  const status = statusText(d);
  const claim = claimOf(d);
  if (claim?.kind === "abstention" || claim?.kind === "withheld") return true;
  if (status === "ABSTAIN" || status === "WITHHELD" || d.abstained === true || d.withheld === true) return true;
  if (str(d.abstentionReason) || str(d.abstainReason)) return true;
  if (tool === "fahali_fact_check_narrative" && Array.isArray(d.assertions) && d.assertions.length > 0) {
    return d.assertions.every((assertion) => {
      if (!isObj(assertion)) return false;
      return ["NO_READ", "UNSUPPORTED_SOURCE", "OUT_OF_SCOPE", "UNVERIFIABLE"]
        .includes(String(assertion.verdict ?? assertion.state ?? "").toUpperCase());
    });
  }
  return false;
}

type CollectionInspection = {
  present: boolean;
  nonEmpty: boolean;
  empty: boolean;
  rows: Record<string, unknown>[];
};

function inspectCollections(d: Record<string, unknown>, adapter: AgentEndpointAdapter): CollectionInspection {
  const rows: Record<string, unknown>[] = [];
  let present = false;
  let nonEmpty = false;
  let empty = false;
  for (const key of adapter.collections) {
    const value = valueAtPath(d, key);
    if (!Array.isArray(value)) continue;
    present = true;
    if (value.length > 0) nonEmpty = true;
    else empty = true;
    for (const item of value) if (isObj(item)) rows.push(item);
  }
  return { present, nonEmpty, empty: present && !nonEmpty && empty, rows };
}

function hasObjectFinding(d: Record<string, unknown>, adapter: AgentEndpointAdapter): boolean {
  return (adapter.objectFindings ?? []).some((key) => {
    const value = valueAtPath(d, key);
    return isObj(value) && Object.keys(value).length > 0;
  });
}

/**
 * Envelope, provenance and prose keys. Present on nearly every payload and
 * never evidence of a measurement on their own.
 */
const NON_EVIDENCE_KEYS: ReadonlySet<string> = new Set([
  "status", "mcpStatus", "sourceStatus", "sourceDataState", "sourceError", "sourceScope",
  "sourceDecision", "sourceEvidenceQuality", "sourceConfidenceSemantics", "dataState",
  "data_state", "responseState", "absence", "schemaVersion", "requestId", "asOf", "as_of",
  "dataAsOf", "updatedAt", "timestamp", "checkedAt", "lastUpdated", "last_updated",
  "methodology", "disclaimer", "note", "notes", "reason", "provenance", "provenanceRoot",
  "provenanceHash", "aiMetadata", "claimPolicy", "nextActions", "responseControl", "auth",
  "matchedTrackRecord", "recordMatchReason", "scope", "symbolCoverage", "instruments",
  "evidenceQuality", "confidenceSemantics", "conflicts", "freshnessNormalized", "claimValidity",
  "decision", "decisionSelection", "agentBriefing", "systemDirective", "nextTools",
  "data_window", "dataWindow", "count", "total",
]);

/**
 * Payload keys that carry real measurement but which the adapter never declared.
 *
 * ── Why this exists (2026-08-27, and it is the whole "no coverage" class) ────
 * The terminal branch of `classifyAgentPayload` could not tell two OPPOSITE
 * facts apart:
 *
 *   a) the source genuinely returned nothing  → absence, report it plainly;
 *   b) the ADAPTER does not know this payload's shape → our fault, not an
 *      absence.
 *
 * Both fell to `emptyClassification`, so a stale adapter key silently became a
 * published claim that Fahali holds no data. That is not caution — it is an
 * unfalsifiable statement about our own coverage, made from a typo, and it has
 * now been measured TWICE: `fahali_get_bundle` (views/results shape) and
 * `fahali_get_track_record_scorecard` (five wrong key names).
 *
 * So absence must be EARNED by an actually-empty payload. If substantive
 * content is sitting right there, the honest classification is that we HAVE a
 * reading and our adapter is behind — which is a bug report, not a withholding.
 *
 * Deliberately conservative about what counts, so this can never manufacture a
 * finding out of prose: a non-empty array, or a non-empty object holding
 * numbers or nested structure. Strings, booleans, bare timestamps, counts and
 * every key in NON_EVIDENCE_KEYS are excluded.
 */
function unrecognisedEvidenceKeys(
  d: Record<string, unknown>,
  adapter: AgentEndpointAdapter,
): string[] {
  const declared = new Set<string>([
    ...adapter.collections,
    ...(adapter.objectFindings ?? []),
    ...(adapter.readingKeys ?? []),
    ...(adapter.zeroEvidenceKeys ?? []),
  ]);

  /**
   * 🔴 ONLY FIRE WHEN THE ADAPTER IS ACTUALLY BLIND.
   *
   * If ANY declared key is present — even holding an empty object — the adapter
   * recognised the payload's shape and the emptiness is a real absence. Firing
   * anyway would report a DENOMINATOR as a finding: a degraded scorecard keeps
   * `base_rates: {directional: 49.53}` after all five axes empty out, and
   * "measured" over a base rate with no numerator is this bug inverted, in the
   * direction the doctrine actually cares about.
   *
   * Blindness means seeing none of what we declared. That is the only state
   * where the payload is better evidence than the mapping.
   */
  const adapterSawItsOwnShape = [...declared].some((key) => valueAtPath(d, key) !== undefined);
  if (adapterSawItsOwnShape) return [];
  const substantive = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0;
    if (!isObj(value)) return false;
    const entries = Object.values(value);
    if (!entries.length) return false;
    // A map of engine→stratum, symbol→reading, or any nested structure. Prose
    // objects ({note: "..."} ) do not qualify.
    return entries.some((entry) => typeof entry === "number" || isObj(entry) || Array.isArray(entry));
  };
  return Object.keys(d)
    .filter((key) => !NON_EVIDENCE_KEYS.has(key) && !declared.has(key))
    .filter((key) => substantive(d[key]));
}

function hasAdapterReading(d: Record<string, unknown>, adapter: AgentEndpointAdapter): boolean {
  return (adapter.readingKeys ?? []).some((key) => {
    const value = valueAtPath(d, key);
    return value !== null && value !== undefined && value !== "";
  });
}

function hasZeroEvidence(d: Record<string, unknown>, adapter: AgentEndpointAdapter): boolean {
  const keys = adapter.zeroEvidenceKeys ?? [];
  if (!keys.length) return false;
  const present = keys.map((key) => valueAtPath(d, key)).filter((value) => value !== null && value !== undefined);
  return present.length > 0 && present.every((value) => {
    if (typeof value === "number") return value === 0;
    const match = String(value).match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) === 0 : false;
  });
}

/** Aggregate metrics are readings too. This closes the false "no readings" template bug. */
function hasAggregateReading(d: Record<string, unknown>): boolean {
  const ignored = new Set([
    "schemaVersion", "status", "state", "requestId", "asOf", "updatedAt",
    "timestamp", "provenance", "provenanceRoot", "claim", "notReturned",
    "requested", "count", "total", "judgedRecord", "matchedTrackRecord", "recordMatchReason",
    // Provenance metadata, never a market reading. `directionProducers` ships
    // on every /agent/verdict response including an empty one, so counting it
    // would make "which engine would have answered" look like an answer — the
    // same false-finding shape as the bundle NO_COVERAGE bug, inverted.
    "directionProducers", "producerRecord", "producerRecordCandidates", "producerRecordNote",
  ]);
  return Object.entries(d).some(([k, v]) => {
    if (ignored.has(k) || v === null || v === undefined) return false;
    if (typeof v === "number" && Number.isFinite(v)) return true;
    if (typeof v === "boolean") return true;
    if (typeof v === "string") return v.trim() !== "" && !["OK", "ACTIVE", "ABSTAIN"].includes(v.toUpperCase());
    if (isObj(v)) return hasAggregateReading(v);
    return false;
  });
}

export type AgentClassification = {
  responseState: (typeof RESPONSE_STATES)[keyof typeof RESPONSE_STATES];
  dataState: (typeof DATA_STATES)[keyof typeof DATA_STATES];
  absence: null | { kind: EmptyKind | "stale" | "withheld" | "source_error"; reason: string };
  sourceError: string | null;
  /**
   * Payload keys carrying measurement that this tool's adapter does not declare.
   *
   * Present ONLY when the adapter recognised nothing yet the payload plainly
   * holds data. It is a self-report of our own blind spot: the reading is
   * served (never withheld over a mapping bug), and the gap is named so it can
   * be closed rather than rediscovered by the next audit.
   */
  adapterGap?: string[];
};

const ENGINE_BOARD_TOOLS: ReadonlySet<string> = new Set(["fahali_get_fall_warnings", "fahali_get_engine_board"]);

/**
 * An engine-board entry is a FINDING only when it is a live claim: state
 * `standing` or `in_progress` AND a finite numeric probability. A row is not a
 * judgment because it is a row: `quiet`/`lifted`/`expired` entries and entries
 * whose `p` is null (an unmeasured input) assert nothing.
 */
export function engineBoardFindings(d: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const roster = isObj(d.roster) && isObj(d.roster.value) ? d.roster.value : null;
  const seen = new Set<string>();
  const board = isObj(d.board) && isObj(d.board.value) ? d.board.value : null;
  const symbols = board && isObj(board.symbols) ? Object.values(board.symbols) : [];
  const own = isObj(d.symbol) && isObj(d.symbol.value) ? [d.symbol.value] : [];
  for (const entry of [...symbols, ...own]) {
    if (!isObj(entry)) continue;
    const live = entry.state === "standing" || entry.state === "in_progress";
    if (!live || typeof entry.p !== "number" || !Number.isFinite(entry.p)) continue;
    const key = String(entry.symbol ?? "") + "|" + String(entry.standing_id ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      symbol: entry.symbol, state: entry.state, p: entry.p, standing_id: entry.standing_id ?? null,
      onset_at: entry.onset_at ?? null, age_min: entry.age_min ?? null, mechanisms: entry.mechanisms ?? null,
      ...engineBoardClaim(d, roster, entry),
    });
  }
  return out;
}

const DIRECTION_POLICY: Readonly<Record<string, string | null>> = { down_only: "down", up_only: "up", both: null };

/**
 * The claim a live engine-board entry makes, with EVERY field derived from the
 * envelope or the entry (R33). `fahali_get_engine_board` serves any contract
 * engine by key, so no engine-specific label may be written here: the engine
 * key comes from `envelope.engine`, and claim type, truth condition, horizon
 * and direction come from that engine's own roster entry.
 *
 * The one constant is `kind: "forecast"`, Fahali's claim vocabulary for a
 * calibrated probability of a defined event within a stated horizon. It is
 * emitted ONLY when the roster says `claim_type === "event_prob"` - that is
 * what makes the entry such a forecast. A null roster, or any other claim
 * type, gets NO claim: the entry is still listed as a finding, but it is not
 * promoted to a decision structure, so `actionableAvailable` does not count
 * a judgment the roster never declared.
 */
function engineBoardClaim(
  d: Record<string, unknown>,
  roster: Record<string, unknown> | null,
  entry: Record<string, unknown>,
): { claim?: Record<string, unknown> } {
  if (!roster || roster.claim_type !== "event_prob") return {};
  const policy = typeof roster.direction_policy === "string" ? roster.direction_policy : null;
  return {
    claim: {
      kind: "forecast",
      engine: typeof d.engine === "string" ? d.engine : null,
      claimType: roster.claim_type,
      truthCondition: typeof roster.truth_condition === "string" ? roster.truth_condition : null,
      horizonMin: typeof roster.horizon_min === "number" && Number.isFinite(roster.horizon_min) ? roster.horizon_min : null,
      // Unknown policy -> null: a direction is never guessed.
      direction: policy !== null && Object.prototype.hasOwnProperty.call(DIRECTION_POLICY, policy) ? DIRECTION_POLICY[policy] : null,
      probability: entry.p,
      state: entry.state,
      standingId: entry.standing_id ?? null,
      onsetAt: entry.onset_at ?? null,
    },
  };
}

function classifyEngineBoard(tool: string, d: Record<string, unknown>): AgentClassification | null {
  if (!ENGINE_BOARD_TOOLS.has(ADAPTER_ALIASES[tool] ?? tool)) return null;
  const board = isObj(d.board) && isObj(d.board.value) ? d.board.value : null;
  if (!board || !isObj(board.symbols)) return null; // null / unreadable board: the earned absence below
  if (engineBoardFindings(d).length > 0) {
    return { responseState: RESPONSE_STATES.findings, dataState: DATA_STATES.measured, absence: null, sourceError: null };
  }
  // A measured board holding no live claim: every evaluated entry is quiet,
  // lifted, expired, or has no probability. That is a measured empty.
  return emptyClassification("measured_empty");
}

function emptyClassification(kind: EmptyKind): AgentClassification {
  if (kind === "measured_empty" || kind === "user_empty") {
    return {
      responseState: RESPONSE_STATES.empty,
      dataState: DATA_STATES.measured,
      absence: {
        kind,
        reason: kind === "user_empty"
          ? "The authenticated user's collection is valid and currently empty."
          : "The measured query completed and no qualifying finding matched its scope.",
      },
      sourceError: null,
    };
  }
  return {
    responseState: RESPONSE_STATES.noCoverage,
    dataState: DATA_STATES.noData,
    absence: {
      kind,
      reason: kind === "source_unverified"
        ? "The upstream response cannot prove that its source completed successfully; an empty result is not a calm-market finding."
        : "No usable measurement covers the requested scope.",
    },
    sourceError: null,
  };
}

/**
 * The sentiment route probes both live sentiment-shift alerts and the judged
 * outcome archive. An empty `history` is measured only when that payload proves
 * BOTH probes completed. This is deliberately narrower than changing the
 * adapter's default empty kind: older or malformed payloads without source
 * completion evidence must remain unverified.
 *
 * A one-probe response is useful but incomplete. Preserve it as PARTIAL and
 * never let its empty collection read as neutral or calm market sentiment.
 */
function classifyVerifiedEmptySentiment(
  tool: string,
  d: Record<string, unknown>,
): AgentClassification | null {
  const canonicalTool = ADAPTER_ALIASES[tool] ?? tool;
  if (canonicalTool !== "fahali_get_market_sentiment") return null;
  if (!Array.isArray(d.history) || d.history.length > 0 || Number(d.count) !== 0) return null;

  const instrumentation = isObj(d.instrumentation) ? d.instrumentation : null;
  const probeErrors = Array.isArray(d.probeErrors) ? d.probeErrors : null;
  const alertSource = String(instrumentation?.alertSource ?? "").trim().toLowerCase();
  const judgedOutcomeSource = String(instrumentation?.judgedOutcomeSource ?? "").trim().toLowerCase();
  const sourceDataState = String(d.dataState ?? d.data_state ?? "").trim().toLowerCase();
  const sourceResponseState = String(d.responseState ?? "").trim().toUpperCase();

  const bothProbesMeasured = alertSource === "measured" && judgedOutcomeSource === "measured";
  const explicitlyVerifiedEmpty =
    bothProbesMeasured &&
    probeErrors !== null &&
    probeErrors.length === 0 &&
    sourceDataState === DATA_STATES.noData &&
    sourceResponseState === RESPONSE_STATES.empty;
  if (explicitlyVerifiedEmpty) return emptyClassification("measured_empty");

  const failedSources = (probeErrors ?? [])
    .map((probe) => isObj(probe) ? str(probe.source) : null)
    .filter((source): source is string => Boolean(source));
  const hasProbeFailure =
    failedSources.length > 0 || alertSource === "error" || judgedOutcomeSource === "error";
  const sourceIsPartial =
    statusText(d) === "PARTIAL" ||
    sourceDataState === "partial" ||
    sourceResponseState === RESPONSE_STATES.partial;
  if (hasProbeFailure || sourceIsPartial) {
    const failed = failedSources.length > 0 ? ` Failed probe(s): ${failedSources.join(", ")}.` : "";
    return {
      responseState: RESPONSE_STATES.partial,
      dataState: DATA_STATES.noData,
      absence: {
        kind: "source_unverified",
        reason: `Only part of the sentiment source set completed, and no qualifying history row was returned.${failed} The unresolved source is unknown, not a calm-market finding.`,
      },
      sourceError: null,
    };
  }

  return null;
}

const plainList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((item) => String(item)).filter(Boolean) : [];

export type BundleViewState = {
  view: string;
  tool: string | null;
  responseState: AgentClassification["responseState"];
  dataState: AgentClassification["dataState"];
  absence: AgentClassification["absence"];
};

/** Classify each view under its own tool contract. Exported so the envelope can
 *  publish the per-view states rather than making an agent infer them. */
export function bundleViewStates(d: Record<string, unknown>): BundleViewState[] {
  if (!isObj(d.views)) return [];
  const out: BundleViewState[] = [];
  for (const [view, payload] of Object.entries(d.views)) {
    const tool = (BUNDLE_VIEW_TOOLS as Record<string, string | undefined>)[view] ?? null;
    if (!isObj(payload)) {
      out.push({
        view,
        tool,
        responseState: RESPONSE_STATES.noCoverage,
        dataState: DATA_STATES.noData,
        absence: { kind: "no_coverage", reason: `View '${view}' returned no structured payload.` },
      });
      continue;
    }
    if (!tool) {
      // Unmapped view: the permissive default adapter would read as coverage we
      // cannot prove, so say unverified instead of guessing generously.
      out.push({
        view,
        tool: null,
        responseState: RESPONSE_STATES.noCoverage,
        dataState: DATA_STATES.noData,
        absence: {
          kind: "source_unverified",
          reason: `View '${view}' has no registered response contract, so its payload cannot be classified.`,
        },
      });
      continue;
    }
    const c = classifyAgentPayload(tool, payload);
    out.push({ view, tool, responseState: c.responseState, dataState: c.dataState, absence: c.absence });
  }
  return out;
}

/**
 * A composite's state is a FUNCTION OF ITS CHILDREN, never a default.
 *
 * Measured 2026-08-27: a bundle whose two requested views both returned
 * `measured` data shipped `responseState: "NO_COVERAGE"`, `dataState:
 * "no_data"`. The response contract tells an agent to read responseState first
 * and treats absence as unknown-not-safe, so a compliant agent discarded a
 * measured regime read and a publishable stratum sitting in the same payload.
 * The flagship tool manufactured false absence — the one thing this file exists
 * to prevent.
 *
 * Cause was a shape mismatch, not the missing symbol scope it looked like: the
 * adapter declared `collections: ["results","views"]` while bundleResult emits
 * `views` as an OBJECT keyed by view name (inspectCollections skips non-arrays)
 * and `objectFindings: ["bundle"]` against a payload that has no `bundle` key.
 * Nothing was ever seen, so every bundle fell to the terminal empty branch.
 *
 * Fixing the adapter alone would NOT have been enough: `completedViews` is an
 * array of strings, so counting it as a collection would classify an all-failed
 * bundle as a finding, and an all-failed bundle is an ERROR — the caller's scope
 * was fine, the calls failed. Hence derivation rather than shape-sniffing.
 */
function classifyComposite(tool: string, d: Record<string, unknown>): AgentClassification | null {
  if ((ADAPTER_ALIASES[tool] ?? tool) !== "fahali_get_bundle") return null;
  if (!isObj(d.views) && !Array.isArray(d.requestedViews)) return null;

  const children = bundleViewStates(d);
  const requestedViews = plainList(d.requestedViews);
  const failedViews = Array.isArray(d.failedViews) ? d.failedViews : [];
  const failedNames = failedViews
    .map((entry) => (isObj(entry) ? str(entry.view) : str(entry)))
    .filter((name): name is string => Boolean(name));
  const explicitPartial = isExplicitSourcePartial(d);

  if (!requestedViews.length && !children.length) {
    return {
      responseState: RESPONSE_STATES.noCoverage,
      dataState: DATA_STATES.noData,
      absence: { kind: "no_coverage", reason: "No views were requested, so the bundle carries no measurement." },
      sourceError: null,
    };
  }

  // Nothing completed. This is an outage, not an absence of coverage.
  if (!children.length) {
    const detail = failedNames.length ? failedNames.join(", ") : requestedViews.join(", ");
    const reason = `Every requested view failed (${detail}); no view returned data.`;
    return {
      responseState: RESPONSE_STATES.error,
      dataState: DATA_STATES.error,
      absence: { kind: "source_error", reason },
      sourceError: reason,
    };
  }

  const carriesFinding = (c: BundleViewState) =>
    c.responseState === RESPONSE_STATES.findings || c.responseState === RESPONSE_STATES.partial;
  const withFindings = children.filter(carriesFinding);
  const anyMeasured = children.some((c) => c.dataState === DATA_STATES.measured);

  // Name what is missing, and say WHY in the child's own words.
  //
  // An agent that knows which views are absent can re-ask for exactly those;
  // "no coverage" tells it only to give up. And a roll-up must not be less
  // informative than the thing it rolls up — the child holds the specific
  // reason, so dropping it in favour of a state name throws away the only part
  // an agent could act on.
  const unresolved = [
    ...failedNames.map((name) => `${name} (failed)`),
    ...children
      .filter((c) => !carriesFinding(c))
      .map((c) => `${c.view} (${c.responseState}${c.absence?.reason ? `: ${c.absence.reason}` : ""})`),
    ...requestedViews
      .filter((name) => !children.some((c) => c.view === name) && !failedNames.includes(name))
      .map((name) => `${name} (not returned)`),
  ];

  if (withFindings.length) {
    const complete = unresolved.length === 0;
    return {
      responseState: complete ? RESPONSE_STATES.findings : RESPONSE_STATES.partial,
      dataState: explicitPartial
        ? DATA_STATES.partial
        : anyMeasured ? DATA_STATES.measured : DATA_STATES.noData,
      absence: complete
        ? null
        : {
            kind: "no_coverage",
            reason: `${withFindings.length} of ${requestedViews.length || children.length} requested views returned measurements. Unresolved: ${unresolved.join("; ")}. The returned views are usable; the unresolved ones are unknown, not calm.`,
          },
      sourceError: null,
    };
  }

  // Every view completed and none carried a finding.
  if (!failedNames.length && children.every((c) => c.responseState === RESPONSE_STATES.empty)) {
    return {
      responseState: RESPONSE_STATES.empty,
      dataState: DATA_STATES.measured,
      absence: {
        kind: "measured_empty",
        reason: "Every requested view completed and none reported a qualifying finding. This is a scoped empty result, not a calm market.",
      },
      sourceError: null,
    };
  }

  return {
    responseState: RESPONSE_STATES.noCoverage,
    dataState: DATA_STATES.noData,
    absence: {
      kind: "no_coverage",
      reason: `No requested view returned a usable measurement. Unresolved: ${unresolved.join("; ") || requestedViews.join(", ")}.`,
    },
    sourceError: null,
  };
}

/** Classify the full, filtered-but-untruncated payload. Projection must never alter truth state. */
export function classifyAgentPayload(tool: string, d: Record<string, unknown>): AgentClassification {
  // A composite owns its whole verdict: its children have already been through
  // the per-tool contracts, so the generic shape sniffing below cannot improve
  // on them and previously contradicted them.
  const composite = classifyComposite(tool, d);
  if (composite) return composite;

  const engineBoard = classifyEngineBoard(tool, d);
  if (engineBoard) return engineBoard;

  const adapter = adapterFor(tool);
  const sourceError = sourceErrorReason(d);
  if (sourceError) {
    return {
      responseState: RESPONSE_STATES.error,
      dataState: DATA_STATES.error,
      absence: { kind: "source_error", reason: sourceError },
      sourceError,
    };
  }
  if (isStalePayload(d)) {
    return {
      responseState: RESPONSE_STATES.withheld,
      dataState: DATA_STATES.stale,
      absence: { kind: "stale", reason: "The source returned a reading outside its declared freshness window." },
      sourceError: null,
    };
  }
  if (isExplicitSourcePartial(d)) {
    return {
      responseState: RESPONSE_STATES.partial,
      dataState: DATA_STATES.partial,
      absence: {
        kind: "source_unverified",
        reason: sourcePartialReason(d),
      },
      sourceError: null,
    };
  }
  if (isWithheldPayload(tool, d)) {
    // ── A withheld CLAIM is not an absent MEASUREMENT ────────────────────────
    //
    // This branch hardcoded `dataState: noData` and returned BEFORE
    // `inspectCollections` ever ran, so a payload that withheld its claim while
    // still carrying its evidence was labelled "no data" — and the briefing
    // built on that label then told the agent nothing had been measured.
    //
    // Measured 2026-09-04: `fahali_get_correlation_matrix` abstained because its
    // artifact was 6h32m old against a 4h ceiling, while holding **11,175 of
    // 11,175 measured pairs across 150 symbols**. Once the endpoint stopped
    // discarding those (see `server/lib/covarianceArtifact.ts`), this label
    // would have hidden them one layer up — the same measurement lost twice, at
    // two layers, for two different reasons.
    //
    // `adapter.collections` is a DECLARED per-tool list, not a guess, so a
    // populated one is real evidence; `evidenceRetained` lets a producer state
    // it outright. A genuine abstention with nothing behind it still reports
    // `no_data`, exactly as before.
    const withheldEvidence = inspectCollections(d, adapter);
    const evidenceRetained = d.evidenceRetained === true
      || withheldEvidence.nonEmpty
      || hasObjectFinding(d, adapter)
      || hasAdapterReading(d, adapter);
    const explicitWithheldState = String(d.dataState ?? d.data_state ?? "").trim().toLowerCase();
    const withheldReason = str(claimOf(d)?.reason) ?? str(d.abstentionReason) ?? str(d.abstainReason)
      ?? "Fahali deliberately withheld the claim.";
    return {
      responseState: RESPONSE_STATES.withheld,
      dataState: explicitWithheldState === DATA_STATES.notInstrumented
        ? DATA_STATES.notInstrumented
        : evidenceRetained
          // Keep the source's own `stale`: it is why the claim was withheld, and
          // collapsing it to `measured` would erase the reason.
          ? (explicitWithheldState === DATA_STATES.stale ? DATA_STATES.stale : DATA_STATES.measured)
          : DATA_STATES.noData,
      absence: {
        kind: "withheld",
        reason: evidenceRetained
          ? `${withheldReason} The measurement IS present in this payload — what is withheld is the CLAIM, `
            + "not the data. Reason over it as evidence; do not publish it as a current reading."
          : withheldReason,
      },
      sourceError: null,
    };
  }

  const collections = inspectCollections(d, adapter);
  const explicitState = String(d.dataState ?? d.data_state ?? "").trim().toLowerCase();
  const notReturnedCount = Array.isArray(d.notReturned) ? d.notReturned.length : 0;
  const hasFinding = collections.nonEmpty || hasObjectFinding(d, adapter) || hasAdapterReading(d, adapter);

  const verifiedEmptySentiment = classifyVerifiedEmptySentiment(tool, d);
  if (verifiedEmptySentiment) return verifiedEmptySentiment;

  if (adapter.operation && hasFinding) {
    return {
      responseState: explicitState === DATA_STATES.noData ? RESPONSE_STATES.partial : RESPONSE_STATES.findings,
      dataState: explicitState === DATA_STATES.noData ? DATA_STATES.noData : DATA_STATES.measured,
      absence: explicitState === DATA_STATES.noData
        ? { kind: "no_coverage", reason: "The operation succeeded, but the resulting market judgment has no usable measurement." }
        : null,
      sourceError: null,
    };
  }

  if (hasFinding && (explicitState === DATA_STATES.noData || explicitState === DATA_STATES.notInstrumented)) {
    return {
      responseState: RESPONSE_STATES.partial,
      dataState: explicitState === DATA_STATES.notInstrumented ? DATA_STATES.notInstrumented : DATA_STATES.noData,
      absence: {
        kind: "source_unverified",
        reason: "The payload contains a returned resource or row but its upstream data state says coverage is absent; both facts are preserved for reconciliation.",
      },
      sourceError: null,
    };
  }

  if (hasFinding && !hasZeroEvidence(d, adapter)) {
    return {
      responseState: notReturnedCount > 0 || statusText(d) === "PARTIAL" ? RESPONSE_STATES.partial : RESPONSE_STATES.findings,
      dataState: explicitState === DATA_STATES.stale ? DATA_STATES.stale : DATA_STATES.measured,
      absence: null,
      sourceError: null,
    };
  }

  if (collections.present || hasZeroEvidence(d, adapter) || Number(d.count) === 0) {
    // An explicit measured state is proof the source completed. Endpoint
    // fallbacks such as source_unverified apply only when upstream supplied no
    // trustworthy coverage state at all.
    if (explicitState === DATA_STATES.measured) {
      return emptyClassification(adapter.emptyKind === "user_empty" ? "user_empty" : "measured_empty");
    }
    return emptyClassification(adapter.emptyKind);
  }

  if (explicitState === DATA_STATES.notInstrumented) {
    return {
      responseState: RESPONSE_STATES.noCoverage,
      dataState: DATA_STATES.notInstrumented,
      absence: { kind: "no_coverage", reason: "The required source is not instrumented." },
      sourceError: null,
    };
  }
  if (explicitState === DATA_STATES.noData) return emptyClassification(adapter.emptyKind);

  // 🔴 ABSENCE MUST BE EARNED. Reaching here means the adapter recognised
  // nothing — which is NOT the same fact as the source returning nothing. If
  // substantive content is sitting in the payload, saying "no coverage" is a
  // false claim about our own data, and a compliant agent will discard a real
  // reading because the contract tells it absence is unknown-not-safe.
  const unrecognised = unrecognisedEvidenceKeys(d, adapter);
  if (unrecognised.length) {
    return {
      responseState: RESPONSE_STATES.findings,
      dataState: DATA_STATES.measured,
      absence: null,
      sourceError: null,
      adapterGap: unrecognised,
    };
  }

  // An aggregate is a finding only for a tool that explicitly declares its
  // reading/object keys. Generic prose, disclaimers, timestamps, and zero-valued
  // summaries are not evidence.
  return emptyClassification(adapter.emptyKind);
}

function asOfFor(d: Record<string, unknown>): string {
  const raw = d.asOf ?? d.as_of ?? d.dataAsOf ?? d.updatedAt ?? d.timestamp ?? d.checkedAt;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * 🔴 A DECLARED SCALE THAT NEVER LOOKED AT THE VALUE (R7, measured live 2026-08-27)
 *
 * `fahali_get_realtime_alerts` returned `signals[].confidence` of 79, 83, 77,
 * 43 and 80 — and this function typed that path `scale: "0-1"`. The scale was
 * not derived, checked, or declared by anyone: it was the `?? "0-1"` fallback
 * on the line below, a literal standing in for a measurement.
 *
 * An agent obeying our own `confidenceRule` ("read each score only with its
 * scoreType, scale and calibrationStatus") reads `confidence: 79` on a 0-1
 * scale as either 7900% or, after clamping, certainty. That is the exact shape
 * of [[urgency was confidence and it gated exit]], where a 0-10 column read as
 * 0-100 inverted a sell gate.
 *
 * Four lines below, `riskScore` did the same job correctly. One function, two
 * standards.
 *
 * ── The fix is NOT to sniff the value ───────────────────────────────────────
 * `Number(v.confidence) > 1 ? "0-100" : "0-1"` is a heuristic wearing a
 * derivation's clothes: `confidence: 1` is ambiguous in both directions, and a
 * genuinely 0-100 field reporting 0.97 gets mislabelled. Instead:
 *
 *   1. The PRODUCER declares `confidenceScale` at the line that mints the value.
 *   2. An absent declaration renders as `scale: null` + `scaleBasis:
 *      "undeclared"` — never as a confident "0-1". [[a default arm is an
 *      unconditional claim]].
 *   3. The value is a CROSS-CHECK that disagrees loudly: a declared 0-1 path
 *      holding values above 1 emits `scaleConflict` naming both.
 *
 * `observedRange` is the evidence for (3). It is not the sampled scalar that
 * was deliberately removed below — a sample of one row misrepresents the other
 * rows, whereas min/max across every row at the path is a property OF the path,
 * which is precisely what this entry exists to state.
 */
type ScaleAccumulator = {
  scoreType: string;
  scale: string | null;
  calibrationStatus: "calibrated" | "uncalibrated" | "not_applicable" | "unverified";
  isProbability: boolean;
  min: number;
  max: number;
  rowsSeen: number;
};

function confidenceSemanticsFor(d: Record<string, unknown>): Array<Record<string, unknown>> {
  const byField = new Map<string, ScaleAccumulator>();
  /**
   * 🔴 THE AGGREGATION USED TO READ FIVE ROWS AND CLAIM IT READ THEM ALL.
   *
   * The array descent below was `child.slice(0, 5)` while every entry shipped
   * `appliesTo: "every row at this path"`. Live on 2026-08-28, one contagion
   * response declared `edges[].confidence` as [0.54, 0.74] and carried 0.46 and
   * 0.84 in the same payload; a portfolio response declared min 0.5422 over a
   * row holding 0.4545.
   *
   * Worse than the wrong range: `scaleConflict` is derived from this `max`, so
   * the ONE check that catches a producer breaking its declared scale could not
   * see past row five. A path whose first five rows sit under 1 and whose
   * fortieth holds 79 published `scale: "0-1"` with no conflict — the exact
   * defect [[every label needs a source]] was filed for.
   *
   * The docblock above always said "across EVERY row at the path". The slice
   * contradicted the stated intent; this restores it, with a budget so a
   * pathological payload degrades into an HONEST partial claim rather than a
   * silent one. `visitBudget` is generous: responses are already projected by
   * `limit` (max 100), so a normal payload never approaches it.
   */
  let visitBudget = 50_000;
  let aggregationComplete = true;
  const push = (
    field: string,
    value: unknown,
    scoreType: string,
    scale: string | null,
    calibrationStatus: "calibrated" | "uncalibrated" | "not_applicable" | "unverified",
    isProbability: boolean,
  ) => {
    const n = num(value);
    if (n === null) return;
    // Accumulate rather than first-wins: the range across EVERY row at this
    // path is what makes a units mismatch visible. First-wins would have typed
    // the realtime path from whichever row came back first and learned nothing
    // from the other 49.
    const existing = byField.get(field);
    if (existing) {
      existing.min = Math.min(existing.min, n);
      existing.max = Math.max(existing.max, n);
      existing.rowsSeen += 1;
      return;
    }
    byField.set(field, { scoreType, scale, calibrationStatus, isProbability, min: n, max: n, rowsSeen: 1 });
    /**
     * 🔴 `value` IS DELIBERATELY GONE (R6, 2026-08-27).
     *
     * The entry types a WILDCARD path — `data[].verdict.urgencyScore` — and
     * carried a single scalar sampled from whichever row happened to supply
     * one. Live: the entry shipped `value: 8` while all three returned rows
     * held `urgencyScore: null`. A number that appears nowhere in the response
     * it describes is worse than no number, because a reader has no way to know
     * it is a sample. The same call typed `confidence` as 0.96 across rows
     * holding 0.96, 0.88 and 0.83.
     *
     * This entry's job is to TYPE THE PATH — what the score means, its scale,
     * whether it is calibrated, whether it is a probability. That job needs no
     * value at all, and the values are already in the rows. `sampledFrom`
     * The values are in the rows; this block says how to read them.
     */
  };
  const visit = (v: unknown, path = "", depth = 0) => {
    if (depth > 4 || !isObj(v)) return;
    // No `?? "0-1"`. Nothing populated `confidenceScale`, so that fallback was
    // the sole author of every scale we published — a literal presented as a
    // measurement. Undeclared now reads as undeclared.
    const scale = str(v.confidenceScale) ?? str(v.scoreScale) ?? null;
    const actionability = str(v.actionability)?.toUpperCase();
    const direction = str(v.direction)?.toLowerCase();
    const reportedType =
      actionability === "ABSTAIN" || direction === "unknown"
        ? "abstention_confidence"
        : scale === "ensemble_agreement"
          ? "ensemble_agreement"
          : "directional_confidence";
    /**
     * 🔴 `"calibrated"` was a LITERAL on a field named `probability`.
     *
     * The doctrine is explicit: no field may be named `probability` unless it
     * is calibrated, with target event, horizon and calibration record
     * attached. This line asserted the calibration rather than reading it — so
     * the one guarantee that licenses the word was the thing being assumed.
     *
     * Calibration is now a claim the producer must carry. Absent a record, the
     * number is still served (it is data), but `quotableAsLikelihood` goes
     * false and the status reads `unverified` — never `calibrated`.
     */
    const probCalibration = isObj(v.calibration)
      ? v.calibration
      : isObj(v.outcomeProbabilityCalibration)
        ? v.outcomeProbabilityCalibration
        : null;
    push(
      `${path}outcomeProbability`,
      v.outcomeProbability,
      "outcome_probability",
      "0-1",
      probCalibration && str(probCalibration.record) ? "calibrated" : "unverified",
      true,
    );
    /**
     * 🔴 NAME THE PATH AFTER THE KEY THAT ACTUALLY HELD THE VALUE.
     *
     * This pushed the literal path `detectionConfidence` while reading through
     * three aliases. `fahali_get_capital_flow` returns `detectionScore`, so the
     * envelope told every agent to read `data[].detectionConfidence` — a path
     * that does not exist in the response. Caught by the payload-derived
     * invariant on its first run; A3 could never see it, because it only ever
     * compared the label with the range, and both were computed from the same
     * mis-named entry.
     */
    const detectionKey = ["detectionConfidence", "detection_confidence", "detectionScore", "detection_score"].find(
      (k) => v[k] !== undefined && v[k] !== null,
    );
    if (detectionKey) {
      push(`${path}${detectionKey}`, v[detectionKey], "uncalibrated_engine_score", "0-1", "uncalibrated", false);
    }
    push(`${path}confidence`, v.confidence, reportedType, scale, "uncalibrated", false);
    push(`${path}riskScore`, v.riskScore, "risk_score", Number(v.riskScore) > 1 ? "0-100" : "0-1", "not_applicable", false);
    // urgencyScore was the ONE unlabelled number in an otherwise scrupulously
    // labelled payload, and it is the field an agent sorts on (re-audit N3).
    // On an ABSTAIN row the upstream value is abstention confidence rescaled —
    // /agent/verdict now withholds it there, and registering it here means a
    // stale cache or a direct caller still gets told what the number is rather
    // than being left to assume it means priority.
    push(
      `${path}urgencyScore`,
      v.urgencyScore,
      actionability === "ABSTAIN" ? "abstention_confidence_rescaled" : "composite_urgency",
      "0-20",
      "uncalibrated",
      false,
    );
    for (const [k, child] of Object.entries(v)) {
      if (isObj(child)) visit(child, `${path}${k}.`, depth + 1);
      else if (Array.isArray(child)) {
        // EVERY element, not the first five. See the note in this function's head.
        for (const item of child) {
          if (!isObj(item)) continue;
          if (visitBudget <= 0) {
            aggregationComplete = false;
            break;
          }
          visitBudget -= 1;
          visit(item, `${path}${k}[].`, depth + 1);
        }
      }
    }
  };
  visit(d);

  return [...byField.entries()].map(([field, a]) => {
    // A scale is only a fact if someone asserted it. Where nobody did, the
    // observed range is all we honestly hold, and an agent is told to treat the
    // score as ordinal rather than guess a denominator.
    const declared = a.scale !== null;
    // Any `0-N` declaration is checkable against what came back, not just 0-1.
    // urgencyScore is declared 0-20 by a literal in this file and is the field
    // an agent sorts on; if a producer ever changes its range, the disagreement
    // surfaces here instead of silently re-scaling someone's ranking.
    const upperBound = declared ? Number(/^0-(\d+(?:\.\d+)?)$/.exec(a.scale as string)?.[1] ?? NaN) : NaN;
    const conflict =
      Number.isFinite(upperBound) && a.max > upperBound
        ? `The producer declares this path as ${a.scale}, but values up to ${a.max} were returned. ` +
          "The declaration and the data disagree; trust NEITHER as a denominator. Treat the score as ordinal " +
          "and rank with it — do not convert it to a percentage or read it as a likelihood."
        : null;
    return {
      field,
      scoreType: a.scoreType,
      scale: a.scale,
      scaleBasis: declared ? "declared_by_producer" : "undeclared",
      scaleNote: declared
        ? undefined
        : "No producer declared a scale for this path. The range below is what was actually returned; " +
          "it is not a denominator. Rank with this score, do not convert it to a percentage.",
      observedRange: { min: a.min, max: a.max, rowsSeen: a.rowsSeen },
      calibrationStatus: a.calibrationStatus,
      isProbability: a.isProbability,
      quotableAsLikelihood: a.isProbability && a.calibrationStatus === "calibrated",
      scaleConflict: conflict,
      // DERIVED, never asserted. "every row" is a coverage claim, and it was
      // a literal sitting over a five-row sample. When the budget truncates the
      // walk the claim narrows to what was actually read, so a reader can tell
      // a complete summary from a partial one.
      appliesTo: aggregationComplete
        ? "every row at this path"
        : `the first ${a.rowsSeen} row(s) at this path — the aggregation was truncated and this range may not cover later rows`,
    };
  });
}

/**
 * Evidence counters — nullable, because a confidently-zeroed count is worse
 * than an absent one.
 *
 * Re-audit N6 (2026-08-27): every response carried
 *   evidenceQuality: {dataState:"measured", measuredEvidenceCount:0,
 *                     proxyEvidenceCount:0, syntheticEvidenceCount:0,
 *                     missingEvidenceCount:0}
 * on the same row as reasoning.toolsUsed ["get_market_state",
 * "analyze_dark_pool","analyze_momentum"] and a non-empty
 * reasoning.missingSignals. Zero of every category while three engines are
 * named as contributing — and missingEvidenceCount:0 was wrong on its own
 * terms.
 *
 * Cause: this only ever looked for a structured `evidence` object with typed
 * sub-arrays. The canonical verdict shape does not have one; it carries
 * `reasoning.toolsUsed` and `reasoning.missingSignals`. So the block was
 * unwired on the flagship path and reported its unwired state as a
 * measurement — the counters are exactly the field an agent uses to weigh how
 * much stands behind a decision.
 *
 * Two changes: read the shapes the payload actually has, and when no evidence
 * structure is found at all, return null with a reason rather than 0.
 */
function evidenceQualityFor(d: Record<string, unknown>, dataState: string): Record<string, unknown> {
  /**
   * 🔴 UNKNOWN FRESHNESS IS NOT FRESH DATA (2026-08-27).
   *
   * `stale` was `dataState === "stale"`, so every response whose age could not
   * be established shipped `stale: false` — a positive assertion of currency —
   * directly beside `freshnessNormalized.known: false`, which says the age is
   * unknown. Measured on three of three live responses. An agent reading
   * `stale: false` has been told the reading is current; nothing measured that.
   *
   * `normalizedFreshness` already computes the honest tri-state (it returns
   * `stale: null` when it holds an age but no window). This reads it rather
   * than asserting a second, weaker answer to the same question.
   */
  const freshness = normalizedFreshness(d) as { known?: boolean; stale?: boolean | null };
  const staleFlag: boolean | null =
    dataState === DATA_STATES.stale
      ? true
      // 🔴 A PARTIAL response cannot assert `stale: false`.
      //
      // Part of its own scope never arrived, and the part that never arrived has
      // no freshness at all — so "not stale" would claim currency for data we do
      // not have. `true` stays assertable, because it is a positive finding
      // about what DID arrive; only the reassuring answer is unearned.
      //
      // Surfaced by the invariant sweep on `fahali_analyze_custom_portfolio`
      // 2026-09-04, and it was latent until the same day's freshness-vocabulary
      // fix moved many payloads from `known: false` to `known: true`. Widening
      // what the envelope can read turned a dormant inconsistency into a
      // measurable one — which is the fix working, not a regression from it.
      : dataState === DATA_STATES.partial
        ? (freshness.known === true && freshness.stale === true ? true : null)
        : freshness.known === true ? freshness.stale ?? null : null;
  let measured = 0, proxy = 0, synthetic = 0, missing = 0, consulted = 0;
  let sawEvidenceStructure = false;
  // Only a typed `evidence` object says what was MEASURED vs PROXY.
  let sawTypedEvidence = false;
  const sources = new Set<string>();

  const visit = (v: unknown, depth = 0) => {
    if (depth > 4 || !isObj(v)) return;
    if (isObj(v.evidence)) {
      sawEvidenceStructure = true;
      sawTypedEvidence = true;
      sources.add("evidence");
      measured += Array.isArray(v.evidence.measured) ? v.evidence.measured.length : 0;
      proxy += Array.isArray(v.evidence.proxy) ? v.evidence.proxy.length : 0;
      synthetic += Array.isArray(v.evidence.synthetic) ? v.evidence.synthetic.length : 0;
      missing += Array.isArray(v.evidence.missing) ? v.evidence.missing.length : 0;
    }
    // The canonical verdict's own vocabulary. A tool the reasoning CONSULTED is
    // not thereby a measurement (2026-10-06): on MSFT the three tools counted as
    // "measured" included `analyze_dark_pool`, a bar-volume heuristic, while the
    // committee in the same payload said 0 measured / 25 proxy. Consulted tools
    // are reported as consulted; the measured count stays unknown unless a typed
    // evidence breakdown says otherwise.
    const tools = v.toolsUsed ?? v.tools_used;
    if (Array.isArray(tools) && tools.length) {
      sawEvidenceStructure = true;
      sources.add("reasoning.toolsUsed");
      consulted += tools.length;
    }
    const absent = v.missingSignals ?? v.missing_signals;
    if (Array.isArray(absent) && absent.length) {
      sawEvidenceStructure = true;
      sources.add("reasoning.missingSignals");
      missing += absent.length;
    }
    for (const child of Object.values(v)) {
      if (isObj(child)) visit(child, depth + 1);
      else if (Array.isArray(child)) for (const item of child.slice(0, 10)) if (isObj(item)) visit(item, depth + 1);
    }
  };
  visit(d);

  if (!sawEvidenceStructure) {
    return {
      dataState,
      measuredEvidenceCount: null,
      proxyEvidenceCount: null,
      syntheticEvidenceCount: null,
      missingEvidenceCount: null,
      countedFrom: [],
      reason:
        "This response carries no evidence breakdown, so the counts are unknown — not zero. " +
        "Do not read an absent count as an absence of evidence.",
      stale: staleFlag,
    };
  }
  return {
    dataState,
    measuredEvidenceCount: sawTypedEvidence ? measured : null,
    proxyEvidenceCount: sawTypedEvidence ? proxy : null,
    syntheticEvidenceCount: sawTypedEvidence ? synthetic : null,
    missingEvidenceCount: missing,
    toolsConsultedCount: consulted,
    ...(sawTypedEvidence ? {} : { measuredReason: "Tools the reasoning consulted are listed, but nothing here grades them measured or proxy — so the measured count is unknown, not zero." }),
    // Say where the counts came from. Two payload shapes feed this, and an
    // agent comparing counts across tools needs to know it is comparing like
    // with like.
    countedFrom: [...sources],
    reason: null,
    stale: staleFlag,
  };
}

type PortfolioDirectionAuthorityStatus = "AVAILABLE" | "WITHHELD" | "ABSENT";

/**
 * The stateless portfolio surfaces carry two deliberately separate readings:
 * a canonical symbol direction and an alert-derived monitoring label. Adapt
 * the former into the standard decision vocabulary without ever borrowing
 * direction or actionability from the latter.
 */
function portfolioDirectionAuthorityOf(row: Record<string, unknown>) {
  const reconciliation = isObj(row.authorityReconciliation)
    ? row.authorityReconciliation
    : null;
  const directionAuthority = reconciliation && isObj(reconciliation.directionAuthority)
    ? reconciliation.directionAuthority
    : null;
  if (str(directionAuthority?.authority) !== "canonical_symbol_verdict") return null;

  const rawStatus = String(directionAuthority?.status ?? "").toUpperCase();
  if (!["AVAILABLE", "WITHHELD", "ABSENT"].includes(rawStatus)) return null;
  const status = rawStatus as PortfolioDirectionAuthorityStatus;
  const actionability = reconciliation && isObj(reconciliation.portfolioActionability)
    ? reconciliation.portfolioActionability
    : null;
  const direction = status === "AVAILABLE" ? str(directionAuthority?.direction) : null;
  const availableWithoutDirection = status === "AVAILABLE" && !direction;

  return {
    status,
    canonical: {
      ...directionAuthority,
      state: str(directionAuthority?.canonicalState),
      direction,
      // A stateless portfolio read may expose canonical direction, but it may
      // not turn that into a mandate-aware portfolio action. WITHHELD/ABSENT
      // are canonical abstentions; a malformed AVAILABLE row also fails shut.
      actionability: status === "AVAILABLE" && !availableWithoutDirection ? null : "ABSTAIN",
      abstainReason: status === "AVAILABLE" && !availableWithoutDirection
        ? null
        : str(directionAuthority?.reason) ??
          (availableWithoutDirection
            ? "The canonical direction was marked available but no direction value was returned."
            : null),
    } as Record<string, unknown>,
    portfolioActionability: str(actionability?.state),
    mandateApplied:
      actionability?.mandateApplied === true
        ? true
        : actionability?.mandateApplied === false
          ? false
          : null,
    bindingSurface: str(actionability?.bindingSurface),
  };
}

function isAbstainRow(row: Record<string, unknown>): boolean {
  const portfolioAuthority = portfolioDirectionAuthorityOf(row);
  if (portfolioAuthority) {
    return portfolioAuthority.status !== "AVAILABLE" ||
      String(portfolioAuthority.canonical.actionability ?? "").toUpperCase() === "ABSTAIN";
  }
  const verdict = isObj(row.verdict) ? row.verdict : null;
  const canonical = isObj(row.canonical) ? row.canonical : null;
  return String(verdict?.actionability ?? canonical?.actionability ?? "").toUpperCase() === "ABSTAIN";
}

export type DecisionSelection = {
  basis: "leading_row" | "aggregate" | "single_row";
  rankedBy: string;
  among: number;
  selected: string | null;
  isAggregate: boolean;
  actionableAvailable: number;
  /**
   * Rows that carry a judgment-shaped object whose fields this envelope could
   * NOT read. Present only when non-zero. These are a Fahali mapping gap to
   * report — never a finding that the market is quiet.
   */
  judgmentUnreadable?: number;
  note: string;
};

/**
 * Pick which row becomes the top-level decision, and say so out loud.
 *
 * Re-audit N7: on a market-wide call the top-level decision read "Withheld —
 * not enough validated evidence on UPST." UPST is one small-cap lender out of
 * 24 instruments. There was no selection rule, no ranking, and no disclosure
 * that this was one row rather than a market judgment — while the tool
 * description called it "a thin alias over the canonical verdict arbiter."
 *
 * 🔴 N3 and N7 are the SAME BUG. The source orders rows
 * `ORDER BY urgency_score DESC NULLS LAST, confidence DESC` (routes.ts:1096),
 * and urgency_score is written as `conf * 10`
 * (spectra_master_agent.py:349) — so the ordering is confidence, twice. On a
 * verdict that ABSTAINS, that confidence is ABSTENTION confidence. The market
 * headline was therefore, systematically, the symbol Fahali was most certain it
 * had nothing to say about. UPST at 0.96 was not an unlucky draw; it was the
 * designed outcome.
 *
 * Preferring an ACTIONABLE row is a selection among real rows, never a
 * fabrication: if every row abstains, the headline still abstains and says so.
 * get_lead_time already solved this shape with headlineSelection; this is the
 * same disclosure for the decision surface.
 */
/**
 * 🔴 ONE READING OF A JUDGMENT. Both the COUNTER and the PROMOTER use it.
 *
 * The sweep found the same class of bug twice in one hour, in opposite
 * directions, because two functions each had their own idea of what a judgment
 * is:
 *
 *   1. `actionableAvailable: 50` beside `decisionState: unmapped_source_shape`
 *      — the counter accepted a verdict-shaped object the promoter could not read.
 *   2. `actionableAvailable: 2` beside `decision: null` — after fixing (1), the
 *      counter read the ROW's flat fields while the promoter read only nested
 *      objects and top-level fallbacks. I introduced this one fixing the other.
 *
 * Patching vocabularies separately guarantees a third. So there is now exactly
 * one extraction: whatever it can read is what gets counted AND what gets
 * promoted, and the two cannot drift.
 *
 * `fallback` is the response-level object. It applies only when PROMOTING (the
 * response as a whole may carry a headline), never when COUNTING — a top-level
 * headline is not evidence that this particular instrument was judged.
 */
function judgmentOf(
  row: Record<string, unknown> | null | undefined,
  fallback?: Record<string, unknown>,
) {
  const r = isObj(row) ? row : {};
  const f = isObj(fallback) ? fallback : {};
  const portfolioAuthority = portfolioDirectionAuthorityOf(r);
  const canonical = portfolioAuthority?.canonical ??
    (isObj(r.canonical) ? r.canonical : null) ??
    (isObj(f.canonical) ? f.canonical : null);
  const verdict = (isObj(r.verdict) ? r.verdict : null) ?? (isObj(f.verdict) ? f.verdict : null);
  const decision = (isObj(r.decision) ? r.decision : null) ?? (isObj(f.decision) ? f.decision : null);
  const claim = isObj(r.claim) ? r.claim : null;
  const recommendation = isObj(r.recommendation) ? r.recommendation : null;
  const src = canonical ?? decision ?? claim ?? verdict;
  // A judged-record GRADE is a judgment (2026-10-11). `fahali_get_lead_time` strata and
  // trackRecord rows carry `verdict: {grade, label, probabilityOfSkill, reason}` (the
  // forecast-verification grade of the stratum) and `horizon_tier`; none of the readers
  // below knew those names, so the sweep reported judgmentUnreadable=7 of 7 and an agent
  // received the numbers without the judgment that makes them quotable.
  const recordGrade =
    isObj(verdict) && typeof (verdict as any).grade === "string" && typeof (verdict as any).label === "string"
      ? (verdict as Record<string, unknown>)
      : null;
  const recordGradeHeadline = recordGrade
    ? [str(recordGrade.label), str(recordGrade.reason)].filter(Boolean).join(" — ") || null
    : null;
  const recordGradeActionability = recordGrade
    ? r.publishable === true
      ? "PUBLISHABLE_RECORD"
      : r.publishable === false
        ? "MEASURED_BELOW_BAR"
        : "GRADED_RECORD"
    : null;
  /**
   * 🔴 THE ENVELOPE HAD ONE CONCEPT WHERE FAHALI HAS TWO.
   *
   * `claim.kind` is a real, enumerated Fahali vocabulary — `abstention`,
   * `forecast`, `recommendation`, `observation`. The first two are directional
   * judgments; the last two are NOT, and never were. Reading only the canonical
   * verdict shape meant every non-directional row reported as
   * `unmapped_source_shape` / `judgmentUnreadable`, which says "Fahali could not
   * read this" about a row Fahali authored and understands perfectly.
   *
   * Live 2026-08-28: `analyze_custom_portfolio` returned eight rows each
   * carrying `claim.kind: "recommendation"` and a rationale, and the envelope
   * reported `judgmentUnreadable: 8, actionableAvailable: 0`. Both numbers were
   * false — the rows are readable, and they are not directional calls.
   *
   * ⚠️ What this deliberately does NOT do: promote `action: "reduce"` into
   * `state`/`actionability`. Those carry the canonical vocabularies
   * (`NORMAL|WATCH|DEFEND|WITHHOLD`, `ACTIONABLE|ABSTAIN`) owned by the verdict
   * arbiter. On 2026-08-28 the arbiter ABSTAINED on BTCUSDT at 1% confidence in
   * the same minute this tool said "reduce" — promoting an alert-density
   * observation into the field an agent reads first would publish, as Fahali's
   * binding judgment, a call the authority declined to make. The rationale is
   * carried; the vocabulary is not borrowed.
   */
  const declaredKind = str(claim?.kind)?.toLowerCase() ?? null;
  /**
   * Two further Fahali shapes that carry a claim WITHOUT a `claim.kind`, both
   * still reporting as `judgmentUnreadable` after the vocabulary above landed
   * (measured by the sweep, 2026-08-28):
   *
   *   operational alert  `fahali_get_realtime_alerts` — 50 of 50 rows, keyed
   *                      `actionType/actionLabel/actionPlan/conviction/...`.
   *                      `MOMENTUM_FADING` is a detected PHENOMENON, not an
   *                      actionability, so its own sentence is carried and the
   *                      canonical fields stay null. This is the shape the
   *                      2026-08-27 note declined to map; declining left the
   *                      count lying instead.
   *   fact check         `fahali_fact_check_narrative` — `assertions[]` keyed
   *                      `{text, verdict, safeToRepeat, explanation}`. Its
   *                      verdict vocabulary (SUPPORTED / CONTRADICTED /
   *                      UNVERIFIABLE / …) judges a SENTENCE, not an
   *                      instrument, and must never be written into a field
   *                      that means "Fahali's market read".
   *
   * Both are read, both are non-directional. Recognising a shape is not the
   * same as borrowing its neighbour's vocabulary.
   */
  // ⚠️ These live on the row's `verdict` OBJECT, not on the row. Checking only
  // the row left all 50 rows reporting unreadable after the shape was
  // "recognised" — a fix that reads the wrong level is not a fix.
  const operationalAlert =
    verdict?.actionType !== undefined ||
    verdict?.actionLabel !== undefined ||
    r.actionType !== undefined ||
    r.actionLabel !== undefined;
  const factCheck = typeof r.verdict === "string" && r.safeToRepeat !== undefined;
  const claimKind = declaredKind ?? (operationalAlert ? "alert" : factCheck ? "fact_check" : null);
  const nonDirectionalKind =
    !portfolioAuthority &&
    (claimKind === "recommendation" || claimKind === "observation" || claimKind === "alert" || claimKind === "fact_check");
  return {
    src,
    canonical,
    verdict,
    portfolioAuthority,
    claimKind,
    nonDirectionalKind,
    // `stance`, `action`, `why` and `directionalState` are the conviction
    // surface's own vocabulary for exactly these fields — a real Fahali shape,
    // not a guess. Reading them here is what stops that surface reporting
    // available actions it then cannot describe.
    state: portfolioAuthority
      ? str(src?.state)
      : str(src?.state) ?? str(r.state) ?? str(r.stance) ?? str(r.directionalState) ?? str(f.state)
        ?? (recordGrade ? str(recordGrade.grade) : null) ?? null,
    headline: portfolioAuthority
      ? str(src?.headline)
      : str(src?.headline) ??
        str(r.headline) ??
        str(r.why) ??
        // A non-directional claim states itself HERE. Carrying it is faithful:
        // it is the producer's own sentence, not a vocabulary borrowed from the
        // arbiter.
        str(recommendation?.rationale) ??
        // Each non-canonical shape states itself in its own field. Carrying that
        // sentence is faithful; inventing a state from it would not be.
        str(verdict?.actionLabel) ??
        str(verdict?.narrative) ??
        str(r.actionLabel) ??
        str(r.narrative) ??
        str(r.explanation) ??
        str(f.headline) ??
        str(f.summary) ??
        str(f.message) ??
        recordGradeHeadline ??
        null,
    direction: portfolioAuthority
      ? str(src?.direction)
      : str(src?.direction) ?? str(r.direction) ?? str(f.direction) ?? null,
    // `claim.kind: "abstention"` IS an abstention — that is what the word means
    // in Fahali's own claim vocabulary, so reading it is a translation, not an
    // invention. `recommendation`/`observation` get no actionability at all.
    actionability: portfolioAuthority
      ? str(src?.actionability)
      : str(verdict?.actionability) ??
        str(r.actionability) ??
        (claimKind === "abstention" ? "ABSTAIN" : null) ??
        str(r.action) ??
        recordGradeActionability ??
        null,
    abstainReason: portfolioAuthority
      ? str(src?.abstainReason)
      : str(verdict?.abstainReason) ??
        str(r.abstentionReason) ??
        str(r.directionalWithheldReason) ??
        str(f.abstentionReason) ??
        null,
    // When canonical is present it owns the binding claim and its horizon.
    // `verdict.forecastHorizon` is the legacy agent-event horizon; allowing it
    // to lead re-stratified a canonical 72h decision as 12h/7d depending on the
    // compatibility row that happened to carry it.
    horizon: str(canonical?.horizon) ?? str(verdict?.forecastHorizon) ?? str(r.horizon) ?? str(r.horizon_tier) ?? str(f.horizon) ?? null,
  };
}

/** A judgment is READABLE when this envelope can extract at least one field of it. */
function readableJudgment(row: Record<string, unknown>): boolean {
  const j = judgmentOf(row);
  return [j.state, j.headline, j.direction, j.actionability, j.abstainReason, j.horizon].some(
    (v) => v !== null && v !== undefined,
  );
}
function pickLeadRow(
  tool: string,
  d: Record<string, unknown>,
): { row: Record<string, unknown> | undefined; selection: DecisionSelection | null } {
  // A bundle's rows live inside views.market_decision.data, so rowsOf finds
  // nothing at the top level and the promoted decision arrived with
  // actionability, abstainReason and horizon all null — while the identical
  // decision inside the view had all three (re-audit N7, "promotion is lossy").
  // Reach into the view so promotion is field-complete or not made at all.
  const bundleRows =
    isObj(d.views) && isObj((d.views as Record<string, unknown>).market_decision)
      ? rowsOf((d.views as Record<string, Record<string, unknown>>).market_decision, "fahali_get_market_decision")
      : [];
  const rows = rowsOf(d, tool).length ? rowsOf(d, tool) : bundleRows;
  if (!rows.length) return { row: undefined, selection: null };

  /**
   * 🔴 A ROW IS NOT A JUDGMENT BECAUSE IT IS A ROW (2026-08-27).
   *
   * `fahali_get_capabilities` returned `actionableAvailable: 47` with a note
   * reading "47 instruments were judged" — while `instruments: []` and
   * `symbolCoverage.returned: []`. The 47 were TOOL DEFINITIONS: the adapter
   * declares `collections: ["tools","resources"]`, so every schema entry
   * became a "row", and nothing about a schema entry looks like an abstention.
   *
   * Counting rows was never a measure of judgment. A row qualifies only if it
   * carries instrument identity or a decision structure — which a tool
   * definition, an engine-health probe and a raw price tick all fail, and which
   * every genuine verdict row passes.
   *
   * When NOTHING qualifies there is no decision to promote, so none is made:
   * that is also the fix for promoting the first row of a tool that produces no
   * decisions at all.
   */
  /**
   * ⚠️ HAVING A SYMBOL IS NOT HAVING A JUDGMENT.
   *
   * An earlier pass allowed instrument identity ALONE to qualify, which left
   * the audit's headline example untouched: `market_snapshot` returns 680 rows
   * of `{symbol, price}`, none of which is a decision, and all 680 were counted
   * as actionable. Same for `contagion_map`'s 127 edges and the correlation
   * rows. A price is an observation; only a claim about it is a judgment.
   *
   * So identity is necessary for a row to be PROMOTABLE, but never sufficient
   * for it to be COUNTED. What qualifies is a decision structure: a verdict, a
   * claim, an actionability, or a direction.
   */
  const carriesJudgment = (row: Record<string, unknown>): boolean =>
    isObj(row.decision) ||
    isObj(row.claim) ||
    isObj(row.canonical) ||
    isObj(row.authorityReconciliation) ||
    row.actionability !== undefined ||
    row.verdict !== undefined ||
    row.direction !== undefined ||
    row.recommendation !== undefined;

  /**
   * 🔴 CLAIMING TO BE JUDGED IS NOT THE SAME AS BEING READABLE (sweep, 2026-08-27).
   *
   * `carriesJudgment` above passes on `row.verdict !== undefined` — the mere
   * PRESENCE of a verdict-shaped object. But `decisionFor` reads specific
   * fields (state / headline / direction / actionability / abstainReason /
   * horizon), and the realtime verdict shape carries none of them. So the two
   * functions described one call and disagreed:
   *
   *   decisionSelection: { actionableAvailable: 50, note: "50 instruments were judged" }
   *   decision:          { …every field null, decisionState: "unmapped_source_shape" }
   *
   * Measured across the tool sweep, that disagreement was live on THREE tools
   * (`realtime_alerts`, `highest_conviction_signals`, `analyze_custom_portfolio`)
   * — so the audit's headline finding, "actionableAvailable counts rows rather
   * than decisions", was only half fixed. Requiring a decision STRUCTURE closed
   * the `{symbol, price}` case; it did not close the case of a structure whose
   * contents the envelope cannot read.
   *
   * A count of actions an agent cannot act on is worse than no count.
   *
   * `readableJudgment` applies exactly the read `decisionFor` performs, on the
   * ROW alone (no top-level fallbacks — those describe the response, not this
   * instrument). Rows that claim judgment but yield nothing are still counted,
   * separately and by name, in `judgmentUnreadable`: they are a mapping gap to
   * report, not rows to hide.
   */

  const judged = rows.filter(carriesJudgment);
  if (!judged.length) return { row: undefined, selection: null };

  const readable = judged.filter(readableJudgment);
  const unreadable = judged.length - readable.length;
  /**
   * A `recommendation`/`observation` row is READABLE and is NOT an available
   * action. Counting it either way is a lie in a different direction: as
   * unreadable it slanders a row Fahali authored, as actionable it advertises a
   * directional call nobody made. It gets its own count.
   */
  const nonDirectional = readable.filter((row) => judgmentOf(row).nonDirectionalKind);
  // Only a READABLE, non-abstaining, DIRECTIONAL row is an available action.
  const actionable = readable.filter((row) => !isAbstainRow(row) && !judgmentOf(row).nonDirectionalKind);
  const nonDirectionalNote = nonDirectional.length
    ? ` ${nonDirectional.length} row(s) carry a non-directional claim (recommendation/observation): those are Fahali observations, not directional calls, and are not counted as available actions.`
    : "";
  // Still promote something when nothing is readable, so `decisionFor` reaches
  // its `unmapped_source_shape` branch and DISCLOSES the gap rather than
  // silently returning no decision block at all.
  const chosen = actionable[0] ?? readable[0] ?? judged[0];
  const selected = str(chosen.symbol ?? chosen.ticker ?? chosen.instrument) ?? null;

  if (judged.length === 1) {
    return {
      row: chosen,
      selection: {
        basis: "single_row",
        rankedBy: "not applicable — one row was returned",
        among: 1,
        selected,
        isAggregate: false,
        actionableAvailable: actionable.length,
        ...(unreadable ? { judgmentUnreadable: unreadable } : {}),
        note: unreadable
          ? "The only row in this response carries a judgment this envelope could not read. Read the row itself; do NOT report this as an absence of judgment."
          : "This decision is the only row in the response.",
      },
    };
  }
  return {
    row: chosen,
    selection: {
      basis: "leading_row",
      // Describe the rule THIS function applies, not the upstream SQL. The
      // upstream ORDER BY is a moving part in another repo — restating it here
      // would be a claim about someone else's code on the surface whose entire
      // job is disclosure, and it went stale the moment abstentions began
      // sorting last.
      rankedBy: actionable.length
        ? "first row carrying a directional call, in the order the source returned them"
        : nonDirectional.length && nonDirectional.length === readable.length
          ? // An abstention and a non-directional claim are different states and
            // must not share a sentence: the first says "we looked and cannot
            // say", the second says "this producer does not make that call".
            "first row in the order the source returned them — every readable row carries a NON-DIRECTIONAL claim, not an abstention"
          : readable.length
            ? "first row in the order the source returned them — every readable row in this response ABSTAINS"
            : "first row in the order the source returned them — NO row carried a judgment this envelope could read",
      among: judged.length,
      selected,
      isAggregate: false,
      actionableAvailable: actionable.length,
      ...(unreadable ? { judgmentUnreadable: unreadable } : {}),
      ...(nonDirectional.length ? { nonDirectionalClaims: nonDirectional.length } : {}),
      note: actionable.length
        ? `This is ONE instrument's judgment (${selected}) promoted to the top level, not a market-wide aggregate. ${readable.length} instruments carry a readable judgment; read data[] for the rest.${nonDirectionalNote}`
        : nonDirectional.length && nonDirectional.length === readable.length
          ? `No instrument in this response carries a directional call. All ${readable.length} rows carry NON-DIRECTIONAL claims (recommendation/observation) — Fahali observations that are read and understood, not a mapping gap and not a quiet market. Read each row's claim and rationale; do not report an absence of judgment.`
          : readable.length
            ? `No instrument in this response carries a directional call — all ${readable.length} readable rows abstain. The promoted decision is an abstention and must not be read as a market-wide all-clear.${nonDirectionalNote}`
            : `NONE of the ${judged.length} rows carried a judgment this envelope could read, so there are 0 available actions. That is a Fahali mapping gap, NOT a quiet market — read the rows themselves and report the gap.`,
    },
  };
}

function decisionFor(tool: string, d: Record<string, unknown>): Record<string, unknown> | null {
  const lead = pickLeadRow(tool, d).row;
  // Binding market authority is derived from the selected row only. A
  // response-level decision can describe an aggregate or a different row and
  // remains audit evidence; it is never a fallback for authority fields.
  const selectedRowOnly = MARKET_DIRECTION_TOOLS.has(tool);
  const j = judgmentOf(lead, selectedRowOnly ? undefined : d);
  const { src: source, canonical, state, headline, direction, actionability, abstainReason, horizon } = j;
  if (!source && !headline && !state && !direction && !actionability && !abstainReason) return null;
  const selectedSymbol = str(lead?.symbol ?? lead?.ticker ?? lead?.instrument)?.toUpperCase() ?? null;
  const selectedIdentity = lead ? capturedIdentityOf(lead) : null;
  const selectedIdentityHash = lead
    ? str(lead.sourceIdentityHash ?? lead.source_identity_hash)
    : null;


  /**
   * 🔴 A DECISION WHOSE EVERY FIELD IS NULL IS NOT A DECISION (R7, live 2026-08-27).
   *
   * `fahali_get_realtime_alerts` returned
   *   decision: {state:null, headline:null, direction:null, actionability:null,
   *              abstainReason:null, horizon:null, conflict:false}
   * beside `decisionSelection: {selected:"ERAUSDC", actionableAvailable:50,
   * note:"This is ONE instrument's judgment promoted to the top level"}`.
   *
   * The promotion announced itself and delivered nothing. Cause: `source` was
   * truthy — the row DOES carry a `verdict` — but it is a different verdict
   * shape (`actionType`, `actionLabel`, `actionPlan`, `conviction`, `priority`)
   * from the canonical one this mapper reads. So the guard above passed on the
   * object's existence while not one of its keys was understood.
   *
   * This is [[absence renders as safety]] at the decision layer, and it is the
   * same lesson as the adapterGap work: a mapper must distinguish "the source
   * said nothing" from "the source said something I cannot read". We do NOT
   * invent a mapping here — `actionType: MOMENTUM_FADING` is not an
   * actionability in the ABSTAIN/ACT sense, and guessing would manufacture a
   * judgment. We name the gap and point at the row, which keeps the DATA and
   * withholds the CLAIM.
   */
  const mapped = { state, headline, direction, actionability, abstainReason, horizon };
  const readable = Object.entries(mapped).filter(([, v]) => v !== null && v !== undefined);
  if (!readable.length && source) {
    return {
      symbol: selectedSymbol,
      ...(selectedIdentity ? { instrumentIdentity: selectedIdentity } : {}),
      ...(selectedIdentityHash ? { sourceIdentityHash: selectedIdentityHash } : {}),
      state: null,
      headline: null,
      direction: null,
      actionability: null,
      abstainReason: null,
      horizon: null,
      // `false` here asserted "no conflict" from a source none of whose keys
      // were read. Unknown, not clear.
      conflict: null,
      decisionState: "unmapped_source_shape",
      unmappedFrom: Object.keys(source).slice(0, 12),
      unmappedNote:
        "A judgment-bearing object was found on the selected row, but none of the fields this decision " +
        "envelope reads were present on it — so there is no promoted decision, and the nulls above are a " +
        "mapping gap, NOT a finding of 'no signal'. The source keys are named in `unmappedFrom`; read the " +
        "row itself for what it actually says, and do not report this response as an absence of judgment.",
    };
  }

  const canonicalConflict = canonical?.conflict;
  const selectedConflict = canonicalConflict === true || (
    isObj(canonicalConflict) &&
    canonicalConflict.resolved !== true &&
    str(canonicalConflict.status)?.toLowerCase() !== "resolved"
  );

  return {
    symbol: selectedSymbol,
    ...(selectedIdentity ? { instrumentIdentity: selectedIdentity } : {}),
    ...(selectedIdentityHash ? { sourceIdentityHash: selectedIdentityHash } : {}),
    state: state ?? null,
    headline: headline ?? null,
    direction: direction ?? null,
    actionability,
    abstainReason,
    horizon,
    conflict: selectedConflict || (!selectedRowOnly && Number((d as any).conflictScore ?? 0) > 0),
    ...(j.portfolioAuthority
      ? {
          decisionState: j.portfolioAuthority.status === "AVAILABLE"
            ? "canonical_direction_available"
            : j.portfolioAuthority.status === "WITHHELD"
              ? "canonical_direction_withheld"
              : "canonical_direction_absent",
          directionAuthority: "canonical_symbol_verdict",
          directionAuthorityStatus: j.portfolioAuthority.status,
          portfolioActionability: j.portfolioAuthority.portfolioActionability,
          mandateApplied: j.portfolioAuthority.mandateApplied,
          binding: j.portfolioAuthority.mandateApplied === false ? false : null,
          bindingSurface: j.portfolioAuthority.bindingSurface,
        }
      : {}),
    /**
     * A non-directional claim is promoted WITH ITS KIND, so a null `state` is
     * read as "this producer does not make directional calls" rather than as a
     * verdict that came back empty. Without this the two are indistinguishable,
     * and the safe-looking reading is the wrong one.
     */
    ...(j.nonDirectionalKind
      ? {
          decisionState: "non_directional_claim",
          claimKind: j.claimKind,
          claimNote:
            `This row carries a Fahali ${j.claimKind}, not a directional verdict. \`state\`, \`direction\` and ` +
            "`actionability` are null because this producer does not make directional calls — NOT because a " +
            "verdict was withheld. The canonical arbiter may abstain on the same instrument at the same moment; " +
            "call fahali_get_symbol_decision for the binding directional read before acting.",
        }
      : {}),
  };
}

/**
 * Containers a producer may nest its identity inside. Deliberately a NAMED set
 * rather than a free walk: descending arbitrary keys would eventually reach an
 * `evidence[]` or a peer row and attach ANOTHER instrument's identity, which is
 * the exact contamination the identity contract exists to prevent.
 */
const IDENTITY_CONTAINER_KEYS = ["details", "_raw", "data", "metadata", "payload"] as const;
const IDENTITY_SEARCH_MAX_DEPTH = 4;

/**
 * 🔴 A RESOLVED IDENTITY WAS BEING REPORTED AS `partial`. (fixed 2026-09-04)
 *
 * This read `row.instrumentIdentity` at the ROW TOP LEVEL only. Detection rows
 * do not carry it there. Measured on a live `fahali_get_realtime_alerts`
 * payload: ETHUSDT's identity sat at `details.instrumentIdentity` and the
 * anomaly rows' at `details._raw.instrumentIdentity` — BOTH declaring
 * `resolutionState: "resolved"`, `canonicalInstrumentId:
 * "binance:crypto:ETH-USDT"`, `resolutionBasis: "venue_asset_list"`. Finding
 * neither, this function fell through to the quote-suffix PARSE and emitted
 * `resolutionState: "partial"`, `canonicalId: null`, plus an ambiguityWarning
 * reading "Venue is missing. Do not equate this symbol with a similarly named
 * instrument on another market."
 *
 * That is the harm: the envelope told an agent NOT to trust an identity the
 * producer had already resolved against a venue asset list. Absence-renders-as-
 * safety, inverted — we understated what we knew, and did it in the one field
 * whose whole job is to say which instrument a claim is about.
 *
 * Two rules make the search safe:
 *  1. Prefer the first candidate declaring `resolved`, NOT the first that
 *     exists — otherwise a shallow partial outranks a deep resolved.
 *  2. Reject any candidate whose own `symbol` disagrees with the row's. An
 *     identity block for a different instrument is worse than none.
 */
function declaredIdentityFor(row: Record<string, unknown>): Record<string, unknown> {
  const rowSymbol = str(row.symbol ?? row.ticker ?? row.instrument)?.toUpperCase();
  const found: Record<string, unknown>[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (depth > IDENTITY_SEARCH_MAX_DEPTH || !isObj(node)) return;
    const identity = node.instrumentIdentity ?? node.instrument_identity;
    if (isObj(identity)) {
      const idSymbol = str((identity as Record<string, unknown>).symbol)?.toUpperCase();
      // Rule 2. A blank symbol on the identity is fine — it inherits the row's.
      if (!rowSymbol || !idSymbol || idSymbol === rowSymbol) {
        found.push(identity as Record<string, unknown>);
      }
    }
    for (const key of IDENTITY_CONTAINER_KEYS) {
      if (key in node) visit(node[key], depth + 1);
    }
  };
  visit(row, 0);

  // Rule 1.
  return (
    found.find((c) => str(c.resolutionState)?.toLowerCase() === "resolved") ??
    found[0] ??
    {}
  );
}

function instrumentIdentitiesFor(tool: string, d: Record<string, unknown>): Array<Record<string, unknown>> {
  const rows = rowsOf(d, tool);
  const candidates: Record<string, unknown>[] = [...rows];
  if (d.symbol || d.ticker || d.instrument) candidates.unshift(d);
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    // Searches the row AND the containers producers nest identity inside; a
    // top-level-only read reported venue-resolved instruments as `partial`.
    const declaredIdentity = declaredIdentityFor(row);
    const symbol = str(declaredIdentity.symbol ?? row.symbol ?? row.ticker ?? row.instrument)?.toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const explicitClass = str(declaredIdentity.assetClass ?? declaredIdentity.asset_class ?? row.assetClass ?? row.asset_class ?? row.instrumentClass);
    const explicitVenue = str(declaredIdentity.venue ?? row.venue ?? row.exchange);
    const knownQuote = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"].find(
      (quote) => symbol.endsWith(quote) && symbol.length > quote.length,
    );
    const assetClass = explicitClass ?? (knownQuote ? "crypto" : null);
    const quoteCurrency = str(declaredIdentity.quoteCurrency ?? declaredIdentity.quote_currency ?? row.quoteCurrency ?? row.quote_currency) ?? knownQuote ?? null;
    const base = knownQuote ? symbol.slice(0, -knownQuote.length) : symbol.includes(":") ? symbol.split(":").at(-1)! : symbol;
    const canonicalId = str(
      declaredIdentity.canonicalInstrumentId ?? declaredIdentity.canonicalId ?? declaredIdentity.canonical_id ??
      row.canonicalInstrumentId ?? row.canonicalId ?? row.canonical_id,
    ) ??
      (explicitVenue && assetClass ? `${explicitVenue.toLowerCase()}:${assetClass.toLowerCase()}:${base}${quoteCurrency ? `-${quoteCurrency}` : ""}` : null);
    const displayName = str(row.displayName ?? row.display_name) ??
      (knownQuote ? `${base} / ${knownQuote === "USDT" ? "Tether" : knownQuote}` : symbol);
    /**
     * Re-audit N5 (2026-08-27). capabilities.instrumentIdentity declares six
     * required fields and an ambiguityRule — "Never infer an equity from a
     * crypto pair whose base resembles a ticker." BEAM is the exact case that
     * rule was written for: a crypto asset and an equity ticker sharing a
     * string. The server accepted it, produced a WITHHOLD verdict, and could
     * not say which instrument it had judged.
     *
     * The pattern across 24 instruments was clear: symbols whose string encodes
     * a quote currency (CTKUSDT, CFGUSDC) resolved assetClass "crypto"; bare
     * tickers (UPST, NVDA, BEAM) resolved nothing. That is suffix parsing, not
     * instrument resolution, and the old ambiguityWarning only ever mentioned
     * venue — while the missing ASSET CLASS is the bigger problem, and is what
     * the ambiguityRule is actually about.
     *
     * Until a real instrument reference table exists, the honest move is to say
     * precisely how little was resolved, and to distinguish "we know it is
     * crypto but not the venue" (partial) from "we do not know what this is"
     * (unresolved / ambiguous).
     */
    const resolvedBySuffix = !explicitClass && Boolean(knownQuote);
    const declaredResolution = str(declaredIdentity.resolutionState ?? row.resolutionState)?.toLowerCase();
    const resolutionState = declaredResolution ?? (
      canonicalId && assetClass && explicitVenue
        ? "resolved"
        : !assetClass
          // No asset class at all. A bare ticker may name an equity or a crypto
          // asset, and we cannot tell — which is the ambiguityRule's own case.
          ? "ambiguous"
          : "partial");
    const ambiguityNotes = [
      !assetClass
        ? `Asset class is UNRESOLVED for ${symbol}. It may be an equity or a crypto asset; Fahali did not determine which, so do not assume the judgment applies to the instrument you have in mind. Re-ask with an explicit venue or a venue-qualified symbol.`
        : null,
      !explicitVenue
        ? "Venue is missing. Do not equate this symbol with a similarly named instrument on another market."
        : null,
      resolvedBySuffix
        ? "Asset class was inferred from the symbol's quote-currency suffix, not from an instrument reference table. It is a parse, not a lookup."
        : null,
    ].filter(Boolean);
    out.push({
      symbol,
      canonicalId,
      canonicalInstrumentId: canonicalId,
      displayName,
      assetClass,
      venue: explicitVenue ?? null,
      quoteCurrency,
      resolutionState,
      resolutionBasis: str(declaredIdentity.resolutionBasis ?? row.resolutionBasis) ??
        (explicitClass ? "declared_by_source" : resolvedBySuffix ? "quote_suffix_parse" : "unresolved"),
      identityVersion: num(declaredIdentity.identityVersion ?? row.identityVersion) ?? null,
      ambiguityWarning: ambiguityNotes.length ? ambiguityNotes.join(" ") : null,
    });
  }
  return out;
}

const PROJECTABLE_ARRAY_KEYS = new Set([
  ...Object.values(AGENT_ENDPOINT_ADAPTERS).flatMap((adapter) => adapter.collections),
  "posts", "edges", "clusters", "flows", "strata",
]);

/**
 * Per-engine RUNTIME DIAGNOSTICS. Audit material, not judgment.
 *
 * Measured 2026-09-14 on a single-symbol `detail: "brief"` call:
 *   engineRuntimeTelemetry  29,398 B  40.7% of the response
 *   engineIntelligence      11,279 B  15.6%
 *   decision (the answer)      745 B   1.0%
 *
 * 🔴 The row cap could never reach either one. Both are deeply nested SINGLE
 * objects, not row lists — `engines` had length ONE and still weighed 11KB
 * because the weight lives inside that one element, and `snapshot` is a dict.
 * So "brief" shipped 56% diagnostics and called itself a compact projection.
 *
 * The committee CONCLUSION is untouched, because it lives in siblings:
 * `agreeing`, `disagreeing`, `silent` and `committee.verdict` (direction,
 * confidence, evidence, headline, agentsAgreeing/Disagreeing/Silent) all
 * survive. A brief caller still learns what the committee decided and who
 * dissented — it loses the per-engine telemetry behind that, which is exactly
 * what `detail: "audit"` is for. `fahali_get_market_verdict` is the AUDIT
 * surface and still returns everything at its default detail.
 */
const AUDIT_ONLY_DIAGNOSTICS = new Set(["engineRuntimeTelemetry", "engineIntelligence"]);

/**
 * Reorder decision rows so the ones carrying a call survive truncation.
 *
 * ── The defect, round three (R2 + R3) ───────────────────────────────────────
 * A market-wide call judged 24 instruments, 16 of them ACTIONABLE. `detail:
 * "brief"` kept the first three IN SOURCE ORDER — all three abstentions — and
 * dropped every actionable row. Worse, `decisionSelection` correctly promoted
 * the first actionable row (NEWTUSDT, source position 18), so the response
 * announced a headline decision, told the agent to "read data[] for the rest",
 * and did not contain the row the headline was about. Inspecting the top-level
 * decision required a second call.
 *
 * These are one bug: promotion ranks by actionability, projection ranks by
 * position, and the two disagree the moment anything is truncated. Ordering
 * projection the same way promotion already orders makes the promoted row
 * survive by construction, and it stops the default view of the market
 * systematically surfacing the rows with nothing to say.
 *
 * 🔑 STABLE within each group: an actionable row never overtakes another
 * actionable row, so the source's own ranking is preserved wherever it still
 * carries information. This reorders WHICH rows survive, never what any row
 * says — and it is disclosed as `responseControl.ordering`, because a caller
 * comparing two responses must be able to tell a re-ranking from a data change.
 */
export function prioritiseDecisionRows<T>(rows: readonly T[]): { rows: T[]; reordered: boolean } {
  if (rows.length < 2) return { rows: [...rows], reordered: false };
  const decisionRows = rows.filter(
    (r): r is T & Record<string, unknown> =>
      isObj(r) && (isObj((r as Record<string, unknown>).verdict) || isObj((r as Record<string, unknown>).canonical)),
  );
  // Not a decision collection (strata, posts, edges…). Those have their own
  // meaningful order — the lead-time headline selection depends on it — and
  // re-ranking them would silently change which stratum a reader sees first.
  if (decisionRows.length !== rows.length) return { rows: [...rows], reordered: false };

  const actionable: T[] = [];
  const abstaining: T[] = [];
  for (const row of rows) {
    (isAbstainRow(row as Record<string, unknown>) ? abstaining : actionable).push(row);
  }
  if (!actionable.length || !abstaining.length) return { rows: [...rows], reordered: false };
  return { rows: [...actionable, ...abstaining], reordered: true };
}

const WELL_FORMED_SYMBOL = /^[A-Z0-9.:_-]{1,20}$/;

function isWellFormedSymbol(symbol: string): boolean {
  return WELL_FORMED_SYMBOL.test(symbol);
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const out: string[] = [];
  for (const item of values) {
    const candidate = isObj(item)
      ? str(item.symbol ?? item.ticker ?? item.instrument ?? item.requestedSymbol ?? item.requested_symbol)
      : str(item);
    const symbol = candidate?.toUpperCase();
    if (symbol && !out.includes(symbol)) out.push(symbol);
  }
  return out;
}

function requestedSymbolsFor(input: Record<string, unknown>, options: AgentDecorationOptions): string[] {
  const scope = isObj(input.scope) ? input.scope : {};
  /**
   * 🔴 THE SINGULAR `symbol` WAS NOT READ (sweep, 2026-08-27).
   *
   * Every key below is plural. Single-instrument tools — `get_forecast`,
   * `get_symbol_decision`, `get_market_sentiment` — take `symbol`, and the
   * endpoints echo it back at the top level. The ledger never looked, so a
   * caller who named exactly one instrument got `requestScope: "universe"` and
   * `requested: []` — the vacuous branch, on the calls where the caller was at
   * their most specific. Measured live: `get_forecast` echoed
   * `symbol: "BTCUSDT"` beside `symbolCoverage.requested: []`.
   *
   * Same defect as the supplied-book case fixed earlier the same day, and it
   * survived that fix because that one only widened the BODY-supplied path.
   * One instrument is still a list of one.
   */
  const candidates = [
    ...(options.symbols ?? []),
    ...stringList(input.requested),
    ...stringList(input.requestedSymbols),
    ...stringList(input.requested_symbols),
    ...stringList(input.symbol),
    ...stringList(input.requestedSymbol),
    ...stringList(input.requested_symbol),
    ...stringList(scope.requested),
    ...stringList(scope.requestedSymbols),
    ...stringList(scope.requested_symbols),
    ...stringList(scope.symbol),
  ];
  return [...new Set(candidates.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

type FilterExclusion = {
  symbolMismatch: number;
  beforeSince: number;
  total: number;
};

type FilterAccounting = {
  applied: boolean;
  criteria: {
    requestedSymbols: string[];
    since: string | null;
  };
  filteredOut: Record<string, FilterExclusion>;
  filteredOutCount: number;
};

/**
 * lookupKey -> asked, from the server's own `symbolResolutions` disclosure, for
 * asked symbols in `requested`. Never inferred from the strings: without the
 * disclosure, BTCUSDT is not BTC.
 */
function disclosedResolutions(input: Record<string, unknown>, requested: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of Array.isArray(input.symbolResolutions) ? input.symbolResolutions : []) {
    if (!isObj(r)) continue;
    const asked = str(r.asked)?.toUpperCase();
    const key = str(r.lookupKey)?.toUpperCase();
    if (asked && key && requested.has(asked) && !requested.has(key)) out.set(key, asked);
  }
  return out;
}

/**
 * Apply caller filters without limiting arrays. State is classified from this
 * payload. A mixed collection may carry instrument rows and global context;
 * only rows that actually name an out-of-scope instrument are removed. Every
 * removal is counted by path and reason so filtering can never masquerade as a
 * complete copy of the unfiltered endpoint response.
 */
function filteredPayload(
  input: Record<string, unknown>,
  options: AgentDecorationOptions,
): { data: Record<string, unknown>; accounting: FilterAccounting } {
  const symbols = new Set(requestedSymbolsFor(input, options));
  // A row for the instrument the server DISCLOSED as answering an asked symbol
  // (BTC -> BTCUSDT) is the answer, not a mismatch. Filtering it out turned
  // "resolve BTC" into an empty response.
  for (const key of disclosedResolutions(input, symbols).keys()) symbols.add(key);
  const sinceMs = options.since ? new Date(options.since).getTime() : Number.NaN;
  const filteredOut: Record<string, FilterExclusion> = {};
  const record = (path: string, reason: "symbolMismatch" | "beforeSince", count: number) => {
    if (count <= 0) return;
    const key = path || "data";
    const current = filteredOut[key] ?? { symbolMismatch: 0, beforeSince: 0, total: 0 };
    current[reason] += count;
    current.total += count;
    filteredOut[key] = current;
  };
  const visit = (
    value: unknown,
    path = "",
    depth = 0,
    parent: Record<string, unknown> | null = null,
  ): unknown => {
    if (depth > 8) return value;
    if (Array.isArray(value)) {
      let rows = value;
      const key = path.split(".").at(-1) ?? "";
      // Keep a grid and its label/metric companion atomic during filtering as
      // well as projection. The upstream correlation endpoint normally scopes
      // this unit itself; independently filtering perSymbol here would leave a
      // full matrix with only a subset of its labels.
      const structural = isGridArray(value) || isGridCompanion(key, value, parent);
      if (symbols.size && !structural) {
        let symbolMismatch = 0;
        rows = rows.filter((item) => {
          // Primitive entries and object rows without an instrument are global
          // context, not evidence about a different symbol. Preserve them.
          if (!isObj(item)) return true;
          const symbol = str(item.symbol ?? item.ticker ?? item.instrument ?? item.requestedSymbol ?? item.requested_symbol);
          if (!symbol) return true;
          if (symbols.has(symbol.toUpperCase())) return true;
          symbolMismatch += 1;
          return false;
        });
        record(path, "symbolMismatch", symbolMismatch);
      }
      if (Number.isFinite(sinceMs) && !structural && rows.some(isObj)) {
        let beforeSince = 0;
        rows = rows.filter((item) => {
          if (!isObj(item)) return true;
          const raw = item.asOf ?? item.as_of ?? item.timestamp ?? item.updatedAt ?? item.updated_at ?? item.created_at;
          if (raw === undefined || raw === null) return true;
          const ms = typeof raw === "number"
            ? (raw < 10_000_000_000 ? raw * 1000 : raw)
            : new Date(String(raw)).getTime();
          if (Number.isNaN(ms) || ms >= sinceMs) return true;
          beforeSince += 1;
          return false;
        });
        record(path, "beforeSince", beforeSince);
      }
      return rows.map((item, index) => visit(item, `${path}[${index}]`, depth + 1, null));
    }
    if (!isObj(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      visit(child, path ? `${path}.${key}` : key, depth + 1, value),
    ]));
  };
  const data = visit(input) as Record<string, unknown>;
  return {
    data,
    accounting: {
      applied: symbols.size > 0 || Number.isFinite(sinceMs),
      criteria: {
        requestedSymbols: [...symbols],
        since: Number.isFinite(sinceMs) ? options.since ?? null : null,
      },
      filteredOut,
      filteredOutCount: Object.values(filteredOut).reduce((sum, entry) => sum + entry.total, 0),
    },
  };
}

function isGridArray(value: unknown[]): boolean {
  return value.length > 0 && value.every(Array.isArray);
}

function isGridCompanion(key: string, value: unknown[], parent: Record<string, unknown> | null): boolean {
  if (!parent || key !== "perSymbol" || !Array.isArray(parent.matrix)) return false;
  return isGridArray(parent.matrix) && parent.matrix.length === value.length;
}

function projectedPayload(
  input: Record<string, unknown>,
  options: AgentDecorationOptions,
): {
  data: Record<string, unknown>;
  omitted: Record<string, number>;
  reordered: string[];
  returnedLimit: number | null;
} {
  const detail = options.detail ?? DEFAULT_RESPONSE_DETAIL;
  const requestedCount = requestedSymbolsFor(input, options).length;
  // A caller that explicitly names four symbols asked for four decisions. The
  // default compact cap may trim an unscoped fleet response, but it must not
  // silently hide one of the requested instruments. An explicit caller limit
  // remains authoritative and is disclosed through responseControl.
  const defaultCompactLimit = detail === "standard" ? 12 : 3;
  const fallbackLimit = detail === "audit"
    ? Number.POSITIVE_INFINITY
    : Math.min(100, Math.max(defaultCompactLimit, requestedCount));
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(100, Math.trunc(Number(options.limit))))
    : fallbackLimit;
  const omitted: Record<string, number> = {};
  const immutableVerdict = input.immutable === true && isObj(input.verdict);
  // Paths whose rows were re-ranked before truncation. Disclosed, because a
  // caller comparing two responses must be able to tell a re-ranking from a
  // change in the data itself.
  const reorderedPaths = new Set<string>();

  const visit = (
    v: unknown,
    path = "",
    depth = 0,
    parent: Record<string, unknown> | null = null,
  ): unknown => {
    if (depth > 8) return v;
    if (Array.isArray(v)) {
      const key = path.split(".").at(-1) ?? "";
      // A matrix and its per-symbol companion form one structural unit.
      // Slicing only the outer dimension produced a 3x6 grid from a valid 6x6
      // source and made the labels disagree. Compact modes may trim ordinary
      // row lists, but grids always travel atomically.
      const structural = isGridArray(v) || isGridCompanion(key, v, parent);
      // A verdict-by-ID response is an immutable replay. Compact rendering may
      // project the normalized summary, but it must never truncate or reorder
      // bytes inside the stored verdict itself.
      const insideImmutableVerdict = immutableVerdict && (path === "verdict" || path.startsWith("verdict."));
      const projectable = PROJECTABLE_ARRAY_KEYS.has(key) && !structural && !insideImmutableVerdict;
      const max = projectable ? limit : Number.POSITIVE_INFINITY;
      // Rank BEFORE slicing, so the rows that carry a call are the rows that
      // survive — and the promoted decision is in the payload it heads. Only
      // pure decision collections are reordered; see prioritiseDecisionRows.
      let arr = v;
      if (projectable && v.length > max) {
        const ranked = prioritiseDecisionRows(v);
        arr = ranked.rows;
        if (ranked.reordered) reorderedPaths.add(path || "data");
      }
      if (arr.length > max) omitted[path || "data"] = arr.length - max;
      return arr.slice(0, max).map((item, i) => visit(item, `${path}[${i}]`, depth + 1, null));
    }
    if (!isObj(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v)) {
      if (k === "systemDirective" || k === "agentBriefing" || k === "nextTools") continue;
      const includeWithheld = options.includeWithheld ?? detail === "audit";
      if (k === "withheld" && isObj(child) && !includeWithheld && Array.isArray(child.strata)) {
        if (child.strata.length) omitted[path ? `${path}.withheld.strata` : "withheld.strata"] = child.strata.length;
        out[k] = {
          ...child,
          strata: [],
          strataOmitted: child.strata.length,
          note: "Withheld rows omitted in compact output. Set include_withheld=true or detail=audit to inspect them.",
        };
        continue;
      }
      // Runtime diagnostics are dropped in compact output and DECLARED, never
      // silently. See AUDIT_ONLY_DIAGNOSTICS: the committee's verdict and its
      // agreeing/disagreeing/silent rosters are siblings and always survive.
      // PATH-CONSTRAINED on purpose. Matching the bare key anywhere would stub
      // any future payload that happens to name a field `engineIntelligence` --
      // `fahali_get_engine_status` is entirely engine state, and a tool whose
      // own content got replaced by an omission stub would be a far worse bug
      // than the bloat this fixes. Only the committee's diagnostics are dropped.
      if (AUDIT_ONLY_DIAGNOSTICS.has(k) && isObj(child) && detail !== "audit" &&
          path.endsWith("canonical.committee")) {
        const entryCount = Object.keys(child).length;
        omitted[path ? `${path}.${k}` : k] = entryCount;
        out[k] = {
          omittedEntryCount: entryCount,
          note: "Per-engine runtime diagnostics omitted in compact output. Set detail=audit to inspect them. The committee verdict and its agreeing, disagreeing and silent rosters are unaffected.",
        };
        continue;
      }
      out[k] = visit(child, path ? `${path}.${k}` : k, depth + 1, v);
    }
    return out;
  };
  const projected = visit(input) as Record<string, unknown>;
  return {
    data: projected,
    omitted,
    reordered: [...reorderedPaths],
    returnedLimit: Number.isFinite(limit) ? limit : null,
  };
}

/** First endpoint-declared array of objects — never guessed from prose fields. */
function rowsOf(d: unknown, tool?: string): Record<string, unknown>[] {
  if (Array.isArray(d)) return d.filter(isObj) as Record<string, unknown>[];
  if (!isObj(d)) return [];
  const keys = tool
    ? [...new Set([...adapterFor(tool).collections, "data", "items", "rows"])]
    : [...new Set(Object.values(AGENT_ENDPOINT_ADAPTERS).flatMap((adapter) => adapter.collections))];
  for (const k of keys) {
    const v = valueAtPath(d, k);
    if (Array.isArray(v) && v.some(isObj)) return v.filter(isObj);
  }
  return [];
}

/**
 * EVERY configured collection, unioned — deliberately not `rowsOf`'s first match.
 *
 * `rowsOf` returns the FIRST non-empty collection, which is correct for its other
 * callers: they want the payload's primary row set for projection, ordering, or
 * "is there a row at all". It is wrong for COVERAGE, and that gap shipped.
 *
 * `fahali_get_market_snapshot` declares `collections: ["assets", "indices"]`.
 * `assets` is non-empty, so `rowsOf` returned it and `indices` was never read.
 * Measured 2026-09-03 on an eight-symbol request: SPY, QQQ, GLD and TLT came back
 * in `notReturned` carrying "It may be unsupported or unavailable; this is not a
 * calm or neutral finding" — while all four sat in `indices[]` of that same
 * response, with prices. The four largest index proxies on the desk, declared
 * missing and served in one payload.
 *
 * `conservationSatisfied` stayed `true` throughout, and correctly so: it asks
 * whether every requested symbol landed in SOME bucket, not whether the bucket was
 * the right one. Conservation cannot detect misfiling — only the bucketing can be
 * fixed, which is what this does.
 */
function rowsAcrossCollections(d: unknown, tool?: string): Record<string, unknown>[] {
  if (Array.isArray(d)) return d.filter(isObj) as Record<string, unknown>[];
  if (!isObj(d)) return [];
  const keys = tool
    ? [...new Set([...adapterFor(tool).collections, "data", "items", "rows"])]
    : [...new Set(Object.values(AGENT_ENDPOINT_ADAPTERS).flatMap((adapter) => adapter.collections))];
  const out: Record<string, unknown>[] = [];
  for (const k of keys) {
    const v = valueAtPath(d, k);
    if (Array.isArray(v)) out.push(...v.filter(isObj));
  }
  return out;
}

/** Symbols actually present in the payload — never a guess, never a default. */
function symbolsIn(d: unknown, tool?: string): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = str(v);
    if (s && isWellFormedSymbol(s.toUpperCase()) && !out.includes(s.toUpperCase())) out.push(s.toUpperCase());
  };
  if (isObj(d) && (d as any).symbol) push((d as any).symbol);
  // Coverage must see every collection the payload actually shipped, not just the
  // first one. See rowsAcrossCollections for the measured defect.
  for (const r of rowsAcrossCollections(d, tool)) push(r.symbol ?? r.ticker ?? r.instrument);
  return out;
}

/**
 * Two different claims used to share one boolean, and they could disagree with
 * the body in both directions at once (measured 2026-08-27, 24-symbol read):
 *
 *   symbolCoverage.fullyReturned  true      <- "you have every symbol"
 *   responseControl.omitted       {data:21} <- "21 of 24 were projected away"
 *
 * Two causes, both live:
 *  1. VACUOUS TRUTH. With no symbols requested, `requested` is [] and
 *     `[].every(...)` is true — so the field could not be false on exactly the
 *     call where the whole universe populates `returned`. Same absence-renders-
 *     as-safety class the null-tier and default-arm bugs came from.
 *  2. PROJECTION BLINDNESS. Conservation is computed pre-projection, which is
 *     RIGHT for responseState (truncating must never turn findings into an
 *     absence) and WRONG here: fullyReturned is a claim about DELIVERY, not
 *     about truth, so it has to be reconciled against what actually shipped.
 *
 * `requestScope` removes the vacuous case by making the question explicit, and
 * `projectedOut` gives the dropped symbols somewhere to be named rather than
 * silently vanishing between the two blocks.
 */
type SymbolConservation = {
  requested: string[];
  returned: string[];
  withheld: string[];
  notReturned: string[];
  /** Present in the source and removed by responseControl projection, not absent. */
  projectedOut: string[];
  /** "explicit" — the caller named symbols. "universe" — unscoped, the fleet answered. */
  requestScope: "explicit" | "universe";
  /**
   * 🔴 `boolean` → `boolean | null` (R7, measured live 2026-08-27).
   *
   * The comment above already worked out that `[].every(...)` is true and fixed
   * `fullyReturned` to be nullable. This field was left a bare boolean and kept
   * the exact defect the comment describes.
   *
   * Measured: a two-position book (NVDA 50k + BTCUSDT 30k) was sent to
   * `fahali_run_shock_test`. The coverage ledger came back
   * `returned: ["NVDA"], withheld: [], notReturned: [], projectedOut: []` with
   * `conservationSatisfied: true` and `fullyReturned: true`, beside a
   * `portfolioValue: 80000` that could only include BTCUSDT. The instrument
   * contributed to the loss number and was absent from the ledger that exists
   * to prove nothing went missing — and the integrity flag reported OK because
   * it had nothing to check, not because it checked.
   *
   * A conservation check with an empty request set has NOT been satisfied; it
   * has not been performed. `null` says so. [[a shorter array is an all-clear]]
   */
  conservationSatisfied: boolean | null;
  /** null when the response is not symbol-scoped at all; never vacuously true. */
  fullyReturned: boolean | null;
};

function symbolsFromWithheld(d: Record<string, unknown>): string[] {
  const value = d.withheld;
  if (Array.isArray(value)) return stringList(value);
  if (!isObj(value)) return [];
  return [
    ...stringList(value.symbols),
    ...stringList(value.items),
    ...stringList(value.data),
  ].filter((symbol, index, all) => all.indexOf(symbol) === index);
}

/**
 * Instruments the caller named in the REQUEST BODY rather than the `symbols`
 * parameter — a supplied book, a list of shocks.
 *
 * `requestedSymbolsFor` only ever saw `options.symbols` and the `requested*`
 * keys, so a call whose entire subject arrived in the body (`positions`,
 * `shocks`) was scored `requestScope: "universe"` with `requested: []`. That is
 * what made the conservation check vacuous on exactly the calls where the
 * caller was most specific about what they wanted accounted for.
 *
 * Kept separate from `requestedSymbolsFor` on purpose: that function also drives
 * `filteredPayload`, and a supplied book is a subject to be accounted for, not a
 * filter to be applied. Widening it there would silently drop rows.
 */
export function callerSuppliedInstruments(input: Record<string, unknown>, tool?: string): string[] {
  const out = new Set<string>();
  const take = (v: unknown) => {
    const s = str(v);
    if (s && isWellFormedSymbol(s.toUpperCase())) out.add(s.toUpperCase());
  };
  const fromRows = (v: unknown) => {
    if (!Array.isArray(v)) return;
    for (const row of v.slice(0, 500)) {
      if (!isObj(row)) continue;
      take(row.symbol ?? row.ticker ?? row.instrument ?? row.inputInstrument);
    }
  };
  // Shock-test has two distinct scopes: holdings are the portfolio being
  // revalued, while shock clauses are the requested market measurements. A
  // valid holding must not be labelled unsupported merely because it was not a
  // shock driver. The endpoint publishes portfolioCoverage separately.
  const keys = tool === "fahali_run_shock_test"
    ? ["shocks", "requestedShocks"]
    : ["positions", "requestedPositions", "holdings", "shocks", "requestedShocks"];
  for (const key of keys) {
    fromRows(input[key]);
  }
  const scenario = isObj(input.requestedScenario) ? input.requestedScenario : null;
  if (scenario) {
    fromRows(scenario.input);
    fromRows(scenario.clauses);
  }
  return [...out];
}

function enforceSymbolConservation(
  tool: string,
  input: Record<string, unknown>,
  options: AgentDecorationOptions,
): { data: Record<string, unknown>; coverage: SymbolConservation } {
  /**
   * 🔴 A MARKET-WIDE RESPONSE CANNOT OWE PER-INSTRUMENT DELIVERY.
   * (added 2026-09-04, observed in production)
   *
   * `requestedSymbolsFor` begins with `options.symbols` - the caller's own tool
   * arguments - so ANY tool called with `symbols` acquires a delivery
   * obligation for them. For a tool whose answer is one market-wide reading
   * that is a false obligation, and it was being reported as a miss:
   *
   *   fahali_get_market_regime(symbols: "BTCUSDT") ->
   *     notReturned: [{ symbol: "BTCUSDT",
   *                     reasonCode: "UNSUPPORTED_OR_NOT_RETURNED",
   *                     reason: "...this is not a calm or neutral finding" }]
   *     fullyReturned: false, responseState: "PARTIAL"
   *
   * ...over a response that HAD delivered the reading the caller can use. The
   * regime rows deliberately carry no `symbol` (the projection keeps unsymboled
   * rows as global context and drops mismatched ones), so there is nothing for
   * the ledger to match and it concluded absence.
   *
   * A false miss is worse than a quiet one: this axis is what an agent reads to
   * decide whether it was told everything, so crying wolf here trains it to
   * ignore the field that exists to be believed.
   *
   * The response itself is the authority on whether it is instrument-scoped.
   * `scope.appliesToInstrument === false` is an EXPLICIT declaration - absence
   * of the field changes nothing, so every other tool is untouched.
   */
  const declaredScope = isObj(input.scope) ? input.scope : {};
  const marketWide = declaredScope.appliesToInstrument === false;

  const requested = marketWide ? [] : [
    ...new Set([
      ...requestedSymbolsFor(input, options),
      // From the response, for tools that echo the book back...
      ...callerSuppliedInstruments(input, tool),
      // ...and from the request, for tools that do not.
      ...(options.suppliedInstruments ?? []),
    ]),
  ];
  const requestedSet = new Set(requested);
  // A DISCLOSED canonicalisation answers the asked symbol: "BTC" requested and
  // a BTCUSDT row returned under `symbolResolutions` is BTC delivered, not BTC
  // missing plus an unrequested BTCUSDT. Only the server's own disclosure can
  // make that link — the ledger never infers it from the strings.
  const answeredBy = disclosedResolutions(input, requestedSet);
  const returned = [...new Set(symbolsIn(input, tool).map((symbol) => answeredBy.get(symbol) ?? symbol))]
    .filter((symbol) => !requestedSet.size || requestedSet.has(symbol));
  const returnedSet = new Set(returned);
  const withheld = symbolsFromWithheld(input)
    .filter((symbol) => (!requestedSet.size || requestedSet.has(symbol)) && !returnedSet.has(symbol));
  const withheldSet = new Set(withheld);

  const originalNotReturned = Array.isArray(input.notReturned) ? input.notReturned : [];
  const bySymbol = new Map<string, unknown>();
  for (const entry of originalNotReturned) {
    const symbol = stringList([entry])[0];
    if (symbol) bySymbol.set(symbol, entry);
  }
  for (const symbol of requested) {
    if (!returnedSet.has(symbol) && !withheldSet.has(symbol) && !bySymbol.has(symbol)) {
      const malformed = !isWellFormedSymbol(symbol);
      bySymbol.set(symbol, {
        symbol,
        reasonCode: malformed ? "MALFORMED_SYMBOL" : "UNSUPPORTED_OR_NOT_RETURNED",
        reason: malformed
          ? `${symbol} is not a valid Fahali symbol identifier. No market conclusion was produced for it.`
          : `No row for ${symbol} was returned for the requested scope. It may be unsupported or unavailable; this is not a calm or neutral finding.`,
      });
    }
  }
  for (const symbol of [...bySymbol.keys()]) {
    if (returnedSet.has(symbol) || withheldSet.has(symbol) || (requestedSet.size && !requestedSet.has(symbol))) {
      bySymbol.delete(symbol);
    }
  }
  const notReturned = [...bySymbol.keys()];
  const coverage: SymbolConservation = {
    requested,
    returned,
    withheld,
    notReturned,
    projectedOut: [],
    requestScope: requested.length ? "explicit" : "universe",
    conservationSatisfied: requested.length
      ? requested.every((symbol) => returnedSet.has(symbol) || withheldSet.has(symbol) || bySymbol.has(symbol))
      : null,
    // Truth-pass value only. reconcileCoverageWithProjection() has the final
    // word once projection has run and it is known what actually shipped.
    fullyReturned: requested.length ? requested.every((symbol) => returnedSet.has(symbol)) : null,
  };
  if (!requested.length) return { data: input, coverage };
  return {
    data: {
      ...input,
      requested,
      notReturned: [...bySymbol.values()],
      symbolCoverage: coverage,
    },
    coverage,
  };
}

/**
 * Second half of the conservation contract, run AFTER projection.
 *
 * enforceSymbolConservation answers "what does the source hold"; this answers
 * "what did the caller actually receive". Keeping them in one pass is what let
 * symbolCoverage and responseControl describe the same call differently. The
 * invariant restored here: every symbol the source carried appears in exactly
 * one of returned / withheld / notReturned / projectedOut, and fullyReturned is
 * true only when nothing was dropped on the way out.
 */
function reconcileCoverageWithProjection(
  tool: string,
  coverage: SymbolConservation,
  projected: Record<string, unknown>,
): SymbolConservation {
  const sourceSymbols = coverage.returned;
  const answeredBy = disclosedResolutions(projected, new Set(coverage.requested));
  const delivered = new Set(symbolsIn(projected, tool).map((symbol) => answeredBy.get(symbol) ?? symbol));
  const returned = sourceSymbols.filter((symbol) => delivered.has(symbol));
  const projectedOut = sourceSymbols.filter((symbol) => !delivered.has(symbol));
  const accountedFor = new Set([...returned, ...projectedOut, ...coverage.withheld, ...coverage.notReturned]);

  const explicit = coverage.requestScope === "explicit";
  // A response that names no symbols anywhere is not symbol-scoped; the
  // question does not apply and answering `true` would be the vacuous claim
  // this function exists to remove.
  const symbolScoped = explicit || sourceSymbols.length > 0;

  return {
    ...coverage,
    returned,
    projectedOut,
    // Mirrors `fullyReturned` below: on a response that is not symbol-scoped
    // there is nothing to conserve, and `true` would be the vacuous claim this
    // whole function exists to remove. Two adjacent flags over one question
    // must not answer it differently.
    conservationSatisfied: !symbolScoped
      ? null
      : sourceSymbols.every((symbol) => accountedFor.has(symbol)) &&
        (!explicit || coverage.requested.every((symbol) => accountedFor.has(symbol))),
    fullyReturned: !symbolScoped
      ? null
      : explicit
        ? coverage.requested.every((symbol) => delivered.has(symbol))
        : projectedOut.length === 0,
  };
}

/**
 * Every way this API says "we do not have this", collected in one pass.
 * Each of these envelopes exists because a previous version of it rendered as
 * safety, so losing one here re-opens that hole.
 */
function absences(d: unknown, depth = 0): string[] {
  const out: string[] = [];
  if (depth > 4 || !isObj(d)) return out;

  const w = (d as any).withheld;
  if (isObj(w) && (w.reason || w.message)) out.push(String(w.reason ?? w.message));
  if ("value" in d && (d as any).value === null && (d as any).reason) out.push(String((d as any).reason));
  if ((d as any).publishable === false) {
    out.push(str((d as any).withheldReason ?? (d as any).reason) ?? "one stratum is below the publishability bar; its figures are not quotable");
  }
  for (const k of ["abstainReason", "headlineWithheldReason", "disclaimer", "topSymbolWithheld"]) {
    const s = str((d as any)[k]);
    if (s && s !== "yes" && s !== "no") out.push(s);
  }
  const cs = str((d as any).calculationStatus);
  if (cs === "no_pool" || cs === "error") out.push(`the calculation did not run (\`calculationStatus: ${cs}\`) — this is unmeasured, not a zero result`);
  if (cs && cs.startsWith("stale_")) out.push(`this snapshot is past its freshness window (\`calculationStatus: ${cs}\`) — dated, not absent`);

  // The multi-symbol echo. A request for three names that returns two is the
  // defect this whole envelope exists to close.
  // Three shapes reach this field and ALL THREE must speak. Handling only
  // `{reason}` objects meant `notReturned: ["SPY"]` — a bare string list, the
  // cheapest thing an endpoint can echo — produced no blind-spot line at all,
  // so a request for three names that answered two read as a clean two-name
  // answer. That is this file's whole failure mode, reached through the field
  // added to prevent it.
  // ── Strata that were MEASURED and did not clear the gate ──────────────────
  // `/api/track-record/lead-time` selects `WHERE publishable = true`, so the
  // withheld strata never reached this renderer and the Blind Spot reported
  // "nothing was flagged as missing" — the FILTER's success read as the
  // world's silence. That is `absence renders as safety` inside the very
  // section built to prevent it. 47 strata are withheld against 12 published;
  // an agent told nothing is missing is being told the opposite of the truth.
  const wh = (d as any).withheld;
  if (isObj(wh)) {
    const strata = Array.isArray((wh as any).strata) ? ((wh as any).strata as unknown[]) : [];
    const unavailableReason = str((wh as any).reason);
    if ((wh as any).available === false && unavailableReason) {
      out.push(unavailableReason);
    } else if (strata.length) {
      const names = strata
        .slice(0, 5)
        .map((s) => (isObj(s) ? str((s as any).stratum) : str(s)))
        .filter((s): s is string => !!s);
      out.push(
        `${strata.length} measured strata did NOT clear the publishability gate and are absent from the evidence above` +
          (names.length ? ` — including ${names.join(", ")}${strata.length > names.length ? ", and others" : ""}` : "") +
          `. Their numbers exist and are NOT quotable; treat these engines as UNMEASURED here, not as clean.`,
      );
      // The single most common reason, so "withheld" is not itself a black box.
      const reasons = strata
        .map((s) => (isObj(s) ? str((s as any).reason) : null))
        .filter((r): r is string => !!r);
      if (reasons.length) {
        // Group by reason FAMILY, not exact string. Most reasons embed the
        // engine's own name ("no non-directional resolved crypto rows for
        // momentum"), so counting raw strings made almost every reason unique
        // and reported the mode of near-unique values — live output said
        // "(2 of 47)" while ~40 shared one cause. A statistic that is
        // arithmetically right and directionally wrong is the kind this
        // product cannot ship.
        const family = (r: string) =>
          r
            .replace(/\s+for\s+[A-Za-z0-9_]+\s*$/i, "")
            .replace(/\s*\([^)]*\)/g, "")
            .replace(/\b(crypto|equity)\b/gi, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        const counts = reasons.reduce((m, r) => m.set(family(r), (m.get(family(r)) ?? 0) + 1), new Map<string, number>());
        const ranked = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2);
        const parts = ranked.map(([why, n]) => `${n} because ${why}`);
        if (parts.length) {
          out.push(
            `Why they are withheld: ${parts.join("; ")}` +
              (counts.size > ranked.length ? `; the rest for other recorded reasons` : "") +
              ` (${strata.length} strata in total).`,
          );
        }
      }
    }
  }

  const nr = (d as any).notReturned;
  if (Array.isArray(nr)) {
    for (const m of nr) {
      if (isObj(m)) {
        const why = str((m as any).reason);
        const sym = str((m as any).symbol ?? (m as any).ticker);
        if (why) out.push(sym ? `${sym}: ${why}` : why);
        else if (sym) out.push(`${sym} was requested and returned no reading — not covered here, which is not a finding that it is calm`);
      } else {
        const sym = str(m);
        if (sym) out.push(`${sym} was requested and returned no reading — not covered here, which is not a finding that it is calm`);
      }
    }
  }

  const ms = (d as any).missingSignals;
  if (Array.isArray(ms) && ms.length) out.push(`no reading from: ${ms.map(String).join(", ")} — those engines did not report on this, which is not a finding that they are clear`);

  for (const [k, v] of Object.entries(d)) {
    if (k === "notReturned") continue;
    if (isObj(v)) out.push(...absences(v, depth + 1));
    else if (Array.isArray(v)) for (const item of v.slice(0, 12)) if (isObj(item)) out.push(...absences(item, depth + 1));
  }
  return out;
}

/** Blind spots that are facts about the SYSTEM, not about this response. */
const STANDING_BLIND_SPOTS: Record<string, string[]> = {
  fahali_get_unusual_money_movement: [
    "Fahali ingests no on-chain feed, wallet attribution, participant identity, or venue-level trade prints. This is a candle-derived order-flow imbalance proxy.",
    "The source does not persist the duration of its rolling calculation window, so the response cannot claim a precise measurement horizon.",
  ],
  fahali_get_whale_activity: [
    // A refusal must name the next rung: saying only "deprecated" leaves an
    // agent with no way to reach the supported tool.
    "This is a deprecated name for `fahali_get_unusual_money_movement` — call that instead; it takes the same symbols, limit, since and minimum_confidence arguments and returns this identical payload. The data is a participant-agnostic order-flow imbalance, not observed whale activity.",
  ],
  fahali_get_microstructure_proxy: [
    "There is no off-exchange or venue-level feed. This is a proxy computed over public order-book behaviour, not a view of hidden liquidity.",
  ],
  fahali_get_capital_flow: [
    "There is no exchange aggressor tape, institutional-versus-retail split, fund-flow attribution, or participant identity. netFlowUsd is a fixed 60-minute candle-derived buy-versus-sell imbalance; detectionScore measures unusualness and never determines whether the amount exists.",
  ],
  fahali_get_flash_crash_risk: [
    "There is no calibrated crash probability, time-to-crash, or move-magnitude model. Detection strength ranks which names are flashing; it is not P(crash).",
  ],
  fahali_get_contagion_map: [
    "Edges describe which names move down together, not which direction a break would travel. Causal direction is not measured.",
  ],
  fahali_get_correlation_matrix: [
    "This is historical Pearson co-movement for the requested window. It is not causal direction or a forecast of future correlation; read each pair's observation, policy, and coverage cells.",
  ],
  fahali_get_market_sentiment: [
    "Sentiment is derived from detection activity, not from news, social, or positioning data.",
  ],
  fahali_get_forecast: [
    "Most engines in this fleet are DETECTORS, not trade-signal generators. Detection strength and calibrated outcome probability are separate numbers; do not read one as the other.",
  ],
};

// ── The briefing ─────────────────────────────────────────────────────────────

const MAX_EVIDENCE = 12;
const MAX_ABSENCES = 6;
/** Blocks named in a delivered-summary before the list is elided. */
const MAX_DELIVERED_BLOCKS = 6;

/**
 * The keys THIS MODULE adds. Everything else at the top level came from the
 * source and is payload.
 *
 * Hardcoding a list is usually the wrong move here, but this one is legitimate
 * and self-maintaining in the direction that matters: the decorator is the
 * author of these keys, so it is the authority on them, and a key it forgets to
 * list is reported as DATA — which errs toward telling the agent it received
 * something, never toward telling it that it received nothing.
 */
const ENVELOPE_AUTHORED_KEYS = new Set([
  "absence", "agentBriefing", "asOf", "auth", "claimPolicy", "claimValidity",
  "confidenceSemantics", "conflicts", "coverage", "dataState", "decisionEligibility",
  "decisionSelection", "evidenceQuality", "freshness", "freshnessNormalized",
  "matchedTrackRecord", "mcpStatus", "nextActions", "recordMatchReason", "requestId",
  "responseControl", "responseState", "schemaVersion", "scope", "sourceConfidenceSemantics",
  "sourceDataState", "sourceDecision", "sourceError", "sourceEvidenceQuality",
  "sourceScope", "sourceStatus", "status", "symbolCoverage", "structuralBlindSpots",
  "provenanceRoot", "timestamp",
]);

/**
 * WHAT THIS RESPONSE DELIVERED — composed so it can be said BEFORE anything the
 * response withheld.
 *
 * ── The defect (measured across 127 live envelopes, 2026-09-05) ─────────────
 * Five tools declared a refusal state while carrying 283 rows of measured data
 * between them, and the two worst are the ones this server's own instructions
 * call the primary judgment surface:
 *
 *   fahali_get_market_decision   70 rows | responseState WITHHELD, dataState MEASURED
 *   fahali_get_market_verdict    70 rows | responseState WITHHELD, dataState MEASURED
 *   fahali_get_symbol_decision   45 rows | responseState WITHHELD
 *
 * The briefing for those opened with "**Binding decision withheld.**" followed by
 * six stacked internal error codes, and then RETURNED — so the 2 symbols, 6
 * directional producers, judged record, resolved identity, evidence quality and
 * market session sitting in the same payload were never mentioned. An agent
 * reading that reports it received nothing.
 *
 * The withholding is CORRECT and is not touched: the arbiter must not bind
 * without its required sources. What was wrong is the reading ORDER — the claim
 * gate was narrated as if it were a data gate. Withhold the CLAIM, never the
 * DATA, applies to the sentence as much as to the payload.
 */
function deliveredLine(tool: string, d: Record<string, unknown>): string | null {
  const rowCount = evidenceRows(tool, d).rows.length;
  const symbols = symbolsIn(d, tool);

  const blocks: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (ENVELOPE_AUTHORED_KEYS.has(k)) continue;
    const size = Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
    if (size > 0) blocks.push(k);
  }
  if (!rowCount && !symbols.length && !blocks.length) return null;

  const measured = [
    symbols.length ? `${symbols.length} ${symbols.length === 1 ? "instrument" : "instruments"}` : null,
    rowCount ? `${rowCount} measured ${rowCount === 1 ? "row" : "rows"}` : null,
  ].filter((x): x is string => Boolean(x));

  const shown = blocks.slice(0, MAX_DELIVERED_BLOCKS);
  const more = blocks.length - shown.length;
  const blockText = shown.length
    ? ` It carries \`${shown.join("`, `")}\`` + (more > 0 ? ` and ${more} more block${more === 1 ? "" : "s"}` : "") + "."
    : "";

  return (
    `**This response DELIVERED data${measured.length ? `: ${measured.join(", ")}` : ""}.**${blockText}` +
    " Read it — the withholding below applies to the binding CLAIM, not to this evidence."
  );
}

/**
 * One sentence, not a stack of codes.
 *
 * The eligibility reasons are real and stay in `absence.reason` and
 * `decisionEligibility.reasons` as audit evidence. Concatenating all of them
 * into the FIRST thing an agent reads buried the payload under six
 * REQUIRED_SOURCE_* strings that only mean something to this codebase.
 */
function withheldReasonSentence(reasons: string[]): string {
  if (!reasons.length) return "";
  const first = reasons[0];
  const rest = reasons.length - 1;
  return ` ${first}${rest > 0 ? ` (+${rest} more condition${rest === 1 ? "" : "s"} in \`decisionEligibility.reasons\`)` : ""}`;
}

function titleFor(tool: string, d: unknown): string {
  const nice = tool
    .replace(/^fahali_/, "")
    .replace(/^get_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const syms = symbolsIn(d, tool);
  const subject = syms.length === 1 ? syms[0] : syms.length > 1 ? `${syms.length} symbols` : null;
  return subject ? `Fahali ${nice}: ${subject}` : `Fahali ${nice}`;
}

/**
 * The thesis. Sourced, in priority order, from fields whose whole job is to be
 * the one-line read — never composed from numbers we happen to have.
 */
function thesisFor(tool: string, d: unknown): string[] {
  const lines: string[] = [];
  if (!isObj(d)) return lines;

  const rows = rowsOf(d, tool);
  const lead = rows[0];

  // Decorated responses reach the renderer only after normalization. Read the
  // normalized decision and eligibility first, and never fall back to a raw
  // row after the policy has withheld it.
  if (d.schemaVersion === "2.0") {
    const eligibility = isObj(d.decisionEligibility) ? d.decisionEligibility : null;
    const normalizedDecision = isObj(d.decision) ? d.decision : null;
    const normalizedAbsence = isObj(d.absence) ? d.absence : null;
    const normalizedState = str(d.responseState);
    if (normalizedState === RESPONSE_STATES.partial) {
      lines.push(`**PARTIAL — ${str(normalizedAbsence?.reason) ?? "part of the required source scope did not complete."}**`);
    }
    if (eligibility?.kind === "historical_replay") {
      const replayStatus = str(eligibility.status) ?? "WITHHELD";
      lines.push(
        `**Immutable historical decision replay.** The stored \`verdict\` remains unchanged; ` +
        `its current action eligibility is \`${replayStatus}\` and does not rewrite what was decided then.`,
      );
      lines.push("**Do not execute the historical action from this replay.** Re-evaluate the live watch before taking any portfolio action.");
      return lines;
    }
    /*
      🔴 READING ORDER IS THE FIX. Both branches below still withhold exactly
      what they withheld before — the change is that each now says what the
      response DELIVERED first, so an agent does not read "withheld" and stop.

      The early `return` is DELIBERATE and must stay. Removing it would let the
      composer fall through to the raw `canonical`/`verdict` blocks further
      down, which read the source row directly — and that would restore a
      de-promoted DIRECTIONAL headline into the briefing, the precise thing
      `decisionEligibility.test.ts` ("a de-promoted DIRECTIONAL headline is never
      restored") exists to prevent. So the delivered summary is composed INSIDE
      each branch rather than by letting execution continue.
    */
    if (eligibility?.status === "WITHHELD") {
      const reasons = Array.isArray(eligibility.reasons)
        ? eligibility.reasons
            .filter(isObj)
            .map((entry) => `${str(entry.code) ?? "INELIGIBLE"}: ${str(entry.reason) ?? "binding eligibility failed"}`)
        : [];
      const delivered = deliveredLine(tool, d);
      if (delivered) lines.push(delivered);
      lines.push(
        "**No binding directional call.** The reading and its evidence are above and remain in the " +
        "JSON; what is refused is authority to act on a direction, not the measurement." +
        withheldReasonSentence(reasons),
      );
      return lines;
    }
    if (normalizedState === RESPONSE_STATES.withheld) {
      const delivered = deliveredLine(tool, d);
      if (delivered) lines.push(delivered);
      const stale = d.dataState === DATA_STATES.stale;
      lines.push(
        `**Fahali withheld the ${stale ? "stale " : ""}claim${delivered ? ", not the data" : ""}.** ` +
        `${str(normalizedAbsence?.reason) ?? "No binding conclusion is available."}` +
        (delivered && stale
          ? " The rows above were still returned in full; judge them against `freshness`, which states the bar and how it was derived."
          : ""),
      );
      return lines;
    }
    if (normalizedDecision) {
      const headline = str(normalizedDecision.headline);
      const state = str(normalizedDecision.state);
      const direction = str(normalizedDecision.direction);
      const actionability = str(normalizedDecision.actionability)?.toUpperCase();
      if (headline) lines.push(`**${headline}**`);
      const bits = [
        state ? `state \`${state}\`` : null,
        direction ? `direction \`${direction}\`` : null,
        actionability ? `actionability \`${actionability}\`` : null,
      ].filter((entry): entry is string => Boolean(entry));
      if (bits.length) lines.push(bits.join(" · "));
      if (actionability === "ABSTAIN") {
        lines.push(`**No directional action is authorized.** ${str(normalizedDecision.abstainReason) ?? "The normalized decision abstains."}`);
      }
      if (lines.length) return lines;
    }
    if (normalizedState === RESPONSE_STATES.partial) return lines;
  }

  // The canonical arbiter's own headline is the authoritative one-liner.
  const canonical = lead && isObj(lead.canonical) ? (lead.canonical as any) : (d as any).canonical;
  if (isObj(canonical)) {
    const head = str(canonical.headline);
    const state = str(canonical.state);
    const dir = str(canonical.direction);
    if (head) lines.push(`**${head}**`);
    const bits: string[] = [];
    if (state) bits.push(`state \`${state}\``);
    if (dir) bits.push(`direction \`${dir}\``);
    const rel = str(canonical.reliability);
    if (rel) bits.push(`reliability \`${rel}\``);
    if (canonical.conflict === true) {
      bits.push("**committee evidence and forecast disagree — only the canonical arbiter's cautious resolution is binding**");
    }
    // Qualitative label only. This field shipped "0/18" once; an engine count
    // is on the never-sayable list and is worse inside prose than in a field.
    const cov = str(canonical.coverage);
    if (cov && !/\d+\s*\/\s*\d+/.test(cov)) bits.push(`fleet coverage \`${cov}\``);
    if (bits.length) lines.push(bits.join(" · "));
  }

  const verdict = lead && isObj(lead.verdict) ? (lead.verdict as any) : (d as any).verdict;
  if (isObj(verdict)) {
    const act = str(verdict.actionability);
    if (act === "ABSTAIN") {
      lines.push(
        `**Actionable context:** Fahali is ABSTAINING on this symbol — it is making no directional call. ` +
          (str(verdict.abstainReason) ?? "No reason field was returned with the abstention.") +
          ` Treat this as no call, not as a neutral or calm call.`,
      );
    } else if (act === "ACTIONABLE") {
      const conf = num(verdict.confidence);
      lines.push(
        `**Actionable context:** a directional call is on the table` +
          (conf !== null ? ` at ${(conf * 100).toFixed(0)}% confidence` : "") +
          (str(verdict.forecastHorizon) ? `, over ${str(verdict.forecastHorizon)}` : "") + ".",
      );
    }
  }

  for (const k of ["headline", "summary", "narrative", "briefing", "thesis", "message"]) {
    const v = (d as any)[k];
    const s = typeof v === "string" ? str(v) : isObj(v) ? str((v as any).headline ?? (v as any).text) : null;
    if (s && !lines.some((l) => l.includes(s))) { lines.push(`**${s}**`); break; }
  }

  if (!lines.length) {
    const n = rows.length;
    const total = num((d as any).count) ?? n;
    const { responseState } = classifyAgentPayload(tool, d);
    // "229 readings" is true and still misleading when those 229 are 12 strata
    // re-published daily: it invites an agent to treat row count as sample size
    // and to sum across days. Say the distinct count when it differs.
    const distinct = isObj(d) ? evidenceRows(tool, d as Record<string, unknown>).rows.length : n;
    if (total) {
      // ── Count the MEASUREMENTS, not the rows ─────────────────────────────
      //
      // Measured 2026-09-04 on `fahali_get_capabilities`: the thesis read
      // "**52 measured readings returned.** …anything not listed was not
      // measured", directly above 52 lines each saying the row carried no
      // reportable measurement. `rows` was the declared `tools` collection —
      // a CATALOGUE. A declared collection is not automatically a set of
      // observations, and `rows.length` never was a measurement count.
      //
      // The dangerous half is the second sentence: appended to a list where
      // nothing is listed, "anything not listed was not measured" converts a
      // RENDERING gap into a claim about what the market showed. That is the
      // absence-renders-as-safety defect, emitted by the loudest layer.
      //
      // So the count is taken from the evidence renderer's own output — one
      // derivation, no second implementation to drift — and when it can report
      // nothing, the thesis says exactly that and no more. It reports the
      // summariser's limit; it does not promote it into an absence.
      const rendered = evidenceFor(tool, d).filter((line) => line.startsWith("* "));
      const reportable = rendered.filter((line) => !line.includes(NO_REPORTABLE_MEASUREMENT)).length;
      lines.push(
        rendered.length > 0 && reportable === 0
          ? `**${total} ${total === 1 ? "row" : "rows"} returned, and this summary could not extract a measurement from any of them.** `
            + `That is a limit of this summary, NOT a finding: read the JSON below for what the rows actually contain, `
            + `and do not read it as "nothing was measured".`
          : distinct < n
            ? `**${total} rows returned, covering ${distinct} distinct measurement strata.** The rest are the same strata re-published on earlier days — repeat readings of a rolling window, not independent observations. Do not sum them. The evidence below is what Fahali actually observed; anything not listed was not measured.`
            : `**${total} measured ${total === 1 ? "reading" : "readings"} returned.** The evidence below is what Fahali actually observed; anything not listed was not measured.`,
      );
    } else if (responseState === RESPONSE_STATES.findings && hasAggregateReading(d)) {
      lines.push("**Fahali returned aggregate measurements for this request.** Read the named metrics below; no row collection was required for this response.");
    } else if (responseState === RESPONSE_STATES.empty) {
      lines.push("**The measured query completed with no matching findings.** This is a scoped empty result, not a statement that the wider market is safe.");
    } else if (responseState === RESPONSE_STATES.withheld) {
      lines.push("**Fahali withheld a claim for this request.** The reason below is the result; do not translate it into neutral, calm, or safe.");
    } else {
      lines.push("**Fahali has no usable coverage for this request.** That is missing evidence, not a finding that conditions are calm.");
    }
  }
  return lines;
}

/**
 * WHICH rows become evidence, and in what order. Measured against production
 * 2026-08-22, and both problems below were live:
 *
 * 1. `fahali_get_lead_time` returns 229 rows that are only 12 DISTINCT STRATA —
 *    one rolling window re-published daily. Taking the first 12 in payload
 *    order rendered 12 bullets that were 3 strata, 8 of them the same one on
 *    consecutive days. An agent reads 12 bullets as 12 findings. This is the
 *    same shape as the "1.6M+ calls" double-count: a rolling republication
 *    mistaken for independent observations.
 *
 * 2. `headline` — the single stratum the server picks, by recall, and the one
 *    the public site publishes — did not appear in the briefing AT ALL. The
 *    first bullets instead led with committee_verdict at recall 1.14%, a figure
 *    the honesty doctrine flags as not publishable as directional, under a
 *    directive that says "you may quote the Hard Evidence above verbatim".
 *    The prose was authorising the one claim the product forbids.
 *
 * So: hoist `headline` to the front, then keep only the FIRST row per stratum.
 * First, not best — payload order is day-descending, so first is the most
 * recent day, which is the basis `headline` itself uses. Picking the best day
 * per stratum would print a recall of 75% beside a headline of 26.84% for the
 * same stratum on the same page.
 */
/** The stratum a row measures, or null when the row is not stratified at all. */
export function stratumKeyOf(r: Record<string, unknown>): string | null {
  const parts = [str(r.engine), str(r.horizon_tier), str(r.bar_regime)];
  return parts.every((p) => p !== null && p !== "") ? parts.join("|") : null;
}

/**
 * One row per stratum, keeping the FIRST occurrence.
 *
 * 🔴 ONE implementation, exported, because "which row represents this stratum"
 * is exactly the question four surfaces once answered differently — which is
 * how a 4.7%-recall stratum reached the home screen while a 29.1%-recall one
 * sat in the same payload. The briefing renderer and the lead-time tool both
 * call this; neither may roll its own.
 *
 * FIRST, not best: callers pass day-descending rows, so first is the most
 * recent day — the basis `headline` itself uses. Picking the best day per
 * stratum would print recall 75% beside a headline of 26.84% for the same
 * stratum on the same page.
 */
export function latestPerStratum<T extends Record<string, unknown>>(
  rows: T[],
): { rows: T[]; collapsed: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  let collapsed = 0;
  for (const r of rows) {
    const k = stratumKeyOf(r);
    if (k) {
      if (seen.has(k)) { collapsed++; continue; }
      seen.add(k);
    }
    out.push(r);
  }
  return { rows: out, collapsed };
}

function evidenceRows(tool: string, d: Record<string, unknown>): {
  rows: Array<Record<string, unknown>>;
  collapsed: number;
} {
  const all = rowsOf(d, tool);
  // Dedupe the ROWS first, so `collapsed` counts only genuine republications.
  // Hoisting the headline into the same pass made its own row look like a
  // collapsed duplicate, and the payload then reported "1 additional row was
  // the SAME strata re-published on earlier days" about a row from today.
  // A disclosure that misdescribes what it disclosed is worse than none.
  const { rows: deduped, collapsed } = latestPerStratum(all);

  const head = isObj((d as any).headline)
    ? { ...((d as any).headline as Record<string, unknown>), __headline: true }
    : null;
  if (!head) return { rows: deduped, collapsed };

  // The headline REPLACES its own stratum's row rather than adding a second one.
  const hk = stratumKeyOf(head);
  const rest = hk ? deduped.filter((r) => stratumKeyOf(r) !== hk) : deduped;
  return { rows: [head, ...rest], collapsed };
}

/** Evidence lines. Every one is a field that exists, with its qualifier attached. */
/**
 * What a row line says when the renderer could extract nothing from the row.
 *
 * Named because `thesisFor` counts it. The thesis used to say "N measured
 * readings returned" from `rows.length` alone, which is a count of ROWS, not of
 * measurements — and a declared collection is not automatically a set of
 * observations. Reconciling the two is the whole point of giving this a name.
 */
const NO_REPORTABLE_MEASUREMENT = "returned with no reportable measurement";

function evidenceFor(tool: string, d: unknown): string[] {
  const out: string[] = [];
  if (!isObj(d)) return out;
  const { rows, collapsed } = evidenceRows(tool, d);
  const decisionWithheld = isObj(d.decisionEligibility) && d.decisionEligibility.status === "WITHHELD";

  if (decisionWithheld) {
    out.push(
      "* **AUDIT-ONLY SOURCE CLAIM:** the selected source observation is retained below for inspection, " +
      "but decisionEligibility revoked binding authority. Direction, signed move, and action fields in raw evidence must not be acted on.",
    );
  }

  if (rows.length) {
    for (const r of rows.slice(0, MAX_EVIDENCE)) {
      const sym = str(r.symbol ?? r.ticker ?? r.engine ?? r.name ?? r.day);
      const parts: string[] = [];

      const v = isObj(r.verdict) ? (r.verdict as any) : null;
      if (v) {
        const dir = str(v.direction);
        const conf = num(v.confidence);
        if (dir) parts.push(
          `${decisionWithheld ? "audit-only, non-binding source direction " : ""}${dir}` +
          `${conf !== null ? ` at ${(conf * 100).toFixed(0)}% confidence` : ""}`,
        );
        // 🔴 GATED. A signed move beside a withheld direction reads as the call.
        const mv = num(v.expectedMovePct);
        if (!decisionWithheld && mv !== null && str(v.actionability) === "ACTIONABLE") parts.push(`expected move ${mv > 0 ? "+" : ""}${mv}%`);
        else if (str(v.actionability) === "ABSTAIN") parts.push("no directional call (ABSTAIN)");
      }

      // 🔴 GATED. A judged figure is quotable only with publishable:true, and
      // never without its stratum and its recall.
      if ("publishable" in r) {
        if (r.publishable === true) {
          const p = num(r.precision_pct), b = num(r.base_rate_pct), rc = num(r.recall_pct), lm = num(r.lead_median_hours);
          const stratum = [str(r.engine), str(r.horizon_tier), str(r.bar_regime)].filter(Boolean).join(" · ");
          const seg: string[] = [];
          if (p !== null) seg.push(`precision ${p}%`);
          if (b !== null) seg.push(`vs a ${b}% base rate`);
          if (rc !== null) seg.push(`**recall ${rc}%**`);
          else seg.push("**recall not reported — do not quote the precision alone**");
          if (lm !== null) seg.push(`median lead ${lm}h`);
          parts.push(`${stratum ? `[${stratum}] ` : ""}${seg.join(", ")}`);
        } else {
          // 🔓 SHOWN, NOT HIDDEN — and the two are different things.
          //
          // This branch used to print "withheld — do not quote this row's
          // figures" and drop every number. That told the agent a measurement
          // EXISTED and then refused to say what it was, which is the worst of
          // both worlds: the agent cannot audit a number it cannot see, and an
          // engine that is silently absent from the fleet reads as an engine
          // that found nothing. `absence renders as safety` is this codebase's
          // most-repeated defect, and suppressing our own bad marks is the
          // flattering direction of it — `funding_proxy` runs 6.31pp BELOW its
          // base rate, and hiding that hid a deficit, not a secret.
          //
          // The gate was never about concealment. It is about what may be
          // RESTATED to a human as Fahali's accuracy. So we publish the
          // measurement and bind it to its verdict in the same breath: here is
          // the number, here is why it does not clear the bar, do not repeat it
          // as a claim. An agent reasoning about which engine to trust needs
          // exactly this, and a buyer who checks us finds the misses on the
          // record — which is the entire product.
          const p = num(r.precision_pct), b = num(r.base_rate_pct);
          const rc = num(r.recall_pct), lm = num(r.lead_median_hours);
          // NO LIFT SEGMENT. Precision, base rate, recall, lead time and n are
          // raw measurements and stay on the record; lift is the DERIVED claim
          // (precision minus base rate), and for magnitude-family strata that
          // derivation reproduces a retracted figure — the conditional
          // denominator is unconfirmed, so any engine firing on already-moving
          // tape flatters itself. Printing it beside "do not restate" prose
          // still puts the banned number in the reasoning channel. An agent
          // that needs lift reads a publishable stratum. (2026-09-11)
          const n = num(r.effective_sample ?? (r as any).total);
          const stratum = [str(r.engine) ?? str((r as any).key), str(r.horizon_tier), str(r.bar_regime)]
            .filter(Boolean)
            .join(" · ");
          const seg: string[] = [];
          if (p !== null) seg.push(`precision ${p}%`);
          if (b !== null) seg.push(`vs a ${b}% base rate`);
          if (rc !== null) seg.push(`recall ${rc}%`);
          if (lm !== null) seg.push(`median lead ${lm}h`);
          if (n !== null) seg.push(`n=${n.toLocaleString("en-US")}`);
          const why =
            str((r as any).withheldReason) ??
            str(isObj((r as any).publishability) ? (r as any).publishability.reason : null) ??
            str((r as any).reason) ??
            "it does not clear the publishability bar (n_eff ≥ 30 and lift > 0)";
          parts.push(
            `${stratum ? `[${stratum}] ` : ""}${seg.length ? `${seg.join(", ")} — ` : ""}` +
              `\u{1F512} **MEASURED BUT NOT PUBLISHABLE**: ${why} ` +
              `These figures are evidence you may reason over; they are NOT a claim. Do not restate them to a human as Fahali's accuracy.`,
          );
        }
      }

      for (const k of ["netFlowUsd", "net_flow", "confidence", "severity", "detectionStrength", "score", "riskScore", "value", "correlationWithMarket", "tailDependenceLambdaL", "changePct", "price", "alert_type", "alertType", "state", "regime"]) {
        if (parts.length >= 4) break;
        if (!(k in r)) continue;
        const s = str((r as any)[k]);
        if (s !== null) parts.push(`${k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} ${s}`);
      }

      // The server chose this row; say so, or an agent picks its own and the
      // tool description's "do NOT pick your own row" goes unheeded.
      const lead = (r as any).__headline ? "⭐ **THE STRATUM FAHALI STANDS BEHIND** — " : "";
      if (sym || parts.length) out.push(`* ${lead}**${sym ?? "reading"}:** ${parts.length ? parts.join(" · ") : NO_REPORTABLE_MEASUREMENT}`);
    }
    if (rows.length > MAX_EVIDENCE) out.push(`* *${rows.length - MAX_EVIDENCE} further strata are in the JSON block below and are NOT summarised here.*`);
    if (collapsed > 0) {
      out.push(
        `* *${collapsed} additional rows were the SAME strata re-published on earlier days and are collapsed above. ` +
          `They are repeat measurements of one rolling window, not separate findings — do not count or sum them.*`,
      );
    }
    return out;
  }

  for (const [k, v] of Object.entries(d)) {
    if (out.length >= MAX_EVIDENCE) break;
    if (["schemaVersion", "provenanceRoot", "agentBriefing", "systemDirective", "nextTools", "notReturned", "requested"].includes(k)) continue;
    const s = str(v);
    if (s !== null) out.push(`* **${k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")}:** ${s}`);
  }
  return out;
}

/**
 * 🔴 "Hard Evidence (Verified)" WAS A LITERAL. (fixed 2026-09-04)
 *
 * The heading claimed verification unconditionally, over any rows the tool
 * happened to return. Measured on a live `fahali_get_realtime_alerts` payload:
 * every row carried `claim_tier: "detector"` and the response carried
 * `matchedTrackRecord: null` with the reason "No stratum yet clears the
 * headline floor" — i.e. Fahali was explicitly REFUSING to stand behind a
 * record, while the loudest line on the page called the same rows verified.
 * The snapshot did it too, over raw price ticks.
 *
 * This is envelope invariant #3 — every label must derive from the value it
 * describes — unenforced on the briefing's own headings, which are the part an
 * agent is most likely to repeat verbatim.
 *
 * `detector` is the producer's own word for an unjudged observation, so it is
 * read from the row rather than inferred.
 */
function evidenceHeadingFor(tool: string, d: unknown): string {
  if (!isObj(d)) return "## Evidence";

  if (isObj(d.matchedTrackRecord)) {
    return "## Evidence (a judged record matched — see The Judged Record below)";
  }

  const tiers = new Set<string>();
  for (const row of rowsOf(d, tool).slice(0, 200)) {
    const nested = [row, row.details, row.metadata].filter(isObj) as Record<string, unknown>[];
    for (const node of nested) {
      const tier = str(node.claim_tier ?? node.claimTier);
      if (tier) tiers.add(tier.toLowerCase());
      const deeper = node._raw;
      if (isObj(deeper)) {
        const deepTier = str(deeper.claim_tier ?? deeper.claimTier);
        if (deepTier) tiers.add(deepTier.toLowerCase());
      }
    }
  }

  if (tiers.size === 1 && tiers.has("detector")) {
    return "## Evidence (detector output — observed, NOT judged)";
  }
  if (tiers.size > 1) {
    return `## Evidence (mixed claim tiers: ${[...tiers].sort().join(", ")} — read each row)`;
  }

  const dataState = str(d.dataState)?.toLowerCase();
  if (dataState === "proxy") return "## Evidence (proxy — not directly measured)";
  if (dataState === "measured") return "## Evidence (measured — no judged record matched)";
  return "## Evidence";
}

function blindSpotsFor(tool: string, d: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const normalized: string[] = [];
  if (isObj(d)) {
    const absence = isObj(d.absence) ? d.absence : null;
    if (str(absence?.reason)) normalized.push(str(absence?.reason)!);
    if (isObj(d.decisionEligibility) && d.decisionEligibility.status === "WITHHELD" && Array.isArray(d.decisionEligibility.reasons)) {
      for (const entry of d.decisionEligibility.reasons) {
        if (!isObj(entry)) continue;
        const reason = str(entry.reason);
        if (reason) normalized.push(`${str(entry.code) ?? "INELIGIBLE"}: ${reason}`);
      }
    }
  }
  for (const s of [...(STANDING_BLIND_SPOTS[tool] ?? []), ...normalized, ...absences(d)]) {
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(`* ${t}`);
    if (out.length >= MAX_ABSENCES) break;
  }
  /**
   * 🔴 THE BLIND SPOT NEVER READ THE FIELDS THAT RECORD WHAT WAS DROPPED.
   * (fixed 2026-09-04)
   *
   * It searched `absence`, `decisionEligibility` and the standing list, then
   * fell through to "nothing was flagged as missing" — while the SAME payload
   * carried `responseControl.omitted: {clusters: 45, signals: 45, instruments:
   * 52}`, a `symbolCoverage.notReturned` list, and an `evidenceQuality.reason`
   * saying the counts were unknown. The section whose entire job is naming what
   * we do not know was the one section not reading the structured record of it.
   *
   * These are read from typed fields, never re-derived from prose.
   */
  for (const line of structuralBlindSpots(d)) {
    const t = line.trim();
    if (!t || seen.has(t) || out.length >= MAX_ABSENCES) continue;
    seen.add(t);
    out.push(`* ${t}`);
  }
  if (!out.length) out.push("* No withheld field, abstention or stale marker was returned with this response. That means nothing was flagged as missing — it is not a statement that coverage is complete.");
  return out;
}

/** Blind spots that live in the response-control envelope rather than the payload. */
function structuralBlindSpots(d: unknown): string[] {
  if (!isObj(d)) return [];
  const out: string[] = [];

  const rc = isObj(d.responseControl) ? d.responseControl : null;
  const omitted = isObj(rc?.omitted) ? rc!.omitted as Record<string, unknown> : null;
  if (omitted) {
    const parts = Object.entries(omitted)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([k, v]) => `${v} ${k}`);
    if (parts.length) {
      out.push(`This response is a PROJECTION: ${parts.join(", ")} were omitted. Raise \`limit\` or use detail=audit to see them.`);
    }
  }

  // Source-side truncation is a different and worse blind spot than projection:
  // no projection setting can reach what the source never read.
  const coverage = isObj(d.coverage) ? d.coverage : null;
  if (coverage?.sourceTruncated === true) {
    const matched = isObj(coverage.matched) ? num((coverage.matched as Record<string, unknown>).alerts) : null;
    const returned = isObj(coverage.returned) ? num((coverage.returned as Record<string, unknown>).alerts) : null;
    out.push(
      matched != null && returned != null
        ? `SOURCE-SIDE TRUNCATION: ${matched} rows match this filter and ${returned} were read. The remainder was never fetched, so absence here is not evidence of absence.`
        : "SOURCE-SIDE TRUNCATION: rows matching this filter were not read. Absence here is not evidence of absence.",
    );
  }

  const notReturned = isObj(d.symbolCoverage) ? (d.symbolCoverage as Record<string, unknown>).notReturned : null;
  if (Array.isArray(notReturned) && notReturned.length) {
    const names = notReturned
      .map((entry) => (isObj(entry) ? str(entry.symbol) : str(entry)))
      .filter(Boolean);
    if (names.length) out.push(`Requested but NOT returned: ${names.join(", ")}. This is not a reading of "quiet" for those names.`);
  }

  /**
   * A REFUSED TOOL IS A BLIND SPOT, and it was the one kind this section could
   * not see (measured 2026-09-04).
   *
   * `fahali_get_capabilities` returned `callerEntitlement.scopeBlockedTools`
   * with THIRTEEN entries — memory, alerts, watches, delivery, all refused to
   * that session — while this section printed "nothing was flagged as missing".
   * Whatever those tools would have measured is not merely absent from the
   * response, it is unreachable, which is strictly worse than an empty result
   * and must never read as a quiet one.
   *
   * `alsoCallableAs` is surfaced with it because a refusal that does not name
   * the next rung reads as a dead end: on 2026-08-31 two of these were callable
   * all along by passing `refresh: false`.
   */
  const entitlement = isObj(d.callerEntitlement) ? d.callerEntitlement : null;
  const blockedTools = Array.isArray(entitlement?.scopeBlockedTools) ? entitlement.scopeBlockedTools : [];
  if (blockedTools.length) {
    const recoverable = blockedTools.filter(
      (entry) => isObj(entry) && isObj(entry.alsoCallableAs) && entry.alsoCallableAs.callableNow === true,
    ).length;
    out.push(
      `${blockedTools.length} tool${blockedTools.length === 1 ? " is" : "s are"} REFUSED to this session by OAuth scope, `
      + "so anything they would measure is out of view — unreachable, not quiet."
      + (recoverable
        ? ` ${recoverable} of them become callable right now with the arguments named in \`alsoCallableAs\`.`
        : "")
      + " Read `callerEntitlement.scopeBlockedTools`.",
    );
  }
  const blockedEndpoints = Array.isArray(entitlement?.blockedEndpoints) ? entitlement.blockedEndpoints : [];
  if (blockedEndpoints.length) {
    out.push(
      `${blockedEndpoints.length} endpoint${blockedEndpoints.length === 1 ? " is" : "s are"} refused by this `
      + "credential's API-key scope, which is a SEPARATE gate from the OAuth one. "
      + "Read `callerEntitlement.blockedEndpoints`.",
    );
  }

  /**
   * ⚠️ `evidenceQuality.reason` and `freshnessNormalized.reason` are
   * deliberately NOT lifted into this section. Both fire on nearly every
   * payload — the envelope emits them whenever a source declares no counts and
   * no freshness window, which is most tools — so restating them here would put
   * two unconditional bullets above the conditional ones and train an agent to
   * skip the section. They remain published as typed fields in the same
   * response. Every entry above is conditional on something ACTUALLY having
   * been dropped, which is what makes the section worth reading.
   */
  return out;
}

/** Percentages arrive as numbers; keep the source's precision, don't invent any. */
function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

/**
 * 🔴 There is deliberately no pp/lift formatter here any more.
 *
 * A helper that renders "+38.67pp" is an invitation to render a lift, and the
 * only lift we could render today is a magnitude lift, which §2 bans. Deleting
 * the formatter — rather than leaving it unused — is what stops the next edit
 * from quietly reaching for it.
 */

/**
 * THE JUDGED RECORD — the section that makes a verdict and its record one call.
 *
 * Projects `matchedTrackRecord`, merged into the payload by judgedRecord.ts. Three
 * states, three renderings, and NO fourth branch that prints nothing: a missing
 * record must occupy space on the page and say what it is, because a section
 * that silently disappears when the number is bad is how "absence renders as
 * safety" gets shipped for the ninth time.
 *
 * 🔴 Precision NEVER appears without recall, and never without the stratum and
 * the measurement date. That is not a style preference. `71.44% precision` is
 * the flattering half of a warning product — it says how often we were right
 * WHEN WE SPOKE, and says nothing about the events we slept through. The recall
 * figure beside it is the half a buyer is actually exposed to.
 */
function judgedRecordLines(d: unknown): string[] {
  if (!isObj(d)) return [];
  const rec = (d as Record<string, unknown>).matchedTrackRecord as JudgedRecord | undefined;

  // The field is absent only when this response is itself the lead-time payload
  // (attachJudgedRecord skips it to avoid printing one stratum as two readings).
  if (!rec || typeof rec !== "object") return [];

  if (rec.state === "measured") {
    const s = rec.stratum;
    const out = [
      `* **${s.engine} · ${s.horizonTier} · ${s.barRegime}** — median warning **${Math.round(s.leadMedianHours * 10) / 10}h** ahead of the event.`,
      // Wording deliberately matches what fahaliai.com already publishes for
      // this same stratum and what apps/landing/scripts/audit.mjs cleared:
      // "precision X% with recall Y%, against a Z% base rate". Two surfaces
      // showing one entity must read the same source and say the same thing.
      //
      // 🔴 NO LIFT FIGURE. The components are stated; the subtraction is not.
      // This stratum's claim family is `magnitude`, and CLAUDE.md §2 bans "any
      // magnitude lift" while its conditional denominator is unconfirmed.
      `* It caught **${pct(s.recallPct)}** of qualifying events. When it did warn, **${pct(s.precisionPct)}** held, against a **${pct(s.baseRatePct)}** base rate.`,
      // WHAT the precision measures, in the endpoint's own words. Without this
      // an agent reads a non-directional magnitude figure as a price forecast.
      `* ${s.claimMeans}`,
      `* Effective sample **${s.effectiveSample.toLocaleString("en-US")}**, across **${s.warnedEvents.toLocaleString("en-US")}** warned events. Measured on **${String(s.measuredOn).slice(0, 10)}**.`,
      `* This is ONE stratum, selected by recall. It is not a platform-wide figure and it does not transfer to another engine, horizon or regime.`,
    ];
    // The number is only as fresh as its computation. Same rule as the homepage
    // #vltRecord: a figure whose measurement date is missing reads as current
    // forever, and this payload is cached upstream for 15 minutes.
    if (rec.dataAsOf) out.push(`* Record computed **${rec.dataAsOf.slice(0, 10)}**.`);
    return out;
  }

  if (rec.state === "withheld") {
    return [
      `* **No record figure is available for this response.** ${rec.reason}`,
      `* This is a refusal by the publishability gate, not an absence of data and not a clean result. Report it as "not measured" — never as "no problems found".`,
    ];
  }

  return [
    `* **The judged record could not be read.** ${rec.reason}`,
    `* This is an infrastructure failure, NOT a gate refusal — it says nothing at all about the record. Do not infer that a record exists, or that one does not.`,
  ];
}

/**
 * Resolve one routed call against the payload.
 *
 * Returns BOTH the rendered line and the recommendation with its arguments
 * substituted. Returning only the line was a real defect: `buildAgentBriefing`
 * then pushed the unresolved TEMPLATE into `nextTools`, so the markdown said
 * `fahali_get_forecast(symbol="NVDA")` while the structured channel shipped
 * `{symbol: "$symbol"}`. `structuredContent` is the channel enforcing clients
 * read — the agents this whole file exists for would have called a literal
 * "$symbol". Caught only by rendering the BUILT artifact; the test that covered
 * this asserted `nextTools.length >= 1`, which is presence, not content.
 */
function renderCall(rec: NextToolCall, d: unknown): { line: string; resolved: NextToolCall } | null {
  const syms = symbolsIn(d);
  const nestedId = (keys: string[]): string | null => {
    if (!isObj(d)) return null;
    // Incident payloads carry their identity under `incident` / `incidents[]`
    // / `timeline[]` — without these roots every route off
    // fahali_get_active_incidents resolves to null and is dropped, leaving the
    // incident-triage path unroutable (measured 2026-09-11: all three nextTools
    // off active-incidents poisoned or dead).
    const roots = [d, (d as any).watch, (d as any).verdict, (d as any).delta, (d as any).subscription, (d as any).incident];
    const arrays = [(d as any).watches, (d as any).items, (d as any).subscriptions, (d as any).incidents, (d as any).timeline];
    for (const root of roots) {
      if (!isObj(root)) continue;
      for (const key of keys) {
        const value = str((root as any)[key]);
        if (value) return value;
      }
    }
    for (const rows of arrays) {
      const first = Array.isArray(rows) ? rows.find(isObj) : null;
      if (!first) continue;
      for (const key of keys) {
        const value = str((first as any)[key]);
        if (value) return value;
      }
    }
    return null;
  };
  const args: string[] = [];
  const resolvedArgs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec.args ?? {})) {
    let val = v;
    if (v === "$symbol") {
      if (!syms.length) return null; // required-ish arg unresolvable → drop, never placeholder
      val = syms[0];
    } else if (v === "$symbols") {
      if (!syms.length) return null;
      val = syms.slice(0, 5).join(",");
    } else if (v === "$key") {
      const k2 = isObj(d) ? str((d as any).key) : null;
      if (!k2) return null;
      val = k2;
    } else if (v === "$watch_id") {
      const id = nestedId(["watchId", "watch_id"]);
      if (!id) return null;
      val = id;
    } else if (v === "$verdict_id") {
      const id = nestedId(["verdictId", "verdict_id", "id"]);
      if (!id) return null;
      val = id;
    } else if (v === "$subscription_id") {
      const id = nestedId(["subscriptionId", "subscription_id", "id"]);
      if (!id) return null;
      val = id;
    } else if (v === "$incident_id") {
      // Upstream names it `incidentId` (publicIncident, incidents.ts:532);
      // `incident_id` is the wire name of the dispatch argument, kept as a
      // fallback. Without this branch the literal "$incident_id" shipped in
      // nextTools and every acknowledge/timeline call 400d.
      const id = nestedId(["incidentId", "incident_id", "id"]);
      if (!id) return null;
      val = id;
    }
    resolvedArgs[k] = val;
    args.push(`${k}="${val}"`);
  }
  return {
    line: `\`${rec.tool}(${args.join(", ")})\``,
    resolved: rec.args ? { ...rec, args: resolvedArgs } : rec,
  };
}

function validatedNextActions(
  candidates: NextToolCall[],
  catalog?: AgentToolContract[],
): NextToolCall[] {
  if (!catalog?.length) return candidates;
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  return candidates.flatMap((candidate) => {
    const target = byName.get(candidate.tool);
    if (!target || target._meta?.disabled === true) return [];
    const properties = target.inputSchema?.properties ?? {};
    const args = candidate.args ?? {};
    if (Object.keys(args).some((key) => !(key in properties))) return [];
    const required = target.inputSchema?.required ?? [];
    if (required.some((key) => !(key in args))) return [];
    /**
     * 🔴 `requiredTier` DESCRIBES A GATE THAT IS NOT THE ONE ENFORCED (R5).
     *
     * Tier gates have been OPEN since 2026-08-01 (three switches, all
     * pass-through). What actually refuses a call is API-KEY SCOPE. So a
     * caller on the professional tier reads `requiredTier: "professional"`,
     * plans against it, and is then refused — the field is present, prominent,
     * and wrong, which is worse than absent.
     *
     * The name is kept because `schemaStable: true` is a promise and removing
     * a field would break consumers reading it. What is added is the thing
     * that makes it safe to read: the gate that is live, stated beside it.
     */
    return [{
      ...candidate,
      requiredTier: target._meta?.requiredTier ?? "free",
      gatedBy: "api_key_scope",
      tierNote:
        "requiredTier is DESCRIPTIVE and is not what refuses a call — tier gates are open. " +
        "Access is decided by TWO gates: this credential's API-key scope, and the session's " +
        "OAuth grant, which is enforced in-process and refuses before dispatch. Call " +
        "fahali_get_capabilities and read callerEntitlement.scopeBlockedTools and " +
        "callerEntitlement.blockedEndpoints together — blockedEndpoints alone covers only the " +
        "API-key gate, and was empty on 2026-08-29 while twelve tools were being refused.",
    }];
  });
}

function nextActionsAfterEligibility(
  actions: NextToolCall[],
  data: unknown,
): NextToolCall[] {
  if (!isObj(data) || !isObj(data.decisionEligibility) || data.decisionEligibility.status !== "WITHHELD") {
    return actions;
  }
  // An ineligible decision may route only to evidence, identity resolution,
  // record inspection, or health diagnosis. Calls whose prose says "apply",
  // "act", or "price the decision" would turn a withheld claim back into an
  // operational instruction through the routing layer.
  const diagnostic = new Set([
    "fahali_get_lead_time",
    "fahali_get_track_record_scorecard",
    "fahali_resolve_instrument",
    "fahali_get_engine_status",
    "fahali_get_evidence",
    "fahali_get_verdict_by_id",
    "fahali_get_verdict_history",
    "fahali_get_active_incidents",
    "fahali_get_incident_timeline",
  ]);
  // Replaying an immutable historical verdict may legitimately route to a new
  // live portfolio evaluation. That does not execute or rewrite the replayed
  // action; it asks the current mandate/evidence gate for a fresh decision.
  if (data.decisionEligibility.kind === "historical_replay") {
    diagnostic.add("fahali_get_portfolio_decision");
  }
  return actions.filter((action) => diagnostic.has(action.tool));
}

export function buildAgentBriefing(
  tool: string,
  data: unknown,
  catalog?: AgentToolContract[],
): { markdown: string; nextTools: NextToolCall[] } {
  const next: NextToolCall[] = [];
  const callLines: string[] = [];
  for (const rec of ROUTES[tool] ?? []) {
    const call = renderCall(rec, data);
    if (!call) continue;
    next.push(call.resolved);
  }

  const validated = nextActionsAfterEligibility(validatedNextActions(next, catalog), data);
  for (const rec of validated) {
    const call = renderCall(rec, data);
    if (!call) continue;
    callLines.push(
      `* To ${rec.why}, call: ${call.line}` +
        // "(requires professional)" read as an entitlement statement to an
        // agent that already HELD professional and was still refused. The
        // parenthetical now names the tier as a plan label, not a permission.
        (rec.requiredTier && rec.requiredTier !== "free" ? ` (${rec.requiredTier} plan feature — your key's scope decides)` : ""),
    );
  }

  const md = [
    `# ${titleFor(tool, data)}`,
    "",
    "## The Core Thesis",
    ...thesisFor(tool, data),
    "",
    evidenceHeadingFor(tool, data),
    ...evidenceFor(tool, data),
    "",
    "## The Blind Spot (What we DO NOT know)",
    ...blindSpotsFor(tool, data),
  ];
  // The record goes AFTER the blind spot and BEFORE the routed calls,
  // deliberately: it is the denominator for everything above it, and it must be
  // read before an agent decides what to do next. An empty array here means the
  // payload IS the lead-time response, which carries the record already.
  const recordLines = judgedRecordLines(data);
  if (recordLines.length) md.push("", "## The Judged Record", ...recordLines);
  if (callLines.length) md.push("", "## Recommended Next Tool Calls for Agent", ...callLines);
  return { markdown: md.join("\n"), nextTools: validated };
}

/**
 * The one seam. Wraps whatever the dispatch returned.
 *
 * Channel contract: `content[0]` is always Markdown for a person or a text-only
 * agent; `structuredContent` is always the complete typed contract available at
 * the requested detail. Raw JSON is not serialized into a second text block.
 *
 * Errors get the directive and the routing but no briefing: there is no payload
 * to project, and a narrative over an error is exactly the fabrication this
 * file exists to prevent. They are exempt from schema validation, so adding
 * fields to them is safe.
 */
function parseError(result: CallToolResult): Record<string, unknown> {
  const raw = (result.content ?? []).find((item) => item.type === "text") as { text?: string } | undefined;
  const rawText = raw?.text ?? "";
  let parsedText: Record<string, unknown> = {};
  try {
    const value = JSON.parse(rawText || "{}");
    if (isObj(value)) parsedText = value;
  } catch {
    parsedText = rawText ? { message: rawText } : {};
  }
  // Hosted MCP auth failures carry their typed code in structuredContent while
  // their text block is already Markdown. The old parser inspected only text,
  // turning AUTH_EXPIRED and AUTH_SCOPE into an undifferentiated TOOL_ERROR.
  const structured = isObj(result.structuredContent) ? result.structuredContent : {};
  const parsed = { ...parsedText, ...structured };
  const nestedError = isObj(parsed.error) ? parsed.error : {};
  const errorString = typeof parsed.error === "string" ? parsed.error : null;
  const explicitCode = str(nestedError.code) ?? str(parsed.code) ??
    (errorString && /^[A-Z][A-Z0-9_]+$/.test(errorString) ? errorString : null);
  const status = Number(nestedError.httpStatus ?? nestedError.status ?? parsed.httpStatus ?? parsed.status ?? 0) || null;
  const message = (str(nestedError.message) ?? str(parsed.message) ??
    (errorString && errorString !== explicitCode ? errorString : null) ?? rawText.trim()) || "The tool call failed.";
  const upperCode = explicitCode?.toUpperCase() ?? "";
  const upper = `${upperCode} ${message} ${rawText}`.toUpperCase();
  const upgrade = isObj(nestedError.upgrade) ? nestedError.upgrade : isObj(parsed.upgrade) ? parsed.upgrade : null;
  const requiredTier = str(nestedError.requiredTier) ?? str(parsed.requiredTier) ?? str(upgrade?.requiredTier) ??
    upper.match(/REQUIRES?\s+(?:THE\s+)?([A-Z][A-Z0-9_-]*)\s+TIER/)?.[1]?.toLowerCase() ?? null;
  const code =
    upperCode === "AUTH_EXPIRED" || (upper.includes("TOKEN") && upper.includes("EXPIRED")) ? "AUTH_EXPIRED" :
    ["AUTH_SCOPE", "INSUFFICIENT_SCOPE", "FREE_SCOPE"].includes(upperCode) || /INSUFFICIENT[_ ]SCOPE|FREE DEVELOPER KEY|FULL API KEY/.test(upper) ? "AUTH_SCOPE" :
    upperCode === "AUTH_APPROVAL_REQUIRED" || upper.includes("NO APPROVAL RECEIVED") ? "AUTH_APPROVAL_REQUIRED" :
    ["AUTH_REQUIRED", "AUTH_INVALID", "AUTH_SERVICE_UNAVAILABLE"].includes(upperCode) ? upperCode :
    ["ENTITLEMENT_REQUIRED", "TIER_REQUIRED", "UPGRADE_REQUIRED"].includes(upperCode) || requiredTier !== null || upgrade !== null ? "ENTITLEMENT_REQUIRED" :
    status === 401 ? "AUTH_INVALID" :
    status === 403 ? "ENTITLEMENT_REQUIRED" :
    status === 429 ? "RATE_LIMITED" :
    upper.includes("TIMED OUT") ? "UPSTREAM_TIMEOUT" :
    status !== null && status >= 500 ? "UPSTREAM_ERROR" : "TOOL_ERROR";
  const explicitRetryable = typeof nestedError.retryable === "boolean"
    ? nestedError.retryable
    : typeof parsed.retryable === "boolean" ? parsed.retryable : null;
  const reauthUrl = str(nestedError.reauthUrl) ?? str(parsed.reauthUrl) ??
    (["AUTH_EXPIRED", "AUTH_INVALID", "AUTH_REQUIRED", "AUTH_SCOPE", "AUTH_APPROVAL_REQUIRED"].includes(code)
      ? "https://mcp.fahaliai.com/.well-known/oauth-authorization-server"
      : null);
  return {
    code,
    message,
    httpStatus: status,
    retryable: explicitRetryable ?? ["AUTH_EXPIRED", "AUTH_APPROVAL_REQUIRED", "AUTH_SERVICE_UNAVAILABLE", "RATE_LIMITED", "UPSTREAM_TIMEOUT", "UPSTREAM_ERROR"].includes(code),
    ...(reauthUrl ? { reauthUrl } : {}),
    ...(str(nestedError.requestId) ?? str(parsed.requestId) ? { requestId: str(nestedError.requestId) ?? str(parsed.requestId) } : {}),
    ...(Array.isArray(nestedError.requiredScopes ?? parsed.requiredScopes) ? { requiredScopes: nestedError.requiredScopes ?? parsed.requiredScopes } : {}),
    ...(Array.isArray(nestedError.grantedScopes ?? parsed.grantedScopes) ? { grantedScopes: nestedError.grantedScopes ?? parsed.grantedScopes } : {}),
    ...(requiredTier ? { requiredTier } : {}),
    ...(upgrade ? { upgrade } : {}),
  };
}

function briefMarkdown(
  tool: string,
  responseState: string,
  dataState: string,
  decision: Record<string, unknown> | null,
  asOf: string,
  absence?: Record<string, unknown> | null,
  omitted: Record<string, number> = {},
): string {
  const title = tool.replace(/^fahali_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const headline = str(decision?.headline);
  const direction = str(decision?.direction);
  const omittedEntries = Object.entries(omitted);
  const completeness = omittedEntries.length
    ? `partial projection; omitted ${omittedEntries.map(([key, count]) => `${count} from ${key}`).join(", ")}`
    : "complete for endpoint-declared collections";
  return [
    `# Fahali ${title}`,
    "",
    `**${responseState}**${headline ? ` — ${headline}` : ""}`,
    direction ? `- Direction: \`${direction}\`` : null,
    `- Data state: \`${dataState}\``,
    absence?.kind ? `- Absence type: \`${String(absence.kind)}\`${str(absence.reason) ? ` — ${str(absence.reason)}` : ""}` : null,
    `- Completeness: ${completeness}`,
    `- As of: ${asOf}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function appendCompletenessMarkdown(markdown: string, omitted: Record<string, number>): string {
  const entries = Object.entries(omitted);
  const lines = entries.length
    ? [
        "This is a partial projection. The omitted evidence remains available through a larger limit or audit detail.",
        ...entries.map(([key, count]) => `- \`${key}\`: ${count} omitted`),
      ]
    : ["Complete for every endpoint-declared collection at the requested scope."];
  return `${markdown}\n\n## Completeness\n\n${lines.join("\n")}`;
}

function errorMarkdown(tool: string, envelope: Record<string, unknown>): string {
  const title = tool.replace(/^fahali_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const error = isObj(envelope.error) ? envelope.error : {};
  return [
    `# Fahali ${title}`,
    "",
    "**ERROR — no market conclusion was produced.**",
    `- Code: \`${str(error.code) ?? "TOOL_ERROR"}\``,
    `- Message: ${str(error.message) ?? "The tool call failed."}`,
    `- Retryable: ${error.retryable === true ? "yes" : "no"}`,
    `- As of: ${str(envelope.asOf) ?? new Date().toISOString()}`,
  ].join("\n");
}

const NON_BINDING_DECISION_OBSERVATION_KEYS = new Set([
  "whyNow",
  "rationale",
  "explanation",
  "invalidationConditions",
  "caveats",
  "notes",
  "methodology",
]);

/**
 * Enrich a selected decision with explicitly non-binding observations only.
 *
 * The response-level `decision` can describe another row or an aggregate. It
 * must never overwrite the selected row's symbol, identity, direction,
 * conflict, actionability, horizon, authority producer, or action fields.
 * The unmodified upstream object remains available as `sourceDecision`.
 */
function mergeDecision(
  upstream: unknown,
  inferred: Record<string, unknown> | null,
  allowStandaloneUpstream = false,
): Record<string, unknown> | null {
  if (!inferred) return allowStandaloneUpstream && isObj(upstream) ? { ...upstream } : null;
  if (!isObj(upstream)) return inferred;
  const observations = Object.fromEntries(
    Object.entries(upstream).filter(([key]) => NON_BINDING_DECISION_OBSERVATION_KEYS.has(key)),
  );
  return { ...observations, ...inferred };
}

function mergeEvidenceQuality(
  upstream: unknown,
  inferred: Record<string, unknown>,
): Record<string, unknown> {
  if (!isObj(upstream)) return inferred;
  return {
    ...inferred,
    ...upstream,
    // These are normalized envelope states. Preserve the upstream copy in
    // sourceEvidenceQuality, but never let a source-level "measured" overwrite
    // the MCP's PARTIAL/stale classification.
    dataState: inferred.dataState,
    stale: inferred.stale,
  };
}

function mergeConfidenceSemantics(
  upstream: unknown,
  inferred: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(upstream)) return inferred;
  const out = upstream.filter(isObj) as Array<Record<string, unknown>>;
  const seen = new Set(out.map((entry) => str(entry.field)).filter(Boolean));
  for (const entry of inferred) {
    const field = str(entry.field);
    if (!field || !seen.has(field)) out.push(entry);
  }
  return out;
}

function mergeInstruments(upstream: unknown, inferred: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out = Array.isArray(upstream) ? upstream.filter(isObj).map((item) => ({ ...item })) : [];
  const bySymbol = new Map(out.map((item) => [str(item.symbol)?.toUpperCase(), item]));
  for (const item of inferred) {
    const symbol = str(item.symbol)?.toUpperCase();
    if (!symbol) continue;
    const existing = bySymbol.get(symbol);
    if (existing) {
      /**
       * 🔴 A RESOLVED INSTRUMENT MUST NOT BE BACKFILLED FROM THE PARSE.
       *
       * The source now resolves against venue asset lists, so BEAM arrives as
       * `venue: "NASDAQ", resolutionState: "resolved"` with `ambiguityWarning:
       * null` — correctly null, because nothing is ambiguous. Backfilling every
       * null then pulled this module's own parse-derived warning in beside it,
       * and the entry shipped "Asset class is UNRESOLVED for BEAM. Venue is
       * missing." next to a populated venue.
       *
       * Backfill exists to enrich a source that could not answer. Where the
       * source DID answer, its silence on a field is an answer too — and
       * "there is no caveat" is exactly the field where overriding that turns
       * a resolution into a contradiction. Third instance of this shape today:
       * when two blocks describe one entity, the one that measured wins.
       */
      if (str(existing.resolutionState) === "resolved") continue;
      for (const [key, value] of Object.entries(item)) {
        if ((existing[key] === null || existing[key] === undefined) && value !== null && value !== undefined) existing[key] = value;
      }
    }
    else { out.push(item); bySymbol.set(symbol, item); }
  }
  return out;
}

type SelectedClaimFreshness = {
  dataAgeSeconds: number | null;
  staleAfterSeconds: number | null;
  stale: boolean | null;
  basis: "selected_row" | "selected_row_timestamp" | "response_level" | "unknown";
};

type DecisionEligibilityReason = {
  code: string;
  reason: string;
};

type DecisionEligibility = {
  kind: "market_direction" | "portfolio_monitoring" | "portfolio_execution" | "historical_replay" | "not_applicable";
  applies: boolean;
  status: "ELIGIBLE" | "WITHHELD" | "NOT_APPLICABLE";
  /** Which permitted producer bound this direction — see BINDING_AUTHORITIES. */
  bindingAuthority: (typeof BINDING_AUTHORITIES)[number] | null;
  selectedSymbol: string | null;
  reasons: DecisionEligibilityReason[];
  validity: Record<string, unknown>;
  sourceState: {
    responseState: string;
    dataState: string;
    partial: boolean;
    stale: boolean;
  };
  identity: Record<string, unknown>;
  producerEligibility: Record<string, unknown>;
};

const MARKET_DIRECTION_TOOLS = new Set([
  "fahali_get_market_verdict",
  "fahali_get_market_decision",
  "fahali_get_symbol_decision",
]);

const PORTFOLIO_MONITORING_TOOLS = new Set([
  "fahali_get_portfolio_decision",
  "fahali_watch_portfolio",
  "fahali_update_portfolio_watch",
  "fahali_get_watch_delta",
]);

const HISTORICAL_REPLAY_TOOLS = new Set([
  "fahali_get_verdict_by_id",
  "fahali_get_verdict_history",
]);

function historicalCollectionEligibility(
  response: Record<string, unknown>,
  classification: AgentClassification,
): DecisionEligibility {
  const sourcePartial = classification.responseState === RESPONSE_STATES.partial ||
    classification.dataState === DATA_STATES.partial || isExplicitSourcePartial(response);
  const sourceStale = classification.dataState === DATA_STATES.stale || isStalePayload(response);
  return {
    kind: "historical_replay",
    applies: true,
    status: "WITHHELD",
    bindingAuthority: null,
    selectedSymbol: null,
    reasons: [{
      code: "HISTORICAL_RECORD_ONLY",
      reason: "Verdict history records what Fahali decided then; no historical row authorizes a current portfolio action.",
    }],
    validity: {
      known: false,
      reason: "Historical chronology is immutable audit evidence. Re-evaluate the live watch for current validity.",
    },
    sourceState: {
      responseState: classification.responseState,
      dataState: classification.dataState,
      partial: sourcePartial,
      stale: sourceStale,
    },
    identity: {
      resolutionState: "historical_collection",
      note: "Each immutable row retains its producer-captured identity; the collection itself is not a current instrument claim.",
    },
    producerEligibility: {
      eligible: null,
      status: "not_applicable",
      reason: "Historical retrieval is audit-only and cannot acquire current authority from producer performance.",
    },
  };
}

/**
 * One-way operator rollback for current binding decisions.
 *
 * Unset/true leaves the normal evidence, authority, identity, freshness and
 * mandate gates in control. A disabled value can only add a WITHHELD reason;
 * it can never turn an otherwise ineligible decision into an eligible one.
 */
function bindingDecisionsEnabled(): boolean {
  const configured = process.env.FAHALI_BINDING_DECISIONS_ENABLED;
  if (configured === undefined || configured.trim() === "") return true;
  // A non-empty but misspelled value is safer as disabled than as an accidental
  // authorization. Only an explicit affirmative value keeps normal eligibility
  // evaluation enabled; even then, every ordinary gate still runs.
  return ["true", "1", "on", "enabled", "yes"].includes(configured.trim().toLowerCase());
}

function applyBindingDecisionRollback(eligibility: DecisionEligibility): DecisionEligibility {
  if (bindingDecisionsEnabled() || !eligibility.applies ||
      eligibility.kind !== "market_direction") {
    return eligibility;
  }
  const rollbackReason: DecisionEligibilityReason = {
    code: "OPERATOR_BINDING_DISABLED",
    reason: "Current binding decisions are disabled by the FAHALI_BINDING_DECISIONS_ENABLED operator rollback control.",
  };
  return {
    ...eligibility,
    status: "WITHHELD",
    reasons: eligibility.reasons.some((entry) => entry.code === rollbackReason.code)
      ? eligibility.reasons
      : [...eligibility.reasons, rollbackReason],
  };
}

function freshnessInside(value: Record<string, unknown>): SelectedClaimFreshness | null {
  let age: number | null = null;
  let staleAfter: number | null = null;
  let sources = 0;
  // Key-carrying for the same reason as `normalizedFreshness`: a nested block
  // that declares itself freshness may use the producer's own spelling.
  //
  // Deliberately NOT extended to the selected row's own bare `ageMinutes`,
  // which several row producers do publish. Reading it here would be defensible
  // — this function looks at ONE claim, so it cannot pair one row's age with
  // another row's bar — but it is a separate decision from the block-scoped fix
  // and is not measured yet. Left as-is rather than changed in passing.
  const walk = (candidate: unknown, depth: number, key: string | null): void => {
    if (!isObj(candidate) || depth > 3) return;
    const level = freshnessAtLevel(candidate, key);
    if (level.age !== null || level.staleAfter !== null) {
      sources++;
      if (level.age !== null) age = age === null ? level.age : Math.max(age, level.age);
      if (level.staleAfter !== null) {
        staleAfter = staleAfter === null ? level.staleAfter : Math.min(staleAfter, level.staleAfter);
      }
    }
    for (const [childKey, child] of Object.entries(candidate)) {
      // Arrays are sibling claims. Never let one row determine another row's
      // age after the selection/projection boundary.
      if (isObj(child)) walk(child, depth + 1, childKey);
    }
  };
  walk(value, 0, null);
  if (!sources) return null;
  return {
    dataAgeSeconds: age,
    staleAfterSeconds: staleAfter,
    stale: age !== null && staleAfter !== null ? age > staleAfter : null,
    basis: "selected_row",
  };
}

function timestampMillis(value: Record<string, unknown>): number | null {
  const raw = value.dataAsOf ?? value.data_as_of ?? value.asOf ?? value.as_of ??
    value.timestamp ?? value.updatedAt ?? value.updated_at ?? value.createdAt ?? value.created_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw < 10_000_000_000 ? raw * 1000 : raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function selectedClaimFreshness(
  selected: Record<string, unknown> | undefined,
  response: Record<string, unknown>,
  sourceHasSiblingClaims: boolean,
): SelectedClaimFreshness {
  if (selected) {
    const direct = freshnessInside(selected);
    if (direct) return direct;

    const observedAt = timestampMillis(selected);
    const responseAt = timestampMillis(response);
    if (observedAt !== null && responseAt !== null && responseAt >= observedAt) {
      return {
        dataAgeSeconds: Math.round((responseAt - observedAt) / 1000),
        staleAfterSeconds: null,
        stale: null,
        basis: "selected_row_timestamp",
      };
    }
  }

  const responseFreshness = isObj(response.freshness) ? response.freshness : {};
  const explicitSharedCapture = [
    response.freshnessBasis,
    response.freshness_basis,
    responseFreshness.basis,
    responseFreshness.scope,
  ].some((value) => ["single_shared_capture", "shared_capture", "selected_claim"].includes(String(value ?? "").toLowerCase()));
  if (sourceHasSiblingClaims && !explicitSharedCapture) {
    return { dataAgeSeconds: null, staleAfterSeconds: null, stale: null, basis: "unknown" };
  }

  // Response-level freshness is a last resort for a genuinely single-claim
  // response or a source that explicitly declares one shared capture. The
  // known `oldest_row_in_response` aggregate is NOT such a declaration.
  const level = freshnessAtLevel(response);
  if (level.age !== null || level.staleAfter !== null) {
    return {
      dataAgeSeconds: level.age,
      staleAfterSeconds: level.staleAfter,
      stale: level.age !== null && level.staleAfter !== null ? level.age > level.staleAfter : null,
      basis: "response_level",
    };
  }
  return { dataAgeSeconds: null, staleAfterSeconds: null, stale: null, basis: "unknown" };
}

function selectedClaimValidity(
  tool: string,
  response: Record<string, unknown>,
  decision: Record<string, unknown> | null,
  sourceHasSiblingClaims: boolean,
): { validity: Record<string, unknown>; freshness: SelectedClaimFreshness; selected: Record<string, unknown> | undefined } {
  const selected = pickLeadRow(tool, response).row;
  const freshness = selectedClaimFreshness(selected, response, sourceHasSiblingClaims);
  const scope = isObj(response.scope) ? response.scope : {};
  const directHorizonFields = (value: Record<string, unknown> | null | undefined): Record<string, unknown> =>
    Object.fromEntries(Object.entries(value ?? {}).filter(([key, child]) =>
      /^(?:forecast)?horizon(?:hours|min|minutes|tier)?$/i.test(key) && !isObj(child) && !Array.isArray(child),
    ));
  const selectedVerdict = selected && isObj(selected.verdict) ? selected.verdict : null;
  const selectedCanonical = selected && isObj(selected.canonical) ? selected.canonical : null;
  // With no selected row, the top-level horizon remains useful audit metadata
  // for claim expiry. It still cannot become a normalized binding decision.
  // Once a row is selected, however, its horizon is exclusive and no response-
  // level sibling/aggregate may replace it.
  const validityDecision = selected
    ? decision
    : (decision ?? (isObj(response.decision) ? response.decision : null));
  // Validity belongs to the promoted authoritative claim. Production verdict
  // rows embed committee/forecast evidence under `canonical`; recursively
  // walking that graph let a nested 24h committee observation expire or
  // re-stratum a 72h canonical decision. Use the first explicit horizon at the
  // authority boundary, in promotion order, and never descend into evidence.
  const authoritativeHorizons = [
    directHorizonFields(validityDecision),
    directHorizonFields(selectedCanonical),
    directHorizonFields(selectedVerdict),
    directHorizonFields(selected),
    directHorizonFields(scope),
  ].find((candidate) => Object.keys(candidate).length > 0) ?? {};
  const target: Record<string, unknown> = { authoritativeClaim: authoritativeHorizons };
  return {
    validity: {
      ...claimValidity(target, freshness.dataAgeSeconds),
      selectedClaim: true,
      selectedSymbol: str(selected?.symbol ?? selected?.ticker ?? selected?.instrument) ?? null,
      ageBasis: freshness.basis,
    },
    freshness,
    selected,
  };
}

function identityForSelected(
  instruments: Array<Record<string, unknown>>,
  symbol: string | null,
): Record<string, unknown> | null {
  if (!symbol) return null;
  return instruments.find((entry) => str(entry.symbol)?.toUpperCase() === symbol.toUpperCase()) ?? null;
}

function integrityFailures(
  response: Record<string, unknown>,
  selected: Record<string, unknown> | undefined,
): string[] {
  const failures: string[] = [];
  const inspect = (value: unknown, label: string): void => {
    if (!isObj(value)) return;
    for (const key of ["evidenceHashVerified", "contentHashVerified", "identityValid", "canonicalIdentityValid"]) {
      if (value[key] === false) failures.push(`${label}.${key}=false`);
    }
    const state = String(value.status ?? value.state ?? "").trim().toLowerCase();
    if (["invalid", "failed", "error", "mismatch", "quarantined"].includes(state)) {
      failures.push(`${label}.${state}`);
    }
    if (value.identityMismatch === true || value.identity_mismatch === true) failures.push(`${label}.identityMismatch=true`);
  };
  for (const [label, value] of [
    ["integrity", response.integrity],
    ["evidenceIntegrity", response.evidenceIntegrity ?? response.evidence_integrity],
    ["identityIntegrity", response.identityIntegrity ?? response.identity_integrity],
    ["selected.integrity", selected?.integrity],
    ["selected.evidenceIntegrity", selected?.evidenceIntegrity ?? selected?.evidence_integrity],
    ["selected.identityIntegrity", selected?.identityIntegrity ?? selected?.identity_integrity],
  ] as Array<[string, unknown]>) inspect(value, label);
  return [...new Set(failures)];
}

function normalisedClass(value: unknown): string | null {
  const raw = str(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? null;
  if (!raw) return null;
  if (["stock", "stocks", "us_equity", "equities"].includes(raw)) return "equity";
  if (["digital_asset", "cryptocurrency"].includes(raw)) return "crypto";
  return raw;
}

/**
 * THE PRODUCERS PERMITTED TO BIND A DIRECTION — founder decision, 2026-09-08.
 *
 * "engines can recommend, but final verdict is assessed by this committee that
 * is self learning."
 *
 * Until today this was the single string "canonical_verdict", and the refusal
 * text said so explicitly: *"Agent and committee verdicts remain evidence and
 * cannot fill this authority gap."* That inverted the architecture. The
 * committee is the composition layer — the brief's own §4 says no individual
 * engine clears direction with a comparable margin and `committee_verdict`
 * does — so the one producer holding the edge was the one barred from using
 * it, while `canonical_verdict`, measured `insufficient_sample` with a null
 * record on 2026-09-08, held sole authority.
 *
 * 🔴 WHAT DID NOT CHANGE, AND MUST NOT. Widening WHO may bind does not weaken
 * WHAT binding requires. Every authority in this list is still held to the
 * same exact-stratum performance record, verified-only identity population,
 * and horizon/class/family match — the checks below are simply asked about the
 * producer that actually bound, instead of always about `canonical_verdict`.
 * An authority with no matching judged record still cannot bind. That is the
 * boundary, and generalising the lookup is what keeps it honest for the
 * committee rather than accidentally exempting it.
 */
const BINDING_AUTHORITIES = ["canonical_verdict", "canonical_symbol_verdict", "committee_verdict"] as const;

/**
 * The record lookup follows the BOUND producer. Passing the authority in is the
 * whole point: filtering on a hardcoded `canonical_verdict` while a different
 * producer binds would check one engine's homework and let another sit the
 * exam — the exact failure the ledger records as "the learning loop's two ends
 * named DIFFERENT engines."
 */
function canonicalProducerRecords(
  response: Record<string, unknown>,
  authority: string = "canonical_verdict",
): Record<string, unknown>[] {
  // The legacy producerRecord is one compatibility row per engine. Exact
  // authority selection must prefer the complete candidate collection whenever
  // it is attached, otherwise a later stratum silently overwrites an earlier
  // exact match in buildProducerIndex.
  const candidates = response.producerRecordCandidates;
  const raw = Array.isArray(candidates) && candidates.length ? candidates : response.producerRecord;
  const records = Array.isArray(raw) ? raw.filter(isObj) : isObj(raw) ? [raw] : [];
  const want = authority.toLowerCase();
  return records.filter((record) => str(record.engine)?.toLowerCase() === want);
}

function producerRecordFamily(record: Record<string, unknown>): string | null {
  // This is authority metadata, not a display label. Do not normalize or
  // derive it: only the producer's explicit `directional` population can
  // authorize a signed decision.
  return str(record.claimFamily ?? record.claim_family);
}

function producerIdentityPopulation(record: Record<string, unknown>): string | null {
  // Row-level identityStatus says nothing about the aggregate population used
  // to compute a producer score. Never promote it into population authority.
  return str(record.identityPopulation ?? record.identity_population);
}

function producerRecordStableKey(record: Record<string, unknown>): string {
  return [
    str(record.engine)?.toLowerCase() ?? "",
    str(record.horizonTier ?? record.horizon_tier)?.toLowerCase() ?? "",
    normalisedClass(record.barRegime ?? record.bar_regime) ?? "",
    producerRecordFamily(record) ?? "",
    producerIdentityPopulation(record) ?? "",
    str(record.measuredOn ?? record.measured_on) ?? "",
    str(record.state)?.toLowerCase() ?? "",
  ].join("\u0000");
}

function producerRecordAuthorityKey(record: Record<string, unknown>): string {
  return [
    str(record.state)?.toLowerCase() ?? "",
    record.quotable === true ? "quotable" : record.quotable === false ? "not_quotable" : "quotable_unknown",
    String(num(record.precisionPct ?? record.precision_pct) ?? ""),
    String(num(record.baseRatePct ?? record.base_rate_pct) ?? ""),
    String(num(record.effectiveSample ?? record.effective_sample) ?? ""),
  ].join("\u0000");
}

function canonicalPerformanceEligibility(
  response: Record<string, unknown>,
  validity: Record<string, unknown>,
  identity: Record<string, unknown> | null,
  authority: string = "canonical_verdict",
): Record<string, unknown> {
  const records = canonicalProducerRecords(response, authority);
  if (!records.length) {
    return {
      eligible: false,
      status: "unavailable",
      authority,
      reason: `No ${authority} producer record was attached. Another producer's record cannot substitute for the binding producer's own record.`,
    };
  }
  const selectedHorizon = num(validity.shortestHorizonSeconds);
  const selectedClass = normalisedClass(identity?.assetClass ?? identity?.asset_class);
  // These tools promote a signed market direction. The producer must explicitly
  // publish the exact directional family; missing metadata is not compatibility
  // evidence and a magnitude row is never a substitute.
  const selectedFamily = "directional";
  const structuralExact = records.filter((record) => {
    const recordHorizon = horizonToSeconds(record.horizonTier ?? record.horizon_tier);
    const recordClass = normalisedClass(record.barRegime ?? record.bar_regime);
    const recordFamily = producerRecordFamily(record);
    return selectedHorizon !== null && recordHorizon === selectedHorizon &&
      selectedClass !== null && recordClass === selectedClass &&
      recordFamily === selectedFamily;
  });
  if (!structuralExact.length) {
    return {
      eligible: false,
      status: "stratum_mismatch",
      reason: `No ${authority} producer record exactly matches the selected claim's horizon, instrument class, and directional claim family.`,
      candidateCount: records.length,
      expected: {
        horizonSeconds: selectedHorizon,
        assetClass: selectedClass,
        claimFamily: selectedFamily,
      },
    };
  }
  const exact = structuralExact.filter((record) => producerIdentityPopulation(record) === "verified_only");
  if (!exact.length) {
    return {
      eligible: false,
      status: "identity_population_unverified",
      reason: `The exact ${authority} stratum does not prove that its judged population contains verified identities only. Legacy, mixed, quarantined, or unspecified populations cannot authorize current direction.`,
      candidateCount: records.length,
      structuralCandidateCount: structuralExact.length,
      identityPopulations: [...new Set(structuralExact.map(producerIdentityPopulation))],
      expected: {
        horizonSeconds: selectedHorizon,
        assetClass: selectedClass,
        claimFamily: selectedFamily,
        identityPopulation: "verified_only",
      },
    };
  }
  // Order must never decide authority. Prefer the newest measurement, then a
  // stable full-key tie breaker.
  exact.sort((a, b) => {
    const dateOrder = String(b.measuredOn ?? b.measured_on ?? "").localeCompare(
      String(a.measuredOn ?? a.measured_on ?? ""),
    );
    return dateOrder || producerRecordStableKey(a).localeCompare(producerRecordStableKey(b));
  });
  const exactStates = new Set(exact.map((record) => str(record.state)?.toLowerCase() ?? "unavailable"));
  if (exactStates.size > 1) {
    return {
      eligible: false,
      status: "ambiguous_exact_stratum",
      reason: `Conflicting published and withheld records exist for the exact ${authority} stratum; authority is withheld until the record is reconciled.`,
      candidateCount: records.length,
      exactCandidateCount: exact.length,
    };
  }
  const newestMeasuredOn = str(exact[0].measuredOn ?? exact[0].measured_on);
  const newestExact = exact.filter((candidate) =>
    str(candidate.measuredOn ?? candidate.measured_on) === newestMeasuredOn,
  );
  if (new Set(newestExact.map(producerRecordAuthorityKey)).size > 1) {
    return {
      eligible: false,
      status: "ambiguous_exact_stratum",
      reason: `Contradictory authority metrics exist for the newest exact ${authority} stratum; input order cannot decide whether a direction is binding.`,
      candidateCount: records.length,
      exactCandidateCount: exact.length,
      newestExactCandidateCount: newestExact.length,
    };
  }
  const record = exact[0];
  const state = str(record.state)?.toLowerCase() ?? "unavailable";
  if (state !== "published" || record.quotable !== true) {
    // Carry the stratum's measured grade so the refusal says what the record
    // showed (e.g. worse_than_chance), not merely that a gate refused it.
    const grade = str(record.grade);
    const gradeLabel = str(record.gradeLabel);
    return {
      eligible: false,
      status: state,
      reason: state === "withheld"
        ? `The ${authority} record was measured but did not clear its publishability/performance gate${gradeLabel ? ` (measured grade: ${gradeLabel.toLowerCase()})` : ""}.`
        : `The ${authority} record is not publishable for this decision.`,
      ...(grade ? { recordGrade: grade, recordGradeLabel: gradeLabel } : {}),
      horizonTier: str(record.horizonTier ?? record.horizon_tier),
      barRegime: str(record.barRegime ?? record.bar_regime),
      claimFamily: producerRecordFamily(record),
    };
  }

  const precision = num(record.precisionPct ?? record.precision_pct);
  const baseRate = num(record.baseRatePct ?? record.base_rate_pct);
  const effectiveSample = num(record.effectiveSample ?? record.effective_sample);
  if (precision === null || baseRate === null || effectiveSample === null || precision <= baseRate || effectiveSample < 30) {
    return {
      eligible: false,
      status: "below_gate",
      reason: `The ${authority} record does not prove positive base-rate lift with the minimum effective sample.`,
    };
  }

  const measuredOn = str(record.measuredOn ?? record.measured_on);
  if (!measuredOn) {
    return {
      eligible: false,
      status: "undated",
      reason: `The ${authority} producer record has no measurement date, so it cannot authorize a current claim.`,
    };
  }
  const measuredMs = Date.parse(measuredOn);
  const evaluationMs = Date.now();
  if (!Number.isFinite(measuredMs)) {
    return {
      eligible: false,
      status: "invalid_measurement_time",
      reason: `The ${authority} producer record has an invalid measurement timestamp, so it cannot authorize a current claim.`,
    };
  }
  if (measuredMs > evaluationMs) {
    return {
      eligible: false,
      status: "future_measurement",
      reason: `The ${authority} producer record is future-dated, so it cannot authorize a current claim.`,
    };
  }
  if (evaluationMs - measuredMs > CANONICAL_MAX_RECORD_AGE_MS) {
    return {
      eligible: false,
      status: "stale_measurement",
      reason: `The ${authority} producer record is older than the 36-hour current-authority window.`,
    };
  }
  return {
    eligible: true,
    status: "published_exact_match",
    engine: authority,
    horizonTier: str(record.horizonTier ?? record.horizon_tier),
    barRegime: str(record.barRegime ?? record.bar_regime),
    claimFamily: producerRecordFamily(record),
    identityPopulation: producerIdentityPopulation(record),
    measuredOn,
    effectiveSample,
    candidateCount: records.length,
    exactCandidateCount: exact.length,
  };
}

/**
 * Returns WHICH producer bound the selected direction, or null if none of the
 * permitted authorities is explicitly named.
 *
 * This returned a bare boolean until 2026-09-08. A boolean was sufficient only
 * while exactly one producer could ever bind; with `BINDING_AUTHORITIES` now
 * holding three, the caller must know which one, because the performance
 * record is looked up against it.
 */
function selectedBindingAuthority(
  decision: Record<string, unknown>,
  selected: Record<string, unknown> | undefined,
): (typeof BINDING_AUTHORITIES)[number] | null {
  const selectedVerdict = isObj(selected?.verdict) ? selected.verdict : null;
  const provenance = isObj(selected?.provenance) ? selected.provenance : null;
  // A canonical diagnostic/evidence object is not an authority marker. The
  // selected direction must explicitly name the producer that supplied it;
  // otherwise an agent-produced direction with an empty `canonical: {}` block
  // could silently inherit canonical authority. Unchanged by the widening: the
  // list of permitted names grew, the requirement to NAME one did not move.
  for (const value of [
    provenance?.directionProducer,
    selectedVerdict?.bindingConfidenceProducer,
    decision.bindingConfidenceProducer,
    decision.directionAuthority,
  ]) {
    const named = str(value)?.toLowerCase() ?? "";
    const match = BINDING_AUTHORITIES.find((authority) => authority === named);
    if (match) return match;
  }
  return null;
}

function unresolvedCanonicalConflict(
  decision: Record<string, unknown>,
  selected: Record<string, unknown> | undefined,
): boolean {
  if (decision.conflict !== true) return false;
  const canonical = isObj(selected?.canonical) ? selected.canonical : null;
  const conflict = canonical && isObj(canonical.conflict) ? canonical.conflict : null;
  return conflict?.resolved !== true && conflict?.status !== "resolved";
}

function canonicalRequiredSourceReasons(
  response: Record<string, unknown>,
  selected: Record<string, unknown> | undefined,
  selectedIdentity: Record<string, unknown> | null,
): DecisionEligibilityReason[] {
  const canonical = selected && isObj(selected.canonical) ? selected.canonical : null;
  if (!canonical) {
    return [{
      code: "REQUIRED_SOURCE_STATE_UNKNOWN",
      reason: "The selected claim names canonical authority but does not carry the canonical decision object and its immutable required-source state.",
    }];
  }
  const required = canonical.requiredSourceState ?? canonical.required_source_state;
  if (!isObj(required)) {
    return [{
      code: "REQUIRED_SOURCE_STATE_UNKNOWN",
      reason: "The selected canonical authority does not publish the validity and authority state of the exact sources that produced it.",
    }];
  }

  const failures: DecisionEligibilityReason[] = [];
  // This is eligibility for a live decision at retrieval, not a statement that
  // the sources were valid at the payload's cached `asOf`. Comparing expiry to
  // that old timestamp would let a cached response stay actionable forever.
  const evaluationMs = Date.now();
  if (required.complete !== true || required.authorityEligible !== true) {
    failures.push({
      code: "REQUIRED_SOURCE_STATE_INVALID",
      reason: "The canonical required-source set is incomplete or not authority-eligible.",
    });
  }
  const sources = Array.isArray(required.sources) ? required.sources.filter(isObj) : [];
  if (!sources.length) {
    failures.push({
      code: "REQUIRED_SOURCE_STATE_UNKNOWN",
      reason: "The canonical authority names no immutable required-source records.",
    });
  }

  for (const source of sources) {
    const sourceId = str(source.sourceId ?? source.source_id) ?? "unknown_source";
    const producer = str(source.producer)?.toLowerCase() ?? "unknown_producer";
    const sourceIdentity = capturedIdentityOf(source);
    const identityStatus = str(
      source.instrumentIdentityStatus ?? source.instrument_identity_status,
    )?.toLowerCase();
    if (source.authorityEligible !== true || identityStatus !== "verified" ||
        !validCapturedIdentityHash(
          source.capturedIdentityHash ?? source.captured_identity_hash,
          sourceIdentity,
        )) {
      failures.push({
        code: "REQUIRED_SOURCE_IDENTITY_INVALID",
        reason: `${producer}/${sourceId} is not backed by a verified producer-captured InstrumentIdentityV1 whose recomputed hash matches, or is not authority-eligible.`,
      });
    }
    if (!sameImmutableCanonicalIdentity(selectedIdentity, sourceIdentity)) {
      failures.push({
        code: "REQUIRED_SOURCE_IDENTITY_MISMATCH",
        reason: `${producer}/${sourceId} belongs to a different canonical instrument than the selected claim. A self-validating source cannot authorize another symbol, venue, asset class, or quote currency.`,
      });
    }
    const responseState = str(source.responseState ?? source.response_state) ?? "";
    if (responseState !== "MEASURED" || source.stale !== false) {
      failures.push({
        code: "REQUIRED_SOURCE_STATE_INVALID",
        reason: `${producer}/${sourceId} does not explicitly carry the canonical MEASURED, non-stale source state.`,
      });
    }
    const generatedMs = new Date(String(source.generatedAt ?? source.generated_at ?? "")).getTime();
    const expiresMs = new Date(String(source.expiresAt ?? source.expires_at ?? "")).getTime();
    if (!Number.isFinite(generatedMs) || !Number.isFinite(expiresMs) || generatedMs > evaluationMs ||
        expiresMs <= evaluationMs || expiresMs <= generatedMs ||
        expiresMs - generatedMs > CANONICAL_REQUIRED_SOURCE_MAX_TTL_MS) {
      failures.push({
        code: "REQUIRED_SOURCE_EXPIRED",
        reason: `${producer}/${sourceId} has an expired, future-issued, missing, internally invalid, or overlong authority window.`,
      });
    }
  }

  const forecast = isObj(canonical.forecast) ? canonical.forecast : null;
  const forecastRequired = Boolean(forecast) || sources.some((source) =>
    String(source.producer ?? "").toLowerCase().includes("forecast"),
  ) || canonical.probabilities != null || canonical.expectedRangePct != null || canonical.expected_range_pct != null;
  if (forecastRequired) {
    const validity = forecast && isObj(forecast.validity) ? forecast.validity : null;
    const identityIntegrity = forecast && isObj(forecast.identityIntegrity ?? forecast.identity_integrity)
      ? (forecast.identityIntegrity ?? forecast.identity_integrity) as Record<string, unknown>
      : null;
    const issuedMs = new Date(String(
      validity?.issuedAt ?? validity?.issued_at ?? forecast?.issuedAt ?? forecast?.issued_at ?? "",
    )).getTime();
    const expiresMs = new Date(String(
      validity?.expiresAt ?? validity?.expires_at ?? forecast?.expiresAt ?? forecast?.expires_at ?? "",
    )).getTime();
    if (!forecast || !validity || validity.valid !== true || !Number.isFinite(issuedMs) ||
        !Number.isFinite(expiresMs) || issuedMs > evaluationMs || expiresMs <= evaluationMs ||
        expiresMs <= issuedMs || expiresMs - issuedMs > CANONICAL_REQUIRED_SOURCE_MAX_TTL_MS) {
      failures.push({
        code: "REQUIRED_SOURCE_EXPIRED",
        reason: "The forecast input that influenced the canonical claim is expired or does not publish a valid, bounded producer-issued authority window.",
      });
    }
    const forecastIdentity = forecast ? capturedIdentityOf(forecast) : null;
    if (!forecast || !verifiedForecastVoters(identityIntegrity) ||
        !completeCapturedExecutionIdentity(forecastIdentity) ||
        !validCapturedIdentityHash(
          forecast.sourceIdentityHash ?? forecast.source_identity_hash,
          forecastIdentity,
        )) {
      failures.push({
        code: "REQUIRED_SOURCE_IDENTITY_INVALID",
        reason: "The required forecast does not carry verified identity integrity, captured InstrumentIdentityV1, and its source identity hash.",
      });
    }
    if (!sameImmutableCanonicalIdentity(selectedIdentity, forecastIdentity)) {
      failures.push({
        code: "REQUIRED_SOURCE_IDENTITY_MISMATCH",
        reason: "The required forecast belongs to a different canonical instrument than the selected claim. A self-validating forecast cannot authorize another symbol, venue, asset class, or quote currency.",
      });
    }
  }

  return failures.filter((entry, index, all) =>
    all.findIndex((candidate) => candidate.code === entry.code && candidate.reason === entry.reason) === index,
  );
}

function decisionEligibilityFor(
  tool: string,
  response: Record<string, unknown>,
  classification: AgentClassification,
  decision: Record<string, unknown> | null,
  instruments: Array<Record<string, unknown>>,
  selectedClaim: ReturnType<typeof selectedClaimValidity>,
): DecisionEligibility {
  const selectedSymbol = str(
    selectedClaim.selected?.symbol ?? selectedClaim.selected?.ticker ?? selectedClaim.selected?.instrument,
  )?.toUpperCase() ?? symbolsIn(response, tool)[0] ?? null;
  const identity = identityForSelected(instruments, selectedSymbol);
  const selectedRowIdentity = selectedClaim.selected
    ? capturedIdentityOf(selectedClaim.selected)
    : null;
  // When the selected row itself carries an identity, that producer capture is
  // the claim identity. The normalized top-level instrument remains a display
  // projection and must agree; it cannot overwrite the row during decoration.
  // A response-level instrument is a display/index projection. The binding
  // claim must carry its own producer-captured InstrumentIdentityV1 and hash;
  // otherwise a correct header can silently authorize a row captured for a
  // different venue or asset class.
  const authorityIdentity = selectedRowIdentity;
  const validity = selectedClaim.validity;
  const sourcePartial = classification.responseState === RESPONSE_STATES.partial ||
    classification.dataState === DATA_STATES.partial || isExplicitSourcePartial(response);
  const sourceStale = classification.dataState === DATA_STATES.stale ||
    selectedClaim.freshness.stale === true || isStalePayload(response);
  const actionability = str(decision?.actionability)?.toUpperCase() ?? null;
  const direction = str(decision?.direction)?.toLowerCase() ?? null;
  const explicitBinding = decision?.binding === true ||
    (decision?.binding !== false && str(decision?.directionAuthorityStatus)?.toUpperCase() === "AVAILABLE");
  const bindingAttempt = MARKET_DIRECTION_TOOLS.has(tool) && Boolean(decision) && (
    explicitBinding || actionability === "ACTIONABLE" ||
    Boolean(direction && direction !== "unknown" && direction !== "neutral")
  );
  const sourceState = {
    responseState: classification.responseState,
    dataState: classification.dataState,
    partial: sourcePartial,
    stale: sourceStale,
  };
  if (!bindingAttempt || !decision) {
    return {
      kind: "not_applicable",
      applies: false,
      status: "NOT_APPLICABLE",
      bindingAuthority: null,
      selectedSymbol,
      reasons: [],
      validity,
      sourceState,
      identity: identity ?? { resolutionState: "not_applicable" },
      producerEligibility: { eligible: null, status: "not_applicable" },
    };
  }

  const reasons: DecisionEligibilityReason[] = [];
  if (sourcePartial) reasons.push({ code: "SOURCE_PARTIAL", reason: sourcePartialReason(response) });
  if (sourceStale) reasons.push({ code: "SOURCE_STALE", reason: "The selected claim depends on a source outside its declared freshness window." });
  if (validity.known !== true) {
    reasons.push({ code: "VALIDITY_UNKNOWN", reason: str(validity.reason) ?? "The selected forward claim's validity could not be established." });
  } else if (validity.expired === true) {
    reasons.push({ code: "CLAIM_EXPIRED", reason: str(validity.reason) ?? "The selected forward claim is past its declared horizon." });
  }

  const selectedIdentityHash = selectedClaim.selected
    ? selectedClaim.selected.sourceIdentityHash ?? selectedClaim.selected.source_identity_hash
    : null;
  const identityResolved = completeCapturedExecutionIdentity(authorityIdentity) &&
    validCapturedIdentityHash(selectedIdentityHash, authorityIdentity);
  if (!identityResolved) {
    reasons.push({
      code: "IDENTITY_INVALID",
      reason: selectedSymbol
        ? `The selected instrument ${selectedSymbol} does not carry a complete producer-captured InstrumentIdentityV1 with its recomputed source identity hash.`
        : "The selected binding claim has no complete, hash-verified producer-captured instrument identity.",
    });
  }
  if (selectedRowIdentity && identity &&
      !sameImmutableCanonicalIdentity(selectedRowIdentity, identity)) {
    reasons.push({
      code: "IDENTITY_INVALID",
      reason: "The selected row's producer-captured identity conflicts with the normalized top-level identity for that claim.",
    });
  }

  const integrity = integrityFailures(response, selectedClaim.selected);
  if (integrity.length) {
    reasons.push({
      code: "EVIDENCE_INTEGRITY_INVALID",
      reason: `Evidence or identity integrity failed (${integrity.join(", ")}).`,
    });
  }
  reasons.push(...canonicalRequiredSourceReasons(response, selectedClaim.selected, authorityIdentity));

  const boundAuthority = selectedBindingAuthority(decision, selectedClaim.selected);
  if (!boundAuthority) {
    reasons.push({
      code: "CANONICAL_AUTHORITY_ABSENT",
      reason:
        `The selected claim does not name a permitted binding direction producer (${BINDING_AUTHORITIES.join(", ")}). ` +
        "Individual engine reads remain evidence and cannot fill this authority gap on their own — the committee composes them.",
    });
  }
  if (unresolvedCanonicalConflict(decision, selectedClaim.selected)) {
    reasons.push({ code: "CANONICAL_CONFLICT_UNRESOLVED", reason: "The canonical claim still reports an unresolved evidence conflict." });
  }

  // The record is checked against the producer that actually bound. When no
  // permitted authority was named, CANONICAL_AUTHORITY_ABSENT above already
  // refuses; the default keeps the historical lookup for that path so an
  // unnamed producer cannot fall through to a laxer check.
  const producerEligibility = canonicalPerformanceEligibility(
    response,
    validity,
    authorityIdentity,
    boundAuthority ?? "canonical_verdict",
  );
  if (producerEligibility.eligible !== true) {
    reasons.push({
      code: "CANONICAL_PERFORMANCE_INELIGIBLE",
      reason: str(producerEligibility.reason) ?? "The exact canonical producer stratum did not clear its performance gate.",
    });
  }

  return {
    kind: "market_direction",
    applies: true,
    status: reasons.length ? "WITHHELD" : "ELIGIBLE",
    // Names the producer that actually bound, so a consumer can tell a
    // committee-authorised call from a canonical one rather than reading a
    // constant that was true only while one producer could ever bind.
    bindingAuthority: boundAuthority ?? "canonical_verdict",
    selectedSymbol,
    reasons,
    validity,
    sourceState,
    identity: authorityIdentity ?? { resolutionState: "missing", canonicalId: null },
    producerEligibility,
  };
}

function storedPortfolioDecision(response: Record<string, unknown>): Record<string, unknown> | null {
  if (isObj(response.verdict)) {
    // The production watch/replay routes return a VerdictHistoryRow wrapper;
    // the mandate-aware decision is nested at verdict.decision. Older fixtures
    // and compatibility callers may still return the decision directly.
    if (isObj(response.verdict.decision)) return response.verdict.decision;
    if (response.verdict.action !== undefined || Array.isArray(response.verdict.positions)) return response.verdict;
  }
  if (isObj(response.delta) && isObj(response.delta.current)) return response.delta.current;
  if (isObj(response.decision) && Array.isArray(response.decision.positions) && response.decision.action !== undefined) {
    return response.decision;
  }
  return null;
}

function portfolioEvidenceSources(response: Record<string, unknown>): Record<string, unknown>[] {
  const history = isObj(response.verdict) && isObj(response.verdict.decision) ? response.verdict : null;
  const historySnapshot = history ? history.evidenceSnapshot ?? history.evidence_snapshot : null;
  const directSnapshot = response.evidenceSnapshot ?? response.evidence_snapshot;
  const snapshot = isObj(historySnapshot)
    ? historySnapshot
    : isObj(directSnapshot) ? directSnapshot : null;
  return snapshot && Array.isArray(snapshot.sources) ? snapshot.sources.filter(isObj) : [];
}

function portfolioDecisionProjection(response: Record<string, unknown>): Record<string, unknown> | null {
  const stored = storedPortfolioDecision(response);
  if (!stored) return null;
  const legacyAction = str(stored.action)?.toUpperCase() ?? null;
  const monitoringEscalation = legacyAction === "EXIT"
    ? "CRITICAL"
    : legacyAction === "REDUCE"
      ? "ELEVATED"
      : legacyAction === "WATCH"
        ? "WATCH"
        : legacyAction === "HOLD"
          ? "ROUTINE"
          : "UNKNOWN";
  return {
    state: str(stored.state),
    headline: str(stored.headline),
    direction: null,
    actionability: "ABSTAIN",
    abstainReason:
      "This surface is monitor-only. A monitoring escalation never authorizes a personalized recommendation, portfolio action, order, or execution.",
    horizon: str(isObj(stored.mandate) ? stored.mandate.horizon : null),
    action: null,
    legacyMonitoringValue: legacyAction,
    monitoringEscalation,
    monitoringGuidance:
      "Review the monitoring evidence and thresholds through an authorized human or separately regulated decision process.",
    whatToDo: null,
    binding: false,
    directionAuthority: null,
    directionAuthorityStatus: "NOT_APPLICABLE",
    executionAuthority: "NONE",
    executionAuthorityStatus: "PROHIBITED",
    personalizedRecommendation: false,
    executionAllowed: false,
    humanFinancialDecisionRequired: true,
    decisionState: "mandate_aware_monitoring_observation",
  };
}

function completeResolvedIdentity(identity: Record<string, unknown> | null): boolean {
  return str(identity?.resolutionState)?.toLowerCase() === "resolved" &&
    Boolean(
      str(identity?.canonicalInstrumentId ?? identity?.canonicalId ?? identity?.canonical_id) &&
      str(identity?.assetClass ?? identity?.asset_class) && str(identity?.venue) &&
      str(identity?.quoteCurrency ?? identity?.quote_currency),
    );
}

const TRUSTED_CAPTURED_IDENTITY_BASES = new Set([
  "venue_asset_list",
  "provider_asset_registry",
]);

const CAPTURED_VENUE_ALIASES: Record<string, string> = {
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

function normalizeCapturedVenue(value: unknown): string {
  const venue = String(value ?? "").trim().toUpperCase().replace(/_/g, " ");
  return CAPTURED_VENUE_ALIASES[venue] ?? venue;
}

/**
 * A valid hash authenticates one identity; it does not prove that identity is
 * the identity of the selected claim. Required evidence may authorize only an
 * exact immutable canonical-instrument match.
 */
function sameImmutableCanonicalIdentity(
  selected: Record<string, unknown> | null,
  contributor: Record<string, unknown> | null,
): boolean {
  if (!selected || !contributor) return false;
  const selectedCanonical = str(
    selected.canonicalInstrumentId ?? selected.canonicalId ?? selected.canonical_id,
  );
  const contributorCanonical = str(
    contributor.canonicalInstrumentId ?? contributor.canonicalId ?? contributor.canonical_id,
  );
  const selectedClass = str(selected.assetClass ?? selected.asset_class)?.toLowerCase();
  const contributorClass = str(contributor.assetClass ?? contributor.asset_class)?.toLowerCase();
  const selectedVenue = normalizeCapturedVenue(selected.venue);
  const contributorVenue = normalizeCapturedVenue(contributor.venue);
  const selectedQuote = str(selected.quoteCurrency ?? selected.quote_currency)?.toUpperCase();
  const contributorQuote = str(contributor.quoteCurrency ?? contributor.quote_currency)?.toUpperCase();
  const selectedSymbol = str(selected.symbol)?.toUpperCase();
  const contributorSymbol = str(contributor.symbol)?.toUpperCase();
  return Boolean(
    selectedCanonical && contributorCanonical && selectedCanonical === contributorCanonical &&
    selectedClass && contributorClass && selectedClass === contributorClass &&
    selectedVenue && contributorVenue && selectedVenue === contributorVenue &&
    selectedQuote && contributorQuote && selectedQuote === contributorQuote &&
    selectedSymbol && contributorSymbol && selectedSymbol === contributorSymbol,
  );
}

/**
 * Exact counterpart of server/lib/evidenceIdentity.ts#validCanonicalPrefix.
 * A syntactically plausible ID is not sufficient: its terminal must identify
 * the captured symbol/quote on the captured venue and asset class.
 */
function validCapturedCanonicalTerminal(identity: Record<string, unknown>): boolean {
  const canonicalId = str(identity.canonicalInstrumentId);
  const venue = normalizeCapturedVenue(identity.venue);
  const assetClass = str(identity.assetClass)?.toLowerCase();
  const symbol = str(identity.symbol)?.toUpperCase();
  if (!canonicalId || !venue || !assetClass || !symbol) return false;
  const prefix = `${venue.toLowerCase()}:${assetClass}:`;
  if (!canonicalId.startsWith(prefix)) return false;
  const terminal = canonicalId.slice(prefix.length);
  if (assetClass === "equity") return terminal === symbol;
  if (assetClass === "crypto") {
    const quote = str(identity.quoteCurrency)?.toUpperCase();
    if (!quote || !symbol.endsWith(quote) || symbol.length <= quote.length) return false;
    return terminal === `${symbol.slice(0, -quote.length)}-${quote}`;
  }
  return false;
}

const STRICT_AWARE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;

function validStrictAwareIso(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = STRICT_AWARE_ISO_RE.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function completeCapturedExecutionIdentity(identity: Record<string, unknown> | null): boolean {
  if (!identity || identity.resolutionState !== "resolved" || identity.identityVersion !== 1) return false;
  const requiredStringFields = [
    "canonicalInstrumentId",
    "symbol",
    "venue",
    "assetClass",
    "quoteCurrency",
    "resolutionBasis",
    "resolvedAt",
  ];
  if (!requiredStringFields.every((field) =>
    typeof identity[field] === "string" && (identity[field] as string).trim().length > 0)) return false;
  // InstrumentIdentityV1 uses these exact immutable field names. Compatibility
  // aliases and display-only IDs are not sufficient on an execution path.
  const basis = str(identity.resolutionBasis)?.toLowerCase() ?? "";
  if (!TRUSTED_CAPTURED_IDENTITY_BASES.has(basis)) return false;
  const symbolRaw = identity.symbol as string;
  const quoteRaw = identity.quoteCurrency as string;
  const assetClassRaw = identity.assetClass as string;
  if (symbolRaw !== symbolRaw.trim().toUpperCase() ||
      quoteRaw !== quoteRaw.trim().toUpperCase() ||
      assetClassRaw !== assetClassRaw.trim().toLowerCase()) return false;
  const symbol = str(identity.symbol);
  const resolvedAt = str(identity.resolvedAt);
  return Boolean(
    symbol && str(identity.canonicalInstrumentId) && str(identity.venue) &&
    str(identity.assetClass) && str(identity.quoteCurrency) && resolvedAt &&
    validStrictAwareIso(resolvedAt) && validCapturedCanonicalTerminal(identity),
  );
}

/**
 * Recompute the producer-captured InstrumentIdentityV1 hash. Comparing two
 * caller-supplied 64-hex strings is not integrity verification: an arbitrary
 * matching pair would otherwise authorize a tampered identity.
 */
function capturedInstrumentIdentityHash(identity: Record<string, unknown>): string {
  const fields = [
    "fahali.instrument-identity/v1",
    str(identity.canonicalInstrumentId) ?? "",
    str(identity.symbol) ?? "",
    normalizeCapturedVenue(identity.venue),
    str(identity.assetClass) ?? "",
    str(identity.quoteCurrency) ?? "",
    str(identity.resolutionState) ?? "",
    str(identity.resolutionBasis) ?? "",
    String(num(identity.identityVersion) ?? ""),
    str(identity.resolvedAt) ?? "",
  ];
  return createHash("sha256").update(fields.join("\x1f"), "utf8").digest("hex");
}

function validCapturedIdentityHash(
  value: unknown,
  identity: Record<string, unknown> | null,
): value is string {
  if (!identity || !completeCapturedExecutionIdentity(identity) ||
      typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) return false;
  return value.toLowerCase() === capturedInstrumentIdentityHash(identity);
}

/**
 * A FORECAST MAY REST ON AN IDENTITY-VERIFIED SUBSET.
 *
 * 🔴 This mirrors `server/lib/forecastAuthority.ts :: hasVerifiedForecastVoters`
 * FIELD FOR FIELD. The api-server fixed this on 2026-09-07; the MCP envelope kept
 * the old `state === "verified"` bar and nobody noticed the two ends had diverged.
 * Measured on production 2026-09-14: BTCUSDT and ETHUSDT both carried an
 * ACTIONABLE bearish row with a publishable record behind them (`n_eff` 939), and
 * both were WITHHELD here with REQUIRED_SOURCE_IDENTITY_INVALID while the
 * api-server considered the very same forecast authority-eligible.
 *
 * Why the old bar could never pass: `identityIntegrity.state` is computed as
 *   admittedCount === 0 ? "withheld" : exclusions.length > 0 ? "partial" : "verified"
 * so "verified" demands ZERO exclusions — and `getForecast72h` issues a second
 * query whose entire purpose is to surface rows that will be excluded. Every row
 * it finds appends an exclusion by construction. Expiry is continuous and normal,
 * so no correct producer can ever reach zero.
 *
 * WHY THIS IS NOT A WEAKENING. "partial" and "verified" differ in COVERAGE, never
 * in the INTEGRITY of what was admitted:
 *   · a row failing identity verification is EXCLUDED, not admitted
 *   · a row naming a DIFFERENT instrument is excluded as `identity_conflict`,
 *     so contamination cannot enter through a subset
 *   · `admittedState` must still be "verified" and the policy must be the known
 *     `verified-voters-v1` — an unrecognised policy is refused
 *   · "withheld" (admittedCount === 0) stays FATAL: that is the case where
 *     nothing verified at all, and it is the one this must never admit
 *
 * `exclusions` is a TRANSPARENCY LEDGER — the record of evidence we correctly
 * refused. Reading a non-empty ledger as "untrustworthy" turns honest accounting
 * into a disqualifier.
 */
function verifiedForecastVoters(integrity: Record<string, unknown> | null): boolean {
  if (!integrity) return false;
  if (str(integrity.state)?.toLowerCase() === "verified") return true;
  const admitted = isObj(integrity.admitted) ? integrity.admitted : null;
  if (!admitted) return false;
  const counts: unknown[] = [admitted.predictions, admitted.alerts];
  // Every count must be a real non-negative integer AND at least one voter must
  // have been admitted. A missing or non-numeric count is refused, not coerced:
  // an absent denominator is unknown, never zero.
  if (!counts.every((n) => Number.isSafeInteger(n) && (n as number) >= 0)) return false;
  const admittedTotal = counts.reduce<number>((sum, n) => sum + (n as number), 0);
  return str(integrity.state)?.toLowerCase() === "partial"
    && str(integrity.admissionPolicy ?? integrity.admission_policy) === "verified-voters-v1"
    && str(integrity.admittedState ?? integrity.admitted_state)?.toLowerCase() === "verified"
    && admittedTotal > 0;
}

function capturedIdentityOf(value: Record<string, unknown>): Record<string, unknown> | null {
  const identity = value.instrumentIdentity ?? value.instrument_identity;
  return isObj(identity) ? identity : null;
}

function portfolioMonitoringEligibility(
  tool: string,
  response: Record<string, unknown>,
  classification: AgentClassification,
  instruments: Array<Record<string, unknown>>,
  historicalReplay: boolean,
): DecisionEligibility {
  const stored = storedPortfolioDecision(response);
  const sourcePartial = classification.responseState === RESPONSE_STATES.partial ||
    classification.dataState === DATA_STATES.partial || isExplicitSourcePartial(response);
  const evidenceQuality = stored && isObj(stored.evidenceQuality) ? stored.evidenceQuality : null;
  const storedDataState = str(evidenceQuality?.dataState)?.toLowerCase() ?? null;
  const sourceStale = classification.dataState === DATA_STATES.stale || isStalePayload(response) || storedDataState === "stale";
  const sourceState = {
    responseState: classification.responseState,
    dataState: classification.dataState,
    partial: sourcePartial || storedDataState === "partial",
    stale: sourceStale,
  };
  if (!stored) {
    return {
      kind: "not_applicable",
      applies: false,
      status: "NOT_APPLICABLE",
      bindingAuthority: null,
      selectedSymbol: null,
      reasons: [],
      validity: { known: false, reason: "No stored portfolio decision was present." },
      sourceState,
      identity: { resolutionState: "not_applicable" },
      producerEligibility: { eligible: null, status: "not_applicable" },
    };
  }

  const reasons: DecisionEligibilityReason[] = [];
  if (historicalReplay) {
    reasons.push({
      code: "HISTORICAL_RECORD_ONLY",
      reason: "An immutable verdict replay records what Fahali observed then; retrieve a fresh watch assessment for current monitoring validity.",
    });
  }
  if (sourcePartial || storedDataState === "partial") {
    reasons.push({
      code: "SOURCE_PARTIAL",
      reason: sourcePartial
        ? sourcePartialReason(response)
        : "The stored portfolio decision reports partial evidence coverage.",
    });
  }
  if (sourceStale) {
    reasons.push({ code: "SOURCE_STALE", reason: "The stored portfolio decision or its contributing evidence is stale." });
  }
  if (storedDataState === "no_data") {
    reasons.push({ code: "SOURCE_NO_DATA", reason: "The stored portfolio decision has no measured contributing evidence." });
  }

  const positions = Array.isArray(stored.positions) ? stored.positions.filter(isObj) : [];
  const evidenceSources = portfolioEvidenceSources(response);
  const selectedSymbol = str(positions[0]?.symbol)?.toUpperCase() ?? null;
  // `instruments` remains a display aid, but it is not execution authority. It
  // may contain an identity inferred by this MCP from venue/class strings. A
  // portfolio action requires the producer-captured InstrumentIdentityV1 that
  // was frozen into the stored position, plus its captured hash.
  const unresolvedSymbols = positions.flatMap((position) => {
    const symbol = str(position.symbol)?.toUpperCase() ?? "unknown";
    const identity = capturedIdentityOf(position);
    const identitySymbol = str(identity?.symbol)?.toUpperCase();
    return completeCapturedExecutionIdentity(identity) && identitySymbol === symbol ? [] : [symbol];
  });
  if (!positions.length || unresolvedSymbols.length) {
    reasons.push({
      code: "IDENTITY_INVALID",
      reason: !positions.length
        ? "The portfolio decision carries no contributing positions to identify."
        : `Contributing positions lack producer-captured, trusted InstrumentIdentityV1: ${[...new Set(unresolvedSymbols)].join(", ")}. Display-time venue/class inference cannot authorize execution.`,
    });
  }

  const integrity = [
    ...integrityFailures(response, stored),
    ...positions.flatMap((position) => integrityFailures(position, position)),
    ...evidenceSources.flatMap((source) => integrityFailures(source, source)),
  ];
  const evidenceById = new Map(
    evidenceSources
      .map((source) => [str(source.evidenceId ?? source.evidence_id), source] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0])),
  );
  for (const position of positions) {
    const symbol = str(position.symbol)?.toUpperCase() ?? "unknown";
    const positionIdentity = capturedIdentityOf(position);
    const positionIdentityHash = position.sourceIdentityHash ?? position.source_identity_hash;
    if (!validCapturedIdentityHash(positionIdentityHash, positionIdentity)) {
      integrity.push(`position.${symbol}.sourceIdentityHash_missing_or_invalid`);
    }
    const evidenceRef = str(position.evidenceRef ?? position.evidence_ref);
    const basis = str(position.actionBasis ?? position.action_basis)?.toLowerCase();
    if (!evidenceRef) {
      if (basis === "directional") integrity.push(`position.${symbol}.evidenceRef_missing`);
      continue;
    }
    const source = evidenceById.get(evidenceRef);
    if (!source) {
      integrity.push(`position.${symbol}.evidenceRef_not_in_snapshot`);
      continue;
    }
    const sourceIdentity = capturedIdentityOf(source);
    const sourceIdentityHash = source.sourceIdentityHash ?? source.source_identity_hash;
    if (!completeCapturedExecutionIdentity(sourceIdentity)) {
      integrity.push(`evidence.${evidenceRef}.instrumentIdentityV1_invalid`);
    }
    if (!validCapturedIdentityHash(sourceIdentityHash, sourceIdentity)) {
      integrity.push(`evidence.${evidenceRef}.sourceIdentityHash_missing_or_invalid`);
    }
    if (validCapturedIdentityHash(positionIdentityHash, positionIdentity) &&
        validCapturedIdentityHash(sourceIdentityHash, sourceIdentity) &&
        positionIdentityHash.toLowerCase() !== sourceIdentityHash.toLowerCase()) {
      integrity.push(`evidence.${evidenceRef}.sourceIdentityHash_position_mismatch`);
    }
    const positionCanonical = str(positionIdentity?.canonicalInstrumentId ?? positionIdentity?.canonical_id);
    const sourceCanonical = str(sourceIdentity?.canonicalInstrumentId ?? sourceIdentity?.canonical_id);
    if (!positionCanonical || !sourceCanonical || positionCanonical !== sourceCanonical) {
      integrity.push(`evidence.${evidenceRef}.canonicalIdentity_position_mismatch`);
    }
  }
  if (integrity.length) {
    reasons.push({
      code: "EVIDENCE_INTEGRITY_INVALID",
      reason: `Evidence or identity integrity failed (${integrity.join(", ")}).`,
    });
  }

  const decisionAsOfMs = timestampMillis(stored);
  // Every current-action check is evaluated now. The stored decision time and
  // the response's cached `asOf` are audit facts, not a moving "current" clock.
  // Historical tools remain non-actionable independently through
  // HISTORICAL_RECORD_ONLY, but their current-action projection uses this same
  // retrieval-time clock so an old response timestamp cannot preserve validity.
  const evaluationMs = Date.now();
  const thresholds = isObj(stored.thresholds) ? stored.thresholds : null;
  const staleAfterMinutes = num(thresholds?.staleAfterMinutes);
  const staleThresholdValid = staleAfterMinutes !== null &&
    staleAfterMinutes >= PORTFOLIO_MIN_STALE_AFTER_MINUTES &&
    staleAfterMinutes <= PORTFOLIO_MAX_STALE_AFTER_MINUTES;
  const evidenceAges: number[] = [];
  const expiryCandidates: Array<{ at: number; basis: string }> = [];
  let evidenceAgeUnknown = false;
  const explicitValidity = isObj(stored.validity) ? stored.validity : null;
  const explicitExpiryRaw = stored.expiresAt ?? stored.expires_at ??
    explicitValidity?.expiresAt ?? explicitValidity?.expires_at;
  if (!staleThresholdValid) {
    reasons.push({
      code: "VALIDITY_UNKNOWN",
      reason: `The portfolio assessment does not carry a valid staleAfterMinutes threshold between ${PORTFOLIO_MIN_STALE_AFTER_MINUTES} and ${PORTFOLIO_MAX_STALE_AFTER_MINUTES} minutes. Every current monitoring escalation requires this bound.`,
    });
  }
  if (explicitExpiryRaw !== null && explicitExpiryRaw !== undefined) {
    const explicitExpiryMs = new Date(String(explicitExpiryRaw)).getTime();
    if (!Number.isFinite(explicitExpiryMs) || decisionAsOfMs === null ||
        explicitExpiryMs <= decisionAsOfMs) {
      reasons.push({
        code: "VALIDITY_UNKNOWN",
        reason: "The portfolio decision carries a malformed or internally invalid explicit expiry.",
      });
    } else if (staleThresholdValid) {
      const authorizedExpiryMs = decisionAsOfMs + Math.min(
        staleAfterMinutes * 60_000,
        PORTFOLIO_MAX_DECISION_TTL_MS,
      );
      if (explicitExpiryMs > authorizedExpiryMs) {
        reasons.push({
          code: "VALIDITY_UNKNOWN",
          reason: "The portfolio decision's explicit expiry exceeds its declared staleness threshold or the hard 24-hour decision TTL.",
        });
      } else {
        expiryCandidates.push({ at: explicitExpiryMs, basis: "producer_expiry" });
      }
    }
  }
  if (decisionAsOfMs === null || decisionAsOfMs > evaluationMs) {
    reasons.push({
      code: "VALIDITY_UNKNOWN",
      reason: "The portfolio decision has no valid non-future decision timestamp from which current expiry can be established.",
    });
  } else if (staleThresholdValid) {
    expiryCandidates.push({
      at: decisionAsOfMs + Math.min(
        staleAfterMinutes * 60_000,
        PORTFOLIO_MAX_DECISION_TTL_MS,
      ),
      basis: "decision_as_of_plus_staleness_threshold",
    });
  }
  for (const position of positions) {
    const basis = str(position.actionBasis)?.toLowerCase();
    // Pure concentration control is calculated from the supplied/connected
    // book and does not pretend to be a fresh market-direction claim.
    if (basis === "risk_control" && str(position.direction) === null) continue;
    const evidenceAt = timestampMillis({ dataAsOf: position.evidenceAsOf });
    if (evaluationMs === null || evidenceAt === null || evaluationMs < evidenceAt) {
      evidenceAgeUnknown = true;
      continue;
    }
    const age = Math.round((evaluationMs - evidenceAt) / 1000);
    evidenceAges.push(age);
    if (staleThresholdValid) {
      expiryCandidates.push({
        at: evidenceAt + staleAfterMinutes * 60_000,
        basis: `oldest_contributing_evidence:${str(position.symbol) ?? "unknown"}`,
      });
    }
    if (!staleThresholdValid || age > staleAfterMinutes * 60) {
      reasons.push({
        code: !staleThresholdValid ? "VALIDITY_UNKNOWN" : "SOURCE_STALE",
        reason: !staleThresholdValid
          ? "The portfolio evidence has timestamps but no valid declared staleness threshold."
          : `${str(position.symbol) ?? "A contributing position"} uses evidence older than the watch's staleness threshold.`,
      });
    }
  }
  const effectiveExpiry = expiryCandidates.length
    ? expiryCandidates.reduce((earliest, candidate) => candidate.at < earliest.at ? candidate : earliest)
    : null;
  if (!effectiveExpiry) {
    reasons.push({
      code: "VALIDITY_UNKNOWN",
      reason: "The portfolio decision publishes no usable expiry and no conservative expiry can be derived.",
    });
  } else if (effectiveExpiry.at <= evaluationMs) {
    reasons.push({
      code: "DECISION_EXPIRED",
      reason: "The portfolio decision is past its explicit or conservatively derived current-authority expiry.",
    });
  }
  if (evidenceAgeUnknown && positions.some((position) => str(position.actionBasis)?.toLowerCase() !== "risk_control")) {
    reasons.push({ code: "VALIDITY_UNKNOWN", reason: "At least one contributing market-evidence timestamp could not be established." });
  }

  const action = str(stored.action)?.toUpperCase() ?? null;
  const mandate = isObj(stored.mandate) ? stored.mandate : null;
  const mandateAssessment = isObj(stored.mandateAssessment) ? stored.mandateAssessment : null;
  const applied = Array.isArray(mandateAssessment?.applied)
    ? mandateAssessment.applied.filter(isObj).map((entry) => str(entry.constraint)).filter(Boolean)
    : [];
  const permissionValid = action === "EXIT"
    ? mandate?.canExit === true && mandate?.exitOnCritical === true
    : action === "REDUCE"
      ? mandate?.canReduce === true
      : action === "HOLD" || action === "WATCH";
  if (str(stored.state)?.toUpperCase() !== "ACTIVE" || !mandate || !applied.includes("horizon") || !permissionValid) {
    reasons.push({
      code: "MONITORING_POLICY_INVALID",
      reason: "The stored monitoring escalation is inconsistent with the active, explicitly applied monitoring policy.",
    });
  }

  const uniqueReasons = reasons.filter((entry, index, all) =>
    all.findIndex((candidate) => candidate.code === entry.code && candidate.reason === entry.reason) === index,
  );
  return {
    kind: historicalReplay ? "historical_replay" : "portfolio_monitoring",
    applies: true,
    status: uniqueReasons.length ? "WITHHELD" : "ELIGIBLE",
    bindingAuthority: null,
    selectedSymbol,
    reasons: uniqueReasons,
    validity: evidenceAgeUnknown || !effectiveExpiry || uniqueReasons.some((entry) => entry.code === "VALIDITY_UNKNOWN")
      ? {
          known: false,
          reason: evidenceAgeUnknown
            ? "One or more contributing evidence timestamps are unknown."
            : "The decision's current authority expiry could not be established.",
          ...(effectiveExpiry ? {
            evaluatedAt: new Date(evaluationMs).toISOString(),
            expiresAt: new Date(effectiveExpiry.at).toISOString(),
            expiryBasis: effectiveExpiry.basis,
          } : {}),
        }
      : {
          known: true,
          oldestEvidenceAgeSeconds: evidenceAges.length ? Math.max(...evidenceAges) : 0,
          basis: "contributing_portfolio_evidence",
          evaluatedAt: new Date(evaluationMs).toISOString(),
          expiresAt: new Date(effectiveExpiry.at).toISOString(),
          expiryBasis: effectiveExpiry.basis,
          expired: effectiveExpiry.at <= evaluationMs,
        },
    sourceState,
    identity: {
      resolutionState: unresolvedSymbols.length ? "invalid" : "resolved",
      contributingSymbols: positions.map((position) => str(position.symbol)).filter(Boolean),
      unresolvedSymbols: [...new Set(unresolvedSymbols)],
    },
    producerEligibility: {
      eligible: null,
      status: "not_applicable",
      reason: "Portfolio monitoring validity depends on captured identity, freshness, integrity, and the supplied monitoring policy. It never grants execution authority.",
    },
  };
}

function eligibilityForTool(
  tool: string,
  response: Record<string, unknown>,
  classification: AgentClassification,
  decision: Record<string, unknown> | null,
  instruments: Array<Record<string, unknown>>,
  selectedClaim: ReturnType<typeof selectedClaimValidity>,
): DecisionEligibility {
  if (PORTFOLIO_MONITORING_TOOLS.has(tool)) {
    return portfolioMonitoringEligibility(tool, response, classification, instruments, false);
  }
  if (HISTORICAL_REPLAY_TOOLS.has(tool)) {
    if (tool === "fahali_get_verdict_history") {
      if (rowsOf(response, tool).length > 0) {
        return historicalCollectionEligibility(response, classification);
      }
      // Preserve the adapter's explicit no-history state. An empty chronology
      // is not itself a historical decision replay and must not crowd out the
      // more useful "no recorded judgment" explanation in the briefing.
      return decisionEligibilityFor(tool, response, classification, decision, instruments, selectedClaim);
    }
    return portfolioMonitoringEligibility(tool, response, classification, instruments, true);
  }
  return applyBindingDecisionRollback(
    decisionEligibilityFor(tool, response, classification, decision, instruments, selectedClaim),
  );
}

function portfolioExecutionProhibition(
  monitoring: DecisionEligibility,
): DecisionEligibility {
  return {
    kind: "portfolio_execution",
    applies: true,
    status: "WITHHELD",
    bindingAuthority: null,
    selectedSymbol: monitoring.selectedSymbol,
    reasons: [{
      code: "MONITOR_ONLY_NO_EXECUTION_AUTHORITY",
      reason:
        "Fahali is capital-read-only. The portfolio mandate configures monitoring thresholds only; it grants no personalized-recommendation, portfolio-action, order, or execution authority.",
    }],
    validity: monitoring.validity,
    sourceState: monitoring.sourceState,
    identity: monitoring.identity,
    producerEligibility: {
      eligible: false,
      status: "prohibited_by_operating_mode",
      reason: "Execution cannot become eligible while operatingMode is MONITOR_ONLY and capitalPath is NONE.",
    },
  };
}

const CURRENT_INSTRUCTION_KEYS = new Set([
  "whattodo",
  "actionplan",
  "actionoptions",
  "cta",
  "calltoaction",
  "executioninstructions",
  "recommendedsteps",
]);

function scrubCurrentDecisionInstructions(
  decision: Record<string, unknown>,
  preservedSourcePath: string,
): Record<string, unknown> {
  const removed: string[] = [];
  const scrub = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((entry, index) => scrub(entry, `${path}[${index}]`));
    if (!isObj(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (CURRENT_INSTRUCTION_KEYS.has(normalized)) {
        if (child !== null && child !== undefined) removed.push(`${path}.${key}`);
        out[key] = null;
      } else {
        out[key] = scrub(child, `${path}.${key}`);
      }
    }
    return out;
  };
  const scrubbed = scrub(decision, "decision") as Record<string, unknown>;
  return {
    ...scrubbed,
    instructionAudit: {
      currentInstructionsAvailable: false,
      removedFields: [...new Set(removed)],
      preservedOnlyAt: preservedSourcePath,
      note: "Instruction text is retained only in the raw immutable/audit source, never in the normalized current decision.",
    },
  };
}

/**
 * ONE builder for the withhold sentence, used by both `withholdDecision` and
 * `classificationAfterEligibility`. They used to compose it independently with
 * identical inline `.map().join(" ")` expressions — the same duplication that let
 * the VLT freshness bug live in three files at once.
 *
 * It also names the shared root cause once, up front. A single missing input is
 * validated for identity, authority and expiry separately, so ONE absence renders
 * as six `REQUIRED_SOURCE_*` codes. Measured on NVDA 2026-09-03: eight sentences,
 * all of them about `forecast_72h/NVDA:forecast:missing` not being returned. That
 * is not wrong, but it reads as six defects, and it is now the only thing
 * explaining why a published reading carries no direction.
 */
function withholdReasonText(eligibility: DecisionEligibility): string {
  const sentences = eligibility.reasons.map((entry) => `${entry.code}: ${entry.reason}`);
  const tokens = eligibility.reasons
    .map((entry) => /([A-Za-z0-9_]+\/[A-Za-z0-9_.:-]+)/.exec(String(entry.reason ?? ""))?.[1] ?? null)
    .filter((t): t is string => Boolean(t));
  const shared =
    tokens.length === eligibility.reasons.length && new Set(tokens).size === 1 ? tokens[0] : null;
  const prefix = shared
    ? `One missing input explains every code that follows: ${shared}. `
    : "";
  return prefix + sentences.join(" ");
}

/**
 * Non-directional sentinels the arbiter uses when it has a reading but no call.
 * Anything NOT in this set is a real directional claim.
 */
const NON_DIRECTIONAL_STATES = new Set([
  "INSUFFICIENT_EVIDENCE", "NEUTRAL", "NONE", "UNKNOWN", "NO_CALL", "FLAT", "MIXED", "WITHHELD",
]);

/**
 * The arbiter's current READING, but only when publishing it cannot resurrect a
 * directional call the envelope just de-promoted.
 *
 * 🔴 THE RULE IS THE SOURCE'S DIRECTION, NOT THE HEADLINE TEXT. The first version
 * of this promotion returned `str(decision.headline)` for every `market_direction`
 * withhold. The whole existing eligibility suite still passed (60/60) because no
 * test asserted on `decision.headline` — but on the expired-claim fixture it would
 * have republished "Immediate downside call" on a claim withheld precisely BECAUSE
 * it had expired. A stale directional call, restored by the code meant to make
 * withholding legible.
 *
 * So: a headline is promotable only when the source carries no directional claim
 * of its own. NVDA on 2026-09-03 is the case this exists for — direction
 * INSUFFICIENT_EVIDENCE, headline "Watch — upside skew", a genuine reading with no
 * call in it. An expired DOWNSIDE_SKEW is not, and never becomes one.
 */
function promotableReading(
  decision: Record<string, unknown>,
  eligibility: DecisionEligibility,
): string | null {
  if (eligibility.kind !== "market_direction") return null;
  const headline = str(decision.headline);
  if (!headline) return null;
  /**
   * 🔴 THIS TEST WAS INVERTED (2026-09-08).
   *
   * It read:
   *   if (direction && !NON_DIRECTIONAL_STATES.has(direction.toUpperCase()))
   *     return null;
   *
   * — so a headline was promoted ONLY when the arbiter had reached no
   * directional conclusion, and suppressed to "Binding decision withheld"
   * exactly when it HAD one. The stronger the read, the more completely it was
   * hidden. That is backwards on its own terms: the 09-03 comment in
   * `withholdDecision` justifies promotion as "here is what is happening, with
   * no directional edge", and a real lean is MORE of what is happening, not
   * less.
   *
   * The reason to withhold is the missing PERFORMANCE RECORD behind the call,
   * which is what the eligibility codes carry and what `binding: false`,
   * `directionIsBinding: false` and `abstainReason` state in the payload. It
   * was never that the arbiter had formed a view — that is the product.
   *
   * The one suppression that survives is the next block: a claim withheld
   * because ITS OWN horizon lapsed is not a current reading at all.
   */
  // A reading withheld because ITS OWN CLAIM expired is not a current reading, and
  // republishing it would restate a lapsed observation as today's.
  //
  // 🔴 MATCH THE EXACT CODE, NOT A SUBSTRING. The first version tested
  // `.includes("EXPIRED")`, which also matches REQUIRED_SOURCE_EXPIRED — "a
  // required INPUT is missing or lapsed", which is the very case this promotion
  // exists for. Caught only by verifying against production: NVDA carried
  // CANONICAL_PERFORMANCE_INELIGIBLE, REQUIRED_SOURCE_{EXPIRED, IDENTITY_INVALID,
  // IDENTITY_MISMATCH, STATE_INVALID} and NO claim expiry at all, so the promotion
  // was blocked by a guard aimed at a different fact. The unit tests passed
  // because their expiry fixture emits CLAIM_EXPIRED and their missing-source
  // fixture emitted no EXPIRED code — neither reproduced the live code set.
  if (eligibility.reasons.some((entry) => String(entry.code ?? "").trim().toUpperCase() === "CLAIM_EXPIRED")) {
    return null;
  }
  return headline;
}

function withholdDecision(
  decision: Record<string, unknown> | null,
  eligibility: DecisionEligibility,
): Record<string, unknown> | null {
  if (!decision) return decision;
  if (eligibility.kind === "historical_replay") {
    const historicalAction = str(
      decision.legacyMonitoringValue ?? decision.action ?? decision.portfolioAction ?? decision.recommendedAction,
    );
    return scrubCurrentDecisionInstructions({
      ...decision,
      action: null,
      portfolioAction: null,
      recommendedAction: null,
      historicalAction,
      actionability: "ABSTAIN",
      binding: false,
      currentlyActionable: false,
      asRecordedAuthority: "legacy_portfolio_monitoring_policy",
      currentAuthorityStatus: eligibility.status,
      decisionState: "immutable_historical_replay",
      abstainReason: eligibility.status === "WITHHELD"
        ? eligibility.reasons.map((entry) => `${entry.code}: ${entry.reason}`).join(" ")
        : "Historical replay is audit evidence. Obtain a new portfolio decision before taking present action.",
    }, "verdict.decision (immutable historical source)");
  }
  if (eligibility.status !== "WITHHELD") {
    if (eligibility.status === "ELIGIBLE" && eligibility.kind === "market_direction") {
      // Binding metadata is the result of the completed eligibility gate, not
      // a response-level assertion that can overwrite the selected row.
      return {
        ...decision,
        binding: true,
        directionAuthority: "canonical_verdict",
        directionAuthorityStatus: "AVAILABLE",
        decisionState: "canonical_direction_eligible",
      };
    }
    if (eligibility.status === "ELIGIBLE" && eligibility.kind === "portfolio_monitoring") {
      return {
        ...decision,
        actionability: "ABSTAIN",
        binding: false,
        // Stated, not left undefined. This branch is ELIGIBLE-for-monitoring,
        // which is not authority to bind a direction — and a consumer reading
        // `directionIsBinding === undefined` cannot tell "not binding" from
        // "this payload does not model binding". Every non-binding path now
        // says so in the same field.
        directionIsBinding: false,
        executionAuthority: "NONE",
        executionAuthorityStatus: "PROHIBITED",
        personalizedRecommendation: false,
        executionAllowed: false,
        humanFinancialDecisionRequired: true,
        decisionState: "portfolio_monitoring_eligible",
      };
    }
    return decision;
  }
  const reason = withholdReasonText(eligibility);
  /**
   * 🔴 A WITHHELD CALL IS NOT THE ABSENCE OF A DIRECTION EITHER (2026-09-08).
   *
   * The 09-03 fix below promoted the arbiter's headline and stopped ONE FIELD
   * SHORT — its own comment says `direction` is "unchanged", meaning still
   * nulled. Measured on BTCUSDT 2026-09-08 the agent-facing payload read:
   *
   *   headline:  "Watch — the forecast skews downside, the analysts lean
   *               bullish. They disagree."
   *   direction: null
   *
   * The sentence states the read. The field a consumer parses says there is
   * none. That is the same two-surfaces-one-arbiter defect the 09-03 comment
   * describes, moved down one line.
   *
   * `server/lib/verdictAbstain.ts` states the governing rule in its own header:
   * the actionability gate "may only withhold actionability and the signed
   * expected move" and "does NOT choose, replace, or erase direction... a
   * below-floor directional lean is still useful early-warning evidence even
   * when it is not actionable." Nulling here violated that contract.
   *
   * So the direction now SURVIVES the withhold, carrying markers that say what
   * it is not. Everything that converts a lean into an action stays withheld:
   * `binding: false`, `actionability: "ABSTAIN"`, and `expectedMovePct: null`
   * — the signed move is the one number an agent acts on, which is why the
   * 08-05 fix stripped it and why it is still stripped.
   */
  const nonBindingDirection = str(decision.direction) ?? null;
  /**
   * Two different absences, never collapsed into one word. "The arbiter leans
   * bearish and cannot bind it" and "the arbiter looked and reached no
   * conclusion" are opposite facts for a consuming agent, and both used to
   * arrive as `direction: null`.
   */
  const directionRole = !nonBindingDirection
    ? null
    : NON_DIRECTIONAL_STATES.has(nonBindingDirection.toUpperCase())
      ? "no_conclusion_reached"
      : "non_binding_reading";
  return scrubCurrentDecisionInstructions({
    ...decision,
    state: "WITHHOLD",
    // 🔴 A WITHHELD BINDING CALL IS NOT THE ABSENCE OF A READING (fixed 2026-09-03).
    //
    // This unconditionally replaced the canonical arbiter's own headline with a
    // generic string. Measured on NVDA that day, the same payload carried
    // `canonical.headline: "Watch — upside skew"` — the exact sentence the human
    // app renders — while the agent-facing `decision.headline` said "Binding
    // decision withheld". Two surfaces, one instrument, one arbiter, opposite
    // impressions: a human read "here is what is happening, with no directional
    // edge", an agent read "Fahali has nothing on NVDA".
    //
    // The reading is promoted; the CALL stays withheld. `state`, `direction`,
    // `binding`, `actionability` and `abstainReason` below are all unchanged, and
    // `headlineIsBinding` says in the payload what the reading is not. Scoped to
    // `market_direction` on purpose: a `portfolio_monitoring` headline is an
    // assertion the eligibility gate just refused, and `historical_replay` returns
    // earlier precisely so its forward-looking text stays scrubbed.
    headline: eligibility.kind === "portfolio_monitoring"
      ? "Monitoring assessment withheld"
      : promotableReading(decision, eligibility) ?? "Binding decision withheld",
    headlineIsBinding: false,
    headlineMeaning: promotableReading(decision, eligibility)
      ? "Current reading from the canonical arbiter. It is NOT a directional call — " +
        "see directionIsBinding (false), binding (false) and abstainReason for why no call is made."
      : null,
    direction: nonBindingDirection,
    directionRole,
    directionIsBinding: false,
    actionability: "ABSTAIN",
    abstainReason: reason,
    expectedMovePct: null,
    action: null,
    recommendedAction: null,
    portfolioAction: null,
    binding: false,
    directionAuthority: eligibility.kind === "market_direction" ? "canonical_verdict" : null,
    directionAuthorityStatus: eligibility.kind === "market_direction" ? "WITHHELD" : null,
    ...(eligibility.kind === "portfolio_monitoring"
      ? {
          executionAuthority: "NONE",
          executionAuthorityStatus: "PROHIBITED",
          personalizedRecommendation: false,
          executionAllowed: false,
          humanFinancialDecisionRequired: true,
        }
      : {}),
    decisionState: "decision_ineligible",
  }, eligibility.kind === "portfolio_monitoring"
    ? "verdict.decision (raw audit source)"
    : "sourceDecision and selected source row (raw audit source)");
}

function classificationAfterEligibility(
  classification: AgentClassification,
  eligibility: DecisionEligibility,
): AgentClassification {
  if (eligibility.status !== "WITHHELD" || eligibility.kind === "historical_replay" ||
      classification.responseState === RESPONSE_STATES.error ||
      classification.responseState === RESPONSE_STATES.partial) return classification;
  const reason = withholdReasonText(eligibility);
  return {
    ...classification,
    responseState: RESPONSE_STATES.withheld,
    absence: { kind: "withheld", reason },
  };
}

function decisionSelectionAfterEligibility(
  selection: DecisionSelection | null,
  eligibility: DecisionEligibility,
): (DecisionSelection & { sourceActionableAvailable?: number }) | null {
  if (!selection || eligibility.status !== "WITHHELD" || eligibility.kind === "historical_replay") return selection;
  return {
    ...selection,
    sourceActionableAvailable: selection.actionableAvailable,
    actionableAvailable: 0,
    note: `${selection.note} The source row is retained for audit, but no normalized current assessment is available because decisionEligibility is WITHHELD.`,
  };
}

export function decorateForAgent(
  tool: string,
  result: CallToolResult,
  options: AgentDecorationOptions = {},
): CallToolResult {
  try {
    const requestedDetail = options.detail ?? DEFAULT_RESPONSE_DETAIL;
    const includeWithheld = options.includeWithheld ?? requestedDetail === "audit";
    if (result.isError) {
      const error = parseError(result);
      const errorCode = str(error.code) ?? "TOOL_ERROR";
      const envelope: Record<string, unknown> = {
        schemaVersion: "2.0",
        status: "error",
        mcpStatus: "error",
        requestId: randomUUID(),
        asOf: new Date().toISOString(),
        responseState: RESPONSE_STATES.error,
        dataState: DATA_STATES.error,
        error,
        absence: {
          kind: errorCode.startsWith("AUTH_") ? "auth_failure" : errorCode === "ENTITLEMENT_REQUIRED" ? "entitlement_required" : "source_error",
          reason: str(error.message) ?? "The tool call failed.",
        },
        ...(options.auth ? { auth: options.auth } : {}),
        claimPolicy: CLAIM_POLICY,
        nextActions: [],
        responseControl: {
          detail: requestedDetail,
          returnedLimit: Number.isFinite(options.limit)
            ? Math.max(1, Math.min(100, Math.trunc(Number(options.limit))))
            : requestedDetail === "audit" ? null : requestedDetail === "standard" ? 12 : 3,
          complete: true,
          truncated: false,
          omitted: {},
          includeWithheld,
        },
      };
      return {
        ...result,
        content: [{ type: "text" as const, text: errorMarkdown(tool, envelope) }],
        structuredContent: envelope,
      };
    }

    const raw = result.structuredContent;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    const rawData = ENGINE_BOARD_TOOLS.has(ADAPTER_ALIASES[tool] ?? tool)
      // `findings` is derived, not authored upstream: exactly the live entries
      // (state standing/in_progress with a finite p), so the row-based decision
      // machinery never counts a quiet or probability-less row as a judgment.
      ? { ...(raw as Record<string, unknown>), findings: engineBoardFindings(raw as Record<string, unknown>) }
      : (raw as Record<string, unknown>);
    const filtered = filteredPayload(rawData, options);
    const conserved = enforceSymbolConservation(tool, filtered.data, options);
    const sourceClassification = classifyAgentPayload(tool, conserved.data);
    const { data, omitted, reordered, returnedLimit } = projectedPayload(conserved.data, options);
    // Delivery is only knowable after projection. Truth state above is computed
    // pre-projection on purpose; coverage is not, and conflating the two let
    // symbolCoverage claim 24 symbols while the body carried 3.
    const coverage = reconcileCoverageWithProjection(tool, conserved.coverage, data);
    const viewStates = bundleViewStates(conserved.data);
    // Envelope freshness describes what actually shipped. The binding claim's
    // validity is computed separately from its selected row below; an omitted
    // sibling can be relevant to source completeness without being allowed to
    // expire the selected claim.
    const freshnessBlock = normalizedFreshness(data);
    const asOf = asOfFor(conserved.data);
    const inferredDecision = decisionFor(tool, data);
    const portfolioDecision = portfolioDecisionProjection(data);
    const selectedDecision = portfolioDecision ?? inferredDecision;
    const sourceDecision = mergeDecision(
      data.decision,
      selectedDecision,
      !MARKET_DIRECTION_TOOLS.has(tool) && !portfolioDecision,
    );
    const rawDecisionSelection = pickLeadRow(tool, data).selection;
    const inferredInstruments = instrumentIdentitiesFor(tool, data);
    const storedPortfolio = storedPortfolioDecision(data);
    const portfolioInstruments = storedPortfolio && Array.isArray(storedPortfolio.positions)
      ? instrumentIdentitiesFor("fahali_get_market_verdict", { data: storedPortfolio.positions })
      : [];
    const portfolioEvidenceInstruments = instrumentIdentitiesFor(
      "fahali_get_market_verdict",
      { data: portfolioEvidenceSources(data) },
    );
    const instruments = mergeInstruments(
      data.instruments,
      // Frozen evidence identities are provider-bound; position-symbol parses
      // are only a fallback and must never crowd a resolved snapshot identity
      // out of the merge.
      [...inferredInstruments, ...portfolioEvidenceInstruments, ...portfolioInstruments],
    );
    const sourceHasSiblingClaims = rowsOf(conserved.data, tool).length > 1;
    const selectedClaim = selectedClaimValidity(tool, data, sourceDecision, sourceHasSiblingClaims);
    const eligibility = eligibilityForTool(
      tool,
      data,
      sourceClassification,
      sourceDecision,
      instruments,
      selectedClaim,
    );
    const executionEligibility = eligibility.kind === "portfolio_monitoring"
      ? portfolioExecutionProhibition(eligibility)
      : null;
    const classification = classificationAfterEligibility(sourceClassification, eligibility);
    const { dataState, responseState, absence } = classification;
    const decision = withholdDecision(sourceDecision, eligibility);
    const decisionSelection = decisionSelectionAfterEligibility(rawDecisionSelection, eligibility);
    const detail = requestedDetail;

    // Non-text blocks are CARRIED THROUGH. Today this preserves nothing:
    // `okResult()` is the single success builder for all 31 tools and it emits
    // a generic table plus the JSON, both text. The filter exists because the
    // alternative is that the first handler to return a chart image, a resource
    // link or audio has it silently deleted right here — a silent delete on a
    // tool that was working, which is the exact failure class this file exists
    // to stop. Asserted by agentPayload.test.ts so it cannot rot back.
    const carried = (result.content ?? []).filter((c) => c.type !== "text");

    const upstreamScope = isObj(conserved.data.scope) ? conserved.data.scope : null;
    const inferredEvidence = evidenceQualityFor(conserved.data, dataState);
    /**
     * DESCRIBE WHAT IS PUBLISHED, NOT THE PRE-TRANSFORM SOURCE.
     *
     * This walked `conserved.data`, whose `decision` is the UPSTREAM object.
     * The envelope below publishes a different one: `withholdDecision(...)` over
     * `mergeDecision(...)`, and `mergeDecision` rebuilds the decision from an
     * ALLOW-LIST (`NON_BINDING_DECISION_OBSERVATION_KEYS`, seven prose keys)
     * merged with the selected row. `committee` is not on that list, so it is
     * dropped -- correctly, since a response-level decision must never overwrite
     * the selected row.
     *
     * The result was an envelope describing a path its own payload did not
     * carry. Live on `fahali_get_bundle`, 2026-09-03:
     *   `decision.committee.verdict.confidence: observedRange claims 1 row(s)
     *    but the path resolves to no numeric value in this response`
     *
     * This is the THIRD instance of one shape in a single day: a label computed
     * over an object that a later transform rebuilds. The others were
     * `getFlashCrash` (rebuilt from seven named keys, so a resolver fix deployed
     * and did nothing) and the roster-drift breakdown (a sub-total that did not
     * inherit its parent's population). The generator is always the same -- the
     * describing code and the transforming code read different objects.
     *
     * `sourceDecision` is included because the envelope publishes it verbatim
     * further down. Omitting it would trade a FALSE path for an UNDECLARED
     * number: the committee confidence really is in the response, and a value
     * with no declared scale or calibration is the defect "every label needs a
     * source" was filed for.
     */
    const publishedDecisionView = {
      ...conserved.data,
      decision,
      sourceDecision: isObj(conserved.data.decision) ? conserved.data.decision : null,
    };
    const inferredConfidence = confidenceSemanticsFor(publishedDecisionView);
    const scope = {
      ...(upstreamScope ?? {}),
      // `scope` is the SOURCE-side truth and stays pre-projection: truncating a
      // response must never look like the request covered less. Delivery lives
      // in symbolCoverage, and the two reconcile by construction —
      //   scope.returnedSymbols == symbolCoverage.returned + .projectedOut
      // which agentPayload.test.ts asserts, so they cannot drift into the
      // disagreement this pass was opened to fix.
      ...(!upstreamScope || upstreamScope.symbols === undefined
        ? { symbols: conserved.coverage.requested.length ? conserved.coverage.requested : conserved.coverage.returned }
        : {}),
      requestedSymbols: conserved.coverage.requested,
      returnedSymbols: conserved.coverage.returned,
      withheldSymbols: conserved.coverage.withheld,
      notReturnedSymbols: conserved.coverage.notReturned,
      ...(!upstreamScope || upstreamScope.horizon === undefined
        ? { horizon: str((decision ?? {}).horizon) ?? str(conserved.data.horizon) }
        : {}),
    };
    const complete = Object.keys(omitted).length === 0;
    const envelope: Record<string, unknown> = {
      ...data,
      schemaVersion: "2.0",
      // Keep the endpoint's own status vocabulary at `status`; `mcpStatus` is
      // the normalized transport/result axis shared by every tool.
      status: str(conserved.data.status) ?? (responseState === RESPONSE_STATES.error ? "error" : "ok"),
      mcpStatus: responseState === RESPONSE_STATES.error ? "error" : "ok",
      sourceStatus: sourceStatusFor(conserved.data),
      sourceDataState: str(conserved.data.dataState ?? conserved.data.data_state),
      sourceError: str(conserved.data.error ?? conserved.data.errorCode ?? conserved.data.error_code),
      sourceScope: upstreamScope,
      sourceDecision: isObj(conserved.data.decision) ? conserved.data.decision : null,
      sourceEvidenceQuality: isObj(conserved.data.evidenceQuality) ? conserved.data.evidenceQuality : null,
      sourceConfidenceSemantics: conserved.data.confidenceSemantics ?? null,
      requestId: str(data.requestId) ?? randomUUID(),
      asOf,
      responseState,
      dataState,
      absence,
      // Named, not swallowed: this response carried measurement the adapter did
      // not declare. The data is served; the mapping gap is ours to close.
      ...(sourceClassification.adapterGap?.length
        ? {
            adapterGap: {
              unrecognisedKeys: sourceClassification.adapterGap,
              effect: "none — the reading is served in full",
              note:
                "This tool's response adapter does not declare these keys, so they were not " +
                "counted as findings. The payload is measured and usable; treat this as a Fahali " +
                "mapping defect to report, never as a limit on the data.",
            },
          }
        : {}),
      symbolCoverage: coverage,
      // One bundle mixed dataAgeSeconds/staleAfterSeconds (regime) with
      // dataAgeHours/staleAfterHours (lead time) in a single envelope, so a
      // consumer comparing freshness across views was comparing different units
      // (re-audit M2). The source's own block is left untouched; this is the
      // canonical one and it is always in seconds.
      freshnessNormalized: freshnessBlock,
      // Whether the CLAIM has run out, which freshness does not answer. Measured
      // 2026-08-30: a 12h decision on a 67h-old reading reported stale:false,
      // because 67h sits inside the 72h staleness WINDOW. Kept separate from
      // `stale` on purpose — "the data is old" and "the claim has expired" have
      // different remedies, and merging them would erase the one an agent needs.
      claimValidity: selectedClaim.validity,
      decisionEligibility: eligibility,
      ...(eligibility.kind === "market_direction" ? { directionEligibility: eligibility } : {}),
      ...(eligibility.kind === "portfolio_monitoring"
        ? { monitoringEligibility: eligibility, executionEligibility }
        : {}),
      ...(eligibility.kind === "historical_replay" ? { currentActionEligibility: eligibility } : {}),
      // A composite publishes its children's states. Without this an agent that
      // reads PARTIAL has to guess which view is missing; with it, it can re-ask
      // for exactly the unresolved one.
      ...(viewStates.length ? { viewStates } : {}),
      scope,
      instruments,
      decision,
      // Say WHICH row became the headline and by what rule. get_lead_time
      // already publishes headlineSelection; a promoted decision owes the same
      // disclosure, or an agent reads one small-cap abstention as the market.
      ...(decisionSelection ? { decisionSelection } : {}),
      evidenceQuality: mergeEvidenceQuality(conserved.data.evidenceQuality, inferredEvidence),
      confidenceSemantics: mergeConfidenceSemantics(conserved.data.confidenceSemantics, inferredConfidence),
      conflicts: Array.isArray(data.conflicts) ? data.conflicts : decision?.conflict === true
        ? [{
            issue: "Evidence sources disagree",
            resolution: eligibility.status === "WITHHELD"
              ? "The conflict remains unresolved for binding use. Source observations remain audit evidence, but no direction is authorized."
              : "The canonical arbiter's eligible resolution is binding; committee and forecast inputs remain evidence.",
          }]
        : [],
      claimPolicy: CLAIM_POLICY,
      // Filled from this finalized envelope below. Building the briefing from
      // `data` here used to let stale/partial raw fields contradict normalized
      // responseState and decisionEligibility.
      nextActions: [],
      responseControl: {
        detail,
        returnedLimit,
        complete,
        truncated: !complete,
        omitted,
        filtering: filtered.accounting,
        /**
         * How the surviving rows were chosen. R3: `brief` returned the three
         * least informative rows out of twenty-four — 16 carried a call, and
         * source order kept three abstentions. Projection now ranks the same
         * way promotion does, so the rows that carry a call are the rows that
         * survive, and the promoted decision is inside the payload it heads.
         *
         * Stated rather than assumed: "source" means the caller is seeing the
         * source's own ranking, which is the right thing to know when
         * comparing two responses.
         */
        ordering: reordered.length
          ? "actionable_first"
          : "source",
        reorderedPaths: reordered,
        orderingNote: reordered.length
          ? "Rows carrying a directional call were moved ahead of abstentions BEFORE truncation, so a call is never dropped in favour of an abstention. Order within each group is the source's own. No row's content was changed."
          : "Rows are in the order the source returned them; nothing was re-ranked.",
        includeWithheld,
        completenessNote: complete
          ? filtered.accounting.filteredOutCount > 0
            ? "No endpoint-declared collection was truncated. Rows outside the caller-requested scope were filtered and are accounted for in responseControl.filtering.filteredOut."
            : "No endpoint-declared collection was truncated."
          : "This response is a projection. responseControl.omitted names every truncated collection; do not treat it as complete.",
      },
      ...(options.auth ? { auth: options.auth } : {}),
    };
    if (sourceClassification.sourceError) {
      envelope.error = {
        code: "SOURCE_ERROR",
        message: sourceClassification.sourceError,
        retryable: true,
      };
    }
    const { markdown, nextTools } = buildAgentBriefing(tool, envelope, options.toolCatalog);
    const markdownWithCompleteness = appendCompletenessMarkdown(markdown, omitted);
    envelope.nextActions = nextTools;
    if (detail === "audit") envelope.agentBriefing = markdownWithCompleteness;

    return {
      ...(responseState === RESPONSE_STATES.error ? { isError: true } : {}),
      content: [
        {
          type: "text" as const,
          text: responseState === RESPONSE_STATES.error
            ? errorMarkdown(tool, envelope)
            : detail === "brief"
              ? briefMarkdown(tool, responseState, dataState, decision, asOf, absence, omitted)
              : markdownWithCompleteness,
        },
        ...carried,
      ],
      structuredContent: envelope,
    };
  } catch (cause: any) {
    // A renderer failure must not silently switch the contract back to raw JSON.
    // It is an MCP error in its own right and is rendered through the same two
    // channels as every other failure.
    const envelope: Record<string, unknown> = {
      schemaVersion: "2.0",
      status: "error",
      mcpStatus: "error",
      requestId: randomUUID(),
      asOf: new Date().toISOString(),
      responseState: RESPONSE_STATES.error,
      dataState: DATA_STATES.error,
      error: {
        code: "RENDERER_ERROR",
        message: str(cause?.message) ?? "The agent response could not be rendered.",
        retryable: true,
      },
      absence: { kind: "source_error", reason: "The MCP renderer failed; no market conclusion was produced." },
      claimPolicy: CLAIM_POLICY,
      nextActions: [],
      responseControl: {
        detail: options.detail ?? DEFAULT_RESPONSE_DETAIL,
        returnedLimit: Number.isFinite(options.limit)
          ? Math.max(1, Math.min(100, Math.trunc(Number(options.limit))))
          : (options.detail ?? DEFAULT_RESPONSE_DETAIL) === "audit"
            ? null
            : (options.detail ?? DEFAULT_RESPONSE_DETAIL) === "standard" ? 12 : 3,
        complete: true,
        truncated: false,
        omitted: {},
        includeWithheld: options.includeWithheld ?? (options.detail ?? DEFAULT_RESPONSE_DETAIL) === "audit",
      },
      ...(options.auth ? { auth: options.auth } : {}),
    };
    return {
      isError: true,
      content: [{ type: "text" as const, text: errorMarkdown(tool, envelope) }],
      structuredContent: envelope,
    };
  }
}

/** Declared on every tool's outputSchema; enforcing clients reject undeclared fields. */
export const AGENT_ENVELOPE_SCHEMA = {
  schemaVersion: { type: "string", enum: ["2.0"] },
  status: {
    type: "string",
    description:
      "The endpoint's original status vocabulary (for example ok, partial, degraded, withheld, or no_alerts). Use mcpStatus for normalized transport success/error.",
  },
  mcpStatus: {
    type: "string",
    enum: ["ok", "error"],
    description: "Normalized MCP result status. The endpoint's original status vocabulary remains in `status` and `sourceStatus`.",
  },
  requestId: { type: "string" },
  asOf: { type: "string", format: "date-time" },
  responseState: {
    type: "string",
    enum: ["OK_WITH_FINDINGS", "OK_NO_FINDINGS", "PARTIAL", "WITHHELD", "NO_COVERAGE", "ERROR"],
  },
  dataState: {
    type: "string",
    enum: ["measured", "partial", "no_data", "not_instrumented", "stale", "error"],
  },
  sourceStatus: {
    type: ["string", "null"],
    description: "The upstream endpoint's exact status before the MCP envelope normalizes transport success/error.",
  },
  sourceDataState: {
    type: ["string", "null"],
    description: "The upstream endpoint's exact data-state value before endpoint-aware classification.",
  },
  sourceError: {
    type: ["string", "null"],
    description: "The upstream endpoint's exact error text/code before normalization, when one was present.",
  },
  absence: {
    type: ["object", "null"],
    description: "Why no actionable finding is present: measured_empty, user_empty, no_coverage, source_unverified, stale, withheld, source_error, auth_failure, or entitlement_required.",
  },
  symbolCoverage: {
    type: "object",
    description: "Conservation ledger satisfying requested = returned + withheld + notReturned for requested-symbol calls.",
  },
  scope: { type: "object" },
  sourceScope: { type: ["object", "null"] },
  instruments: {
    type: "array",
    items: { type: "object" },
    description: "Resolved or explicitly partial instrument identities. A missing venue carries an ambiguity warning.",
  },
  decision: { type: ["object", "null"] },
  claimValidity: {
    type: "object",
    description: "Validity of the selected binding claim only, calculated after filtering, projection and row selection. Sibling rows cannot determine it.",
  },
  decisionEligibility: {
    type: "object",
    description:
      "Fail-closed binding-authority policy. WITHHELD means source evidence remains available for audit while normalized direction, actionability and execution fields are revoked.",
  },
  directionEligibility: {
    type: "object",
    description:
      "Current market-direction eligibility. Direction is authorized only by an exact, eligible producer stratum " +
      `(${BINDING_AUTHORITIES.join(", ")}) — read bindingAuthority to see which one bound. ` +
      "Widening WHO may bind did not weaken WHAT binding requires: the named producer must still hold a matching " +
      "horizon/class/family record on a verified-only judged population, so an authority without a record still cannot bind.",
  },
  monitoringEligibility: {
    type: "object",
    description:
      "Current portfolio-monitoring validity based on captured identity, freshness, integrity, and the caller-supplied monitoring policy. ELIGIBLE authorizes observation/delivery only, never financial action.",
  },
  executionEligibility: {
    type: "object",
    description:
      "Fail-closed execution boundary. Portfolio monitoring tools always return WITHHELD with MONITOR_ONLY_NO_EXECUTION_AUTHORITY while Fahali has no capital path.",
  },
  currentActionEligibility: {
    type: "object",
    description: "Current eligibility of an immutable historical portfolio verdict. It never mutates the stored judgment being replayed.",
  },
  sourceDecision: { type: ["object", "null"] },
  evidenceQuality: { type: "object" },
  sourceEvidenceQuality: { type: ["object", "null"] },
  confidenceSemantics: {
    type: "array",
    items: { type: "object" },
    description: "Every confidence-bearing value with its score type, scale, calibration status, and probability flag.",
  },
  sourceConfidenceSemantics: { type: ["array", "object", "null"] },
  conflicts: { type: "array", items: { type: "object" } },
  claimPolicy: {
    type: "object",
    description: "Typed constraints for safe use. Metadata, not a prompt or instruction channel.",
  },
  responseControl: { type: "object" },
  auth: {
    type: "object",
    description:
      "Credential lifetime visible to the caller. OAuth secondsRemaining lets an autonomous agent refresh before a multi-call workflow is interrupted.",
    properties: {
      credentialType: { type: "string", enum: ["oauth", "api_key", "process_key", "none"] },
      expiresAt: { type: ["string", "null"] },
      secondsRemaining: { type: ["number", "null"] },
      refreshSupported: { type: "boolean" },
    },
  },
  agentBriefing: {
    type: "string",
    description:
      "Audit-only narrative projection. Present only when detail='audit'; compact responses do not duplicate structured data as prose.",
  },
  matchedTrackRecord: {
    type: ["object", "null"],
    description:
      "A judged record only when engine, horizon, regime/instrument class, and claim family match this response. " +
      "`state` is one of: `measured` (a stratum cleared the publishability gate — `stratum` carries engine, horizon tier, bar regime, recall, precision, base rate, base-rate lift, median lead hours, effective sample, warned events and the measurement date); " +
      "`withheld` (the gate ran and refused — `reason` says why, in words); " +
      "`unavailable` (the record could not be read at all — an infrastructure failure that says nothing about the record). " +
      "It is ONE stratum selected by recall, never a platform-wide accuracy. Null means no exact record match; read recordMatchReason.",
    properties: {
      state: { type: "string", enum: ["measured", "withheld", "unavailable"] },
      reason: { type: "string", description: "Present on `withheld` and `unavailable`: why there is no figure." },
      dataAsOf: { type: "string", description: "When the record was computed. A figure without this reads as current forever." },
      stratum: {
        type: "object",
        description: "Present only on `measured`. Precision must never be quoted without recall.",
        properties: {
          engine: { type: "string" },
          horizonTier: { type: "string" },
          barRegime: { type: "string" },
          recallPct: { type: "number", description: "Share of qualifying events this stratum warned on — the half a buyer is exposed to." },
          precisionPct: { type: "number", description: "Share of its warnings that held. Never quotable alone." },
          baseRatePct: { type: "number" },
          // 🔴 `liftPp` was HERE, described as "Read this, not the raw
          // precision" — an instruction to the model to prefer the one figure
          // §2 bans. Removed from the schema as well as the prose: the record
          // travels on two channels, and enforcing clients read this one.
          claimFamily: {
            type: "string",
            description:
              "What this precision is ABOUT: `directional` (price moved the way the stratum said) or `magnitude` " +
              "(a move exceeded the judge bar, carrying no direction). Never infer a direction from a `magnitude` row.",
          },
          claimMeans: {
            type: "string",
            description: "The record endpoint's own sentence explaining the claim family. Quote it beside any precision figure.",
          },
          leadMedianHours: { type: "number" },
          effectiveSample: { type: "number" },
          warnedEvents: { type: "number" },
          measuredOn: { type: "string" },
        },
      },
    },
    required: ["state"],
  },
  recordMatchReason: {
    type: "string",
    description: "Why matchedTrackRecord is present or null. A null record is never evidence of safety or engine failure.",
  },
  nextActions: {
    type: "array",
    description: "Registry-validated follow-up calls. Missing tools, invalid arguments, unresolved placeholders, and disabled tools are omitted.",
    items: {
      type: "object",
      properties: {
        tool: { type: "string" },
        args: { type: "object", additionalProperties: { type: "string" } },
        why: { type: "string" },
        requiredTier: { type: "string" },
      },
      required: ["tool", "why"],
    },
  },
} as const;

export const AGENT_ROUTES = ROUTES;
