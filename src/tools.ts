import { AGENT_ENVELOPE_SCHEMA } from "./agentPayload.js";

const WATCH_POSITION_INPUT = {
  type: "object",
  properties: {
    symbol: { type: "string", description: "Trading symbol or canonical instrument alias." },
    market_value: { type: "number", exclusiveMinimum: 0, description: "Positive current market value in USD. Gate 4 persistent autonomous monitoring is long-only." },
    quantity: { type: "number", minimum: 0, description: "Optional non-negative long quantity. Negative quantities fail closed as short exposure." },
    side: { type: "string", enum: ["long"], description: "Only long is certified for persistent autonomous monitoring. Short and hedged watches fail closed." },
    asset_class: { type: "string" },
  },
  required: ["symbol", "market_value"],
} as const;

const WATCH_MANDATE_INPUT = {
  type: "object",
  properties: {
    objective: { type: "string", enum: ["capital_preservation", "balanced", "growth", "income", "liquidity"] },
    horizon: { type: "string", description: "Decision horizon such as 24h, 5d, or 2w." },
    max_drawdown_pct: { type: "number", minimum: 1, maximum: 100 },
    max_position_pct: { type: "number", minimum: 1, maximum: 100 },
    can_reduce: { type: "boolean" },
    can_exit: { type: "boolean" },
    can_short: { type: "boolean", const: false, default: false, description: "Must remain false. Persistent autonomous watches are long-only until signed-exposure authority is separately certified." },
    can_use_options: { type: "boolean" },
    exit_on_critical: { type: "boolean", description: "False by default. EXIT is impossible unless this and can_exit are true." },
    liquidity_minimum_usd: { type: ["number", "null"] },
  },
} as const;

const WATCH_THRESHOLDS_INPUT = {
  type: "object",
  properties: {
    watch_risk_score: { type: "number", minimum: 1, maximum: 98 },
    reduce_risk_score: { type: "number", minimum: 2, maximum: 99 },
    exit_risk_score: { type: "number", minimum: 3, maximum: 100 },
    minimum_directional_confidence: { type: "number", minimum: 0, maximum: 1, description: "Minimum composite directional evidence score. Not a probability." },
    stale_after_minutes: { type: "integer", minimum: 5, maximum: 1440 },
  },
} as const;

const IDEMPOTENCY_KEY_INPUT = {
  type: "string",
  minLength: 8,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
  description: "Required retry identity for this write. Reuse only for an identical owner, operation, and request; a changed request with the same key fails closed.",
} as const;

const MONITOR_ONLY_OUTPUT_CLASSIFICATION = {
  type: "object",
  properties: {
    outputClass: { type: "string", enum: ["OBSERVATION", "RISK_ALERT", "AUDIT_EVIDENCE", "LIFECYCLE_STATE"] },
    operatingMode: { type: "string", enum: ["MONITOR_ONLY"] },
    capitalPath: { type: "string", enum: ["NONE"] },
    executionAuthority: { type: "string", enum: ["NONE"] },
    personalizedRecommendation: { type: "boolean", enum: [false] },
    portfolioAction: { type: "boolean", enum: [false] },
    orderAction: { type: "boolean", enum: [false] },
    executionAllowed: { type: "boolean", enum: [false] },
    humanFinancialDecisionRequired: { type: "boolean", enum: [true] },
  },
  required: [
    "outputClass",
    "operatingMode",
    "capitalPath",
    "executionAuthority",
    "personalizedRecommendation",
    "portfolioAction",
    "orderAction",
    "executionAllowed",
    "humanFinancialDecisionRequired",
  ],
  additionalProperties: false,
} as const;

const IDEMPOTENCY_RECEIPT_OUTPUT = {
  type: "object",
  properties: {
    idempotencyKey: { type: "string" },
    replayed: { type: "boolean" },
    requestSemantics: { type: "string", enum: ["same_owner_operation_key_requires_same_request_hash"] },
  },
  required: ["idempotencyKey", "replayed", "requestSemantics"],
} as const;

const LEGACY_MONITOR_FIELD_SEMANTICS_OUTPUT = {
  type: "object",
  properties: {
    "decision.action": { type: "string", enum: ["monitoring_escalation_only_not_portfolio_action"] },
    "decision.positions[].action": { type: "string", enum: ["monitoring_escalation_only_not_portfolio_action"] },
    "decision.whatToDo": { type: "string", enum: ["archived_legacy_field_name_v2_contains_monitoring_process_guidance"] },
  },
  required: ["decision.action", "decision.positions[].action", "decision.whatToDo"],
  additionalProperties: false,
} as const;

const GENERIC_MONITOR_OUTPUT = {
  type: "object",
  properties: {
    status: { type: "string" },
    dataState: { type: "string" },
    watch: { type: ["object", "null"] },
    watches: { type: "array", items: { type: "object" } },
    verdict: { type: ["object", "null"] },
    verdictId: { type: "string", format: "uuid" },
    delta: { type: ["object", "null"] },
    authorityState: { type: "string", enum: ["bounded", "withheld", "expired"] },
    validUntil: { type: "string", format: "date-time" },
    evidenceSnapshot: { type: "object", description: "Compact immutable source snapshot needed to verify evidenceRef integrity on delta responses." },
    evidenceHash: { type: "string" },
    decisionHash: { type: "string" },
    methodologyVersion: { type: "string" },
    refreshed: { type: "boolean" },
    items: { type: "array", items: { type: "object" } },
    subscription: { type: ["object", "null"] },
    subscriptions: { type: "array", items: { type: "object" } },
    nextCursor: { type: ["string", "null"] },
    signingSecret: { type: ["string", "null"] },
    signingSecretNote: { type: ["string", "null"] },
    operatingMode: { type: "string", enum: ["MONITOR_ONLY"] },
    outputClassification: MONITOR_ONLY_OUTPUT_CLASSIFICATION,
    legacyFieldSemantics: LEGACY_MONITOR_FIELD_SEMANTICS_OUTPUT,
    idempotency: IDEMPOTENCY_RECEIPT_OUTPUT,
    asOf: { type: "string", format: "date-time" },
  },
  required: ["status", "dataState", "operatingMode", "outputClassification", "legacyFieldSemantics"],
} as const;

/** Full immutable packet emitted by one canonical specialist. */
const EVIDENCE_PACKET_OUTPUT = {
  type: "object",
  description:
    "Unprojected current evidence packet. contributingRawSignals, missingSignals, limitations, provenance, freshness, and engine execution state travel with the observation.",
  properties: {
    evidenceId: { type: "string" },
    canonicalEngineKey: { type: "string" },
    agentVersion: { type: "string" },
    symbol: { type: "string" },
    assetClass: { type: "string", enum: ["crypto", "equity", "fx", "commodity", "unknown"] },
    exchange: { type: "string" },
    phenomenon: { type: "string" },
    phenomenonCategory: { type: "string" },
    direction: { type: "string", enum: ["bullish", "bearish", "neutral", "directionless"] },
    magnitude: { type: ["number", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    confidenceScale: {
      type: "string",
      enum: ["raw_model_output", "calibrated", "ensemble_agreement", "historical_accuracy", "proxy_confidence", "null"],
    },
    confidenceComponents: { type: "object", additionalProperties: { type: "number" } },
    dataStatus: { type: "string", enum: ["measured", "proxy", "synthetic", "stale", "missing", "unavailable"] },
    dataOrigin: { type: "string" },
    isSynthetic: { type: "boolean" },
    syntheticFields: { type: "array", items: { type: "string" } },
    contributingRawSignals: {
      type: "array",
      description: "Raw measurements contributing to this packet; audit output does not cap this collection.",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          value: { type: ["number", "string", "boolean"] },
          description: { type: "string" },
        },
      },
    },
    timeframe: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    missingSignals: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    recommendedConsumerAction: {
      type: "string",
      enum: ["alert", "monitor", "investigate", "ignore", "cross_reference", "escalate"],
    },
    agentStatus: { type: "string", enum: ["healthy", "degraded", "failed"] },
    agentError: { type: "string" },
    processingTimeMs: { type: "number" },
  },
} as const;

/** Complete roster snapshot from the current in-process evidence bus. */
const ENGINE_INTELLIGENCE_OUTPUT = {
  type: "object",
  description:
    "Complete canonical-roster current-decision evidence snapshot. Every roster entry is emitted, including no_current_finding, stale, and source_unavailable states; this is evidence telemetry, not a worker heartbeat.",
  properties: {
    schemaVersion: { type: "string", enum: ["engine-intelligence-snapshot.v1"] },
    symbol: { type: "string" },
    asOf: { type: "string", format: "date-time" },
    coverage: {
      type: "object",
      properties: {
        expectedEngines: { type: "integer", minimum: 0, description: "Live canonical-roster size at response time." },
        emittedEngines: { type: "integer", minimum: 0, description: "Roster entries emitted in this response." },
        complete: { type: "boolean", enum: [true] },
        completeMeaning: { type: "string", enum: ["all_canonical_roster_entries_emitted"] },
        reporting: { type: "integer" },
        noCurrentFinding: { type: "integer" },
        sourceUnavailable: { type: "integer" },
        stale: { type: "integer" },
      },
    },
    interpretation: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["current_decision_evidence"] },
        evidenceScope: { type: "string", enum: ["all_active_packets_currently_held_on_evidence_bus"] },
        upstreamCompleteness: { type: "string", enum: ["not_asserted"] },
        heartbeatMeasured: { type: "boolean", enum: [false] },
        silenceMeaning: { type: "string" },
        directionPolicy: { type: "string" },
      },
    },
    engines: {
      type: "array",
      minItems: 1,
      description: "One row for each canonical specialist; quiet engines remain explicit rows.",
      items: {
        type: "object",
        properties: {
          engineKey: { type: "string" },
          display: {
            type: "object",
            properties: {
              name: { type: "string" },
              desk: { type: "string" },
              observes: { type: "string" },
              description: { type: "string" },
              directionality: { type: "string", enum: ["DIRECTIONAL", "DIRECTIONLESS"] },
              proxy: { type: "boolean" },
            },
          },
          contract: {
            type: "object",
            properties: {
              inputRequirements: { type: "array", items: { type: "string" } },
              outputContract: {
                type: "object",
                properties: {
                  fields: { type: "array", items: { type: "string" } },
                  provenanceDefaults: { type: "object", additionalProperties: { type: "string" } },
                  confidenceScale: { type: "string" },
                },
              },
              failureBehavior: { type: "string" },
              missingDataBehavior: { type: "string" },
              maxStalenessMs: { type: "number" },
            },
          },
          eligibleToVote: {
            type: "boolean",
            description: "Whether this specialist may contribute a directional vote; it does not make the committee binding.",
          },
          readState: { type: "string", enum: ["signal", "observation", "no_current_finding", "source_unavailable"] },
          operationalStatus: { type: "string", enum: ["reporting", "no_current_finding", "source_unavailable", "stale"] },
          currentDirections: { type: "array", items: { type: "string", enum: ["bullish", "bearish", "neutral"] } },
          asOf: { type: ["string", "null"], format: "date-time" },
          freshness: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["fresh", "stale", "unreported"] },
              ageMs: { type: ["number", "null"] },
              maxStalenessMs: { type: "number" },
              latestExpiresAt: { type: ["string", "null"], format: "date-time" },
            },
          },
          observation: {
            type: ["object", "null"],
            properties: {
              evidenceId: { type: "string" },
              phenomenon: { type: "string" },
              phenomenonCategory: { type: "string" },
              direction: { type: "string", enum: ["bullish", "bearish", "neutral", "directionless"] },
              confidence: { type: "number" },
              confidenceScale: { type: "string" },
              recommendedConsumerAction: { type: "string" },
            },
          },
          evidencePackets: {
            type: "array",
            description: "Every active packet held for this engine and symbol; projectionApplied is false.",
            items: EVIDENCE_PACKET_OUTPUT,
          },
          provenance: {
            type: "object",
            properties: {
              evidenceIds: { type: "array", items: { type: "string" } },
              dataStatuses: { type: "array", items: { type: "string" } },
              dataOrigins: { type: "array", items: { type: "string" } },
              contributingRawSignalCount: { type: "integer" },
              returnedPacketCount: { type: "integer" },
              projectionApplied: { type: "boolean", enum: [false] },
            },
          },
        },
      },
    },
  },
} as const;

/** Detection-service execution telemetry, distinct from evidence-bus state. */
const ENGINE_RUNTIME_TELEMETRY_OUTPUT = {
  type: "object",
  description:
    "Per-scan runtime telemetry from the detection service. A measured snapshot carries the complete canonical lifecycle roster, explicit provider and operational coverage, and lossless provider states; a retired or absent roster row is never described as running. Stale retains the complete last snapshot for diagnosis; unavailable and invalid remain distinct.",
  properties: {
    status: { type: "string", enum: ["measured", "stale", "unavailable", "invalid"] },
    source: { type: "string", enum: ["fahali:engine-telemetry:v1"] },
    reason: { type: ["string", "null"] },
    asOf: { type: ["string", "null"], format: "date-time" },
    ageSeconds: { type: ["number", "null"] },
    maxAgeSeconds: { type: "number", description: "Configured maximum age for a runtime snapshot to remain measured; default 300 seconds, aligned to the production scan SLA." },
    snapshot: {
      type: ["object", "null"],
      description:
        "Unprojected producer snapshot. Its per-engine rows carry cadence, cache, timeout, error, not-loaded, and no-finding execution states when telemetry is measured.",
      additionalProperties: true,
    },
  },
} as const;

const WITHHELD_BINDING_DECISION_OUTPUT = {
  type: "object",
  description:
    "Explicit authority boundary for a requested symbol with no judged verdict row. Runtime evidence may still be present, but it cannot become a fallback direction.",
  properties: {
    status: { type: "string", enum: ["withheld"] },
    producer: { type: "string", enum: ["canonical_verdict"] },
    state: { type: "null" },
    direction: { type: "null" },
    reason: { type: "string" },
  },
} as const;

const COMMITTEE_CENSUS_OUTPUT = {
  type: "object",
  description:
    "Committee evidence census. It is an input to the canonical arbiter, never a second binding direction authority.",
  properties: {
    agreeing: { type: "array", items: { type: "string" } },
    disagreeing: { type: "array", items: { type: "string" } },
    no_read: { type: "array", items: { type: "string" } },
    abstained: { type: ["array", "null"], items: { type: "string" } },
    abstained_unavailable_reason: { type: ["string", "null"] },
    minority: { type: "array", items: { type: "string" } },
    dissent_evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          engine: { type: "string" },
          direction: { type: "string", enum: ["bullish", "bearish", "neutral", "directionless"] },
          observation: { type: ["string", "null"] },
          magnitude: { type: ["number", "null"] },
          dataStatus: { type: "string" },
          timeframe: { type: "string" },
        },
      },
    },
  },
} as const;

/** Master Analyst committee product before canonical arbitration. */
const COMMITTEE_VERDICT_OUTPUT = {
  type: "object",
  description:
    "Full non-binding committee evidence product. It preserves membership, dissent, evidence, limitations, actions, invalidation, confidence components, provenance, and engine telemetry; only the canonical arbiter publishes the binding market direction.",
  properties: {
    verdictId: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    symbol: { type: "string" },
    assetClass: { type: "string" },
    headline: { type: "string" },
    narrative: { type: "string" },
    direction: {
      type: ["string", "null"],
      description: "Committee evidence lean only. Reconcile through the canonical verdict before acting.",
    },
    committeeEvidenceDirection: {
      type: ["string", "null"],
      description: "Explicit non-binding committee direction on the evidence-ranking projection.",
    },
    directionRole: { type: ["string", "null"], enum: ["committee_evidence_non_binding", null] },
    bindingAuthority: { type: ["string", "null"], enum: ["canonical_verdict", null] },
    bindingDirection: { type: "null" },
    severity: { type: "string", enum: ["critical", "high", "medium", "low", "noise"] },
    severityReason: { type: "string" },
    agentsAgreeing: { type: "array", items: { type: "string" } },
    agentsDisagreeing: { type: "array", items: { type: "string" } },
    agentsSilent: { type: "array", items: { type: "string" } },
    totalAgentsWithSignal: { type: "integer" },
    agentsAgreeingCount: { type: "integer" },
    agentsDisagreeingCount: { type: "integer" },
    agentsSilentCount: { type: "integer" },
    reportingCount: { type: "integer" },
    neutralReportingCount: { type: "integer" },
    committee: COMMITTEE_CENSUS_OUTPUT,
    engineIntelligence: ENGINE_INTELLIGENCE_OUTPUT,
    engineRuntimeTelemetry: ENGINE_RUNTIME_TELEMETRY_OUTPUT,
    evidence: {
      type: "object",
      properties: {
        measured: { type: "array", items: { type: "string" } },
        proxy: { type: "array", items: { type: "string" } },
        synthetic: { type: "array", items: { type: "string" } },
        missing: { type: "array", items: { type: "string" } },
      },
    },
    dataQualityWarning: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    confidenceScale: { type: "string" },
    confidenceBreakdown: {
      type: "object",
      properties: {
        directionalConsensus: { type: "number" },
        evidenceQuality: { type: "number" },
        historicalAccuracy: { type: "number" },
      },
    },
    portfolioImpact: { type: "object" },
    actionOptions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          rationale: { type: "string" },
          riskLevel: { type: "string", enum: ["low", "moderate", "high"] },
        },
      },
    },
    invalidationConditions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          condition: { type: "string" },
          probability: { type: "string", enum: ["low", "moderate", "high"] },
        },
      },
    },
    monitoringWindow: { type: "string" },
    contributingEvidenceIds: { type: "array", items: { type: "string" } },
    provenanceHash: { type: "string" },
    replayUrl: { type: "string" },
    guardrail: {
      type: "object",
      properties: {
        passed: { type: "boolean" },
        annotations: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

const CANONICAL_COMMITTEE_EVIDENCE_OUTPUT = {
  type: "object",
  description:
    "Complete committee input carried into the canonical verdict for reconciliation. Committee membership and its raw verdict are evidence; the enclosing canonical verdict remains the sole market-direction authority.",
  properties: {
    agreeing: { type: "array", items: { type: "string" } },
    disagreeing: { type: "array", items: { type: "string" } },
    silent: { type: "array", items: { type: "string" } },
    engineIntelligence: ENGINE_INTELLIGENCE_OUTPUT,
    engineRuntimeTelemetry: ENGINE_RUNTIME_TELEMETRY_OUTPUT,
    verdict: COMMITTEE_VERDICT_OUTPUT,
  },
} as const;

/** Optional compatibility evidence preserved from the legacy master-agent synthesis. */
const MASTER_AGENT_EVIDENCE_OUTPUT = {
  type: ["object", "null"],
  description:
    "Preserved agent_verdict evidence for audit and compatibility. Its direction, confidence, and expected move are non-binding inputs; they never replace, authorize, or gate the canonical verdict.",
  properties: {
    producer: { type: "string", enum: ["agent_verdict"] },
    role: { type: "string", enum: ["evidence_non_binding"] },
    direction: {
      type: ["string", "null"],
      enum: ["bullish", "bearish", "neutral", "unknown", null],
      description: "Legacy master-agent evidence lean only; never the binding market direction.",
    },
    confidence: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 1,
      description: "Confidence in the master-agent evidence synthesis. It is not decision confidence.",
    },
    uncertainty: { type: ["number", "null"] },
    expectedMovePct: {
      type: ["number", "null"],
      description: "Legacy evidence estimate only; the canonical arbiter owns the binding expected move.",
    },
    forecastHorizon: { type: ["string", "null"] },
    severity: { type: ["string", "null"] },
    urgencyScore: { type: ["number", "null"] },
    actionability: { type: ["string", "null"], enum: ["ACTIONABLE", "ABSTAIN", null] },
    abstainReason: { type: ["string", "null"] },
  },
} as const;

/** Complete output of the single versioned market-direction arbiter. */
const CANONICAL_VERDICT_OUTPUT = {
  type: ["object", "null"],
  description:
    "Complete canonical arbiter verdict and sole binding market-direction authority. Null means the arbiter returned no eligible authority and MUST remain a withheld/no-read state; it is never neutral direction. When present it carries the full committee evidence product, the current canonical-roster evidence rows, runtime telemetry, forecast distribution, record, conflict resolution, invalidation, and policy version.",
  properties: {
    symbol: { type: "string" },
    horizon: { type: "string", enum: ["72h"] },
    state: { type: "string", enum: ["NORMAL", "WATCH", "DEFEND", "WITHHOLD"] },
    direction: { type: "string", enum: ["DOWNSIDE_SKEW", "UPSIDE_SKEW", "RANGE_BOUND", "MIXED", "INSUFFICIENT_EVIDENCE"] },
    headline: { type: "string" },
    explanation: { type: "string" },
    coverage: {
      type: ["string", "object"],
      description: "Compatibility label on the MCP route; coverageDetail carries the structured source value.",
    },
    coverageDetail: {
      type: "object",
      properties: {
        reporting: { type: "integer" },
        totalEngines: { type: "integer" },
        label: { type: "string" },
      },
    },
    participation: {
      type: "object",
      properties: {
        directional: { type: "integer" },
        ofReporting: { type: "integer" },
      },
    },
    agreement: {
      type: "object",
      properties: {
        agreeing: { type: "integer" },
        ofDirectional: { type: "integer" },
        pct: { type: ["number", "null"] },
      },
    },
    agreementPct: { type: ["number", "null"], description: "Compatibility alias of agreement.pct." },
    compositeConfidencePct: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 100,
      description: "Canonical arbiter confidence on a 0-100 scale. This is the only confidence that may authorize or gate the binding market decision.",
    },
    reliability: { type: "string", enum: ["UNVALIDATED", "LOW", "MEDIUM", "HIGH"] },
    probabilities: {
      type: ["object", "null"],
      properties: {
        downside: { type: "number" },
        rangeBound: { type: "number" },
        upside: { type: "number" },
      },
    },
    thresholds: {
      type: ["object", "null"],
      properties: {
        downsideBelowPct: { type: "number" },
        upsideAbovePct: { type: "number" },
      },
    },
    expectedMovePct: { type: ["number", "null"] },
    expectedRangePct: {
      type: ["object", "null"],
      properties: {
        low: { type: ["number", "null"] },
        high: { type: ["number", "null"] },
      },
    },
    conflict: { type: "boolean", description: "Compatibility alias of conflictDetail.present." },
    conflictDetail: {
      type: "object",
      description: "Canonical arbitration result when committee evidence and forecast disagree; committee input is not independently binding.",
      properties: {
        present: { type: "boolean" },
        note: { type: ["string", "null"] },
      },
    },
    record: {
      type: "object",
      properties: {
        engineFlags: { type: "object", properties: { wins: { type: "integer" }, total: { type: "integer" } } },
        directional: { type: "object", properties: { wins: { type: "integer" }, total: { type: "integer" } } },
        forecast72h: { type: "object", properties: { wins: { type: "integer" }, total: { type: "integer" }, accruing: { type: "boolean" } } },
      },
    },
    recordStatedInExplanation: { type: "boolean" },
    cta: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["alert_risk", "review_exposure", "watchlist", "wait_for_evidence"] },
        label: { type: "string" },
      },
    },
    portfolio: {
      type: ["object", "null"],
      properties: {
        holdsSymbol: { type: "boolean" },
        capitalAtRiskUsd: { type: ["number", "null"] },
      },
    },
    policyVersion: { type: "string" },
    committee: CANONICAL_COMMITTEE_EVIDENCE_OUTPUT,
    invalidation: { type: ["array", "null"], items: { type: "object" } },
  },
} as const;

