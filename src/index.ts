/**
 * Fahali MCP server — entry point.
 *
 * Exposes the live Fahali tool catalog via the Model Context Protocol.
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
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  TOOL_DEFINITIONS,
  FAHALI_OAUTH_SCOPES,
  annotationsForTool,
  buildToolTaxonomy,
  executableCapabilityWorkflows,
  requiredOAuthScopesForTool,
} from "./tools.js";
import {
  decorateForAgent,
  BUNDLE_VIEW_TOOLS,
  type BundleViewName,
  type AgentAuthContext,
  type AgentDecorationOptions,
} from "./agentPayload.js";
import { attachJudgedRecord, fetchJudgedRecord } from "./judgedRecord.js";
import { responseOptions, type BoundAuth } from "./responseOptions.js";
import {
  getMarketBriefing,
  getDailyBrief,
  getEntitlement,
  getMarketVerdict,
  getForecast72h,
  getPortfolioRisk,
  listConnectedAccounts,
  getContagionMap,
  getCapitalFlow,
  getMicrostructureProxy,
  getFlashCrashRisk,
  getDetectionActivity,
  getUnusualMoneyMovement,
  getMarketRisk,
  getCorrelationMatrix,
  getMarketSentiment,
  getHighestConviction,
  getMarketSnapshot,
  getEngineStatus,
  getFallWarnings,
  getEngineBoard,
  getCaseStudies,
  listResources,
  fetchResource,
  getTrackRecordScorecard,
  getLeadTime,
  getPortfolioMetrics,
  getMarketRegime,
  getMarketMood,
  getSectorRotation,
  getVisualIntelligence,
  getRealtimeAlerts,
  resolveInstrument,
  analyzeCustomPortfolio,
  runShockTest,
  saveMemory,
  searchMemories,
  createAlert,
  listAgentSessions,
  factCheckNarrative,
  watchPortfolio,
  listPortfolioWatches,
  updatePortfolioWatch,
  getPortfolioDecision,
  getWatchDelta,
  getActiveIncidents,
  acknowledgeIncidentTool,
  getIncidentTimeline,
  getVerdictHistory,
  getVerdictById,
  getEvidence,
  subscribeRisk,
  listRiskSubscriptions,
  updateRiskSubscription,
  unsubscribeRisk,
  currentToolName,
} from "./proxy.js";
import {
  PROCESS_KEY,
  extractAuthorizationCredential,
  extractKeyFromHandshake,
  MISSING_KEY_ERROR,
} from "./auth.js";
import { sessionErrorStatus, NO_SESSION_MESSAGE } from "./sessionStatus.js";
import {
  FahaliOAuthProvider,
  sameAuthenticatedPrincipal,
  type AuthenticatedSessionPrincipal,
} from "./oauth/provider.js";
import { verifyAssertion } from "./oauth/assertion.js";
import { OAuthStore, UnresolvedIdentityError } from "./oauth/store.js";
import {
  HttpInputError,
  credentialFingerprint,
  readFormOrJsonBody,
  readJsonBody,
  sendInputError,
  validateClientRegistration,
  validateCodeChallenge,
  validateScopes,
  DEFAULT_AUTHORIZE_SCOPES,
} from "./security.js";

/**
 * This version is what every MCP client is handed in the `initialize` response
 * (and what /health reports). It must match package.json and server.json — the
 * registry manifest — or a directory advertises one version while the server
 * announces another, and hosts that cache tool definitions by version can pin
 * a stale dictionary.
 *
 * They drifted before: server.json was moved to 1.5.3 while this stayed 1.5.2,
 * so the manifest promised a build that never announced itself. All three go to
 * 1.5.4 together with the 2026-08-14 scorecard-description correction.
 */
import { SERVER_INSTRUCTIONS } from "./serverInstructions.js";

import { FAHALI_PROMPTS, PROMPTS_BY_NAME } from "./prompts.js";
import { FAHALI_RESOURCES, readFahaliResource } from "./resources.js";
import { BUILD_REVISION } from "./buildRevision.js";
import { getJwks, loadReceiptKeys } from "./attestation.js";
const SERVER_INFO = {
  name: "fahali-mcp",
  // 🔴 THIRD copy of the version, and it drifted AGAIN. The comment above already
  // recorded one drift and asked for all three to move together; on 2026-08-22
  // package.json read 1.6.0, server.json 1.5.9, and this 1.6.0 — three numbers,
  // two of them wrong, because nothing FAILED when someone updated only one.
  // `shared/fahaliVoice.test.ts` now asserts all three agree, which is the only
  // reason this can stop happening.
  version: "1.28.0",
};

/** True if a JSON-RPC payload (single or batch) contains an `initialize` request. */
function isInitializeRequest(body: unknown): boolean {
  const isInit = (m: any) => m && typeof m === "object" && m.method === "initialize";
  return Array.isArray(body) ? body.some(isInit) : isInit(body);
}

function initializeClientIdentity(body: unknown): string {
  const messages = Array.isArray(body) ? body : [body];
  const initialize = messages.find(
    (message: any) => message && typeof message === "object" && message.method === "initialize",
  ) as any;
  const name = String(initialize?.params?.clientInfo?.name || "unknown-client")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 80);
  const version = String(initialize?.params?.clientInfo?.version || "unknown")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 40);
  return `${name}@${version}`;
}

function toolCallsIn(body: unknown): Array<{ name: string; args: unknown }> {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message: any) => {
    if (!message || typeof message !== "object" || message.method !== "tools/call") return [];
    const name = message.params?.name;
    return typeof name === "string"
      ? [{ name, args: message.params?.arguments }]
      : [];
  });
}

function safeRequestId(req: IncomingMessage): string {
  const candidate = req.headers["x-request-id"];
  return typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function safeLogMessage(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(?:sk_live_|fahali_oat_|fahali_ort_|fahali_ac_)[A-Za-z0-9_-]+/g, "[redacted-credential]")
    .slice(0, 500);
}

/** Extract client_secret from a Basic auth header (RFC 2617 §2). */
function extractBasicAuthSecret(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Basic ")) return undefined;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    const sep = decoded.indexOf(":");
    return sep >= 0 ? decoded.slice(sep + 1) : undefined;
  } catch {
    return undefined;
  }
}


type SessionAuthorizationState = {
  scopes: string[];
  unrestricted: boolean;
  requestId: string | null;
};


function missingOAuthScopes(
  name: string,
  args: unknown,
  authorization: SessionAuthorizationState,
): string[] {
  if (authorization.unrestricted) return [];
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
  const required = requiredOAuthScopesForTool(name, a);
  return required.filter((scope) => !authorization.scopes.includes(scope));
}

function authToolError(
  code: "AUTH_EXPIRED" | "AUTH_SCOPE",
  message: string,
  authorization: SessionAuthorizationState,
  requiredScopes: string[] = [],
): CallToolResult {
  const error = {
    error: code,
    message,
    retryable: code === "AUTH_EXPIRED",
    requestId: authorization.requestId,
    ...(requiredScopes.length ? { requiredScopes } : {}),
  };
  return {
    content: [{ type: "text", text: `## ${code}\n\n${message}\n\nRequest ID: ${authorization.requestId ?? "unavailable"}` }],
    structuredContent: error,
    isError: true,
  };
}

function localResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

const BUNDLE_DEFAULT_VIEWS = ["market_decision", "briefing", "risk_score", "regime", "conviction"] as const;

// Derived, not restated. BUNDLE_VIEW_TOOLS is what lets the classifier judge a
// view under its own tool contract; a view accepted here but missing there would
// be unclassifiable and would read as coverage we cannot prove. Deriving the set
// (and typing `calls` by the same keys, below) makes that drift impossible to
// compile rather than something a test has to remember to check.
const BUNDLE_VIEW_NAMES: ReadonlySet<string> = new Set(Object.keys(BUNDLE_VIEW_TOOLS));

async function bundleResult(
  apiKey: string | undefined,
  requested: unknown,
  symbols: string | undefined,
): Promise<CallToolResult> {
  // The predicate is what carries the caller's arbitrary string across into a
  // name the classifier has a contract for. Without it a view could be dispatched
  // that BUNDLE_VIEW_TOOLS cannot classify — the exact hole that let a bundle
  // report NO_COVERAGE over measured data.
  const isBundleView = (view: string): view is BundleViewName => BUNDLE_VIEW_NAMES.has(view);
  const requestedViews: BundleViewName[] = Array.isArray(requested)
    ? [...new Set(requested.map(String).filter(isBundleView))].slice(0, 10)
    : [...BUNDLE_DEFAULT_VIEWS];
  const viewsToRun: BundleViewName[] = requestedViews.length ? requestedViews : [...BUNDLE_DEFAULT_VIEWS];
  const calls: Record<BundleViewName, () => Promise<CallToolResult>> = {
    briefing: () => getMarketBriefing(apiKey),
    market_decision: () => getMarketVerdict(apiKey, symbols, false),
    risk_score: () => getMarketRisk(apiKey),
    regime: () => getMarketRegime(apiKey),
    conviction: () => getHighestConviction(apiKey),
    portfolio: () => getPortfolioRisk(apiKey),
    accounts: () => listConnectedAccounts(apiKey),
    realtime: () => getRealtimeAlerts(apiKey),
    lead_time: () => getLeadTime(apiKey),
    engine_status: () => getEngineStatus(apiKey),
    daily_brief: () => getDailyBrief(apiKey),
  };

  const settled = await Promise.allSettled(viewsToRun.map((view) => calls[view]()));
  const views: Record<string, unknown> = {};
  const completedViews: string[] = [];
  const failedViews: Array<{ view: string; error: string }> = [];
  for (let i = 0; i < viewsToRun.length; i += 1) {
    const view = viewsToRun[i];
    const outcome = settled[i];
    if (outcome.status === "rejected") {
      failedViews.push({ view, error: outcome.reason instanceof Error ? outcome.reason.message : "view request failed" });
      continue;
    }
    if (outcome.value.isError) {
      const text = outcome.value.content?.find((entry) => entry.type === "text");
      failedViews.push({ view, error: text?.type === "text" ? text.text : "view returned an error" });
      continue;
    }
    if (outcome.value.structuredContent && typeof outcome.value.structuredContent === "object") {
      views[view] = outcome.value.structuredContent;
      completedViews.push(view);
    } else {
      failedViews.push({ view, error: "view returned no structured data" });
    }
  }
  const marketDecision = views.market_decision as Record<string, unknown> | undefined;
  const marketRows = Array.isArray(marketDecision?.data)
    ? marketDecision.data.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
  const firstMarketRow = marketRows[0];
  const bindingDecision = firstMarketRow && typeof firstMarketRow.canonical === "object"
    ? firstMarketRow.canonical
    : firstMarketRow && typeof firstMarketRow.verdict === "object"
      ? firstMarketRow.verdict
      : marketDecision && typeof marketDecision.decision === "object"
        ? marketDecision.decision
        : null;
  return localResult({
    status: completedViews.length === 0 ? "error" : failedViews.length ? "partial" : "ok",
    requestedViews: viewsToRun,
    completedViews,
    failedViews,
    views,
    decision: bindingDecision,
    decisionSource: bindingDecision ? "market_decision" : null,
  });
}

