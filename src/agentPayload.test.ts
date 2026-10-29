/**
 * THE ROUTING CONTRACT.
 *
 * Chain-of-tool routing means an agent fires the recommended call autonomously,
 * with nobody reviewing the signature first. A plausible-looking wrong call is
 * therefore worse here than anywhere else in the codebase — it fails in a loop,
 * on a customer's agent, silently.
 *
 * This is not hypothetical. The brief that commissioned this feature proposed
 * `fahali_get_contagion_map(symbols=["NVDA","AMD","TSM"])`. That tool takes NO
 * arguments. Transcribing the example would have shipped a permanently broken
 * link in the chain.
 *
 * So: every routed tool must exist, and every argument key must exist on THAT
 * tool's real inputSchema. Same defect class as the CLAUDE.md route table that
 * was 6/8 fabricated and sent an agent to build against a 404.
 *
 *   node --import tsx --test mcp-server/src/agentPayload.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import Ajv from "ajv";

import { TOOL_DEFINITIONS } from "./tools.js";
import { addFahaliSchemaFormats } from "./ajvFormats.js";
import {
  AGENT_ENDPOINT_ADAPTERS,
  AGENT_ROUTES,
  BUNDLE_VIEW_TOOLS,
  buildAgentBriefing,
  CLAIM_POLICY,
  classifyAgentPayload,
  decorateForAgent,
  prioritiseDecisionRows,
} from "./agentPayload.js";
import { responseOptions } from "./responseOptions.js";
import { assertNotBinding, assertDirectionAbsent } from "./assertNotBinding.js";

const BY_NAME = new Map<string, any>((TOOL_DEFINITIONS as any[]).map((t) => [t.name, t]));

test("every routed tool exists and is advertised in tools/list", () => {
  const bad: string[] = [];
  for (const [from, recs] of Object.entries(AGENT_ROUTES)) {
    for (const r of recs) {
      if (!BY_NAME.has(r.tool)) bad.push(`${from} → ${r.tool} (not in TOOL_DEFINITIONS)`);
    }
  }
  assert.deepEqual(bad, [], `routed calls name tools that do not exist:\n  ${bad.join("\n  ")}`);
});

test("every routed argument key exists on the target tool's inputSchema", () => {
  const bad: string[] = [];
  for (const [from, recs] of Object.entries(AGENT_ROUTES)) {
    for (const r of recs) {
      const target = BY_NAME.get(r.tool);
      if (!target) continue;
      const props = Object.keys(target.inputSchema?.properties ?? {});
      for (const k of Object.keys(r.args ?? {})) {
        if (!props.includes(k)) {
          bad.push(`${from} → ${r.tool}(${k}=…) — ${r.tool} accepts [${props.join(", ") || "no arguments"}]`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `routed calls pass arguments the target tool does not accept:\n  ${bad.join("\n  ")}`);
});

test("a tool with required arguments is never routed to without them", () => {
  const bad: string[] = [];
  for (const [from, recs] of Object.entries(AGENT_ROUTES)) {
    for (const r of recs) {
      const target = BY_NAME.get(r.tool);
      const required: string[] = target?.inputSchema?.required ?? [];
      for (const req of required) {
        if (!(req in (r.args ?? {}))) bad.push(`${from} → ${r.tool} omits required "${req}"`);
      }
    }
  }
  assert.deepEqual(bad, [], `routed calls would fail on a missing required argument:\n  ${bad.join("\n  ")}`);
});

test("every advertised tool routes somewhere — no dead ends in the chain", () => {
  const missing = (TOOL_DEFINITIONS as any[]).map((t) => t.name).filter((n) => !(AGENT_ROUTES as any)[n]?.length);
  assert.deepEqual(missing, [], `these tools return no next-step routing, so the chain stops there:\n  ${missing.join("\n  ")}`);
});

test("tool descriptions remain compact enough for MCP registries", () => {
  const oversized = (TOOL_DEFINITIONS as any[])
    .map((tool) => ({ name: tool.name, words: String(tool.description).trim().split(/\s+/).length }))
    .filter((tool) => tool.words > 65);
  assert.deepEqual(oversized, [], `descriptions over 65 words risk truncating their contract:\n${JSON.stringify(oversized)}`);
});

// ── The honesty gates. Each of these shipped as a real defect once. ──────────

test("expectedMovePct is suppressed when the verdict ABSTAINS", () => {
  // Live 2026-08-14: NVO and META shipped +10 next to direction 'neutral'. In a
  // table that is a stray cell; in prose it reads as the call itself.
  const abstaining = {
    count: 1,
    data: [{
      symbol: "NVDA",
      verdict: { direction: "neutral", confidence: 0.2, uncertainty: 0.5, expectedMovePct: 10, actionability: "ABSTAIN", abstainReason: "below the confidence floor" },
    }],
  };
  const { markdown } = buildAgentBriefing("fahali_get_market_verdict", abstaining);
  assert.doesNotMatch(markdown, /expected move/i, "a signed move rendered beside a withheld direction");
  assert.match(markdown, /ABSTAIN/, "the abstention itself must be stated");
  assert.match(markdown, /not as a neutral or calm call/i, "an abstention must not be paraphrasable into an all-clear");

  const acting = JSON.parse(JSON.stringify(abstaining));
  acting.data[0].verdict.actionability = "ACTIONABLE";
  acting.data[0].verdict.direction = "bearish";
  assert.match(buildAgentBriefing("fahali_get_market_verdict", acting).markdown, /expected move \+10%/);
});

/**
 * 🔓 CONTRACT CHANGED 2026-08-23 — expose the measurement, bind it to its verdict.
 *
 * This assertion used to be `doesNotMatch(/72\.07/)`: a figure that failed the
 * gate never reached the agent at all. That concealed our own bad marks.
 * `funding_proxy` runs **6.31pp BELOW** its base rate over 4,767 resolved
 * outcomes, and `flash_crash_precursor` forecasts ~84% where the observed rate
 * is ~5% — an agent deciding which engine to weight was denied the two numbers
 * that would have told it so. Hiding a deficit is `absence renders as safety`
 * aimed at ourselves, and it is the flattering direction of it.
 *
 * The gate was never a concealment rule. It governs what may be RESTATED to a
 * human as Fahali's accuracy. So the new contract is LOOSER about visibility and
 * STRICTER about binding: the figure is shown, and it may never appear without
 * its non-publishable verdict **in the same bullet**. Same-document is not good
 * enough — a disclaimer three lines away is exactly what gets dropped when an
 * agent summarises.
 */
test("an unpublishable figure is shown, and never without its refusal on the same line", () => {
  const d = { trackRecord: [{ engine: "committee_verdict", horizon_tier: "24h", bar_regime: "crypto", precision_pct: 72.07, recall_pct: 1.14, publishable: false }] };
  const { markdown } = buildAgentBriefing("fahali_get_lead_time", d);

  assert.match(markdown, /72\.07/, "the measurement must be visible — an agent cannot audit what it cannot see");
  assert.match(markdown, /recall 1\.14%/, "recall is the half that matters for a warning product; 72% at 1.14% recall is the retracted claim");

  // The binding, asserted PER LINE. This is the entire protection.
  const lines = markdown.split("\n").filter((l) => l.includes("72.07"));
  assert.ok(lines.length > 0, "the figure vanished — this test is now vacuous");
  for (const l of lines) {
    assert.match(l, /NOT PUBLISHABLE/i, `a gated figure appeared without its verdict: "${l}"`);
    assert.match(l, /not a claim|do not restate/i, `nothing on that line forbade restating it: "${l}"`);
  }
});

test("a publishable stratum always carries its recall and its stratum", () => {
  const d = { trackRecord: [{ engine: "risk_intelligence", horizon_tier: "48h", bar_regime: "crypto", precision_pct: 71.44, base_rate_pct: 32.77, recall_pct: 26.84, publishable: true }] };
  const { markdown } = buildAgentBriefing("fahali_get_lead_time", d);
  assert.match(markdown, /71\.44%/);
  assert.match(markdown, /recall 26\.84%/, "precision alone is the flattering half of a warning product");
  assert.match(markdown, /risk_intelligence · 48h · crypto/, "a figure without its stratum is not a claim about anything");

  // ...and with recall missing, the number must arrive with that said out loud.
  const noRecall = { trackRecord: [{ engine: "x", horizon_tier: "24h", bar_regime: "crypto", precision_pct: 90, recall_pct: null, publishable: true }] };
  assert.match(buildAgentBriefing("fahali_get_lead_time", noRecall).markdown, /recall not reported/i);
});

test("the fleet-coverage ratio never reaches the narrative", () => {
  // `coverage` shipped "0/18" and "5/18". An engine count is never sayable, and
  // it is worse inside a sentence than inside a field.
  const d = { data: [{ symbol: "BTCUSDT", canonical: { headline: "Downside skew", state: "WATCH", coverage: "5/18" } }] };
  const { markdown } = buildAgentBriefing("fahali_get_market_verdict", d);
  assert.doesNotMatch(markdown, /\d+\s*\/\s*\d+/, "an engine-count ratio reached agent-facing prose");
});

test("symbols the request asked for but did not get are named as not covered", () => {
  const d = {
    count: 2,
    requested: ["BTCUSDT", "NVDA", "SPY"],
    notReturned: [{ symbol: "SPY", reason: "Fahali has no judged verdict for SPY in the last 72h, so no read was produced for it. This is absence of coverage in that window, NOT a finding that SPY is safe." }],
    data: [{ symbol: "BTCUSDT" }, { symbol: "NVDA" }],
  };
  const { markdown } = buildAgentBriefing("fahali_get_market_verdict", d);
  assert.match(markdown, /SPY/, "a silently dropped symbol never reached the agent");
  assert.match(markdown, /NOT a finding that SPY is safe/);
});

test("an empty result reads as absent coverage, never as calm", () => {
  const { markdown } = buildAgentBriefing("fahali_get_realtime_alerts", { count: 0, data: [] });
  assert.match(markdown, /no matching findings|not a statement that the wider market is safe/i);
  assert.doesNotMatch(markdown, /all clear|nothing to worry|looks calm|no risk/i);
});

test("aggregate metrics are readings even when there is no row array", () => {
  const { markdown } = buildAgentBriefing("fahali_get_portfolio_metrics", {
    status: "ok",
    cascadeRisk: 0.74,
    liquidityStress: 0.31,
  });
  assert.match(markdown, /aggregate measurements/i);
  assert.doesNotMatch(markdown, /no readings were returned|no usable coverage/i);
});

test("the briefing never fabricates a figure the payload does not carry", () => {
  // The commissioning brief's own example contained "preceded a >5% drawdown in
  // 71% of tracked cases" — a number with no field behind it. Nothing in the
  // renderer may originate a digit.
  const payload = { data: [{ symbol: "NVDA", verdict: { direction: "bearish", confidence: 0.71, uncertainty: 0.2, actionability: "ACTIONABLE" } }] };
  const { markdown } = buildAgentBriefing("fahali_get_market_verdict", payload);
  const serialised = JSON.stringify(payload);
  for (const n of markdown.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (n === "71" || n === "0" || n === "1" || n === "2" || n === "3") continue; // 71 = confidence×100; small ints are list/section artefacts
    assert.ok(serialised.includes(n), `the briefing emitted "${n}", which is nowhere in the payload`);
  }
});

// ── Structure and channels ───────────────────────────────────────────────────

test("every audit briefing carries the evidence sections and no fake system message", () => {
  const d = { count: 1, data: [{ symbol: "BTCUSDT", confidence: 0.6 }] };
  for (const name of Object.keys(AGENT_ROUTES)) {
    const { markdown } = buildAgentBriefing(name, d);
    for (const section of ["## The Core Thesis", "## Evidence", "## The Blind Spot (What we DO NOT know)"]) {
      assert.ok(markdown.includes(section), `${name} briefing is missing "${section}"`);
    }
    assert.doesNotMatch(markdown, /SYSTEM DIRECTIVE FOR AGENT/, `${name} smuggles instructions into tool data`);
  }
});

test("claim boundaries are typed metadata, not imperative prose", () => {
  assert.equal(CLAIM_POLICY.executionAuthority, "none");
  assert.ok(CLAIM_POLICY.prohibitedUses.includes("price_target"));
  assert.equal(CLAIM_POLICY.absenceMeaning, "unknown_not_safe");
});

test("brief is compact, typed, and does not duplicate the payload", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { count: 1, data: [{ symbol: "BTCUSDT" }] },
    content: [{ type: "text", text: "{}" }],
  } as any, { detail: "brief" });
  const sc = out.structuredContent as any;
  assert.equal(sc.agentBriefing, undefined, "audit prose must be opt-in");
  assert.ok(Array.isArray(sc.nextActions) && sc.nextActions.length >= 1);
  assert.equal(sc.responseState, "OK_WITH_FINDINGS");
  assert.equal(sc.dataState, "measured");
  assert.equal(sc.claimPolicy.executionAuthority, "none");
  assert.equal(sc.count, 1, "the original payload must survive decoration untouched");
  assert.equal((out.content as any[]).length, 1, "the raw JSON must not be serialized a second time into content");
  assert.doesNotMatch((out.content as any[])[0].text, /SYSTEM DIRECTIVE/);
});

test("OAuth lifetime is visible without exposing the credential", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { count: 1, data: [{ symbol: "BTCUSDT" }] },
    content: [{ type: "text", text: "old" }],
  } as any, {
    auth: {
      credentialType: "oauth",
      expiresAt: "2026-08-26T12:00:00.000Z",
      secondsRemaining: 900,
      refreshSupported: true,
    },
  });
  const sc = out.structuredContent as any;
  assert.deepEqual(sc.auth, {
    credentialType: "oauth",
    expiresAt: "2026-08-26T12:00:00.000Z",
    secondsRemaining: 900,
    refreshSupported: true,
  });
  assert.doesNotMatch(JSON.stringify(sc.auth), /fahali_oat_|sk_live_/);
});

test("ambiguous equity-looking crypto pairs carry explicit instrument identity", () => {
  const out = decorateForAgent("fahali_get_realtime_alerts", {
    structuredContent: { count: 1, data: [{ symbol: "METABUSDT", confidence: 0.97 }] },
    content: [{ type: "text", text: "old" }],
  } as any);
  const sc = out.structuredContent as any;
  assert.equal(sc.instruments[0].assetClass, "crypto");
  assert.equal(sc.instruments[0].displayName, "METAB / Tether");
  assert.equal(sc.instruments[0].venue, null);
  assert.match(sc.instruments[0].ambiguityWarning, /not Meta Platforms|venue/i);
});