/** One asset class of `fahali_get_market_mood` (shared/marketMood.ts `MoodReading`). */
const MOOD_READING_SCHEMA = {
  type: "object",
  properties: {
    assetClass: { type: "string", enum: ["equity", "crypto"] },
    state: { type: "string", enum: ["measured", "unavailable"] },
    score: { type: ["integer", "null"], description: "0-100. Null when state is 'unavailable' - read `reason`, never substitute a neutral value." },
    band: { type: ["string", "null"], enum: ["extreme_fear", "fear", "neutral", "greed", "extreme_greed", null] },
    label: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
    asOf: { type: ["string", "null"], description: "The day described: New York session date for US stocks, UTC day for crypto." },
    provisional: { type: "boolean", description: "True when asOf is today and still moving (crypto)." },
    coverage: {
      type: "object",
      properties: { present: { type: "integer" }, total: { type: "integer" }, required: { type: "integer" } },
    },
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          name: { type: "string" },
          value: { type: ["number", "null"], description: "The raw measured fact, as a fraction (0.031 = +3.1%), a share 0-1, or a ratio - see unit." },
          unit: { type: "string", enum: ["pct", "share", "ratio"] },
          percentile: { type: ["integer", "null"], description: "0-100, oriented so 100 = greed (already flipped where higherMeans is 'fear')." },
          higherMeans: { type: "string", enum: ["greed", "fear"] },
          ranked: {
            type: ["object", "null"],
            description: "How many earlier values the percentile was ranked against and the first of them. Quote this beside any percentile; it is often fewer than the 180-value window.",
            properties: { against: { type: "integer" }, since: { type: "string" } },
          },
          detail: { type: ["string", "null"], description: "What this reading actually used, e.g. how many funds of how many tracked." },
          symbols: { type: "array", items: { type: "string" } },
          note: { type: "string", description: "What the measure is and the limits of the proxy behind it." },
          reason: { type: ["string", "null"] },
        },
      },
    },
    history: {
      type: "array",
      description: "Up to 30 daily scores, reconstructed point-in-time from prices (each day ranked only against days before it). Null where too few measures could be read.",
      items: { type: "object", properties: { day: { type: "string" }, score: { type: ["integer", "null"] } } },
    },
    excluded: {
      type: "array",
      items: { type: "object", properties: { symbol: { type: "string" }, reason: { type: "string" } } },
    },
  },
} as const;