/**
 * Entitlement, resolved for the caller asking about capability.
 *
 * Re-audit N4 (2026-08-27): this tool says "Start here when planning an
 * autonomous Fahali workflow." An auditor did, and got five workflows, a tool
 * catalogue with requiredTier per tool, and oauth.supportedScopes listing eight
 * scopes — with no indication that their credential was a free developer key
 * limited to the verdict endpoint. Three of the five workflows could not run.
 * They learned that one 403 at a time.
 *
 * The refusal path already knew all of it. The PLANNING path did not, which
 * made the one tool designed for autonomous planning the one tool that
 * guaranteed a plan built on it would fail.
 *
 * Never fails the call: capability is still worth returning when entitlement is
 * unavailable. But it is then reported as UNKNOWN, never as unrestricted —
 * "everything is executable" is the flattering guess and it is the one that
 * sends a planner into a wall.
 */
type CallerEntitlement = {
  known: boolean;
  keyType: string | null;
  tier: string | null;
  grantedScopes: string[];
  /**
   * 🔴 THE QUALIFIER HAD NO FIELD TO TRAVEL IN, SO IT COULD NOT SURVIVE.
   *
   * `/agent/entitlement` publishes `grantedScopes` beside
   * `grantedScopesBasis: {measured: false, derivedFrom: "api_key_scope",
   * authority: "endpoints.blocked"}` — the endpoint is explicit that the list
   * is INDICATIVE and that `endpoints.blocked` wins where they disagree.
   *
   * This type had no slot for it, so the projection dropped it, and the note
   * written in its place said "grantedScopes describes YOUR credential" —
   * asserting exactly what the dropped qualifier denies. Verified live at
   * `detail: "audit"` on 2026-08-28: absent at every detail level.
   *
   * A dropped field is not a disagreement, it is a silent upgrade of a hedge
   * into a fact. Carry it.
   */
  grantedScopesBasis: Record<string, unknown> | null;
  /** Why `tier` is a read-depth label and not the account's subscription. Same reason as above: a qualifier with no field to travel in cannot survive the projection. */
  tierBasis: Record<string, unknown> | null;
  blockedEndpoints: Set<string>;
  blockedKnown: boolean;
  raw: Record<string, unknown> | null;
  reason: string | null;
};

async function resolveEntitlement(apiKey: string | undefined): Promise<CallerEntitlement> {
  const unknown = (reason: string): CallerEntitlement => ({
    known: false,
    keyType: null,
    tier: null,
    grantedScopes: [],
    grantedScopesBasis: null,
    tierBasis: null,
    blockedEndpoints: new Set<string>(),
    blockedKnown: false,
    raw: null,
    reason,
  });
  try {
    const result = await getEntitlement(apiKey);
    const body = result.structuredContent as Record<string, unknown> | undefined;
    if (result.isError || !body || typeof body !== "object") {
      return unknown("The entitlement endpoint did not answer; treat every executable flag below as unverified.");
    }
    const endpoints = (body.endpoints ?? {}) as Record<string, unknown>;
    const blockedList = Array.isArray(endpoints.blocked) ? endpoints.blocked : [];
    return {
      known: true,
      keyType: typeof body.keyType === "string" ? body.keyType : null,
      tier: typeof body.tier === "string" ? body.tier : null,
      grantedScopes: Array.isArray(body.grantedScopes) ? body.grantedScopes.map(String) : [],
      grantedScopesBasis:
        body.grantedScopesBasis && typeof body.grantedScopesBasis === "object"
          ? (body.grantedScopesBasis as Record<string, unknown>)
          : null,
      tierBasis:
        body.tierBasis && typeof body.tierBasis === "object" ? (body.tierBasis as Record<string, unknown>) : null,
      blockedEndpoints: new Set(
        blockedList
          .map((entry) => (entry && typeof entry === "object" ? String((entry as Record<string, unknown>).path ?? "") : ""))
          .filter(Boolean),
      ),
      blockedKnown: endpoints.known === true,
      raw: body,
      reason: null,
    };
  } catch {
    return unknown("The entitlement endpoint could not be reached; treat every executable flag below as unverified.");
  }
}

/** null = not knowable on this call. Never defaults to true. */
function endpointExecutable(entitlement: CallerEntitlement, endpoint: string | undefined): boolean | null {
  if (!entitlement.known || !entitlement.blockedKnown) return null;
  if (!endpoint) return null;
  return !entitlement.blockedEndpoints.has(endpoint);
}

async function capabilitiesResult(
  apiKey: string | undefined,
  authorization: SessionAuthorizationState,
): Promise<CallToolResult> {
  const toolTaxonomy = buildToolTaxonomy(TOOL_DEFINITIONS as any[]);
  const entitlement = await resolveEntitlement(apiKey);
  const endpointFor = (name: string): string | undefined => {
    const tool = (TOOL_DEFINITIONS as any[]).find((candidate) => candidate.name === name);
    return tool?._meta?.endpoint;
  };
  /**
   * ── Why `executable` consults TWO gates (2026-08-29) ──────────────────────
   *
   * A call can be refused two independent ways, and this response knew only one:
   *
   *   1. the API-key entitlement (`endpoints.blocked`), fetched from upstream;
   *   2. the OAuth scope gate, enforced locally in-process before dispatch.
   *
   * A live connector session measured on 2026-08-29 held exactly `read:market`
   * and `read:portfolio` of the eight scopes. Twelve tools were unreachable —
   * every watch write, memory, alerts, and all four delivery tools — while this
   * catalogue reported `executable: true` for all of them and
   * `blockedEndpoints: []`, and the note below told the agent blockedEndpoints
   * was the authority. An external audit read that as ten "missing
   * capabilities" and filed it as a P0. The capabilities existed; they were
   * unreachable, and this surface said otherwise.
   *
   * Gate 2 was invisible here purely because `capabilitiesResult` never
   * received the session's authorization — not because it is hard to compute.
   *
   * `missingOAuthScopes` is the SAME function the dispatcher refuses with, so
   * this cannot drift from real enforcement. If this says executable and the
   * dispatcher then refuses, the two disagree about one shared function — a
   * test failure, not a silent lie.
   *
   * A tool this credential cannot call must never be advertised as executable.
   * Absence of a known block is not permission.
   */
  const missingScopesFor = (name: string, args?: Record<string, unknown>): string[] =>
    missingOAuthScopes(name, args, authorization);

  /** false = refused now · true = both gates pass · null = not knowable. */
  const toolExecutable = (name: string, args?: Record<string, unknown>): boolean | null => {
    if (missingScopesFor(name, args).length > 0) return false;
    return endpointExecutable(entitlement, endpointFor(name));
  };

  const workflows = executableCapabilityWorkflows(TOOL_DEFINITIONS as any[]).map((workflow) => {
    // Step arguments matter: fahali_get_watch_delta needs write:portfolio on a
    // default call and only read:portfolio at refresh:false. Judging the tool
    // without its arguments would report the wrong gate for the exact step.
    const evaluated = workflow.steps.map((step) => {
      const stepArgs = (step as { arguments?: Record<string, unknown> }).arguments;
      return {
        step,
        missingScopes: missingScopesFor(step.tool, stepArgs),
        executable: toolExecutable(step.tool, stepArgs),
      };
    });
    const blockingSteps = evaluated.filter((entry) => entry.executable === false);
    const anyUnknown = evaluated.some((entry) => entry.executable === null);
    return {
      ...workflow,
      // A workflow this credential cannot run is worse than one not offered:
      // the planner commits to it first and fails on step three.
      executable: blockingSteps.length ? false : anyUnknown ? null : true,
      blockedBy: blockingSteps.map(({ step, missingScopes }) => ({
        tool: step.tool,
        endpoint: endpointFor(step.tool) ?? null,
        // `requiredScope: "paid"` was hardcoded here and named neither the gate
        // that refuses nor the action that would clear it.
        missingScopes,
        requiredScope: missingScopes.length ? missingScopes.join(" ") : "paid",
        reason: missingScopes.length
          ? "This step's endpoint is healthy; this session's OAuth grant is missing " +
            missingScopes.join(", ") +
            ". Re-authorize with that scope to run it."
          : "This step's endpoint is healthy; the credential is under-scoped for it.",
      })),
    };
  });
  return localResult({
    serverVersion: SERVER_INFO.version,
    recommendedStart: "fahali_get_market_decision",
    // THE field the audit needed and could not get. Read this before planning.
    callerEntitlement: entitlement.known
      ? {
          known: true,
          keyType: entitlement.keyType,
          tier: entitlement.tier,
          grantedScopes: entitlement.grantedScopes,
          grantedScopesBasis: entitlement.grantedScopesBasis,
          tierBasis: entitlement.tierBasis,
          quota: (entitlement.raw?.quota as unknown) ?? null,
          blockedEndpointsKnown: entitlement.blockedKnown,
          blockedEndpoints: [...entitlement.blockedEndpoints],
          upgrade: (entitlement.raw?.upgrade as unknown) ?? null,
          /**
           * The OAuth grant this session actually holds, measured in-process
           * from the token rather than inferred upstream. `grantedScopes` above
           * is API-KEY vocabulary and is explicitly INDICATIVE; this is what the
           * dispatcher enforces. The two use different vocabularies on purpose
           * (`market:read` vs `read:market`) — do not merge or translate them.
           */
          oauthGrant: {
            measured: true,
            unrestricted: authorization.unrestricted,
            scopes: authorization.unrestricted
              ? [...FAHALI_OAUTH_SCOPES]
              : [...authorization.scopes],
            note:
              "A tool whose oauthScopes are not all present here is refused before dispatch, " +
              "whatever blockedEndpoints says. blockedEndpoints covers the API-key gate only.",
          },
          /**
           * Every tool this session is refused, with the scope that would clear
           * it. This is the field `blockedEndpoints` was believed to be: it was
           * empty on 2026-08-29 while twelve tools were being refused, because
           * it is structurally blind to the OAuth gate.
           */
          scopeBlockedTools: (TOOL_DEFINITIONS as any[])
            .map((tool) => {
              const missingScopes = missingScopesFor(tool.name);
              /**
               * 🔴 A CONDITIONALLY-blocked tool must not read as flatly blocked.
               *
               * `missingScopesFor(tool.name)` is called with NO arguments, so a
               * tool whose scopes depend on an argument is measured at its
               * WORST CASE. For `fahali_get_watch_delta` that is
               * `refresh: true` → `write:portfolio`, and the row then said the
               * tool was unavailable — while `tool._meta.oauthScopeCondition`,
               * set in the same process, said the requirement was conditional.
               * One response, two answers.
               *
               * It matters most on exactly the wrong tool: this server's own
               * instructions call `fahali_get_watch_delta` "the default repeat
               * read", so a two-scope connector was being told the primary
               * continuous-monitoring workflow was shut when
               * `{refresh: false}` dispatches fine. Measured 2026-08-31 on a
               * live `read:market`+`read:portfolio` grant: `refresh: false`
               * returned `watch_not_found` (it ran), `refresh: true` returned
               * `insufficient_scope` (it did not).
               *
               * This DISCLOSES the alternative; it does not widen any gate.
               * Requiring `write:portfolio` for a refresh is correct — a
               * refresh persists a new verdict.
               */
              const condition = tool._meta?.oauthScopeCondition;
              if (!condition || missingScopes.length === 0) {
                return { tool: tool.name, missingScopes };
              }
              const alternativeArguments = { [condition.argument]: false };
              const alternativeMissing = missingScopesFor(tool.name, alternativeArguments);
              return {
                tool: tool.name,
                missingScopes,
                alsoCallableAs: {
                  arguments: alternativeArguments,
                  missingScopes: alternativeMissing,
                  callableNow: alternativeMissing.length === 0,
                  note: alternativeMissing.length === 0
                    ? `Blocked as called by default. Passing ${condition.argument}=false makes this tool callable with the scopes this session already holds.`
                    : `Still blocked with ${condition.argument}=false; that variant needs ${alternativeMissing.join(", ")}.`,
                },
              };
            })
            .filter((entry) => entry.missingScopes.length > 0),
          // The endpoint publishes this list as INDICATIVE (`grantedScopesBasis.measured:
          // false`, `authority: "endpoints.blocked"`). This note used to read
          // "grantedScopes describes YOUR credential" full stop, which asserted the
          // measurement the basis explicitly disclaims. Both now travel together.
          note:
            "grantedScopes summarises THIS credential and is INDICATIVE, not measured — read grantedScopesBasis, " +
            "and where it disagrees with blockedEndpoints, blockedEndpoints is correct FOR THE API-KEY GATE. " +
            "That gate is not the only one: read oauthGrant and scopeBlockedTools for the OAuth gate, " +
            "which is enforced in-process and refuses before dispatch. `executable` reflects both. " +
            "A scopeBlockedTools row carrying `alsoCallableAs.callableNow: true` is blocked ONLY as called by " +
            "default — pass the arguments it names and the tool runs under the scopes you already hold. Read that " +
            "before concluding a workflow is shut. " +
            "oauth.supportedScopes is " +
            "the SERVER's list and is not an entitlement. NOTE the two use DIFFERENT vocabularies by design: " +
            "grantedScopes are API-KEY scopes (`market:read`), oauth.supportedScopes are OAUTH scopes " +
            "(`read:market`). They are separate systems — do not translate one into the other.",
        }
      : {
          known: false,
          reason: entitlement.reason,
          note: "Entitlement is unknown on this call, NOT unrestricted. Verify a tool with a real call before planning a multi-step workflow around it.",
        },
    primaryTools: toolTaxonomy.primary.tools,
    toolTaxonomy,
    workflows,
    tools: (TOOL_DEFINITIONS as any[]).map((tool) => ({
      name: tool.name,
      requiredTier: tool._meta?.requiredTier ?? "free",
      // requiredTier is descriptive; tier gates are open. `executable` is the
      // live answer for THIS credential — null when it could not be resolved.
      // It now reflects BOTH gates; it used to reflect only the API-key one and
      // therefore read `true` for tools this session is refused.
      executable: toolExecutable(tool.name),
      // Empty = nothing missing. Non-empty = this exact call is refused right
      // now, and these are the scopes that would unblock it. Judged with no
      // arguments, so a conditional-write tool reports its DEFAULT requirement
      // (see oauthScopeCondition for the cheaper read-only variant).
      missingScopes: missingScopesFor(tool.name),
      endpoint: tool._meta?.endpoint ?? null,
      disabled: tool._meta?.disabled === true,
      surfaceRole: tool._meta?.surfaceRole ?? "audit",
      canonicalEntryPoint: tool._meta?.canonicalEntryPoint === true,
      aliasOf: tool._meta?.aliasOf ?? null,
      requiredArguments: tool.inputSchema?.required ?? [],
      oauthScopes: tool._meta?.oauthScopes ?? requiredOAuthScopesForTool(tool.name),
      conditionalWrite: tool._meta?.conditionalWrite === true,
      oauthScopeCondition: tool._meta?.oauthScopeCondition ?? null,
      annotations: annotationsForTool(tool.name),
    })),
    oauth: {
      supportedScopes: [...FAHALI_OAUTH_SCOPES],
      rule: "Scopes are enforced per invocation; refresh may preserve or narrow a grant, never expand it.",
      scopeNote: "This is the SERVER's supported-scope list, not your grant. Read callerEntitlement.grantedScopes for what this credential holds.",
    },
    responseControls: {
      detail: ["brief", "standard", "audit"],
      defaultDetail: "audit",
      limit: "1-100",
      symbols: "comma-separated string or array",
      since: "ISO-8601 timestamp",
      include_withheld: true,
    },
    resources: FAHALI_RESOURCES.map((resource) => resource.uri),
    instrumentIdentity: {
      requiredFields: ["symbol", "canonicalId", "displayName", "assetClass", "venue", "quoteCurrency"],
      ambiguityRule: "Never infer an equity from a crypto pair whose base resembles a ticker.",
    },
  });
}

