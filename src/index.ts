/**
 * Fahali MCP server — entry point.
 *
 * Exposes 4 market intelligence tools via the Model Context Protocol.
 * Supports both SSE transport (for cloud AI agents) and stdio transport
 * (for local agents like Claude Desktop).
 *
 * Auth: see ./auth.ts. The MCP server forwards the caller's API key to the
 * upstream Express /agent/* endpoints; tier gating happens upstream.
 *
 * Multi-tenant SSE: each SSE connection gets its OWN Server instance with
 * the handshake's API key captured in a closure. Sessions are routed by the
 * transport sessionId (clients POST /messages?sessionId=...). Keys are never
 * stored in shared mutable state — concurrent clients cannot observe or use
 * each other's credentials.
 *
 * Usage:
 *   SSE:     node dist/index.js          (listens on PORT, default 3001)
 *   stdio:   node dist/index.js --stdio  (reads/writes stdin/stdout)
 *
 * Build: npx tsc
 * Test:  npx @modelcontextprotocol/inspector node dist/index.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { TOOL_DEFINITIONS } from "./tools.js";
import {
  getMarketVerdict,
  getPortfolioRisk,
  getContagionMap,
  getCapitalFlow,
} from "./proxy.js";
import { PROCESS_KEY, extractKeyFromHandshake, MISSING_KEY_ERROR } from "./auth.js";

const SERVER_INFO = {
  name: "fahali-mcp",
  version: "1.3.0",
};

/**
 * Build a Server instance bound to a single caller's API key.
 * One instance per SSE connection (or one for the stdio process).
 */
function buildServer(apiKey: string | undefined): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    // Auth gate — short-circuit if no key is bound. Avoids a useless 401
    // round trip to the upstream and gives the MCP client a clear actionable
    // message instead of a generic "HTTP 401."
    if (!apiKey) {
      return MISSING_KEY_ERROR;
    }

    const { name, arguments: args } = request.params;

    switch (name) {
      case "fahali_get_market_verdict": {
        const a = args as Record<string, unknown> | undefined;
        return getMarketVerdict(
          apiKey,
          a?.symbols as string | undefined,
          Boolean(a?.includeContagion),
        );
      }
      case "fahali_get_portfolio_risk":
        return getPortfolioRisk(apiKey);
      case "fahali_get_contagion_map":
        return getContagionMap(apiKey);
      case "fahali_get_capital_flow": {
        const a = args as Record<string, unknown> | undefined;
        const symbol = a?.symbol as string | undefined;
        if (!symbol) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "symbol is required" }) }],
            isError: true,
          };
        }
        return getCapitalFlow(apiKey, symbol);
      }
      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  });

  return server;
}

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await buildServer(PROCESS_KEY).connect(transport);
  if (PROCESS_KEY) {
    console.error("[fahali-mcp] stdio transport connected (API key from env)");
  } else {
    console.error(
      "[fahali-mcp] stdio transport connected — WARNING: no FAHALI_API_KEY env var set, tool calls will return missing_api_key errors",
    );
  }
}

