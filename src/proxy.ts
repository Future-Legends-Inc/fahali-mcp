import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { authHeaders } from "./auth.js";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { toMarkdown } from "./markdown.js";
import { splitAssertions, symbolsInClaim, checkAssertion, summarise, bindSentence, detectionClaimOf, claimsRegime, timeWindowOf, type Read, type TapeRead, type TapeRow } from "./factCheck.js";

import { latestPerStratum } from "./agentPayload.js";
import { buildInstrumentClassCoverage } from "./producerRecord.js";
import { fallWarningsRequest, engineBoardRequest } from "./engineBoardRequest.js";
const API_BASE = process.env.FAHALI_API_URL || process.env.SPECTRA_API_URL || "http://localhost:5000";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The tool being dispatched, for the duration of that dispatch.
 *
 * 🔴 Upstream telemetry names the tool from the ROUTE, and a route does not
 * identify a tool: `/agent/verdict` is the endpoint for FOUR tools
 * (`get_market_verdict`, `get_market_decision`, `get_symbol_decision`,
 * `fact_check_narrative`), and `agentTelemetry("fahali_get_market_verdict")`
 * is hardcoded on it. So every call to the other three was recorded under a
 * sibling's name — and `fahali_get_market_decision`, which this server's own
 * instructions name as where every agent should START, appeared to have zero
 * usage for its entire lifetime.
 *
 * Set once at the dispatch seam and read once here, rather than threaded
 * through every proxy function: dozens of call sites is dozens of chances to
 * forget one, and the forgotten one is the tool nobody can see.
 */
export const currentToolName = new AsyncLocalStorage<string>();

function apiHeaders(
  apiKey: string | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  const tool = currentToolName.getStore();
  return {
    Accept: "application/json",
    "X-Fahali-Source": "mcp",
    // Lets the API attribute a call to the TOOL rather than to whichever
    // sibling happens to be hardcoded on the shared route.
    ...(tool ? { "X-Fahali-Tool": tool } : {}),
    "X-Request-Id": `mcp_${randomUUID()}`,
    ...extra,
    ...authHeaders(apiKey),
  };
}

function okResult(data: unknown): CallToolResult {
  // structuredContent is REQUIRED by SDK >=1.29 clients whenever the tool
  // declares an outputSchema: the client throws "has an output schema but did
  // not return structured content" on every SUCCESSFUL call otherwise (error
  // results are exempt via isError). This asymmetry broke Claude Desktop while
  // ChatGPT (non-enforcing client) worked — see fahali-mcp-500-diagnosis.md.
  const structured =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { data };
  // Markdown is ADDITIVE. It is rendered for the human reading the chat; the
  // JSON block below it stays byte-identical because agents parse it, and
  // structuredContent is untouched because every advertised tool declares an outputSchema and
  // enforcing clients validate against it. Dropping either would trade a
  // display improvement for a broken contract.
  const md = toMarkdown(data);
  const content = md
    ? [
        { type: "text" as const, text: md },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ]
    : [{ type: "text" as const, text: JSON.stringify(data, null, 2) }];

  return { content, structuredContent: structured };
}

export interface NextAction {
  tool: string;
  arguments?: Record<string, unknown>;
  why: string;
}

function errorResult(msg: string, status?: number, next?: NextAction): CallToolResult {
  const body: Record<string, unknown> =
    status !== undefined ? { error: msg, status } : { error: msg };
  // A dead end teaches nothing. Every failure names the exact next call:
  // the agent stays in motion instead of reporting "unavailable" to its user.
  // `next` is routing, never data — it asserts nothing about markets.
  if (next) body.next = next;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(body, null, 2),
      },
    ],
    isError: true,
  };
}

function retrySelf(why: string, slimDown = true): NextAction | undefined {
  const tool = currentToolName.getStore();
  if (!tool) return undefined;
  const args: Record<string, unknown> = {};
  if (slimDown) args.detail = "brief";
  return { tool, arguments: args, why };
}

function authFailureResult(status: number, body: any): CallToolResult {
  if (status === 401) {
    return errorResult(
      body?.error ||
        "Invalid or missing API key. Verify FAHALI_API_KEY or the Authorization header on the SSE handshake.",
      401,
      { tool: "fahali_get_capabilities", arguments: {}, why: "see what this credential can actually reach before retrying" },
    );
  }
  if (status === 403) {
    if (body?.reason === "free_scope") {
      return errorResult(
        body.message || "This endpoint requires a full API key, not a free developer key.",
        403,
        { tool: "fahali_get_capabilities", arguments: {}, why: "list what the free scope does cover, then work within it" },
      );
    }
    if (body?.requiredTier) {
      return errorResult(
        `Tier upgrade required: this tool requires the ${body.requiredTier} tier or higher. ` +
          `See https://app.fahaliai.com/pricing.`,
        403,
        { tool: "fahali_get_capabilities", arguments: {}, why: "find the strongest tool this tier allows instead" },
      );
    }
    return errorResult(body?.message || body?.error || "Access denied. Check your API key tier.", 403);
  }
  return errorResult(body?.error || `HTTP ${status}`, status);
}

/**
 * 🔴 A 200 THAT IS NOT JSON IS A FAILURE, NOT AN EMPTY READING.
 *
 * All three proxy helpers did `try { await res.json() } catch { data = null }`
 * and then `if (res.ok) return okResult(data)`. So any upstream answering 200
 * with a non-JSON body produced `{status: "ok", data: null}` — a successful
 * call carrying no data.
 *
 * Observed live 2026-08-27: `fahali_resolve_instrument` was called before its
 * endpoint had deployed, the SPA catch-all answered 200 with HTML, and the tool
 * reported OK. This is the failure the whole envelope exists to prevent, sitting
 * one layer BELOW it — the agent is told Fahali has nothing when the request
 * never reached Fahali. It affected every proxied tool, since all pass here.
 *
 * A genuine empty body (204, zero-length) stays empty. Anything else that will
 * not parse is a transport or routing fault and is returned as an error.
 */
async function readJsonBody(res: Response): Promise<{ body: any; parseFailed: boolean; raw: string }> {
  const raw = await res.text();
  if (!raw.trim()) return { body: null, parseFailed: false, raw };
  try {
    return { body: JSON.parse(raw), parseFailed: false, raw };
  } catch {
    return { body: null, parseFailed: true, raw };
  }
}

function nonJsonOkResult(status: number, raw: string): CallToolResult {
  return errorResult(
    `Upstream returned HTTP ${status} with a non-JSON body (${raw.trim().slice(0, 40).replace(/\s+/g, " ")}…). ` +
      "This is a routing or deployment fault, NOT an empty result — the request did not reach the Fahali API. " +
      "Do not report this as 'no data'; retry, and if it persists the endpoint is missing or misrouted.",
    502,
  );
}