test("confidence fields declare meaning and never promote detector strength to probability", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      count: 1,
      data: [{
        symbol: "NVDA",
        verdict: { direction: "unknown", confidence: 0.8, actionability: "ABSTAIN" },
        detectionConfidence: 0.97,
      }],
    },
    content: [{ type: "text", text: "old" }],
  } as any);
  const semantics = (out.structuredContent as any).confidenceSemantics;
  const abstention = semantics.find((entry: any) => entry.scoreType === "abstention_confidence");
  const detector = semantics.find((entry: any) => entry.scoreType === "uncalibrated_engine_score");
  // Both entries must still TYPE their path — that is what this block is for.
  assert.ok(abstention, "an abstention confidence must be typed");
  assert.equal(abstention?.isProbability, false);
  assert.ok(detector, "a raw detector score must be typed");
  assert.equal(detector?.isProbability, false);

  // 🔴 And they must carry NO sampled value (R6, 2026-08-27). These entries type
  // a WILDCARD path, so a single scalar on them is a sample from one row
  // presented as a property of all of them. Live: an entry shipped `value: 8`
  // while every returned row held `urgencyScore: null` — a number that appeared
  // nowhere in the response it described. The values live in the rows; this
  // block says how to read them.
  for (const entry of semantics) {
    assert.equal("value" in entry, false,
      `confidenceSemantics.${entry.field} carries a sampled value — it types a path, it does not sample one`);
    assert.equal(entry.appliesTo, "every row at this path");
  }
});

test("audit detail opts into the narrative without re-serializing raw JSON", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { count: 1, data: [{ symbol: "BTCUSDT" }] },
    content: [{ type: "text", text: "old" }],
  } as any, { detail: "audit", toolCatalog: TOOL_DEFINITIONS as any[] });
  const sc = out.structuredContent as any;
  assert.match(sc.agentBriefing, /## The Core Thesis/);
  assert.equal((out.content as any[]).length, 1);
});

test("nextTools ships RESOLVED arguments, never the template token", () => {
  // The markdown said fahali_get_forecast(symbol="NVDA") while structuredContent
  // shipped {symbol: "$symbol"} — and structuredContent is the channel enforcing
  // clients read. An agent following the chain would have called a literal
  // "$symbol". The old test asserted `nextTools.length >= 1`: presence, not
  // content, which is why it passed for the entire life of the bug.
  const { nextTools } = buildAgentBriefing("fahali_get_market_verdict", {
    count: 1,
    data: [{ symbol: "NVDA", verdict: { direction: "DOWNSIDE_SKEW", actionability: "ACTIONABLE" } }],
  });
  assert.ok(nextTools.length >= 1);
  for (const rec of nextTools) {
    for (const [k, v] of Object.entries(rec.args ?? {})) {
      assert.doesNotMatch(String(v), /^\$/, `${rec.tool}.${k} shipped the unresolved token "${v}"`);
    }
  }
  const withSymbol = nextTools.find((r) => r.args && "symbol" in r.args);
  assert.equal(withSymbol?.args?.symbol, "NVDA", "the symbol must come from the payload, not the template");
});

test("incident nextTools resolve the incident id, never the template token", () => {
  // $incident_id had no resolver branch, so active-incidents shipped
  // incident_id="$incident_id" and every acknowledge/timeline call 400d — while
  // the suite stayed green because nothing asserted content on this path.
  const incidentId = "11111111-2222-4333-8444-555555555555";
  const { nextTools, markdown } = buildAgentBriefing("fahali_get_active_incidents", {
    status: "ok",
    dataState: "measured",
    incidents: [{ incidentId, watchId: "w1", state: "open" }],
  });
  const ack = nextTools.find((r) => r.tool === "fahali_acknowledge_incident");
  const timeline = nextTools.find((r) => r.tool === "fahali_get_incident_timeline");
  assert.equal(ack?.args?.incident_id, incidentId, "acknowledge must carry the payload's incident");
  assert.equal(timeline?.args?.incident_id, incidentId, "timeline must carry the payload's incident");
  assert.doesNotMatch(markdown, /\$incident_id/, "the literal token reached the agent channel");
});

test("the routing table itself is never mutated by resolving a call", () => {  // resolved args are written onto a COPY; if they landed on the shared ROUTES
  // entry, the first NVDA call would pin every later caller's chain to NVDA.
  buildAgentBriefing("fahali_get_market_verdict", { count: 1, data: [{ symbol: "NVDA" }] });
  const again = buildAgentBriefing("fahali_get_market_verdict", { count: 1, data: [{ symbol: "TSLA" }] });
  const rec = again.nextTools.find((r) => r.args && "symbol" in r.args);
  assert.equal(rec?.args?.symbol, "TSLA", "a previous call's symbol leaked into the shared routing table");
});

test("a bare-string notReturned entry is still named as uncovered", () => {
  // `notReturned: ["SPY"]` is the cheapest echo an endpoint can produce. Handling
  // only {symbol, reason} objects meant the bare list produced NO blind-spot line,
  // so a three-name request answering two read as a clean two-name answer — the
  // exact defect the field was added to prevent, reached through the field itself.
  for (const shape of [["SPY"], [{ symbol: "SPY" }], [{ symbol: "SPY", reason: "no fresh market data" }]]) {
    const { markdown } = buildAgentBriefing("fahali_get_market_verdict", {
      count: 1,
      data: [{ symbol: "NVDA" }],
      requested: ["NVDA", "SPY"],
      notReturned: shape,
    });
    const blind = markdown.split("## The Blind Spot")[1] ?? "";
    assert.match(blind, /SPY/, `notReturned shape ${JSON.stringify(shape)} produced no blind-spot line`);
  }
});

test("a non-text content block survives decoration instead of being deleted", () => {
  // decorateForAgent REBUILDS `content`, so anything it does not reconstruct is
  // gone. Today that costs nothing — `okResult()` is the single success builder
  // for all 31 tools and it emits only text — but the first handler to return a
  // chart image would have it silently dropped by a function the handler's own
  // author never edited. Silent deletion on a tool that was working is exactly
  // the failure class this file exists to prevent, so it is asserted, not left
  // to the fact that no such handler happens to exist yet.
  const image = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };
  const out = decorateForAgent("fahali_get_visual_intelligence", {
    structuredContent: { count: 1, data: [{ symbol: "BTCUSDT" }] },
    content: [{ type: "text", text: "old generic table" }, image],
  } as any);
  const kinds = (out.content as any[]).map((c) => c.type);
  assert.deepEqual(kinds, ["text", "image"], `non-text block was dropped; content is ${JSON.stringify(kinds)}`);
  assert.deepEqual((out.content as any[])[1], image, "the block must survive byte-identical, not be re-encoded");
  assert.ok(!(out.content as any[]).some((c) => c.text === "old generic table"), "the generic table is deliberately replaced by the briefing");
});

test("an error result gets routing but never a narrative", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    isError: true,
    content: [{ type: "text", text: '{"error":"HTTP 403"}' }],
  } as any);
  const joined = (out.content as any[]).map((c) => c.text).join("\n");
  assert.ok(out.isError);
  assert.doesNotMatch(joined, /## The Core Thesis/, "a narrative over an error invents a read that does not exist");
  const sc = out.structuredContent as any;
  assert.equal(sc.responseState, "ERROR");
  assert.equal(sc.dataState, "error");
  assert.equal(sc.error.code, "TOOL_ERROR");
});

test("decoration never throws, whatever the payload shape", () => {
  for (const weird of [null, undefined, 0, "", [], [1, 2], { a: { b: { c: { d: { e: 1 } } } } }, { data: [null, 1, "x"] }]) {
    assert.doesNotThrow(() => decorateForAgent("fahali_get_market_verdict", { structuredContent: weird } as any));
    assert.doesNotThrow(() => buildAgentBriefing("fahali_get_lead_time", weird));
  }
});

