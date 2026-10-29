# Fahali + LangChain Example

Drop a verifiable market analyst into your LangChain agent in one block.

This example uses `langchain-mcp-adapters` to load Fahali's MCP tools and answer market questions.

## Prerequisites

- Node.js 18+
- A Fahali API key (free: https://fahaliai.com/developer)

## Setup

```bash
npm install @langchain/core langchain @langchain/langgraph langchain-mcp-adapters
```

## Usage

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mcpClientToTool } from "langchain-mcp-adapters";

// Connect to Fahali's MCP server
const client = new Client({
  name: "fahali-langchain-example",
  version: "1.0.0",
});

await client.connect(new SSEClientTransport(
  new URL("https://mcp.fahaliai.com/sse?api_key=YOUR_API_KEY")
));

// Load tools
const tools = await client.listTools();
const langchainTools = tools.map(mcpClientToTool);

// Use with any LangChain agent
// tool calls tagged with X-Fahali-Source: langchain on the upstream API
```

## What you get

- `fahali_get_market_verdict` — "should I worry about NVDA?"
- `fahali_get_portfolio_risk` — "what's my portfolio risk?"
- `fahali_daily_brief` — "what changed since yesterday?"
- The live advertised Fahali catalog from one MCP connection

## Observation, not advice

Fahali provides market intelligence only. No financial advice.