export const TOOL_DEFINITIONS = [
  {
    name: "fahali_get_market_verdict",
    description:
      "Use this when the user asks what the market is doing right now, how a coin or stock is looking, whether something seems risky at the moment, what the read on a named ticker is, or mentions specific symbols and wants the current assessment. Get structured market verdict for one or more symbols. Direction, expected move, and decision confidence are set only by Fahali's canonical verdict arbiter — the same policy that renders the app — composing committee evidence, the 72h probabilistic forecast, and the judged track record; the full arbiter read (state WATCH/DEFEND/NORMAL/WITHHOLD, reliability grade, conflict flag, policy version) rides in each item's `canonical` field. If a requested symbol has no judged verdict row, `notReturned` still preserves its complete runtime engine telemetry when available while the binding decision remains explicitly withheld. Legacy master-agent confidence is explicitly labeled non-binding evidence. Fahali registers every claim with its horizon before the outcome exists and publishes the judged record, misses included: call `fahali_get_lead_time` for precision, base rate, base-rate lift, recall and effective sample per stratum. Strata below the publishability bar are withheld with a reason rather than rounded up. Do not state an accuracy figure that did not come from that tool in this session.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "string", description: "Comma-separated trading symbols (e.g. 'BTCUSDT,ETHUSDT'). Omitting returns top signals across all symbols." },
        includeContagion: { type: "boolean", description: "If true, enriches the response with downside co-movement (the hidden correlation chain) from the tail_dependence engine. Chain enrichment requires Elite tier.", default: false },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string" },
        updatedAt: { type: "string", format: "date-time" },
        provenanceRoot: { type: "string", description: "SHA-256 over the per-item integrity hashes. Verifies this response wasn't altered after receipt (recompute to check). NOT a cryptographic attestation — key-signed receipts are on the roadmap." },
        count: { type: "integer" },
        notReturned: {
          type: "array",
          description:
            "Every requested symbol without a judged verdict row. Fresh/stale runtime telemetry remains attached when available; no engine evidence is promoted into a binding direction.",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              reason: { type: "string" },
              bindingDecision: WITHHELD_BINDING_DECISION_OUTPUT,
              engineRuntimeTelemetry: { ...ENGINE_RUNTIME_TELEMETRY_OUTPUT, type: ["object", "null"] },
            },
          },
        },
        requestedCoverage: {
          type: ["object", "null"],
          properties: {
            requestedCount: { type: "integer" },
            returnedCount: { type: "integer" },
            notReturnedCount: { type: "integer" },
            complete: {
              type: "boolean",
              description: "True when every requested symbol is explicitly accounted for as returned or not_returned; it is not a claim that every symbol has a verdict.",
            },
            bySymbol: {
              type: "object",
              additionalProperties: {
                type: "object",
                properties: {
                  state: { type: "string", enum: ["returned", "not_returned"] },
                  reason: { type: "string" },
                  bindingDecision: WITHHELD_BINDING_DECISION_OUTPUT,
                  engineRuntimeTelemetry: { ...ENGINE_RUNTIME_TELEMETRY_OUTPUT, type: ["object", "null"] },
                },
              },
            },
          },
        },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              timestamp: { type: ["string", "integer", "number"] },
              verdict: {
                type: "object",
                description: "Compatibility decision block. Direction and bindingConfidence belong to the canonical arbiter; legacy confidence and any masterAgentEvidence remain non-binding evidence.",
                properties: {
                  direction: {
                    type: "string",
                    enum: ["bullish", "bearish", "neutral", "unknown"],
                    description: "Served market direction after canonical arbitration and its confidence gate. No agent or committee evidence may replace it.",
                  },
                  confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                    description: "Legacy agent_verdict evidence confidence retained for compatibility. It is non-binding and is never decision confidence.",
                  },
                  confidenceProducer: {
                    type: "string",
                    enum: ["agent_verdict"],
                    description: "Producer of the legacy confidence field; an evidence producer, not a direction authority.",
                  },
                  confidenceRole: {
                    type: "string",
                    enum: ["legacy_master_evidence_non_binding"],
                    description: "Declares that confidence is compatibility evidence and cannot authorize or gate the decision.",
                  },
                  bindingConfidence: {
                    type: ["number", "null"],
                    minimum: 0,
                    maximum: 1,
                    description: "Canonical arbiter confidence normalized to 0-1. This is the only decision confidence; null means no canonical confidence was available.",
                  },
                  bindingConfidenceProducer: {
                    type: ["string", "null"],
                    enum: ["canonical_verdict", null],
                    description: "canonical_verdict when bindingConfidence is present; null when the sole direction authority returned no read.",
                  },
                  masterAgentEvidence: MASTER_AGENT_EVIDENCE_OUTPUT,
                  uncertainty: { type: "number" },
                  expectedMovePct: { type: ["number", "null"], description: "Signed expected move, percent. ALWAYS null when actionability is ABSTAIN — a signed move sitting beside a withheld direction is a directional claim the verdict declined to make, and it is the only concrete figure in the block, so an agent reads it as the call. Live 2026-08-14: NVO and META shipped +10 next to direction 'neutral'." },
                  forecastHorizon: { type: "string" },
                  severity: { type: "string" },
                  urgencyScore: {
                    type: ["number", "null"],
                    description: "Rescaled urgency evidence when the source produced it. Null is the honest value for a withheld/no-read verdict; it must never be filled with zero.",
                  },
                  actionability: { type: "string", enum: ["ACTIONABLE", "ABSTAIN"], description: "Gate on this before treating a verdict as a reason to act. ACTIONABLE means a directional call is on the table: a bullish/bearish read that cleared the 25% confidence floor. ABSTAIN means there is no directional call, for one of two reasons named in abstainReason — (a) the read was directional but below the floor, so its label was withheld and direction reads neutral by policy, or (b) no direction was reached at all: range-bound, insufficient evidence, or signals in conflict. Widened 2026-08-14: case (b) previously fell through to ACTIONABLE by default, so verdicts whose own arbiter reported INSUFFICIENT_EVIDENCE reached agents marked actionable. ABSTAIN is never a default — every verdict is decided." },
                  abstainReason: { type: "string", description: "Present only when actionability is ABSTAIN. Plain-language explanation of why no directional call is being made — distinguishes a measured range-bound read from missing or conflicting evidence." },
                },
                required: ["direction", "confidence", "uncertainty"],
              },
              masterAgentEvidence: MASTER_AGENT_EVIDENCE_OUTPUT,
              reasoning: { type: "object", properties: { steps: { type: "array", items: { type: "string" } }, toolsUsed: { type: "array", items: { type: "string" } }, conflictScore: { type: "number" }, missingSignals: { type: "array", items: { type: "string" } } } },
              provenance: { type: "object", properties: { engineNames: { type: "array", items: { type: "string" } }, walkForwardValidated: { type: "boolean" }, integrity: { type: "object", properties: { alg: { type: "string" }, hash: { type: "string" }, hashedAt: { type: "string", format: "date-time" } } } } },
              canonical: CANONICAL_VERDICT_OUTPUT,
            },
          },
        },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/verdict" },
  },
  {
    name: "fahali_get_forecast",
    description:
      "Use this when the user asks what is likely to happen next for a symbol, what the odds of a sharp move are, or how confident the read is over the next few days. NOTE: this endpoint is the one read that a free developer key cannot reach -- it returns 403 with an `upgrade` object naming Agent Starter ($49/mo), the cheapest plan that unlocks it. Every other tool here works on the free key. Get the forward-looking probabilistic forecast for a symbol: crash / pump / neutral probabilities (normalized), expected return, an uncertainty cone (p10/p90) over the forecast's registered horizon, per-engine driver contributions, and (when the sample is meaningful) historical similar-setup accuracy. Composed from live pending predictions (early_warning, crash_predictor, risk_intelligence_72h) blended with directional alert votes — individual signals carry horizons of 6-72h; `horizon` (a number, in hours) reports the top evidence's actual registered timeframe, not a blanket 72 — most forecasts in this system register 6-36h. A DISTRIBUTION IS ALWAYS SERVED (2026-10-11): `forecast.direction` is up | down | range with `crashProbability` / `pumpProbability` / `neutralProbability` summing to 1 at ±2% over `horizon` hours — probabilities, never certainties. `forecast.evidenceTier` says what the numbers rest on: 'calibrated' (≥5 admitted rows with a verified-fleet calibration cell), 'partially_calibrated', 'self_reported' (evidence voted, none calibrated — it tilts the base rate at a capped weight), 'climatology' (no directional evidence: the instrument's OWN 30-day base rate of ±2% outcomes at this horizon — the formal no-skill forecast), 'class_climatology' (pooled over the asset class because the symbol's history is thin) or 'uninformative_prior' (no history at all: a labelled uniform prior). `forecast.reliability` is the measured grade of the forecast family on the judged record (beats_chance / indistinguishable / … with P(skill) and sample) or 'base_rate' when the read IS the base rate — never a grade the record did not produce. `caveats` lists, machine-readably, why the evidence path would once have withheld (e.g. calibration_floor_not_met, no_evidence_found, forecast_expired); the stale forecast, when one expired, stays under `expiredForecast` for audit. `claim.kind` 'forecast' = a calibrated directional edge; 'observation' = real numbers without a calibrated edge (read the tier). `abstained` is now always false. `uncertainty` is the cone's real max p90-p10 spread, never a placeholder zero. IMPORTANT — most Fahali agents are DETECTORS (risk / structure / anomaly / volatility), NOT trade-signal generators: each driver carries a `role` (detector|forecaster) and `tier` (actionable|context|observation). Treat a driver's `observation` as what it detected, never as buy/sell. The forecast's `stance` says how to read the crash/pump headline: `directional` = a forecaster has a calibrated edge; `risk_defensive` = a risk detector does; `observation` = detectors flagged conditions but nothing is an actionable directional call. `detectionConfidence` (how strong the pattern is) and `outcomeProbability` (calibrated P(correct) from realized outcomes) are separate — do not read detection strength as a hit probability.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Trading symbol (e.g. 'BTCUSDT'). Required." },
        include: { type: "string", description: "Optional comma-separated extras: 'reasoning,history'." },
      },
      required: ["symbol"],
    },
    outputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        asOf: { type: "string", format: "date-time" },
        horizon: { type: ["number", "null"], description: "The forecast's ACTUAL registered horizon in hours (e.g. 6, 36) — not a fixed 72. Pairs with expiresAt to know when this claim's window closes." },
        expiresAt: { type: ["string", "null"], format: "date-time", description: "createdAt + horizon hours — a fixed instant, does not move between requests." },
        source: { type: "string", enum: ["predictions", "alerts"] },
        claim: {
          type: ["object", "null"],
          description: "Fahali dictionary claim (shared/fahaliDictionary.ts). kind: 'forecast' (live — has issuedAt/horizonHours/expiresAt), 'observation' (real data, reliability gate withheld a directional promise — has observedAt), or 'abstention' (has `reason`, e.g. forecast_expired, cone_horizon_mismatch, forecast_malformed). Read `kind` before treating anything else in this response as an actionable directional call.",
        },
        expiredForecast: {
          type: "object",
          description: "Present only when claim.kind is 'abstention' with an expiry reason. The stale forecast that expired by its own registered horizon, kept visible for audit rather than silently withheld.",
        },
        abstained: { type: "boolean", description: "Always false since 2026-10-11: a distribution is always served. Kept for compatibility. What the evidence path would once have withheld on is listed under `caveats`." },
        abstentionReason: { type: ["string", "null"], description: "Legacy; null. See `caveats`." },
        direction: { type: ["string", "null"], enum: ["up", "down", "range", null], description: "The served read's leading outcome at ±2% over `horizon`: up | down | range (range = the in-between outcome leads; `directionLean` names its skew)." },
        directionLean: { type: ["string", "null"], enum: ["down_skew", "up_skew", null], description: "When direction is range, which tail is heavier." },
        evidenceTier: { type: ["string", "null"], enum: ["calibrated", "partially_calibrated", "self_reported", "climatology", "class_climatology", "uninformative_prior", null], description: "What the probabilities rest on. climatology / class_climatology / uninformative_prior = the base-rate read (no skill claimed); the others = admitted evidence blended into the base rate at the weight in `blend`." },
        reliability: { type: ["object", "null"], description: "The measured grade of the forecast family on the judged record ({family, grade, label, probabilityOfSkill, effectiveSample, judged, reason, source, appliesTo}); grade 'base_rate' when the read is the base rate; 'unmeasured' when no verification row is cached. Quote the grade with the number." },
        caveats: { type: "array", items: { type: "string" }, description: "Machine-readable reasons the evidence path withheld (kept, not hidden): calibration_floor_not_met, no_evidence_found, no_directional_evidence, insufficient_evidence, identity_evidence_withheld, calibration_unavailable, forecast_query_failed, forecast_expired, cone_horizon_mismatch, forecast_malformed. A query failure is NOT a quiet market — do not collapse these." },
        alwaysOn: { type: "boolean", description: "True when the served read is the always-on base-rate blend rather than the evidence path's own distribution." },
        servedBy: { type: "string", description: "'evidence' or the always-on method version." },
        blend: { type: ["object", "null"], description: "{weightEvidence, rows, directionalRows, calibratedRows, halfWeightRows, selfReportedMaxWeight} — the denominator of an always-on read." },
        climatology: { type: ["object", "null"], description: "{basis, n, windowDays, thresholdPct, barsAhead, assetClass, p10, p50, p90[, symbols]} — the base-rate sample an always-on read is built from." },
        note: { type: "string", description: "Plain-language explanation of the abstention, safe to show a customer verbatim. Names no field and no code path." },
        forecast: {
          // NULL ON ABSTENTION (2026-08-14). Previously this object was always
          // populated when any forecast row existed, so an expired forecast
          // shipped live-looking probabilities beside claim.kind 'abstention'.
          // Read `claim.kind` first; when it is 'abstention' this is null and
          // the withheld figures — where still auditable — are under
          // `expiredForecast`.
          type: ["object", "null"],
          properties: {
            // Nullable by contract (2026-07-20). When Fahali has no
            // forecastable evidence it ABSTAINS: every probability is null and
            // `abstained` is true. Previously these were emitted as a
            // prior-derived 33/33/33 with an expected return near -1.3%, which
            // an agent could not distinguish from a measurement. A null is
            // honest and forces the caller to handle absence; a fabricated
            // number propagates silently. Never coerce these to 0.
            crashProbability: { type: ["number", "null"] },
            pumpProbability: { type: ["number", "null"] },
            neutralProbability: { type: ["number", "null"] },
            confidence: { type: ["number", "null"] },
            expectedReturn: { type: ["number", "null"] },
            uncertainty: { type: "number", description: "Real max p90-p10 spread across the cone, at the same % scale as expectedReturn. Was previously a hardcoded 0 (fixed 2026-08-06) — 0 now only occurs when the cone is genuinely degenerate." },
            abstained: {
              type: "boolean",
              description: "True when no forecast was made. Probabilities are null, NOT zero, and must not be treated as a neutral call.",
            },
            abstentionReason: {
              type: ["string", "null"],
              enum: ["no_directional_evidence", "insufficient_evidence", null],
              description: "Why the forecast was withheld. Present only when abstained is true.",
            },
            stance: {
              type: "string",
              enum: ["directional", "risk_defensive", "observation", "abstain"],
              description: "How to read the crash/pump headline. 'directional': a forecaster has a calibrated edge (actionable directional call). 'risk_defensive': a risk detector has an edge (defensive, not buy/sell). 'observation': detectors flagged conditions but no actionable directional call. 'abstain': no forecastable evidence exists — probabilities are null.",
            },
          },
        },
        cone: { type: "array", items: { type: "object", properties: { t: { type: "string" }, p10: { type: "number" }, p50: { type: "number" }, p90: { type: "number" } } } },
        drivers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              engine: { type: "string" },
              contribution: { type: "number" },
              accuracy30d: { type: ["number", "null"] },
              role: { type: "string", enum: ["detector", "forecaster"], description: "Detectors report a condition (never buy/sell); forecasters make a directional call." },
              claim: { type: "string", enum: ["directional", "risk_event", "structure", "volatility", "regime"], description: "What this driver actually claims — its real job." },
              label: { type: "string", description: "Human label (never implies a trade)." },
              tier: { type: "string", enum: ["actionable", "context", "observation"], description: "How the driver may be used: 'observation' (structure/volatility detectors — statement only), 'context' (informs but not actionable alone), 'actionable' (calibrated edge)." },
              observation: { type: "string", description: "Honest one-line of what was detected — NOT a buy/sell instruction." },
              detectionConfidence: { type: "number", description: "How strong the detected pattern is (raw engine confidence). NOT a hit probability." },
              outcomeProbability: { type: "number", description: "Calibrated P(correct) at this confidence from realized outcomes. Use THIS, not detectionConfidence, as a probability." },
              capability: {
                type: "object",
                description: "What this engine is ABLE to observe — added 2026-08-14. Drivers used to ship as bare keys ('early_warning', 'ofi'), which told a reader nothing and pushed every consumer to invent its own gloss. OMITTED entirely for engines with no roster entry, never blank: an empty line under an engine's name reads as 'this engine observes nothing' rather than 'we have no description'.",
                properties: {
                  name: { type: "string", description: "Display name, e.g. 'Lead Signal'." },
                  desk: { type: "string", enum: ["money", "price", "news"], description: "Which inputs this engine reads at all. A PRICE-desk engine may never be narrated as observing capital — it has no capital input. When the money desk and the price desk disagree, that divergence is itself the signal." },
                  deskScope: { type: "string", description: "One line naming the desk's inputs, e.g. 'Price, volume and time'." },
                  observes: { type: "string", description: "One line, written for a reader, of what this engine can observe — e.g. 'Stress building before it shows in price'." },
                  proxy: { type: "boolean", description: "Present and true only when the input is a DERIVED ESTIMATE rather than a measured feed — the difference between 'we saw' and 'we inferred'. Order flow is candle-derived, not exchange tape. Must survive to any surface that quotes the driver." },
                },
              },
            },
          },
        },
        missingSignals: { type: "array", items: { type: "string" } },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/forecast/72h" },
  },
  {
    name: "fahali_resolve_instrument",
    description:
      "Resolve a ticker to canonical identity: canonicalId, displayName, assetClass, venue, quote currency, session. Call it when a response returns resolutionState 'ambiguous'. FETH, FBTC, GBTC and ABTC are ETFs that parse as crypto pairs. A bare crypto base (BTC) resolves to its pair (BTCUSDT); a security sharing the ticker is named in symbolResolutions — pass assetClass 'equity' for it.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "A single ticker, such as NVDA, GBTC or BTCUSDT." },
        assetClass: {
          type: "string",
          enum: ["crypto", "equity", "etf"],
          description: "Optional. 'equity' or 'etf' resolves a ticker shared by a crypto asset and a listed security (e.g. BTC) as the security; omitted, a bare crypto base resolves to its crypto pair.",
        },
        symbols: {
          oneOf: [
            { type: "string", description: "Comma-separated tickers." },
            { type: "array", items: { type: "string" }, maxItems: 100 },
          ],
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok"] },
        dataState: { type: "string", enum: ["measured", "no_data"] },
        requested: { type: "array", items: { type: "string" } },
        instruments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              canonicalId: { type: ["string", "null"], description: "venue:class:base[-quote], e.g. nasdaq:equity:NVDA." },
              displayName: { type: "string" },
              assetClass: { type: ["string", "null"], enum: ["crypto", "equity", null] },
              venue: { type: ["string", "null"] },
              quoteCurrency: { type: ["string", "null"] },
              resolutionState: { type: "string", enum: ["resolved", "partial", "ambiguous"] },
              resolutionBasis: { type: "string", enum: ["venue_asset_list", "quote_suffix_parse", "unresolved"] },
              ambiguityWarning: { type: ["string", "null"] },
              session: { type: "object" },
            },
            required: ["symbol", "resolutionState", "resolutionBasis"],
          },
        },
        unresolved: { type: "array", items: { type: "string" }, description: "Symbols Fahali does not list. Distinct from a reference that failed to load — read referenceHealth.loaded." },
        symbolResolutions: {
          type: "array",
          description: "Every canonicalisation, disclosed: what was asked, the instrument that answered, and any listed security sharing the ticker (equityAlternative, with its own identity).",
          items: { type: "object" },
        },
        referenceHealth: { type: "object" },
      },
      required: ["status", "instruments"],
    },
    _meta: { requiredTier: "free", endpoint: "/agent/resolve-instrument" },
  },
  {
    name: "fahali_get_microstructure_proxy",
    description:
      "Latest absorption observations derived from public aggregate trades and order-book snapshots. Filter by symbol or time; omit symbols for the latest fleet-wide observations. The response reports price/volume behavior, freshness, conflicts, and venue only when the source identifies it; it does not attribute activity to a trader or report hidden executed volume.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Optional single instrument, such as BTC, BTCUSDT, or ATOMUSDT." },
        symbols: {
          oneOf: [
            { type: "string", description: "Optional comma-separated instruments." },
            { type: "array", items: { type: "string" }, maxItems: 100 },
          ],
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        since: { type: "string", format: "date-time", description: "Optional ISO-8601 lower bound, no more than 30 days ago. Defaults to seven days." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok"] },
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "error"] },
        headline: { type: "string" },
        claim: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["observation", "abstention"] },
            basis: { type: "string", enum: ["proxy", "absent"] },
            summary: { type: "string" },
            reason: { type: "string" },
          },
          required: ["kind", "basis"],
        },
        scope: { type: "object" },
        resolutions: { type: "array", items: { type: "object" } },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceAlertId: { type: ["number", "null"] },
              symbol: { type: "string" },
              canonicalInstrumentId: {
                type: ["string", "null"],
                description:
                  "The resolved INSTRUMENT id (binance:crypto:TIA-USDT), or null when the reference cannot resolve the symbol. Until 2026-09-04 this carried the crypto UNDERLYING ('TIA') while instruments[] carried the instrument id.",
              },
              underlyingId: {
                type: ["string", "null"],
                description: "The crypto base asset. What canonicalInstrumentId used to hold.",
              },
              assetClass: { type: "string" },
              venue: {
                type: ["string", "null"],
                description: "Resolved from the venue asset list, or null when the symbol cannot be resolved. Fahali never guesses one.",
              },
              identityResolution: {
                type: "object",
                description: "How the row's identity was resolved, so an unresolved row is distinguishable from an unlisted one.",
                properties: { state: { type: "string" }, basis: { type: ["string", "null"] } },
              },
              quoteCurrency: { type: ["string", "null"] },
              observedAt: { type: ["string", "null"], format: "date-time" },
              ageMinutes: { type: ["number", "null"] },
              freshness: { type: "string", enum: ["current", "recent", "historical", "unknown"] },
              observationType: { type: "string", enum: ["public_microstructure_absorption_proxy"] },
              direction: { type: "string", enum: ["buy_side", "sell_side", "withheld"] },
              directionBasis: { type: "string", enum: ["persisted_hidden_liquidity_direction", "withheld"] },
              directionConflict: { type: "boolean" },
              withheldReason: { type: ["string", "null"] },
              severity: { type: "string" },
              detectionScore: { type: ["number", "null"], description: "Uncalibrated composite observation score on 0-1; not a probability or off-exchange-volume share." },
              scoreType: { type: "string", enum: ["uncalibrated_microstructure_observation_score"] },
              scoreScale: { type: "string", enum: ["0-1"] },
              scoreMeaning: { type: "string" },
              isProbability: { type: "boolean", enum: [false] },
              calibrationStatus: { type: "string", enum: ["uncalibrated"] },
              outcomeProbability: { type: ["number", "null"], description: "Always null until a calibrated outcome model exists." },
              outcomeProbabilityWithheldReason: { type: "string" },
              observation: { type: "string" },
              evidence: { type: "object" },
              evidencePlain: { type: "object" },
            },
          },
        },
        notReturned: { type: "array", items: { type: "object" } },
        conflicts: { type: "array", items: { type: "object" } },
        summary: { type: "object" },
        limitations: { type: "object" },
        disclaimer: { type: "string" },
        evidence: { type: "object" },
        provenance: { type: "object" },
        asOf: { type: "string", format: "date-time" },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/microstructure-proxy" },
  },
  {
    name: "fahali_get_flash_crash_risk",
    description:
      "Per-symbol break-setup detection strength — NOT a calibrated crash probability. Each signal's detectionStrength = risk_weight(alert_type) × alert_confidence (calibrated:false); it ranks which symbols are assembling a break setup, it is NOT P(crash). Fahali has no calibrated crash-probability, time-to-crash, or move-magnitude model, so those are not returned. Actionability is withheld (the flash_crash_precursor engine's realized lift over base rate is ~0). Read dataOrigin + disclaimer.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        dataOrigin: { type: "string", description: "alert_weight_x_confidence" },
        calibrated: { type: "boolean", description: "Always false — detectionStrength is not a calibrated probability." },
        disclaimer: { type: "string" },
        signals: { type: "array", items: { type: "object", properties: {
          symbol: { type: "string" },
          detectionStrength: { type: "number", description: "0-1 UNCALIBRATED signal strength (risk_weight × confidence), NOT P(crash)." },
          detectionStrengthPct: { type: "number" },
          precursorType: { type: ["string", "null"] },
          severity: { type: "string" },
        } } },
        summary: { type: "object", properties: {
          topSymbol: { type: ["string", "null"], description: "Null whenever the leader is not separated from second place — the name is withheld and the tie size is reported instead." },
          topSymbolTiedCount: { type: ["integer", "null"], description: "How many symbols share the top detection strength when topSymbol is withheld." },
          topSymbolWithheld: { type: ["boolean", "null"], description: "True when no single leader could be named." },
          topDetectionStrengthPct: { type: ["number", "null"] },
          precursorConcentrationPct: { type: ["number", "null"] },
          note: { type: ["string", "null"] },
        } },
        instruments: { type: "array", items: { type: "object" }, description: "Resolved instrument identities carried across from the api-server (every top name here is typically a leveraged/inverse product — read identity before reading direction)." },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/risk/flash-crash" },
  },
  {
    name: "fahali_get_detection_activity",
    description:
      "Recent detection-alert activity per symbol. Returns distinct symbols with recent alerts, the recent-detection count, the bullish-versus-bearish balance of alert types, the most-alerted symbol, and alert-derived sentiment. This surface measures detection activity rather than executed trade flow or trader identity; read dataOrigin and disclaimer.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        dataOrigin: { type: "string", description: "recent_alert_activity — derived from detection alerts, not order flow." },
        disclaimer: { type: "string" },
        symbolsWithRecentDetections: { type: ["integer", "null"], description: "Distinct symbols with recent alerts." },
        recentDetections: { type: ["string", "null"], description: "Count of recent detection alerts (not USD volume)." },
        alertLean: { type: ["string", "null"], enum: ["bullish", "bearish", "neutral", null], description: "Balance of bullish-versus-bearish recent alert types; null when no recent activity is measurable." },
        alertLeanStrength: { type: ["number", "null"], description: "Fraction of recent alerts on the leaning side (0-1); null when no data." },
        hottestSymbol: { type: ["string", "null"] },
        topSymbolByDetections: { type: ["string", "null"] },
        alertDerivedSentiment: { type: ["string", "null"] },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/detection-activity" },
  },
  {
    name: "fahali_get_unusual_money_movement",
    description:
      "Find symbols with elevated candle-derived buy-versus-sell volume imbalance. Returns the latest proxy reading, raw volumes, net imbalance, uncalibrated detection score, freshness, and any conflict between the stored signal label and net-flow sign. The measurement is participant-agnostic and does not infer whether one account caused the movement.",
    inputSchema: {
      type: "object",
      properties: {
        minimum_flow_usd: {
          type: "number",
          minimum: 0,
          default: 250000,
          description:
            "Minimum measured net imbalance in USD. THIS IS THE PRIMARY FILTER. " +
            "It is a measured dollar magnitude, not a score: (buy_volume - sell_volume) * price. " +
            "Set 0 to remove the magnitude floor.",
        },
        minimum_confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0,
          description:
            "Minimum uncalibrated order-flow detection score. Not an outcome probability, and " +
            "NOT a magnitude filter — the score is normalised per symbol, so it is flat across " +
            "six orders of magnitude of money and cannot rank size. It is also effectively a " +
            "BOOLEAN: the engine emits 0.0 or a value in [0.75, 0.95] and nothing between " +
            "(measured over 421,157 production rows, 2026-09-14). Any value in (0, 0.75] " +
            "therefore means the same thing — 'only rows the engine fired on'. Defaults to 0 " +
            "so magnitude decides. Setting this to 0.5 alongside the default $250,000 floor " +
            "returned ZERO rows on the day this was written; the two floors rarely coincide.",
        },
        // Declared 2026-09-11: these were already forwarded to SQL by the
        // dispatch+proxy but invisible in the schema, so no agent could
        // discover the fetch filters. They narrow the SOURCE query, not just
        // the envelope projection.
        symbols: {
          type: ["string", "array"],
          items: { type: "string" },
          description: "Filter to these instruments (comma-separated string or array, max 100). Applied in SQL at the source.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10, description: "Source-side row depth." },
        since: { type: "string", format: "date-time", description: "ISO-8601 lower bound, no more than 7 days ago. Defaults to 24h ago; unparseable values are rejected, never silently defaulted." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        dataOrigin: { type: "string", enum: ["candle_derived_order_flow_proxy"] },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              canonicalInstrumentId: { type: ["string", "null"] },
              assetClass: { type: "string", enum: ["crypto", "equity"] },
              venue: { type: "null", description: "Not persisted by this source; never guessed from the symbol." },
              observedAt: { type: ["string", "null"], format: "date-time" },
              buyVolumeBaseUnits: { type: ["number", "null"] },
              sellVolumeBaseUnits: { type: ["number", "null"] },
              totalVolumeBaseUnits: { type: ["number", "null"] },
              referencePrice: { type: ["number", "null"] },
              netFlowUsd: { type: ["number", "null"], description: "Latest candle-derived rolling imbalance ((buy-sell)*price), not measured capital transfer." },
              direction: { type: "string", enum: ["buy_side", "sell_side", "balanced", "withheld"] },
              directionBasis: { type: "string", enum: ["sign_of_latest_net_flow_proxy", "withheld"] },
              detectionScore: { type: ["number", "null"], description: "Uncalibrated engine score on a 0-1 scale; not a probability." },
              anomalyFlagged: {
                type: "boolean",
                description:
                  "Did the order_flow ENGINE fire on this row, or was it admitted on measured " +
                  "dollar magnitude alone? Count detections from this field, never from the " +
                  "presence of a direction or from the row count.",
              },
              scoreType: { type: "string", enum: ["uncalibrated_order_flow_detection_score"] },
              scoreScale: { type: "string", enum: ["0-1"] },
              isProbability: { type: "boolean", enum: [false] },
              calibrationStatus: { type: "string", enum: ["uncalibrated"] },
              sourceSignal: { type: ["string", "null"] },
              sourceSignalDirection: { type: "string", enum: ["buy_side", "sell_side", "neutral", "unknown"] },
              signalConflict: { type: "boolean" },
              withheldReason: { type: ["string", "null"] },
              observation: { type: "string" },
            },
          },
        },
        count: { type: "integer" },
        qualifyingCount: { type: "integer" },
        notReturned: { type: "array", items: { type: "object" } },
        conflicts: { type: "array", items: { type: "object" } },
        coverage: { type: "object" },
        limitations: { type: "object" },
        evidence: { type: "object" },
        provenance: { type: "object" },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/unusual-money-movement" },
  },
  {
    name: "fahali_get_market_risk_score",
    description:
      "Get Fahali's global market risk score from the canonical 24-hour detection snapshot. This is market-wide context, not institution identity, participant positioning, or portfolio-specific risk. Returns score (0-100), risk level, component breakdown, evidence coverage, and snapshot identity. Observation, not advice.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        score: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        level: { type: ["string", "null"], enum: ["low", "moderate", "high", "critical", null] },
        dataState: { type: "string", enum: ["measured", "no_data", "error"] },
        responseState: { type: "string", enum: ["OK_WITH_FINDINGS", "WITHHELD", "ERROR"] },
        narrative: { type: "string" },
        observations: { type: "array", items: { type: "string" } },
        breakdown: { type: "array", items: { type: "object", properties: { type: { type: "string" }, count: { type: "integer" }, weight: { type: "integer" } } } },
        detectionCount: { type: "integer" },
        snapshotId: { type: ["string", "null"] },
        coverage: {
          type: "integer",
          minimum: 0,
          description: "Number of alert observations represented by the canonical 24-hour market-state snapshot; not a percentage or instrument-universe coverage ratio.",
        },
        lastUpdated: { type: "string", format: "date-time" },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/market/risk" },
  },
  {
    name: "fahali_get_correlation_matrix",
    description:
      "Get a requested-book historical Pearson correlation matrix from Fahali's canonical, timestamp/calendar-aligned 45-day covariance artifact. Pass up to 50 symbols; every requested symbol and unmeasured pair is accounted for. Omit symbols only to use the fixed published BTC/ETH/SPY/QQQ/TLT/GLD reference set. Returns pair observation counts, alignment policies, coverage, source freshness, and a precisely named per-symbol weighted mean peer correlation. It does not claim corr(asset, portfolio), which requires variance data the artifact does not contain. This is measured historical co-movement, not a forecast or a causal contagion edge. Public data — no tier required.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: {
          oneOf: [
            { type: "string", description: "Comma-separated symbols." },
            { type: "array", items: { type: "string" }, minItems: 2, maxItems: 50 },
          ],
          description: "Optional requested book. Omit for Fahali's fixed six-asset reference set.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "partial", "withheld", "error"] },
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "stale", "error"] },
        responseState: { type: "string", enum: ["OK_WITH_FINDINGS", "PARTIAL", "OK_NO_FINDINGS", "WITHHELD", "ERROR"] },
        artifactStatus: { type: "string", enum: ["measured", "unavailable"] },
        reason: {
          type: "string",
          enum: ["invalid_request", "not_found", "query_failed", "stale", "invalid_artifact"],
          description: "Why the canonical covariance artifact was unavailable. Present with every unavailable artifact response.",
        },
        message: {
          type: "string",
          description: "Source-preserved explanation of the unavailable artifact state; never replace it with a calm-market inference.",
        },
        error: {
          type: "string",
          description: "Machine-readable error code on invalid_request, query_failed, invalid_artifact, or transport failures.",
        },
        claim: { type: ["object", "null"] },
        symbols: { type: "array", items: { type: "string" } },
        matrix: { type: "array", items: { type: "array", items: { type: ["number", "null"] } } },
        observations: { type: "array", items: { type: "array", items: { type: ["integer", "null"] } } },
        policies: { type: "array", items: { type: "array", items: { type: ["string", "null"] } } },
        coverage: { type: "array", items: { type: "array", items: { type: ["number", "null"] } } },
        requestedCoverage: { type: "object" },
        perSymbol: { type: "array", items: { type: "object" } },
        basis: { type: ["object", "null"] },
        interpretation: { type: "string" },
        asOf: { type: ["string", "null"] },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/agent/correlation-matrix" },
  },
  {
    name: "fahali_get_market_sentiment",
    description:
      "Get seven days of sentiment alerts and judged sentiment claims. Both lifecycle streams are returned separately and in one chronological history; one never replaces the other. limit applies per source, defaulting to the maximum 200. A verified empty slice means no qualifying claim was recorded — never neutral or calm. Missing score or news count stays null.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Optional trading symbol filter (e.g. 'BTCUSDT'). Omitting returns aggregate market sentiment." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 200, description: "Maximum rows per source. Omit for the maximum 200 live alerts plus 200 judged outcomes; the merged history is never re-truncated." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "error"] },
        responseState: { type: "string" },
        history: { type: "array", items: { type: "object", properties: {
          id: { type: "string" }, claimId: { type: "string" }, recordKind: { type: "string", enum: ["live_alert", "judged_outcome", "resolved_unjudged", "registered_claim"], description: "Lifecycle state, derived per row — never assumed. judged_outcome: a verdict exists. resolved_unjudged: the horizon passed and the judge abstained (chop below the noise floor, or a claim it cannot score) — an outcome, not a verdict. registered_claim: registered, not yet resolved. Until 2026-09-03 every outcome row was labelled judged_outcome unconditionally, while zero sentiment rows in 7 days were judged." }, symbol: { type: ["string", "null"] }, confidence: { type: ["number", "null"] },
          sentimentScore: { type: ["number", "null"] }, source: { type: "string" }, newsCount: { type: ["number", "null"] },
          direction: { type: ["string", "null"] }, timestamp: { type: ["string", "integer", "number"] }, resolvedAt: { type: ["string", "null"] }, correct: { type: ["boolean", "null"] }, dataOrigin: { type: "string" },
        } } },
        count: { type: "integer" },
        sourceHistory: {
          type: "object",
          description: "Unprojected lifecycle streams. Observations and judgments remain distinct even when they share a claimId.",
          properties: {
            liveAlerts: { type: "array", items: { type: "object" } },
            judgedOutcomes: { type: "array", items: { type: "object" } },
          },
        },
        sourceCoverage: {
          type: "object",
          description: "Per-source probe state, returned rows, proven lower-bound availability, projection count, and completeness.",
        },
        historyComplete: { type: "boolean", description: "True only when both source probes completed and neither exceeded its per-source limit." },
        projection: { type: "object", description: "Requested and effective per-source limit; the default is the maximum admitted window." },
        requested: { type: ["array", "null"], items: { type: "string" } },
        measuredWindow: { type: "string" },
        instrumentation: { type: "object" },
        probeErrors: { type: "array", items: { type: "object" } },
        asOf: { type: "string", format: "date-time" },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/sentiment/history" },
  },
  {
    name: "fahali_get_highest_conviction_signals",
    description:
      "Rank current early-warning evidence that clears Fahali's evidence gate. Risk conviction is separate from committee directional evidence, which remains non-binding. Concurrent alert-family count is context, not consensus. The complete committee and canonical-roster packets are returned for reconciliation; canonical_verdict is the sole binding direction authority. Public data.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        decisionAuthority: {
          type: "object",
          description: "Declares this endpoint an evidence ranking and points to canonical_verdict/fahali_get_market_decision as the sole binding direction authority.",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              concurrentAlertFamilies: { type: "integer", description: "CONTEXT, NEVER CONVICTION: count of distinct alert families that co-fired on this symbol (measured 2026-08-05 to be shared-input redundancy, not independent consensus). Ranking runs on forecast-tier evidence, not this number. Formerly named engineCount — that name misled agents into treating it as a conviction score." },
              engines: { type: "array", items: { type: "string" }, description: "Canonical engine keys from the live registry" },
              topType: { type: "string" },
              severity: { type: "string", enum: ["EXTREME", "HIGH", "ELEVATED", "WATCH"] },
              why: { type: "string" },
              action: { type: "string", enum: ["buy", "sell", "neutral"] },
              riskConviction: { type: ["number", "null"], description: "Ordinal stress/setup strength, not a probability and not a direction." },
              directionalConviction: { type: ["number", "null"], description: "Share of reporting committee engines that agree; non-binding." },
              committeeEvidenceDirection: { type: ["string", "null"], description: "Exact committee evidence direction when its publication gate clears. Never the binding market direction." },
              direction: { type: "null", description: "Retired ambiguous compatibility field. Always null so it cannot shadow canonical_verdict." },
              directionRole: { type: "string", enum: ["committee_evidence_non_binding"] },
              bindingAuthority: { type: "string", enum: ["canonical_verdict"] },
              bindingDirection: { type: "null", description: "This evidence-ranking endpoint does not emit the binding direction." },
              committeeDirectionalState: { type: "string", enum: ["EVIDENCE_AVAILABLE", "WITHHELD"] },
              directionalState: { type: "string", enum: ["EVIDENCE_AVAILABLE", "WITHHELD"] },
              committeeCounts: { type: "object" },
              directionalWithheldReason: { type: ["string", "null"] },
              lastTs: { type: "string", format: "date-time" },
            },
          },
        },
        verdicts: {
          type: "array",
          description:
            "Full non-binding Master Analyst committee products. Each includes the complete canonical-roster evidence snapshot and detection-service runtime telemetry; use the canonical verdict for the authoritative direction.",
          items: COMMITTEE_VERDICT_OUTPUT,
        },
        guardrailBlockedCount: {
          type: "integer",
          description: "Verdicts blocked by the Guardrail Agent this cycle (blocked verdicts are never served)",
        },
        asOf: { type: "string", format: "date-time" },
        provenance: {
          type: "object",
          properties: {
            engineCount: { type: "string", enum: ["measured"] },
            engines: { type: "string", enum: ["measured"] },
            severity: { type: "string", enum: ["measured"] },
            why: { type: "string", enum: ["measured"] },
            action: { type: "string", enum: ["proxy"] },
          },
          description: "Data provenance for each response field — engine count and names are measured, action direction is a proxy derived from alert direction signals.",
        },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/insights/conviction" },
  },
  {
    name: "fahali_get_market_snapshot",
    description:
      "Live prices and changes, with asset class, venue and identity. Crypto is the full Binance USDT book; US equities are a small watchlist PLUS any symbol you name in `symbols`, fetched on demand — so an unrequested equity is absent because nobody asked, not because it is quiet. Read `coverage` for what was searched, and `coverage.volume.comparableAcrossBases` before ranking by volume. Public data.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 800, description: "Optional maximum assets to return. Omitting it returns everything this snapshot holds — which is the full Binance USDT book plus a configured US watchlist, NOT every instrument Fahali monitors. Max 800." },
        sort_by: { type: "string", enum: ["symbol", "change", "volume"], description: "Sort field (default symbol). `volume` ranks only rows whose source publishes a volume; rows without one follow in symbol order and are counted in `ordering.rowsUnranked` — their position is not a statement about turnover." },
        compact: { type: "boolean", description: "When true, returns symbol+price+change only (drops volume/assetClass/venue)" },
        asset_class: { type: "string", enum: ["crypto", "us_equity", "us_etf"], description: "Filter by asset class" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        total: { type: "integer" },
        assets: { type: "array", items: { type: "object", properties: {
          symbol: { type: "string" }, canonicalInstrumentId: { type: ["string", "null"], description: "Stable underlying key (BTC, ETH, NVDA...) — quoted-pair variants of the same asset share one identity" }, underlyingId: { type: ["string", "null"], description: "Alias of canonicalInstrumentId" }, price: { type: "number" }, changePct: { type: "number" },
          volume: { type: "number" }, assetClass: { type: "string" }, venue: { type: "string" }, underlying: { type: "string" },
        } } },
        indices: { type: "array", items: { type: "object", properties: { name: { type: "string" }, price: { type: "number" }, changePct: { type: "number" } } } },
        // Emitted by shapeSnapshot (server/lib/snapshotShape.ts) and the route's
        // coverage block. Declared because `volume` ranks only rows whose source
        // publishes one — unranked rows follow in symbol order and their position
        // is not a statement about turnover. (2026-09-11)
        ordering: {
          type: ["object", "null"],
          description: "How the rows were ordered and which rows the sort key could actually rank.",
          properties: {
            field: { type: "string", enum: ["symbol", "change", "volume"] },
            rowsRanked: { type: "integer" },
            rowsUnranked: { type: "integer" },
            note: { type: ["string", "null"] },
          },
        },
        coverage: {
          type: ["object", "null"],
          description: "What was searched (incl. on-demand equity resolution) and whether volume is comparable across bases. Read before ranking by volume.",
          properties: {
            universe: { type: "object" },
            requested: { type: "array", items: { type: "string" } },
            fetchedOnDemand: { type: "array", items: { type: "string" } },
            unavailable: { type: "array", items: { type: "string" } },
            onDemandSkippedReason: { type: ["string", "null"] },
            volume: { type: "object", description: "rowsWithVolume/rowsWithoutVolume, measurement bases, comparableAcrossBases — false means a cross-basis volume ranking is meaningless." },
            freshness: { type: "object" },
          },
        },
        sources: { type: ["object", "null"], description: "Per-source read states (alpaca/coingecko/binance), each measured/pending/not_instrumented — never inferred." },
        dataAsOf: { type: ["string", "null"], format: "date-time" },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/market/snapshot" },
  },
  {
    name: "fahali_get_engine_status",
    description:
      "Get bounded operational health for Fahali's engine roster. Engine identity comes from spectra_signal_outcomes.engine_key; compute liveness comes from subsystem heartbeats; alert publication is a separate diagnostic and never decides health. Seven-day activity comes from a scheduled minute rollup, never a request-path archive scan. Until that rollup has fresh contiguous coverage, the response is PARTIAL and affected counts are null — only a complete empty window earns zero, and a zero count is not proof of silence or failure. A producer with no attributable compute evidence is silence_unclassified, not failed. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "partial", "error"] },
        data_state: { type: "string", enum: ["measured", "partial", "no_data", "error"] },
        asof: { type: "string", format: "date-time" },
        measured_window: { type: "object", description: "Scheduled-rollup coverage, producer freshness, probe failures and count reliability." },
        authority: { type: "object", description: "Distinct authorities for engine identity, compute liveness, and publication diagnostics." },
        registry: { type: "object", description: "Generated cross-repository registry digest and heartbeat-contract validation state." },
        engines: { type: "array", items: { type: "object", properties: {
          key: { type: "string" }, name: { type: "string" }, status: { type: "string" }, data_state: { type: "string" },
          count_1h: { type: ["integer", "null"], description: "Null when the judgment window is unavailable or incomplete; zero only after a complete empty window." },
          count_24h: { type: ["integer", "null"], description: "Null when the judgment window is unavailable or incomplete; zero only after a complete empty window." },
          count_7d: { type: ["integer", "null"], description: "Null when the judgment window is unavailable or incomplete; zero only after a complete empty window." },
          last_fired: { type: ["string", "null"] },
          compute: { type: "object" },
          judgment: { type: "object", properties: {
            registrations_1h: { type: ["integer", "null"] }, registrations_24h: { type: ["integer", "null"] }, registrations_7d: { type: ["integer", "null"] },
            resolutions_24h: { type: ["integer", "null"] }, resolutions_7d: { type: ["integer", "null"] },
            last_registered_at: { type: ["string", "null"] }, last_resolved_at: { type: ["string", "null"] }, data_state: { type: "string" },
          } },
          publication: { type: "object", properties: {
            alerts_1h: { type: ["integer", "null"] }, alerts_24h: { type: ["integer", "null"] }, alerts_7d: { type: ["integer", "null"] },
            last_published_at: { type: ["string", "null"] }, data_state: { type: "string" }, attribution: { type: "string" },
          } },
          interpretation: { type: "string" },
        } } },
        market_context: { type: "object" },
        attribution: { type: "object", properties: {
          alerts_7d_total: { type: ["integer", "null"] }, alerts_7d_attributed: { type: ["integer", "null"] },
          alerts_7d_unattributed: { type: ["integer", "null"] }, alerts_7d_mixed_bucket: { type: ["integer", "null"] },
          unattributed_pct: { type: ["number", "null"] }, no_alerts_in_window: { type: ["boolean", "null"] },
          alert_types_known: { type: "integer" }, note: { type: "string" },
        } },
        unmapped_alert_types: { type: ["array", "null"], items: { type: "object" } },
        unmatched_subsystem_heartbeats: { type: "array", items: { type: "object" } },
        probe_errors: { type: "array", items: { type: "object" } },
        agent_authored_excluded: { type: "object", properties: {
          alerts_7d: { type: ["integer", "null"] }, distinct_types_7d: { type: ["integer", "null"] }, note: { type: "string" },
        } },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/engines/status" },
  },
  {
    name: "fahali_get_case_studies",
    description:
      "Get verified case studies from the resolved signal-outcome moat. Returns 40 time-diverse cases with: symbol, alert type, confidence, direction (bullish/bearish/neutral), entry price, outcome price, profit/loss percent, correctness boolean, outcome kind (direction/magnitude/volatility/crash_catch), and 4h/24h returns. Covers the walk_forward engine.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        cases: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, alertType: { type: "string" }, confidence: { type: "number" }, direction: { type: "string" }, entryPrice: { type: "number" }, outcomePrice: { type: "number" }, profitPct: { type: "number" }, correct: { type: "boolean" }, outcomeKind: { type: "string" }, ret4h: { type: "string" }, ret24h: { type: "string" } } } },
        total: { type: "integer" },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/case-studies" },
  },
  /* ──────────────────────────────────────────────────────────────────────────
     THE WHOLE READ SURFACE — two tools, not 168.

     Measured 2026-09-05: 282 routes registered, 45 named by tools, and 168 GET
     routes carrying real data reachable from no tool at all. Writing a tool per
     route would produce a catalogue no agent can navigate and a roster to
     maintain by hand — which is how `openapi.json` came to describe 17 paths
     out of 282. These two read a catalogue the API derives from its own live
     router, so the surface cannot drift from what is actually registered.
     ────────────────────────────────────────────────────────────────────────── */
  {
    name: "fahali_list_resources",
    description:
      "List every readable Fahali resource, derived from the live API router rather than a hand-maintained list. "
      + "Each entry gives its path, parameters, and the gates it enforces, so you see what a route requires before "
      + "calling. Excluded routes are returned with reasons. Discover here, then call fahali_fetch_resource. "
      + "Purpose-built tools stay better when one covers your question.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        resources: { type: "array", items: { type: "object", properties: {
          method: { type: "string" }, path: { type: "string" },
          params: { type: "array", items: { type: "string" } },
          gates: { type: "array", items: { type: "object" } },
          publicRead: { type: "boolean" },
        } } },
        excluded: { type: "array", items: { type: "object", properties: {
          method: { type: "string" }, path: { type: "string" }, reason: { type: "string" },
        } } },
        counts: { type: "object" },
        basis: { type: "string" },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/resources" },
  },
  {
    name: "fahali_fetch_resource",
    description:
      "Fetch any catalogued Fahali resource by path. The path must come from fahali_list_resources: catalogued "
      + "paths only, never arbitrary URLs and never write routes. Supply :params via path_params, filters via query. "
      + "Listed does not mean entitled — a gated resource still returns its own refusal, which describes your "
      + "credential, not the data.",
    inputSchema: {
      type: "object",
      properties: {
        resource: { type: "string", description: "Exact path from fahali_list_resources, e.g. /api/situations or /api/symbol-judgment/:symbol" },
        path_params: { type: "object", description: "Values for :params in the path, e.g. { symbol: \"BTCUSDT\" }" },
        query: { type: "object", description: "Query-string filters the resource accepts." },
      },
      required: ["resource"],
    },
    outputSchema: { type: "object", properties: {} },
    _meta: { requiredTier: "free", endpoint: "/api/resources" },
  },
  {
    name: "fahali_get_track_record_scorecard",
    /**
     * 🔴 REWRITTEN 2026-08-14 alongside the magnitude-lift retraction.
     *
     * The old text promised "each with base-rate lift" and "includes blended
     * aggregate", then closed with "Do NOT cite raw percentages without the base
     * rate lift." After the retraction three of the four axes carry no lift and
     * there is no blended aggregate — which made that closing line an
     * UNSATISFIABLE INSTRUCTION. A model told it must cite lift, handed a
     * precision and a base rate, reconstructs the retracted number and believes
     * it is obeying us. On a third-party host the renderer has no doctrine; the
     * tool description is the only guidance it gets, so a stale description is
     * not documentation debt, it is an instruction to fabricate.
     *
     * The rule below is therefore stated so it can always be obeyed: read
     * `publishable`, and if a row withholds its lift, say so.
     */
    description:
      "Per-engine track record, by axis, from the judged outcome ledger. DIRECTION rows carry accuracy plus base-rate lift. MAGNITUDE, VOLATILITY and EXTREME_EVENTS rows carry precision but NO lift and NO base rate: they are served with `lift: null`, `baseRate: null`, `publishable: false` and a `withheld` object explaining why, because the only available denominator is unconditional on each engine's own trigger and would flatter any engine that fires on already-moving tape. There is no blended score. HOW TO READ IT: branch on each row's `publishable` flag, never on the percentage. If `publishable` is false, do not quote that engine's number at all — report that the record is withheld and give the row's `withheld.reason`. Do NOT compute a lift yourself from `precision` and any base rate found elsewhere in the payload; that reproduces a claim Fahali has retracted.",
    inputSchema: { type: "object", properties: {} },
    /**
     * The old schema described `axes.{direction,magnitude,volatility,crashCatch}`
     * with scalar members. The endpoint has never served that shape — the axes
     * are TOP-LEVEL maps keyed by engine key. A schema that disagrees with the
     * response is the silent-accept defect class: it teaches a consumer to look
     * where nothing is.
     */
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        methodology: { type: "object" },
        direction: {
          type: "object",
          description: "Map of engine key -> row. Accuracy WITH lift; read `publishable`.",
          additionalProperties: {
            type: "object",
            properties: {
              accuracy: { type: "number" },
              baseRate: { type: ["number", "null"] },
              lift: { type: ["number", "null"] },
              total: { type: "integer" },
              effectiveSample: { type: ["integer", "null"] },
              ci95: { type: "object" },
              publishable: { type: "boolean" },
              withheld: { type: ["object", "null"] },
            },
          },
        },
        magnitude: {
          type: "object",
          description: "Map of engine key -> row. Precision only; lift and baseRate are ALWAYS null and publishable is ALWAYS false.",
          additionalProperties: {
            type: "object",
            properties: {
              precision: { type: "number" },
              baseRate: { type: "null" },
              lift: { type: "null" },
              total: { type: "integer" },
              effectiveSample: { type: ["integer", "null"] },
              ci95: { type: "object" },
              publishable: { type: "boolean" },
              withheld: { type: "object", properties: { reason: { type: "string" }, requiredMeasurement: { type: "string" } } },
            },
          },
        },
        volatility: { type: "object", description: "Same contract as magnitude." },
        extreme_events: { type: "object", description: "Same contract as magnitude." },
        blended: {
          type: "object",
          description: "Components only. `blended_score` is ALWAYS null — a single composite accuracy figure is not a supported claim.",
          properties: {
            directional_accuracy: {
              type: ["number", "null"],
              description: "Verified-only directional component. Null when no identity-valid, final judged rows exist; never coerced to zero.",
            },
            magnitude_precision: {
              type: ["number", "null"],
              description: "Verified-only magnitude component. Null when no identity-valid, final judged rows exist; never coerced to zero.",
            },
            blended_score: { type: "null" },
            withheld: { type: "object" },
          },
        },
        base_rates: { type: "object" },
        base_rates_by_horizon: { type: "object" },
        data_window: { type: "object" },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/track-record/scorecard" },
  },
  {
    name: "fahali_get_portfolio_metrics",
    description:
      "Get aggregate portfolio risk metrics. Returns sentiment momentum (bullish vs bearish signal balance), cascade risk score, liquidity stress score, and signal stress level (derived from leverage/derivative signal confidences). Synthesizes data from leverage, funding_stress, and volume_anomaly engines.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        cascadeRisk: { type: ["number", "null"], description: "0-1 cascade risk from crash/liquidation signal confidences. NULL when no crash/liquidation signals exist in the window — null means 'not computed', never 'calm' (see cascadeRiskReason)." },
        cascadeRiskReason: { type: "string", description: "Why cascadeRisk is null (present only when it is)." },
        liquidityStress: { type: ["number", "null"], description: "0-1 from liquidity/funding signals. NULL when no liquidity signals exist in the window — null means 'not computed', never 'calm' (see liquidityStressReason)." },
        liquidityStressReason: { type: "string", description: "Why liquidityStress is null (present only when it is)." },
        signalStressLevel: { type: ["number", "null"], description: "0-1 from leverage/derivative signal confidences. NULL when no leverage/derivative signals exist in the window — null means 'not computed', never 'calm' (see signalStressLevelReason)." },
        signalStressLevelReason: { type: "string", description: "Why signalStressLevel is null (present only when it is)." },
        sentimentMomentum: { type: ["number", "null"], description: "-1..1 net signal direction. NULL when no sentiment-tagged signals exist in the window — a null here is 'no view measured', never a claimed balance (see sentimentMomentumReason)." },
        sentimentMomentumReason: { type: "string", description: "Why sentimentMomentum is null (present only when it is)." },
        signalCount: { type: "integer", description: "Number of alert/institutional-signal rows the metrics were computed over. 0 means the feed was empty and every metric is null." },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/portfolio/metrics" },
  },
  {
    name: "fahali_get_market_regime",
    description:
      "One market-wide regime reading: bullish, bearish, neutral_range_bound or high_volatility, with volatility, trend strength and window return. This endpoint is market-wide only and a symbol filter cannot narrow it; per-symbol regime exists via fahali_get_realtime_alerts(alert_types: 'regime_state'). The direction word the producer emits is withheld with its reason; read trendStrength. Empty array when nothing is persisted. Observation, not advice.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        regimes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              regime: {
                type: ["string", "null"],
                enum: ["bullish", "bearish", "neutral_range_bound", "high_volatility", null],
                description:
                  "The producer's four regimes (SPECTRA_MARKET_REGIME_DETECTOR.py). This previously declared 'neutral' and 'high_vol', two names the producer has never emitted, while the two it actually emits most were undeclared: over 30 days 917 of 1,346 readings (68.1%) carried a label this contract did not list.",
              },
              regimeIsDeclared: { type: "boolean", description: "False when the producer emits a label outside the declared set, rather than passing it through as if declared." },
              declaredRegimeValues: { type: "array", items: { type: "string" } },
              volatility: { type: ["string", "number", "null"] },
              trend: {
                type: "null",
                description:
                  "Always null: WITHHELD, not absent. The producer derives this word from trendStrength with a +/-0.02 bar while the largest observed |trendStrength| is 0.0012, so 'up' and 'down' are unreachable and the label was the constant 'sideways' on 1,346 of 1,346 readings - including every bearish and bullish one. Read trendStrength.",
              },
              trendWithheldReason: { type: "string" },
              producerTrendLabel: { type: ["string", "null"], description: "The raw string the producer emitted, kept for audit. Not a measurement." },
              trendStrength: { type: ["number", "null"], description: "Normalised slope per period as a fraction of price - the real varying measurement the withheld word was meant to summarise." },
              producerConfidence: { type: ["number", "null"], description: "Reported 1.0 on every row measured over 7 days. Published so its constancy is visible; it is not a calibrated confidence and must not rank or gate anything." },
              return: { type: "number" },
            },
          },
        },
        count: { type: "integer" },
        timestamp: {
          type: ["string", "integer"],
          format: "date-time",
          description: "Observation timestamp. Current API responses use ISO-8601; integer epoch values remain accepted for compatibility with older persisted rows.",
        },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/temporal/regimes" },
  },
  {
    name: "fahali_get_market_mood",
    description:
      "How fearful or greedy prices are, scored 0-100 separately for US stocks and crypto. Each measured price fact (trend vs 50-day average, breadth, volatility, safe-haven and junk-bond demand, alt appetite) is ranked against its own past; read `ranked` beside any percentile. Unreadable measures are null with a reason, never a neutral 50. A description, not a forecast or a grade. Observation, not advice.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["observation"] },
        isForecast: { type: "boolean", enum: [false] },
        calibrated: { type: "boolean", enum: [false] },
        method: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        equity: MOOD_READING_SCHEMA,
        crypto: MOOD_READING_SCHEMA,
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/market/mood" },
  },
  {
    name: "fahali_get_sector_rotation",
    description:
      "Where market leadership is moving: US sectors vs the S&P 500, major coins vs Bitcoin, and Bitcoin, gold and bonds vs the S&P 500. Each member is leading, weakening, lagging or improving by its relative return over a short and a long window, with how unusual the recent move is. Relative price performance, not money flow, not a forecast. Observation, not advice.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["observation"] },
        basis: { type: "string", enum: ["relative_price_performance"] },
        measuresMoneyFlow: { type: "boolean", enum: [false], description: "Always false: no volume history long enough to say dollars moved. Never restate a leadership change as money moving." },
        isForecast: { type: "boolean", enum: [false] },
        calibrated: { type: "boolean", enum: [false] },
        method: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", enum: ["us_sectors", "crypto", "cross_asset"] },
              title: { type: "string" },
              benchmark: { type: "string" },
              benchmarkName: { type: "string" },
              window: { type: "object", properties: { short: { type: "integer" }, long: { type: "integer" }, unit: { type: "string", enum: ["sessions", "days"] } } },
              state: { type: "string", enum: ["measured", "unavailable"] },
              reason: { type: ["string", "null"] },
              asOf: { type: ["string", "null"] },
              provisional: { type: "boolean" },
              headline: {
                type: ["string", "null"],
                description: "Names a turn only when the move is outside the middle half of that member's own history; otherwise says there is no clear turn. Prefer it over inferring turns from quadrant signs, which flip on noise.",
              },
              rows: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    name: { type: "string" },
                    quadrant: { type: "string", enum: ["leading", "weakening", "lagging", "improving"] },
                    relShort: { type: "number", description: "Member return minus benchmark return over the short window, as a fraction." },
                    relLong: { type: "number" },
                    retShort: { type: "number" },
                    retLong: { type: "number" },
                    unusual: {
                      type: ["object", "null"],
                      description: "Percentile of relShort among this member's own earlier short-window relative moves (higher = stronger vs benchmark), and how many it was ranked against.",
                      properties: { percentile: { type: "integer" }, against: { type: "integer" }, since: { type: "string" } },
                    },
                  },
                },
              },
              excluded: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, reason: { type: "string" } } } },
            },
          },
        },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/market/rotation" },
  },
  {
    name: "fahali_get_visual_intelligence",
    // Rewritten 2026-07-31. The previous description said "all 18 detection
    // engines" and "Covers ALL 18 engines" — an engine count is never publishable,
    // and a tool description is read verbatim by models and republished by MCP
    // directories. It also advertised "ETF exposure, gamma exposure, institutional
    // flow", none of which we measure: there is no options feed and no positioning
    // feed. The fields are now named for what they are, and the description says
    // what the numbers are derived from so an agent cannot mistake them for
    // measured microstructure.
    description:
      "Get the market constellation — a graph snapshot of instruments currently flagged by the detection fleet. Returns nodes (symbol, radius, glow intensity, status, stress, flow proxy, stress band, direction bias, trigger event), inferred inter-node flows (source, target, value, velocity), cluster metadata (active, intensity, proximity, label), an overall state, and market context. Values are DERIVED FROM detection-engine confidence and alert type — not from measured order flow, options data, or institutional positioning. Observation only: `state` is one of CLEAR / WATCH / REVIEW / URGENT and is never an instruction to trade. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        // Names now match what the endpoint actually emits. The previous schema
        // declared etfExposure / gammaExposure / institutionalFlow / signalStrength,
        // none of which the payload ever contained — so an agent trusting the
        // schema read undefined on every one of them. A schema that does not match
        // the response is worse than no schema.
        nodes: { type: "array", items: { type: "object", properties: { id: { type: ["string", "number", "null"] }, radius: { type: "number" }, glowIntensity: { type: "number" }, status: { type: ["string", "number", "null"] }, stress: { type: "number" }, flowProxy: { type: "number" }, stressBand: { type: ["string", "null"] }, directionBias: { type: ["string", "null"] }, trigger: { type: ["string", "number", "null"] } } } },
        flows: { type: "array", items: { type: "object", properties: { source: { type: ["string", "number", "null"] }, target: { type: ["string", "number", "null"] }, value: { type: "number" }, velocity: { type: ["string", "number", "null"] }, color: { type: ["string", "null"] } } } },
        vortex: { type: "object", properties: { active: { type: "boolean" }, intensity: { type: "number" }, gravitationalPull: { type: ["string", "number", "null"] }, label: { type: ["string", "number", "null"] } } },
        /** CLEAR | WATCH | REVIEW | URGENT. Never an instruction to trade. */
        state: { type: ["string", "null"] },
        marketContext: { type: ["string", "number", "null"] },
        dataOrigin: { type: ["string", "null"] },
        disclaimer: { type: ["string", "null"] },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/spectra/visual-intelligence" },
  },
  {
    name: "fahali_get_realtime_alerts",
    description:
      "Get the realtime detection feed, clustered by (symbol, thesis). FILTER AT SOURCE: pass `symbols` to ask what is firing on specific instruments, `alert_types` to ask for one kind of detection, `since` for a time range, `max_rows` for depth. An UNFILTERED call returns only the newest `max_rows` of a feed that carries hundreds of thousands of alerts a day across thousands of symbols — that is a slice of seconds, not a survey, so narrow it before concluding anything about a named instrument. Every cap is reported in `coverage`: `coverage.matched` is how many alerts actually match your filter in the window, `coverage.returned` is how many this response carries, and `coverage.truncations` names each lossy stage. When `coverage.sourceTruncated` is false, an empty result IS a measured absence for that filter; when it is true, absence here is not evidence of absence. Each cluster's `detectionConfidence` is the engine's RAW detection confidence (0-1), NOT a calibrated hit probability or actionability — null when the alert carries none (never a fabricated 0.5). An alert is an observation, not a verdict: for judged reliability use fahali_get_track_record_scorecard, for the arbitrated read use fahali_get_market_verdict.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: {
          type: ["string", "array"],
          items: { type: "string" },
          description: "Filter to these instruments, comma-separated string or array (max 50). Applied in SQL at the source, not as a projection over an already-truncated page.",
        },
        alert_types: {
          type: ["string", "array"],
          items: { type: "string" },
          description: "Filter to these alert types, comma-separated string or array (max 20). Case-insensitive, e.g. regime_state, momentum_shift, crash_precursor.",
        },
        since: {
          type: "string",
          format: "date-time",
          description: "ISO-8601 lower bound. Defaults to 24h ago; clamped to the 24h window this endpoint serves, and the clamp is reported in coverage.clamps. An unparseable value is REJECTED, never silently defaulted.",
        },
        max_rows: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "Source-side fetch depth (default 200, ceiling 1000). DISTINCT from the envelope's `limit`, which only projects the rows already returned — raising `limit` cannot reach evidence `max_rows` did not fetch.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        clusters: { type: "array", items: { type: "object", properties: {
          symbol: { type: "string" },
          thesis: { type: "string", description: "Engine/alert type driving this cluster" },
          detectionConfidence: { type: ["number", "null"], description: "Raw engine detection confidence (0-1) — NOT a calibrated probability; null if absent." },
          firstSeen: { type: "string" },
          lastSeen: { type: "string" },
          evidence: { type: "array", items: { type: "object", properties: {
            alertType: { type: "string" }, severity: { type: "string" }, message: { type: "string" },
          } } },
        } } },
        confidenceBasis: { type: "string", description: "raw_engine_detection_confidence" },
        // Emitted by the upstream (routes.ts /api/spectra/realtime coverage
        // block). Declared because this is the field that distinguishes a
        // measured absence from a truncated one: when `sourceTruncated` is
        // false an empty result IS a measured absence for the filter; when
        // true, absence here is not evidence of absence. (2026-09-11)
        coverage: {
          type: ["object", "null"],
          description: "Filter accounting: what matched vs what this response carries, every lossy stage named, clamps and unknown params reported.",
          properties: {
            filter: { type: "object" },
            matched: { type: "object", description: "{alerts, symbols} existing under this filter — not what was returned." },
            returned: { type: "object", description: "{alerts, symbols, signals, clusters} actually carried." },
            delivered: { type: "object" },
            sourceTruncated: { type: "boolean" },
            truncations: { type: "array", items: { type: "object" } },
            clamps: { type: "array", items: { type: "object" } },
            unknownParams: { type: "array", items: { type: "string" } },
            acceptedParams: { type: "array", items: { type: "string" } },
            completenessNote: { type: "string" },
          },
        },
        signals: { type: "array", items: { type: "object" } },
        alert_count: { type: "integer" },
        signal_count: { type: "integer" },
        timestamp: { type: ["string", "integer", "number"] },
        status: { type: "string", enum: ["ACTIVE", "MONITORING", "ERROR"] },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/api/spectra/realtime" },
  },
  {
    name: "fahali_get_portfolio_risk",
    description:
      "Use this for measured risk, concentration, diversification, VaR/expected shortfall, and shock sensitivity on connected accounts. Per-position alert scores are explicitly non-binding monitoring observations. Direction is reconciled to the canonical symbol verdict; portfolio actionability is withheld, and fahali_get_portfolio_decision adds stored monitoring thresholds without becoming recommendation, portfolio-action, order, or execution authority. Includes the requested-book canonical covariance projection and pair coverage.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        portfolio: { type: "object", properties: {
          totalValue: { type: "number" },
          totalValueMetric: { type: "object" },
          grossExposure: { type: "number" },
          grossExposureMetric: { type: "object" },
          leverage: { type: ["number", "null"] },
          cashBalance: { type: "number" },
          overallRiskScore: { type: ["number", "null"], description: "0-1 scale; null when detection evidence does not cover the book." },
          overallRiskLevel: { type: ["string", "null"] },
          expectedDrawdownPct: { type: ["number", "null"] },
          valueAtRisk95: { type: ["number", "null"] },
          expectedShortfall95: { type: ["number", "null"], description: "Expected shortfall at 95% in currency, positive for a loss. Reported in dollars as well as percent because the percent field is rounded at 0.01pp." },
          expectedShortfallAttribution: { type: ["object", "null"], description: "Which holdings the expected shortfall is attributable to. Contributions are SIGNED, so a hedge that pays in the tail reports a negative number; componentSumDollars equals the reported expected shortfall exactly. Null when the figures are null." },
          varBacktest: { type: ["object", "null"], description: "Out-of-sample coverage test of the VaR quantile (Kupiec + Christoffersen), with the sample size stated. 'not_rejected' means the sample did not contradict the model, never that it is correct. Tests the quantile only, not expected shortfall." },
          riskMetricsBasis: { type: "object" },
        } },
        positions: { type: "array", items: { type: "object", properties: {
          symbol: { type: "string" },
          riskScore: { type: ["number", "null"] },
          weightedMeanPeerCorrelation: { type: ["number", "null"], description: "Gross-weighted mean of measured pairwise Pearson correlations to peer holdings; not corr(asset, portfolio return)." },
          correlationToPortfolio: { type: "null", description: "Always null: the artifact has pair correlations but not the variances/covariances required for corr(asset, portfolio return)." },
          correlationToPortfolioUnavailableReason: { type: "string" },
          correlationBasis: { type: "object" },
          riskObservation: { type: "object" },
          authorityReconciliation: { type: "object", description: "Canonical-symbol direction plus explicitly withheld stateless portfolio actionability and non-binding compatibility monitoring." },
          recommendation: { type: ["object", "null"], description: "Deprecated compatibility monitoring label; never a direction or authorized action.", properties: {
            action: { type: "string", enum: ["hold", "watch", "reduce"] },
            rationale: { type: "string" },
            binding: { type: "boolean", enum: [false] },
            directional: { type: "boolean", enum: [false] },
            deprecatedSemantics: { type: "string", enum: ["monitoring_priority_only"] },
          } },
        } } },
        decisionAuthority: { type: "object" },
        correlation: { type: "object" },
        contagionRisk: { type: "object" },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "elite", endpoint: "/agent/portfolio-risk", method: "GET" },
  },
  {
    name: "fahali_analyze_custom_portfolio",
    description:
      "Analyze measured risk for a custom inline portfolio. Returns historical VaR/expected shortfall, detection-risk observations, canonical direction reconciliation, and a requested-book covariance matrix with per-position correlation coverage. It does not apply stored monitoring thresholds; legacy hold/watch/reduce labels are non-binding monitoring priority only. fahali_get_portfolio_decision adds durable thresholds but remains monitor-only and cannot authorize portfolio or order action.",
    inputSchema: {
      type: "object",
      properties: {
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Trading symbol (e.g. 'BTCUSDT')." },
              market_value: { type: "number", description: "Current market value in USD." },
              quantity: { type: "number", description: "Number of units held (optional)." },
              avg_cost: { type: "number", description: "Average cost basis (optional)." },
              side: { type: "string", enum: ["long", "short"], description: "Position side (default 'long')." },
            },
            required: ["symbol", "market_value"],
          },
          description: "Array of positions to analyze. At least 1 required.",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          // The "$10k equal-weight" promise this carried until 2026-08-27 was
          // stale by three weeks: the runtime stopped fabricating position
          // sizes on 2026-08-06 (routes.ts, `hasExposure` branch) precisely
          // because an invented book produces invented portfolio dollars. The
          // runtime was right and the schema was lying — an agent reading this
          // planned around weights that never existed.
          description:
            "Alternative to positions: comma-separated symbol names. NO position sizes are assumed — " +
            "you get per-symbol observations only, and every portfolio-level figure is withheld as " +
            "uncomputable. Supply `positions` with market_value for book-level risk.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        portfolio: { type: "object", properties: {
          totalValue: { type: ["number", "null"] },
          totalValueMetric: { type: "object" },
          grossExposure: { type: ["number", "null"] },
          grossExposureMetric: { type: "object" },
          leverage: { type: ["number", "null"] },
          cashBalance: { type: ["number", "null"] },
          netExposure: { type: ["number", "null"] },
          fullyHedged: { type: ["boolean", "null"] },
          overallRiskScore: { type: ["number", "null"], description: "0-1 scale; null without sized exposure and measured evidence." },
          overallRiskLevel: { type: ["string", "null"] },
          expectedDrawdownPct: { type: ["number", "null"] },
          valueAtRisk95: { type: ["number", "null"] },
          expectedShortfall95: { type: ["number", "null"], description: "Expected shortfall at 95% in currency, positive for a loss. Reported in dollars as well as percent because the percent field is rounded at 0.01pp." },
          expectedShortfallAttribution: { type: ["object", "null"], description: "Which holdings the expected shortfall is attributable to. Contributions are SIGNED, so a hedge that pays in the tail reports a negative number; componentSumDollars equals the reported expected shortfall exactly. Null when the figures are null." },
          varBacktest: { type: ["object", "null"], description: "Out-of-sample coverage test of the VaR quantile (Kupiec + Christoffersen), with the sample size stated. 'not_rejected' means the sample did not contradict the model, never that it is correct. Tests the quantile only, not expected shortfall." },
          riskMetricsBasis: { type: "object" },
        } },
        positions: { type: "array", items: { type: "object", properties: {
          symbol: { type: "string" },
          riskScore: { type: ["number", "null"] },
          weightedMeanPeerCorrelation: { type: ["number", "null"], description: "Mean of measured pairwise Pearson correlations to requested peers, gross-weighted when position sizes are supplied; not corr(asset, portfolio return)." },
          correlationToPortfolio: { type: "null", description: "Always null: the artifact has pair correlations but not the variances/covariances required for corr(asset, portfolio return)." },
          correlationToPortfolioUnavailableReason: { type: "string" },
          correlationBasis: { type: "object" },
          riskObservation: { type: "object" },
          authorityReconciliation: { type: "object", description: "Canonical-symbol direction plus explicitly withheld stateless portfolio actionability and non-binding compatibility monitoring." },
          recommendation: { type: ["object", "null"], description: "Deprecated compatibility monitoring label; never a direction or authorized action.", properties: {
            action: { type: "string", enum: ["hold", "watch", "reduce"] },
            rationale: { type: "string" },
            binding: { type: "boolean", enum: [false] },
            directional: { type: "boolean", enum: [false] },
            deprecatedSemantics: { type: "string", enum: ["monitoring_priority_only"] },
          } },
        } } },
        decisionAuthority: { type: "object" },
        correlation: { type: "object" },
        contagionRisk: { type: "object" },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: { requiredTier: "elite", endpoint: "/agent/portfolio-risk", method: "POST" },
  },
  {
    name: "fahali_get_contagion_map",
    description:
      "Read the latest one-hour lower-tail-dependence association graph together with the measured temporal layer over it. Edge source→target preserves the producer's reference orientation and carries no temporal meaning; it does not prove causal transmission. Where a pair is also present in the directed lead-lag graph the edge carries a measured lagHours, leadSymbol and leadAsymmetry — temporal precedence, NOT causation, since both instruments may be following something this graph never sees. Read measurement.edgesWithMeasuredLag against the number of edges returned before generalising: association edges and lead-lag edges are different graphs and most pairs carry no measured lag. When the lead-lag producer has written nothing, lagMeasured is false and every lagHours is null. `propagation` is the answer to where stress STARTS (origination score = lead-minus-follow asymmetry over their sum, gated at three distinct followers so a single edge cannot score a perfect 1.000), where it travels NEXT, and WHEN it arrives (cumulative tested lag along the earliest-arrival path). Every arrival carries basis 'measured' or 'composed': a composed arrival sums lags that were never tested together, because lead-lag is not transitive, so read the basis before quoting an hour, and lagOffGrid marks a total that is not one of the tested lags. symbolsEligible against the graph symbol count is the coverage the origins were found within — the graph is a subset of the eligible universe, not all of it. sampleSize is the pair's recurrence count in the scan window, not the estimator sample size. High/extreme labels require at least six recurrences; thinner strong coefficients remain visible with severity capped and evidenceStrength=thin. This is a global reference graph; use fahali_get_correlation_matrix for requested-book Pearson coverage.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "partial", "error"] },
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "error"] },
        responseState: { type: "string", enum: ["OK_WITH_FINDINGS", "PARTIAL", "OK_NO_FINDINGS", "ERROR"] },
        claim: { type: ["object", "null"] },
        nodes: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, canonicalInstrumentId: { type: ["string", "null"], description: "Stable underlying key (BTC, ETH, NVDA...) — quoted-pair variants of the same asset share one identity" }, underlyingId: { type: ["string", "null"], description: "Alias of canonicalInstrumentId" }, riskScore: { type: "number" }, riskLevel: { type: "string" }, confidence: { type: "number", description: "Detector strength on a 0-1 scale; not a calibrated probability." } } } },
        edges: { type: "array", items: { type: "object", properties: { source: { type: "string" }, target: { type: "string" }, strength: { type: "number", description: "Latest lower-tail-dependence coefficient after the materiality gate." }, correlation: { type: "number", description: "Compatibility alias of strength; this is lower-tail dependence, not ordinary Pearson correlation." }, confidence: { type: "number", description: "Compatibility alias of strength; not a calibrated probability." }, lagHours: { type: ["number", "null"], description: "Measured transmission lag in hours from the directed lead-lag graph, present only when this pair was measured there; null otherwise. Temporal precedence, not causation." }, leadSymbol: { type: ["string", "null"], description: "The end measured to move FIRST. This is temporal precedence and NOT causation: the leader may not be moving the follower at all, and both may be following a third instrument this graph never sees. Present only alongside a non-null lagHours; unrelated to the source/target orientation, which is the producer row order." }, leadAsymmetry: { type: ["number", "null"], description: "Lead-lag asymmetry in units of its own standard error. Higher means the ordering is better separated from noise." }, sampleSize: { type: "integer", description: "Pair recurrence count in the one-hour scan window, not estimator observations." }, evidenceStrength: { type: "string", enum: ["thin", "repeated"] }, strengthSeverity: { type: "string", enum: ["low", "moderate", "high", "extreme"], description: "Coefficient-only band before recurrence publication gating." }, severityGateApplied: { type: "boolean" }, severity: { type: "string", enum: ["low", "moderate", "high", "extreme"], description: "Published band; high/extreme requires at least six recurrences." } } } },
        clusters: { type: "array", items: { type: "object", properties: { symbols: { type: "array", items: { type: "string" } }, riskLevel: { type: "string" }, leadSymbol: { type: "string", description: "Present only when stored edge orientation clears the out-degree margin; not a causal lead claim." }, leadOutDegree: { type: "integer" }, runnerUpOutDegree: { type: "integer" }, edgeCount: { type: "integer" } } } },
        propagation: {
          type: ["object", "null"],
          description: "Where stress starts, where it travels next, and when it arrives. Null when the lead-lag producer has not written it yet \u2014 which is NOT the same as an empty origins array, which means the graph was read and no symbol cleared the bar.",
          properties: {
            origins: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  origin: { type: "string" },
                  originationScore: { type: ["number", "null"], description: "(out-asymmetry minus in-asymmetry) over their sum, in [-1, 1]. Null when the symbol has no edges at all, never 0.0 \u2014 a refusal is not a balanced score." },
                  outDegree: { type: "integer" },
                  inDegree: { type: "integer" },
                  downstreamCount: { type: "integer" },
                  arrivals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        symbol: { type: "string" },
                        arrivalHours: { type: "number", description: "Cumulative tested lag along the earliest-arrival path." },
                        path: { type: "array", items: { type: "string" } },
                        basis: { type: "string", enum: ["measured", "composed"], description: "measured = one directed edge tested at this lag. composed = a multi-hop sum that was never tested as a whole; lead-lag is not transitive." },
                        lagOffGrid: { type: "boolean", description: "True when arrivalHours is not one of the lags the producer tested." },
                        weakestAsymmetry: { type: "number", description: "MINIMUM asymmetry along the path, never the mean \u2014 a chain is as strong as its weakest link." },
                        directLagHours: { type: ["number", "null"] },
                        agreesWithDirect: { type: ["boolean", "null"], description: "False where a composed estimate contradicts a directly measured edge between the same pair." },
                      },
                    },
                  },
                },
              },
            },
            symbolsInGraph: { type: "integer" },
            symbolsWithMeasuredScore: { type: "integer" },
            symbolsWithoutEdges: { type: "integer" },
            minOriginEdges: { type: "integer", description: "Distinct-follower bar an origin must clear. Below it a ratio cannot tell one edge from a hundred." },
            reason: { type: ["string", "null"] },
          },
        },
        symbolsEligible: { type: ["integer", "null"], description: "Symbols eligible for the lead-lag pass. The graph covers a SUBSET; publishing the origins without this implies universe-wide coverage." },
        measurement: { type: "object" },
        provenance: { type: "object" },
        error: { type: "string" },
        message: { type: "string" },
      },
    },
    _meta: { requiredTier: "elite", endpoint: "/agent/contagion" },
  },
  {
    name: "fahali_get_capital_flow",
    description:
      "Latest measured 60-minute USD order-flow imbalance for one, several, or the strongest available instruments. netFlowUsd remains available when the detector score is zero because measurement presence and unusualness are separate facts. This is a candle-derived proxy, not exchange aggressor tape, fund flow, participant identity, or a forecast.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Optional single instrument. Base aliases such as BTC resolve transparently to a preferred quoted pair and the resolution is returned.",
        },
        // Declared 2026-09-11: already forwarded to SQL by dispatch+proxy but
        // invisible here. They narrow the SOURCE query (max 100 symbols, 7-day
        // window), not just the envelope projection.
        symbols: {
          type: "string",
          description: "Optional comma-separated instruments (max 100). Applied in SQL at the source.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10, description: "Source-side row depth." },
        since: { type: "string", format: "date-time", description: "ISO-8601 lower bound, no more than 7 days ago. Defaults to 96h ago; out-of-range values are rejected with invalid_since, never silently defaulted." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "error"] },
        headline: { type: "string" },
        scope: { type: "object" },
        resolutions: { type: "array", items: { type: "object" } },
        symbol: { type: ["string", "null"], description: "Compatibility field, populated only for a one-symbol result." },
        netFlowUsd: {
          type: ["number", "null"],
          description: "Compatibility field for a one-symbol result. Null means no one-symbol observation; zero means a measured balanced window.",
        },
        direction: { type: ["string", "null"], enum: ["buy_side", "sell_side", "balanced", "withheld", null] },
        confidence: {
          type: ["number", "null"],
          description: "Compatibility alias for detectionScore. It is unusualness, not measurement presence and not a probability.",
        },
        confidenceMeaning: { type: "string" },
        trend: { type: "string", enum: ["withheld"] },
        trendWithheldReason: { type: "string" },
        basis: { type: "string", enum: ["latest_measured_60m_imbalance_usd"] },
        dataOrigin: { type: "string", enum: ["order_flow_imbalance_proxy"] },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              canonicalInstrumentId: {
                type: ["string", "null"],
                description:
                  "The resolved INSTRUMENT id (binance:crypto:BTC-USDT), or null when the reference cannot resolve the symbol. Until 2026-09-04 this field carried the crypto UNDERLYING ('BTC') while instruments[] in the same response carried the instrument id; grouping exposure by it merged a symbol's USDT and USDC pairs. The underlying now has its own field.",
              },
              underlyingId: {
                type: ["string", "null"],
                description: "The crypto base asset. What canonicalInstrumentId used to hold. Two quote variants share this and differ in canonicalInstrumentId.",
              },
              assetClass: { type: "string" },
              venue: {
                type: ["string", "null"],
                description:
                  "Resolved from the venue asset list, or null when the symbol cannot be resolved. This was declared `type: \"null\"` — always null — while the same response's instruments[] block published BINANCE.",
              },
              identityResolution: {
                type: "object",
                description: "How the row's identity was resolved, so an unresolved row is distinguishable from an unlisted one.",
                properties: { state: { type: "string" }, basis: { type: ["string", "null"] } },
              },
              observedAt: { type: ["string", "null"], format: "date-time" },
              ageMinutes: { type: ["number", "null"] },
              freshness: { type: "string", enum: ["current", "stale", "last_session", "unknown"] },
              windowMinutes: { type: "number", enum: [60] },
              netFlowUsd: { type: ["number", "null"], description: "Persisted 60-minute (estimated buy volume - estimated sell volume) × price." },
              direction: { type: "string", enum: ["buy_side", "sell_side", "balanced", "withheld"] },
              directionBasis: { type: "string", enum: ["sign_of_measured_60m_imbalance_proxy", "withheld"] },
              buyVolumeBaseUnits: { type: ["number", "null"] },
              sellVolumeBaseUnits: { type: ["number", "null"] },
              totalVolumeBaseUnits: { type: ["number", "null"] },
              referencePrice: { type: ["number", "null"] },
              detectionScore: { type: ["number", "null"], description: "Uncalibrated unusualness score on 0-1; not a probability." },
              scoreType: { type: "string", enum: ["uncalibrated_order_flow_detection_score"] },
              scoreScale: { type: "string", enum: ["0-1"] },
              scoreMeaning: { type: "string" },
              isProbability: { type: "boolean", enum: [false] },
              calibrationStatus: { type: "string", enum: ["uncalibrated"] },
              sourceSignal: { type: ["string", "null"] },
              sourceSignalDirection: { type: "string", enum: ["buy_side", "sell_side", "neutral", "unknown"] },
              signalConflict: { type: "boolean" },
              withheldReason: { type: ["string", "null"] },
              observation: { type: "string" },
            },
          },
        },
        notReturned: { type: "array", items: { type: "object" } },
        conflicts: { type: "array", items: { type: "object" } },
        summary: { type: "object" },
        limitations: { type: "object" },
        disclaimer: { type: "string" },
        evidence: { type: "object" },
        provenance: { type: "object" },
        freshness: { type: "object", description: "Over the rows with a write cadence (crypto, in-session equities): dataAsOf is the oldest such row; stale means a symbol stopped reporting against its own cadence. Last-session rows are excluded here and counted in lastSessionRows (2026-10-13)." },
        freshnessByAssetClass: { type: "object", description: "crypto and equity blocks with the same shape as freshness; an equity block made only of last-session rows reports the age and stale: null, because a closed market has no cadence to be late against." },
        lastSessionRows: { type: "integer", description: "Rows served from a closed market's last session." },
        coverage: { type: "object", description: "Instruments this response can speak for, per asset class. Equities are watchlist-only: universe equities carry no bar timestamps and receive no flow row (nine names per session since at least 2026-09-14)." },
        source: { type: "object", description: "Where the rows came from: market_wide_snapshot | snapshot | snapshot+inline | inline; the default lower bound applied (crypto_30m | session_96h | market_wide_96h | caller); and the refresher's snapshot meta (asOf, ageSeconds, stale, lastError, refreshIntervalSeconds)." },
        asOf: { type: "string", format: "date-time" },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/capital-flow" },
  },
  {
    name: "fahali_run_shock_test",
    description:
      "Position-level shock revaluation: describe a scenario in natural language and get the " +
      "revalued capital at risk. Each position is revalued individually via " +
      "beta_i = corr(i, shock) * sigma_i / sigma_shock — NOT probability x an assumed move. " +
      "The scenario parser reproduces the exact shock asked for or ABSTAINS; it never guesses a " +
      "direction, and a scenario naming no recognised instrument returns no symbol rather than a " +
      "wrong one. Uses connected accounts unless `positions` is supplied. Observation, not advice.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          description: "Backward-compatible natural language scenario. Compound example: 'Nasdaq falls 12%, Bitcoin falls 20%, volatility doubles, and correlations converge toward 0.85.' Every clause is returned; unsupported factor maths is explicit.",
        },
        shocks: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          description: "Preferred deterministic form. Structured shocks override scenario parsing; every item is reported as measured, withheld, or not instrumented.",
          items: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["instrument"] },
                  instrument: { type: "string", description: "Symbol or supported alias such as BTCUSDT, Bitcoin, QQQ, or Nasdaq." },
                  movePct: { type: "number", not: { const: 0 }, description: "Signed percentage move; downside is negative." },
                  horizon: { type: "string", description: "Optional declared scenario horizon; preserved as request context." },
                },
                required: ["kind", "instrument", "movePct"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["factor"] },
                  factor: { type: "string", enum: ["volatility"] },
                  operation: { type: "string", enum: ["multiply"] },
                  value: { type: "number", exclusiveMinimum: 0 },
                  scope: { type: "string" },
                  horizon: { type: "string" },
                },
                required: ["kind", "factor", "operation", "value"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["factor"] },
                  factor: { type: "string", enum: ["cross_asset_correlation"] },
                  operation: { type: "string", enum: ["set"] },
                  value: { type: "number", minimum: -1, maximum: 1 },
                  scope: { type: "string" },
                  pairs: { type: "array", items: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } } },
                  horizon: { type: "string" },
                },
                required: ["kind", "factor", "operation", "value"],
              },
            ],
          },
        },
        shockSymbol: { type: "string", description: "Deprecated single-shock compatibility input. Prefer shocks[]." },
        shockPct: { type: "number", description: "Deprecated signed single-shock compatibility input. Prefer shocks[].movePct." },
        horizon: { type: "string", description: "Optional scenario horizon context." },
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Trading symbol." },
              market_value: {
                type: "number",
                minimum: 0,
                description:
                  "GROSS market value in USD, always non-negative. Direction is carried by `side`, never by the sign of this number — a negative market_value is refused.",
              },
              quantity: { type: "number", description: "Units held (optional)." },
              side: {
                type: "string",
                enum: ["long", "short"],
                default: "long",
                description:
                  "Position side; omitted means long. A short GAINS when its instrument falls, and an exact long/short pair in the same instrument nets to zero portfolio P&L. Supply this for any hedged, market-neutral, or short book, or the shock will be revalued as if every holding were long.",
              },
            },
            required: ["symbol", "market_value"],
          },
          description: "Optional custom positions. If omitted, uses connected accounts.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string" },
        status: { type: "string" },
        responseState: { type: "string", enum: ["OK_WITH_FINDINGS", "OK_NO_FINDINGS", "PARTIAL", "WITHHELD", "ERROR"] },
        dataState: { type: "string", enum: ["measured", "no_data", "not_instrumented", "stale", "error"] },
        mode: { type: "string", enum: ["deterministic", "recent_risk_observations"] },
        simulations: { type: "array", items: { type: "object", properties: {
          scenario: { type: "string" },
          marketDrop: { type: ["number", "null"] },
          probability: { type: ["number", "null"] },
          detectionScore: { type: ["number", "null"] },
          detectionScoreSemantics: { type: ["object", "null"] },
          expectedPortfolioDrawdown: { type: ["number", "null"] },
          impactBasis: { type: ["string", "null"], description: "alert_estimated_move when the alert carried a real magnitude, or null — never a hardcoded move proxy." },
          impactBasisNote: { type: "string" },
          mostVulnerable: { type: "array", items: { type: "string" }, description: "Empty when impactMapping=unavailable — never fabricated" },
          impactMapping: { type: "string" },
          impactMappingReason: { type: "string" },
          portfolioImpact: { type: ["number", "null"] },
        } } },
        recentRiskObservations: { type: "array", items: { type: "object", properties: {
          scenario: { type: "string" },
          marketDrop: { type: ["number", "null"] },
          probability: { type: ["number", "null"] },
          detectionScore: { type: ["number", "null"] },
          detectionScoreSemantics: { type: ["object", "null"] },
          expectedPortfolioDrawdown: { type: ["number", "null"] },
          mostVulnerable: { type: "array", items: { type: "string" } },
          portfolioImpact: { type: ["number", "null"] },
        } } },
        worstCase: { type: ["object", "null"] },
        portfolioValue: { type: "number" },
        portfolioValueMetric: { type: "object" },
        requestedScenario: { type: "object" },
        requestedShocks: { type: "array", items: { type: "object" } },
        portfolioCoverage: { type: "object" },
        shockCoverage: { type: "object" },
        compoundResult: { type: "object" },
        requestedShock: { type: "object", description: "Compatibility alias populated only for a single instrument shock. Compound requests are never collapsed to the first clause." },
        capitalAtRisk: { type: ["number", "null"] },
        capitalAtRiskNote: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
        asOf: { type: "string", format: "date-time" },
        timestamp: { type: ["string", "integer", "number"] },
      },
    },
    _meta: {
      requiredTier: "free",
      endpoint: "/api/portfolio/shock-test",
      method: "POST",
      // Re-enabled 2026-08-09 when position-level revaluation landed
      // (estimateUserShock/computeUserShock). The DESCRIPTION and this flag
      // were left saying DISABLED until 2026-08-14, so external QA read the
      // contract, ran the tool, saw it work, and correctly filed it as a
      // "major contract failure" — working code failing its own advertisement.
      // `FAHALI_MCP_SHOCK_TEST_ENABLED=false` remains an operator kill switch;
      // when set, proxy.ts returns 503 with a message that says so.
      disabled: false,
    },
  },
  {
    name: "fahali_get_market_briefing",
    description:
      "Use this when the user asks for a market briefing, what is happening in markets today, what is unusual right now, or how the market looks this morning. Full executive market analysis from measured detection components. The HMM regime is included only while its own observation is within the published 30-minute expiry; stale, invalid, or absent regime evidence makes the composite PARTIAL and is named in regimeFreshness/withheld. For a lightweight yesterday-vs-today delta use fahali_daily_brief. Observation, not advice.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string" },
        status: { type: "string", enum: ["OK", "PARTIAL", "WITHHELD"] },
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "stale", "error"] },
        responseState: { type: "string", enum: ["OK_WITH_FINDINGS", "PARTIAL", "WITHHELD", "ERROR"] },
        asOf: { type: "string", format: "date-time" },
        marketRiskScore: { type: ["integer", "null"] },
        riskLevel: { type: ["string", "null"], enum: ["low", "moderate", "high", "critical", null] },
        regime: { type: ["string", "null"] },
        regimeState: { type: "string", enum: ["measured", "stale", "invalid"] },
        regimeFreshness: { type: "object" },
        withheld: { type: "array", items: { type: "string" } },
        withheldReasons: { type: "object" },
        detectionActivity: { type: "object", properties: { bias: { type: "string" }, detectionsToday: { type: "string" }, basis: { type: "string" } } },
        topOpportunities: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, concurrentAlertFamilies: { type: "integer", description: "CONTEXT, NEVER CONVICTION: distinct alert families co-firing on this symbol (shared-input redundancy, not independent consensus). Read for color, never as strength of a call." }, engines: { type: "array", items: { type: "string" } }, why: { type: "string" }, claimKind: { type: "string", enum: ["risk_observation"] }, stance: { type: "string", enum: ["elevated_risk"] }, directionalBias: { type: ["string", "null"], enum: ["upside", "downside", null], description: "Unvalidated detection metadata only; never a buy/sell instruction." }, directionalBiasBasis: { type: "string" } } } },
        marketWideCrashRisk: { type: "object", properties: { level: { type: ["string", "null"], enum: ["low", "moderate", "elevated", null] }, symbolsAtRisk: { type: ["integer", "null"] }, withheldReason: { type: "string" } } },
        contributingEngines: { type: "array", items: { type: "string" } },
        outlook: { type: "string" },
        disclaimer: { type: "string" },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/agent/market-briefing" },
  },
  {
    name: "fahali_daily_brief",
    description:
      "Get a yesterday-vs-today delta: alert volume change, risk score, top signal, and HMM regime only when that regime observation is still within its 30-minute expiry. Stale, invalid, or absent regime evidence is null, makes the brief PARTIAL, and is named in regime_freshness/withheld. Free tier returns the compact form; Professional gets the full alert delta. Observation, not financial advice.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        as_of: { type: "string", format: "date-time" },
        since: { type: "string", format: "date-time" },
        data_state: { type: "string", enum: ["measured", "partial", "no_data", "stale", "error"] },
        response_state: { type: "string", enum: ["OK_WITH_FINDINGS", "PARTIAL", "WITHHELD", "ERROR"] },
        alert_activity: { type: "object", properties: { new_alerts_24h: { type: "integer" }, prior_24h: { type: "integer" }, change: { type: "integer" }, critical_alerts: { type: "integer" }, symbols_affected: { type: "integer" } } },
        risk_score: { type: ["integer", "null"] },
        risk_level: { type: ["string", "null"] },
        regime: { type: ["object", "null"], properties: { regime: { type: ["string", "null"] }, volatility: { type: ["string", "number", "null"] }, trend: { type: ["string", "null"] } } },
        regime_state: { type: "string", enum: ["measured", "stale", "invalid"] },
        regime_freshness: { type: "object" },
        withheld: { type: "array", items: { type: "string" } },
        withheld_reasons: { type: "object" },
        top_signal: { type: ["object", "null"], properties: { symbol: { type: "string" }, severity: { type: "string" }, engine: { type: "string" }, why: { type: "string" } } },
        prior_intel: { type: ["object", "string", "null"], properties: { slug: { type: "string" }, claim: { type: "string" }, published_at: { type: "string", format: "date-time" } } },
        note: { type: "string" },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/agent/daily-brief" },
  },
  // ====== WRITE TOOLS (tier-gated) ======
  {
    name: "fahali_save_memory",
    description: "Save a memory to the agent memory store. Memories persist across sessions for a given agent. Memory types: episodic (specific experiences), semantic (facts/knowledge), procedural (how-to).",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Unique key for the memory (namespaced, e.g. 'user:preferred_ticker')." },
        value: { type: "object", description: "The memory payload — any JSON-serializable object." },
        memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], description: "Memory classification (default: semantic)." },
      },
      required: ["key", "value"],
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        memory: { type: "object", properties: { id: { type: "string" }, key: { type: "string" }, value: { type: "object" }, memory_type: { type: "string" } } },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/v1/agent/memory", method: "POST" },
  },
  {
    name: "fahali_search_memories",
    description: "Semantic search across agent memories. Returns memories matching the search query using vector similarity (when available) or text ILIKE fallback.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to match against memory keys and values." },
        limit: { type: "number", description: "Maximum results (default 10, max 50)." },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        memories: { type: "array", items: { type: "object", properties: { id: { type: "string" }, key: { type: "string" }, value: { type: "object" }, memory_type: { type: "string" }, updated_at: { type: "string" } } } },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/v1/agent/memory", method: "GET" },
  },
  {
    name: "fahali_create_alert",
    description: "Create a custom alert. Agent-created alerts appear in the in-app realtime feed, hard-marked with an agent_ type prefix so they are never confused with engine detections; they do not trigger push/SMS to other users, and severity is capped at high (critical is reserved for engines).",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Trading symbol (e.g. 'BTCUSDT')." },
        alert_type: { type: "string", description: "Alert classification (e.g. 'agent_insight', 'custom_pattern')." },
        message: { type: "string", description: "Human-readable alert message." },
        severity: { type: "string", enum: ["low", "medium", "high"], description: "Severity level. `critical` is intentionally not offered: the upstream caps it to `high` (critical fans out to holder SMS/email and is reserved for engines), so asking for it would store something other than what was requested." },
        confidence: { type: "number", description: "Confidence score 0-1 (optional, default 0.5)." },
        idempotency_key: {
          type: "string",
          minLength: 8,
          maxLength: 128,
          description: "Stable retry key. Repeating the same key returns the original alert instead of creating a duplicate.",
        },
      },
      required: ["symbol", "alert_type", "message", "severity"],
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        idempotentReplay: { type: "boolean", description: "True when this idempotency key already created an alert and the original was returned." },
        alert: { type: "object", properties: { id: { type: "string" }, symbol: { type: "string" }, alert_type: { type: "string" }, message: { type: "string" }, severity: { type: "string" }, confidence: { type: "number" }, timestamp: { type: "string" } } },
      },
    },
    _meta: { requiredTier: "elite", endpoint: "/agent/alerts", method: "POST" },
  },
  {
    name: "fahali_list_agent_sessions",
    description: "List all sessions for the current agent. Returns session metadata including first seen, last active, memory count, and active status.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        sessions: { type: "array", items: { type: "object", properties: { session_id: { type: "string" }, first_seen: { type: "string" }, last_active: { type: "string" }, memory_count: { type: "integer" }, is_active: { type: "boolean" } } } },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/v1/agent/sessions", method: "GET" },
  },
  {
    name: "fahali_fact_check_narrative",
    description:
      "Use this BEFORE stating a market claim to a user, and whenever you are about to repeat a number, a direction, or a data source you did not obtain from Fahali in this session. Pass the sentence or paragraph you are about to say; each assertion comes back as SUPPORTED, CONTRADICTED, NO_READ, UNSUPPORTED_SOURCE, OUT_OF_SCOPE or UNVERIFIABLE, with the reason and what Fahali actually holds. Read `safeToRepeat` per assertion and `safeToPublish` overall. CRITICAL: NO_READ IS NOT AGREEMENT. An assertion Fahali cannot check is unverified, never confirmed — repeating it under cover of a fact-check launders a guess into an audited claim. UNSUPPORTED_SOURCE means the claim rests on a feed Fahali does not ingest (private transaction feeds, participant-attributed order flow, on-chain settlement, options flow, filings); those sentences must be dropped, not hedged. OUT_OF_SCOPE covers price targets, trade instructions, loss-prevention promises and engine counts — Fahali does not answer those at all.",
    inputSchema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "The narrative text you are about to state. Sentences are checked individually; pass the whole paragraph rather than one clause." },
        symbols: { type: "array", items: { type: "string" }, description: "Optional. Instruments the claim is about, if they are not written as plain tickers in the text." },
      },
      required: ["claim"],
    },
    outputSchema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string" },
        checkedAt: { type: "string", format: "date-time" },
        claim: { type: "string" },
        symbolsRecognised: { type: "array", items: { type: "string" } },
        coverage: { type: "string", description: "Which named symbols Fahali actually holds a read on, and — when the lookup itself failed — that the check did not run. A failed lookup is reported as NO_READ, never as a pass." },
        safeToPublish: { type: "boolean", description: "True ONLY when every assertion is SUPPORTED by a current reading. Unchecked assertions make this false." },
        instruction: { type: "string", description: "What to do with the narrative, in a sentence." },
        verdictCounts: { type: "object", additionalProperties: { type: "integer" } },
        assertions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              verdict: { type: "string", enum: ["SUPPORTED", "CONTRADICTED", "NO_READ", "UNSUPPORTED_SOURCE", "OUT_OF_SCOPE", "UNVERIFIABLE"] },
              safeToRepeat: { type: "boolean", description: "True only for SUPPORTED. NO_READ is not permission to repeat." },
              explanation: { type: "string" },
              fahaliSays: { type: "string" },
              symbol: { type: "string" },
            },
            required: ["text", "verdict", "safeToRepeat", "explanation"],
          },
        },
      },
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/verdict" },
  },
  {
    name: "fahali_list_connected_accounts",
    description:
      "List the authenticated user's connected accounts before requesting portfolio analysis. Returns provider, display name, connection state, last sync, equity, currency, and position count. Broker account numbers, credentials, user identifiers, and provider metadata are never returned. No accounts is an explicit no_data state, not a portfolio all-clear.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "error"] },
        dataState: { type: "string", enum: ["measured", "no_data", "error"] },
        count: { type: "integer" },
        reason: { type: ["string", "null"] },
        asOf: { type: "string", format: "date-time" },
        accounts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              provider: { type: "string" },
              accountName: { type: "string" },
              status: { type: "string" },
              lastSync: { type: ["string", "null"] },
              totalValue: { type: "number" },
              currency: { type: "string" },
              positionCount: { type: "integer" },
              connectionIssue: { type: "boolean" },
            },
            required: ["id", "provider", "accountName", "status", "totalValue", "currency", "positionCount", "connectionIssue"],
          },
        },
      },
      required: ["status", "dataState", "count", "accounts"],
    },
    _meta: { requiredTier: "professional", endpoint: "/agent/accounts", method: "GET" },
  },
  {
    name: "fahali_get_bundle",
    description:
      "One compact, authenticated market-intelligence bundle for autonomous workflows. Select the views needed and receive them under one response envelope; failed views are named explicitly and never disappear into a partial market read. Defaults include the canonical market decision, briefing, risk, regime, and conviction. Use detail='brief' unless raw evidence is required.",
    inputSchema: {
      type: "object",
      properties: {
        views: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [
              "briefing",
              "market_decision",
              "risk_score",
              "regime",
              "conviction",
              "portfolio",
              "accounts",
              "realtime",
              "lead_time",
              "engine_status",
              "daily_brief",
            ],
          },
          description: "Named views to fetch in parallel. Omit for market_decision, briefing, risk_score, regime, and conviction.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "partial", "error"] },
        requestedViews: { type: "array", items: { type: "string" } },
        completedViews: { type: "array", items: { type: "string" } },
        failedViews: {
          type: "array",
          items: {
            type: "object",
            properties: {
              view: { type: "string" },
              error: { type: "string" },
            },
            required: ["view", "error"],
          },
        },
        views: { type: "object", additionalProperties: { type: "object" } },
        decisionSource: { type: ["string", "null"], enum: ["market_decision", null] },
      },
      required: ["status", "requestedViews", "completedViews", "failedViews", "views"],
    },
    _meta: { requiredTier: "professional", endpoint: "local://bundle", method: "COMPOSITE" },
  },
  {
    name: "fahali_get_capabilities",
    description:
      "Start here when planning an autonomous Fahali workflow. Returns the canonical live tool catalogue, primary-versus-audit taxonomy, executable registry-validated workflows, tier requirements, response controls, supported identity rules, and schema resources. Compatibility-only names are dispatchable but deliberately absent from discovery. This call is local, lightweight, and does not query market data.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        serverVersion: { type: "string" },
        recommendedStart: { type: "string" },
        primaryTools: { type: "array", items: { type: "string" } },
        toolTaxonomy: {
          type: "object",
          properties: {
            primary: { type: "object" },
            audit: { type: "object" },
            operations: { type: "object" },
          },
        },
        workflows: { type: "array", items: { type: "object" } },
        tools: { type: "array", items: { type: "object" } },
        responseControls: { type: "object" },
        resources: { type: "array", items: { type: "string" } },
        instrumentIdentity: { type: "object" },
        oauth: { type: "object" },
      },
    },
    _meta: { requiredTier: "free", endpoint: "local://capabilities", method: "LOCAL" },
  },
  {
    name: "fahali_watch_portfolio",
    description: "Create a durable, monitor-only, long-only portfolio watch from supplied positions or the caller's connected accounts. Short legs, hedges, negative exposure, and connected books containing them fail closed until signed-exposure authority is separately certified. Fahali evaluates immediately and persists/re-evaluates the observation. Output labels are monitoring escalation only: no personal recommendation, portfolio action, order, or capital path exists.",
    inputSchema: {
      type: "object",
      properties: {
        idempotency_key: IDEMPOTENCY_KEY_INPUT,
        name: { type: "string", maxLength: 120 },
        positions: { type: "array", minItems: 1, maxItems: 500, items: WATCH_POSITION_INPUT, description: "Omit to watch connected accounts. Connected books are also rejected if any short leg is present." },
        account_ids: { type: "array", items: { type: "string" }, description: "Optional connected-account selection. Omit for every connected account." },
        mandate: WATCH_MANDATE_INPUT,
        thresholds: WATCH_THRESHOLDS_INPUT,
        evaluation_interval_minutes: { type: "integer", minimum: 5, maximum: 1440, default: 15 },
      },
      required: ["idempotency_key"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/watches", method: "POST" },
  },
  {
    name: "fahali_list_portfolio_watches",
    description: "List the caller's persistent portfolio watches, including mandate, thresholds, source, status, and latest verdict ID. Use this before asking the user to recreate a watch. A missing list means no watch exists; it is not a calm-market reading.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/watches", method: "GET" },
  },
  {
    name: "fahali_update_portfolio_watch",
    description: "Idempotently update a persistent monitor-only, long-only watch's positions, connected-account scope, mandate, thresholds, interval, or status. Any short leg, hedge, negative exposure, or can_short=true request fails closed. Fahali never acquires recommendation, portfolio-action, order, or execution authority.",
    inputSchema: {
      type: "object",
      properties: {
        watch_id: { type: "string", format: "uuid" },
        idempotency_key: IDEMPOTENCY_KEY_INPUT,
        name: { type: "string", maxLength: 120 },
        status: { type: "string", enum: ["active", "paused", "deleted"], description: "deleted retires the watch: it stops being evaluated and disappears from reads, while its verdict history stays auditable. There is no other way to retire a watch you created." },
        position_source: { type: "string", enum: ["connected", "supplied"] },
        positions: { type: "array", minItems: 1, maxItems: 500, items: WATCH_POSITION_INPUT },
        account_ids: { type: "array", items: { type: "string" } },
        mandate: WATCH_MANDATE_INPUT,
        thresholds: WATCH_THRESHOLDS_INPUT,
        evaluation_interval_minutes: { type: "integer", minimum: 5, maximum: 1440 },
      },
      required: ["watch_id", "idempotency_key"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/watches/{watch_id}", method: "PATCH" },
  },
  {
    name: "fahali_get_portfolio_decision",
    description: "Get the current non-binding, monitor-only risk assessment for a persistent watch. Legacy HOLD/WATCH/REDUCE/EXIT values are escalation labels interpreted only inside the supplied monitoring thresholds; machine policy fields prohibit treating them as a personalized recommendation, portfolio action, order, or execution authority.",
    inputSchema: { type: "object", properties: { watch_id: { type: "string", format: "uuid" }, refresh: { type: "boolean", default: true, description: "True re-evaluates and may persist a new verdict (requires write:portfolio). False reads the latest verdict only (read:portfolio)." } }, required: ["watch_id"] },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/watches/{watch_id}/decision", method: "GET" },
  },
  {
    name: "fahali_get_watch_delta",
    description: "Return only what changed for a persistent monitor-only watch: escalation label, risk band, direction, evidence coverage, threshold crossings, new evidence, and previous/current immutable verdict IDs. Defaults to a fresh evaluation. An unchanged result is explicit and never interpreted as market safety or permission to trade.",
    inputSchema: { type: "object", properties: { watch_id: { type: "string", format: "uuid" }, refresh: { type: "boolean", default: true, description: "True re-evaluates and may persist a new verdict (requires write:portfolio). False compares stored verdicts only (read:portfolio)." } }, required: ["watch_id"] },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/watches/{watch_id}/delta", method: "GET" },
  },
  {
    name: "fahali_get_active_incidents",
    description: "List monitor-only incidents Fahali opened on your watches and is still waiting on. An incident opens when a watch reaches REDUCE/EXIT or its evidence coverage degrades, stays open until a later verdict clears it, and escalates if nobody acknowledges it in time. Use it to find what you have not answered. An empty list means nothing is open, NOT that the market is calm.",
    inputSchema: {
      type: "object",
      properties: {
        watch_id: { type: "string", format: "uuid", description: "Restrict to one watch. Omit for every watch on the account." },
        include_resolved: { type: "boolean", default: false, description: "Include incidents that already closed on evidence." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/incidents", method: "GET" },
  },
  {
    name: "fahali_acknowledge_incident",
    description: "Record that an incident has been seen, which stops its escalation clock. Acknowledgment does NOT close the incident and asserts nothing about whether the risk passed — only a later verdict showing the breach cleared can resolve it. Idempotent by state: acknowledging twice returns the first acknowledgment unchanged, preserving the true responder and time, so no idempotency key is needed.",
    inputSchema: {
      type: "object",
      properties: {
        incident_id: { type: "string", format: "uuid" },
        acknowledged_by: { type: "string", maxLength: 200, description: "Who or what is answering. Defaults to the calling identity." },
        note: { type: "string", maxLength: 1000, description: "Optional free text recorded with the acknowledgment." },
      },
      required: ["incident_id"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/incidents/{incident_id}/acknowledge", method: "POST" },
  },
  {
    name: "fahali_get_incident_timeline",
    description: "Replay every immutable verdict Fahali recorded inside one incident's window, in order, each tagged as the opening, an intermediate, or the resolving verdict. Derived from the verdict history rather than copied onto the incident, so the hashes and methodology version are the originals. Use it to answer what Fahali knew, and when, across the life of a breach.",
    inputSchema: {
      type: "object",
      properties: {
        incident_id: { type: "string", format: "uuid" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      required: ["incident_id"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/incidents/{incident_id}/timeline", method: "GET" },
  },
  {
    name: "fahali_get_verdict_history",
    description: "Query immutable portfolio verdict history by watch, symbol, time, or cursor. Use as_of to reconstruct what Fahali knew before a later market move. Every row binds the decision, evidence revision, mandate, methodology version, prior verdict, and content hash; empty history means no recorded judgment, not agreement.",
    inputSchema: {
      type: "object",
      properties: {
        watch_id: { type: "string", format: "uuid" },
        symbol: { type: "string" },
        as_of: { type: "string", format: "date-time" },
        since: { type: "string", format: "date-time" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        cursor: { type: "string" },
      },
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/verdict-history", method: "GET" },
  },
  {
    name: "fahali_get_verdict_by_id",
    description: "Replay one immutable verdict by its permanent ID. Returns the exact mandate-aware decision, evidence references, delta, methodology, previous verdict, and integrity hashes recorded at that time. A missing ID returns no_data rather than substituting the latest judgment.",
    inputSchema: { type: "object", properties: { verdict_id: { type: "string", format: "uuid" } }, required: ["verdict_id"] },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/verdict-history/{verdict_id}", method: "GET" },
  },
  {
    name: "fahali_get_evidence",
    description: "Fetch the compact, content-addressed evidence behind one immutable portfolio verdict. Returns the evidence snapshot hashed at decision time plus retained source events, explicit retention gaps, canonical instrument resolution, and hash verification. Use summary detail for routine audit and full only when raw source metadata is required.",
    inputSchema: {
      type: "object",
      properties: {
        verdict_id: { type: "string", format: "uuid", description: "Permanent verdict ID returned by verdict history, watch delta, or verdict-by-ID." },
        evidence_ids: {
          oneOf: [
            { type: "string", description: "Optional comma-separated subset of evidence IDs referenced by this verdict." },
            { type: "array", items: { oneOf: [{ type: "string" }, { type: "integer" }] }, maxItems: 100 },
          ],
        },
        detail: { type: "string", enum: ["summary", "full"], default: "summary", description: "summary returns source keys and resolved claim fields; full includes the retained raw source data object." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
      },
      required: ["verdict_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "partial"] },
        dataState: { type: "string", enum: ["measured", "partial", "no_data", "error"] },
        verdictId: { type: "string", format: "uuid" },
        watchId: { type: "string", format: "uuid" },
        dataAsOf: { type: "string", format: "date-time" },
        methodologyVersion: { type: "string" },
        immutableSnapshot: { type: "object", description: "Requested page from the exact stored evidence snapshot. Integrity is verified against the complete snapshot, not this page alone." },
        snapshotState: { type: "string", enum: ["captured", "legacy_references_only"], description: "Legacy verdicts predate durable source snapshots and therefore remain partial even if a retained event row is still readable." },
        integrity: {
          type: "object",
          properties: {
            recordedEvidenceHash: { type: "string" },
            recomputedEvidenceHash: { type: "string" },
            evidenceHashVerified: { type: "boolean" },
            contentHash: { type: "string" },
            verifiedAgainstCompleteSnapshot: { type: "boolean" },
            completeSnapshotSourceCount: { type: "integer" },
            returnedSnapshotSourceCount: { type: "integer" },
            hashBasis: { type: "string", enum: ["decision_evidence_plus_captured_source_evidence", "legacy_event_references_only"] },
          },
        },
        evidenceRefs: { type: "array", items: { type: "string" } },
        sourceEvents: { type: "array", items: { type: "object" } },
        missingEvidenceIds: { type: "array", items: { type: "string" } },
        identityMismatchEvidenceIds: {
          type: "array",
          items: { type: "string" },
          description: "Retained source-event IDs whose current captured instrument identity no longer matches the immutable verdict snapshot.",
        },
        sourceMaterialMismatchEvidenceIds: {
          type: "array",
          items: { type: "string" },
          description: "Retained source-event IDs whose current producer-row material no longer matches the exact row hash consumed by the verdict.",
        },
        coverage: { type: "object" },
        detail: { type: "string", enum: ["summary", "full"] },
        offset: { type: "integer" },
        nextOffset: { type: ["integer", "null"] },
        immutable: { type: "boolean" },
        operatingMode: { type: "string", enum: ["MONITOR_ONLY"] },
        outputClassification: MONITOR_ONLY_OUTPUT_CLASSIFICATION,
        legacyFieldSemantics: LEGACY_MONITOR_FIELD_SEMANTICS_OUTPUT,
        asOf: { type: "string", format: "date-time" },
      },
      required: ["status", "dataState", "verdictId", "immutableSnapshot", "integrity", "sourceEvents", "identityMismatchEvidenceIds", "sourceMaterialMismatchEvidenceIds", "coverage", "operatingMode", "outputClassification", "legacyFieldSemantics"],
    },
    _meta: { requiredTier: "elite", endpoint: "/agent/verdict-history/{verdict_id}/evidence", method: "GET" },
  },
  {
    name: "fahali_subscribe_risk",
    description: "Idempotently deliver monitor-only observations and risk alerts through a signed webhook, agent callback, Slack, Teams, account email, or registered push device. Delivery policy structurally prohibits personalized recommendations, portfolio actions, orders, and execution. A generated signing secret is recoverable only through the exact authenticated idempotent request; a changed request requires a new key.",
    inputSchema: {
      type: "object",
      properties: {
        watch_id: { type: "string", format: "uuid" },
        idempotency_key: IDEMPOTENCY_KEY_INPUT,
        channel: { type: "string", enum: ["webhook", "agent_callback", "slack", "teams", "email", "push"] },
        target_url: { type: "string", format: "uri", description: "Required for webhook, agent_callback, Slack, and Teams. Public HTTPS only." },
        signing_secret: { type: "string", minLength: 16, maxLength: 256, description: "Optional for webhook/callback. Omit to generate one returned on creation and recoverable by an exact authenticated idempotent replay while that subscription configuration remains current." },
        events: { type: "array", items: { type: "string", enum: ["decision_changed", "risk_threshold_crossed", "coverage_degraded", "evidence_changed"] } },
        minimum_action: { type: "string", enum: ["HOLD", "WATCH", "REDUCE", "EXIT"], default: "WATCH", description: "Legacy monitoring-escalation threshold only; never a portfolio or order action." },
      },
      required: ["watch_id", "channel", "idempotency_key"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/watches/{watch_id}/subscriptions", method: "POST" },
  },
  {
    name: "fahali_list_risk_subscriptions",
    description: "List the caller's risk-delivery subscriptions and their health without exposing callback URLs or encrypted configuration. Returns channel, event filters, minimum action, last delivery, failure count, and target hint. Use this before creating a duplicate subscription.",
    inputSchema: { type: "object", properties: { watch_id: { type: "string", format: "uuid" } } },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/risk-subscriptions", method: "GET" },
  },
  {
    name: "fahali_update_subscription",
    description: "Idempotently change a monitor-only risk subscription's active/paused status, event filters, escalation threshold, or delivery target. Updating a webhook target rotates its signing secret once per idempotency key. Stored targets remain encrypted and no recommendation/order authority is introduced.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", format: "uuid" },
        idempotency_key: IDEMPOTENCY_KEY_INPUT,
        status: { type: "string", enum: ["active", "paused"] },
        target_url: { type: "string", format: "uri" },
        signing_secret: { type: "string", minLength: 16, maxLength: 256 },
        events: { type: "array", items: { type: "string", enum: ["decision_changed", "risk_threshold_crossed", "coverage_degraded", "evidence_changed"] } },
        minimum_action: { type: "string", enum: ["HOLD", "WATCH", "REDUCE", "EXIT"], description: "Legacy monitoring-escalation threshold only; never a portfolio or order action." },
      },
      required: ["subscription_id", "idempotency_key"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/risk-subscriptions/{subscription_id}", method: "PATCH" },
  },
  {
    name: "fahali_unsubscribe_risk",
    description: "Idempotently disable a monitor-only risk subscription. New queueing and retries stop; pending work is fenced and its audit remains visible. A request already past the dispatch boundary may arrive once, so receivers must deduplicate by X-Fahali-Delivery. Retry an identical request with the same idempotency key; use a new key for any change.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", format: "uuid" },
        idempotency_key: IDEMPOTENCY_KEY_INPUT,
      },
      required: ["subscription_id", "idempotency_key"],
    },
    outputSchema: GENERIC_MONITOR_OUTPUT,
    _meta: { requiredTier: "elite", endpoint: "/agent/risk-subscriptions/{subscription_id}", method: "DELETE" },
  },
  {
    name: "fahali_get_lead_time",
    description: "Verified Lead Time (VLT) per engine stratum — how many hours of warning before an adverse move crossed the judgment bar. Returns recall, p25/median/p75 lead time, precision, base rate, and effective sample per (engine, horizon_tier, bar_regime). Engines below their base rate return ABSTAIN. Public, no tier gate. USE `headline` FOR ANY SINGLE-CLAIM SUMMARY: it is the one stratum Fahali stands behind, chosen server-side by recall (the share of real danger events actually warned on) among strata clearing the publishability gate with positive base-rate lift. Do NOT pick your own row from `trackRecord` — ranking by lift or by array position selects a stratum that is right when it fires but almost never fires. When `headline` is null, `headlineWithheldReason` says why; report that rather than substituting another row. Always quote the stratum (bar_regime + horizon_tier) with the number — lead varies 11–59h across strata. Methodology and misses: fahaliai.com/methodology#vlt",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "partial", "degraded", "error"] },
        snapshotId: { type: ["string", "null"] },
        asOf: { type: "string", format: "date-time" },
        claimTier: { type: "string" },
        dataOrigin: { type: "string", enum: ["measured", "proxy", "synthetic"] },
        // 2026-08-09: this enum listed only ["cached","live","no_pool","error"]
        // and the server emits SEVEN values. `precomputed` is what the 10-minute
        // precompute writes -- the everyday path -- so an enforcing client
        // (SDK >=1.29, Claude Desktop) failed validation on essentially every
        // HEALTHY call, while the fallback and error paths validated fine. Found
        // by scripts/validate-schemas.mjs against production, which is the only
        // check that can see this: isError responses are exempt from
        // structuredContent validation, so schema drift breaks only the calls
        // that SUCCEED.
        //
        // Kept in sync by server/tests/calculationStatusEnum.test.ts, which
        // derives the real set from the emitters rather than trusting this list.
        calculationStatus: {
          type: "string",
          enum: [
            "precomputed",       // cacheWarmup.ts — the normal path
            "stale_precompute",  // ...same, past staleAfterHours
            "live",              // routes.ts — computed in-request
            "stale_live",        // ...same, past staleAfterHours
            "cached",            // served from the response cache
            "no_pool",           // no DB pool; nothing measured
            "error",             // computation failed; read as unmeasured
            "no_verified_identity_population", // identity authority exists, but no valid final outcomes clear it yet
            "identity_authority_unavailable",  // the identity authority itself could not be verified
          ],
          description:
            "How this snapshot was produced. A 'stale_' prefix means the data is " +
            "past its freshness window (see staleAfterHours/dataAgeHours) — treat " +
            "it as dated, not as absent. 'no_pool' and 'error' mean nothing was " +
            "measured; never read either as a zero result.",
        },
        trackRecord: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string", format: "date" },
              engine: { type: "string" },
              horizon_tier: { type: "string" },
              bar_regime: { type: "string" },
              qualifying_events: { type: "integer" },
              warned_events: { type: "integer" },
              recall_pct: { type: ["number", "null"] },
              lead_median_hours: { type: ["number", "null"] },
              effective_sample: { type: "integer" },
              precision_pct: { type: ["number", "null"] },
              base_rate_pct: { type: ["number", "null"] },
              publishable: { type: "boolean" },
            },
          },
        },
        // The single stratum to quote. Declared here because an undeclared
        // field fails structuredContent validation on enforcing clients — the
        // same class of break documented on calculationStatus above.
        headline: {
          type: ["object", "null"],
          description:
            "The one stratum Fahali stands behind, chosen server-side by recall among " +
            "strata that clear the publishability gate with positive base-rate lift, " +
            "collapsed to each stratum's most recent measurement day. Null when nothing " +
            "qualifies — read headlineWithheldReason, never substitute another row.",
          properties: {
            engine: { type: "string" },
            horizon_tier: { type: "string" },
            bar_regime: { type: "string" },
            qualifying_events: { type: "integer" },
            warned_events: { type: "integer" },
            recall_pct: { type: ["number", "null"] },
            lead_p25_hours: { type: ["number", "null"] },
            lead_median_hours: { type: ["number", "null"] },
            lead_p75_hours: { type: ["number", "null"] },
            effective_sample: { type: "integer" },
            precision_pct: { type: ["number", "null"] },
            base_rate_pct: { type: ["number", "null"] },
            lift_pp: {
              type: ["number", "null"],
              description: "precision_pct − base_rate_pct, in percentage POINTS. Not a directional score.",
            },
            measured_on: { type: ["string", "null"], format: "date-time" },
          },
        },
        headlineWithheldReason: {
          type: ["string", "null"],
          description:
            "Why no headline was chosen. Present exactly when headline is null. Report it verbatim — " +
            "a withheld claim is not the same as an absent one.",
        },
        headlineSelection: {
          type: ["object", "null"],
          description: "The selection rule in force, so the choice is auditable rather than implicit.",
          properties: {
            rankedBy: { type: "string" },
            among: { type: "string" },
            minEffectiveSample: { type: "integer" },
            maxStratumLagDays: { type: "integer" },
            eligibleStrata: { type: "integer" },
          },
        },
        abstentionReason: { type: ["string", "null"] },
        // Emitted by the MCP collapse (proxy.ts getLeadTime), not by the REST
        // endpoint. Declared because undeclared fields fail structuredContent
        // validation on enforcing clients (SDK >=1.29).
        trackRecordCollapsed: {
          type: ["object", "null"],
          description:
            "Collapse disclosure: one row per (engine · horizon_tier · bar_regime), most recent day. " +
            "`returned` rows shown out of `collapsedFrom` daily re-publications — repeats of the same strata, not independent observations.",
          properties: {
            returned: { type: "integer" },
            collapsedFrom: { type: "integer" },
            rule: { type: "string" },
            note: { type: "string" },
          },
        },
        instrumentClassCoverage: {
          type: ["object", "null"],
          description:
            "Per-instrument-class coverage (crypto/equity/…). measuredButWithheld means the stratum was measured and did not clear the gate — a disclosed limitation, never an all-clear. No equity stratum is published; read the block, not the headline, for what IS measured per class.",
          properties: {
            classes: { type: "array", items: { type: "object" } },
            note: { type: "string" },
            verdictEngineNote: { type: "string" },
          },
        },
        provenance: { type: ["object", "null"] },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/track-record/lead-time", method: "GET" },
  },
  {
    name: "fahali_get_fall_warnings",
    description:
      "Live board of the 8-hour fall-warning engine (fall_warning_8h): standing warnings with a probability P (the served `fit` block states whether and how it is calibrated) of a >=5% running-peak drawdown within 8 hours, mechanism attribution (path, crowding, contagion, flow), input census, and the engine's own judged record. An unmeasured input is missing data, never calm. A 'late' state is a fall already under way and is not a claim. Read the engine's own judged stratum, never the headline. Adds findings[], matchedTrackRecord, recordMatchReason, ownStrataCount and record.withheldOnly (true when every own stratum is judged but withheld). Public data.",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Optional instrument, e.g. BTCUSDT" }, limit: { type: "integer", minimum: 1, maximum: 200 } } },
    outputSchema: {
      type: "object",
      required: ["status", "engine", "asOf", "dataState", "roster", "board", "record"],
      properties: {
        status: { type: "string", enum: ["ok", "partial", "unavailable"] },
        engine: { type: "string" },
        asOf: { type: "string", format: "date-time" },
        dataState: { type: "string", enum: ["measured", "partial", "no_data"] },
        boardAgeSeconds: { type: ["integer", "null"] },
        roster: { type: "object", required: ["value"], properties: { value: { type: ["object", "null"] }, reason: { type: "string" } },
          if: { properties: { value: { type: "null" } } }, then: { required: ["reason"] } },
        board: { type: "object", required: ["value"], properties: { value: { type: ["object", "null"] }, reason: { type: "string" } },
          if: { properties: { value: { type: "null" } } }, then: { required: ["reason"] } },
        symbol: { type: "object", required: ["value"], properties: { value: { type: ["object", "null"] }, reason: { type: "string" } },
          if: { properties: { value: { type: "null" } } }, then: { required: ["reason"] } },
        record: { type: "object", required: ["strata", "grade"], properties: {
          strata: { type: "object", required: ["value"], properties: { value: { type: ["array", "null"], items: { type: "object" } }, reason: { type: "string" } },
            if: { properties: { value: { type: "null" } } }, then: { required: ["reason"] } },
          grade: { type: "object", required: ["value"], properties: { value: { type: ["object", "null"] }, reason: { type: "string" } },
            if: { properties: { value: { type: "null" } } }, then: { required: ["reason"] } },
          withheldOnly: { type: "boolean", description: "Present with strata.value: true when every own stratum is judged but withheld (below the bar), false when one is publishable." },
        } },
        // Added by the MCP layer (agentPayload / judgedRecord), not by the api envelope.
        findings: { type: "array", items: { type: "object" } },
        matchedTrackRecord: { type: ["object", "null"] },
        recordMatchReason: { type: "string" },
        ownStrataCount: { type: "integer" },
      },
    },
    _meta: { requiredTier: "free", endpoint: "/api/engines/fall-warning-8h" },
  },
  {
    name: "fahali_get_engine_board",
    description:
      "Live board of any engine built under the engine contract, by key: live claims (each with a probability P (the served `fit` block states whether and how it is calibrated)), mechanism attribution, input census, health, and the engine's own judged record. An unmeasured input is missing data, never calm. Read the engine's own judged stratum, never the headline. Adds findings[], matchedTrackRecord, recordMatchReason, ownStrataCount and record.withheldOnly (true when every own stratum is judged but withheld). Public data.",
    inputSchema: { type: "object", required: ["engine"], properties: { engine: { type: "string", description: "Engine key, e.g. fall_warning_8h" }, symbol: { type: "string" } } },
    outputSchema: { type: "object" },
    _meta: { requiredTier: "free", endpoint: "/api/engines/fall_warning_8h/board" },
  },
];

{
  const fw = (TOOL_DEFINITIONS as any[]).find((t) => t.name === "fahali_get_fall_warnings");
  const eb = (TOOL_DEFINITIONS as any[]).find((t) => t.name === "fahali_get_engine_board");
  if (fw && eb) eb.outputSchema = JSON.parse(JSON.stringify(fw.outputSchema));
}

// Canonical judgment entry points deliberately reuse the existing verdict
// schema and handler. They are navigation aliases, not a second arbiter. This
// keeps one source of truth for computation while giving an autonomous agent a
// clear market-wide start and a clear single-symbol start.
const MARKET_VERDICT_CONTRACT = (TOOL_DEFINITIONS as any[]).find(
  (tool) => tool.name === "fahali_get_market_verdict",
);
if (!MARKET_VERDICT_CONTRACT) throw new Error("Missing canonical market verdict contract");

(TOOL_DEFINITIONS as any[]).push(
  {
    name: "fahali_get_market_decision",
    description:
      "Primary market judgment entry point and thin alias over the canonical arbiter. Returns its authoritative direction plus forecast, record, invalidation, complete non-binding committee evidence, current canonical-roster engine rows, and runtime telemetry. It performs no second computation. A market-wide call promotes one row; read decisionSelection.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: {
          type: ["string", "array"],
          items: { type: "string" },
          description: "Optional comma-separated symbols or symbol array. Omit for Fahali's current market-wide priorities.",
        },
        includeContagion: {
          type: "boolean",
          default: false,
          description: "Include downside co-movement context when the caller is entitled to it.",
        },
      },
    },
    outputSchema: MARKET_VERDICT_CONTRACT.outputSchema,
    _meta: {
      ...MARKET_VERDICT_CONTRACT._meta,
      aliasOf: "fahali_get_market_verdict",
    },
  },
  {
    name: "fahali_get_symbol_decision",
    description:
      "Primary single-instrument judgment and thin alias over the canonical arbiter. Returns its authoritative direction plus forecast, record, invalidation, complete non-binding committee evidence, current canonical-roster engine rows, and runtime telemetry. It performs no second computation.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          minLength: 1,
          description: "One trading symbol or canonical instrument alias, for example BTCUSDT or NVDA.",
        },
        includeContagion: {
          type: "boolean",
          default: false,
          description: "Include downside co-movement context when the caller is entitled to it.",
        },
      },
      required: ["symbol"],
    },
    outputSchema: MARKET_VERDICT_CONTRACT.outputSchema,
    _meta: {
      ...MARKET_VERDICT_CONTRACT._meta,
      aliasOf: "fahali_get_market_verdict",
    },
  },
);

/**
 * OAuth permissions are part of the public tool contract, not an implementation
 * detail.  Keeping the mapping beside the live catalogue lets the transport,
 * consent screen, and tools/list response derive from one source of truth.
 *
 * Write permissions are deliberately narrow.  A token that can read market
 * data cannot silently create memories, alerts, persistent watches, or an
 * outbound delivery subscription.
 */
export const FAHALI_OAUTH_SCOPES = [
  "read:market",
  "read:portfolio",
  "read:memory",
  "read:delivery",
  "write:memory",
  "write:alerts",
  "write:portfolio",
  "write:delivery",
] as const;

export type FahaliOAuthScope = (typeof FAHALI_OAUTH_SCOPES)[number];

export type FahaliToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

const LEGACY_TOOL_NAMES: Record<string, string> = {
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

const PORTFOLIO_READ_TOOLS = new Set([
  "fahali_get_portfolio_metrics",
  "fahali_get_portfolio_risk",
  "fahali_analyze_custom_portfolio",
  "fahali_run_shock_test",
  "fahali_list_connected_accounts",
  "fahali_list_portfolio_watches",
  "fahali_get_portfolio_decision",
  "fahali_get_watch_delta",
  "fahali_get_verdict_history",
  "fahali_get_verdict_by_id",
  "fahali_get_evidence",
  // Incidents are per-account private state. Falling through to the
  // `read:market` default would advertise a market-only grant as sufficient
  // to read another holder's open breaches.
  "fahali_get_active_incidents",
  "fahali_get_incident_timeline",
]);

const INTERNAL_READ_TOOLS = new Set([
  "fahali_get_capabilities",
  "fahali_search_memories",
  "fahali_list_agent_sessions",
  "fahali_list_portfolio_watches",
  "fahali_get_verdict_history",
  "fahali_get_verdict_by_id",
  "fahali_get_evidence",
  "fahali_list_risk_subscriptions",
  "fahali_list_connected_accounts",
]);

const MUTATING_TOOL_ANNOTATIONS: Record<string, Omit<FahaliToolAnnotations, "openWorldHint">> = {
  fahali_save_memory: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  fahali_create_alert: {
    readOnlyHint: false,
    destructiveHint: false,
    // idempotency_key is optional; without one a retry creates another alert.
    idempotentHint: false,
  },
  fahali_acknowledge_incident: {
    readOnlyHint: false,
    // Never destructive: an acknowledgment only stops the escalation clock.
    // It cannot close an incident, and it cannot alter a verdict.
    destructiveHint: false,
    // Idempotent BY STATE rather than by key — the first acknowledgment wins
    // and a repeat returns it unchanged, preserving the true responder.
    idempotentHint: true,
  },
  fahali_watch_portfolio: {
    readOnlyHint: false,
    destructiveHint: false,
    // Required key + owner/operation/request-hash ledger makes retries stable.
    idempotentHint: true,
  },
  fahali_update_portfolio_watch: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  // These are conditional writes: refresh defaults to true and may persist a
  // new immutable verdict.  Static MCP annotations must describe the most
  // consequential supported invocation, not only refresh=false.
  fahali_get_portfolio_decision: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  fahali_get_watch_delta: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  fahali_subscribe_risk: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  fahali_update_subscription: {
    readOnlyHint: false,
    destructiveHint: true,
    // A target/secret rotates once per required request identity.
    idempotentHint: true,
  },
  fahali_unsubscribe_risk: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
};

function canonicalToolName(name: string): string {
  return LEGACY_TOOL_NAMES[name] ?? name;
}

/** Return the OAuth scopes required by this exact invocation. */
export function requiredOAuthScopesForTool(
  name: string,
  args?: Record<string, unknown>,
): FahaliOAuthScope[] {
  const canonical = canonicalToolName(name);

  if (canonical === "fahali_get_capabilities") return [];
  if (canonical === "fahali_save_memory") return ["write:memory"];
  if (canonical === "fahali_search_memories" || canonical === "fahali_list_agent_sessions") {
    return ["read:memory"];
  }
  if (canonical === "fahali_create_alert") return ["write:alerts"];
  if (canonical === "fahali_watch_portfolio" || canonical === "fahali_update_portfolio_watch") {
    return ["read:portfolio", "write:portfolio"];
  }
  if (canonical === "fahali_get_portfolio_decision" || canonical === "fahali_get_watch_delta") {
    return args?.refresh === false
      ? ["read:portfolio"]
      : ["read:portfolio", "write:portfolio"];
  }
  if (canonical === "fahali_acknowledge_incident") {
    return ["read:portfolio", "write:portfolio"];
  }
  if (canonical === "fahali_subscribe_risk" || canonical === "fahali_update_subscription" || canonical === "fahali_unsubscribe_risk") {
    return ["read:delivery", "write:delivery"];
  }
  if (canonical === "fahali_list_risk_subscriptions") return ["read:delivery"];
  if (canonical === "fahali_get_bundle") {
    const views = Array.isArray(args?.views) ? args.views.map(String) : [];
    return views.some((view) => view === "portfolio" || view === "accounts")
      ? ["read:market", "read:portfolio"]
      : ["read:market"];
  }
  if (PORTFOLIO_READ_TOOLS.has(canonical)) return ["read:portfolio"];
  return ["read:market"];
}

/** MCP execution hints for the public catalogue. */
export function annotationsForTool(name: string): FahaliToolAnnotations {
  const canonical = canonicalToolName(name);
  const mutation = MUTATING_TOOL_ANNOTATIONS[canonical];
  const base = mutation ?? {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  };
  return {
    ...base,
    // Live market reads and delivery operations interact with systems outside
    // this MCP process. Private Fahali memory/history/catalogue reads do not.
    openWorldHint:
      canonical.startsWith("fahali_subscribe_") ||
      canonical === "fahali_update_subscription" ||
      canonical === "fahali_unsubscribe_risk" ||
      !INTERNAL_READ_TOOLS.has(canonical) && !canonical.includes("memory"),
  };
}

for (const tool of TOOL_DEFINITIONS as any[]) {
  const scopes = requiredOAuthScopesForTool(tool.name);
  tool._meta = {
    ...(tool._meta ?? {}),
    oauthScopes: scopes,
    conditionalWrite:
      tool.name === "fahali_get_portfolio_decision" || tool.name === "fahali_get_watch_delta",
    ...(
      tool.name === "fahali_get_portfolio_decision" || tool.name === "fahali_get_watch_delta"
        ? {
            oauthScopeCondition: {
              argument: "refresh",
              default: true,
              whenFalse: ["read:portfolio"],
              otherwise: ["read:portfolio", "write:portfolio"],
            },
          }
        : {}
    ),
  };
}

// Tool descriptions are routing hints, not a hidden manual. Long descriptions
// are truncated by some MCP hosts, which used to cut off the load-bearing enum
// semantics. The full contract now lives in the response envelope and the
// fahali://schema resources; these summaries stay compact enough to survive
// every tool registry we support.
const COMPACT_TOOL_DESCRIPTIONS: Record<string, string> = {
  fahali_get_fall_warnings:
    "8-hour fall-warning board: standing warnings with probability P (the served `fit` block states whether and how it is calibrated) of a >=5% drawdown within 8h, attribution, input census, and the engine's own judged record. Adds findings[], matchedTrackRecord, recordMatchReason, ownStrataCount, record.withheldOnly. Unmeasured inputs are missing data, never calm; 'late' is not a claim; read the own stratum, never the headline.",
  fahali_get_engine_board:
    "Board of any contract engine by key: live claims with probability P (the served `fit` block states whether and how it is calibrated), attribution, input census, health, and the engine's own judged record. Adds findings[], matchedTrackRecord, recordMatchReason, ownStrataCount, record.withheldOnly. Unmeasured inputs are missing data, never calm; read the own stratum, never the headline.",
  fahali_get_market_verdict:
    "Canonical per-symbol judgment and sole direction authority: state, reliability, conflict, forecast, record, invalidation, committee evidence, canonical engine rows, and runtime telemetry. Always-on base-rate blend ensures direction is never withheld; notReturned preserves runtime telemetry for unjudged symbols. Audit defaults to full fidelity; quiet, stale, unavailable, and retired states remain explicit. Committee evidence is non-binding.",
  fahali_get_forecast:
    "Forward distribution for one symbol — ALWAYS served: direction (up | down | range), upside / downside / range probabilities summing to 1 over the declared horizon, expected move, and cone. Read evidenceTier and judged-record reliability; caveats name what was withheld. Probabilities, never certainties; observation is not advice. Requires Agent Starter; a denial returns a typed upgrade object.",
  fahali_get_flash_crash_risk:
    "Current flash-crash precursor activity and affected symbols. The strength value is an uncalibrated detection score, not the probability of a crash. Use the canonical market verdict before stating direction, and the matched judged record before stating performance.",
  fahali_get_detection_activity:
    "Recent detection activity per symbol with bullish and bearish alert counts. This measures what fired, not institutional identity, capital flow, or conviction. Use highest-conviction signals to apply the evidence gate and market verdict to obtain a decision.",
  fahali_get_market_risk_score:
    "Global 0-100 market-risk context from the canonical 24-hour detection snapshot. It is not institution identity, participant positioning, or portfolio-specific risk. Read coverage and snapshot identity with the score.",
  fahali_get_correlation_matrix:
    "Requested-book Pearson correlation from the canonical 45-day covariance artifact, with per-pair observations, alignment policy, and explicit missing coverage. Historical association only: not causality, future correlation, or a contagion direction.",
  fahali_get_contagion_map:
    "One-hour lower-tail-dependence associations with a measured temporal layer. Arrow order is the producer's and does not prove causal transmission. Pairs in the lead-lag graph carry lagHours and leadSymbol: precedence, not causation. Check measurement.edgesWithMeasuredLag; most pairs have none. propagation gives origins, paths and arrival hours, each flagged measured or composed, with symbolsEligible for coverage. sampleSize is recurrence count. High/extreme needs repeated evidence. Requested-book Pearson: fahali_get_correlation_matrix.",
  fahali_get_highest_conviction_signals:
    "Audit current risk forecasts and the complete non-binding committee product: membership, dissent, raw evidence, limitations, invalidation, current canonical-roster evidence rows, and runtime telemetry. Risk and directional conviction remain separate. Use market decision for the canonical direction authority.",
  fahali_get_engine_status:
    "Engine liveness with event-gated, continuous, validation-only, retired, and structurally unattributed states. Incomplete measurements are null; zero is emitted only for a complete empty window and never proves an engine is down. Read dataState and freshness, then use the track-record scorecard for skill; liveness is not accuracy.",
  fahali_get_track_record_scorecard:
    "Judged outcomes by engine, claim family, asset class, regime, and horizon, including misses, recall, precision, base rate, and effective sample. Never turn one row into platform-wide accuracy. A figure is repeatable only when publishable and must travel with its exact stratum and recall.",
  fahali_get_visual_intelligence:
    "Graph-ready instrument clusters derived from current detection activity. Visual intensity and proximity are display rankings, not conviction, capital flow, causality, or direction. Use market verdict to obtain a claim and the glossary for field meanings.",
  fahali_get_realtime_alerts:
    "Recent raw detections with symbols, timestamps, types, severity, and evidence metadata. An alert is an observation, not a verdict or trade instruction. Use symbols, since, limit, and minimum scope controls to keep the response small, then call market verdict for judgment.",
  fahali_get_portfolio_risk:
    "Measured connected-book risk, VaR/expected shortfall, canonical covariance, and per-position monitoring evidence. Direction belongs to the canonical symbol verdict; this stateless surface withholds binding actions and points to the mandate-aware portfolio decision tool.",
  fahali_get_capital_flow:
    "Measured 60-minute USD order-flow imbalance for requested symbols, or the strongest available readings when none are supplied. Zero detector score does not erase netFlowUsd: the score measures unusualness, not data presence. Candle-derived proxy only; no exchange aggressor tape, participant identity, fund-flow attribution, or forecast.",
  fahali_run_shock_test:
    "Apply a sized scenario to connected or supplied positions and report capital impact by holding. This is a deterministic shock unless simulations and probabilities are explicitly returned; null simulations are not hidden Monte Carlo. Supply concrete symbols and signed moves.",
  fahali_get_market_briefing:
    "Current market briefing compressed from measured risk, regime, conviction, and active detections. Use for orientation, not as a substitute for a per-symbol decision. Partial, withheld, stale, and no-coverage states remain explicit.",
  fahali_daily_brief:
    "Lightweight daily orientation for agents that need the market state without a large payload. Returns the key change, why it matters, evidence quality, and next actions. Use market briefing for depth or market verdict for named symbols.",
  fahali_fact_check_narrative:
    "Verify a proposed market narrative before repeating it. Each assertion returns SUPPORTED, CONTRADICTED, NO_READ, UNSUPPORTED_SOURCE, OUT_OF_SCOPE, or UNVERIFIABLE with safeToRepeat. Only SUPPORTED is repeatable; NO_READ is not agreement. The worst assertion determines the summary.",
  fahali_get_lead_time:
    "Verified warning time by exact engine, horizon, regime, and claim family, with recall, precision, base rate, and effective sample. Use headline for a single summary and quote its stratum. Never select a flattering row yourself; null headline means report headlineWithheldReason.",
};

// 🔴 THIS OVERWRITE IS UNCONDITIONAL, so for every tool named in the map the
// description written beside its schema above is DEAD TEXT — no agent ever
// reads it. That is fine for context economy and fatal for honesty drift: a
// caveat added to the detailed description alone is a caveat nobody receives.
// `contagionDescriptionsAgree` in correlationFailureContract.test.ts pins the
// load-bearing claims across both authors so they cannot separate in silence.
for (const tool of TOOL_DEFINITIONS as any[]) {
  const compact = COMPACT_TOOL_DESCRIPTIONS[tool.name];
  if (compact) tool.description = compact;
}

// Universal response controls. These are consumed at the single dispatch seam,
// so every tool gets the same context-economy contract without thirty handlers
// silently accepting and ignoring different knobs.
const RESPONSE_CONTROL_INPUTS = {
  detail: {
    type: "string",
    enum: ["brief", "standard", "audit"],
    default: "audit",
    description: "Response depth. audit is the full-fidelity default; brief and standard are explicit compact projections.",
  },
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    description: "Optional maximum rows per projectable collection. Audit has no MCP projection cap; brief defaults to 3 and standard to 12.",
  },
  symbols: {
    type: ["string", "array"],
    items: { type: "string" },
    description: "Optional symbol projection, as a comma-separated string or array. Rows without instrument identity are not discarded.",
  },
  since: {
    type: "string",
    format: "date-time",
    description: "Optional lower timestamp bound for returned row collections.",
  },
  include_withheld: {
    type: "boolean",
    default: true,
    description: "Include full withheld-row detail. Defaults true with audit; explicitly set false only for a compact projection.",
  },
} as const;

for (const tool of TOOL_DEFINITIONS as any[]) {
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
    tool.inputSchema = { type: "object", properties: {} };
  }
  if (!tool.inputSchema.properties) tool.inputSchema.properties = {};
  for (const [field, spec] of Object.entries(RESPONSE_CONTROL_INPUTS)) {
    if (!tool.inputSchema.properties[field]) tool.inputSchema.properties[field] = spec;
  }
}