/**
 * Mutation endpoints are allowed to acknowledge a successful write without a
 * JSON document. Preserve that fact explicitly instead of collapsing it to
 * `okResult(null)`, which is indistinguishable from a lost response body.
 *
 * A non-empty text response is also conserved, with its media type, because a
 * write acknowledgement can legitimately be text. HTML is the exception: in
 * this deployment it is the SPA catch-all and therefore evidence that the API
 * route was missed, not a successful Fahali mutation.
 */
function successfulMutationResult(
  res: Response,
  parsed: { body: any; parseFailed: boolean; raw: string },
): CallToolResult {
  if (!parsed.parseFailed && parsed.body !== null) return okResult(parsed.body);

  const mediaType = (res.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (parsed.parseFailed) {
    if (mediaType === "text/html" || /^\s*<!doctype html/i.test(parsed.raw) || /^\s*<html[\s>]/i.test(parsed.raw)) {
      return nonJsonOkResult(res.status, parsed.raw);
    }
    return okResult({
      status: "ok",
      dataState: "measured",
      responseState: "OK_WITH_FINDINGS",
      httpStatus: res.status,
      responseBody: {
        kind: "text",
        mediaType: mediaType || "text/plain",
        text: parsed.raw,
      },
    });
  }

  return okResult({
    status: "ok",
    dataState: "measured",
    responseState: "OK_WITH_FINDINGS",
    success: true,
    noContent: true,
    httpStatus: res.status,
  });
}

async function proxyGet(
  apiKey: string | undefined,
  path: string,
  params?: Record<string, string>,
  transform?: (body: any) => unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<CallToolResult> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: apiHeaders(apiKey),
    });

    const parsed = await readJsonBody(res);
    if (res.ok) {
      if (parsed.parseFailed) return nonJsonOkResult(res.status, parsed.raw);
      return okResult(transform ? transform(parsed.body) : parsed.body);
    }
    const body = parsed.body;

    if (res.status === 401 || res.status === 403) {
      return authFailureResult(res.status, body);
    }

    if (res.status >= 500) {
      return errorResult(
        body?.error || `HTTP ${res.status}: ${res.statusText} — upstream stumbled, not necessarily empty`,
        res.status,
        retrySelf("the upstream failed; a retry often succeeds once it recovers"),
      );
    }

    return errorResult(body?.error || `HTTP ${res.status}: ${res.statusText}`, res.status);
  } catch (err: any) {
    if (err.name === "AbortError") {
      return errorResult(
        `Request timed out after ${timeoutMs}ms — the data was not reached, which is not the same as no data existing`,
        undefined,
        retrySelf("retry the same call with the brief projection: smaller payloads cross before the timeout does", true),
      );
    }
    return errorResult(`Proxy error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMarketBriefing(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/market-briefing");
}

export async function getDailyBrief(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/daily-brief");
}

/**
 * What THIS credential may do. Feeds fahali_get_capabilities so an autonomous
 * planner is told its constraints instead of discovering them one 403 at a time
 * (re-audit N4). Cheap and non-consuming: /agent/entitlement peeks the quota
 * rather than incrementing it, so asking never costs a call.
 */
export async function getEntitlement(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/entitlement");
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

export async function getForecast72h(
  apiKey: string | undefined,
  symbol: string,
  include?: string,
): Promise<CallToolResult> {
  const params: Record<string, string> = { symbol };
  if (include) params.include = include;
  return proxyGet(apiKey, "/api/forecast/72h", params);
}

export async function getPortfolioRisk(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/portfolio-risk");
}

export async function listConnectedAccounts(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/accounts");
}

export async function getContagionMap(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/contagion");
}

export async function getCapitalFlow(
  apiKey: string | undefined,
  options: { symbol?: string; symbols?: string; limit?: number; since?: string } = {},
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (options.symbol) params.symbol = options.symbol;
  if (options.symbols) params.symbols = options.symbols;
  if (options.limit !== undefined) params.limit = String(options.limit);
  if (options.since) params.since = options.since;
  return proxyGet(apiKey, "/agent/capital-flow", params);
}

export async function getMicrostructureProxy(
  apiKey: string | undefined,
  options: { symbol?: string; symbols?: string; limit?: number; since?: string } = {},
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (options.symbol) params.symbol = options.symbol;
  if (options.symbols) params.symbols = options.symbols;
  if (options.limit !== undefined) params.limit = String(options.limit);
  if (options.since) params.since = options.since;
  return proxyGet(apiKey, "/agent/microstructure-proxy", params);
}

export async function getFlashCrashRisk(apiKey: string | undefined): Promise<CallToolResult> {
  // Truth Firewall P0.3: split the conflated "probability" into typed evidence for the
  // agent. The upstream `probability` is risk_weight(alert_type) × alert_confidence —
  // a SIGNAL-STRENGTH score, not a calibrated crash probability; an agent reads
  // `probability: 0.72, timeToCrash: "<2h"` as a 72% forecast. We expose it as
  // `detectionStrength` (calibrated:false) and DROP the fabricated timeToCrash /
  // estimatedMove bands (hardcoded off the uncalibrated score, no temporal/magnitude
  // model). Actionability is withheld, not manufactured — flash_crash_precursor's
  // realized lift over base rate is ~0 (no standalone edge; fleet-gate principle).
  return proxyGet(apiKey, "/api/risk/flash-crash", undefined, (body) => {
    const risks = Array.isArray(body?.risks) ? body.risks : [];
    return {
      status: "OK",
      dataOrigin: "alert_weight_x_confidence",
      calibrated: false,
      disclaimer:
        "detectionStrength = risk_weight(alert_type) × alert_confidence — a signal-strength ranking, NOT a calibrated crash probability. Fahali has no calibrated flash-crash probability, time-to-crash, or move-magnitude model. Use this to see which symbols are assembling a break setup, not as P(crash). Actionability is withheld: flash_crash_precursor's realized lift over base rate is ~0.",
      signals: risks.map((r: any) => ({
        symbol: r.symbol,
        detectionStrength: r.probability,      // 0-1, UNCALIBRATED
        detectionStrengthPct: r.riskLevel,     // detectionStrength × 100
        precursorType: r.likelyTrigger || r.alertType || null,
        severity: r.severity,
      })),
      summary: {
        // `topSymbol` is NULL whenever the leader is not separated from second
        // place — upstream withholds the name and sends the size of the tie
        // instead (see /api/risk/flash-crash). This matters more for an agent
        // than for a person: `detectionStrength` is risk_weight x confidence,
        // which measured live as the SAME value on all 20 rows, and an agent
        // handed a definite `topSymbol` has no way to see it was a coin flip.
        // Carry the reason, never substitute a name.
        topSymbol: body?.summary?.highestRiskSymbol ?? null,
        topSymbolTiedCount: body?.summary?.highestRiskTiedCount ?? null,
        topSymbolWithheld: body?.summary?.highestRiskWithheld ?? null,
        topDetectionStrengthPct: body?.summary?.highestRiskLevel ?? null,
        precursorConcentrationPct: body?.summary?.marketWideRisk ?? null,
        note: body?.summary?.recommendation ?? null,
      },
      timestamp: body?.timestamp ?? Date.now(),
      /**
       * 🔴 A TRANSFORM THAT REBUILDS THE OBJECT DROPS EVERYTHING IT DOES NOT NAME.
       *
       * The api-server was taught to emit resolved `instruments` on 2026-09-03, and
       * the fix deployed and changed nothing: this transform constructs a fresh
       * object from seven named keys, so the identities never left the building.
       * Verified live after the deploy — ETHD, TSLQ and APPX still came back
       * "may be an equity or a crypto asset", while fahali_resolve_instrument
       * named them ProShares UltraShort Ether, Tradr 2X Short TSLA and Tradr 2X
       * Long APP from the same reference, in the same minute.
       *
       * That is not cosmetic on THIS tool. Every one of its top names is a
       * leveraged or inverse ETF; reading a crash precursor on a 2x short as if it
       * were the underlying inverts the direction of the warning.
       *
       * This is the repo's own rule biting: `_meta.endpoint` names a tool's SOURCE,
       * not its SHAPE. When a transform re-authors a payload, every field the
       * source added has to be carried across deliberately.
       */
      instruments: Array.isArray(body?.instruments) ? body.instruments : undefined,
    };
  });
}

export async function getDetectionActivity(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/detection-activity");
}

/** Deprecated compatibility export; discovery advertises getDetectionActivity. */
export async function getSmartMoneyDashboard(apiKey: string | undefined): Promise<CallToolResult> {
  return getDetectionActivity(apiKey);
}

export async function getUnusualMoneyMovement(
  apiKey: string | undefined,
  options: {
    symbols?: string;
    limit?: number;
    since?: string;
    minimumConfidence?: number;
    minimumFlowUsd?: number;
  } = {},
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (options.symbols) params.symbols = options.symbols;
  if (options.limit !== undefined) params.limit = String(options.limit);
  if (options.since) params.since = options.since;
  if (options.minimumConfidence !== undefined) {
    params.minimum_confidence = String(options.minimumConfidence);
  }
  // Declared in the tool inputSchema in the same change. The comment below
  // records that symbols/limit/since were forwarded here but INVISIBLE in the
  // schema until 2026-09-11, so no agent could discover them; a new filter
  // that only this file knows about would reintroduce exactly that.
  if (options.minimumFlowUsd !== undefined) {
    params.minimum_flow_usd = String(options.minimumFlowUsd);
  }
  return proxyGet(apiKey, "/agent/unusual-money-movement", params);
}

/**
 * `getWhaleActivity` was DELETED 2026-09-04, not repaired.
 *
 * It had no callers — the `fahali_get_whale_activity` alias dispatches straight
 * to `getUnusualMoneyMovement` with all four parameters — and it took only an
 * apiKey, silently discarding `symbols`, `limit`, `since` and
 * `minimum_confidence`. It was safe purely by being unreachable, which is not a
 * guarantee; the next refactor to route the alias "through the compatibility
 * export" would have dropped every filter without a type error. Deleting a
 * superseded mechanism beats leaving a working-looking one beside it.
 */

export async function getMarketRisk(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/market/risk");
}

/** Deprecated compatibility export; the measurement is global market risk. */
export async function getInstitutionalRisk(apiKey: string | undefined): Promise<CallToolResult> {
  return getMarketRisk(apiKey);
}

export async function getCorrelationMatrix(
  apiKey: string | undefined,
  symbols?: string,
): Promise<CallToolResult> {
  return proxyGet(
    apiKey,
    "/agent/correlation-matrix",
    symbols ? { symbols } : undefined,
  );
}

export async function getMarketSentiment(apiKey: string | undefined, symbol?: string, limit?: number): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  if (limit) params.limit = String(limit);
  return proxyGet(apiKey, "/api/sentiment/history", params);
}

export async function getHighestConviction(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/insights/conviction");
}

/**
 * SILENT-ACCEPT, FIXED 2026-08-14. The tool schema has advertised `limit`,
 * `sort_by`, `compact` and `asset_class` since the P2 payload-contract work —
 * and this function took no arguments at all, so the dispatch in index.ts
 * dropped every one of them on the floor. An agent asking for 10 assets
 * received all ~2,256: 161K characters, past the token limit, tool call failed.
 * The advertised knob did nothing and said nothing, which is worse than not
 * offering it.
 *
 * The endpoint implements all four (server routes.ts, /api/market/snapshot) —
 * verified before wiring this, because forwarding params to a handler that
 * ignores them would have looked identical from here and fixed nothing.
 *
 * Same family as the fahali_get_lead_time gap noted below: the capability was
 * built and live, and only the MCP layer failed to reach it.
 */
export async function getMarketSnapshot(
  apiKey: string | undefined,
  opts?: { limit?: number; sortBy?: string; compact?: boolean; assetClass?: string },
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  // Omitted means the full monitored universe. Do not install a hidden MCP
  // default here: the upstream response's `total` and `assets` then describe
  // the same complete population. `limit` remains an explicit caller-selected
  // projection and is forwarded byte-for-byte when supplied.
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.sortBy) params.sort_by = opts.sortBy;
  // Only send `compact` when true — the server tests `=== "true"`, so an
  // explicit "false" is harmless, but omitting it keeps the URL honest about
  // what the caller actually asked for.
  if (opts?.compact) params.compact = "true";
  if (opts?.assetClass) params.asset_class = opts.assetClass;
  return proxyGet(apiKey, "/api/market/snapshot", params);
}

export async function getEngineStatus(apiKey: string | undefined): Promise<CallToolResult> {
  // The server budgets optional archive diagnostics at 3.5s. Keep a separate
  // transport belt so a regression fails quickly instead of reviving the old
  // 15s timeout race.
  return proxyGet(apiKey, "/api/engines/status", undefined, undefined, 8_000);
}

export async function getFallWarnings(apiKey: string | undefined, args: any): Promise<CallToolResult> {
  const { path, params } = fallWarningsRequest(args);
  return proxyGet(apiKey, path, params, undefined, 8_000);
}

export async function getEngineBoard(apiKey: string | undefined, args: any): Promise<CallToolResult> {
  const req = engineBoardRequest(args);
  if ("error" in req) {
    return { isError: true, content: [{ type: "text", text: req.error }] } as CallToolResult;
  }
  return proxyGet(apiKey, req.path, undefined, undefined, 8_000);
}

export async function getCaseStudies(apiKey: string | undefined): Promise<CallToolResult> {
  // Historically the slowest proof surface (15s+ cold scans before its 2026-09
  // rewrite): give it room instead of failing agents at the generic 15s belt.
  return proxyGet(apiKey, "/api/case-studies", undefined, undefined, 45_000);
}

export async function getTrackRecordScorecard(apiKey: string | undefined): Promise<CallToolResult> {
  // ~5s cold computations behind a 900s cache: the generic belt turns every
  // cold read into a timeout the agent reports as an outage.
  return proxyGet(apiKey, "/api/track-record/scorecard", undefined, undefined, 45_000);
}

/* ────────────────────────────────────────────────────────────────────────────
   THE WHOLE READ SURFACE, ADDRESSABLE

   Measured 2026-09-05: `server/routes.ts` registers 282 routes; MCP tools name
   45 endpoints; 168 GET routes carrying real data were reachable from no agent
   tool at all — including /api/situations, the leading-situation object, live
   with 463 active symbols.

   Hand-writing 168 more tool definitions would have produced a 200-tool
   catalogue no agent can navigate, and a roster to maintain by hand — the exact
   failure that left `openapi.json` describing 17 paths out of 282. So the
   surface is served by TWO tools over a catalogue the api-server derives from
   its own live router.

   🔴 THE CATALOGUE IS THE ALLOWLIST. `fetchResource` refuses any path the
   catalogue does not list, so this is not an arbitrary-URL fetch and cannot be
   pointed at another host, at a write route, or at the operator surface.

   Reachable is NOT ungated: a tier-gated route still returns its own 403, and
   `requireLimit` / `rejectFreeScope` are untouched.
   ──────────────────────────────────────────────────────────────────────────── */

export async function listResources(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/resources");
}

interface CatalogueEntryLike {
  method: string;
  path: string;
  params: string[];
  gates: Array<{ kind: string; detail?: string }>;
  publicRead: boolean;
}

/** Fetch the catalogue as data so the tool can validate against it. */
async function loadCatalogue(
  apiKey: string | undefined,
): Promise<{ resources: CatalogueEntryLike[]; excluded: Array<{ path: string; reason: string }> } | null> {
  try {
    const url = new URL("/api/resources", API_BASE);
    const res = await fetch(url.toString(), { headers: apiHeaders(apiKey) });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (!Array.isArray(body?.resources)) return null;
    return { resources: body.resources, excluded: Array.isArray(body.excluded) ? body.excluded : [] };
  } catch {
    return null;
  }
}

export async function fetchResource(
  apiKey: string | undefined,
  resource: string,
  pathParams: Record<string, string>,
  query: Record<string, string>,
): Promise<CallToolResult> {
  const catalogue = await loadCatalogue(apiKey);
  if (!catalogue) {
    return errorResult(
      "catalogue_unavailable: The resource catalogue could not be read, so no path could be validated. " +
        "This is a failure to reach the catalogue, NOT a statement that the resource does not exist. " +
        "Retry, or call fahali_list_resources directly to see the underlying error.",
    );
  }

  const entry = catalogue.resources.find((r) => r.path === resource);
  if (!entry) {
    const excluded = catalogue.excluded.find((e) => e.path === resource);
    if (excluded) {
      return errorResult(
        `resource_excluded: \`${resource}\` exists on this server but is deliberately not an ` +
          `agent-readable resource. Reason: ${excluded.reason}`,
      );
    }
    return errorResult(
      `unknown_resource: \`${resource}\` is not in the catalogue. Call fahali_list_resources for the ` +
        `${catalogue.resources.length} readable paths. Only catalogued paths can be fetched — this tool ` +
        "does not take arbitrary URLs.",
    );
  }

  const missing = entry.params.filter((name) => !pathParams[name]);
  if (missing.length) {
    return errorResult(
      `missing_path_params: \`${resource}\` needs path parameter${missing.length === 1 ? "" : "s"} ` +
        `${missing.map((m) => `\`${m}\``).join(", ")}. Supply ${missing.length === 1 ? "it" : "them"} in \`path_params\`.`,
    );
  }

  let path = resource;
  for (const name of entry.params) {
    path = path.replace(`:${name}`, encodeURIComponent(pathParams[name]));
  }

  return proxyGet(apiKey, path, query);
}