async function runSSE(port: number): Promise<void> {
  // sessionId → transport. Each session also owns its own Server instance
  // (held alive by the transport's references), with its key in closure.
  const sessions = new Map<string, SSEServerTransport>();

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/sse") {
        // Per-connection API key from Authorization header or ?api_key=
        // query param. Falls back to FAHALI_API_KEY env var if neither is
        // set (single-tenant deployment pattern).
        const sessionKey = extractKeyFromHandshake(req) || PROCESS_KEY;

        const transport = new SSEServerTransport("/messages", res);
        sessions.set(transport.sessionId, transport);
        res.on("close", () => {
          console.error(`[fahali-mcp] SSE client disconnected (${transport.sessionId})`);
          sessions.delete(transport.sessionId);
        });
        await buildServer(sessionKey).connect(transport);
        console.error(
          `[fahali-mcp] SSE client connected (${transport.sessionId}, auth: ${
            sessionKey ? "key bound" : "NO KEY — calls will fail"
          }, active: ${sessions.size})`,
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (transport) {
          await transport.handlePostMessage(req, res);
          return;
        }
        res.writeHead(400);
        res.end("No SSE connection for this sessionId");
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            service: "fahali-mcp",
            version: SERVER_INFO.version,
            uptime: process.uptime(),
            // Multi-tenant: callers bring their own key on the handshake.
            // True only when a process-wide fallback key is configured.
            authConfigured: Boolean(PROCESS_KEY),
            authMode: PROCESS_KEY ? "process-key-fallback" : "per-session-key",
            activeSessions: sessions.size,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/llms.txt") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`# Fahali MCP Server
> Model Context Protocol server for Fahali's autonomous market-risk intelligence. 18 detection engines, 9,200+ instruments, real-time anomaly detection with verified signal→outcome provenance. Informational only — not financial advice.

## Endpoints
- SSE transport: https://mcp.fahaliai.com/sse
- Messages endpoint: https://mcp.fahaliai.com/messages?sessionId={sessionId}
- Health: https://mcp.fahaliai.com/health
- Landing page: https://mcp.fahaliai.com/

## Authentication
Clients must provide a Fahali API key via:
- Authorization: Bearer <FAHALI_API_KEY> header on SSE handshake, or
- ?api_key=<FAHALI_API_KEY> query parameter on the SSE URL
Create a key at https://app.fahaliai.com/developer

## Tools
- fahali_get_market_verdict — structured verdict per symbol: direction, confidence, reasoning chain, expected move, horizon (free teaser / Professional)
- fahali_get_portfolio_risk — portfolio risk score, VaR, drawdown, per-position breakdown (Elite)
- fahali_get_contagion_map — cross-asset contagion graph with tail-dependence edges (Elite)
- fahali_get_capital_flow — net flow, institutional vs retail, whale activity per symbol (Professional)

## Resources
- API docs: https://app.fahaliai.com/openapi.json
- Methodology: https://fahaliai.com/methodology
- Accuracy: https://fahaliai.com/accuracy
- Pricing: https://app.fahaliai.com/pricing
- App: https://app.fahaliai.com
- Landing: https://fahaliai.com

## Company
Future Legends AI — Fahali detects market risk before it becomes loss.
`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fahali MCP Server — Market Intelligence for AI Agents</title>
<meta name="description" content="Connect Claude, Cursor, ChatGPT and other AI agents to Fahali's 18-layer market risk intelligence via Model Context Protocol." />
<meta property="og:title" content="Fahali MCP Server — Market Intelligence for AI Agents" />
<meta property="og:description" content="AI agents can now query Fahali's real-time market risk, capital flow and contagion tools through MCP." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://mcp.fahaliai.com/" />
<meta property="og:site_name" content="Fahali" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Fahali MCP Server",
  "applicationCategory": "FinanceApplication",
  "operatingSystem": "Any",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "description": "Free developer key includes fahali_get_market_verdict with reduced depth and 50 calls/day."
  },
  "description": "Model Context Protocol server exposing Fahali's autonomous market-risk intelligence tools to AI agents.",
  "url": "https://mcp.fahaliai.com/",
  "publisher": {
    "@type": "Organization",
    "name": "Fahali",
    "url": "https://fahaliai.com"
  }
}
</script>
<style>
:root { --bg:#050508; --surface:#0F0F14; --text:#F0F0F5; --muted:#9CA3AF; --accent:#6366F1; --border:rgba(255,255,255,0.08); }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:40px 24px; }
.container { max-width:760px; margin:0 auto; }
.brand { display:flex; align-items:center; gap:12px; margin-bottom:32px; }
.brand-mark { width:40px; height:40px; border-radius:10px; background:var(--accent); display:grid; place-items:center; font-weight:700; color:#fff; }
h1 { font-size:32px; letter-spacing:-0.02em; margin-bottom:12px; }
.lead { color:var(--muted); font-size:18px; margin-bottom:32px; }
.card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:20px; }
.card h2 { font-size:18px; margin-bottom:12px; color:#fff; }
.card p, .card li { color:var(--muted); font-size:15px; }
.card ul { padding-left:20px; }
.card li { margin-bottom:6px; }
code { font-family:"JetBrains Mono",ui-monospace,monospace; background:rgba(99,102,241,0.12); color:#A5B4FC; padding:2px 6px; border-radius:4px; font-size:13px; }
pre { background:#000; border:1px solid var(--border); border-radius:8px; padding:16px; overflow:auto; margin-top:12px; }
pre code { background:transparent; padding:0; }
.footer { margin-top:40px; padding-top:24px; border-top:1px solid var(--border); color:var(--muted); font-size:13px; }
.footer a { color:#A5B4FC; text-decoration:none; }
.status { display:inline-flex; align-items:center; gap:8px; font-size:14px; color:var(--muted); }
.status::before { content:""; width:8px; height:8px; border-radius:50%; background:#10B981; }
</style>
</head>
<body>
<div class="container">
  <div class="brand">
    <div class="brand-mark">F</div>
    <div>
      <div style="font-weight:700; font-size:18px;">Fahali MCP Server</div>
      <div class="status">Operational</div>
    </div>
  </div>
  <h1>Market intelligence for AI agents</h1>
  <p class="lead">Connect Claude, Cursor, ChatGPT, Windsurf and other MCP-compatible agents to Fahali's 18-layer market risk detection engine.</p>

  <div class="card">
    <h2>What agents can ask</h2>
    <ul>
      <li>"Get the current market verdict for BTC, ETH and SOL."</li>
      <li>"Show me my portfolio risk score and biggest drawdown exposures."</li>
      <li>"Build a contagion map for the assets I hold."</li>
      <li>"Where is institutional capital flowing today?"</li>
    </ul>
  </div>

  <div class="card">
    <h2>Connect via SSE</h2>
    <p>SSE endpoint: <code>https://mcp.fahaliai.com/sse</code></p>
    <p>Messages endpoint: <code>https://mcp.fahaliai.com/messages?sessionId=&lt;sessionId&gt;</code></p>
    <p>Auth: bring your Fahali API key. Create one at <a href="https://app.fahaliai.com/developer" style="color:#A5B4FC;">app.fahaliai.com/developer</a>.</p>
  </div>

  <div class="card">
    <h2>Tools</h2>
    <ul>
      <li><code>fahali_get_market_verdict</code> — direction, confidence, reasoning chain and expected move per symbol.</li>
      <li><code>fahali_get_portfolio_risk</code> — risk score, VaR, drawdown and per-position breakdown.</li>
      <li><code>fahali_get_contagion_map</code> — cross-asset contagion graph with tail-dependence edges.</li>
      <li><code>fahali_get_capital_flow</code> — net flow, institutional vs retail, whale activity.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Claude Desktop config</h2>
<pre><code>{
  "mcpServers": {
    "fahali": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js", "--stdio"],
      "env": { "FAHALI_API_KEY": "sk_live_..." }
    }
  }
}</code></pre>
  </div>

  <div class="footer">
    <p>Resources: <a href="https://app.fahaliai.com/openapi.json">OpenAPI</a> · <a href="https://fahaliai.com/methodology">Methodology</a> · <a href="https://fahaliai.com/accuracy">Accuracy</a> · <a href="https://app.fahaliai.com/pricing">Pricing</a></p>
    <p style="margin-top:8px;">© 2026 Future Legends AI. Fahali is market intelligence, not financial advice.</p>
  </div>
</div>
</body>
</html>`);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    },
  );

  httpServer.listen(port);
  console.error(`[fahali-mcp] SSE server listening on port ${port}`);
  if (!PROCESS_KEY) {
    console.error(
      "[fahali-mcp] No FAHALI_API_KEY env var set; per-connection auth via Authorization header or ?api_key= query is required.",
    );
  }
}

const PORT = parseInt(process.env.PORT || "3001", 10);
const useStdio = process.argv.includes("--stdio");

if (useStdio) {
  runStdio();
} else {
  runSSE(PORT);
}
