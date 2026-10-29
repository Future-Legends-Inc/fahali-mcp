/**
 * How a tool call's ARGUMENTS become the envelope's decoration options.
 *
 * This lived inside `index.ts` — the entrypoint, which starts a server the
 * moment it is imported. That made a pure, 30-line mapping function reachable
 * only by running the whole process, and it had a measurable cost: the envelope
 * sweep could not reproduce it, so it decorated every payload with `{}` and
 * checked an envelope PRODUCTION NEVER EMITS. Thirty-six tools were reported
 * green against a shape with no judged record, no auth block, and no tier
 * metadata on `nextActions`, because the harness could not construct the real
 * options and had nowhere to import them from.
 *
 * Keeping the mapping here lets both production and the invariant sweep share
 * the same full-fidelity default and explicit compact-mode overrides.
 */
import { TOOL_DEFINITIONS } from "./tools.js";
import { callerSuppliedInstruments, DEFAULT_RESPONSE_DETAIL } from "./agentPayload.js";
import type { AgentAuthContext, AgentDecorationOptions } from "./agentPayload.js";

export type BoundAuth = Omit<AgentAuthContext, "secondsRemaining">;

export function liveAuthContext(auth: BoundAuth): AgentAuthContext {
  const expiresMs = auth.expiresAt ? new Date(auth.expiresAt).getTime() : Number.NaN;
  return {
    ...auth,
    secondsRemaining: Number.isFinite(expiresMs)
      ? Math.max(0, Math.floor((expiresMs - Date.now()) / 1000))
      : null,
  };
}

export function responseOptions(args: unknown, auth?: BoundAuth): AgentDecorationOptions {
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
  const detail = ["brief", "standard", "audit"].includes(String(a.detail))
    ? (String(a.detail) as AgentDecorationOptions["detail"])
    : DEFAULT_RESPONSE_DETAIL;
  const rawSymbols = a.symbols ?? a.symbol;
  const symbols = Array.isArray(rawSymbols)
    ? rawSymbols.map(String)
    : typeof rawSymbols === "string"
      ? rawSymbols.split(",")
      : [];
  return {
    detail,
    limit: typeof a.limit === "number" ? a.limit : undefined,
    includeWithheld: typeof a.include_withheld === "boolean"
      ? a.include_withheld
      : detail === "audit",
    symbols,
    since: typeof a.since === "string" ? a.since : undefined,
    toolCatalog: TOOL_DEFINITIONS as any[],
    // The SAME extraction the envelope runs over the response, run over the
    // request. One function, two vantage points — patching them separately is
    // how the two ends of a coverage ledger come to disagree.
    suppliedInstruments: callerSuppliedInstruments(a),
    ...(auth ? { auth: liveAuthContext(auth) } : {}),
  };
}