test("the envelope fields are declared on every tool's outputSchema", () => {
  // An undeclared field fails structuredContent validation on enforcing clients
  // (SDK >=1.29) — and ONLY on successful calls, since errors are exempt. That
  // is the failure mode that broke calculationStatus on essentially every
  // healthy call while the error paths validated fine.
  const bad: string[] = [];
  for (const t of TOOL_DEFINITIONS as any[]) {
    const props = t.outputSchema?.properties ?? {};
    for (const f of [
      "responseState", "dataState", "mcpStatus", "sourceStatus", "sourceDataState", "absence", "symbolCoverage",
      "scope", "sourceScope", "decision", "sourceDecision", "evidenceQuality", "sourceEvidenceQuality",
      "confidenceSemantics", "sourceConfidenceSemantics", "claimPolicy", "nextActions", "auth",
    ]) {
      if (!props[f]) bad.push(`${t.name}.outputSchema is missing "${f}"`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n  "));
});

test("the routing table is wired into the dispatcher", () => {
  // Source-text, because index.ts opens a network server on import. The seam is
  // a single wrap; if someone unwraps it the briefings silently stop shipping
  // and every test above keeps passing.
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /decorateForAgent/, "index.ts must route tool results through decorateForAgent");
});

// ── Endpoint-aware truth contract ───────────────────────────────────────────

const MONITOR_ONLY_FIXTURE = {
  status: "ok",
  dataState: "measured",
  operatingMode: "MONITOR_ONLY",
  outputClassification: {
    outputClass: "LIFECYCLE_STATE",
    operatingMode: "MONITOR_ONLY",
    capitalPath: "NONE",
    executionAuthority: "NONE",
    personalizedRecommendation: false,
    portfolioAction: false,
    orderAction: false,
    executionAllowed: false,
    humanFinancialDecisionRequired: true,
  },
  legacyFieldSemantics: {
    "decision.action": "monitoring_escalation_only_not_portfolio_action",
    "decision.positions[].action": "monitoring_escalation_only_not_portfolio_action",
    "decision.whatToDo": "archived_legacy_field_name_v2_contains_monitoring_process_guidance",
  },
} as const;

// The real envelope served by server/lib/engineBoard.ts around the backend's
// board (engines/fall_warning_8h/engine.py `_state`): one quiet entry with a
// null probability and one standing entry.
const QUIET_ENTRY = {
  symbol: "ETHUSDT", state: "quiet", updated_at: 1760252390, p: null, hazard: null,
  mechanisms: { path: null, crowding: null, contagion: null, flow: null }, top_features: [], early: false,
  threshold: 0.1, inputs: { window: "measured", derivatives: "unmeasured:no_funding_feed", breadth: "measured", flow: "measured" },
  reason: "below_threshold", lifecycle: "idle", standing_id: null, onset_at: null, age_min: null,
};
const STANDING_ENTRY = {
  symbol: "BTCUSDT", state: "standing", updated_at: 1760252390, p: 0.12, hazard: 0.014,
  mechanisms: { path: 0.4, crowding: 0.3, contagion: 0.2, flow: 0.1 }, top_features: ["drawdown_6h", "funding_z"], early: false,
  threshold: 0.1, inputs: { window: "measured", derivatives: "measured", breadth: "measured", flow: "measured" },
  reason: "p_above_threshold", lifecycle: "standing", standing_id: "fw8-BTCUSDT-1760250000", onset_at: 1760250000, age_min: 40,
};
const boardOf = (symbols: Record<string, unknown>, standing: unknown[]) => ({
  engine: "fall_warning_8h", engine_version: "1.0.0", as_of: 1760252400, cycle_id: "c-1", mode: "live", alerts: false,
  fit: { fit_id: "fit-1", promoted_at: 1760000000, confidence_method: "isotonic", features_version: "f1" },
  alarm_budget: 3, threshold_p: 0.1, floor: 0.02, threshold_source: "budget", breadth: 0.31,
  census: { evaluated: 2, standing: standing.length }, standing, top: standing, symbols,
  health: { cost_ms_p50: 12, cost_ms_p99: 40, evaluations: 2, lifecycle_persisted: true },
});
// The exported roster entry (server/generated/engineKeys.json contract_engines.fall_warning_8h), served as roster.value.
const FW8_ROSTER = {
  display_name: "Fall warning, 8 hours", kind: "predictive", claim_type: "event_prob", truth_condition: "drawdown_5pct_v1",
  horizon_min: 480, direction_policy: "down_only", universe: "crypto", alert_type: "fall_warning", measure_only: true, contract: true,
};
const fixtureUrl = existsSync(new URL("./fixtures/engineBoardRecord.engineOne.json", import.meta.url))
  ? new URL("./fixtures/engineBoardRecord.engineOne.json", import.meta.url)
  : new URL("../../server/tests/fixtures/engineBoardRecord.engineOne.json", import.meta.url);
const ENGINE_BOARD_RECORD: any = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const envelopeOf = (board: unknown, extra: Record<string, unknown> = {}) => ({
  status: "ok",
  engine: "fall_warning_8h",
  asOf: "2026-10-12T07:00:00.000Z",
  dataState: "measured",
  roster: { value: FW8_ROSTER },
  board: { value: board },
  // The record block the api reader produces from the rows captured from production
  // (server/tests/fixtures/engineBoardRecord.engineOne.json, pinned there to readEngineBoard).
  record: ENGINE_BOARD_RECORD.withheldOnly,
  boardAgeSeconds: 14,
  ...extra,
});
const ENGINE_BOARD_FIXTURE = envelopeOf(boardOf({ BTCUSDT: STANDING_ENTRY, ETHUSDT: QUIET_ENTRY }, [STANDING_ENTRY]));

const FINDING_FIXTURES: Record<string, Record<string, unknown>> = {
  fahali_get_market_verdict: { data: [{ symbol: "BTCUSDT" }] },
  fahali_get_market_decision: { data: [{ symbol: "BTCUSDT" }] },
  fahali_get_symbol_decision: { data: [{ symbol: "BTCUSDT" }] },
  fahali_get_forecast: { forecast: { symbol: "BTCUSDT", state: "WATCH" } },
  fahali_resolve_instrument: {
    status: "ok",
    dataState: "measured",
    requested: ["GBTC"],
    instruments: [{
      symbol: "GBTC",
      canonicalId: "arca:equity:GBTC",
      displayName: "Grayscale Bitcoin Trust ETF",
      assetClass: "equity",
      venue: "ARCA",
      quoteCurrency: "USD",
      // The exact symbol a string parse reads as "G against BTC".
      resolutionState: "resolved",
      resolutionBasis: "venue_asset_list",
      ambiguityWarning: null,
      session: { label: "closed", open: false, nextOpen: null },
    }],
    unresolved: [],
    referenceHealth: { loaded: true, entries: 14776 },
  },
  fahali_get_microstructure_proxy: { data: [{ symbol: "BTCUSDT" }] },
  fahali_get_flash_crash_risk: { signals: [{ symbol: "BTCUSDT" }] },
  fahali_get_detection_activity: { recentDetections: "2 detections", symbolsWithRecentDetections: 1 },
  fahali_get_unusual_money_movement: { data: [{ symbol: "BTCUSDT" }] },
  fahali_get_market_risk_score: { score: 70, detectionCount: 2, observations: ["measured"] },
  fahali_get_correlation_matrix: { matrix: [[1, 0.72], [0.72, 1]], perSymbol: [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }] },
  fahali_get_market_sentiment: { history: [{ symbol: "BTCUSDT", sentimentScore: -0.2 }] },
  fahali_get_highest_conviction_signals: { items: [{ symbol: "BTCUSDT" }] },
  fahali_get_market_snapshot: { assets: [{ symbol: "BTCUSDT", price: 1 }], indices: [] },
  fahali_get_engine_status: { engines: [{ name: "momentum", status: "firing" }] },
  fahali_get_case_studies: { caseStudies: [{ symbol: "BTCUSDT", correct: true }] },
  fahali_list_resources: {
    resources: [{ method: "GET", path: "/api/situations", params: [], gates: [], publicRead: true }],
    excluded: [{ method: "POST", path: "/api/keys", reason: "Write." }],
    counts: { routesWalked: 333, resources: 206, excluded: 126 },
    basis: "Walked from the live Express router.",
  },
  // A passthrough: the fixture is a real resource body, because that is what
  // this tool actually returns — it has no shape of its own.
  fahali_fetch_resource: { situations: [{ symbol: "BTCUSDT", thesis: "regime shift" }], activeSymbols: 463 },
  fahali_get_track_record_scorecard: { trackRecord: [{ engine: "committee_verdict", publishable: true }] },
  fahali_get_portfolio_metrics: { cascadeRisk: 0.7, liquidityStress: null },
  fahali_get_market_regime: { regimes: [{ regime: "bullish" }] },
  // Trimmed from the live /api/market/mood reading of 2026-10-01.
  fahali_get_market_mood: {
    kind: "observation", isForecast: false, calibrated: false, method: "Each measure is ranked against its own earlier values.",
    generatedAt: "2026-10-01T16:00:00.000Z",
    equity: {
      assetClass: "equity", state: "measured", score: 36, band: "fear", label: "Fear", reason: null, asOf: "2026-09-30", provisional: false,
      coverage: { present: 5, total: 5, required: 3 },
      components: [{ key: "breadth", name: "Sectors above their 50-day average", value: 0.25, unit: "share", percentile: 2, higherMeans: "greed",
        ranked: { against: 124, since: "2026-04-02" }, detail: "2 of the 8 sector funds with a fresh 50-day history are above it (11 tracked).",
        symbols: ["XLE"], note: "Share of the S&P sector funds above their own 50-day average.", reason: null }],
      history: [{ day: "2026-09-30", score: 36 }],
      excluded: [{ symbol: "XLU", reason: "only 36 days of history (need 50)" }],
    },
    crypto: {
      assetClass: "crypto", state: "measured", score: 67, band: "greed", label: "Greed", reason: null, asOf: "2026-10-01", provisional: true,
      coverage: { present: 4, total: 4, required: 3 }, components: [], history: [], excluded: [{ symbol: "TONUSDT", reason: "last price 2026-06-30" }],
    },
  },
  // Trimmed from the live /api/market/rotation reading of 2026-10-01.
  fahali_get_sector_rotation: {
    kind: "observation", basis: "relative_price_performance", measuresMoneyFlow: false, isForecast: false, calibrated: false,
    method: "Each member's return minus its benchmark's over a short and a long window.", generatedAt: "2026-10-01T16:00:00.000Z",
    groups: [{
      key: "crypto", title: "Coins against Bitcoin", benchmark: "BTCUSDT", benchmarkName: "Bitcoin",
      window: { short: 7, long: 30, unit: "days" }, state: "measured", reason: null, asOf: "2026-10-01", provisional: true,
      rows: [{ symbol: "SUIUSDT", name: "Sui", quadrant: "leading", relShort: 0.141, relLong: 0.502, retShort: 0.15, retLong: 0.55,
        unusual: { percentile: 91, against: 180, since: "2026-04-04" } }],
      headline: "Bitcoin Cash is fading: -8.0% over 7 days, after +17.2% over 30.",
      excluded: [{ symbol: "TONUSDT", reason: "last price 2026-06-30" }],
    }],
  },
  fahali_get_visual_intelligence: { nodes: [{ symbol: "BTCUSDT" }], flows: [] },
  fahali_get_realtime_alerts: { status: "ACTIVE", alerts: [{ symbol: "BTCUSDT" }] },
  fahali_get_portfolio_risk: { positions: [{ symbol: "BTCUSDT", marketValue: 1 }] },
  fahali_analyze_custom_portfolio: { positions: [{ symbol: "BTCUSDT", marketValue: 1 }] },
  fahali_get_contagion_map: { nodes: [{ symbol: "BTCUSDT" }], edges: [], clusters: [] },
  fahali_get_capital_flow: { data: [{ symbol: "BTCUSDT", netFlowUsd: 1 }] },
  fahali_run_shock_test: { simulations: [{ symbol: "BTCUSDT", shockedValue: 1 }] },
  fahali_get_market_briefing: { status: "OK", topOpportunities: [{ symbol: "BTCUSDT" }], alertVolume: { count: 1 } },
  fahali_daily_brief: { alert_activity: { new_alerts_24h: 2, symbols_affected: 1 }, risk_score: 20 },
  fahali_save_memory: { success: true, memory: { id: "memory_1" } },
  fahali_search_memories: { data: [{ id: "memory_1" }] },
  fahali_create_alert: { success: true, alert: { id: "alert_1", symbol: "BTCUSDT" } },
  fahali_list_agent_sessions: { data: [{ session_id: "session_1" }] },
  fahali_fact_check_narrative: {
    assertions: [{
      text: "BTC has a supported downside-risk reading.",
      verdict: "SUPPORTED",
      safeToRepeat: true,
      explanation: "The current measured evidence supports this bounded assertion.",
      symbol: "BTCUSDT",
    }],
  },
  fahali_list_connected_accounts: {
    status: "ok",
    dataState: "measured",
    count: 1,
    accounts: [{
      id: "account_1",
      provider: "alpaca",
      accountName: "Primary portfolio",
      status: "connected",
      totalValue: 100_000,
      currency: "USD",
      positionCount: 1,
      connectionIssue: false,
    }],
  },
  // A bundle view is a RAW upstream payload — decoration runs once at the outer
  // seam, so no view arrives carrying a responseState. This fixture used to be
  // `{ briefing: { responseState: "OK_WITH_FINDINGS" } }`, which asserted the
  // answer instead of supplying the shape, and so proved nothing: the classifier
  // never inspected views at all and the fixture agreed with it. That is how a
  // bundle holding two measured views shipped NO_COVERAGE to production. The
  // view below is a real market-briefing payload.
  fahali_get_bundle: {
    status: "ok",
    requestedViews: ["briefing"],
    completedViews: ["briefing"],
    failedViews: [],
    views: {
      briefing: {
        dataState: "measured",
        marketRiskScore: 62,
        alertVolume: { count: 314 },
        priorityRiskClusters: [{ symbol: "BTCUSDT", thesis: "funding stress", severity: "high" }],
        detectionActivity: { recentDetections: 314, symbolsWithRecentDetections: 41 },
      },
    },
  },
  fahali_get_capabilities: { tools: [{ name: "fahali_get_market_verdict" }], resources: [] },
  fahali_watch_portfolio: { ...MONITOR_ONLY_FIXTURE, watch: { id: "watch_1" }, verdict: { id: "verdict_1" } },
  fahali_list_portfolio_watches: { ...MONITOR_ONLY_FIXTURE, watches: [{ id: "watch_1" }] },
  fahali_update_portfolio_watch: { ...MONITOR_ONLY_FIXTURE, watch: { id: "watch_1" }, verdict: { id: "verdict_2" } },
  fahali_get_portfolio_decision: { ...MONITOR_ONLY_FIXTURE, watch: { id: "watch_1" }, verdict: { id: "verdict_1" } },
  fahali_get_watch_delta: { ...MONITOR_ONLY_FIXTURE, delta: { changed: true, watchId: "watch_1" } },
  fahali_get_active_incidents: { ...MONITOR_ONLY_FIXTURE, incidents: [{ incidentId: "incident_1", state: "open" }] },
  fahali_acknowledge_incident: { ...MONITOR_ONLY_FIXTURE, incident: { incidentId: "incident_1", state: "acknowledged" }, acknowledged: true },
  fahali_get_incident_timeline: { ...MONITOR_ONLY_FIXTURE, incident: { incidentId: "incident_1" }, timeline: [{ verdictId: "verdict_1", role: "opening" }] },
  fahali_get_verdict_history: { ...MONITOR_ONLY_FIXTURE, items: [{ id: "verdict_1" }] },
  fahali_get_verdict_by_id: { ...MONITOR_ONLY_FIXTURE, verdict: { id: "verdict_1" } },
  fahali_get_evidence: {
    ...MONITOR_ONLY_FIXTURE,
    verdictId: "00000000-0000-4000-8000-000000000001",
    immutableSnapshot: { evidenceEventIds: ["42"] },
    integrity: { evidenceHashVerified: true },
    sourceEvents: [{ evidenceId: "42", symbol: "BTCUSDT" }],
    identityMismatchEvidenceIds: [],
    sourceMaterialMismatchEvidenceIds: [],
    coverage: { referenced: 1, pageReturned: 1, complete: true },
  },
  fahali_subscribe_risk: { ...MONITOR_ONLY_FIXTURE, subscription: { id: "subscription_1" } },
  fahali_list_risk_subscriptions: { ...MONITOR_ONLY_FIXTURE, subscriptions: [{ id: "subscription_1" }] },
  fahali_update_subscription: { ...MONITOR_ONLY_FIXTURE, subscription: { id: "subscription_1", status: "paused" } },
  fahali_unsubscribe_risk: { ...MONITOR_ONLY_FIXTURE, subscription: { id: "subscription_1", status: "disabled" }, unsubscribed: true },
  fahali_get_lead_time: { trackRecord: [{ engine: "committee_verdict", publishable: true }] },
  fahali_get_fall_warnings: ENGINE_BOARD_FIXTURE,
  fahali_get_engine_board: ENGINE_BOARD_FIXTURE,
};

test("every canonical tool has an explicit adapter and a real-shape finding fixture", () => {
  const advertised = (TOOL_DEFINITIONS as any[]).map((tool) => tool.name).sort();
  assert.equal(advertised.length, Object.keys(AGENT_ENDPOINT_ADAPTERS).length);
  assert.deepEqual(Object.keys(AGENT_ENDPOINT_ADAPTERS).sort(), advertised);
  assert.deepEqual(Object.keys(FINDING_FIXTURES).sort(), advertised);
  for (const name of advertised) {
    const state = classifyAgentPayload(name, FINDING_FIXTURES[name]);
    assert.equal(state.responseState, "OK_WITH_FINDINGS", `${name} did not recognize its endpoint's finding shape: ${JSON.stringify(state)}`);
    assert.equal(state.dataState, "measured", `${name} did not classify its finding as measured`);
  }
});

test("every decorated finding fixture satisfies its advertised output schema", () => {
  const AjvConstructor: any = Ajv;
  const ajv = new AjvConstructor({ strict: false });
  addFahaliSchemaFormats(ajv);
  const schemaFailures: string[] = [];
  for (const tool of TOOL_DEFINITIONS as any[]) {
    const result = decorateForAgent(tool.name, {
      structuredContent: FINDING_FIXTURES[tool.name],
      content: [],
    } as any, { detail: "audit" });
    assert.notEqual(result.isError, true, `${tool.name} fixture unexpectedly became an error`);
    const validate = ajv.compile(tool.outputSchema);
    if (!validate(result.structuredContent)) {
      schemaFailures.push(`${tool.name}: ${ajv.errorsText(validate.errors)}`);
    }
  }
  assert.deepEqual(schemaFailures, [], `decorated fixtures violated MCP output schemas:\n  ${schemaFailures.join("\n  ")}`);
});

test("endpoint status vocabulary survives decoration and validates against the shared envelope", () => {
  // Capital flow deliberately has no endpoint-specific `status` property, so
  // it receives the shared envelope declaration. This catches the production
  // failure where a healthy `degraded`/`partial` response was preserved by the
  // decorator but rejected by enforcing clients because the shared schema only
  // allowed `ok|error`.
  const tool = BY_NAME.get("fahali_get_capital_flow");
  assert.ok(tool);
  assert.equal(tool.outputSchema.properties.status.type, "string");
  assert.equal(tool.outputSchema.properties.status.enum, undefined);

  const result = decorateForAgent(tool.name, {
    structuredContent: {
      ...FINDING_FIXTURES[tool.name],
      status: "degraded",
      dataState: "measured",
    },
    content: [],
  } as any, { detail: "audit" });
  const structured = result.structuredContent as Record<string, unknown>;
  assert.equal(structured.status, "degraded");
  assert.equal(structured.sourceStatus, "degraded");
  assert.equal(structured.mcpStatus, "ok");

  const AjvConstructor: any = Ajv;
  const ajv = new AjvConstructor({ strict: false });
  addFahaliSchemaFormats(ajv);
  const validate = ajv.compile(tool.outputSchema);
  assert.equal(validate(structured), true, ajv.errorsText(validate.errors));
});

test("every adapter declares and enforces its no-evidence semantics", () => {
  const measuredEmpty = new Set([
    // We looked at the venue listings and the ticker is not in them. That is a
    // measured answer, not missing coverage.
    "fahali_resolve_instrument",
    "fahali_get_flash_crash_risk",
    "fahali_get_highest_conviction_signals",
    "fahali_get_case_studies",
    "fahali_get_realtime_alerts",
    "fahali_get_capabilities",
    // An empty catalogue is a MEASURED answer: the walk ran and found nothing.
    // A walk that could not run returns 503 from /api/resources instead, so
    // these two conditions never collapse into one another.
    "fahali_list_resources",
  ]);
  const userEmpty = new Set([
    "fahali_list_connected_accounts",
    "fahali_list_portfolio_watches",
    "fahali_get_verdict_history",
    "fahali_list_risk_subscriptions",
    // No open incidents is something Fahali MEASURED about this account's
    // ledger. `no_coverage` would tell an agent Fahali could not see, which is
    // the opposite claim and the more dangerous one to get wrong.
    "fahali_get_active_incidents",
  ]);
  const sourceUnverified = new Set([
    // Moved from `no_coverage` 2026-08-27. An empty scorecard cannot mean "no
    // coverage": the judged record is cumulative and never prunes, so five
    // empty axes mean the query did not complete, not that Fahali has judged
    // nothing. `source_unverified` says exactly that; `no_coverage` asserted an
    // absence of data we know we hold ~19.7M rows of.
    "fahali_get_track_record_scorecard",
    "fahali_get_detection_activity",
    "fahali_get_market_risk_score",
    "fahali_get_correlation_matrix",
    "fahali_get_market_sentiment",
    "fahali_get_market_snapshot",
    "fahali_get_engine_status",
    // Engine boards: an empty payload means the read did not complete.
    "fahali_get_fall_warnings",
    "fahali_get_engine_board",
    "fahali_get_market_regime",
    // An empty mood body means the read did not complete — the route answers a
    // real failure with a 503, and a stopped feed with state 'unavailable'.
    "fahali_get_market_mood",
    // Same: an empty groups array means the read did not complete (a failure is a 503).
    "fahali_get_sector_rotation",
    "fahali_get_visual_intelligence",
    "fahali_get_contagion_map",
    "fahali_get_market_briefing",
    "fahali_daily_brief",
    "fahali_search_memories",
    "fahali_list_agent_sessions",
    // A passthrough. Whether an empty body means "measured nothing" belongs to
    // the RESOURCE that was fetched, and this tool cannot know which — so it
    // must not assert either. `source_unverified` is the only honest kind.
    "fahali_fetch_resource",
  ]);
  const setPath = (target: Record<string, unknown>, path: string, value: unknown) => {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts.at(-1)!] = value;
  };

  for (const [name, adapter] of Object.entries(AGENT_ENDPOINT_ADAPTERS)) {
    const payload: Record<string, unknown> = { count: 0 };
    for (const collection of adapter.collections) setPath(payload, collection, []);
    for (const key of adapter.readingKeys ?? []) setPath(payload, key, null);
    for (const key of adapter.zeroEvidenceKeys ?? []) setPath(payload, key, 0);
    const state = classifyAgentPayload(name, payload);
    const expected = measuredEmpty.has(name)
      ? ["OK_NO_FINDINGS", "measured", "measured_empty"]
      : userEmpty.has(name)
        ? ["OK_NO_FINDINGS", "measured", "user_empty"]
        : sourceUnverified.has(name)
          ? ["NO_COVERAGE", "no_data", "source_unverified"]
          : ["NO_COVERAGE", "no_data", "no_coverage"];
    assert.deepEqual(
      [state.responseState, state.dataState, state.absence?.kind],
      expected,
      `${name} no-evidence semantics drifted`,
    );
  }
});

