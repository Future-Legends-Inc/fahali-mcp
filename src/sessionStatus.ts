/**
 * Which HTTP status a request against an unknown MCP session should get.
 *
 * ─── Why this is a named rule and not an inline comparison ──────────────────
 *
 * The Streamable HTTP spec assigns two different statuses to two failures that
 * look identical in code, and they have OPPOSITE consequences for the client:
 *
 *   §Session Management 3-4:
 *     "The server MAY terminate the session at any time, after which it MUST
 *      respond to requests containing that session ID with HTTP 404 Not Found.
 *      When a client receives HTTP 404 in response to a request containing an
 *      Mcp-Session-Id, it MUST start a new session by sending a new
 *      InitializeRequest without a session ID attached."
 *
 *   §Session Management 2:
 *     "Servers that require a session ID SHOULD respond to requests without an
 *      Mcp-Session-Id header (other than initialization) with HTTP 400."
 *
 * So 404 means "your session is gone — re-initialize", and it is the ONLY
 * signal the spec gives a client to recover on its own. 400 means "your
 * request was malformed", for which no recovery is defined: a client that
 * receives it has nothing it is allowed to do except surface an error.
 *
 * This server previously returned 400 for BOTH. Sessions live only in an
 * in-memory Map, so every deploy drops all of them — and every connected
 * client then got the un-recoverable code for the recoverable situation.
 * Symptom: connectors that never reconnect until a human intervenes, observed
 * three times across 2026-08-13/14. The status code WAS the bug.
 *
 * ─── The loop hazard ────────────────────────────────────────────────────────
 *
 * An initialize request must be allowed through no matter what session ID it
 * carries. A client that correctly re-initializes but leaves the stale
 * Mcp-Session-Id header on the retry would otherwise get 404 → re-init →
 * 404 forever. `isInitialize` short-circuits before the 404 for exactly that
 * reason; it is the difference between recovery and a hot loop.
 *
 * ─── On DELETE ──────────────────────────────────────────────────────────────
 *
 * The MUST in §3 says "requests", not "POST requests", so a DELETE naming a
 * dead session also gets 404 — even though the caller's intent (make this
 * session not exist) is already satisfied and the reference TS client throws
 * on a non-405 error during teardown. Spec compliance wins over leniency here:
 * the clients that matter are ones we cannot inspect, and guessing that they
 * prefer a friendly 200 over the documented code is how interop breaks.
 */

export interface SessionErrorStatus {
  /** 404 = session expired, client must re-initialize. 400 = no session id at all. */
  status: 404 | 400;
  message: string;
}

/** Sent with 404. Tells a client-implementer the exact recovery step. */
export const SESSION_EXPIRED_MESSAGE =
  "Session expired or unknown. Start a new session by sending an initialize request without a session id.";

/** Sent with 400. Unchanged wording — it was already right for this case. */
export const NO_SESSION_MESSAGE = "No valid session. Send an initialize request first.";

/**
 * Returns the error to send, or `null` when the request should be handled
 * normally (a live session, or an initialize that is allowed to mint one).
 *
 * GET and DELETE always pass `isInitialize: false` — only POST can carry an
 * initialize body.
 */
export function sessionErrorStatus(opts: {
  /** Did the request carry an Mcp-Session-Id header at all? */
  hasSessionId: boolean;
  /** Is that id a session this process currently holds? */
  known: boolean;
  /** Is the body an InitializeRequest? */
  isInitialize: boolean;
}): SessionErrorStatus | null {
  if (opts.known) return null; // live session — proceed

  // An initialize is always allowed through, stale header or not. Without this
  // a re-initializing client that keeps its old header loops on 404 forever.
  if (opts.isInitialize) return null;

  // A session id was supplied and we do not have it: it expired (or this
  // process restarted). This is the recoverable case and MUST be 404.
  if (opts.hasSessionId) return { status: 404, message: SESSION_EXPIRED_MESSAGE };

  // No session id and not an initialize — the client skipped the handshake.
  return { status: 400, message: NO_SESSION_MESSAGE };
}
