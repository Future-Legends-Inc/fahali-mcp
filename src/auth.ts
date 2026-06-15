/**
 * API-key auth for the Fahali MCP server.
 *
 * The MCP server itself does not enforce tier checks — it forwards the
 * caller's API key as `Authorization: Bearer <key>` to the upstream Express
 * /agent/* endpoints. The Express server's existing requireAuth + requireTier
 * middleware does the actual enforcement. This keeps tier logic in one place.
 *
 * Three sources of the key, in order of precedence:
 *   1. Per-connection: Authorization: Bearer header on the SSE handshake
 *      (request to GET /sse). Captured in a closure for that session's
 *      Server instance — never shared across sessions.
 *   2. Per-connection: ?api_key=... query param on SSE handshake (for
 *      clients that can't set headers — Claude Desktop ext on some platforms).
 *   3. Process-wide: FAHALI_API_KEY env var (SPECTRA_API_KEY accepted as legacy alias) (stdio mode, single-tenant SSE).
 *
 * If none of the above is set, the MCP server returns a structured error
 * to the MCP client on the first tool call. Tools never silently fail with
 * "anonymous → defaults to retail" semantics.
 */

import type { IncomingMessage } from "node:http";

export const PROCESS_KEY = (process.env.FAHALI_API_KEY || process.env.SPECTRA_API_KEY)?.trim() || undefined;

/**
 * Extract an API key from an incoming SSE handshake request.
 * Accepts:
 *   - `Authorization: Bearer <key>`
 *   - `?api_key=<key>` query parameter
 * Returns undefined if neither is present.
 */
export function extractKeyFromHandshake(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

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
            "No Fahali API key was provided. Set FAHALI_API_KEY in the MCP server environment, or pass `Authorization: Bearer <key>` on the SSE handshake, or include `?api_key=<key>` in the SSE URL.",
          docs: "https://app.fahaliai.com/openapi.json",
        },
        null,
        2,
      ),
    },
  ],
  isError: true,
};
