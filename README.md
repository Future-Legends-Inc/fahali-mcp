# Fahali MCP Server

Market-intelligence MCP server that ships **calibrated uncertainty and provenance** with every
response. Fahali runs 18 detection engines over 9,200+ instruments (crypto, equities, ETFs) in
real time — dark-pool activity, liquidity anomalies, crash precursors, regime shifts — and every
detection is scored against realized market outcomes in a verified signal→outcome ledger.

> **Informational only — not financial advice.** Fahali detects anomalies; it does not tell you
> or your agent what to buy or sell.

## Tools

| Tool | What it returns | Minimum tier |
|------|-----------------|--------------|
| `fahali_get_market_verdict` | Structured market verdict per symbol: direction, confidence, reasoning chain, expected move, horizon | Free key (teaser) / Professional |
| `fahali_get_portfolio_risk` | Portfolio risk assessment: risk score, VaR, drawdown, per-position breakdown | Elite |
| `fahali_get_contagion_map` | Cross-asset contagion map: nodes, pairwise tail-dependence edges, correlated clusters | Elite |
| `fahali_get_capital_flow` | Capital-flow intelligence per symbol: net flow, institutional vs retail, whale activity | Professional |

## Connect (remote SSE)

```
SSE endpoint:  https://mcp.fahaliai.com/sse
Auth:          Authorization: Bearer <your sk_live_ key>
               (or append ?api_key=<key> to the SSE URL if your client can't set headers)
```

**Bring your own API key.** Create one free in the Fahali app:
[app.fahaliai.com/developer](https://app.fahaliai.com/developer) (sign in → Developer / API).

- **Free developer key** — `fahali_get_market_verdict` only, reduced depth, 50 calls/day.
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