// ── The claim contract (spec §4 check 1) ──────────────────────────────────
//
// Every outputSchema must declare `claim`, so a consumer can read what KIND of
// assertion a response is and what it rests on before acting on anything else
// in it.
//
// Declared ONCE here rather than pasted into thirty schemas. Thirty copies of
// one fact is precisely the drift scripts/verify-claim-contract.ts exists to
// catch — the tool count was already living in four hand-maintained copies,
// all four wrong, when that gate was written.
//
// ⚠️ SCOPE, stated plainly: this declares the CONTRACT. It does not prove every
// handler emits a claim on every path — a schema describes shape, not
// behaviour. The emission side is covered by server/tests/claimInvariants.test.ts
// and by the live endpoint verification in Task 13. `claim` is deliberately
// left out of `required` and typed nullable, because saying a field is always
// present when it is not would be the same defect one level up.
const CLAIM_KINDS = ["observation", "estimate", "forecast", "recommendation", "abstention"];
const CLAIM_BASIS_ALL = ["measured", "proxy", "derived", "absent"];
// Proxy-derived tools may never claim "measured": the disclosure in the
// description and the value in the field have to agree.
const CLAIM_BASIS_PROXY = ["proxy", "derived", "absent"];
const PROXY_TOOL_NAMES = new Set([
  "fahali_get_microstructure_proxy",
  "fahali_get_capital_flow",
  "fahali_get_unusual_money_movement",
  "fahali_get_detection_activity",
  "fahali_get_visual_intelligence",
]);