test("endpoint collections no longer disappear behind generic row-key guessing", () => {
  for (const [name, payload] of Object.entries({
    fahali_get_market_snapshot: { assets: [{ symbol: "AAPL" }], indices: [] },
    fahali_get_market_regime: { regimes: [{ regime: "bullish" }] },
    fahali_get_market_sentiment: { history: [{ symbol: "BTCUSDT" }] },
    fahali_get_case_studies: { caseStudies: [{ symbol: "SPY" }] },
    fahali_list_portfolio_watches: { watches: [{ id: "watch_1" }] },
    fahali_list_risk_subscriptions: { subscriptions: [{ id: "subscription_1" }] },
  })) {
    const out = decorateForAgent(name, { structuredContent: payload, content: [] } as any);
    assert.equal((out.structuredContent as any).responseState, "OK_WITH_FINDINGS", `${name} lost its declared collection`);
  }
});

test("measured empty, user empty, unverified source, stale, withheld, and source error remain distinct", () => {
  const measuredEmpty = classifyAgentPayload("fahali_get_flash_crash_risk", { status: "OK", signals: [] });
  assert.deepEqual(
    [measuredEmpty.responseState, measuredEmpty.dataState, measuredEmpty.absence?.kind],
    ["OK_NO_FINDINGS", "measured", "measured_empty"],
  );

  const userEmpty = classifyAgentPayload("fahali_list_portfolio_watches", { status: "ok", dataState: "no_data", watches: [] });
  assert.deepEqual(
    [userEmpty.responseState, userEmpty.dataState, userEmpty.absence?.kind],
    ["OK_NO_FINDINGS", "measured", "user_empty"],
  );

  const unverified = classifyAgentPayload("fahali_get_market_regime", { status: "ok", regimes: [] });
  assert.deepEqual(
    [unverified.responseState, unverified.dataState, unverified.absence?.kind],
    ["NO_COVERAGE", "no_data", "source_unverified"],
  );

  const stale = classifyAgentPayload("fahali_get_lead_time", { status: "STALE_LIVE", trackRecord: [{ engine: "x" }] });
  assert.deepEqual([stale.responseState, stale.dataState, stale.absence?.kind], ["WITHHELD", "stale", "stale"]);

  const withheld = classifyAgentPayload("fahali_get_forecast", {
    status: "ABSTAIN",
    abstentionReason: "INSUFFICIENT_EVIDENCE",
    forecast: null,
  });
  assert.deepEqual([withheld.responseState, withheld.dataState, withheld.absence?.kind], ["WITHHELD", "no_data", "withheld"]);

  const sourceError = classifyAgentPayload("fahali_get_lead_time", {
    status: "DEGRADED",
    calculationStatus: "no_pool",
    trackRecord: [],
  });
  assert.deepEqual([sourceError.responseState, sourceError.dataState, sourceError.absence?.kind], ["ERROR", "error", "source_error"]);
});

test("state is classified before projection and truncation is never called complete", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ symbol: `S${index}`, confidence: 0.8 }));
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { count: rows.length, data: rows },
    content: [],
  } as any, { detail: "brief", limit: 1 });
  const sc = out.structuredContent as any;
  assert.equal(sc.responseState, "OK_WITH_FINDINGS");
  assert.equal(sc.data.length, 1);
  assert.equal(sc.scope.returnedSymbols.length, 8, "projection changed the classified scope");
  assert.equal(sc.responseControl.complete, false);
  assert.equal(sc.responseControl.truncated, true);
  assert.equal(sc.responseControl.omitted.data, 7);
  assert.match(sc.responseControl.completenessNote, /do not treat it as complete/i);
});

test("full-fidelity audit semantics are the default at both argument mapping and decoration", () => {
  const options = responseOptions({});
  assert.equal(options.detail, "audit");
  assert.equal(options.includeWithheld, true);

  const rows = Array.from({ length: 18 }, (_, index) => ({
    symbol: `ENGINE${index}`,
    confidence: 0.8,
  }));
  const withheld = Array.from({ length: 7 }, (_, index) => ({ engine: `withheld_${index}` }));
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { dataState: "measured", data: rows, withheld: { strata: withheld } },
    content: [],
  } as any);
  const sc = out.structuredContent as any;

  assert.equal(sc.data.length, 18, "the default response projected endpoint rows away");
  assert.equal(sc.withheld.strata.length, 7, "the default response hid endpoint-provided withheld rows");
  assert.equal(sc.responseControl.detail, "audit");
  assert.equal(sc.responseControl.returnedLimit, null);
  assert.equal(sc.responseControl.complete, true);
  assert.deepEqual(sc.responseControl.omitted, {});
});

test("mixed symbol arrays retain global context and account for every filtered instrument row", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      dataState: "measured",
      data: [
        {
          symbol: "BTCUSDT",
          timestamp: "2026-08-28T12:00:00.000Z",
          verdict: { direction: "bullish", actionability: "ACTIONABLE" },
        },
        {
          symbol: "BTCUSDT",
          timestamp: "2026-08-20T12:00:00.000Z",
          verdict: { direction: "bullish", actionability: "ACTIONABLE" },
        },
        { context: "Global liquidity is tightening", scope: "market" },
        "global-session-marker",
        { symbol: "ETHUSDT", verdict: { direction: "bearish", actionability: "ACTIONABLE" } },
      ],
    },
    content: [],
  } as any, { symbols: ["BTCUSDT"], since: "2026-08-27T00:00:00.000Z", detail: "audit" });
  const sc = out.structuredContent as any;

  assert.deepEqual(
    sc.data,
    [
      {
        symbol: "BTCUSDT",
        timestamp: "2026-08-28T12:00:00.000Z",
        verdict: { direction: "bullish", actionability: "ACTIONABLE" },
      },
      { context: "Global liquidity is tightening", scope: "market" },
      "global-session-marker",
    ],
  );
  assert.equal(sc.responseControl.filtering.applied, true);
  assert.deepEqual(sc.responseControl.filtering.criteria.requestedSymbols, ["BTCUSDT"]);
  assert.deepEqual(sc.responseControl.filtering.filteredOut.data, {
    symbolMismatch: 1,
    beforeSince: 1,
    total: 2,
  });
  assert.equal(sc.responseControl.filtering.filteredOutCount, 2);
  assert.match(sc.responseControl.completenessNote, /accounted for/i);
});

test("correlation matrices and companion grids remain structurally whole in compact modes", () => {
  const symbols = ["BTCUSDT", "ETHUSDT", "SPY", "QQQ", "TLT", "GLD"];
  const matrix = symbols.map((_, row) => symbols.map((__, column) => row === column ? 1 : 0.25));
  const observations = symbols.map(() => symbols.map(() => 45));
  const policies = symbols.map(() => symbols.map(() => "aligned"));
  const coverage = symbols.map(() => symbols.map(() => 1));
  const perSymbol = symbols.map((symbol) => ({ symbol, measuredPairCount: symbols.length - 1 }));
  const requestedSymbols = symbols.slice(0, 3);

  const out = decorateForAgent("fahali_get_correlation_matrix", {
    structuredContent: {
      dataState: "measured",
      symbols,
      matrix,
      observations,
      policies,
      coverage,
      perSymbol,
    },
    content: [],
  } as any, { detail: "brief", limit: 3, symbols: requestedSymbols });
  const sc = out.structuredContent as any;

  for (const key of ["matrix", "observations", "policies", "coverage"]) {
    assert.equal(sc[key].length, symbols.length, `${key} lost outer rows`);
    assert.ok(sc[key].every((row: unknown[]) => row.length === symbols.length), `${key} is not square`);
  }
  assert.equal(sc.perSymbol.length, symbols.length, "the matrix companion was projected independently");
  assert.equal(sc.responseControl.returnedLimit, 3);
  assert.equal(sc.responseControl.omitted.matrix, undefined);
  assert.equal(sc.responseControl.omitted.perSymbol, undefined);
});

test("requested symbols are conserved and a zero-match filter never returns unrelated rows", () => {
  const partial = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      requested: ["BTCUSDT", "ETHUSDT", "NVDA", "SPY"],
      data: [{ symbol: "BTCUSDT" }, { symbol: "NVDA" }, { symbol: "SPY" }],
    },
    content: [],
  } as any, { detail: "audit" });
  const p = partial.structuredContent as any;
  assert.equal(p.responseState, "PARTIAL");
  assert.deepEqual(p.symbolCoverage, {
    requested: ["BTCUSDT", "ETHUSDT", "NVDA", "SPY"],
    returned: ["BTCUSDT", "NVDA", "SPY"],
    withheld: [],
    notReturned: ["ETHUSDT"],
    projectedOut: [],
    requestScope: "explicit",
    conservationSatisfied: true,
    fullyReturned: false,
  });
  assert.equal(p.notReturned[0].symbol, "ETHUSDT");

  const zeroMatch = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { data: [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }] },
    content: [],
  } as any, { symbols: ["SOLUSDT"], detail: "audit" });
  const z = zeroMatch.structuredContent as any;
  assert.deepEqual(z.data, [], "unrelated rows leaked through a zero-match filter");
  assert.equal(z.responseState, "NO_COVERAGE");
  assert.deepEqual(z.symbolCoverage.notReturned, ["SOLUSDT"]);
});

test("upstream status, scope, decision evidence, and confidence survive without gaining binding authority", () => {
  const upstreamDecision = {
    state: "WATCH",
    headline: "Concentration risk is elevated",
    action: { type: "CAP_EXPOSURE", condition: "mandate requires drawdown control" },
    whyNow: ["Position concentration"],
    invalidationConditions: ["Concentration falls below 10%"],
  };
  const upstreamEvidence = { coverage: "limited", measuredEvidenceCount: 7, methodologyVersion: "route-v7" };
  const upstreamConfidence = [{ field: "decision.edge", value: 0.61, scoreType: "calibrated_edge", scale: "0-1", calibrationStatus: "calibrated", isProbability: false }];
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      status: "PARTIAL",
      dataState: "measured",
      scope: { symbols: ["BTCUSDT", "ETHUSDT"], horizon: "72h", venue: "mixed" },
      decision: upstreamDecision,
      evidenceQuality: upstreamEvidence,
      confidenceSemantics: upstreamConfidence,
      data: [{ symbol: "BTCUSDT" }],
      requested: ["BTCUSDT", "ETHUSDT"],
    },
    content: [],
  } as any, { detail: "audit" });
  const sc = out.structuredContent as any;
  assert.equal(sc.status, "PARTIAL");
  assert.equal(sc.mcpStatus, "ok");
  assert.equal(sc.sourceStatus, "PARTIAL");
  assert.equal(sc.sourceDataState, "measured");
  assert.deepEqual(sc.sourceScope, { symbols: ["BTCUSDT", "ETHUSDT"], horizon: "72h", venue: "mixed" });
  assert.equal(sc.scope.venue, "mixed");
  assert.deepEqual(sc.sourceDecision, upstreamDecision);
  assert.equal(sc.decision, null, "a response-level decision cannot stand in for the unjudged selected row");
  assert.deepEqual(sc.sourceDecision.action, upstreamDecision.action);
  assert.deepEqual(sc.sourceDecision.whyNow, upstreamDecision.whyNow);
  assert.deepEqual(sc.sourceDecision.invalidationConditions, upstreamDecision.invalidationConditions);
  assert.equal(sc.evidenceQuality.methodologyVersion, "route-v7");
  assert.deepEqual(sc.sourceEvidenceQuality, upstreamEvidence);
  assert.deepEqual(sc.confidenceSemantics[0], upstreamConfidence[0]);
  assert.deepEqual(sc.sourceConfidenceSemantics, upstreamConfidence);
});