// Verified Lead Time. This handler and its dispatch case in index.ts were missing
// while tools.ts advertised the tool, so every caller got "unknown tool:
// fahali_get_lead_time" — on the one number the product is actually sold on. The
// endpoint was alive and public the whole time; only the MCP layer was broken.
/**
 * The judged record, collapsed to one row per stratum.
 *
 * MEASURED 2026-08-22: the REST response is ~100 KB, 95% of it `trackRecord`.
 * Those 229 rows are 12 DISTINCT STRATA — a rolling window re-published daily.
 * The tool's own description tells the agent "do NOT pick your own row from
 * trackRecord", so we were shipping ~95 KB whose stated purpose is to be
 * ignored, and it overflowed a real client's token budget TWICE in one session.
 *
 * That truncation is the actual danger, not the byte count: when it fires the
 * agent loses `headline` — the one field the description says to rely on — and
 * is left with a file of rows it was told not to choose from. A payload that
 * cannot be read cannot be authoritative.
 *
 * So the collapse happens HERE and not in the REST endpoint: the landing build
 * and every other REST consumer keep the full daily series, while the MCP
 * surface — the one with a context window — gets the 12 rows that mean
 * something. No opt-in flag: a parameter returning all 229 would exist only so
 * an agent could do the thing the description forbids, and every caller setting
 * it walks straight back into the truncation path.
 */
