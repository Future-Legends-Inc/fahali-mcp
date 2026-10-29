/** On-demand MCP reference material. Keep safety-critical semantics out of long, truncatable tool descriptions. */

export const FAHALI_RESOURCES = [
  {
    uri: "fahali://schema/response-contract",
    name: "Fahali canonical response contract",
    description: "The stable envelope, state machines, score rules, and decision-reading order used by every tool.",
    mimeType: "application/json",
  },
  {
    uri: "fahali://schema/glossary",
    name: "Fahali field glossary",
    description: "Definitions for fields an agent must never infer from their names alone.",
    mimeType: "application/json",
  },
] as const;

const RESPONSE_CONTRACT = {
  schemaVersion: "2.0",
  readOrder: [
    "responseState",
    "dataState",
    "decision",
    "decisionAuthority",
    "evidenceQuality",
    "confidenceSemantics",
    "conflicts",
    "matchedTrackRecord",
    "nextActions",
  ],
  responseState: {
    OK_WITH_FINDINGS: "The measured request returned one or more findings or aggregate measurements.",
    OK_NO_FINDINGS: "The measured query completed and no rows matched its stated scope.",
    PARTIAL: "Some requested scope returned and some did not; notReturned names the gap.",
    WITHHELD: "Fahali deliberately made no claim; the abstention or withholding reason is the result.",
    NO_COVERAGE: "Fahali has no usable measurement for the requested scope.",
    ERROR: "The call failed; do not synthesize a market read from this response.",
  },
  dataState: {
    measured: "A configured source produced a current reading.",
    no_data: "The source is expected, but produced no usable data for this request.",
    not_instrumented: "Fahali does not ingest the source required to answer this question.",
    stale: "A reading exists but is outside its freshness window.",
    error: "The measurement or transport failed.",
  },
  scoreRules: {
    probability: "Only fields whose confidenceSemantics.isProbability is true may be described as probabilities.",
    risk: "Risk scores are not probabilities. Read scoreType and scale.",
    detection: "Detection strength measures pattern intensity, not likelihood that an outcome occurs.",
    abstention: "Confidence in an abstention is not directional confidence.",
  },
  decisionAuthority: {
    bindingDirection: "canonical_verdict is the sole binding market-direction authority. Its canonical read may be withheld, but it is never replaced by an evidence producer.",
    bindingConfidence: "bindingConfidence, produced by canonical_verdict, is the only confidence that may authorize or gate the binding decision.",
    agentVerdict: "agent_verdict is a non-binding evidence producer. Its legacy confidence and synthesis remain available for audit but cannot set, replace, authorize, or gate the market direction.",
    committeeVerdict: "committee_verdict and committee membership are non-binding evidence for canonical arbitration, never a second direction authority.",
  },
  absenceRule: "Unknown is not neutral, calm, safe, or agreement.",
  recordRule: "A record is attached only when engine, horizon, regime or instrument class, and claim family match.",
  outputDetail: {
    brief: "Optional compact projection: top three rows, one text summary, and the structured decision envelope.",
    standard: "Optional projection: top twelve rows and the evidence narrative.",
    audit: "Default. Full endpoint-provided rows, withheld details, and the complete evidence narrative.",
  },
  persistentMonitoring: {
    watch: "fahali_watch_portfolio persists positions or connected-account scope, mandate, thresholds, and cadence.",
    delta: "fahali_get_watch_delta distinguishes a changed decision from changed evidence and names the fields that moved.",
    history: "Verdict history is immutable application data: each revision binds the decision, evidence, mandate, methodology, predecessor, and content hash.",
    delivery: "Subscriptions enqueue deduplicated events into a durable outbox. Failed delivery is retried and remains visible; it is never reported as sent.",
  },
};

