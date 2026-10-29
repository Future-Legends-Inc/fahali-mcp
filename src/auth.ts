/**
 * Auth for the Fahali MCP server.
 *
 * Supports two authentication modes:
 *   1. Static API keys (sk_live_...) — forwarded to upstream /agent/*
 *   2. OAuth 2.1 access tokens (fahali_oat_...) — verified by OAuthProvider
 *
 * The MCP server itself does not enforce tier checks — it forwards the
 * caller's credentials to the upstream Express /agent/* endpoints which do.
 *
 * Key sources, in order of precedence:
 *   1. Per-connection: Authorization: Bearer header on the SSE handshake
 *   2. Legacy SSE only: ?api_key=... query param (accepted for compatibility;
 *      never recommended because URLs are routinely logged)
 *   3. Process-wide: FAHALI_API_KEY env var (stdio mode)
 */

import type { IncomingMessage } from "node:http";

export const PROCESS_KEY = (process.env.FAHALI_API_KEY || process.env.SPECTRA_API_KEY)?.trim() || undefined;

/** Header-only credential extraction for the modern Streamable HTTP transport. */
export function extractAuthorizationCredential(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string") return undefined;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Extract an API key from an incoming SSE handshake request.
 * Accepts:
 *   - `Authorization: Bearer <key>`
 *   - `?api_key=<key>` query parameter
 * Returns undefined if neither is present.
 */
export function extractKeyFromHandshake(req: IncomingMessage): string | undefined {
  const headerCredential = extractAuthorizationCredential(req);
  if (headerCredential) return headerCredential;

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const keyParam = url.searchParams.get("api_key");
  if (keyParam) return keyParam.trim();

  return undefined;
}

/**
 * Build the Authorization header to forward to upstream /agent/* calls.
 * Returns an empty object if no key is available — the upstream will then
 * reject with 401, which the proxy translates to a clean MCP error.
 */
export function authHeaders(key: string | undefined): Record<string, string> {
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

/**
 * Standard MCP error result for missing key. Returned by every tool handler
 * before hitting the proxy when no key is bound to the session.
 */
export const MISSING_KEY_ERROR = {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(
        {
          error: "missing_api_key",
          message:
            "No Fahali API key was provided. Set FAHALI_API_KEY in the local MCP server environment, or pass `Authorization: Bearer <key>` on the hosted handshake.",
          docs: "https://app.fahaliai.com/openapi.json",
        },
        null,
        2,
      ),
    },
  ],
  isError: true,
};