export async function getLeadTime(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/track-record/lead-time", undefined, (body: any) => {
    const all = Array.isArray(body?.trackRecord) ? body.trackRecord : [];
    if (!all.length) return body;
    const { rows, collapsed } = latestPerStratum(all as Array<Record<string, unknown>>);
    return {
      ...body,
      trackRecord: rows,
      // Stated in the DATA, not only in the briefing prose: an agent parsing
      // structuredContent never reads the Markdown.
      trackRecordCollapsed: {
        returned: rows.length,
        collapsedFrom: all.length,
        rule: "one row per (engine · horizon_tier · bar_regime), most recent day",
        note:
          `${collapsed} rows were the same strata re-published on earlier days. They are repeat ` +
          `measurements of a rolling window, not independent observations — do not count or sum them. ` +
          `The full daily series remains at /api/track-record/lead-time.`,
      },
      /**
       * Re-audit M3: both publishable strata are crypto, and an agent asking
       * what Fahali's record says about equities had nothing to read. Silence
       * was the wrong answer — equity IS measured, and every equity stratum is
       * withheld for a stated, measured reason. Publish that.
       */
      instrumentClassCoverage: {
        classes: buildInstrumentClassCoverage(body),
        note:
          "measuredButWithheld and noResolvedRows are DIFFERENT facts: the first is 'we measured this stratum and it did not clear the gate', the second is 'there were no resolved rows to measure'. " +
          "A class with withheld strata has evidence that failed its test, which is a disclosed limitation — not an absence of coverage, and never an all-clear for that class. " +
          "The reasons carry no figures on purpose: the numbers behind a withheld stratum are real and are not quotable.",
        /**
         * 🔴 THE PREVIOUS TEXT HERE WAS FALSE ON THREE CLAUSES (shipped
         *    2026-08-27, corrected the same day against the moat).
         *
         * It said: "Fahali's verdict arbiter does not currently produce equity
         * reads at all: equity verdicts are blocked at the provenance guardrail
         * while the equity data path is marked unavailable."
         *
         * Measured:
         *  · The arbiter DOES produce equity reads — NVDA, UPST, ROBO, AMD all
         *    return a canonical_verdict-attributed verdict on request.
         *  · The guardrail does not block them, because the canonical path
         *    never calls guardrailCheck at all. Nothing was being enforced.
         *  · Equity is not unmeasured: 9,882 non-crypto symbols, 276,535 moat
         *    rows, 53,388 of them judged.
         *
         * I wrote that sentence from a code comment instead of from the
         * database, and it understated our own coverage to a customer. Read the
         * data, never the prose above it.
         *
         * What is ACTUALLY true is narrower and worth stating exactly: no
         * equity stratum is published, and the VERDICT engines specifically
         * hold almost no equity rows — canonical_verdict has 12 non-crypto rows
         * and none are judged. The cause is at the write path, not a policy:
         * a served claim is dropped when it cannot be priced at registration,
         * and the three price sources the registrar consults all miss equities.
         */
        verdictEngineNote:
          "Fahali measures equities: 9,882 non-crypto symbols and 53,388 judged outcomes sit in the signal->outcome record, and equity market data is current. What is missing is narrower. No equity stratum has cleared the publishability gate, so there is no quotable equity precision figure. And the two VERDICT engines (committee_verdict, canonical_verdict) hold almost no equity rows of their own — that is a gap in the write path, not a judgement about equities and not an absence of equity evidence. Read instrumentClassCoverage for what IS measured per class.",
      },
    };
  });
}