test("audit is complete only when neither row evidence nor withheld strata were truncated", () => {
  const rows = Array.from({ length: 139 }, (_, index) => ({ engine: `engine_${index}`, publishable: index === 0 }));
  const full = decorateForAgent("fahali_get_lead_time", {
    structuredContent: { trackRecord: rows, withheld: { strata: rows.slice(1) } },
    content: [],
  } as any, { detail: "audit", includeWithheld: true });
  const f = full.structuredContent as any;
  assert.equal(f.trackRecord.length, 139);
  assert.equal(f.withheld.strata.length, 138);
  assert.equal(f.responseControl.complete, true);

  const limited = decorateForAgent("fahali_get_lead_time", {
    structuredContent: { trackRecord: rows, withheld: { strata: rows.slice(1) } },
    content: [],
  } as any, { detail: "audit", includeWithheld: true, limit: 100 });
  const l = limited.structuredContent as any;
  assert.equal(l.trackRecord.length, 100);
  assert.equal(l.responseControl.complete, false);
  assert.equal(l.responseControl.omitted.trackRecord, 39);

  const withheldOmitted = decorateForAgent("fahali_get_lead_time", {
    structuredContent: { trackRecord: rows.slice(0, 1), withheld: { strata: rows.slice(1) } },
    content: [],
  } as any, { detail: "audit", includeWithheld: false });
  const w = withheldOmitted.structuredContent as any;
  assert.equal(w.withheld.strata.length, 0);
  assert.equal(w.responseControl.complete, false);
  assert.equal(w.responseControl.omitted["withheld.strata"], 138);
});

test("brief, standard, audit, and error content are consistently Markdown with structuredContent retained", () => {
  for (const detail of ["brief", "standard", "audit"] as const) {
    const out = decorateForAgent("fahali_get_market_snapshot", {
      structuredContent: { assets: [{ symbol: "AAPL", price: 200 }], indices: [] },
      content: [{ type: "text", text: '{"old":"json"}' }],
    } as any, { detail });
    assert.match((out.content as any[])[0].text, /^# Fahali /);
    assert.ok(out.structuredContent);
    assert.doesNotMatch((out.content as any[])[0].text, /^\s*\{/);
  }

  const error = decorateForAgent("fahali_get_market_snapshot", {
    isError: true,
    content: [{ type: "text", text: '{"error":"No approval received","status":401}' }],
  } as any);
  const text = (error.content as any[])[0].text;
  const sc = error.structuredContent as any;
  assert.match(text, /^# Fahali /);
  assert.match(text, /AUTH_APPROVAL_REQUIRED/);
  assert.equal(sc.absence.kind, "auth_failure");
  assert.equal(sc.responseState, "ERROR");
  assert.ok(sc.error.reauthUrl);
});

test("malformed and unsupported symbols fail closed without leaking unrelated instruments", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      dataState: "measured",
      data: [{ symbol: "BTCUSDT", verdict: { direction: "bullish", confidence: 0.7, uncertainty: 0.3 } }],
    },
    content: [],
  } as any, { symbols: ["$$$", "SOLUSDT"], detail: "audit" });
  const sc = out.structuredContent as any;
  assert.deepEqual(sc.data, [], "an unrelated BTC row escaped a failed symbol filter");
  assert.equal(sc.responseState, "OK_NO_FINDINGS", "the source was measured, so zero matches are measured-empty rather than an outage");
  assert.equal(sc.dataState, "measured");
  assert.deepEqual(sc.symbolCoverage.requested, ["$$$", "SOLUSDT"]);
  assert.deepEqual(sc.symbolCoverage.returned, []);
  assert.deepEqual(sc.symbolCoverage.notReturned, ["$$$", "SOLUSDT"]);
  assert.equal(sc.symbolCoverage.conservationSatisfied, true);
  assert.equal(sc.notReturned.find((row: any) => row.symbol === "$$$")?.reasonCode, "MALFORMED_SYMBOL");
  assert.equal(sc.notReturned.find((row: any) => row.symbol === "SOLUSDT")?.reasonCode, "UNSUPPORTED_OR_NOT_RETURNED");
});

test("one symbol omitted upstream becomes PARTIAL and is never silently discarded", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      dataState: "measured",
      requested: ["BTCUSDT", "ETHUSDT"],
      data: [{ symbol: "BTCUSDT", verdict: { direction: "neutral", confidence: 0.4, uncertainty: 0.6 } }],
    },
    content: [],
  } as any, { detail: "brief" });
  const sc = out.structuredContent as any;
  assert.equal(sc.responseState, "PARTIAL");
  assert.deepEqual(sc.symbolCoverage, {
    requested: ["BTCUSDT", "ETHUSDT"],
    returned: ["BTCUSDT"],
    withheld: [],
    notReturned: ["ETHUSDT"],
    projectedOut: [],
    requestScope: "explicit",
    conservationSatisfied: true,
    fullyReturned: false,
  });
  assert.equal(sc.notReturned[0].reasonCode, "UNSUPPORTED_OR_NOT_RETURNED");
  assert.match((out.content as any[])[0].text, /PARTIAL/);
});

test("stale flags, stale dataState, and numeric freshness windows all withhold the reading", () => {
  const stalePayloads = [
    { stale: true, data: [{ symbol: "BTCUSDT" }] },
    { dataState: "stale", data: [{ symbol: "BTCUSDT" }] },
    { dataAgeHours: 7, staleAfterHours: 6, data: [{ symbol: "BTCUSDT" }] },
    { freshness: { dataAgeHours: 7, staleAfterHours: 6 }, data: [{ symbol: "BTCUSDT" }] },
  ];
  for (const payload of stalePayloads) {
    const out = decorateForAgent("fahali_get_market_verdict", { structuredContent: payload, content: [] } as any);
    const sc = out.structuredContent as any;
    assert.equal(sc.responseState, "WITHHELD", JSON.stringify(payload));
    assert.equal(sc.dataState, "stale", JSON.stringify(payload));
    assert.equal(sc.absence.kind, "stale", JSON.stringify(payload));
    assert.match((out.content as any[])[0].text, /stale/i);
  }
});

test("zero findings with explicit measured coverage are not mislabeled as no coverage", () => {
  const out = decorateForAgent("fahali_get_market_snapshot", {
    structuredContent: { status: "ok", dataState: "measured", count: 0, assets: [], indices: [] },
    content: [],
  } as any);
  const sc = out.structuredContent as any;
  assert.deepEqual(
    [sc.responseState, sc.dataState, sc.absence.kind],
    ["OK_NO_FINDINGS", "measured", "measured_empty"],
  );
  assert.doesNotMatch((out.content as any[])[0].text, /NO_COVERAGE/);
});

test("a source failure remains an error even when the route supplies an empty collection", () => {
  const out = decorateForAgent("fahali_get_market_snapshot", {
    structuredContent: {
      status: "error",
      dataState: "error",
      error: { code: "DATABASE_TIMEOUT", message: "Market snapshot query timed out." },
      assets: [],
      indices: [],
    },
    content: [],
  } as any);
  const sc = out.structuredContent as any;
  assert.equal(out.isError, true);
  assert.equal(sc.responseState, "ERROR");
  assert.equal(sc.dataState, "error");
  assert.equal(sc.absence.kind, "source_error");
  assert.equal(sc.error.code, "SOURCE_ERROR");
  assert.match(sc.error.message, /timed out/i);
  assert.match((out.content as any[])[0].text, /^# Fahali /);
  assert.match((out.content as any[])[0].text, /no market conclusion was produced/i);
});

test("auth expiry, OAuth scope denial, and subscription-tier denial remain distinct", () => {
  const expired = decorateForAgent("fahali_get_market_snapshot", {
    isError: true,
    structuredContent: {
      error: "AUTH_EXPIRED",
      message: "The OAuth access token expired. Refresh it before retrying this workflow.",
      retryable: true,
      requestId: "req_expired",
    },
    content: [{ type: "text", text: "## AUTH_EXPIRED\n\nRefresh the token." }],
  } as any);
  const ex = expired.structuredContent as any;
  assert.equal(ex.error.code, "AUTH_EXPIRED");
  assert.equal(ex.error.retryable, true);
  assert.equal(ex.error.requestId, "req_expired");
  assert.equal(ex.absence.kind, "auth_failure");
  assert.ok(ex.error.reauthUrl);

  const scope = decorateForAgent("fahali_get_portfolio_metrics", {
    isError: true,
    structuredContent: {
      error: "AUTH_SCOPE",
      message: "The token lacks the required read:portfolio scope.",
      retryable: false,
      requiredScopes: ["read:portfolio"],
      grantedScopes: ["read:market"],
      requestId: "req_scope",
    },
    content: [{ type: "text", text: "## AUTH_SCOPE\n\nReconnect with portfolio scope." }],
  } as any);
  const so = scope.structuredContent as any;
  assert.equal(so.error.code, "AUTH_SCOPE");
  assert.deepEqual(so.error.requiredScopes, ["read:portfolio"]);
  assert.deepEqual(so.error.grantedScopes, ["read:market"]);
  assert.equal(so.absence.kind, "auth_failure");

  const tier = decorateForAgent("fahali_watch_portfolio", {
    isError: true,
    structuredContent: {
      error: "ENTITLEMENT_REQUIRED",
      message: "This tool requires the elite tier.",
      requiredTier: "elite",
      upgrade: { plan: "Elite", url: "https://app.fahaliai.com/pricing" },
    },
    content: [{ type: "text", text: '{"error":"ENTITLEMENT_REQUIRED","status":403}' }],
  } as any);
  const ti = tier.structuredContent as any;
  assert.equal(ti.error.code, "ENTITLEMENT_REQUIRED");
  assert.equal(ti.error.requiredTier, "elite");
  assert.deepEqual(ti.error.upgrade, { plan: "Elite", url: "https://app.fahaliai.com/pricing" });
  assert.equal(ti.absence.kind, "entitlement_required");
  assert.equal(ti.error.reauthUrl, undefined, "a plan upgrade is not an OAuth refresh");

  for (const result of [expired, scope, tier]) {
    const text = (result.content as any[])[0].text;
    assert.match(text, /^# Fahali /);
    assert.match(text, /no market conclusion was produced/i);
    assert.doesNotMatch(text, /^\s*\{/);
  }
});

test("unresolved contradictory evidence stays visible but revokes binding authority", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      dataState: "measured",
      data: [{
        symbol: "BTCUSDT",
        verdict: { direction: "bullish", confidence: 0.71, uncertainty: 0.29, actionability: "ACTIONABLE" },
        canonical: {
          state: "WATCH",
          direction: "DOWNSIDE_SKEW",
          headline: "Short and long horizons disagree",
          conflict: true,
        },
      }],
    },
    content: [],
  } as any, { detail: "audit" });
  const sc = out.structuredContent as any;
  assert.equal(sc.responseState, "WITHHELD");
  assertNotBinding(sc.decision);
  assert.equal(sc.decision.actionability, "ABSTAIN");
  assert.equal(sc.decision.conflict, true);
  assert.equal(sc.decisionEligibility.status, "WITHHELD");
  assert.ok(sc.decisionEligibility.reasons.some((reason: any) => reason.code === "CANONICAL_CONFLICT_UNRESOLVED"));
  assert.deepEqual(sc.conflicts, [{
    issue: "Evidence sources disagree",
    resolution: "The conflict remains unresolved for binding use. Source observations remain audit evidence, but no direction is authorized.",
  }]);
  assert.equal(sc.data[0].verdict.direction, "bullish", "the disagreeing source was hidden instead of reconciled");
});

test("compact truncation is declared in both structuredContent and Markdown", () => {
  const requested = ["BTCUSDT", "ETHUSDT", "NVDA", "SPY"];
  const requestedOut = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      dataState: "measured",
      requested,
      data: requested.map((symbol) => ({ symbol, confidence: 0.8 })),
    },
    content: [],
  } as any, { detail: "brief" });
  const requestedSc = requestedOut.structuredContent as any;
  assert.equal(requestedSc.data.length, 4, "the compact default hid one explicitly requested symbol");
  assert.deepEqual(requestedSc.symbolCoverage.returned, requested);
  assert.deepEqual(requestedSc.symbolCoverage.notReturned, []);
  assert.equal(requestedSc.symbolCoverage.fullyReturned, true);
  assert.equal(requestedSc.responseControl.complete, true);
  assert.equal(requestedSc.responseControl.returnedLimit, 4, "the reported limit ignored the explicit request scope");

  const rows = Array.from({ length: 5 }, (_, index) => ({ symbol: `ASSET${index}`, confidence: 0.8 }));
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { dataState: "measured", count: rows.length, data: rows },
    content: [],
  } as any, { detail: "brief" });
  const sc = out.structuredContent as any;
  assert.equal(sc.data.length, 3);
  assert.equal(sc.responseControl.complete, false);
  assert.equal(sc.responseControl.truncated, true);
  assert.equal(sc.responseControl.omitted.data, 2);
  assert.match((out.content as any[])[0].text, /Completeness: partial projection; omitted 2 from data/i);

  const standard = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { dataState: "measured", count: rows.length, data: rows },
    content: [],
  } as any, { detail: "standard", limit: 2 });
  assert.match((standard.content as any[])[0].text, /## Completeness/);
  assert.match((standard.content as any[])[0].text, /`data`: 3 omitted/);

  const clamped = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      dataState: "measured",
      data: Array.from({ length: 120 }, (_, index) => ({ symbol: `CLAMP${index}`, confidence: 0.8 })),
    },
    content: [],
  } as any, { detail: "standard", limit: 999.9 });
  const clampedSc = clamped.structuredContent as any;
  assert.equal(clampedSc.data.length, 100);
  assert.equal(clampedSc.responseControl.returnedLimit, 100, "returnedLimit reported the raw, unapplied argument");
});

/**
 * The lead_time briefing, as production actually shipped it on 2026-08-22.
 *
 * `/api/track-record/lead-time` returns one row per (stratum, day). 229 rows
 * were only 12 distinct strata — a rolling window re-published daily. Rendering
 * the first N in payload order produced a briefing whose evidence was 3 strata,
 * 8 bullets of them the same one, while `headline` (the stratum the server
 * selects and the public site publishes) appeared nowhere.
 *
 * These fixtures keep the real shape: committee_verdict at recall 1.14% sits
 * ABOVE the headline stratum in payload order, exactly as it did live.
 */
const stratum = (engine: string, day: string, over: Record<string, unknown> = {}) => ({
  engine, day, horizon_tier: "24h", bar_regime: "crypto",
  precision_pct: 72.07, base_rate_pct: 61.23, recall_pct: 1.14,
  lead_median_hours: 18.11, publishable: true, ...over,
});