for (const tool of TOOL_DEFINITIONS as any[]) {
  const schema = tool?.outputSchema;
  if (!schema || typeof schema !== "object") continue;
  if (!schema.properties) schema.properties = {};
  if (schema.properties.claim) continue; // a hand-written, more specific claim wins

  const isProxy = PROXY_TOOL_NAMES.has(tool.name);
  schema.properties.claim = {
    type: ["object", "null"],
    description:
      "Fahali dictionary claim (shared/fahaliDictionary.ts). Read `kind` FIRST: " +
      "'abstention' means no assertion was made and `reason` says why — never read " +
      "an abstention as a neutral or zero result. `basis` says what the claim rests " +
      "on" +
      (isProxy
        ? ": this tool is PROXY-derived and can never be 'measured'."
        : ".") +
      " Absent or null means this response path does not yet emit a claim; treat " +
      "that as unknown, not as agreement.",
    properties: {
      kind: { type: "string", enum: CLAIM_KINDS },
      basis: { type: "string", enum: isProxy ? CLAIM_BASIS_PROXY : CLAIM_BASIS_ALL },
      reason: {
        type: "string",
        description: "Required when kind is 'abstention'. Written for a reader, not a log.",
      },
    },
  };
}

// ── The agent-native envelope (2026-08-22) ────────────────────────────────────
//
// Every tool result now leaves with one compact typed judgment and validated
// next actions. Audit prose is optional. Those fields are DECLARED here,
// on one pass over all thirty schemas, for the same reason `claim` is: thirty
// hand-pasted copies of one fact is the drift these gates exist to catch.
//
// Declaring them is not optional decoration. An undeclared field fails
// structuredContent validation on enforcing clients (SDK >=1.29) — and only on
// SUCCESSFUL calls, since error results are exempt. That is precisely how
// `calculationStatus` broke every healthy call while the error paths validated
// clean. See agentPayload.test.ts, which asserts all thirty carry all three.
for (const tool of TOOL_DEFINITIONS as any[]) {
  const schema = tool?.outputSchema;
  if (!schema || typeof schema !== "object") continue;
  if (!schema.properties) schema.properties = {};
  for (const [field, spec] of Object.entries(AGENT_ENVELOPE_SCHEMA)) {
    if (!schema.properties[field]) schema.properties[field] = spec;
  }
}