export async function getPortfolioMetrics(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/portfolio/metrics");
}

/**
 * What IS this ticker? The one capability round four correctly filed as missing.
 *
 * Ticker collision is a silent correctness failure: FETH, FBTC, GBTC and ABTC are
 * ETFs whose names parse convincingly as crypto pairs, so an agent resolving GBTC
 * to "G against BTC" reads a judgment about a Bitcoin trust as one about a spot
 * pair. Until this existed there was no way to ASK, so every consumer guessed.
 */
export async function resolveInstrument(
  apiKey: string | undefined,
  symbols: string | string[] | undefined,
  assetClass?: string,
): Promise<CallToolResult> {
  const list = Array.isArray(symbols) ? symbols.join(",") : String(symbols ?? "").trim();
  const params: Record<string, string> = {};
  if (list) params.symbols = list;
  // Forwarded verbatim: the server echoes an unrecognised value as ignored
  // rather than this wrapper silently dropping it.
  if (typeof assetClass === "string" && assetClass.trim()) params.assetClass = assetClass.trim();
  return proxyGet(apiKey, "/agent/resolve-instrument", Object.keys(params).length ? params : undefined);
}
export async function getMarketRegime(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/temporal/regimes");
}

/** Market mood — composed once on the api-server by shared/marketMood.ts. */
export async function getMarketMood(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/market/mood");
}

/** Sector rotation — composed once on the api-server by shared/sectorRotation.ts. */
export async function getSectorRotation(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/market/rotation");
}

export async function getVisualIntelligence(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/spectra/visual-intelligence");
}

/**
 * 🔴 THE TOOL DECLARED FILTERS IT NEVER SENT. (fixed 2026-09-04)
 *
 * This took no arguments, so `symbols` / `since` were applied only as a
 * post-hoc projection by the response envelope — over whatever the server
 * happened to return. The server returned the newest 200 rows of a feed
 * carrying 342,015 alerts / 24h across 3,615 symbols, i.e. a THIRTY-ONE
 * SECOND slice, so a request for BTCUSDT projected an empty set out of a
 * window BTC was simply not in. Measured: BTC had 423 alerts in that window.
 *
 * The filters now reach SQL. `max_rows` is deliberately NOT named `limit`:
 * the envelope already owns `limit` as a PROJECTION cap (max 100), and wiring
 * one name to both fetch depth and projection depth would have made
 * `limit: 100` fetch fewer rows than the old hardcoded 200.
 */
export async function getRealtimeAlerts(
  apiKey: string | undefined,
  opts?: {
    symbols?: string | string[];
    alert_types?: string | string[];
    since?: string;
    max_rows?: number;
  },
): Promise<CallToolResult> {
  const csv = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : undefined;

  const params: Record<string, string> = {};
  const symbols = csv(opts?.symbols);
  if (symbols) params.symbols = symbols;
  const alertTypes = csv(opts?.alert_types);
  if (alertTypes) params.alert_types = alertTypes;
  if (opts?.since) params.since = String(opts.since);
  if (opts?.max_rows !== undefined && opts.max_rows !== null) {
    params.max_rows = String(opts.max_rows);
  }
  return proxyGet(apiKey, "/api/spectra/realtime", params);
}