const LEAD_TIME_PAYLOAD = {
  status: "ok",
  headline: stratum("risk_intelligence", "2026-08-22", {
    horizon_tier: "48h", precision_pct: 71.44, base_rate_pct: 32.76,
    recall_pct: 26.84, lead_median_hours: 35.98,
  }),
  trackRecord: [
    stratum("canonical_verdict", "2026-07-20", { horizon_tier: "72h", recall_pct: 37.5 }),
    stratum("committee_verdict", "2026-07-31"),
    stratum("committee_verdict", "2026-07-30", { recall_pct: 1.16 }),
    stratum("committee_verdict", "2026-07-20", { recall_pct: 5.41 }),
    ...["2026-08-22", "2026-08-21", "2026-08-20", "2026-08-19", "2026-08-18",
        "2026-08-17", "2026-08-16", "2026-08-15"].map((d) => stratum("correlation", d, { recall_pct: 16.88 })),
  ],
};

test("the briefing leads with the stratum the server stands behind", () => {
  const md = buildAgentBriefing("fahali_get_lead_time", LEAD_TIME_PAYLOAD).markdown;
  const evidence = md.split("## Evidence")[1].split("##")[0];
  const bullets = evidence.split("\n").filter((l) => l.trim().startsWith("* "));

  assert.match(bullets[0], /THE STRATUM FAHALI STANDS BEHIND/, "headline is not the first evidence bullet");
  assert.match(bullets[0], /risk_intelligence/, "the first bullet is not the headline stratum");
  assert.match(bullets[0], /26\.84/, "the headline's own recall must travel with it");
});

test("a stratum re-published daily is ONE finding, not eight", () => {
  const md = buildAgentBriefing("fahali_get_lead_time", LEAD_TIME_PAYLOAD).markdown;
  const evidence = md.split("## Evidence")[1].split("##")[0];
  const correlationBullets = evidence
    .split("\n")
    .filter((l) => l.trim().startsWith("* ") && /correlation/.test(l) && !/collapsed/.test(l));
  assert.equal(correlationBullets.length, 1, "the same rolling stratum rendered as multiple independent findings");

  // And the collapse is DISCLOSED — silently dropping rows is its own defect.
  assert.match(evidence, /re-published on earlier days and are collapsed/, "rows vanished with no explanation");
  assert.match(evidence, /do not count or sum them/i);
});

test("row count is never presented as sample size when the rows repeat", () => {
  const md = buildAgentBriefing("fahali_get_lead_time", LEAD_TIME_PAYLOAD).markdown;
  const thesis = md.split("## The Core Thesis")[1].split("##")[0];
  assert.match(thesis, /distinct measurement strata/, "the thesis counts republished rows as readings");
  assert.match(thesis, /Do not sum them/i);
});

test("the low-recall committee row cannot crowd out the headline", () => {
  // The specific live failure: committee_verdict 72.07% at recall 1.14% was
  // bullet #2 and the headline was absent, under a directive telling the agent
  // it may quote the evidence verbatim.
  const md = buildAgentBriefing("fahali_get_lead_time", LEAD_TIME_PAYLOAD).markdown;
  const evidence = md.split("## Evidence")[1].split("##")[0];
  const iHead = evidence.indexOf("risk_intelligence");
  const iCommittee = evidence.indexOf("committee_verdict");
  assert.ok(iHead >= 0, "the headline stratum is missing from the evidence entirely");
  assert.ok(iCommittee < 0 || iHead < iCommittee, "a 1.14%-recall stratum is quoted above the headline");
  // Whenever a precision is quoted, its recall must be on the same line.
  for (const l of evidence.split("\n").filter((x) => /precision \d/.test(x))) {
    assert.match(l, /recall/, `precision quoted without recall: ${l.trim().slice(0, 90)}`);
  }
});

test("the Blind Spot names strata the gate removed, instead of reporting silence", () => {
  // The live defect: /api/track-record/lead-time selects WHERE publishable =
  // true, so 47 withheld strata never reached the renderer and the Blind Spot
  // said "nothing was flagged as missing" — reporting the FILTER's success as
  // the world's silence, inside the section built to prevent exactly that.
  const md = buildAgentBriefing("fahali_get_lead_time", {
    ...LEAD_TIME_PAYLOAD,
    withheld: {
      available: true,
      count: 2,
      strata: [
        { stratum: "dark_pool · 24h · crypto", effectiveSample: 36491, reason: "no positive base-rate lift (precision 9.76% vs base 21.06%)" },
        { stratum: "forecast_72h · 72h · crypto", effectiveSample: 0, reason: "no lead time (warned_events=0)" },
      ],
    },
  }).markdown;
  const blind = md.split("## The Blind Spot")[1].split("## Recommended")[0];

  assert.doesNotMatch(blind, /nothing was flagged as missing/i, "the all-clear line survived real withheld data");
  assert.match(blind, /dark_pool · 24h · crypto/, "a withheld stratum is not named");
  assert.match(blind, /NOT quotable/i, "the reader is not told these figures cannot be quoted");
  assert.match(blind, /UNMEASURED here, not as clean/i, "withheld must not read as clean");
  assert.match(blind, /Why they are withheld/, "the withholding reasons are not surfaced");
  assert.match(blind, /base-rate lift/, "the dominant reason family is not named");
});

test("a failed withheld lookup is reported as failed, never as nothing withheld", () => {
  const md = buildAgentBriefing("fahali_get_lead_time", {
    ...LEAD_TIME_PAYLOAD,
    withheld: { available: false, strata: [], reason: "the withheld-strata lookup failed, so this response cannot say what was held back — that is a failed check, not an all-clear" },
  }).markdown;
  const blind = md.split("## The Blind Spot")[1].split("## Recommended")[0];
  assert.match(blind, /failed check, not an all-clear/i);
  assert.doesNotMatch(blind, /nothing was flagged as missing/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// N1 — a composite's state is a function of its children, never a default.
//
// Measured in production 2026-08-27 against server 1.10.0: a bundle whose two
// requested views BOTH returned measured data shipped responseState
// "NO_COVERAGE" / dataState "no_data". readOrder puts responseState first and
// claimPolicy.absenceMeaning is unknown_not_safe, so a compliant agent threw
// away a measured regime read and a publishable stratum carried in the same
// payload. The flagship tool manufactured false absence.
//
// The cause was a shape mismatch, not the missing symbol scope it looked like:
// the adapter declared collections ["results","views"] while bundleResult emits
// `views` as an OBJECT (inspectCollections skips non-arrays) and objectFindings
// ["bundle"] against a payload with no `bundle` key. Nothing was ever inspected.
// ─────────────────────────────────────────────────────────────────────────────

const MEASURED_REGIME = {
  status: "ok",
  dataState: "measured",
  regimes: [{ symbol: "BTCUSDT", regime: "bearish", confidence: 0.71 }],
};
const MEASURED_LEAD_TIME = {
  status: "ok",
  dataState: "measured",
  headline: { stratum: "committee_verdict 24h crypto", publishable: true },
  trackRecord: [{ engine: "committee_verdict", horizonTier: "24h", publishable: true }],
};
const bundleOf = (over: Record<string, unknown>) => ({
  status: "ok",
  requestedViews: [] as string[],
  completedViews: [] as string[],
  failedViews: [] as unknown[],
  views: {} as Record<string, unknown>,
  ...over,
});

test("N1: a bundle whose views all returned measurements is a finding, not NO_COVERAGE", () => {
  const state = classifyAgentPayload("fahali_get_bundle", bundleOf({
    requestedViews: ["regime", "lead_time"],
    completedViews: ["regime", "lead_time"],
    views: { regime: MEASURED_REGIME, lead_time: MEASURED_LEAD_TIME },
  }));
  assert.equal(state.responseState, "OK_WITH_FINDINGS", "measured views classified as absence");
  assert.equal(state.dataState, "measured");
  assert.equal(state.absence, null);
});

test("N1: a bundle part measured and part failed is PARTIAL and NAMES what is missing", () => {
  const state = classifyAgentPayload("fahali_get_bundle", bundleOf({
    status: "partial",
    requestedViews: ["regime", "lead_time", "portfolio", "accounts"],
    completedViews: ["regime", "lead_time"],
    failedViews: [
      { view: "portfolio", error: "AUTH_SCOPE" },
      { view: "accounts", error: "AUTH_SCOPE" },
    ],
    views: { regime: MEASURED_REGIME, lead_time: MEASURED_LEAD_TIME },
  }));
  // The contract defines PARTIAL as "some requested scope returned and some did
  // not". This is that case, and it previously returned NO_COVERAGE.
  assert.equal(state.responseState, "PARTIAL");
  assert.equal(state.dataState, "partial", "an explicit source PARTIAL must remain partial at the MCP boundary");
  // An abstention that does not say WHICH view is missing leaves the agent
  // nothing to re-ask for. Naming them is the difference between a usable
  // partial answer and a dead end.
  assert.match(state.absence?.reason ?? "", /portfolio/);
  assert.match(state.absence?.reason ?? "", /accounts/);
  assert.match(state.absence?.reason ?? "", /unknown, not calm/i);
});

test("N1 NEGATIVE CONTROL: an all-failed bundle is an ERROR, never an absence of coverage", () => {
  // The caller's scope was fine; the calls failed. Reporting no_coverage here
  // blames the request for an outage, and is the mirror image of the bug being
  // fixed, so the fix must not reach for it.
  const state = classifyAgentPayload("fahali_get_bundle", bundleOf({
    status: "error",
    requestedViews: ["portfolio", "accounts"],
    failedViews: [{ view: "portfolio", error: "AUTH_SCOPE" }, { view: "accounts", error: "AUTH_SCOPE" }],
  }));
  assert.equal(state.responseState, "ERROR");
  assert.equal(state.dataState, "error");
  assert.equal(state.absence?.kind, "source_error");
});

test("N1 NEGATIVE CONTROL: a bundle whose views hold nothing still reports absence", () => {
  // Deriving state from children must not turn every bundle into a finding.
  const state = classifyAgentPayload("fahali_get_bundle", bundleOf({
    requestedViews: ["regime"],
    completedViews: ["regime"],
    views: { regime: { status: "DEGRADED", calculationStatus: "no_pool", regimes: [] } },
  }));
  assert.notEqual(state.responseState, "OK_WITH_FINDINGS");
  assert.equal(state.dataState, "no_data");
});

test("N1 NEGATIVE CONTROL: an unmapped view is unverified, not quietly counted as coverage", () => {
  const state = classifyAgentPayload("fahali_get_bundle", bundleOf({
    requestedViews: ["not_a_registered_view"],
    completedViews: ["not_a_registered_view"],
    views: { not_a_registered_view: { anything: [1, 2, 3] } },
  }));
  assert.equal(state.responseState, "NO_COVERAGE");
  assert.match(state.absence?.reason ?? "", /no registered response contract/i);
});

test("N1: every bundle view resolves to a tool that has a response contract", () => {
  // A view whose tool has no adapter classifies under the permissive default and
  // reads as coverage we cannot prove. index.ts derives its accepted-name set and
  // its dispatch-map TYPE from BUNDLE_VIEW_TOOLS, so drift there is a compile
  // error; the remaining way to break this is to name a tool that does not exist.
  for (const [view, tool] of Object.entries(BUNDLE_VIEW_TOOLS)) {
    assert.ok(
      Object.hasOwn(AGENT_ENDPOINT_ADAPTERS, tool),
      `bundle view '${view}' maps to '${tool}', which has no response contract`,
    );
  }
});

test("N1: the envelope publishes per-view states so an agent can re-ask for one view", () => {
  const out = decorateForAgent("fahali_get_bundle", {
    structuredContent: bundleOf({
      status: "partial",
      requestedViews: ["regime", "portfolio"],
      completedViews: ["regime"],
      failedViews: [{ view: "portfolio", error: "AUTH_SCOPE" }],
      views: { regime: MEASURED_REGIME },
    }),
    content: [],
  } as any, { detail: "audit" });
  const sc = out.structuredContent as any;
  const regime = sc.viewStates.find((v: any) => v.view === "regime");
  assert.equal(regime.responseState, "OK_WITH_FINDINGS");
  assert.equal(regime.dataState, "measured");
  assert.equal(regime.tool, "fahali_get_market_regime");
});

// ─────────────────────────────────────────────────────────────────────────────
// N2 — symbolCoverage and responseControl must not be able to disagree.
//
// Measured 2026-08-27: a 24-symbol market read projected to 3 rows reported
// symbolCoverage.fullyReturned true, notReturned [], conservationSatisfied true
// beside responseControl.omitted {data: 21}. An agent reading symbolCoverage —
// the block whose entire job is coverage — concluded it held a complete
// 24-symbol market read and would report on 21 verdicts it never received.
// ─────────────────────────────────────────────────────────────────────────────

const universeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ symbol: `SYM${i}`, confidence: 0.8 }));

test("N2: an unscoped read that projects rows away cannot claim full delivery", () => {
  const out = decorateForAgent("fahali_get_market_decision", {
    structuredContent: { dataState: "measured", data: universeRows(24) },
    content: [],
  } as any, { detail: "brief", limit: 3 });
  const sc = out.structuredContent as any;

  assert.equal(sc.data.length, 3);
  assert.equal(sc.symbolCoverage.requestScope, "universe");
  assert.equal(sc.symbolCoverage.fullyReturned, false, "3 of 24 rows shipped as full delivery");
  assert.equal(sc.symbolCoverage.returned.length, 3, "coverage counted rows the body does not carry");
  assert.equal(sc.symbolCoverage.projectedOut.length, 21, "21 dropped symbols had nowhere to be named");
  assert.equal(sc.responseControl.omitted.data, 21);
});

test("N2: the coverage block and the scope block reconcile by construction", () => {
  const out = decorateForAgent("fahali_get_market_decision", {
    structuredContent: { dataState: "measured", data: universeRows(24) },
    content: [],
  } as any, { detail: "brief", limit: 3 });
  const sc = out.structuredContent as any;
  // scope is source-side truth and stays pre-projection; symbolCoverage is
  // delivery. Two questions, so they may differ — but their answers must add
  // up, and that is what stops them drifting into contradiction again.
  assert.equal(
    sc.symbolCoverage.returned.length + sc.symbolCoverage.projectedOut.length,
    sc.scope.returnedSymbols.length,
    "returned + projectedOut must account for every symbol the source carried",
  );
  assert.equal(sc.symbolCoverage.conservationSatisfied, true);
});