export type FahaliSurfaceRole = "primary" | "audit" | "operations";

/**
 * The short surface an agent should normally reason through. Everything in
 * this list returns a judgment, advances a durable judgment workflow, or
 * verifies a proposed judgment. Raw sensors intentionally stay out of it.
 */
export const FAHALI_PRIMARY_TOOL_NAMES = [
  "fahali_get_market_decision",
  "fahali_get_symbol_decision",
  "fahali_get_bundle",
  "fahali_get_portfolio_risk",
  "fahali_analyze_custom_portfolio",
  "fahali_watch_portfolio",
  "fahali_get_portfolio_decision",
  "fahali_get_watch_delta",
  "fahali_run_shock_test",
  "fahali_fact_check_narrative",
  "fahali_get_capabilities",
] as const;

/** Operations support a workflow but are not themselves a market judgment. */
export const FAHALI_OPERATION_TOOL_NAMES = [
  "fahali_save_memory",
  "fahali_search_memories",
  "fahali_create_alert",
  "fahali_list_agent_sessions",
  "fahali_list_connected_accounts",
  "fahali_list_portfolio_watches",
  "fahali_update_portfolio_watch",
  "fahali_get_verdict_history",
  "fahali_get_verdict_by_id",
  "fahali_get_evidence",
  "fahali_subscribe_risk",
  "fahali_list_risk_subscriptions",
  "fahali_update_subscription",
  "fahali_unsubscribe_risk",
] as const;