const FIELD_GLOSSARY = {
  confidence: "Legacy agent_verdict evidence confidence on market-verdict rows. It is non-binding and never the decision confidence; read confidenceProducer, confidenceRole, and bindingConfidence.",
  confidenceProducer: "Producer of the adjacent confidence field. agent_verdict denotes legacy master-agent evidence, not the binding market-direction authority.",
  confidenceRole: "Authority role of the adjacent confidence. legacy_master_evidence_non_binding means the number is audit evidence and cannot authorize or gate a decision.",
  bindingConfidence: "Canonical arbiter confidence normalized to 0-1. This is the only market-decision confidence and is null when canonical_verdict returned no confidence or no read.",
  bindingConfidenceProducer: "canonical_verdict when bindingConfidence exists; null otherwise. No agent or committee producer may occupy this field.",
  masterAgentEvidence: "Optional preserved agent_verdict synthesis for audit and compatibility. Every field inside it is non-binding evidence; use the canonical verdict for direction and decision confidence.",
  detectionConfidence: "Uncalibrated strength of a detected pattern. Not P(outcome).",
  outcomeProbability: "Calibrated probability when calibrationStatus is calibrated.",
  ensembleAgreement: "Heuristic evidence agreement. Not a calibrated probability.",
  riskScore: "Severity or exposure index on its declared scale. Not a probability.",
  correlationWithMarket: "Legacy name. It is neither market beta nor a universal market correlation; read measuredAgainst.",
  tailDependenceLambdaL: "Estimated joint lower-tail dependence for the named pair and window; not causal direction.",
  glowIntensity: "Visual ranking derived from active detection strength; not capital flow or conviction.",
  proximity: "Graph-layout or cluster-nearness value; not physical distance or causal influence.",
  claimTier: "Whether evidence may support a forecast, context, or observation. It is not a subscription tier.",
  dataOrigin: "The source or transformation that produced a field: measured, proxy, derived, synthetic, or absent.",
  unusualMoneyMovement: "A candle-derived buy-versus-sell volume imbalance. It does not identify a participant, wallet, institution, or individual trade print.",
  netFlowUsd: "For capital flow, the persisted fixed 60-minute proxy ((estimated buy volume - estimated sell volume) × price). Null means no matching observation; zero means a measured balanced window. It is not exchange aggressor tape, fund flow, or observed participant transfer.",
  capitalFlowDetectionScore: "Uncalibrated unusualness of the order-flow pattern. A score of zero does not erase netFlowUsd and does not mean no data; it means the detector did not classify the measured imbalance as unusual.",
  stressBand: "Categorical display band derived from a stress score; read the declared thresholds and scale.",
  publishable: "Machine gate for whether a measured record may be repeated as Fahali's claim.",
  noRead: "Fahali could not verify the assertion. It is not agreement.",
  provenanceHash: "A cryptographic digest only when the value conforms to the declared hash algorithm and format.",
  watchId: "Permanent identifier for one user-scoped portfolio, mandate, threshold, and evaluation-cadence definition.",
  verdictId: "Immutable identifier for one persisted watch judgment. Fetching it never substitutes a newer verdict.",
  decisionHash: "SHA-256 over the material action, risk bands, per-position states, evidence state, and mandate. It excludes wall-clock time.",
  evidenceHash: "SHA-256 over the exact evidence event references and their as-of timestamps used by a persisted verdict.",
  contentHash: "SHA-256 binding the material decision, evidence revision, positions, mandate, and thresholds. It deduplicates identical replay rows.",
  minimumAction: "Delivery floor in the controlled order HOLD < WATCH < REDUCE < EXIT. It does not alter the underlying verdict.",
  coverageDegraded: "A transition away from fully measured evidence. It is a deliverable risk event, not a neutral market call.",
  matchedTrackRecord: "The judged stratum that scores THIS response, or null. On market/symbol decisions, canonical_verdict is the sole binding authority; agent_verdict and committee_verdict remain evidence producers even when their own judged strata exist. A null match is a gap in the exact claim record, not evidence the read is right or wrong. Never attach another producer's figure; read recordMatchReason and producerRecord, then call fahali_get_lead_time for what is scored.",
  decisionSelection: "How the top-level decision was chosen from data[]. basis 'leading_row' means ONE instrument was promoted, not a market aggregate; rankedBy names the ordering and actionableAvailable says how many rows carried a directional call. When it is 0, every row abstained and the promoted decision is an abstention \u2014 never an all-clear.",
  urgencyScore: "Composite urgency on an ACTIONABLE row. Null on an ABSTAIN row, where the stored value is that verdict's abstention confidence rescaled: ranking by it surfaces the rows Fahali is most certain it cannot judge. Triage on severity and horizon proximity instead. Note the portfolio surface computes a different quantity under the same name.",
  projectedOut: "Symbols the source held that responseControl removed from this response. They are omitted, not absent: returned + projectedOut accounts for everything the source carried.",
  requestScope: "'explicit' when the caller named symbols, 'universe' when the fleet answered unscoped. fullyReturned is read against this, so an unscoped call can no longer report complete delivery vacuously.",
  viewStates: "Per-view responseState/dataState/absence inside a bundle. A bundle's own state is derived from these; read them to re-ask for one unresolved view rather than discarding the whole payload.",
  resolutionState: "'resolved' (symbol, class and venue known), 'partial' (class known, venue not), or 'ambiguous' (asset class UNKNOWN \u2014 a bare ticker that may name an equity or a crypto asset). Never assume an ambiguous instrument is the one you had in mind.",
};

export function readFahaliResource(uri: string): string | null {
  if (uri === "fahali://schema/response-contract") return JSON.stringify(RESPONSE_CONTRACT, null, 2);
  if (uri === "fahali://schema/glossary") return JSON.stringify(FIELD_GLOSSARY, null, 2);
  return null;
}