/**
 * Build a Server instance bound to a single caller's API key.
 * One instance per SSE connection (or one for the stdio process).
 */
function buildServer(
  apiKey: string | undefined,
  auth: BoundAuth = {
    credentialType: apiKey ? "api_key" : "none",
    expiresAt: null,
    refreshSupported: false,
  },
  authorization: SessionAuthorizationState = {
    scopes: ["*"],
    unrestricted: true,
    requestId: null,
  },
): Server {
  const server = new Server(SERVER_INFO, {
    // `prompts` is declared, not decorative: clients only call prompts/list
    // when the capability is advertised at handshake. Omitting it makes the
    // whole pack invisible no matter how good the templates are.
    /**
     * `tools.listChanged` is declared because a client that cached our
     * catalogue previously had NO protocol path back to the current one.
     *
     * ── The measurement that forced this (2026-08-27) ────────────────────────
     * An external auditor black-box tested "all 24 exposed Fahali MCPs" and
     * filed, as their broadest P0, that Fahali tells agents to call tools that
     * do not exist — naming nine. Eight of the nine were live and working; the
     * server exposes 47. Their client was holding a manifest from before a
     * 23-tool expansion and a 4-tool rename, and nothing we shipped could tell
     * it otherwise. The auditor was not careless. They were structurally unable
     * to see the product, and every conclusion they drew from that catalogue —
     * including three "misnamed endpoint" findings against tools we had already
     * renamed — inherited the error.
     *
     * `prompts` stays declared (clients only call prompts/list when it is
     * advertised) but without listChanged: the prompt pack is static and
     * promising notifications we never send would be a false capability claim.
     */
    capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} },
    instructions: SERVER_INSTRUCTIONS,
  });

  /**
   * Announce the catalogue once per session, immediately after handshake.
   *
   * The tool list is static within a process, so there is no runtime change to
   * report — which is exactly why this fires on initialize instead. We cannot
   * know which catalogue the connecting client already holds, and the two
   * outcomes are not symmetric: a redundant `tools/list` costs one cheap local
   * round trip, while a stale one costs the client many tools it believes do not
   * exist. Re-listing does not re-initialize, so this cannot loop.
   *
   * ⚠️ This is the only server-side lever that exists. It does NOT guarantee any
   * given host acts on the notification — host caching behaviour varies and must
   * be verified per host, not assumed. Same caution as the session-404 work.
   */
  const previousOnInitialized = server.oninitialized;
  server.oninitialized = () => {
    previousOnInitialized?.();
    // Never let a notification failure take down a working session.
    void server.sendToolListChanged().catch(() => {});
  };

  // ── Productised prompts ───────────────────────────────────────────────────
  // The guardrails are the product. Shipping them as MCP prompts means every
  // client surfaces them as ready-made templates instead of each integrator
  // re-deriving them — badly, because the failure mode of a hand-rolled Fahali
  // prompt is an agent quoting a precision without its recall, or reading
  // "no signal" as "safe".
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: FAHALI_PROMPTS.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments ?? [],
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const p = PROMPTS_BY_NAME.get(request.params.name);
    if (!p) {
      // Name what exists. A bare "unknown prompt" makes the client guess.
      throw new Error(
        `Unknown prompt "${request.params.name}". Available: ${FAHALI_PROMPTS.map((x) => x.name).join(", ")}`,
      );
    }
    const args = (request.params.arguments ?? {}) as Record<string, string>;
    const missing = (p.arguments ?? [])
      .filter((a) => a.required && !String(args[a.name] ?? "").trim())
      .map((a) => a.name);
    if (missing.length) {
      throw new Error(`Prompt "${p.name}" requires: ${missing.join(", ")}`);
    }
    return {
      description: p.description,
      messages: [
        { role: "user" as const, content: { type: "text" as const, text: p.render(args) } },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: FAHALI_RESOURCES.map((resource) => ({ ...resource })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const text = readFahaliResource(request.params.uri);
    if (text === null) throw new Error(`Unknown Fahali resource: ${request.params.uri}`);
    const resource = FAHALI_RESOURCES.find((entry) => entry.uri === request.params.uri)!;
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map(t => ({
      ...t,
      annotations: {
        title: t.name.replace(/^fahali_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        ...annotationsForTool(t.name),
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    // Auth gate — short-circuit if no key is bound. Avoids a useless 401
    // round trip to the upstream and gives the MCP client a clear actionable
    // message instead of a generic "HTTP 401."
    if (!apiKey) {
      return MISSING_KEY_ERROR;
    }

    if (auth.expiresAt && new Date(auth.expiresAt).getTime() <= Date.now()) {
      return authToolError(
        "AUTH_EXPIRED",
        "The OAuth access token expired. Refresh it before retrying this workflow.",
        authorization,
      );
    }

    const missingScopes = missingOAuthScopes(
      request.params.name,
      request.params.arguments,
      authorization,
    );
    if (missingScopes.length) {
      return authToolError(
        "AUTH_SCOPE",
        `This tool requires additional OAuth permission: ${missingScopes.join(", ")}.`,
        authorization,
        missingScopes,
      );
    }

    // THE ONE SEAM. Every tool result — all thirty, plus the deprecated aliases
    // — leaves through decorateForAgent, which attaches the narrative briefing,
    // the stated boundaries, and the routed next calls. Wrapping the dispatch
    // rather than each handler is deliberate: thirty call sites is thirty
    // chances for one to be forgotten, and the one forgotten is the one that
    // ships raw JSON to a customer's agent.
    // The record is fetched IN PARALLEL with the tool call, not after it. It is
    // secondary — the caller asked for a read, not for the record — so it must
    // never add its latency to theirs. `fetchJudgedRecord` is cached (5 min)
    // and never rejects, so Promise.all cannot fail on its account, and a slow
    // or dead record endpoint degrades the record LINE rather than the call.
    const [toolResult, record] = await Promise.all([
      // The tool name rides along with every upstream request made while this
      // dispatch runs, so API telemetry can attribute the call to the TOOL and
      // not to whichever sibling is hardcoded on a shared route. Deliberately
      // wraps ONLY the dispatch: `fetchJudgedRecord` is our own overhead, not
      // something the agent asked for, and must not be counted as a tool call.
      currentToolName.run(request.params.name, () =>
        dispatchTool(request.params.name, request.params.arguments, apiKey, authorization)),
      fetchJudgedRecord(apiKey),
    ]);
    return decorateForAgent(
      request.params.name,
      attachJudgedRecord(toolResult, record, request.params.name),
      responseOptions(request.params.arguments, auth),
    );
  });

  return server;
}

async function dispatchTool(
  name: string,
  args: unknown,
  apiKey: string | undefined,
  // Needed by fahali_get_capabilities so the catalogue can report what THIS
  // session may actually call. Defaulted so a caller that omits it cannot
  // silently claim an unrestricted grant.
  authorization: SessionAuthorizationState = { scopes: [], unrestricted: false, requestId: null },
): Promise<CallToolResult> {
  {
    switch (name) {
      case "fahali_get_market_decision": {
        const a = args as Record<string, unknown> | undefined;
        const rawSymbols = a?.symbols;
        const symbols = Array.isArray(rawSymbols)
          ? rawSymbols.map(String).join(",")
          : typeof rawSymbols === "string"
            ? rawSymbols
            : undefined;
        return getMarketVerdict(apiKey, symbols, Boolean(a?.includeContagion));
      }
      case "fahali_get_symbol_decision": {
        const a = args as Record<string, unknown> | undefined;
        const symbol = typeof a?.symbol === "string" ? a.symbol.trim() : "";
        if (!symbol) {
          return {
            content: [{ type: "text", text: "## INVALID_ARGUMENT\n\n`symbol` is required." }],
            structuredContent: {
              code: "INVALID_ARGUMENT",
              message: "symbol is required",
              retryable: false,
            },
            isError: true,
          };
        }
        return getMarketVerdict(apiKey, symbol, Boolean(a?.includeContagion));
      }
      case "fahali_get_market_verdict": {
        const a = args as Record<string, unknown> | undefined;
        // Same join(",") normalization as market_decision above: the envelope
        // injects array-typed `symbols` and URLSearchParams would stringify it
        // by accident. Fixed 2026-09-11 — was silently mis-shaping the query.
        const rawVerdictSymbols = a?.symbols;
        return getMarketVerdict(
          apiKey,
          Array.isArray(rawVerdictSymbols)
            ? rawVerdictSymbols.map(String).join(",")
            : (rawVerdictSymbols as string | undefined),
          Boolean(a?.includeContagion),
        );
      }
      case "fahali_get_bundle": {
        const a = args as Record<string, unknown> | undefined;
        const rawSymbols = a?.symbols;
        const symbols = Array.isArray(rawSymbols)
          ? rawSymbols.map(String).join(",")
          : typeof rawSymbols === "string"
            ? rawSymbols
            : undefined;
        return bundleResult(apiKey, a?.views, symbols);
      }
      // fahali_get_72h_forecast: renamed to fahali_get_forecast 2026-08-06 —
      // the old name overclaimed a fixed 72h window; most forecasts in this
      // system register 6-36h. Old name kept dispatchable (unadvertised, see
      // the DEPRECATED_ALIASES block below) so live callers keep working.
      case "fahali_get_forecast":
      case "fahali_get_72h_forecast": {
        const a = args as Record<string, unknown> | undefined;
        const symbol = a?.symbol as string | undefined;
        if (!symbol) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "symbol is required" }) }],
            isError: true,
          };
        }
        return getForecast72h(apiKey, symbol, a?.include as string | undefined);
      }
      case "fahali_get_portfolio_risk":
        return getPortfolioRisk(apiKey);
      case "fahali_list_connected_accounts":
        return listConnectedAccounts(apiKey);
      case "fahali_get_contagion_map":
        return getContagionMap(apiKey);
      case "fahali_get_capital_flow": {
        const a = args as Record<string, unknown> | undefined;
        const rawSymbols = a?.symbols;
        const symbols = Array.isArray(rawSymbols)
          ? rawSymbols.map(String).join(",")
          : typeof rawSymbols === "string"
            ? rawSymbols
            : undefined;
        return getCapitalFlow(apiKey, {
          symbol: a?.symbol as string | undefined,
          symbols,
          limit: a?.limit as number | undefined,
          since: a?.since as string | undefined,
        });
      }
      // ── Renamed 2026-07-31, OLD NAMES STILL DISPATCH ─────────────────────
      // The advertised names now say what these tools measure. The previous
      // names claimed data feeds we do not have — "dark pool" (we see no
      // off-exchange prints) and "smart money" (we cannot identify who traded).
      //
      // The old names are NOT in TOOL_DEFINITIONS, so no new agent discovers the
      // claim, but they remain dispatchable so anything already calling them
      // keeps working. check-dispatch only FAILS on advertised-but-undispatchable;
      // an unadvertised case is intentional here. DO NOT DELETE THESE as "orphan
      // cases" — removing them breaks live integrations.
      case "fahali_get_microstructure_proxy":
      case "fahali_get_dark_pool_activity": { // deprecated alias
        const a = args as Record<string, unknown> | undefined;
        const rawSymbols = a?.symbols;
        const symbols = Array.isArray(rawSymbols)
          ? rawSymbols.map(String).join(",")
          : typeof rawSymbols === "string"
            ? rawSymbols
            : undefined;
        return getMicrostructureProxy(apiKey, {
          symbol: a?.symbol as string | undefined,
          symbols,
          limit: a?.limit as number | undefined,
          since: a?.since as string | undefined,
        });
      }
      case "fahali_get_flash_crash_risk":
        return getFlashCrashRisk(apiKey);
      case "fahali_get_detection_activity":
      case "fahali_get_smart_money_dashboard": // deprecated alias
        return getDetectionActivity(apiKey);
      case "fahali_get_unusual_money_movement":
      case "fahali_get_whale_activity": { // deprecated alias
        const a = args as Record<string, unknown> | undefined;
        const rawSymbols = a?.symbols;
        const symbols = Array.isArray(rawSymbols)
          ? rawSymbols.map(String).join(",")
          : typeof rawSymbols === "string"
            ? rawSymbols
            : undefined;
        return getUnusualMoneyMovement(apiKey, {
          symbols,
          limit: a?.limit as number | undefined,
          since: a?.since as string | undefined,
          minimumConfidence: a?.minimum_confidence as number | undefined,
          minimumFlowUsd: a?.minimum_flow_usd as number | undefined,
        });
      }
      case "fahali_get_market_risk_score":
      case "fahali_get_institutional_risk_score": // deprecated alias
        return getMarketRisk(apiKey);
      case "fahali_get_correlation_matrix": {
        const a = args as Record<string, unknown> | undefined;
        const rawSymbols = a?.symbols;
        const symbols = Array.isArray(rawSymbols)
          ? rawSymbols.map(String).join(",")
          : typeof rawSymbols === "string"
            ? rawSymbols
            : undefined;
        return getCorrelationMatrix(apiKey, symbols);
      }
      case "fahali_get_market_sentiment": {
        const a = args as Record<string, unknown> | undefined;
        return getMarketSentiment(
          apiKey,
          a?.symbol as string | undefined,
          a?.limit as number | undefined,
        );
      }
      case "fahali_get_highest_conviction_signals":
        return getHighestConviction(apiKey);
      // The four params below are ADVERTISED in tools.ts and were silently
      // discarded here until 2026-08-14 — `limit: 10` returned all ~2,256
      // assets (161K chars), overran the token budget and failed the call.
      // Argument names are the schema's snake_case; the proxy maps them to the
      // query string. If you add a param to the schema, add it here too — an
      // accepted-and-ignored parameter is a lie the caller cannot detect.
      case "fahali_get_market_snapshot": {
        const a = args as Record<string, unknown> | undefined;
        return getMarketSnapshot(apiKey, {
          limit: typeof a?.limit === "number" ? a.limit : undefined,
          sortBy: typeof a?.sort_by === "string" ? a.sort_by : undefined,
          compact: a?.compact === true,
          assetClass: typeof a?.asset_class === "string" ? a.asset_class : undefined,
        });
      }
      case "fahali_get_engine_status":
        return getEngineStatus(apiKey);
      case "fahali_get_fall_warnings":
        return getFallWarnings(apiKey, args);
      case "fahali_get_engine_board":
        return getEngineBoard(apiKey, args);
      case "fahali_get_case_studies":
        return getCaseStudies(apiKey);
      case "fahali_list_resources":
        return listResources(apiKey);
      case "fahali_fetch_resource": {
        const a = args as Record<string, unknown> | undefined;
        const str = (v: unknown) => (typeof v === "string" ? v : undefined);
        const rec = (v: unknown): Record<string, string> => {
          if (v == null || typeof v !== "object" || Array.isArray(v)) return {};
          const out: Record<string, string> = {};
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (val == null) continue;
            out[k] = typeof val === "string" ? val : String(val);
          }
          return out;
        };
        return fetchResource(apiKey, str(a?.resource) ?? "", rec(a?.path_params), rec(a?.query));
      }
      case "fahali_get_track_record_scorecard":
        return getTrackRecordScorecard(apiKey);
      case "fahali_get_lead_time":
        return getLeadTime(apiKey);
      case "fahali_get_portfolio_metrics":
        return getPortfolioMetrics(apiKey);
      case "fahali_get_market_regime":
        return getMarketRegime(apiKey);
      case "fahali_get_market_mood":
        return getMarketMood(apiKey);
      case "fahali_get_sector_rotation":
        return getSectorRotation(apiKey);
      case "fahali_get_visual_intelligence":
        return getVisualIntelligence(apiKey);
      case "fahali_resolve_instrument": {
        const a = args as Record<string, unknown> | undefined;
        return resolveInstrument(
          apiKey,
          (a?.symbols ?? a?.symbol) as string | string[] | undefined,
          (a?.assetClass ?? a?.asset_class) as string | undefined,
        );
      }
      case "fahali_get_realtime_alerts": {
        const a = args as Record<string, unknown> | undefined;
        return getRealtimeAlerts(apiKey, {
          symbols: a?.symbols as string | string[] | undefined,
          alert_types: a?.alert_types as string | string[] | undefined,
          since: a?.since as string | undefined,
          max_rows: a?.max_rows as number | undefined,
        });
      }
      case "fahali_analyze_custom_portfolio": {
        const a = args as Record<string, unknown> | undefined;
        return analyzeCustomPortfolio(
          apiKey,
          a?.positions as { symbol: string; market_value: number }[] | undefined,
          a?.symbols as string[] | undefined,
        );
      }
      case "fahali_run_shock_test": {
        const a = args as Record<string, unknown> | undefined;
        return runShockTest(
          apiKey,
          a?.scenario as string | undefined,
          a?.positions as { symbol: string; market_value: number }[] | undefined,
          a?.shocks as Array<Record<string, unknown>> | undefined,
          a?.horizon as string | undefined,
          a?.shockSymbol as string | undefined,
          a?.shockPct as number | undefined,
        );
      }
      case "fahali_get_market_briefing":
        return getMarketBriefing(apiKey);
      case "fahali_daily_brief":
        return getDailyBrief(apiKey);
      case "fahali_save_memory":
      case "save_memory": { // deprecated alias
        const a = args as Record<string, unknown> | undefined;
        return saveMemory(
          apiKey,
          a?.key as string,
          a?.value as Record<string, unknown>,
          a?.memory_type as string | undefined,
        );
      }
      case "fahali_search_memories":
      case "search_memories": { // deprecated alias
        const a = args as Record<string, unknown> | undefined;
        return searchMemories(apiKey, a?.query as string, a?.limit as number | undefined);
      }
      case "fahali_create_alert":
      case "create_alert": { // deprecated alias
        const a = args as Record<string, unknown> | undefined;
        return createAlert(
          apiKey,
          a?.symbol as string,
          a?.alert_type as string,
          a?.message as string,
          a?.severity as string,
          a?.confidence as number | undefined,
          a?.idempotency_key as string | undefined,
        );
      }
      case "fahali_fact_check_narrative": {
        const a = args as Record<string, unknown> | undefined;
        // Accept string|string[] like resolve_instrument: a caller passing
        // "NVDA" used to have it silently ignored, narrowing the check scope
        // while reporting NO_READ on the dropped symbols.
        const rawCheckSymbols = a?.symbols;
        return factCheckNarrative(
          apiKey,
          a?.claim as string,
          Array.isArray(rawCheckSymbols)
            ? (rawCheckSymbols as string[])
            : typeof rawCheckSymbols === "string" && rawCheckSymbols.trim()
              ? [rawCheckSymbols]
              : undefined,
        );
      }
      case "fahali_watch_portfolio": {
        const a = (args ?? {}) as Record<string, unknown>;
        return watchPortfolio(apiKey, {
          idempotency_key: a.idempotency_key as string,
          name: a.name as string | undefined,
          positions: a.positions as any,
          account_ids: a.account_ids as string[] | undefined,
          mandate: a.mandate as Record<string, unknown> | undefined,
          thresholds: a.thresholds as Record<string, unknown> | undefined,
          evaluation_interval_minutes: a.evaluation_interval_minutes as number | undefined,
        } as Parameters<typeof watchPortfolio>[1] & { idempotency_key: string });
      }
      case "fahali_list_portfolio_watches": {
        const a = (args ?? {}) as Record<string, unknown>;
        return listPortfolioWatches(apiKey, a.limit as number | undefined);
      }
      case "fahali_update_portfolio_watch": {
        const a = (args ?? {}) as Record<string, unknown>;
        const { watch_id, detail, limit, symbols, since, include_withheld, ...body } = a;
        return updatePortfolioWatch(apiKey, watch_id as string, body);
      }
      case "fahali_get_portfolio_decision": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getPortfolioDecision(apiKey, a.watch_id as string, a.refresh !== false);
      }
      case "fahali_get_watch_delta": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getWatchDelta(apiKey, a.watch_id as string, a.refresh !== false);
      }
      case "fahali_get_active_incidents": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getActiveIncidents(apiKey, {
          watch_id: a.watch_id as string | undefined,
          include_resolved: a.include_resolved as boolean | undefined,
          limit: a.limit as number | undefined,
        });
      }
      case "fahali_acknowledge_incident": {
        const a = (args ?? {}) as Record<string, unknown>;
        return acknowledgeIncidentTool(apiKey, a.incident_id as string, {
          // `!== undefined` rather than presence: a caller spreading an optional
          // field sends `{note: undefined}`, which a presence check reads as supplied.
          acknowledged_by: a.acknowledged_by !== undefined ? String(a.acknowledged_by) : undefined,
          note: a.note !== undefined ? String(a.note) : undefined,
        });
      }
      case "fahali_get_incident_timeline": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getIncidentTimeline(apiKey, a.incident_id as string, a.limit as number | undefined);
      }
      case "fahali_get_verdict_history": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getVerdictHistory(apiKey, {
          watch_id: a.watch_id as string | undefined,
          symbol: a.symbol as string | undefined,
          as_of: a.as_of as string | undefined,
          since: a.since as string | undefined,
          limit: a.limit as number | undefined,
          cursor: a.cursor as string | undefined,
        });
      }
      case "fahali_get_verdict_by_id": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getVerdictById(apiKey, a.verdict_id as string);
      }
      case "fahali_get_evidence": {
        const a = (args ?? {}) as Record<string, unknown>;
        return getEvidence(apiKey, a.verdict_id as string, {
          evidence_ids: a.evidence_ids as string | Array<string | number> | undefined,
          detail: a.detail as string | undefined,
          limit: a.limit as number | undefined,
          offset: a.offset as number | undefined,
        });
      }
      case "fahali_subscribe_risk": {
        const a = (args ?? {}) as Record<string, unknown>;
        const { watch_id, detail, limit, symbols, since, include_withheld, ...body } = a;
        return subscribeRisk(apiKey, watch_id as string, body);
      }
      case "fahali_list_risk_subscriptions": {
        const a = (args ?? {}) as Record<string, unknown>;
        return listRiskSubscriptions(apiKey, a.watch_id as string | undefined);
      }
      case "fahali_update_subscription": {
        const a = (args ?? {}) as Record<string, unknown>;
        const { subscription_id, detail, limit, symbols, since, include_withheld, ...body } = a;
        return updateRiskSubscription(apiKey, subscription_id as string, body);
      }
      case "fahali_unsubscribe_risk": {
        const a = (args ?? {}) as Record<string, unknown>;
        const { subscription_id, detail, limit, symbols, since, include_withheld, ...body } = a;
        return unsubscribeRisk(apiKey, subscription_id as string, body);
      }
      case "fahali_get_capabilities":
        return capabilitiesResult(apiKey, authorization);
      case "fahali_list_agent_sessions":
      case "list_agent_sessions": // deprecated alias
        return listAgentSessions(apiKey);
      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  }
}

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await buildServer(PROCESS_KEY, {
    credentialType: PROCESS_KEY ? "process_key" : "none",
    expiresAt: null,
    refreshSupported: false,
  }).connect(transport);
  if (PROCESS_KEY) {
    console.error("[fahali-mcp] stdio transport connected (API key from env)");
  } else {
    console.error(
      "[fahali-mcp] stdio transport connected — WARNING: no FAHALI_API_KEY env var set, tool calls will return missing_api_key errors",
    );
  }
}