const PRIMARY_TOOL_SET = new Set<string>(FAHALI_PRIMARY_TOOL_NAMES);
const OPERATION_TOOL_SET = new Set<string>(FAHALI_OPERATION_TOOL_NAMES);

export function surfaceRoleForTool(name: string): FahaliSurfaceRole {
  if (PRIMARY_TOOL_SET.has(name)) return "primary";
  if (OPERATION_TOOL_SET.has(name)) return "operations";
  return "audit";
}

// Put the role on tools/list as well as capabilities, so a client does not
// have to call a second endpoint merely to distinguish judgment from sensors.
for (const tool of TOOL_DEFINITIONS as any[]) {
  tool._meta = {
    ...(tool._meta ?? {}),
    surfaceRole: surfaceRoleForTool(tool.name),
    canonicalEntryPoint:
      tool.name === "fahali_get_market_decision" || tool.name === "fahali_get_symbol_decision",
  };
}

export function buildToolTaxonomy(catalog: any[] = TOOL_DEFINITIONS as any[]) {
  const enabled = catalog.filter((tool) => tool?._meta?.disabled !== true);
  const enabledNames = new Set(enabled.map((tool) => String(tool.name)));
  const namesFor = (role: FahaliSurfaceRole) => {
    if (role === "primary") return FAHALI_PRIMARY_TOOL_NAMES.filter((name) => enabledNames.has(name));
    if (role === "operations") return FAHALI_OPERATION_TOOL_NAMES.filter((name) => enabledNames.has(name));
    return enabled
      .filter((tool) => surfaceRoleForTool(String(tool.name)) === "audit")
      .map((tool) => String(tool.name));
  };
  return {
    primary: {
      purpose: "Canonical market judgments and durable monitor-only risk workflows. Portfolio monitoring never grants recommendation, capital, order, or execution authority.",
      tools: namesFor("primary"),
    },
    audit: {
      purpose: "Underlying observations, forecasts, diagnostics, briefings, and judged records used to inspect or challenge a decision.",
      tools: namesFor("audit"),
    },
    operations: {
      purpose: "Account discovery, persistence, history, memory, alerts, and monitor-only delivery controls. These support risk workflows but are not market calls or capital actions.",
      tools: namesFor("operations"),
    },
  };
}

