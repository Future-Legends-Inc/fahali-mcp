# Fahali MCP Server

Market-intelligence MCP server that ships **uncertainty-aware intelligence with provenance** on
every response. Fahali runs an ensemble of independent detection engines across ~2,000 live crypto and US equity/ETF instruments
in real time — public-market absorption patterns, liquidity anomalies, crash precursors, regime shifts — and
detections are tracked against realized market outcomes in a signal→outcome ledger.

> **Informational only — not financial advice.** Fahali detects anomalies; it does not tell you
> or your agent what to buy or sell.

## Tools

<!-- No hand-maintained count. TOOL_DEFINITIONS in src/tools.ts is the one source;
     the machine-readable list is served at https://app.fahaliai.com/.well-known/mcp
     and by tools/list. A number written here drifted to 22 while the server
     shipped 30. scripts/verify-claim-contract.ts fails the build if one reappears
     and disagrees. -->

### Markets & verdict
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_market_decision` | Primary market-wide judgment: what changed, why it matters, horizon, evidence, conflicts, and invalidation | Professional |
| `fahali_get_symbol_decision` | Primary binding judgment for exactly one named instrument | Professional |
| `fahali_get_market_verdict` | Audit-compatible canonical verdict path retained for existing integrations | Professional |
| `fahali_get_market_snapshot` | Live prices, changes, asset class for all instruments | Free |
| `fahali_get_market_regime` | HMM 4-regime detection: bullish/bearish/neutral/high_vol | Professional |
| `fahali_get_market_sentiment` | Sentiment history with score, source, direction | Free |
| `fahali_get_highest_conviction_signals` | Priority risk clusters with risk conviction separated from directional conviction | Free |
| `fahali_daily_brief` | Yesterday vs today market intelligence diff (alert deltas, regime, intel reference) | Free teaser / Professional |

### Risk & crash
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_market_risk_score` | Global 0-100 market-risk context from the canonical detection snapshot; not participant or portfolio risk | Professional |
| `fahali_get_flash_crash_risk` | Uncalibrated early-warning strength and triggers; probability/action withheld unless calibrated | Professional |
| `fahali_get_portfolio_risk` | Risk score, VaR, drawdown, per-position breakdown | Elite |
| `fahali_analyze_custom_portfolio` | Stateless risk, canonical direction reconciliation, and covariance coverage for a supplied book; binding action withheld | Elite |
| `fahali_run_shock_test` | Natural-language scenario stress test with capital at risk | Free |

### Detection activity & flow proxies
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_detection_activity` | Per-symbol detection counts and bullish-versus-bearish alert-type balance; this is alert activity, not executed trade flow | Professional |
| `fahali_get_unusual_money_movement` | Participant-agnostic, candle-derived buy-versus-sell volume imbalance with conflicts and freshness explicit | Professional |
| `fahali_get_microstructure_proxy` | Absorption observations derived from public aggregate trades and order-book snapshots, with source and limitations explicit | Professional |
| `fahali_get_capital_flow` | Measured 60-minute USD buy-vs-sell imbalance for requested symbols, or the strongest available readings. Candle-derived proxy; zero detector score does not erase measured flow | Professional |
| `fahali_get_forecast` | Crash/pump/neutral probabilities with a p10/p50/p90 uncertainty cone over the registered horizon | Professional |
| `fahali_get_lead_time` | Per engine: measured hours of warning ahead of correct calls, misses included. **Quote `headline`** — selected by recall among strata clearing the publication floor with positive lift. Never cherry-pick; always name the class and horizon | Free |
| `fahali_get_market_briefing` | Full executive market analysis for today; PARTIAL when subsystems disagree | Professional |

### Contagion & correlation
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_contagion_map` | Contagion graph with tail-dependence edges and clusters | Elite |
| `fahali_get_correlation_matrix` | Requested-book Pearson matrix from the canonical 45-day covariance artifact, with pair observations and coverage | Free |

