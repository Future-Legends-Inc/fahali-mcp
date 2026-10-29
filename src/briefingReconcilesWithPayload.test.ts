/**
 * The briefing must not assert an absence the payload contradicts.
 *
 * ── The defect, measured on the FIRST call of 2026-09-04 ────────────────────
 * `fahali_get_capabilities` returned a complete 52-tool catalogue — tiers,
 * scopes, endpoints, executability, workflows, blocked-reason detail — and the
 * briefing above it read:
 *
 *   ## The Core Thesis
 *   **52 measured readings returned.** The evidence below is what Fahali
 *   actually observed; anything not listed was not measured.
 *
 *   ## Evidence (measured — no judged record matched)
 *   * **fahali_get_market_verdict:** returned with no reportable measurement
 *   * **fahali_get_forecast:** returned with no reportable measurement
 *   … 50 more identical lines …
 *
 *   ## The Blind Spot (What we DO NOT know)
 *   * No withheld field, abstention or stale marker was returned with this
 *     response. That means nothing was flagged as missing…
 *
 * Three false statements over one healthy payload:
 *
 *   1. The 52 rows are a CATALOGUE, not readings. `thesisFor` counted
 *      `rows.length` from whatever the adapter declared as a collection and
 *      called the total "measured readings". A declared collection is not
 *      automatically a set of observations.
 *   2. "anything not listed was not measured", appended to a list where nothing
 *      was listed, promotes a RENDERING gap into a claim about the market. That
 *      is absence-renders-as-safety, emitted by the loudest layer — agents
 *      repeat the summary.
 *   3. "nothing was flagged as missing" sat beside
 *      `callerEntitlement.scopeBlockedTools` with THIRTEEN refused tools.
 *
 * The thesis now counts what the evidence renderer could actually report — the
 * renderer's own output, so there is one derivation and nothing to drift — and
 * when that is zero it says so as a limit of the summary, without converting it
 * into a finding.
 *
 *   node --import tsx --test mcp-server/src/briefingReconcilesWithPayload.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

const briefingFor = (tool: string, payload: Record<string, unknown>): string => {
  const out = decorateForAgent(tool, {
    structuredContent: payload,
    content: [{ type: "text", text: "{}" }],
  } as any) as any;
  return String(out.structuredContent.agentBriefing ?? "");
};

/** A catalogue row: real, useful, and not a measurement of anything. */
const toolRow = (name: string) => ({
  name,
  requiredTier: "professional",
  executable: true,
  endpoint: "/agent/verdict",
  surfaceRole: "audit",
});

const CATALOGUE = {
  serverVersion: "1.25.0",
  tools: [
    toolRow("fahali_get_market_verdict"),
    toolRow("fahali_get_forecast"),
    toolRow("fahali_resolve_instrument"),
  ],
  resources: [],
};

test("a CATALOGUE is not announced as a set of measurements", () => {
  const md = briefingFor("fahali_get_capabilities", CATALOGUE);

  assert.doesNotMatch(md, /measured readings returned/, "tool definitions are not readings");
  assert.match(md, /could not extract a measurement from any of them/i);
  assert.match(md, /limit of this summary/i, "and it must be framed as the summary's limit");
});

test("the dangerous sentence is gone from a payload it cannot be true of", () => {
  // "anything not listed was not measured" is the half that does real harm: it
  // turns "the renderer had no field to print" into "Fahali observed nothing".
  const md = briefingFor("fahali_get_capabilities", CATALOGUE);
  assert.doesNotMatch(md, /anything not listed was not measured/);
  assert.match(md, /do not read it as "nothing was measured"/i);
});

test("NEGATIVE CONTROL — a real measurement set still reads as one", () => {
  // If this regresses to the catalogue wording, the fix has stopped
  // discriminating and simply weakened every thesis.
  const md = briefingFor("fahali_get_realtime_alerts", {
    alerts: [
      { symbol: "BTCUSDT", severity: "high", confidence: 0.81 },
      { symbol: "ETHUSDT", severity: "medium", confidence: 0.64 },
    ],
  });

  assert.match(md, /measured readings returned/, "genuine readings keep the strong wording");
  assert.match(md, /anything not listed was not measured/, "and keep the claim that is true of them");
  assert.doesNotMatch(md, /could not extract a measurement/i);
});

test("refused tools appear in the Blind Spot instead of 'nothing was flagged as missing'", () => {
  const md = briefingFor("fahali_get_capabilities", {
    ...CATALOGUE,
    callerEntitlement: {
      scopeBlockedTools: [
        { tool: "fahali_save_memory", missingScopes: ["write:memory"] },
        { tool: "fahali_create_alert", missingScopes: ["write:alerts"] },
        {
          tool: "fahali_get_watch_delta",
          missingScopes: ["write:portfolio"],
          alsoCallableAs: { arguments: { refresh: false }, callableNow: true },
        },
      ],
      blockedEndpoints: [],
    },
  });

  assert.match(md, /3 tools are REFUSED to this session/);
  assert.match(md, /unreachable, not quiet/i, "an unreachable capability must never read as a quiet one");
  // A refusal that does not name the next rung reads as a dead end — two of
  // these were callable all along by passing refresh:false (2026-08-31).
  assert.match(md, /1 of them become? callable right now/i);
  assert.doesNotMatch(md, /nothing was flagged as missing/);
});

test("NEGATIVE CONTROL — a fully-scoped session is not told about refusals", () => {
  const md = briefingFor("fahali_get_capabilities", {
    ...CATALOGUE,
    callerEntitlement: { scopeBlockedTools: [], blockedEndpoints: [] },
  });
  assert.doesNotMatch(md, /REFUSED to this session/);
});

test("the two gates are named separately, because they are separate", () => {
  // blockedEndpoints is the API-key gate; scopeBlockedTools is the OAuth gate,
  // enforced in-process. blockedEndpoints was EMPTY on 2026-08-29 while twelve
  // tools were being refused, so collapsing them hides one of the two.
  const md = briefingFor("fahali_get_capabilities", {
    ...CATALOGUE,
    callerEntitlement: {
      scopeBlockedTools: [],
      blockedEndpoints: [{ endpoint: "/agent/watches" }],
    },
  });
  assert.match(md, /1 endpoint is refused/i);
  assert.match(md, /SEPARATE gate/i);
});
