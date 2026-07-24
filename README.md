# Fahali — Financial Risk MCP Server for AI Agents

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-com.fahaliai%2Ffahali-C9A961)](https://registry.modelcontextprotocol.io/v0/servers?search=fahali)
[![Methodology](https://img.shields.io/badge/judged%20publicly-misses%20included-0B0A09)](https://fahaliai.com/methodology)

**Give your agent a risk conscience.** Fahali gives AI agents a callable financial-risk layer: portfolio risk, stress losses, crypto risk, contagion, crash precursors and market verdicts. Read-only — your agent already fetches prices; Fahali tells it what those prices mean for capital at risk. It returns a judged read with its confidence, the inputs it is missing, and a signed receipt, so your agent can check its own conviction against something scored against outcomes instead of raw prices it has to interpret blindly.

> **Observation, not advice.** Fahali watches and explains market risk. It never tells you or your agent what to buy or sell. Read-only: no order routing, no path to capital.

## Why an agent cites Fahali instead of a price feed

- **Verified lead time.** Per engine, the median hours ahead of the move on its correct material warnings, scored against what happened, with the misses in the same record. Your agent can weight a signal by proven lead, not by tone. Public, no key: `GET /api/track-record/lead-time`.
- **Signed receipts.** Every verdict carries a SHA-256 receipt and a provenance root. When your agent quotes Fahali, it can attach proof of what was said and when.
- **A judged record with public replays.** Every signal is scored against a disclosed, versioned method at its own horizon. Wrong calls stay on the record. Methodology: [fahaliai.com/methodology](https://fahaliai.com/methodology).
- **Honest absence.** Missing data says so. Quiet markets resolve as unresolved, never as wins. Some tools abstain by design: whale tracking returns an explicit "no on-chain data source" rather than inventing positions.

Coverage is crypto 24/7 and US equities and ETFs during market hours. Live coverage and engine counts are reported at `GET /api/public/stats` rather than asserted here, because the active set changes.

## See it before you sign up

The lead-time record is public. This is the fastest way to confirm Fahali is scored against outcomes:

```bash
curl https://app.fahaliai.com/api/track-record/lead-time
```

## Connect

**Remote MCP (recommended, nothing to install):**

```
Streamable HTTP:  https://mcp.fahaliai.com/mcp
SSE (legacy):     https://mcp.fahaliai.com/sse
```

Auth: OAuth 2.1 ("Connect with Fahali") or a static key, `Authorization: Bearer sk_live_...`. Grab a free developer key (50 calls/day, no card) at [app.fahaliai.com/developer](https://app.fahaliai.com/developer). In Claude, ChatGPT, or Cursor, add the URL above as a connector. Listed in the official MCP registry as `com.fahaliai/fahali`.

**Run this repo as a local stdio proxy:**

```bash
npm install
npm run build
FAHALI_API_KEY=sk_live_... node dist/index.js --stdio
```

It forwards each tool call to the upstream Fahali API; tier is enforced upstream.

## Example: a pre-trade risk check

[`examples/pre-trade-check`](examples/pre-trade-check) is a runnable agent (zero dependencies, one command) that asks Fahali, before a position is opened: is a flash-crash precursor firing, what is the judged read and what data is missing, and how early does the record say this engine usually warns. It then prints a `PROCEED` / `CAUTION` / `HOLD` posture and the receipt.

## Tools

Around 30 tools. Most are read-only market intelligence; a few agent-workspace tools (memory, custom alerts) write only to your own workspace, never to markets. Highlights:

| Tool | Returns |
|------|---------|
| `fahali_get_market_verdict` | Per-symbol verdict: direction, confidence, reasoning, expected move, horizon |
| `fahali_get_lead_time` | The verified, outcome-scored lead-time record (public) |
| `fahali_get_72h_forecast` | Probabilistic 72h forecast with an uncertainty cone, Brier-scored |
| `fahali_get_flash_crash_risk` | Flash-crash precursor strength, or an explicit abstention |
| `fahali_get_track_record_scorecard` | The judged record with per-horizon base rates and lift |
| `fahali_get_contagion_map` | Cross-asset tail-dependence and correlated clusters |
| `fahali_get_dark_pool_activity` | Off-tape absorption, labeled as a microstructure proxy |
| `fahali_get_capital_flow` | Order-flow imbalance proxy (no fabricated institutional/retail split) |
| `fahali_get_market_regime` | Current regime read |
| `fahali_run_shock_test` | Stress-test a portfolio against a scenario |

Full tool schemas: [mcp.fahaliai.com](https://mcp.fahaliai.com/).

## Pricing

Free developer key (50 calls/day) for exploration. Agent lanes from $49/mo (10k calls), $199 (100k), $999 (1M). Human app tiers from $19/mo at [fahaliai.com](https://fahaliai.com).

## Links

- App: [app.fahaliai.com](https://app.fahaliai.com)
- MCP docs / health: [mcp.fahaliai.com](https://mcp.fahaliai.com/)
- Methodology (how signals are graded): [fahaliai.com/methodology](https://fahaliai.com/methodology)
- Developer / API: [fahaliai.com/developer](https://fahaliai.com/developer)
- Privacy: [app.fahaliai.com/privacy](https://app.fahaliai.com/privacy)

Built by [Future Legends Inc](https://fahaliai.com). Observation, not advice.