async function proxyPost(
  apiKey: string | undefined,
  path: string,
  body: unknown,
): Promise<CallToolResult> {
  const url = new URL(path, API_BASE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      signal: controller.signal,
      headers: apiHeaders(apiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    const parsed = await readJsonBody(res);
    const data = parsed.body;

    if (res.ok) {
      // A 2xx without a JSON document is a successful write the upstream chose
      // not to describe, NOT a routing fault. Reporting it as 502 `isError`
      // made agents retry a write that already landed — the exact duplication
      // the idempotency keys exist to prevent. Same treatment as PATCH.
      return successfulMutationResult(res, parsed);
    }

    if (res.status === 401 || res.status === 403) {
      return authFailureResult(res.status, data);
    }

    return errorResult(data?.error || `HTTP ${res.status}: ${res.statusText}`, res.status);
  } catch (err: any) {
    if (err.name === "AbortError") {
      return errorResult(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    return errorResult(`Proxy error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyDelete(
  apiKey: string | undefined,
  path: string,
  body?: Record<string, unknown>,
): Promise<CallToolResult> {
  const url = new URL(path, API_BASE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const idempotencyKey = typeof body?.idempotency_key === "string"
    ? body.idempotency_key
    : typeof body?.idempotencyKey === "string"
      ? body.idempotencyKey
      : undefined;

  try {
    const res = await fetch(url.toString(), {
      method: "DELETE",
      signal: controller.signal,
      // Send the lifecycle request identity in both standards-friendly header
      // form and the JSON payload accepted by the Fahali API. The values are
      // deliberately sourced from the same field so the API's conflict guard
      // can never see two different identities because of MCP translation.
      headers: apiHeaders(apiKey, {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      }),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const parsed = await readJsonBody(res);
    const data = parsed.body;

    if (res.ok) {
      // A 2xx without a JSON document is a successful write the upstream chose
      // not to describe, NOT a routing fault. Reporting it as 502 `isError`
      // made agents retry a write that already landed — the exact duplication
      // the idempotency keys exist to prevent. Same treatment as PATCH.
      return successfulMutationResult(res, parsed);
    }
    if (res.status === 401 || res.status === 403) return authFailureResult(res.status, data);
    return errorResult(data?.error || `HTTP ${res.status}: ${res.statusText}`, res.status);
  } catch (err: any) {
    if (err.name === "AbortError") return errorResult(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    return errorResult(`Proxy error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveMemory(
  apiKey: string | undefined,
  key: string,
  value: Record<string, unknown>,
  memoryType?: string,
): Promise<CallToolResult> {
  return proxyPost(apiKey, "/api/v1/agent/memory", { key, value, memory_type: memoryType || "semantic" });
}

export async function searchMemories(
  apiKey: string | undefined,
  query: string,
  limit?: number,
): Promise<CallToolResult> {
  const params: Record<string, string> = { search: query };
  if (limit) params.limit = String(limit);
  return proxyGet(apiKey, "/api/v1/agent/memory", params);
}

export async function createAlert(
  apiKey: string | undefined,
  symbol: string,
  alert_type: string,
  message: string,
  severity: string,
  confidence?: number,
  idempotencyKey?: string,
): Promise<CallToolResult> {
  // Guard BEFORE any property access: the old code crashed the RPC with
  // "Cannot read properties of undefined (reading 'replace')" on missing
  // args instead of returning a clean tool error.
  const missing = [
    !symbol && "symbol",
    !alert_type && "alert_type",
    !message && "message",
    !severity && "severity",
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `missing required arguments: ${missing.join(", ")}` }) }],
      isError: true,
    };
  }
  // Real REST endpoint. The previous target (/api/v1/graphql) never existed —
  // this API has no GraphQL — so every create_alert call in history failed.
  return proxyPost(apiKey, "/agent/alerts", {
    symbol,
    alert_type,
    message,
    severity,
    confidence,
    idempotency_key: idempotencyKey,
  });
}

async function proxyPatch(
  apiKey: string | undefined,
  path: string,
  body: unknown,
): Promise<CallToolResult> {
  const url = new URL(path, API_BASE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "PATCH",
      signal: controller.signal,
      headers: apiHeaders(apiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const parsed = await readJsonBody(res);
    const data = parsed.body;
    if (res.ok) return successfulMutationResult(res, parsed);
    if (res.status === 401 || res.status === 403) return authFailureResult(res.status, data);
    return errorResult(data?.message || data?.error || `HTTP ${res.status}: ${res.statusText}`, res.status);
  } catch (err: any) {
    if (err.name === "AbortError") return errorResult(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    return errorResult(`Proxy error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function listAgentSessions(apiKey: string | undefined): Promise<CallToolResult> {
  return proxyGet(apiKey, "/api/v1/agent/sessions");
}

export async function analyzeCustomPortfolio(
  apiKey: string | undefined,
  positions?: { symbol: string; market_value: number; quantity?: number; avg_cost?: number; side?: string }[],
  symbols?: string[],
): Promise<CallToolResult> {
  return proxyPost(apiKey, "/agent/portfolio-risk", { positions, symbols });
}

export function buildShockTestRequestBody(
  scenario?: string,
  // `side` is what makes a short expressible: the server refuses a negative
  // market_value and reads direction from here instead. It was forwarded all
  // along (positions passes through wholesale) but undeclared, so nothing
  // typed or documented the only working way to express a short book.
  positions?: { symbol: string; market_value: number; quantity?: number; side?: "long" | "short" }[],
  shocks?: Array<Record<string, unknown>>,
  horizon?: string,
  shockSymbol?: string,
  shockPct?: number,
): Record<string, unknown> {
  return { scenario, positions, shocks, horizon, shockSymbol, shockPct };
}

export async function runShockTest(
  apiKey: string | undefined,
  scenario?: string,
  // `side` is what makes a short expressible: the server refuses a negative
  // market_value and reads direction from here instead. It was forwarded all
  // along (positions passes through wholesale) but undeclared, so nothing
  // typed or documented the only working way to express a short book.
  positions?: { symbol: string; market_value: number; quantity?: number; side?: "long" | "short" }[],
  shocks?: Array<Record<string, unknown>>,
  horizon?: string,
  shockSymbol?: string,
  shockPct?: number,
): Promise<CallToolResult> {
  // Kill switch (2026-08-05): the shock-test endpoint's crash-alert branch
  // mints dollar/drawdown figures from probability × an assumed 3% move
  // (routes.ts:12288-12293) — a real detection confidence multiplied by a
  // hardcoded fallback that is NOT a measurement. Scenario text is also only
  // honored when it contains covid|crash|stress, so an agent asking for an
  // arbitrary scenario silently receives unrelated simulations. Agents must
  // not consume it until position-level revaluation exists. The human UI
  // keeps the REST route; this MCP door is what the QA handoff names.
  // 2026-08-09: the condition this switch waited for is MET. Task 11 wired
  // estimateUserShock() / computeUserShock() in — beta_i = corr(i,shock) *
  // sigma_i / sigma_shock, revalued position by position — so the endpoint no
  // longer returns "probability × an assumed 3% move", and the scenario parser
  // reproduces the exact shock asked for or abstains rather than guessing a
  // direction. Default flipped to ENABLED; the switch is retained as a kill
  // switch (set FAHALI_MCP_SHOCK_TEST_ENABLED=false to close the door again).
  //
  // Why this lived past its own fix: the endpoint and this MCP door are two
  // independent gates. Task 11 opened the endpoint and its tests went green
  // while every AGENT still got a 503 — the tool was only observably broken
  // through the consumer's path, not the implementer's.
  if (process.env.FAHALI_MCP_SHOCK_TEST_ENABLED === "false") {
    return errorResult(
      "The shock-test tool is switched off (FAHALI_MCP_SHOCK_TEST_ENABLED=false). " +
        "The revaluation itself is implemented and working — this is an operator kill " +
        "switch, not a capability gap. Use `fahali_get_portfolio_risk` or " +
        "`fahali_analyze_custom_portfolio` meanwhile.",
      503,
    );
  }
  return proxyPost(
    apiKey,
    "/api/portfolio/shock-test",
    buildShockTestRequestBody(scenario, positions, shocks, horizon, shockSymbol, shockPct),
  );
}

export interface PortfolioWatchInput {
  name?: string;
  positions?: Array<{ symbol: string; market_value: number; quantity?: number; side?: string; asset_class?: string }>;
  account_ids?: string[];
  mandate?: Record<string, unknown>;
  thresholds?: Record<string, unknown>;
  evaluation_interval_minutes?: number;
}

export async function watchPortfolio(apiKey: string | undefined, input: PortfolioWatchInput): Promise<CallToolResult> {
  return proxyPost(apiKey, "/agent/watches", input);
}

export async function listPortfolioWatches(apiKey: string | undefined, limit?: number): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/watches", limit ? { limit: String(limit) } : undefined);
}

export async function updatePortfolioWatch(
  apiKey: string | undefined,
  watchId: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  return proxyPatch(apiKey, `/agent/watches/${encodeURIComponent(watchId)}`, input);
}

export async function getPortfolioDecision(
  apiKey: string | undefined,
  watchId: string,
  refresh = true,
): Promise<CallToolResult> {
  return proxyGet(apiKey, `/agent/watches/${encodeURIComponent(watchId)}/decision`, { refresh: String(refresh) });
}

export async function getWatchDelta(
  apiKey: string | undefined,
  watchId: string,
  refresh = true,
): Promise<CallToolResult> {
  return proxyGet(apiKey, `/agent/watches/${encodeURIComponent(watchId)}/delta`, { refresh: String(refresh) });
}

export async function getActiveIncidents(
  apiKey: string | undefined,
  options: { watch_id?: string; include_resolved?: boolean; limit?: number } = {},
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (options.watch_id) params.watch_id = options.watch_id;
  if (options.include_resolved) params.include_resolved = "true";
  if (options.limit) params.limit = String(options.limit);
  return proxyGet(apiKey, "/agent/incidents", Object.keys(params).length ? params : undefined);
}

export async function acknowledgeIncidentTool(
  apiKey: string | undefined,
  incidentId: string,
  body: { acknowledged_by?: string; note?: string },
): Promise<CallToolResult> {
  return proxyPost(apiKey, `/agent/incidents/${encodeURIComponent(incidentId)}/acknowledge`, body);
}

export async function getIncidentTimeline(
  apiKey: string | undefined,
  incidentId: string,
  limit?: number,
): Promise<CallToolResult> {
  return proxyGet(
    apiKey,
    `/agent/incidents/${encodeURIComponent(incidentId)}/timeline`,
    limit ? { limit: String(limit) } : undefined,
  );
}

export async function getVerdictHistory(
  apiKey: string | undefined,
  options: { watch_id?: string; symbol?: string; as_of?: string; since?: string; limit?: number; cursor?: string },
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  for (const key of ["watch_id", "symbol", "as_of", "since", "cursor"] as const) {
    if (options[key]) params[key] = String(options[key]);
  }
  if (options.limit != null) params.limit = String(options.limit);
  return proxyGet(apiKey, "/agent/verdict-history", params);
}

export async function getVerdictById(apiKey: string | undefined, verdictId: string): Promise<CallToolResult> {
  return proxyGet(apiKey, `/agent/verdict-history/${encodeURIComponent(verdictId)}`);
}

export async function getEvidence(
  apiKey: string | undefined,
  verdictId: string,
  options: { evidence_ids?: string | Array<string | number>; detail?: string; limit?: number; offset?: number } = {},
): Promise<CallToolResult> {
  const params: Record<string, string> = {};
  if (options.evidence_ids != null) {
    params.evidence_ids = Array.isArray(options.evidence_ids)
      ? options.evidence_ids.map(String).join(",")
      : String(options.evidence_ids);
  }
  if (options.detail) params.detail = String(options.detail);
  if (options.limit != null) params.limit = String(options.limit);
  if (options.offset != null) params.offset = String(options.offset);
  return proxyGet(apiKey, `/agent/verdict-history/${encodeURIComponent(verdictId)}/evidence`, params);
}

export async function subscribeRisk(
  apiKey: string | undefined,
  watchId: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  return proxyPost(apiKey, `/agent/watches/${encodeURIComponent(watchId)}/subscriptions`, input);
}

export async function listRiskSubscriptions(apiKey: string | undefined, watchId?: string): Promise<CallToolResult> {
  return proxyGet(apiKey, "/agent/risk-subscriptions", watchId ? { watch_id: watchId } : undefined);
}

export async function updateRiskSubscription(
  apiKey: string | undefined,
  subscriptionId: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  return proxyPatch(apiKey, `/agent/risk-subscriptions/${encodeURIComponent(subscriptionId)}`, input);
}

export async function unsubscribeRisk(
  apiKey: string | undefined,
  subscriptionId: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  return proxyDelete(apiKey, `/agent/risk-subscriptions/${encodeURIComponent(subscriptionId)}`, input);
}

/**
 * One instrument's alert tape, normalised for the fact-check.
 *
 * Fetched by SYMBOL only, never by `alert_types`: the tape stores a volume
 * spike as `alert_type: multi_indicator_confluence` with `volume_spike` nested
 * in `details`, so a type filter on the column silently returns nothing. Rows
 * are matched on every type label they carry. A failed read is `ok: false` —
 * never an empty tape — so "the check did not run" cannot render as "nothing
 * happened".
 */
async function readTape(apiKey: string | undefined, symbol: string, sinceIso: string): Promise<TapeRead> {
  const url = new URL("/api/spectra/realtime", API_BASE);
  url.searchParams.set("symbols", symbol);
  url.searchParams.set("since", sinceIso);
  url.searchParams.set("max_rows", "1000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal, headers: apiHeaders(apiKey) });
    const parsed = await readJsonBody(res);
    const body: any = parsed.body;
    if (!res.ok) return { ok: false, reason: `the alert tape returned HTTP ${res.status}` };
    if (parsed.parseFailed || !body || typeof body !== "object") {
      return { ok: false, reason: `the alert tape returned HTTP ${res.status} with a non-JSON body` };
    }
    if (!Array.isArray(body.signals) && !Array.isArray(body.clusters)) {
      return { ok: false, reason: "the alert tape response carried neither signals nor clusters" };
    }
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    const rows: TapeRow[] = [];
    for (const r of Array.isArray(body.signals) ? body.signals : []) {
      const d = r?.details && typeof r.details === "object" ? r.details : {};
      const raw = d?._raw && typeof d._raw === "object" ? d._raw : {};
      rows.push({
        source: "signal",
        id: r?.id != null ? String(r.id) : null,
        symbol: String(r?.symbol ?? r?.asset ?? "").toUpperCase(),
        types: [r?.alertType, r?.alert_type, d?.alert_type, raw?.alert_type, raw?._raw?.alert_type, r?.title, r?.verdict?.phenomenon]
          .map(str).filter((x): x is string => Boolean(x)),
        message: String(r?.message ?? r?.description ?? ""),
        timestamp: String(r?.timestamp ?? ""),
        dataState: str(d?.data_state) ?? str(r?.metadata?.data_state),
        scope: str(r?.claimScope?.scope),
        regime: str(d?.regime_nowcast) ?? str(d?.primary_regime),
        instrumentIdentity: d?.instrumentIdentity ?? raw?.instrumentIdentity ?? undefined,
      });
    }
    // Clusters cover EVERY row read; `signals` is capped at 100. A detection
    // past the signal cap is still present in its cluster.
    for (const c of Array.isArray(body.clusters) ? body.clusters : []) {
      const ev = Array.isArray(c?.evidence) ? c.evidence : [];
      const newest = ev[0];
      rows.push({
        source: "cluster",
        id: null,
        symbol: String(c?.symbol ?? "").toUpperCase(),
        types: [c?.thesis, newest?.alertType].map(str).filter((x): x is string => Boolean(x)),
        message: String(newest?.message ?? ""),
        timestamp: String(c?.lastSeen ?? newest?.timestamp ?? ""),
        dataState: null,
        scope: null,
        regime: null,
      });
    }
    const truncated = body?.coverage?.sourceTruncated === true || body?.sourceTruncated === true;
    return { ok: true, rows, truncated, sinceIso };
  } catch (err: any) {
    return { ok: false, reason: err?.name === "AbortError" ? "the alert tape read timed out" : `the alert tape read failed: ${String(err?.message ?? err)}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * fahali_fact_check_narrative — check a narrative BEFORE an agent says it.
 *
 * Composed from `/agent/verdict`, which already carries its own abstention and
 * withholding logic. Nothing here mints a claim; it only reports what that
 * endpoint already returned, plus the pure classification in factCheck.ts.
 *
 * A read that fails to load produces NO_READ for every symbol — never a silent
 * SUPPORTED. "The check didn't run" and "the check passed" must never render
 * the same way; that conflation is the whole reason this tool exists.
 */
export async function factCheckNarrative(
  apiKey: string | undefined,
  claim: string,
  symbols?: string[],
): Promise<CallToolResult> {
  if (!claim || !String(claim).trim()) {
    return errorResult("`claim` is required: pass the narrative text you are about to state.");
  }

  const sentences = splitAssertions(claim);
  const wanted = symbolsInClaim(claim, symbols);

  const reads = new Map<string, Read>();
  // Caller-typed ticker -> the key the server looked it up under (BTC -> BTCUSDT).
  const resolutions = new Map<string, string>();
  let readStatus = "no symbols were recognised in the claim, so no verdict lookup was attempted";

  if (wanted.length) {
    const url = new URL("/agent/verdict", API_BASE);
    url.searchParams.set("symbols", wanted.join(","));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: apiHeaders(apiKey),
      });
      // Same rule as every other proxy path: a 200 that is not JSON is a
      // routing/deployment fault, never an empty reading. `res.json().catch`
      // here once turned the SPA catch-all into "Fahali holds a current read
      // on none of the named symbols" — absence-of-coverage rendered from a
      // lookup that never reached the API.
      const parsed = await readJsonBody(res);
      const body: any = parsed.body;
      if (res.ok && !parsed.parseFailed && Array.isArray(body?.data)) {
        for (const item of body.data) {
          const sym = String(item?.symbol ?? "").toUpperCase();
          if (!sym) continue;
          reads.set(sym, {
            direction: item?.canonical?.direction ?? item?.verdict?.direction ?? null,
            headline: item?.canonical?.headline ?? null,
            actionability: item?.verdict?.actionability ?? null,
            abstainReason: item?.verdict?.abstainReason ?? null,
            // The identity the server resolved travels with the read, so the
            // envelope never re-derives it from a bare ticker ("ambiguous").
            instrumentIdentity: item?.instrumentIdentity ?? item?.canonical?.instrumentIdentity ?? undefined,
          });
        }
        // The server's front door canonicalises BTC -> BTCUSDT and says so.
        // Bind sentences through ITS answer rather than a second resolver here.
        for (const r of Array.isArray(body?.symbolResolutions) ? body.symbolResolutions : []) {
          const asked = String(r?.asked ?? "").toUpperCase();
          const key = String(r?.lookupKey ?? "").toUpperCase();
          if (asked && key) resolutions.set(asked, key);
        }
        const missed = wanted.filter((s) => !reads.has(resolutions.get(s) ?? s));
        readStatus =
          `Fahali holds a current read on ${[...reads.keys()].join(", ") || "none of the named symbols"}.` +
          (missed.length
            ? ` No read for ${missed.join(", ")} — that is absence of coverage, never a finding that they are safe.`
            : "");
      } else if (res.ok && parsed.parseFailed) {
        readStatus = `The verdict lookup returned HTTP ${res.status} with a non-JSON body — a routing or deployment fault, NOT an empty result. Every symbol below is therefore NO_READ because the check did not run — NOT because it passed.`;
      } else {
        readStatus = `The verdict lookup did not return data (HTTP ${res.status}). Every symbol below is therefore NO_READ because the check did not run — NOT because it passed.`;
      }
    } catch (err: any) {
      readStatus = `The verdict lookup failed (${err?.name === "AbortError" ? "timed out" : String(err?.message ?? err)}). Every symbol below is NO_READ because the check did not run — NOT because it passed.`;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Detection-type sentences (volume spike, momentum, regime) are checked
  // against the alert tape for the instrument THEY name, over their own time
  // words. One read per instrument, from the earliest window any sentence needs.
  const now = new Date();
  const tapeSince = new Map<string, string>();
  for (const s of sentences) {
    if (!detectionClaimOf(s) && !claimsRegime(s)) continue;
    // EVERY instrument the sentence names is checked (same cap as checkAssertion).
    for (const sym of bindSentence(s, symbols, resolutions).slice(0, 4)) {
      const since = timeWindowOf(s, now).sinceIso;
      const prev = tapeSince.get(sym);
      if (!prev || since < prev) tapeSince.set(sym, since);
    }
  }
  const tape = new Map<string, TapeRead>();
  await Promise.all([...tapeSince].slice(0, 8).map(async ([sym, since]) => {
    tape.set(sym, await readTape(apiKey, sym, since));
  }));

  // `symbols` (the caller's hint), NOT the whole-claim list: passing every
  // name in the claim as the hint is what bound "Bitcoin ..." to NVDA.
  const assertions = sentences.map((s) => checkAssertion(s, reads, symbols, { resolutions, tape, now }));
  const summary = summarise(assertions);

  return okResult({
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    claim: String(claim),
    symbolsRecognised: wanted,
    // Echo what the check was asked about: the caller's hint PLUS every
    // instrument a sentence bound to. The envelope filters rows to the
    // requested set, so without this a sentence about Bitcoin under a caller
    // hint of ["NVDA"] was dropped from the response — leaving a summary that
    // counted a contradiction the reader could no longer see.
    requested: [...new Set([
      ...(symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean),
      ...assertions.flatMap((a) => a.symbols ?? (a.symbol ? [a.symbol] : [])),
    ])],
    ...(resolutions.size ? { symbolResolutions: [...resolutions].map(([asked, lookupKey]) => ({ asked, lookupKey })) } : {}),
    coverage: readStatus,
    safeToPublish: summary.safeToPublish,
    instruction: summary.instruction,
    verdictCounts: summary.counts,
    assertions,
    claimObject: {
      kind: "observation",
      basis: reads.size ? "measured" : "absent",
      reason: reads.size ? undefined : "no Fahali reading was available for the symbols named, so no assertion was scored against data",
    },
  });
}