export type FahaliWorkflowStep = {
  tool: string;
  arguments: Record<string, unknown>;
  why: string;
};

export type FahaliCapabilityWorkflow = {
  id: string;
  purpose: string;
  requiresConfirmation: boolean;
  steps: FahaliWorkflowStep[];
};

/**
 * Concrete examples, not prose that merely resembles a call. There are no
 * placeholders: each argument object validates against the live input schema.
 * Write workflows are labelled so an agent can obtain confirmation first.
 */
export const FAHALI_CAPABILITY_WORKFLOWS: FahaliCapabilityWorkflow[] = [
  {
    id: "market_now",
    purpose: "Get Fahali's binding market-wide judgment in one compact call.",
    requiresConfirmation: false,
    steps: [
      {
        tool: "fahali_get_market_decision",
        arguments: { detail: "brief" },
        why: "Start from judgment rather than selecting among raw detectors.",
      },
    ],
  },
  {
    id: "symbol_now",
    purpose: "Get the current binding judgment for one instrument.",
    requiresConfirmation: false,
    steps: [
      {
        tool: "fahali_get_symbol_decision",
        arguments: { symbol: "BTCUSDT", detail: "brief" },
        why: "Resolve one named instrument through the canonical arbiter.",
      },
    ],
  },
  {
    id: "connected_portfolio",
    purpose: "Confirm available accounts, then judge the connected book.",
    requiresConfirmation: false,
    steps: [
      {
        tool: "fahali_list_connected_accounts",
        arguments: { detail: "brief" },
        why: "Establish what portfolio data is actually connected before interpreting risk.",
      },
      {
        tool: "fahali_get_portfolio_risk",
        arguments: { detail: "brief" },
        why: "Return the book-level consequence after account coverage is known.",
      },
    ],
  },
  {
    id: "persist_portfolio_watch",
    purpose: "Create one idempotent monitor-only watch that can be re-evaluated and delivered later.",
    requiresConfirmation: true,
    steps: [
      {
        tool: "fahali_watch_portfolio",
        arguments: {
          idempotency_key: "capability-workflow-watch-v1",
          name: "Capital preservation watch",
          positions: [{ symbol: "BTCUSDT", market_value: 10_000 }],
          mandate: { objective: "capital_preservation", horizon: "5d" },
          detail: "brief",
        },
        why: "Persist positions and monitoring thresholds only after the user approves this write; repeating this exact workflow reuses the same watch.",
      },
    ],
  },
  {
    id: "audit_symbol_decision",
    purpose: "Inspect the forward distribution and judged record behind one current symbol decision.",
    requiresConfirmation: false,
    steps: [
      {
        tool: "fahali_get_symbol_decision",
        arguments: { symbol: "BTCUSDT", detail: "standard" },
        why: "Obtain the binding conclusion first.",
      },
      {
        tool: "fahali_get_forecast",
        arguments: { symbol: "BTCUSDT", detail: "standard" },
        why: "Inspect the forecast distribution without treating detector strength as probability.",
      },
      {
        tool: "fahali_get_lead_time",
        arguments: { detail: "brief" },
        why: "Check the publishable judged record, including recall and withheld strata.",
      },
    ],
  },
];

function workflowStepMatchesLiveContract(step: FahaliWorkflowStep, catalog: any[]): boolean {
  const tool = catalog.find((candidate) => candidate?.name === step.tool);
  if (!tool || tool?._meta?.disabled === true) return false;
  const properties = tool?.inputSchema?.properties ?? {};
  if (Object.keys(step.arguments).some((key) => !(key in properties))) return false;
  const required = Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required : [];
  return required.every((key: string) => Object.prototype.hasOwnProperty.call(step.arguments, key));
}

/** Only expose workflows whose every call still exists and fits its live schema. */
export function executableCapabilityWorkflows(
  catalog: any[] = TOOL_DEFINITIONS as any[],
): FahaliCapabilityWorkflow[] {
  return FAHALI_CAPABILITY_WORKFLOWS.filter((workflow) =>
    workflow.steps.every((step) => workflowStepMatchesLiveContract(step, catalog)),
  );
}