test("N2 NEGATIVE CONTROL: fullyReturned stays true when nothing was dropped", () => {
  // The fix must not make fullyReturned permanently false — that is a different
  // lie in the opposite direction.
  const out = decorateForAgent("fahali_get_market_decision", {
    structuredContent: { dataState: "measured", data: universeRows(2) },
    content: [],
  } as any, { detail: "audit" });
  const sc = out.structuredContent as any;
  assert.equal(sc.symbolCoverage.fullyReturned, true);
  assert.deepEqual(sc.symbolCoverage.projectedOut, []);
});

test("N2 NEGATIVE CONTROL: fullyReturned is null, not true, when nothing is symbol-scoped", () => {
  // `[].every(...)` is true, so the old field could not be false on exactly the
  // call where the whole universe answered. A question that does not apply gets
  // null; it never gets the flattering answer.
  const out = decorateForAgent("fahali_get_lead_time", {
    structuredContent: {
      dataState: "measured",
      trackRecord: [{ engine: "committee_verdict", horizonTier: "24h", publishable: true }],
    },
    content: [],
  } as any, { detail: "audit" });
  const sc = out.structuredContent as any;
  assert.equal(sc.symbolCoverage.fullyReturned, null);
  assert.equal(sc.symbolCoverage.requestScope, "universe");
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-two re-audit, 2026-08-27 — N3, N5, N6, N7, M2.
// ─────────────────────────────────────────────────────────────────────────────

const auditRow = (symbol: string, confidence: number, abstain = true) => ({
  symbol,
  verdict: {
    direction: abstain ? "neutral" : "bearish",
    confidence,
    uncertainty: 0.2,
    forecastHorizon: "24h",
    severity: "moderate",
    urgencyScore: Math.round(confidence * 100) / 10,
    actionability: abstain ? "ABSTAIN" : "ACTIONABLE",
    ...(abstain ? { abstainReason: "Evidence was insufficient or the signals disagreed." } : {}),
  },
  reasoning: {
    toolsUsed: ["get_market_state", "analyze_dark_pool", "analyze_momentum"],
    missingSignals: ["order_flow", "funding"],
  },
});

const decorate = (tool: string, data: Record<string, unknown>, options: Record<string, unknown> = {}) =>
  decorateForAgent(tool, { structuredContent: data, content: [] } as any, options as any)
    .structuredContent as any;

const portfolioAuthorityRow = (
  status: "AVAILABLE" | "WITHHELD" | "ABSENT",
  overrides: Record<string, unknown> = {},
) => ({
  symbol: "BTCUSDT",
  claim: {
    kind: "observation",
    basis: "measured",
    action: "reduce",
  },
  recommendation: {
    action: "reduce",
    rationale: "Alert density put BTCUSDT in the highest monitoring band.",
    binding: false,
    directional: false,
    deprecatedSemantics: "monitoring_priority_only",
  },
  authorityReconciliation: {
    directionAuthority: {
      authority: "canonical_symbol_verdict",
      status,
      canonicalState: status === "AVAILABLE" ? "WATCH" : status === "WITHHELD" ? "WITHHOLD" : null,
      direction: status === "AVAILABLE" ? "UPSIDE_SKEW" : null,
      headline: status === "AVAILABLE" ? "Watch — upside skew" : null,
      reliability: status === "AVAILABLE" ? "MEDIUM" : null,
      conflict: false,
      policyVersion: "vp2-test",
      reason: status === "AVAILABLE"
        ? null
        : status === "WITHHELD"
          ? "The canonical arbiter withheld its judgment."
          : "No canonical symbol verdict was available.",
      ...overrides,
    },
    portfolioActionability: {
      state: "WITHHELD",
      action: null,
      mandateApplied: false,
      bindingSurface: "fahali_get_portfolio_decision",
    },
  },
});

test("portfolio authority AVAILABLE supplies direction while monitoring remains non-binding", () => {
  const sc = decorate("fahali_analyze_custom_portfolio", {
    dataState: "measured",
    portfolio: { overallRiskScore: 0.8 },
    positions: [portfolioAuthorityRow("AVAILABLE")],
  });

  assert.equal(sc.decision.state, "WATCH");
  assert.equal(sc.decision.direction, "UPSIDE_SKEW");
  assert.equal(sc.decision.headline, "Watch — upside skew");
  assert.equal(sc.decision.actionability, null);
  assert.equal(sc.decision.directionAuthority, "canonical_symbol_verdict");
  assert.equal(sc.decision.directionAuthorityStatus, "AVAILABLE");
  assert.equal(sc.decision.portfolioActionability, "WITHHELD");
  assert.equal(sc.decision.binding, false);
  assert.equal(sc.decision.bindingSurface, "fahali_get_portfolio_decision");
  assert.equal(sc.decision.decisionState, "canonical_direction_available");
  assert.notEqual(sc.decision.headline, "Alert density put BTCUSDT in the highest monitoring band.");
});

test("portfolio authority WITHHELD cannot leak a direction from monitoring or an internal skew", () => {
  const sc = decorate("fahali_get_portfolio_risk", {
    dataState: "measured",
    portfolio: { overallRiskScore: 0.8 },
    positions: [portfolioAuthorityRow("WITHHELD", { direction: "DOWNSIDE_SKEW" })],
  });

  assert.equal(sc.decision.state, "WITHHOLD");
  // A LEAK guard, not a withhold guard — see assertDirectionAbsent. The row's
  // DOWNSIDE_SKEW must not become this response's direction: a portfolio-risk
  // reading is not a call on the market.
  assertDirectionAbsent(sc.decision);
  assert.equal(sc.decision.abstainReason, "The canonical arbiter withheld its judgment.");
  assert.equal(sc.decision.directionAuthorityStatus, "WITHHELD");
  assert.equal(sc.decision.portfolioActionability, "WITHHELD");
  assert.equal(sc.decision.decisionState, "canonical_direction_withheld");
  assert.equal(sc.decisionSelection.actionableAvailable, 0);
});

test("portfolio authority ABSENT stays withheld and never promotes compatibility recommendation prose", () => {
  const sc = decorate("fahali_analyze_custom_portfolio", {
    dataState: "measured",
    portfolio: { overallRiskScore: 0.8 },
    positions: [portfolioAuthorityRow("ABSENT")],
  });

  assert.equal(sc.decision.state, null);
  assertDirectionAbsent(sc.decision);
  assert.equal(sc.decision.headline, null);
  assert.equal(sc.decision.abstainReason, "No canonical symbol verdict was available.");
  assert.equal(sc.decision.directionAuthorityStatus, "ABSENT");
  assert.equal(sc.decision.portfolioActionability, "WITHHELD");
  assert.equal(sc.decision.decisionState, "canonical_direction_absent");
  assert.equal(sc.decisionSelection.actionableAvailable, 0);
});

test("N7: a market-wide headline is not the most confident ABSTENTION", () => {
  // N3 and N7 are the same bug. The source orders by urgency_score DESC, and
  // urgency_score is written as conf * 10 — so on a market read the promoted
  // decision was, by construction, the symbol Fahali was MOST certain it could
  // not judge. Live: "Withheld — not enough validated evidence on UPST", one
  // small-cap lender standing in for a 24-instrument market.
  const rows = [
    auditRow("UPST", 0.96), auditRow("CTKUSDT", 0.88), auditRow("ROBO", 0.83),
    auditRow("NVDA", 0.55, false),
  ];
  const sc = decorate("fahali_get_market_decision", { dataState: "measured", data: rows }, { detail: "brief" });
  assert.equal(sc.decisionSelection.selected, "NVDA", "the most confident abstention was promoted over a real call");
  assert.equal(sc.decision.actionability, "ABSTAIN", "a selected source call without binding eligibility must fail closed");
  assert.equal(sc.decisionSelection.among, 3, "selection is calculated from the final projected row set");
  assert.equal(sc.decisionSelection.sourceActionableAvailable, 1);
  assert.equal(sc.decisionSelection.actionableAvailable, 0);
  assert.equal(sc.decisionSelection.isAggregate, false);
  assert.match(sc.decisionSelection.note, /not a market-wide aggregate/i);
});

test("N7 NEGATIVE CONTROL: when every row abstains the headline still abstains", () => {
  // Preferring an actionable row is a selection among real rows. It must never
  // become a reason to manufacture one.
  const rows = [auditRow("UPST", 0.96), auditRow("CTKUSDT", 0.88)];
  const sc = decorate("fahali_get_market_decision", { dataState: "measured", data: rows }, { detail: "brief" });
  assert.equal(sc.decisionSelection.actionableAvailable, 0);
  assert.equal(sc.decision.actionability, "ABSTAIN");
  // Wording tightened 2026-08-27 to "all N readable rows abstain": the count now
  // excludes rows whose judgment this envelope cannot read, so saying plain "all N"
  // would overstate what was actually assessed. The substance under test is
  // unchanged — every assessed row abstains, and the note must say so.
  assert.match(sc.decisionSelection.note, /all 2 readable rows abstain/i);
  assert.match(sc.decisionSelection.note, /must not be read as a market-wide all-clear/i);
  assert.match(sc.decisionSelection.note, /must not be read as a market-wide all-clear/i);
});

test("N7: a single-row response says so rather than implying a ranking", () => {
  const sc = decorate("fahali_get_symbol_decision", { dataState: "measured", data: [auditRow("BTCUSDT", 0.7, false)] });
  assert.equal(sc.decisionSelection.basis, "single_row");
  assert.equal(sc.decisionSelection.among, 1);
});

test("N3: urgencyScore is labelled in confidenceSemantics, honestly, on an abstention", () => {
  // It was the one unlabelled number in an otherwise scrupulous payload, and it
  // is the field an agent sorts on.
  const sc = decorate("fahali_get_symbol_decision", { dataState: "measured", data: [auditRow("UPST", 0.96)] });
  const entry = sc.confidenceSemantics.find((e: any) => String(e.field).endsWith("urgencyScore"));
  assert.ok(entry, "urgencyScore is not registered in confidenceSemantics");
  assert.equal(entry.scoreType, "abstention_confidence_rescaled");
  assert.equal(entry.isProbability, false);
});

test("N5: a bare ticker is AMBIGUOUS, not partially resolved", () => {
  // BEAM is the exact case capabilities.instrumentIdentity.ambiguityRule was
  // written for — a crypto asset and an equity ticker sharing a string. The
  // server judged it and could not say which instrument it had judged.
  const sc = decorate("fahali_get_symbol_decision", { dataState: "measured", symbol: "BEAM", data: [auditRow("BEAM", 0.8)] });
  const beam = sc.instruments[0];
  assert.equal(beam.resolutionState, "ambiguous", "an unknown asset class read the same as a known-crypto-unknown-venue row");
  assert.equal(beam.resolutionBasis, "unresolved");
  assert.equal(beam.assetClass, null);
  // The old warning mentioned only venue; the missing asset class is the bigger
  // problem and is what the ambiguityRule is actually about.
  assert.match(beam.ambiguityWarning, /asset class is unresolved/i);
});

test("N5: a quote-suffix match is reported as a PARSE, not a lookup", () => {
  const sc = decorate("fahali_get_symbol_decision", { dataState: "measured", symbol: "CTKUSDT", data: [auditRow("CTKUSDT", 0.8)] });
  const ctk = sc.instruments[0];
  assert.equal(ctk.assetClass, "crypto");
  assert.equal(ctk.resolutionBasis, "quote_suffix_parse");
  assert.equal(ctk.resolutionState, "partial", "class known but venue unknown is 'partial', distinct from 'ambiguous'");
  assert.match(ctk.ambiguityWarning, /not from an instrument reference table/i);
});

test("N6: evidence counters read the shapes the payload actually carries", () => {
  // They reported 0 of every category while reasoning.toolsUsed named three
  // engines and missingSignals listed two — and missingEvidenceCount:0 was
  // wrong on its own terms.
  const sc = decorate("fahali_get_symbol_decision", { dataState: "measured", data: [auditRow("BEAM", 0.8)] });
  // 2026-10-06: a consulted tool is not a measurement (analyze_dark_pool is a
  // bar-volume heuristic). Consulted is counted as consulted; measured unknown.
  assert.equal(sc.evidenceQuality.toolsConsultedCount, 3);
  assert.equal(sc.evidenceQuality.measuredEvidenceCount, null);
  assert.match(sc.evidenceQuality.measuredReason, /unknown, not zero/);
  assert.equal(sc.evidenceQuality.missingEvidenceCount, 2);
  assert.deepEqual(sc.evidenceQuality.countedFrom, ["reasoning.toolsUsed", "reasoning.missingSignals"]);
});

test("N6 NEGATIVE CONTROL: no evidence structure reports null, never zero", () => {
  // A confidently-zeroed count is worse than an absent one: it reads as a
  // measurement. This is the absence-renders-as-safety class, and the fix must
  // not simply move the zero somewhere else.
  const sc = decorate("fahali_get_market_regime", { dataState: "measured", regimes: [{ regime: "bearish" }] });
  assert.equal(sc.evidenceQuality.measuredEvidenceCount, null);
  assert.equal(sc.evidenceQuality.missingEvidenceCount, null);
  assert.match(sc.evidenceQuality.reason, /unknown — not zero/i);
});

test("M2: freshness is normalized to one unit whatever the source used", () => {
  // One bundle carried dataAgeSeconds on the regime view and dataAgeHours on
  // the lead-time view, inviting a consumer to compare 41 against 3.
  const hours = decorate("fahali_get_market_regime", {
    dataState: "measured", regimes: [{ regime: "bearish" }], dataAgeHours: 3, staleAfterHours: 48,
  });
  assert.equal(hours.freshnessNormalized.unit, "seconds");
  assert.equal(hours.freshnessNormalized.dataAgeSeconds, 10_800);
  assert.equal(hours.freshnessNormalized.staleAfterSeconds, 172_800);
  assert.equal(hours.freshnessNormalized.sourceUnit, "hours");
  assert.equal(hours.freshnessNormalized.stale, false);
});

test("M2 NEGATIVE CONTROL: no freshness published reports unknown, not fresh", () => {
  const none = decorate("fahali_get_market_regime", { dataState: "measured", regimes: [{ regime: "bearish" }] });
  assert.equal(none.freshnessNormalized.known, false);
  assert.match(none.freshnessNormalized.reason, /unknown — not fresh/i);
});

// ── R2 + R3: projection must not bury the rows that carry a call ────────────

test("actionable rows survive truncation; abstentions are the ones dropped", () => {
  // The live shape: 24 judged, 16 actionable, and `brief` kept the first three
  // in SOURCE order — all abstentions — dropping every actionable row.
  const rows = [
    ...["UPST", "CTKUSDT", "ROBO"].map((symbol) => ({
      symbol, verdict: { direction: "neutral", actionability: "ABSTAIN" },
    })),
    ...["NEWTUSDT", "MTLUSDT", "IMXUSDT"].map((symbol) => ({
      symbol, verdict: { direction: "bearish", actionability: "ACTIONABLE" },
    })),
  ];
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { status: "ok", data: rows },
    content: [{ type: "text", text: "x" }],
  } as any, { detail: "brief" });

  const sc = out.structuredContent as any;
  const returned = sc.data.map((r: any) => r.symbol);
  assert.equal(returned.length, 3);
  assert.deepEqual(returned, ["NEWTUSDT", "MTLUSDT", "IMXUSDT"],
    "the three surviving rows must be the three carrying a call");
  assert.equal(sc.responseControl.ordering, "actionable_first");
  assert.match(sc.responseControl.orderingNote, /never dropped in favour of an abstention/);
});

