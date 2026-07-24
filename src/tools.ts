/**
 * Tool definitions for the Fahali MCP server (remote proxy).
 * Each tool maps to an upstream Fahali HTTP endpoint via _meta.endpoint.
 * Descriptions and input schemas are the canonical, provenance-honest set;
 * outputSchema is intentionally omitted because the proxy returns text content
 * (no structuredContent), matching the MCP SDK tool contract.
 * Tier is enforced upstream; the _meta.requiredTier annotation is advisory.
 */

export const TOOL_DEFINITIONS = [
  {
    name: "fahali_get_market_verdict",
    description:
      "Get structured market verdict for one or more symbols. Direction and expected move are set by Fahali's canonical verdict arbiter — the same policy that renders the app — composing committee evidence, the 72h probabilistic forecast, and the judged track record; the full arbiter read (state WATCH/DEFEND/NORMAL/WITHHOLD, reliability grade, conflict flag, policy version) rides in each item's `canonical` field. Also returns confidence, reasoning chain, and forecast horizon. Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "string", description: "Comma-separated trading symbols (e.g. 'BTCUSDT,ETHUSDT'). Omitting returns top signals across all symbols." },
        includeContagion: { type: "boolean", description: "If true, enriches response with contagion risk from tail_dependence engine. Contagion enrichment requires Elite tier.", default: false },
      },
    },
    
    _meta: { requiredTier: "professional", endpoint: "/agent/verdict" },
  },
  {
    name: "fahali_get_72h_forecast",
    description:
      "Get the forward-looking probabilistic forecast for a symbol: crash / pump / neutral probabilities (normalized), expected return, a 12-point p10/p50/p90 uncertainty cone over the next 72 hours, per-engine driver contributions, and (when the sample is meaningful) historical similar-setup accuracy. Composed from live pending predictions (early_warning, crash_predictor, risk_intelligence_72h) blended with directional alert votes — individual signals carry horizons of 6-72h; `horizon` reports the top evidence's actual timeframe, not a blanket 72h. IMPORTANT — most Fahali agents are DETECTORS (risk / structure / anomaly / volatility), NOT trade-signal generators: each driver carries a `role` (detector|forecaster) and `tier` (actionable|context|observation). Treat a driver's `observation` as what it detected, never as buy/sell. The forecast's `stance` says how to read the crash/pump headline: `directional` = a forecaster has a calibrated edge; `risk_defensive` = a risk detector does; `observation` = detectors flagged conditions but nothing is an actionable directional call. `detectionConfidence` (how strong the pattern is) and `outcomeProbability` (calibrated P(correct) from realized outcomes) are separate — do not read detection strength as a hit probability. Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Trading symbol (e.g. 'BTCUSDT'). Required." },
        include: { type: "string", description: "Optional comma-separated extras: 'reasoning,history'." },
      },
      required: ["symbol"],
    },
    
    _meta: { requiredTier: "professional", endpoint: "/api/forecast/72h" },
  },
  {
    name: "fahali_get_dark_pool_activity",
    description:
      "Get dark pool proxy estimates. Returns symbols with a dark-pool proxy score (estimated from public market microstructure, not actual off-exchange measurements), likely patterns, institutional sentiment direction, and ML breakdown. This is a proxy — Fahali does not have direct off-exchange data. Covers the dark_pool engine. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/institutional/dark-pool" },
  },
  {
    name: "fahali_get_flash_crash_risk",
    description:
      "Per-symbol flash-crash PRECURSOR detection strength — NOT a calibrated crash probability. Each signal's detectionStrength = risk_weight(alert_type) × alert_confidence (calibrated:false); it ranks which symbols are flashing precursor signals, it is NOT P(crash). Fahali has no calibrated crash-probability, time-to-crash, or move-magnitude model, so those are not returned. Actionability is withheld (the flash_crash_precursor engine's realized lift over base rate is ~0). Read dataOrigin + disclaimer. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/risk/flash-crash" },
  },
  {
    name: "fahali_get_smart_money_dashboard",
    description:
      "Recent DETECTION-ALERT activity — NOT institutional or on-chain 'smart money' flow (Fahali ingests no on-chain/venue order-flow feed). Returns distinct symbols with recent alerts, a recent-detection count, the bullish-vs-bearish lean of recent alert TYPES, the most-alerted symbol, and alert-derived sentiment. Field names are literal: 'symbolsWithRecentDetections' is a symbol count (NOT institutions); 'alertLean' (bullish/bearish/neutral) is the alert-type balance (NOT institutional buying/selling). Read dataOrigin + disclaimer. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/institutional/smart-money" },
  },
  {
    name: "fahali_get_whale_activity",
    description:
      "ABSTAINS by policy. Whale / large-holder tracking requires an on-chain or venue-level order-flow data source that Fahali does not ingest, so this tool returns status:'ABSTAIN' (abstentionReason:'NO_ONCHAIN_DATA_SOURCE') with an empty activities array — it does NOT fabricate whale positions, targets, or probabilities from alert confidence. For the real detections previously reframed here, use fahali_get_market_verdict or fahali_get_realtime_alerts. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/institutional/whale-activity" },
  },
  {
    name: "fahali_get_institutional_risk_score",
    description:
      "Get computed institutional risk score from weighted detection engine signals. Returns overall score (0-100), risk level (critical/high/moderate/low), narrative observation, breakdown by component, and detection count. Crash component is capped at 50 to prevent single-sided saturation. Observation, not advice. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/institutional/risk" },
  },
  {
    name: "fahali_get_correlation_matrix",
    description:
      "Get cross-asset correlation matrix from the tail_dependence engine. Returns per-symbol correlation with market, dependence strength, list of affected correlated symbols, contagion risk level, and timestamp. Covers the correlation and tail_dependence engines. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/correlation/cross-asset" },
  },
  {
    name: "fahali_get_market_sentiment",
    description:
      "Get market sentiment history from news and detection signals. Supports optional symbol filter. Returns sentiment score, confidence, direction (bullish/bearish/neutral), source, and news count per entry. Covers the momentum and volume_anomaly engines. Public data — no tier required.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Optional trading symbol filter (e.g. 'BTCUSDT'). Omitting returns aggregate market sentiment." },
        limit: { type: "number", description: "Maximum number of sentiment entries to return (default 20)." },
      },
    },
    
    _meta: { requiredTier: "free", endpoint: "/api/sentiment/history" },
  },
  {
    name: "fahali_get_highest_conviction_signals",
    description:
      "Get highest-conviction multi-engine consensus signals. Returns symbols with 2+ canonical detection engines agreeing, ranked by engine count and directional decisiveness. Each entry includes engine list (normalized to canonical 18-agent keys), severity, action direction (buy/sell/neutral), latest timestamp, and provenance annotations. All engine names are validated against the canonical 18-agent registry. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/insights/conviction" },
  },
  {
    name: "fahali_get_market_snapshot",
    description:
      "Get live market snapshot with prices, changes, asset class, venue, and underlying for all monitored instruments. Defaults to the first 50 assets. Supports compact mode (symbol+price only) for large context windows. Public data — no tier required.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max assets to return (default 50, max 800)" },
        sort_by: { type: "string", enum: ["symbol", "change", "volume"], description: "Sort field (default symbol)" },
        compact: { type: "boolean", description: "When true, returns symbol+price+change only (drops volume/assetClass/venue)" },
        asset_class: { type: "string", enum: ["crypto", "us_equity", "us_etf"], description: "Filter by asset class" },
      },
    },
    
    _meta: { requiredTier: "free", endpoint: "/api/market/snapshot" },
  },
  {
    name: "fahali_get_engine_status",
    description:
      "Get liveness report for all detection engines. Returns per-engine status: last fired timestamp, event count in 1h/24h/7d windows, current status (active/dormant/error), and human-readable interpretation. Also includes market context and unmapped alert type inventory. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/engines/status" },
  },
  {
    name: "fahali_get_case_studies",
    description:
      "Get verified case studies from the resolved signal-outcome moat. Returns 40 time-diverse cases with: symbol, alert type, confidence, direction (bullish/bearish/neutral), entry price, outcome price, profit/loss percent, correctness boolean, outcome kind (direction/magnitude/volatility/crash_catch), and 4h/24h returns. Covers the walk_forward engine. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/case-studies" },
  },
  {
    name: "fahali_get_track_record_scorecard",
    description:
      "Get the honest 4-axis track record scorecard. Returns direction accuracy, magnitude precision, crash catch rate, and volatility assessment — each with base-rate lift vs raw hit-rate. Includes blended aggregate and base rate context. Do NOT cite raw percentages without the base rate lift. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/track-record/scorecard" },
  },
  {
    name: "fahali_get_portfolio_metrics",
    description:
      "Get aggregate portfolio risk metrics. Returns sentiment momentum (bullish vs bearish signal balance), cascade risk score, liquidity stress score, and signal stress level (derived from leverage/derivative signal confidences). Synthesizes data from leverage, funding_stress, and volume_anomaly engines. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/portfolio/metrics" },
  },
  {
    name: "fahali_get_market_regime",
    description:
      "Get detected market regime from the HMM 4-regime engine when available. Returns regime type (bullish/bearish/neutral/high_vol or null), volatility, trend, and expected return. Returns empty array + nulls when HMM regime data is not currently persisted (data availability depends on detection-layer writes). Covers the market_regime engine. Observation, not advice. Requires authentication.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/temporal/regimes" },
  },
  {
    name: "fahali_get_visual_intelligence",
    description:
      "Get the visual intelligence constellation — a unified snapshot of all 18 detection engines rendered as interactive graph nodes. Returns nodes (symbol, radius, glow intensity, status, stress, ETF exposure, gamma exposure, institutional flow, trigger event), inter-node flows (source, target, value, velocity), vortex metadata (active, intensity, gravitational pull, label), signal strength, and market context. Covers ALL 18 engines in one snapshot. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/spectra/visual-intelligence" },
  },
  {
    name: "fahali_get_realtime_alerts",
    description:
      "Get realtime detection feed clustered by (symbol, thesis). Each cluster represents one active thesis on one symbol with an evidence array of confirmations — reduces context consumption ~3-5x vs ungrouped rows. Each cluster's `detectionConfidence` is the engine's RAW detection confidence (0-1), NOT a calibrated hit probability or actionability — it is null when the alert carries none (never a fabricated 0.5). For judged reliability use fahali_get_track_record_scorecard; for the arbitrated read use fahali_get_market_verdict. Public data — no tier required.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/spectra/realtime" },
  },
  {
    name: "fahali_get_portfolio_risk",
    description:
      "Get portfolio risk assessment for your connected exchange accounts. Returns overall risk score (0-100), value-at-risk (VaR95), expected drawdown, per-position risk breakdown with symbol-level recommendations (REDUCE/HEDGE/MONITOR), and contagion risk. Requires connected exchange accounts. Requires Elite tier or higher.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "elite", endpoint: "/agent/portfolio-risk", method: "GET" },
  },
  {
    name: "fahali_analyze_custom_portfolio",
    description:
      "Analyze risk for a custom portfolio that you provide inline (no connected accounts needed). Accepts positions array with symbol, market_value, quantity, avg_cost, and side. Returns the same risk breakdown as get_portfolio_risk: VaR95, drawdown, per-position risk scores, recommendations, and contagion risk. Useful for what-if analysis or evaluating a portfolio before you connect accounts.",
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
          description: "Alternative to positions: comma-separated symbol names (each assumed $10k equal-weight).",
        },
      },
    },
    
    _meta: { requiredTier: "free", endpoint: "/agent/portfolio-risk", method: "POST" },
  },
  {
    name: "fahali_get_contagion_map",
    description:
      "Get cross-asset contagion and tail dependence map. Returns nodes (symbols with risk scores), edges (pairwise correlation strength, confidence, time to materialize), and clusters of correlated assets with lead symbols. Covers the tail_dependence and correlation engines. Requires Elite tier or higher.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "elite", endpoint: "/agent/contagion" },
  },
  {
    name: "fahali_get_capital_flow",
    description:
      "Order-flow IMBALANCE proxy for a symbol — NOT measured exchange tape or true USD capital flow. Returns netFlowUsd = the latest rolling (buy-sell)*price from the order_flow engine's candle-derived volume estimate (a proxy), plus direction (inflow/outflow/neutral), engine confidence, and flow trend. There is NO institutional-vs-retail or whale decomposition (no data source), so those are not returned. Read dataOrigin + disclaimer. Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Trading symbol (e.g. 'BTCUSDT'). Required." },
      },
      required: ["symbol"],
    },
    
    _meta: { requiredTier: "professional", endpoint: "/agent/capital-flow" },
  },
  {
    name: "fahali_run_shock_test",
    description:
      "Run a natural-language stress test on a portfolio. Describe a scenario (e.g. 'Stress test against 2020 COVID crash combined with 20% Yen devaluation') and optionally provide custom positions. Returns scenario simulations with market drop, probability, expected drawdown, most vulnerable symbols, and estimated capital at risk. Requires authentication.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: { type: "string", description: "Natural language scenario description (e.g. 'COVID crash + Yen devaluation + counterparty freeze')." },
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Trading symbol." },
              market_value: { type: "number", description: "Current market value in USD." },
              quantity: { type: "number", description: "Units held (optional)." },
            },
            required: ["symbol", "market_value"],
          },
          description: "Optional custom positions. If omitted, uses connected accounts.",
        },
      },
    },
    
    _meta: { requiredTier: "free", endpoint: "/api/portfolio/shock-test", method: "POST" },
  },
  {
    name: "fahali_get_market_briefing",
    description:
      "Full executive market analysis for today — synthesized market risk breakdown, HMM regime (when available), smart-money flow, top multi-engine opportunities, contributing engines, and crash-risk summary. This is the complete answer to 'market analysis for today'. Composition of existing detection components only. For a lightweight yesterday-vs-today delta teaser use fahali_daily_brief. Public — no tier required. Observation, not advice.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/agent/market-briefing" },
  },
  {
    name: "fahali_daily_brief",
    description:
      "Get a yesterday-vs-today delta teaser: alert volume change, risk score, top signal, and HMM market regime (when available). Lightweight, fast. Free tier returns risk score + regime + top signal + headline. Professional tier gets full alert_activity delta with prior-period comparison. For full executive market analysis (risk breakdown, smart-money flow, top opportunities, contributing engines) use fahali_get_market_briefing. Sources: alerts, spectra_layer_aggregations. Observation, not financial advice.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/agent/daily-brief" },
  },
  // ====== WRITE TOOLS (tier-gated) ======
  {
    name: "save_memory",
    description: "Save a memory to the agent memory store. Memories persist across sessions for a given agent. Memory types: episodic (specific experiences), semantic (facts/knowledge), procedural (how-to). Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Unique key for the memory (namespaced, e.g. 'user:preferred_ticker')." },
        value: { type: "object", description: "The memory payload — any JSON-serializable object." },
        memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], description: "Memory classification (default: semantic)." },
      },
      required: ["key", "value"],
    },
    
    _meta: { requiredTier: "professional", endpoint: "/api/v1/agent/memory", method: "POST" },
  },
  {
    name: "search_memories",
    description: "Semantic search across agent memories. Returns memories matching the search query using vector similarity (when available) or text ILIKE fallback. Requires Professional tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to match against memory keys and values." },
        limit: { type: "number", description: "Maximum results (default 10, max 50)." },
      },
      required: ["query"],
    },
    
    _meta: { requiredTier: "professional", endpoint: "/api/v1/agent/memory", method: "GET" },
  },
  {
    name: "create_alert",
    description: "Create a custom alert. Agent-created alerts appear in the in-app realtime feed, hard-marked with an agent_ type prefix so they are never confused with engine detections; they do not trigger push/SMS to other users, and severity is capped at high (critical is reserved for engines). Requires Elite tier or higher.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Trading symbol (e.g. 'BTCUSDT')." },
        alert_type: { type: "string", description: "Alert classification (e.g. 'agent_insight', 'custom_pattern')." },
        message: { type: "string", description: "Human-readable alert message." },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Severity level." },
        confidence: { type: "number", description: "Confidence score 0-1 (optional, default 0.5)." },
      },
      required: ["symbol", "alert_type", "message", "severity"],
    },
    
    _meta: { requiredTier: "elite", endpoint: "/agent/alerts", method: "POST" },
  },
  {
    name: "list_agent_sessions",
    description: "List all sessions for the current agent. Returns session metadata including first seen, last active, memory count, and active status. Requires Professional tier or higher.",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "professional", endpoint: "/api/v1/agent/sessions", method: "GET" },
  },
  {
    name: "fahali_get_lead_time",
    description: "Verified Lead Time (VLT) per engine stratum — how many hours of warning before an adverse move crossed the judgment bar. Returns recall, p25/median/p75 lead time, precision, base rate, and effective sample per (engine, horizon_tier, bar_regime). Engines below their base rate return ABSTAIN. Public, no tier gate. Methodology and misses: fahaliai.com/methodology#vlt",
    inputSchema: { type: "object", properties: {} },
    
    _meta: { requiredTier: "free", endpoint: "/api/track-record/lead-time", method: "GET" },
  },
];