### Portfolio & alerts
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_portfolio_metrics` | Sentiment momentum, cascade risk, liquidity stress, leverage | Professional |
| `fahali_get_realtime_alerts` | Unified detection feed from the active fleet right now | Professional |

### Persistent monitoring, history & delivery
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_watch_portfolio` | Durable portfolio + mandate + thresholds; evaluates immediately and continuously | Elite |
| `fahali_list_portfolio_watches` | Existing watches, sources, mandates, cadence and latest verdict IDs | Elite |
| `fahali_update_portfolio_watch` | Update positions or mandate and immediately see the new judgment | Elite |
| `fahali_get_portfolio_decision` | Binding HOLD/WATCH/REDUCE/EXIT judgment with what, why, when and invalidation | Elite |
| `fahali_get_watch_delta` | What changed since the previous immutable judgment and why | Elite |
| `fahali_get_verdict_history` | Cursor- and time-queryable immutable replay, including `as_of` | Elite |
| `fahali_get_verdict_by_id` | One permanent judgment with its evidence and content hashes | Elite |
| `fahali_subscribe_risk` | Signed webhook/callback, Slack, Teams, account email or registered push delivery | Elite |
| `fahali_list_risk_subscriptions` | Delivery configuration and health without exposing secrets | Elite |
| `fahali_update_subscription` | Pause, resume, filter or rotate a delivery target | Elite |
| `fahali_unsubscribe_risk` | Stop delivery while preserving its audit trail | Elite |

The monitor stores only user-scoped positions, mandate and evidence references. Callback
configuration is encrypted. Delivery is deduplicated through a durable outbox, retried after
transient failures, and marked failed rather than reported as sent when a channel does not accept it.

### Proof & system
| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_track_record_scorecard` | Honest 4-axis accuracy with base-rate lift | Professional |
| `fahali_get_case_studies` | 40 verified signal→outcome cases with track record | Professional |
| `fahali_get_engine_status` | Liveness report for the active detection fleet | Free |
| `fahali_get_visual_intelligence` | Unified constellation graph of the active fleet | Free |

## Connect (remote SSE)

```
SSE endpoint:  https://mcp.fahaliai.com/sse
Auth:          Authorization: Bearer <your sk_live_ key>
               OAuth is preferred. Query-string keys are legacy-only because URLs may be logged.
```

**Bring your own API key.** Create one free in the Fahali app:
[app.fahaliai.com/developer](https://app.fahaliai.com/developer) (sign in → Developer / API).

- **Free developer key** — the canonical market-decision path (`fahali_get_market_decision`, `fahali_get_symbol_decision`, and the compatible `fahali_get_market_verdict`) with reduced depth, 50 calls/day.
- **Full key** (Professional tier and above) — all tools at your subscription tier.

## Local / stdio

```bash
npm install && npm run build
FAHALI_API_KEY=sk_live_... node dist/index.js --stdio
```

Claude Desktop config:

```json
{
  "mcpServers": {
    "fahali": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js", "--stdio"],
      "env": { "FAHALI_API_KEY": "sk_live_..." }
    }
  }
}
```

Cursor config (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "fahali": {
      "type": "sse",
      "url": "https://mcp.fahaliai.com/sse?api_key=sk_live_..."
    }
  }
}
```

Windsurf config: open **Settings → Cascade → MCP**, click **Add custom server**, and paste:

```json
{
  "mcpServers": {
    "fahali": {
      "type": "sse",
      "url": "https://mcp.fahaliai.com/sse?api_key=sk_live_..."
    }
  }
}
```

Or edit Windsurf's MCP config file directly (location varies by OS; use the UI if unsure).

## Why this server

Most market-data MCP servers proxy raw prices. Fahali returns **judged intelligence**: each
verdict carries a confidence score, the reasoning chain that produced it, and provenance you can
audit. Detection accuracy is measured continuously against realized outcomes — engines that
haven't earned a number report "calibrating", never an invented one.

- API reference: https://app.fahaliai.com/openapi.json
- Methodology: https://fahaliai.com/methodology
- Pricing: https://app.fahaliai.com/pricing

*Multi-tenant: each SSE connection is isolated with its own key; keys are never shared across
sessions. Informational only, not financial advice.*