test("the promoted decision is inside the payload it heads", () => {
  // R2: decisionSelection named NEWTUSDT and NEWTUSDT was in projectedOut. An
  // agent was told to "read data[] for the rest" and data[] lacked the one row
  // the headline was about.
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => ({
      symbol: `AB${i}USDT`, verdict: { direction: "neutral", actionability: "ABSTAIN" },
    })),
    { symbol: "NEWTUSDT", verdict: { direction: "bullish", actionability: "ACTIONABLE" } },
  ];
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { status: "ok", data: rows },
    content: [{ type: "text", text: "x" }],
  } as any, { detail: "brief" });

  const sc = out.structuredContent as any;
  assert.equal(sc.decisionSelection.selected, "NEWTUSDT");
  assert.equal(sc.data[0].symbol, "NEWTUSDT", "the promoted row must lead the payload");
  assert.ok(
    !(sc.symbolCoverage.projectedOut ?? []).includes("NEWTUSDT"),
    "the promoted row must never be projected out of its own response",
  );
});

test("ordering is reported as 'source' when nothing was re-ranked", () => {
  const rows = ["A", "B"].map((symbol) => ({
    symbol, verdict: { direction: "bearish", actionability: "ACTIONABLE" },
  }));
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { status: "ok", data: rows },
    content: [{ type: "text", text: "x" }],
  } as any, { detail: "brief" });
  const sc = out.structuredContent as any;
  assert.equal(sc.responseControl.ordering, "source");
  assert.deepEqual(sc.responseControl.reorderedPaths, []);
});

test("non-decision collections keep their own meaningful order", () => {
  // Strata are ranked by the headline-selection rule. Re-ranking them would
  // silently change which stratum a reader sees first.
  const { rows, reordered } = prioritiseDecisionRows([
    { engine: "forecast_72h", publishable: true },
    { engine: "committee_verdict", publishable: true },
  ]);
  assert.equal(reordered, false);
  assert.equal((rows[0] as any).engine, "forecast_72h");
});

// ── R4: envelope freshness derives from the whole body ─────────────────────

test("freshness is the WORST case across every contributing source", () => {
  // Live: views.regime published dataAgeSeconds 69 and views.lead_time
  // dataAgeHours 1.4, and the envelope reported "no freshness window".
  const out = decorateForAgent("fahali_get_bundle", {
    structuredContent: {
      status: "ok",
      views: {
        regime: { status: "ok", dataAgeSeconds: 69, staleAfterSeconds: 1800, regime: "bearish" },
        lead_time: { status: "ok", dataAgeHours: 1.4, staleAfterHours: 36, headline: { engine: "x" } },
      },
      completedViews: ["regime", "lead_time"],
    },
    content: [{ type: "text", text: "x" }],
  } as any);

  const f = (out.structuredContent as any).freshnessNormalized;
  assert.equal(f.known, true, "both children published a window — the parent cannot claim ignorance");
  assert.equal(f.dataAgeSeconds, Math.round(1.4 * 3600), "age is the OLDEST source, not the freshest");
  assert.equal(f.staleAfterSeconds, 1800, "the window is the TIGHTEST source's");
  assert.equal(f.basis, "worst_case_across_sources");
  assert.equal(f.sourceUnit, "mixed");
  assert.match(f.note, /does not make an older one current/);
});

test("a body with no freshness anywhere still says unknown, not fresh", () => {
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: { status: "ok", data: [{ symbol: "BTCUSDT", verdict: { direction: "bearish" } }] },
    content: [{ type: "text", text: "x" }],
  } as any);
  const f = (out.structuredContent as any).freshnessNormalized;
  assert.equal(f.known, false);
  assert.equal(f.contributingSources, 0);
  assert.match(f.reason, /unknown — not fresh/);
});

test("a source-resolved instrument is never backfilled into a contradiction", () => {
  // BEAM arrived resolved (NASDAQ, real name, canonical id) with a null
  // ambiguityWarning — correctly null, nothing is ambiguous. Backfill then
  // pulled this module's parse-derived warning in beside it and the entry
  // shipped "Asset class is UNRESOLVED for BEAM. Venue is missing." next to a
  // populated venue.
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      status: "ok",
      instruments: [{
        symbol: "BEAM", canonicalId: "nasdaq:equity:BEAM",
        displayName: "Beam Therapeutics Inc.", assetClass: "equity", venue: "NASDAQ",
        quoteCurrency: "USD", resolutionState: "resolved",
        resolutionBasis: "venue_asset_list", ambiguityWarning: null,
      }],
      data: [{ symbol: "BEAM", verdict: { direction: "unknown", actionability: "ABSTAIN" } }],
    },
    content: [{ type: "text", text: "x" }],
  } as any);

  const beam = (out.structuredContent as any).instruments.find((i: any) => i.symbol === "BEAM");
  assert.equal(beam.resolutionState, "resolved");
  assert.equal(beam.venue, "NASDAQ");
  assert.equal(beam.ambiguityWarning, null,
    "a resolved instrument must not acquire an ambiguity warning from the fallback parse");
});

test("an UNresolved instrument is still enriched by the parse", () => {
  // The backfill still has a job: it exists to help a source that could not
  // answer. Only a source that DID answer is left alone.
  const out = decorateForAgent("fahali_get_market_verdict", {
    structuredContent: {
      status: "ok",
      instruments: [{ symbol: "BTCUSDT", resolutionState: "ambiguous", assetClass: null }],
      data: [{ symbol: "BTCUSDT", verdict: { direction: "bearish", actionability: "ACTIONABLE" } }],
    },
    content: [{ type: "text", text: "x" }],
  } as any);
  const btc = (out.structuredContent as any).instruments.find((i: any) => i.symbol === "BTCUSDT");
  assert.equal(btc.assetClass, "crypto", "the parse must still fill what the source left unknown");
});

test("engine board absence is earned: a null or empty board is never a finding and never an adapterGap", () => {
  const nullBoard = {
    status: "partial", engine: "fall_warning_8h", asOf: "2026-10-12T07:00:00.000Z", dataState: "no_data",
    roster: { value: { display_name: "x" } },
    board: { value: null, reason: "board_missing:engine_off_or_not_published" },
    record: { strata: { value: null, reason: "no_judged_rows_yet" }, grade: { value: null, reason: "no_judged_rows_yet" } },
    boardAgeSeconds: null,
  };
  const emptyBoard = { ...nullBoard, status: "ok", dataState: "measured", board: { value: { as_of: 1, symbols: {} } } };
  for (const tool of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    for (const payload of [nullBoard, emptyBoard]) {
      const state = classifyAgentPayload(tool, payload as any);
      assert.notEqual(state.responseState, "OK_WITH_FINDINGS", `${tool}: ${JSON.stringify(state)}`);
      assert.equal((state as any).adapterGap, undefined, `${tool} must not report an adapterGap over an earned absence`);
    }
  }
});

test("engine board: findings are only standing/in_progress entries with a finite probability", () => {
  const quietOnly = envelopeOf(boardOf({ ETHUSDT: QUIET_ENTRY, SOLUSDT: { ...STANDING_ENTRY, symbol: "SOLUSDT", p: null } }, []));
  const nullP = envelopeOf(boardOf({ SOLUSDT: { ...STANDING_ENTRY, symbol: "SOLUSDT", p: null } }, []));
  for (const tool of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    for (const payload of [quietOnly, nullP]) {
      const state = classifyAgentPayload(tool, payload as any);
      assert.deepEqual([state.responseState, state.dataState, state.absence?.kind], ["OK_NO_FINDINGS", "measured", "measured_empty"], tool);
      assert.equal((state as any).adapterGap, undefined);
      const out = decorateForAgent(tool, { structuredContent: payload, content: [] } as any, { detail: "audit" }) as any;
      assert.deepEqual(out.structuredContent.findings, []);
    }
    const live = classifyAgentPayload(tool, ENGINE_BOARD_FIXTURE as any);
    assert.deepEqual([live.responseState, live.dataState], ["OK_WITH_FINDINGS", "measured"]);
    const out = decorateForAgent(tool, { structuredContent: ENGINE_BOARD_FIXTURE, content: [] } as any, { detail: "audit" }) as any;
    assert.deepEqual(out.structuredContent.findings.map((f: any) => f.symbol), ["BTCUSDT"]);
    assert.equal(out.structuredContent.findings[0].p, 0.12);
    assert.equal(out.structuredContent.findings[0].standing_id, "fw8-BTCUSDT-1760250000");
    assert.equal(out.structuredContent.decisionSelection?.actionableAvailable, 1, `${tool}: actionableAvailable must derive from the one live entry`);
  }
});

test("engine board: a requested symbol's entry is a finding only under the same rule", () => {
  const board = boardOf({ BTCUSDT: STANDING_ENTRY, ETHUSDT: QUIET_ENTRY }, [STANDING_ENTRY]);
  const quietSym = classifyAgentPayload("fahali_get_engine_board", envelopeOf(boardOf({ ETHUSDT: QUIET_ENTRY }, []), { symbol: { value: QUIET_ENTRY } }) as any);
  assert.equal(quietSym.responseState, "OK_NO_FINDINGS");
  const liveSym = classifyAgentPayload("fahali_get_engine_board", envelopeOf(board, { symbol: { value: STANDING_ENTRY } }) as any);
  assert.equal(liveSym.responseState, "OK_WITH_FINDINGS");
  const out = decorateForAgent("fahali_get_engine_board", { structuredContent: envelopeOf(boardOf({ ETHUSDT: QUIET_ENTRY }, []), { symbol: { value: STANDING_ENTRY } }), content: [] } as any, { detail: "audit" }) as any;
  assert.deepEqual(out.structuredContent.findings.map((f: any) => f.symbol), ["BTCUSDT"]);
});

test("engine board (R33): the derived claim is a Fahali-vocabulary forecast with every field from the roster and entry", () => {
  for (const tool of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    const out = decorateForAgent(tool, { structuredContent: ENGINE_BOARD_FIXTURE, content: [] } as any, { detail: "audit" }) as any;
    const claim = out.structuredContent.findings[0].claim;
    assert.equal(claim.kind, "forecast", tool);
    assert.equal(claim.engine, "fall_warning_8h");
    assert.equal(claim.claimType, "event_prob");
    assert.equal(claim.direction, "down");
    assert.equal(claim.horizonMin, 480);
    assert.equal(claim.truthCondition, "drawdown_5pct_v1");
    assert.equal(claim.probability, STANDING_ENTRY.p);
    assert.equal(claim.state, "standing");
    assert.equal(claim.standingId, STANDING_ENTRY.standing_id);
    assert.equal(claim.onsetAt, STANDING_ENTRY.onset_at);
    assert.equal(out.structuredContent.decisionSelection?.actionableAvailable, 1, tool);
  }
  // direction derives from the policy; an unknown policy is never guessed.
  for (const [policy, want] of [["up_only", "up"], ["both", null], ["sideways", null]] as const) {
    const env = { ...ENGINE_BOARD_FIXTURE, roster: { value: { ...FW8_ROSTER, direction_policy: policy } } };
    const out = decorateForAgent("fahali_get_engine_board", { structuredContent: env, content: [] } as any, { detail: "audit" }) as any;
    assert.equal(out.structuredContent.findings[0].claim.direction, want, policy);
  }
});

test("engine board (R33): another engine whose roster is not event_prob gets findings but NO claim and no actionable count", () => {
  const env = {
    ...ENGINE_BOARD_FIXTURE,
    engine: "other_engine",
    roster: { value: { ...FW8_ROSTER, display_name: "Other", claim_type: "direction", alert_type: "other" } },
  };
  const out = decorateForAgent("fahali_get_engine_board", { structuredContent: env, content: [] } as any, { detail: "audit" }) as any;
  assert.deepEqual(out.structuredContent.findings.map((f: any) => f.symbol), ["BTCUSDT"]);
  assert.equal(out.structuredContent.findings[0].claim, undefined);
  assert.equal(out.structuredContent.decisionSelection?.actionableAvailable ?? 0, 0);
});

test("engine board (R33): a null roster with a reason lists findings with no claim", () => {
  const env = { ...ENGINE_BOARD_FIXTURE, roster: { value: null, reason: "engine_not_in_roster" } };
  for (const tool of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    const out = decorateForAgent(tool, { structuredContent: env, content: [] } as any, { detail: "audit" }) as any;
    assert.deepEqual(out.structuredContent.findings.map((f: any) => f.symbol), ["BTCUSDT"], tool);
    assert.equal(out.structuredContent.findings[0].claim, undefined, tool);
    assert.equal(out.structuredContent.decisionSelection?.actionableAvailable ?? 0, 0, tool);
  }
});

test("engine board (R33): no engine label is ever a claim kind (negative control)", () => {
  const src = readFileSync(new URL("./agentPayload.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /kind:\s*"fall_warning"/, "a literal engine label is written as a claim kind");
  const fixtures = [
    ENGINE_BOARD_FIXTURE,
    envelopeOf(boardOf({ ETHUSDT: QUIET_ENTRY }, []), { symbol: { value: STANDING_ENTRY } }),
    { ...ENGINE_BOARD_FIXTURE, engine: "other_engine" },
  ];
  for (const tool of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    for (const env of fixtures) {
      const out = decorateForAgent(tool, { structuredContent: env, content: [] } as any, { detail: "audit" }) as any;
      for (const f of out.structuredContent.findings) assert.notEqual(f.claim?.kind, "fall_warning");
    }
  }
});
