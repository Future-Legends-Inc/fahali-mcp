# Fahali + OpenAI Agents SDK Example

A market Q&A agent using the OpenAI Agents SDK MCP integration.

## Prerequisites

- Python 3.10+
- A Fahali API key (free: https://fahaliai.com/developer)

## Setup

```bash
pip install openai-agents
```

## Usage

```python
from agents import Agent, Runner
from agents.mcp import MCPServer

# Connect to Fahali's MCP server
async with MCPServer(
    url="https://mcp.fahaliai.com/sse?api_key=YOUR_API_KEY",
) as server:

    agent = Agent(
        name="FahaliMarketAnalyst",
        instructions="You are a market intelligence assistant. Use Fahali tools to answer market questions. Observation, not advice.",
        mcp_servers=[server],
    )

    result = await Runner.run(agent, "How are the markets today? Is BTC risky?")
    print(result.final_output)
```

## Available tools

The live Fahali catalog is loaded from the MCP server. Key tools include:
- `fahali_get_market_verdict` — direction, confidence, reasoning
- `fahali_get_market_risk_score` — 0-100 global market-risk context (not participant or portfolio identity)
- `fahali_daily_brief` — yesterday vs today diff
- `fahali_get_flash_crash_risk` — uncalibrated crash-precursor strength per symbol; not crash probability

## Observation, not advice

Fahali provides market intelligence only. No financial advice.