async function runSSE(port: number): Promise<void> {
  const MAX_ACTIVE_TRANSPORT_SESSIONS = 2_000;
  const ALLOW_KEYLESS_INTROSPECTION =
    String(process.env.MCP_ALLOW_KEYLESS_INTROSPECTION || "").trim().toLowerCase() === "true";
  const parsedIdleTimeout = Number(process.env.MCP_SESSION_IDLE_TIMEOUT_MS || 30 * 60_000);
  const SESSION_IDLE_TIMEOUT_MS = Number.isFinite(parsedIdleTimeout)
    ? Math.min(24 * 60 * 60_000, Math.max(5 * 60_000, parsedIdleTimeout))
    : 30 * 60_000;

  type LegacySession = {
    transport: SSEServerTransport;
    lastSeen: number;
    principal: AuthenticatedSessionPrincipal;
    auth: BoundAuth;
    authorization: SessionAuthorizationState;
  };
  type StreamSession = {
    transport: StreamableHTTPServerTransport;
    lastSeen: number;
    principal?: AuthenticatedSessionPrincipal;
    auth: BoundAuth;
    authorization: SessionAuthorizationState;
  };

  // Each session owns its Server instance through the transport reference. No
  // bearer token is stored; the binding is the stable authenticated principal
  // plus OAuth/MCP client identity.
  const sessions = new Map<string, LegacySession>();
  // Streamable HTTP sessions (the modern transport — Claude, ChatGPT, Cursor,
  // Perplexity, VS Code). Same per-session key-in-closure isolation as SSE.
  const streamSessions = new Map<string, StreamSession>();

  const oauthStore = new OAuthStore();
  oauthStore.ensureTables().catch(e => console.error(`[oauth] table init error: ${safeLogMessage(e)}`));
  setInterval(() => {
    oauthStore.cleanupExpired().catch(e => console.error(`[oauth] expiry cleanup failed: ${safeLogMessage(e)}`));
  }, 10 * 60_000).unref();
  const oauthProvider = new FahaliOAuthProvider(oauthStore);

  type AuthFailure = {
    code: "AUTH_REQUIRED" | "AUTH_EXPIRED" | "AUTH_INVALID" | "AUTH_SCOPE" | "AUTH_SERVICE_UNAVAILABLE";
    message: string;
    retryable: boolean;
    requiredScopes?: string[];
    grantedScopes?: string[];
  };
  type AuthResolution = {
    apiKey?: string;
    auth: BoundAuth;
    scopes: string[];
    unrestricted: boolean;
    principal?: AuthenticatedSessionPrincipal;
    failure?: AuthFailure;
  };
  const OAUTH_AUTHORIZATION_METADATA_URL = "https://mcp.fahaliai.com/.well-known/oauth-authorization-server";

  /** Resolve a raw handshake value to an upstream API key and a typed auth state.
   *  Static keys must exist and be non-revoked; OAuth tokens are verified
   *  against the store and resolved to the user's encrypted upstream key. */
  async function resolveSessionAuth(
    raw: string | undefined,
    mcpClientIdentity = "unknown-client@unknown",
  ): Promise<AuthResolution> {
    if (!raw) {
      return {
        auth: { credentialType: "none", expiresAt: null, refreshSupported: true },
        scopes: [],
        unrestricted: false,
        failure: {
          code: "AUTH_REQUIRED",
          message: "Authentication required — connect with OAuth or a Fahali API key.",
          retryable: false,
        },
      };
    }
    try {
      if (!raw.startsWith("fahali_oat_")) {
        const valid = await oauthStore.isActiveApiKey(raw);
        const credentialType = raw === PROCESS_KEY ? "process_key" : "api_key";
        const principalId = credentialFingerprint(raw);
        return valid
          ? {
              apiKey: raw,
              auth: { credentialType, expiresAt: null, refreshSupported: false },
              scopes: ["*"],
              unrestricted: true,
              principal: {
                principalId: principalId!,
                clientId: mcpClientIdentity,
                credentialType,
              },
            }
          : {
              auth: { credentialType, expiresAt: null, refreshSupported: false },
              scopes: [],
              unrestricted: false,
              failure: {
                code: "AUTH_INVALID",
                message: "The Fahali API key is invalid or has been revoked.",
                retryable: false,
              },
            };
      }
      const token = await oauthStore.getAccessToken(raw);
      if (!token) {
        return {
          auth: { credentialType: "oauth", expiresAt: null, refreshSupported: true },
          scopes: [],
          unrestricted: false,
          failure: {
            code: "AUTH_INVALID",
            message: "The OAuth access token is invalid or has been revoked.",
            retryable: false,
          },
        };
      }
      const expiresAt = new Date(token.expires_at).toISOString();
      if (new Date(token.expires_at).getTime() <= Date.now()) {
        return {
          auth: { credentialType: "oauth", expiresAt, refreshSupported: true },
          scopes: token.scope,
          unrestricted: false,
          failure: {
            code: "AUTH_EXPIRED",
            message: "The OAuth access token expired. Refresh it before retrying this workflow.",
            retryable: true,
          },
        };
      }
      const userId = token.userId;
      let userKey = await oauthStore.getUserApiKey(userId);
      if (!userKey) {
        userKey = await oauthStore.autoProvisionApiKey(userId);
      }
      const apiKey = userKey?.trim() || PROCESS_KEY;
      if (!apiKey) {
        return {
          auth: { credentialType: "oauth", expiresAt, refreshSupported: true },
          scopes: token.scope,
          unrestricted: false,
          failure: {
            code: "AUTH_SERVICE_UNAVAILABLE",
            message: "OAuth is valid, but no upstream Fahali credential could be provisioned.",
            retryable: true,
          },
        };
      }
      return {
        apiKey,
        auth: { credentialType: "oauth", expiresAt, refreshSupported: true },
        scopes: token.scope,
        unrestricted: false,
        principal: {
          principalId: token.userId,
          clientId: token.clientId,
          credentialType: "oauth",
        },
      };
    } catch {
      return {
        auth: {
          credentialType: raw.startsWith("fahali_oat_") ? "oauth" : "api_key",
          expiresAt: null,
          refreshSupported: raw.startsWith("fahali_oat_"),
        },
        scopes: [],
        unrestricted: false,
        failure: {
          code: "AUTH_SERVICE_UNAVAILABLE",
          message: "Fahali could not verify the credential because the authentication service is unavailable.",
          retryable: true,
        },
      };
    }
  }

  function sendAuthFailure(
    res: ServerResponse,
    failure: AuthFailure,
    requestId: string,
    id: unknown = null,
    jsonRpc = true,
  ): void {
    const status = failure.code === "AUTH_SCOPE"
      ? 403
      : failure.code === "AUTH_SERVICE_UNAVAILABLE"
        ? 503
        : 401;
    const authError = failure.code === "AUTH_SCOPE"
      ? "insufficient_scope"
      : failure.code === "AUTH_EXPIRED" || failure.code === "AUTH_INVALID"
        ? "invalid_token"
        : undefined;
    const requiredScope = failure.requiredScopes?.length
      ? `, scope="${failure.requiredScopes.join(" ")}"`
      : "";
    res.writeHead(status, {
      "WWW-Authenticate": `Bearer realm="mcp.fahaliai.com", resource_metadata="https://mcp.fahaliai.com/.well-known/oauth-protected-resource"${authError ? `, error="${authError}"` : ""}${requiredScope}`,
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    });
    const error = {
      error: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      reauthUrl: OAUTH_AUTHORIZATION_METADATA_URL,
      refreshSupported: true,
      requestId,
      ...(failure.requiredScopes?.length ? { requiredScopes: failure.requiredScopes } : {}),
      ...(failure.grantedScopes ? { grantedScopes: failure.grantedScopes } : {}),
    };
    res.end(JSON.stringify(jsonRpc
      ? { jsonrpc: "2.0", error: { code: -32001, message: failure.message, data: error }, id }
      : error));
  }

  function sendSessionFailure(
    res: ServerResponse,
    status: 400 | 404,
    message: string,
    requestId: string,
    id: unknown = null,
  ): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
        data: {
          error: status === 404 ? "SESSION_EXPIRED" : "SESSION_REQUIRED",
          message,
          retryable: status === 404,
          requestId,
        },
      },
      id,
    }));
  }

  // In-memory per-IP rate limiter (shared across all connections).
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(ip: string, maxBurst: number, windowMs: number): boolean {
    const now = Date.now();
    let bucket = rateLimitBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      // Bound attacker-controlled cardinality even if a proxy forwards a
      // spoofed chain. Existing buckets expire during the five-minute sweep.
      if (rateLimitBuckets.size >= 10_000) return false;
      bucket = { count: 0, resetAt: now + windowMs };
      rateLimitBuckets.set(ip, bucket);
    }
    bucket.count++;
    return bucket.count <= maxBurst;
  }

  // Periodic cleanup of expired rate-limit buckets (every 5 min).
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateLimitBuckets) {
      if (bucket.resetAt < now) rateLimitBuckets.delete(ip);
    }
  }, 300000).unref();

  // Transport sessions are intentionally in-memory, but they must not be
  // immortal. Some connectors never send DELETE after disappearing; without a
  // reaper every one of those sessions consumes capacity until the next deploy.
  setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
    for (const [sessionId, session] of streamSessions) {
      if (session.lastSeen >= cutoff) continue;
      streamSessions.delete(sessionId);
      void session.transport.close().catch((error: unknown) => {
        console.error(`[fahali-mcp] inactive HTTP session close failed: ${safeLogMessage(error)}`);
      });
    }
    for (const [sessionId, session] of sessions) {
      if (session.lastSeen >= cutoff) continue;
      sessions.delete(sessionId);
      void session.transport.close().catch((error: unknown) => {
        console.error(`[fahali-mcp] inactive SSE session close failed: ${safeLogMessage(error)}`);
      });
    }
  }, 60_000).unref();

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const requestId = safeRequestId(req);
      res.setHeader("X-Request-ID", requestId);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      // Use the hop appended closest to this service rather than the first
      // user-controlled XFF value. Railway terminates the public connection.
      const forwarded = String(req.headers["x-forwarded-for"] || "")
        .split(",").map(value => value.trim()).filter(Boolean);
      const clientIp = forwarded[forwarded.length - 1] || req.socket.remoteAddress || "unknown";

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        const meta = {
          issuer: "https://mcp.fahaliai.com",
          authorization_endpoint: "https://mcp.fahaliai.com/authorize",
          token_endpoint: "https://mcp.fahaliai.com/token",
          registration_endpoint: "https://mcp.fahaliai.com/register",
          revocation_endpoint: "https://mcp.fahaliai.com/revoke",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: [...FAHALI_OAUTH_SCOPES],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(meta));
        return;
      }

      if (url.pathname === "/.well-known/openai-apps-challenge") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Slwhy6TIQ_n6aWSDAJ0o64K8nEif-LrAtKvr_DKQ4n8");
        return;
      }

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        const meta = {
          resource: "https://mcp.fahaliai.com",
          authorization_servers: ["https://mcp.fahaliai.com"],
          scopes_supported: [...FAHALI_OAUTH_SCOPES],
          bearer_methods_supported: ["Authorization: Bearer"],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(meta));
        return;
      }

      if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
        // Public discovery document for the receipt signing key. A verifier
        // fetches this to check a receipt offline, so it must never require auth.
        //
        // Keys are loaded PER REQUEST and deliberately not cached in a module
        // variable: caching would let a deploy that enables signing keep serving
        // a stale EMPTY set, i.e. it would publish "Fahali signs nothing" over a
        // server that had just started signing. A PEM parse on a non-hot
        // discovery endpoint is cheaper than that failure mode.
        //
        // With no key configured this returns 200 + an EMPTY `keys` array and a
        // stated reason. That is the honest answer — it is NOT a placeholder key
        // and NOT an error, because an empty set is exactly "no signed receipts
        // are being issued", and it is empty on purpose so it cannot be mistaken
        // for a verification result. `attestation.getJwks` never invents a key.
        const { keys, report } = loadReceiptKeys();
        const jwks = getJwks(keys);
        res.writeHead(200, {
          "Content-Type": "application/json",
          // Do not let a CDN or client pin an unconfigured empty set.
          "Cache-Control": report.configured ? "public, max-age=300" : "no-store",
        });
        res.end(JSON.stringify(jwks));
        return;
      }

      if (url.pathname === "/register" && req.method === "POST") {
        if (
          !checkRateLimit(`register:${clientIp}`, 20, 60000) ||
          !checkRateLimit("register:global", 300, 60000)
        ) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "too_many_requests" }));
          return;
        }
        try {
          const registration = validateClientRegistration(await readJsonBody(req));
          const client = await oauthStore.registerClient(registration);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify(client));
        } catch (error) {
          if (sendInputError(res, error)) return;
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
        }
        return;
      }

      if (url.pathname === "/authorize" && req.method === "GET") {
        if (!checkRateLimit(clientIp, 60, 60000)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "too_many_requests" }));
          return;
        }
        const clientId = url.searchParams.get("client_id") || "";
        const redirectUri = url.searchParams.get("redirect_uri") || "";
        const codeChallenge = url.searchParams.get("code_challenge") || "";
        const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
        const state = url.searchParams.get("state") || "";
        // A client that omits `scope` gets the full supported set, not the
        // floor. This used to fall back to the single market-read scope — 1 of
        // 8 — which handed every scope-omitting connector an audit tool instead
        // of the product. The default is defined once, in security.ts; do not
        // re-inline one here. (Deliberately not quoting the old literal: the
        // guard in security.test.ts greps source and cannot tell a comment from
        // code, and writing it out here is what failed that test first time.)
        const scope = url.searchParams.get("scope") || DEFAULT_AUTHORIZE_SCOPES;

        // Validate client + redirect BEFORE redirecting any error. Otherwise an
        // unregistered attacker URL becomes an OAuth-branded open redirect.
        let registeredClient;
        try {
          registeredClient = clientId.length <= 256 ? await oauthStore.getClient(clientId) : undefined;
        } catch {
          registeredClient = undefined;
        }
        if (!registeredClient || !registeredClient.redirect_uris.includes(redirectUri)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request", error_description: "redirect_uri not registered for this client" }));
          return;
        }

        const redirectError = (code: string, description: string) => {
          const errUrl = new URL(redirectUri);
          errUrl.searchParams.set("error", code);
          errUrl.searchParams.set("error_description", description);
          if (state && state.length <= 1024) errUrl.searchParams.set("state", state);
          res.writeHead(302, { Location: errUrl.toString() });
          res.end();
        };

        // Only S256 is accepted (RFC 7636 §4.2)
        if (codeChallengeMethod !== "S256") {
          redirectError("invalid_request", "Only S256 code_challenge_method is supported");
          return;
        }

        let requestedScopes: string[];
        try {
          validateCodeChallenge(codeChallenge);
          requestedScopes = validateScopes(scope);
          if (state.length > 1024) throw new HttpInputError(400, "invalid_request", "state is too long");
        } catch (error: any) {
          redirectError(error?.code || "invalid_request", error?.message || "Invalid authorization request");
          return;
        }

        // Redirect to app.fahaliai.com for login. After auth, the app POSTs to
        // /api/oauth/assertion and redirects back to /authorize/callback with an
        // HMAC-signed assertion containing the verified user_id.
        //
        // Keep OAuth params TOP-LEVEL for AuthScreen's window.location.search
        // capture, and use the current Auth route so navigation cannot fall
        // through to the default dashboard. /login is retained as a client-side
        // legacy alias for authorization requests already in flight.
        const loginParams = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          state,
          scope: requestedScopes.join(" "),
        });
        const appUrl = `https://app.fahaliai.com/auth?${loginParams.toString()}`;
        res.writeHead(302, { Location: appUrl });
        res.end();
        return;
      }

      // ── Authorize callback: app.fahaliai.com redirects here after auth ──
      // The app provides an HMAC-signed assertion containing the verified
      // user_id. The MCP verifies the HMAC, extracts user_id from the
      // assertion (NOT from URL params), mints the auth code, and
      // redirects to the client's redirect_uri.
      if (url.pathname === "/authorize/callback" && req.method === "GET") {
        if (!checkRateLimit(clientIp, 60, 60000)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "too_many_requests" }));
          return;
        }
        const assertionRaw = url.searchParams.get("assertion") || "";
        const assertionSig = url.searchParams.get("assertion_sig") || "";
        const clientId = url.searchParams.get("client_id") || "";
        const redirectUri = url.searchParams.get("redirect_uri") || "";
        const codeChallenge = url.searchParams.get("code_challenge") || "";
        const state = url.searchParams.get("state") || "";

        // Verify HMAC-signed assertion — user_id from assertion, NOT from URL
        let assertion;
        try {
          assertion = verifyAssertion(assertionRaw, assertionSig);
        } catch {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<!doctype html><html><body><h1>Authorization Failed</h1><p>Invalid or expired authorization assertion. Please try again.</p></body></html>");
          return;
        }

        // Cross-check assertion fields against URL params (defense-in-depth)
        if (
          assertion.client_id !== clientId ||
          assertion.code_challenge !== codeChallenge ||
          assertion.redirect_uri !== redirectUri
        ) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<!doctype html><html><body><h1>Authorization Failed</h1><p>Assertion parameters mismatch. Please try again.</p></body></html>");
          return;
        }

        // The API signs the authenticated identity, but the MCP remains the
        // authorization server and must independently re-check client metadata,
        // redirect registration, PKCE shape, and scopes at the final boundary.
        try {
          const registeredClient = await oauthStore.getClient(clientId);
          if (!registeredClient || !registeredClient.redirect_uris.includes(redirectUri)) {
            throw new HttpInputError(400, "invalid_request", "Client or redirect is no longer registered");
          }
          validateCodeChallenge(codeChallenge);
          assertion.scope = validateScopes(assertion.scope.join(" "));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<!doctype html><html><body><h1>Authorization Failed</h1><p>The authorization request is no longer valid. Please reconnect from your AI client.</p></body></html>");
          return;
        }

        // Use assertion's user_id — this is the authenticated user verified
        // by app.fahaliai.com via Firebase/Google auth and bound by HMAC.
        const userId = assertion.user_id;

        // Ensure one live upstream key for this user. autoProvisionApiKey heals
        // a pre-email-bridge owner mismatch and revokes the obsolete key before
        // replacement; ordinary reconnects reuse the existing credential.
        try {
          await oauthStore.autoProvisionApiKey(userId, (assertion as any).email);
        } catch (e) {
          console.error(`[oauth] provision error (request ${requestId}): ${safeLogMessage(e)}`);
          // An identity we could not resolve must NOT be waved through. This
          // catch used to swallow everything and issue an authorization code
          // regardless, so a failed owner lookup produced a connected-looking
          // connector holding a developer_free key - the customer then read
          // "upgrade your plan" on a plan they already pay for.
          if (e instanceof UnresolvedIdentityError) {
            res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              "<!doctype html><html><body><h1>Authorization Failed</h1>" +
                "<p>We could not match this login to a Fahali account just now, " +
                "so we have not issued a key rather than issue the wrong one. " +
                "Please try reconnecting in a moment. If it keeps happening, " +
                "sign in at app.fahaliai.com with the address on your Fahali " +
                "account and reconnect from there.</p></body></html>",
            );
            return;
          }
        }

        // Mint the authorization code
        const code = `fahali_ac_${randomUUID().replace(/-/g, "")}`;
        await oauthStore.saveAuthorizationCode(
          code,
          clientId,
          codeChallenge,
          redirectUri,
          userId,
          assertion.scope,
        );

        // Redirect to client's redirect_uri with the code (the client then
        // POSTs /token to exchange it for access+refresh tokens).
        const redirect = new URL(redirectUri);
        redirect.searchParams.set("code", code);
        if (state) redirect.searchParams.set("state", state);
        res.writeHead(302, { Location: redirect.toString() });
        res.end();
        return;
      }

      if (url.pathname === "/token" && req.method === "POST") {
        if (!checkRateLimit(clientIp, 60, 60000)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "too_many_requests" }));
          return;
        }
        try {
          const body = await readFormOrJsonBody(req);
          const grantType = body?.grant_type;
          const clientId = body?.client_id || "";
          const client = await oauthStore.getClient(clientId);

          if (!client) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_client" }));
            return;
          }

          // We advertise token_endpoint_auth_methods_supported: ["none"] — MCP
          // clients (Claude, ChatGPT) register as PUBLIC and authenticate the
          // code exchange via PKCE (code_verifier, enforced below), NOT a secret.
          // Only verify a client_secret when one is actually presented (a
          // confidential client); requiring it for public clients 401s every
          // MCP connection. PKCE binds the code to the client regardless.
          if (client.client_secret) {
            const presented = extractBasicAuthSecret(req) || body?.client_secret || "";
            const ok = presented && await oauthStore.verifyClientSecret(clientId, presented);
            if (!ok) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "invalid_client" }));
              return;
            }
          }

          if (grantType === "authorization_code") {
            const tokens = await oauthProvider.exchangeAuthorizationCode(
              client,
              body.code,
              body.code_verifier,
              body.redirect_uri,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(tokens));
          } else if (grantType === "refresh_token") {
            const refreshScopes = body.scope === undefined
              ? undefined
              : validateScopes(body.scope);
            const tokens = await oauthProvider.exchangeRefreshToken(
              client,
              body.refresh_token,
              refreshScopes,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(tokens));
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "unsupported_grant_type" }));
          }
        } catch (e: any) {
          if (sendInputError(res, e)) return;
          // Return OAuth-standard classes without exposing database or token
          // details. Only our two deliberate provider prefixes are public.
          const rawMessage = typeof e?.message === "string" ? e.message : "";
          const separator = rawMessage.indexOf(":");
          const errorCode = separator > 0 ? rawMessage.slice(0, separator) : "invalid_request";
          const oauthCode = errorCode === "invalid_grant" || errorCode === "invalid_scope"
            ? errorCode
            : "invalid_request";
          const description = oauthCode === "invalid_request"
            ? "The token request could not be completed."
            : rawMessage.slice(separator + 1).trim();
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: oauthCode, error_description: description, requestId }));
        }
        return;
      }

      if (url.pathname === "/revoke" && req.method === "POST") {
        if (!checkRateLimit(`revoke:${clientIp}`, 60, 60000)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "too_many_requests" }));
          return;
        }
        try {
          const body = await readFormOrJsonBody(req);
          const clientId = body?.client_id || "";
          const client = await oauthStore.getClient(clientId);
          if (client) {
            await oauthProvider.revokeToken(client, { token: body.token, token_type_hint: body.token_type_hint });
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
        } catch (error) {
          if (sendInputError(res, error)) return;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
        }
        return;
      }

      // ── Streamable HTTP transport (MCP 2025+ spec, the cross-client baseline) ──
      // One endpoint handles the whole lifecycle:
      //   POST   /mcp  — client→server JSON-RPC (initialize, tools/list, tools/call)
      //   GET    /mcp  — server→client notification stream for an existing session
      //   DELETE /mcp  — explicit session teardown
      // Auth: supports both static API keys (sk_live_) and OAuth 2.1 access tokens.
      // The key/token is read from Authorization on every request. The upstream
      // API key remains private in the Server closure; the transport session is
      // bound to stable principal + client identity so a refreshed OAuth access
      // token can rotate without breaking the live MCP session.
      if (url.pathname === "/mcp") {
        try {
        const sid = req.headers["mcp-session-id"] as string | undefined;

        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const existing = sid ? streamSessions.get(sid) : undefined;
          if (existing) {
            const repeatedCredential = extractAuthorizationCredential(req) || PROCESS_KEY;
            if (existing.principal || repeatedCredential) {
              const repeatedAuth = await resolveSessionAuth(
                repeatedCredential,
                existing.principal?.clientId,
              );
              if (!repeatedAuth.apiKey || !repeatedAuth.principal) {
                sendAuthFailure(
                  res,
                  repeatedAuth.failure ?? {
                    code: "AUTH_INVALID",
                    message: "The supplied credential could not be verified.",
                    retryable: false,
                  },
                  requestId,
                  (body as any)?.id ?? null,
                );
                return;
              }
              if (!existing.principal || !sameAuthenticatedPrincipal(existing.principal, repeatedAuth.principal)) {
                sendAuthFailure(
                  res,
                  {
                    code: "AUTH_INVALID",
                    message: "This credential belongs to a different authenticated client. Start a new session.",
                    retryable: false,
                  },
                  requestId,
                  (body as any)?.id ?? null,
                );
                return;
              }

              const candidateAuthorization: SessionAuthorizationState = {
                scopes: [...repeatedAuth.scopes],
                unrestricted: repeatedAuth.unrestricted,
                requestId,
              };
              const missing = Array.from(new Set(
                toolCallsIn(body).flatMap((call) =>
                  missingOAuthScopes(call.name, call.args, candidateAuthorization),
                ),
              ));
              if (missing.length) {
                sendAuthFailure(
                  res,
                  {
                    code: "AUTH_SCOPE",
                    message: `This request requires additional OAuth permission: ${missing.join(", ")}.`,
                    retryable: false,
                    requiredScopes: missing,
                    grantedScopes: repeatedAuth.scopes,
                  },
                  requestId,
                  (body as any)?.id ?? null,
                );
                return;
              }

              // Same principal + same OAuth client: accept token rotation and
              // atomically refresh the session's expiry and granted scopes.
              Object.assign(existing.auth, repeatedAuth.auth);
              existing.authorization.scopes = [...repeatedAuth.scopes];
              existing.authorization.unrestricted = repeatedAuth.unrestricted;
            }
            existing.authorization.requestId = requestId;
            existing.lastSeen = Date.now();
            await existing.transport.handleRequest(req, res, body);
            return;
          }
          // 404 vs 400 is load-bearing, not cosmetic: 404 is the ONLY signal
          // the spec gives a client to re-initialize on its own, and sessions
          // here live in an in-memory Map that every deploy empties. See
          // sessionStatus.ts for the spec text and the loop hazard.
          const sessionError = sessionErrorStatus({
            hasSessionId: Boolean(sid),
            known: false, // `existing` was already checked above
            isInitialize: isInitializeRequest(body),
          });
          if (sessionError) {
            sendSessionFailure(
              res,
              sessionError.status,
              sessionError.message,
              requestId,
              (body as any)?.id ?? null,
            );
            return;
          }
          if (
            !checkRateLimit(`mcp-init:${clientIp}`, 30, 60_000) ||
            !checkRateLimit("mcp-init:global", 600, 60_000)
          ) {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32002,
                message: "Too many session initializations",
                data: { error: "RATE_LIMITED", retryable: true, requestId },
              },
              id: (body as any)?.id ?? null,
            }));
            return;
          }
          if (sessions.size + streamSessions.size >= MAX_ACTIVE_TRANSPORT_SESSIONS) {
            res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "30" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32003,
                message: "Session capacity temporarily reached",
                data: { error: "SESSION_CAPACITY", retryable: true, requestId },
              },
              id: (body as any)?.id ?? null,
            }));
            return;
          }
          // Streamable HTTP never accepts API keys in URLs. Authorization
          // headers avoid proxy logs, browser history, and Referer leakage.
          const rawSessionCredential = extractAuthorizationCredential(req) || PROCESS_KEY;
          const authResolution = await resolveSessionAuth(
            rawSessionCredential,
            initializeClientIdentity(body),
          );
          const sessionKey = authResolution.apiKey;
          // OAuth 2.1 challenge (parity with the /sse path): if the initialize
          // request carries no valid key/token, return 401 + WWW-Authenticate so
          // the MCP client discovers and runs the OAuth flow. Without this,
          // Streamable-HTTP clients (Claude) silently create a keyless session
          // and never prompt to connect — tool calls then fail with "no API key".
          if (
            !sessionKey &&
            authResolution.failure?.code === "AUTH_REQUIRED" &&
            ALLOW_KEYLESS_INTROSPECTION
          ) {
            // Introspection-only mode for directory/registry checks: the tool
            // catalogue can be listed without a key. Tool CALLS still fail without
            // one, so no data is exposed. Default OFF so the hosted endpoint keeps
            // returning the OAuth challenge that makes Claude prompt to connect.
            console.info("[fahali-mcp] keyless introspection session (MCP_ALLOW_KEYLESS_INTROSPECTION=true)");
          } else if (!sessionKey) {
            sendAuthFailure(
              res,
              authResolution.failure ?? {
                code: "AUTH_INVALID",
                message: "The supplied credential could not be verified.",
                retryable: false,
              },
              requestId,
              (body as any)?.id ?? null,
            );
            return;
          }
          const sessionAuth = authResolution.auth;
          const sessionAuthorization: SessionAuthorizationState = {
            scopes: [...authResolution.scopes],
            unrestricted: authResolution.unrestricted,
            requestId,
          };
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (newId) => {
              streamSessions.set(newId, {
                transport,
                lastSeen: Date.now(),
                principal: authResolution.principal,
                auth: sessionAuth,
                authorization: sessionAuthorization,
              });
              console.info(
                `[fahali-mcp] HTTP session initialized (auth: ${
                  sessionKey ? "key bound" : "NO KEY — calls will fail"
                }, active: ${streamSessions.size})`,
              );
            },
            onsessionclosed: (closedId) => {
              streamSessions.delete(closedId);
              console.info(`[fahali-mcp] HTTP session closed (active: ${streamSessions.size})`);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) streamSessions.delete(transport.sessionId);
          };
          await buildServer(sessionKey, sessionAuth, sessionAuthorization).connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }

        if (req.method === "GET" || req.method === "DELETE") {
          const session = sid ? streamSessions.get(sid) : undefined;
          if (!session) {
            // GET is usually where a client discovers its session went stale —
            // it holds the notification stream open across a deploy — so the
            // 404 matters at least as much here as on POST. DELETE gets it too:
            // the spec's MUST covers any request carrying the session id.
            const sessionError =
              sessionErrorStatus({ hasSessionId: Boolean(sid), known: false, isInitialize: false }) ??
              { status: 400 as const, message: NO_SESSION_MESSAGE };
            sendSessionFailure(res, sessionError.status, sessionError.message, requestId);
            return;
          }
          const repeatedCredential = extractAuthorizationCredential(req) || PROCESS_KEY;
          if (session.principal || repeatedCredential) {
            const repeatedAuth = await resolveSessionAuth(
              repeatedCredential,
              session.principal?.clientId,
            );
            if (!repeatedAuth.apiKey || !repeatedAuth.principal) {
              sendAuthFailure(
                res,
                repeatedAuth.failure ?? {
                  code: "AUTH_INVALID",
                  message: "The supplied credential could not be verified.",
                  retryable: false,
                },
                requestId,
              );
              return;
            }
            if (!session.principal || !sameAuthenticatedPrincipal(session.principal, repeatedAuth.principal)) {
              sendAuthFailure(
                res,
                {
                  code: "AUTH_INVALID",
                  message: "This credential belongs to a different authenticated client. Start a new session.",
                  retryable: false,
                },
                requestId,
              );
              return;
            }
            Object.assign(session.auth, repeatedAuth.auth);
            session.authorization.scopes = [...repeatedAuth.scopes];
            session.authorization.unrestricted = repeatedAuth.unrestricted;
          }
          session.authorization.requestId = requestId;
          session.lastSeen = Date.now();
          await session.transport.handleRequest(req, res);
          return;
        }

        res.writeHead(405);
        res.end("Method not allowed");
        return;
        } catch (e: unknown) {
          if (!res.headersSent && sendInputError(res, e)) return;
          // An exception escaping here previously became a BARE 500 with
          // nothing logged — the July 3 "500 on every call" incident took
          // hours to diagnose for want of this one log line.
          console.error(
            `[fahali-mcp] /mcp handler error (${req.method}, request ${requestId}): ${safeLogMessage(e)}`,
          );
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: "Internal server error.",
                data: { error: "INTERNAL_ERROR", retryable: true, requestId },
              },
              id: null,
            }));
          } else {
            try { res.end(); } catch { /* stream already gone */ }
          }
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/sse") {
        if (
          !checkRateLimit(`sse-init:${clientIp}`, 30, 60_000) ||
          !checkRateLimit("sse-init:global", 600, 60_000)
        ) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "too_many_requests" }));
          return;
        }
        if (sessions.size + streamSessions.size >= MAX_ACTIVE_TRANSPORT_SESSIONS) {
          res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "30" });
          res.end(JSON.stringify({ error: "session_capacity_reached" }));
          return;
        }
        // Per-connection API key from Authorization header or ?api_key=
        // query param. Falls back to FAHALI_API_KEY env var if neither is
        // set (single-tenant deployment pattern).
        const authResolution = await resolveSessionAuth(
          extractKeyFromHandshake(req) || PROCESS_KEY,
          "legacy-sse",
        );
        const sessionKey = authResolution.apiKey;

        // OAuth 2.1 discovery for compliant MCP clients. The 401
      // advertises the protected-resource metadata endpoint so clients
        // can discover the full OAuth flow (authorize, token, register).
        if (!sessionKey) {
          sendAuthFailure(
            res,
            authResolution.failure ?? {
              code: "AUTH_INVALID",
              message: "The supplied credential could not be verified.",
              retryable: false,
            },
            requestId,
            null,
            false,
          );
          return;
        }

        const transport = new SSEServerTransport("/messages", res);
        const sessionAuthorization: SessionAuthorizationState = {
          scopes: [...authResolution.scopes],
          unrestricted: authResolution.unrestricted,
          requestId,
        };
        sessions.set(transport.sessionId, {
          transport,
          lastSeen: Date.now(),
          principal: authResolution.principal!,
          auth: authResolution.auth,
          authorization: sessionAuthorization,
        });
        res.on("close", () => {
          sessions.delete(transport.sessionId);
          console.info(`[fahali-mcp] SSE client disconnected (active: ${sessions.size})`);
        });
        await buildServer(sessionKey, authResolution.auth, sessionAuthorization).connect(transport);
        console.info(
          `[fahali-mcp] SSE client connected (auth: ${
            sessionKey ? "key bound" : "NO KEY — calls will fail"
          }, active: ${sessions.size})`,
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId");
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (session) {
          const body = await readJsonBody(req);
          const repeatedCredential = extractAuthorizationCredential(req) || PROCESS_KEY;
          if (repeatedCredential) {
            const repeatedAuth = await resolveSessionAuth(repeatedCredential, session.principal.clientId);
            if (!repeatedAuth.apiKey || !repeatedAuth.principal) {
              sendAuthFailure(
                res,
                repeatedAuth.failure ?? {
                  code: "AUTH_INVALID",
                  message: "The supplied credential could not be verified.",
                  retryable: false,
                },
                requestId,
                (body as any)?.id ?? null,
              );
              return;
            }
            if (!sameAuthenticatedPrincipal(session.principal, repeatedAuth.principal)) {
              sendAuthFailure(
                res,
                {
                  code: "AUTH_INVALID",
                  message: "This credential belongs to a different authenticated client. Start a new session.",
                  retryable: false,
                },
                requestId,
                (body as any)?.id ?? null,
              );
              return;
            }
            Object.assign(session.auth, repeatedAuth.auth);
            session.authorization.scopes = [...repeatedAuth.scopes];
            session.authorization.unrestricted = repeatedAuth.unrestricted;
          } else if (session.auth.expiresAt && new Date(session.auth.expiresAt).getTime() <= Date.now()) {
            sendAuthFailure(
              res,
              {
                code: "AUTH_EXPIRED",
                message: "The OAuth access token expired. Refresh it before retrying this workflow.",
                retryable: true,
              },
              requestId,
              (body as any)?.id ?? null,
            );
            return;
          }

          const missing = Array.from(new Set(
            toolCallsIn(body).flatMap((call) =>
              missingOAuthScopes(call.name, call.args, session.authorization),
            ),
          ));
          if (missing.length) {
            sendAuthFailure(
              res,
              {
                code: "AUTH_SCOPE",
                message: `This request requires additional OAuth permission: ${missing.join(", ")}.`,
                retryable: false,
                requiredScopes: missing,
                grantedScopes: session.authorization.scopes,
              },
              requestId,
              (body as any)?.id ?? null,
            );
            return;
          }
          session.lastSeen = Date.now();
          session.authorization.requestId = requestId;
          await session.transport.handlePostMessage(req, res, body);
          return;
        }
        const error = sessionErrorStatus({
          hasSessionId: Boolean(sessionId),
          known: false,
          isInitialize: false,
        }) ?? { status: 400 as const, message: NO_SESSION_MESSAGE };
        sendSessionFailure(res, error.status, error.message, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            service: "fahali-mcp",
            version: SERVER_INFO.version,
            // 🔴 READ `release.revision`, NOT `version`. `version` is hand-bumped
            // at release and named the SAME 1.25.0 on both sides of a 94-hour-stale
            // build (2026-09-07 -> 09-11); nothing detected it. The revision is
            // stamped by scripts/stamp-revision.mjs at deploy time and is what
            // scripts/preflight-deploy.mjs runs its ancestor gate against. Shape
            // deliberately matches the api-server's, so ONE guard reads both.
            release: BUILD_REVISION,
            uptime: process.uptime(),
            // Multi-tenant: callers bring their own key on the handshake.
            // True only when a process-wide fallback key is configured.
            authConfigured: Boolean(PROCESS_KEY),
            authMode: PROCESS_KEY ? "process-key-fallback" : "per-session-key",
            activeSessions: sessions.size + streamSessions.size,
          }),
        );
        return;
      }

      // TOOL_DEFINITIONS and llms.txt must describe the same public contract.
      // The legacy whale name is intentionally omitted from discovery; the
      // canonical tool reports participant-agnostic unusual money movement.
      // 🔴 /llms.txt is served from the FILE (mcp-server/llms.txt), not from a
      // string here. The embedded copy drifted from the corrected file on
      // 2026-07-31 and the stale text stayed live (discovered 2026-08-09: it
      // advertised fahali_get_smart_money_dashboard and hid fahali_get_lead_time).
      // Single source of truth: edit llms.txt, never this block.
      if (req.method === "GET" && url.pathname === "/llms.txt") {
        try {
          const content = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(content);
        } catch (err: any) {
          console.error("[llms.txt] read failed:", err?.message || String(err));
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "llms.txt unavailable" }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fahali MCP — AI Market Risk Intelligence</title>
<meta name="description" content="Connect ChatGPT, Claude, Cursor, and other AI agents to auditable market-risk intelligence, portfolio risk analysis, and timestamped evidence through MCP." />
<meta property="og:title" content="Fahali MCP — AI Market Risk Intelligence" />
<meta property="og:description" content="AI agents can inspect Fahali's market-risk verdicts, portfolio concentration, contagion context, and timestamped evidence through MCP." />
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
    "description": "Free developer key includes the canonical Fahali market-decision path with reduced depth and 50 calls/day."
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
      <div class="status">Live · callable now</div>
    </div>
  </div>
  <h1>Give your agent market-risk intelligence.</h1>
  <p class="lead">Your agent already fetches prices. Fahali adds a timestamped risk read — verdict, evidence, uncertainty, and portfolio context — through ChatGPT, Claude, Cursor, Windsurf, and any MCP client.</p>

  <div class="card">
    <h2>Ask once. Get the answer, not the data.</h2>
    <ul>
      <li>"What market risks are changing right now?"</li>
      <li>"Analyze BTCUSDT, NVDA, and SPY for shared downside risk."</li>
      <li>"Which active alerts need a risk review, and what evidence supports them?"</li>
      <li>"What does Fahali detect before a market move becomes obvious?"</li>
    </ul>
  </div>

  <div class="card">
    <h2>Connect</h2>
    <p>Streamable HTTP (recommended): <code>https://mcp.fahaliai.com/mcp</code></p>
    <p>SSE (legacy): <code>https://mcp.fahaliai.com/sse</code></p>
    <p>Auth: bring your Fahali API key as <code>Authorization: Bearer &lt;key&gt;</code>. Never put credentials in a URL. Create one at <a href="https://fahaliai.com/developer" style="color:#A5B4FC;">fahaliai.com/developer</a>.</p>
  </div>

  <div class="card">
    <h2>Tools (${TOOL_DEFINITIONS.length})</h2>
    <p style="color:#9CA3AF; margin:0 0 12px;">Start with <code>fahali_get_market_decision</code> for the market or <code>fahali_get_symbol_decision</code> for one instrument. Use audit tools only when you need to inspect the evidence underneath. The full list below is generated from the server's active catalogue.</p>
    <ul>
      ${TOOL_DEFINITIONS.map((tool) => {
        const firstSentence = tool.description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || tool.description;
        return `<li><code>${tool.name}</code> — ${firstSentence}</li>`;
      }).join("\n      ")}
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
    <p style="margin-top:8px;">© 2026 Future Legends Inc. Fahali is market intelligence, not financial advice.</p>
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
  console.info(`[fahali-mcp] SSE server listening on port ${port}`);
  if (!PROCESS_KEY) {
    console.info(
      "[fahali-mcp] No FAHALI_API_KEY env var set; per-connection auth via Authorization header is required.",
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
