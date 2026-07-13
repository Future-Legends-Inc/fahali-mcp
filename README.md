# Fahali MCP Server

[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Launching%20Jul%2014-FF6154?logo=producthunt&logoColor=white)](https://www.producthunt.com/posts/fahali)
[![npm](https://img.shields.io/npm/v/fahali?label=npm&color=cb3837&logo=npm)](https://www.npmjs.com/package/fahali)
[![PyPI](https://img.shields.io/pypi/v/fahali?label=pypi&color=3775A9&logo=pypi&logoColor=white)](https://pypi.org/project/fahali/)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-com.fahaliai%2Ffahali-C9A961)](https://registry.modelcontextprotocol.io/v0/servers?search=fahali)
[![Methodology](https://img.shields.io/badge/judged%20publicly-misses%20included-0B0A09)](https://fahaliai.com/methodology)

**Market-risk intelligence your AI agent can call.** Fahali gives agents structured, read-only *judgment* about markets — direction, confidence, reasoning, expected move, contagion, crash precursors — instead of raw prices they have to interpret blindly.

> **Informational only — not financial advice.** Fahali observes and explains risk. It never tells you or your agent what to buy or sell. No order routing, no path to capital.

## What makes it different

Most market APIs hand an LLM data exhaust and hope it reasons well. Fahali hands it a **verdict with a receipt**:

- **18 detection engines** scan **~840 instruments per cycle** across a **2,000+ instrument universe** — crypto 24/7 and US equities/ETFs during market hours. Anomaly, capital flow, market regime, dark-pool proxy, whale activity, funding stress, liquidation cascade, tail-dependence/contagion, and 72-hour crash-precursor forecasting.
- **An adaptive ensemble** re-weights those 18 engines every 15 minutes based on which ones have been *right lately*, per market regime.
- **Every served claim is judged against realized outcomes** and gets a **permanent, public replay URL** — hits *and* misses. The full grading methodology is published at [fahaliai.com/methodology](https://fahaliai.com/methodology). Engines without enough resolved outcomes report `calibrating` — never an invented number.

That last point is the whole thesis: an agent (or the human behind it) can audit any Fahali claim against what the market actually did. Example receipts, misses included, live at [app.fahaliai.com](https://app.fahaliai.com).

## Connect

**Remote MCP** (recommended — nothing to install):

```
Streamable HTTP:  https://mcp.fahaliai.com/mcp
SSE (legacy):     https://mcp.fahaliai.com/sse
```

Auth: **OAuth 2.1** ("Connect with Fahali") or a static key — `Authorization: Bearer sk_live_...`. Grab a **free developer key (50 calls/day)** at [app.fahaliai.com/developer](https://app.fahaliai.com/developer).

**Claude / ChatGPT / Cursor:** add the remote MCP URL above as a connector. Listed in the official MCP registry as `com.fahaliai/fahali`.

**SDKs** for building agents directly:

```bash
npm install fahali      # TypeScript — OpenAI tools format + Vercel AI SDK / LangChain adapters
pip install fahali      # Python — LangChain / CrewAI / LlamaIndex adapters
```

## Tools (25)

Market-intelligence tools are **strictly read-only**. A few optional agent-memory and custom-alert tools write only to your own agent workspace, never to markets.

| Tool | Returns |
|------|---------|
| `fahali_get_market_verdict` | Per-symbol verdict: direction, confidence, reasoning chain, expected move, horizon |
| `fahali_get_72h_forecast` | Probabilistic 72h forecast: crash/neutral/pump probabilities, expected return, uncertainty cone |
| `fahali_get_portfolio_risk` | Portfolio risk: score, VaR, drawdown, per-position breakdown |
| `fahali_get_flash_crash_risk` | Flash-crash precursor signals |
| `fahali_get_whale_activity` | Large-order / whale flow |
| `fahali_get_dark_pool_activity` | Off-tape absorption (proxy) |
| `fahali_get_contagion_map` | Cross-asset tail-dependence / correlated clusters |
| `fahali_get_capital_flow` | Net flow, institutional vs retail, per symbol |
| `fahali_get_market_regime` | Current regime read (HMM-based) |
| `fahali_get_track_record_scorecard` | The judged record with per-horizon base rates |
| `fahali_run_shock_test` | Stress-test a portfolio against a scenario |
| … | 14 more — market snapshot, sentiment, correlation matrix, case studies, engine status, briefing, and agent-workspace tools |

Full tool schemas: [mcp.fahaliai.com](https://mcp.fahaliai.com/).

## Pricing

Free developer key (50 calls/day) for exploration. Agent lanes from $49/mo (10k calls) → $199 (100k) → $999 (1M). Human app tiers from $19/mo at [fahaliai.com](https://fahaliai.com).

## Links

- App: [app.fahaliai.com](https://app.fahaliai.com)
- MCP docs / health: [mcp.fahaliai.com](https://mcp.fahaliai.com/)
- Methodology (how signals are graded): [fahaliai.com/methodology](https://fahaliai.com/methodology)
- Developer / API: [fahaliai.com/developer](https://fahaliai.com/developer)
- Privacy: [app.fahaliai.com/privacy](https://app.fahaliai.com/privacy)

Built by [Future Legends Inc](https://fahaliai.com). Observation, not advice.
