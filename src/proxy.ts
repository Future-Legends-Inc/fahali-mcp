/**
 * HTTP proxy to Fahali Express API /agent/* endpoints.
 * All calls are GET requests.
 *
 * Authentication: forwards the caller's API key as
 * `Authorization: Bearer <key>` so the upstream requireAuth + requireTier
 * middleware can enforce tier gates. The MCP server itself does not enforce
 * tier — see auth.ts for rationale.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { authHeaders } from "./auth.js";

const API_BASE = process.env.FAHALI_API_URL || process.env.SPECTRA_API_URL || "http://localhost:5000";
const REQUEST_TIMEOUT_MS = 15_000;

function okResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(msg: string, status?: number): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          status !== undefined ? { error: msg, status } : { error: msg },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/**
 * Translate upstream HTTP status into a clean MCP error.
 * The 401/403 distinction matters: 401 = no/bad key (auth problem),
 * 403 = key valid but insufficient tier (gating problem). MCP clients
 * should display these differently.
 */
function authFailureResult(status: number, body: any): CallToolResult {
  if (status === 401) {
    return errorResult(
      body?.error ||
        "Invalid or missing API key. Verify FAHALI_API_KEY or the Authorization header on the SSE handshake.",
      401,
    );
  }
  if (status === 403) {
    const requiredTier = body?.requiredTier || body?.tier || "<unknown>";
    return errorResult(
      `Tier upgrade required: this tool requires the ${requiredTier} tier or higher. ` +
        `Your current tier does not include this feature. ` +
        `See https://app.fahaliai.com/pricing.`,
      403,
    );
  }
  return errorResult(body?.error || `HTTP ${status}`, status);
}

async function proxyGet(
  apiKey: string | undefined,
  path: string,
  params?: Record<string, string>,
): Promise<CallToolResult> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...authHeaders(apiKey),
      },
    });

    let body: any;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok) return okResult(body);

    if (res.status === 401 || res.status === 403) {
      return authFailureResult(res.status, body);
    }

    return errorResult(body?.error || `HTTP ${res.status}: ${res.statusText}`, res.status);
  } catch (err: any) {
    if (err.name === "AbortError") {
      return errorResult(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    return errorResult(`Proxy error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMarketVerdict(
  apiKey: string | undefined,
  symbols?: string,
  includeContagion?: boolean,
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (symbols) params.symbols = symbols;
  if (includeContagion) params.includeContagion = "true";
  return proxyGet(apiKey, "/agent/verdict", params);
}

export async function getPortfolioRisk(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/portfolio-risk");
}

export async function getContagionMap(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/contagion");
}

export async function getCapitalFlow(apiKey: string | undefined, symbol: string): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/capital-flow", { symbol });
}
