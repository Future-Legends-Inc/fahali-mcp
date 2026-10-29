#!/usr/bin/env node
/**
 * ENVELOPE-INVARIANT SWEEP — every advertised tool, over TWO transports.
 *
 * `validate-schemas.mjs` asks "does this payload match its declared schema".
 * This asks the question that one cannot: **is what the envelope SAYS about the
 * payload true of the payload.** Schema conformance is satisfied by a response
 * that is confidently wrong — `scale: "0-1"` over values of 79 passes any
 * schema that types `scale` as a string.
 *
 * -- Two transports, and why both --------------------------------------------
 *
 *   endpoint  fetches each tool's declared `_meta.endpoint` from production
 *             with a demo token, then runs the payload through the real
 *             `decorateForAgent` IN THIS PROCESS.
 *   mcp       runs `dist/index.js --stdio` and speaks real MCP to it, so the
 *             payload goes through the real dispatch switch and the real
 *             decorate seam inside the BUILT artifact.
 *
 * Neither is redundant:
 *   - `endpoint` cannot prove `dispatchTool` routes a tool to the endpoint it
 *     advertises. `check-dispatch.mjs` greps for a `case` label, which a case
 *     calling the WRONG handler satisfies just as well.
 *   - `mcp` cannot isolate whether a fault is in the endpoint or in the MCP,
 *     and it cannot reach a tool whose endpoint is fine but whose dispatch is
 *     broken, because it never sees the endpoint directly.
 * Run both and they cross-check each other. Where both reach the same tool the
 * sweep COMPARES the envelopes and reports a DISAGREE — the one signal neither
 * transport can produce alone.
 *
 * An earlier version of this header claimed the run "ASSERTS that local
 * envelope == deployed envelope". It did not: no such check existed anywhere in
 * the file. The `mcp` transport is that assertion, actually implemented.
 *
 * -- Reading the report ------------------------------------------------------
 * Columns, never collapsed into one:
 *   CHECKED     a payload arrived and every invariant was evaluated
 *   FAILING     an invariant was violated
 *   DISAGREE    both transports reached it and the envelopes differ in SHAPE
 *   UNREACHABLE no payload on any attempted transport, so NOTHING was checked
 *   SKIPPED     deliberately not called (write tools)
 *   UNCOVERED   no transport can reach it (needs state no read path yields)
 * An unreachable tool is the failure mode this codebase keeps re-learning:
 * absence rendering as safety. It gets its own column so it can never read as
 * green.
 *
 *   node scripts/sweep-invariants.mjs
 *   node scripts/sweep-invariants.mjs --transport=endpoint   # or mcp, or both
 *   node scripts/sweep-invariants.mjs --json                 # machine-readable
 *
 * Exits non-zero if anything is FAILING. A DISAGREE does NOT exit non-zero: a
 * legitimate cause exists (the two calls are seconds apart and the market moves
 * under them), so it is a finding for a human to read, not a verdict.
 */
import { writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  INPUTS,
  SKIP_WRITE_TOOLS,
  CALLER_SCOPED_TOOLS,
  LOCAL_COMPOSED_TOOLS,
  NEEDS_LIVE_STATE_TOOLS,
  TRANSFORMING_TOOLS,
  NEVER_WRITE_TOOLS,
  WRITE_INPUTS,
} from "./tool-roster.mjs";
import { INVARIANTS } from "./envelope-invariants.mjs";
import { McpStdioClient } from "./mcp-stdio-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = process.env.FAHALI_API_URL || "https://app.fahaliai.com";
const OUT = join(__dirname, "..", ".sweep");
const JSON_MODE = process.argv.includes("--json");
const TRANSPORT_ARG = (process.argv.find((a) => a.startsWith("--transport=")) || "").split("=")[1] || "both";
const USE_ENDPOINT = TRANSPORT_ARG === "both" || TRANSPORT_ARG === "endpoint";
const USE_MCP = TRANSPORT_ARG === "both" || TRANSPORT_ARG === "mcp";
// OFF by default. On, the run performs real writes against production: it
// creates a portfolio watch (there is NO delete-watch tool, so one row per run
// persists), a subscription it deletes again, and one keyed memory it upserts.
// Run it deliberately before a release, not on every commit.
const WITH_WRITES = process.argv.includes("--with-writes");

// judgedRecord.ts and proxy.ts capture API_BASE at MODULE LOAD, defaulting to
// http://localhost:5000. Setting FAHALI_API_URL for the child MCP process was
// not enough: THIS process imports them too, so its `fetchJudgedRecord` hit
// localhost, failed, and returned `state: "unavailable"`. Every endpoint-side
// envelope then carried a dead record — `producerRecord.state: "unavailable"`
// on every decision — and the invariants passed over it without complaint.
// Only the cross-transport comparison caught it. Must precede the imports below.
process.env.FAHALI_API_URL = API;

/**
 * Is dist/ older than src/? The tool-count check further down cannot answer
 * this: it compares the running server's catalogue with TOOL_DEFINITIONS, and
 * BOTH are read from dist/. Two stale copies agree with each other perfectly.
 * Only the source timestamps can tell you the build is behind.
 */
function staleBuild() {
  const dir = join(__dirname, "..", "src");
  let newestSrc = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        newestSrc = Math.max(newestSrc, statSync(full).mtimeMs);
      }
    }
  };
  walk(dir);
  const built = statSync(join(__dirname, "..", "dist", "index.js")).mtimeMs;
  return newestSrc > built ? { newestSrc, built } : null;
}

const stale = staleBuild();
if (stale) {
  console.error(
    "ABORT: dist/ is older than src/. The mcp transport runs dist/index.js, so this run " +
      "would measure a build that predates the source. Run: npm run build",
  );
  process.exit(2);
}

// pathToFileURL, not a hand-rolled "file://" + separator swap: it is correct on
// Windows, correct for paths containing spaces, and — the reason it is here —
// it contains no backslash, which this shell's heredocs silently eat.
const dist = (f) => import(pathToFileURL(join(__dirname, "..", "dist", f)).href);
const { TOOL_DEFINITIONS } = await dist("tools.js");
const { decorateForAgent } = await dist("agentPayload.js");
const { fetchJudgedRecord, attachJudgedRecord } = await dist("judgedRecord.js");
const { responseOptions } = await dist("responseOptions.js");

// The seam production actually runs is decorateForAgent(name,
// attachJudgedRecord(result, record, name), responseOptions(args, auth)).
// An earlier version of this harness passed {} for the options and skipped
// attachJudgedRecord entirely, so it checked an envelope with no judged
// record, no auth block and no tier metadata on nextActions — a shape
// PRODUCTION NEVER EMITS. Thirty-six tools were reported green against it.
// This is the auth stdio mode binds, so the two transports are comparable.
const STDIO_AUTH = { credentialType: "process_key", expiresAt: null, refreshSupported: false };

async function demoToken() {
  const r = await fetch(`${API}/api/auth/demo-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`demo-token mint failed: HTTP ${r.status}`);
  const j = await r.json();
  const t = j.token || j.accessToken;
  if (!t) throw new Error("demo-token response carried no token");
  return t;
}

/**
 * THE CREDENTIAL THIS RUN SPEAKS WITH — and why it is read from the ENV only.
 *
 * 🔴 Nine tools have never been exercised by any automated check. Seven are
 * writes and two more need an id only a write can mint, so the whole autonomous
 * workflow — create a watch, evaluate it, read its delta, subscribe to risk —
 * is the LEAST verified surface in the product. The cause is not a missing
 * check: it is that this harness authenticates with a demo token, and
 * `requireNotDemo` refuses those writes on purpose
 * (`server/tests/demoCannotScheduleRecurringWork.test.ts`). The security control
 * is right; the coverage hole is real; both are true at once.
 *
 * So the credential is a parameter. `FAHALI_API_KEY` (a real `sk_live_`) makes
 * the write path reachable. It is read from the ENVIRONMENT and never from a
 * flag, because a flag lands in shell history — and an API key that leaves the
 * operator's machine is compromised the moment it does. It is never printed,
 * never written to `.sweep/`, and never committed. Default stays demo, which is
 * the safe run.
 *
 * The run REPORTS which credential it used. Without that, a demo run and a
 * real-account run produce the same "0 failing" line over very different
 * coverage — one number describing two different measurements is how a partial
 * verification gets read as a complete one.
 */
function credential() {
  const key = (process.env.FAHALI_API_KEY || "").trim();
  if (!key) return { kind: "demo", token: null };
  if (!/^sk_live_/.test(key)) {
    console.error("ABORT: FAHALI_API_KEY is set but is not an sk_live_ key. Refusing to send it.");
    process.exit(2);
  }
  return { kind: "api_key", token: key };
}

async function fetchPayload(tool, token) {
  const endpoint = tool._meta?.endpoint;
  if (!endpoint) return { error: "no _meta.endpoint declared" };
  const args = INPUTS[tool.name] || {};
  const usePost = Boolean(args.positions || args.narrative);
  const url = new URL(endpoint, API);
  if (!usePost) {
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null && typeof v !== "object") url.searchParams.set(k, String(v));
      else if (Array.isArray(v)) url.searchParams.set(k, v.join(","));
    }
  }
  try {
    const res = await fetch(url.toString(), {
      method: usePost ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(usePost ? { "Content-Type": "application/json" } : {}),
      },
      ...(usePost ? { body: JSON.stringify(args) } : {}),
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await res.text();
    let body = null;
    let parseFailed = false;
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        parseFailed = true;
      }
    }
    if (parseFailed) return { error: `HTTP ${res.status} non-JSON body (${raw.trim().slice(0, 40)}…)` };
    if (!res.ok) return { error: `HTTP ${res.status}: ${body?.error || body?.message || res.statusText}` };
    return { body };
  } catch (e) {
    return { error: `fetch failed: ${e.message}` };
  }
}
// ── Transport reachability ──────────────────────────────────────────────────
// Stated per transport rather than as one "covered" flag, because the two
// transports fail on DIFFERENT tools and collapsing that loses the reason.

/** The endpoint transport fetches a URL, so it cannot reach a tool without one. */
function endpointCannotReach(tool) {
  const ep = tool._meta?.endpoint;
  if (!ep) return "no _meta.endpoint declared";
  if (SKIP_WRITE_TOOLS.has(tool.name)) {
    // A write is performed ONCE, through the real dispatch, or not at all.
    // Doing it twice to compare transports would double every row it leaves.
    return "write tool — performed once, through the mcp transport only";
  }
  if (TRANSFORMING_TOOLS.has(tool.name)) {
    // Not a limitation of the transport — a category error if attempted.
    // `_meta.endpoint` names the SOURCE, and this handler reshapes it, so the
    // fetched payload is one the tool never returns. Checking an envelope over
    // it would measure something no agent receives.
    return "handler reshapes the payload — the declared endpoint is its source, not its shape";
  }
  if (ep.startsWith("local://")) return "composed in-process — there is no endpoint to fetch";
  if (ep.includes("{")) return `endpoint has a path parameter (${ep}) that needs live state`;
  return null;
}

/** The MCP transport dispatches by name, so it reaches anything with valid args. */
function mcpCannotReach(tool) {
  if (NEEDS_LIVE_STATE_TOOLS.has(tool.name)) {
    // Reachability follows the ids this run actually HOLDS, not which flag was
    // passed. The prefetch below asks the id-yielding READ tools first, so an
    // ordinary run reaches these whenever the caller has any state at all.
    const resolved = resolveWriteArgs(tool.name);
    if (resolved.args) return null;
    // Name the missing id AND whose absence it is. "no read path yields an id"
    // was a claim about the PRODUCT and it was false; "this credential holds no
    // such state" is a claim about the caller, and only that one is true.
    return `${resolved.missing} — this credential holds no such state, so the populated path is unswept`;
  }
  return null;
}

/**
 * Structural comparison of two envelopes: the set of key PATHS, with array
 * indices collapsed so a differing element count is not a differing shape.
 *
 * Deliberately value-blind. The two transports call seconds apart and the
 * market moves under them, so comparing values would report drift as fault on
 * every run. What this catches is the fault worth catching: one transport
 * producing a field the other does not, which is what a mis-wired dispatch case
 * or a diverging decorate path looks like.
 */
function skeleton(node, path = "$", depth = 0, out = new Set()) {
  if (depth > 6 || node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    // UNION over every element, not element [0]. Sampling the first one made
    // the comparator manufacture its own findings: two calls to a live market
    // return `nextActions` in a different order, so "the first element has
    // args" describes which element sorted first, not the response. Capped
    // because an unbounded union on a large collection is slow, not because
    // 40 is meaningful.
    for (const item of node.slice(0, 40)) skeleton(item, path + "[]", depth + 1, out);
    return out;
  }
  for (const k of Object.keys(node)) {
    const p = path + "." + k;
    out.add(p);
    skeleton(node[k], p, depth + 1, out);
  }
  return out;
}

/**
 * What an AGENT receives, not what this process holds.
 *
 * The MCP transport's envelope has crossed a wire and is therefore already
 * JSON-normalised. The endpoint transport's has not, and the difference is not
 * cosmetic: `nextActions` entries come from `R = (tool, why, args) => ({ tool,
 * why, args })`, so calling it with two arguments leaves an `args` KEY holding
 * `undefined`. `Object.keys` sees it; `JSON.stringify` drops it. Comparing the
 * two directly reported `nextActions[].args` as an endpoint-only field on most
 * tools — a difference no agent could ever observe, produced entirely by the
 * instrument. Round-tripping puts both readings on the wire's terms.
 */
const asWire = (env) => JSON.parse(JSON.stringify(env ?? {}));

/**
 * What the proxy's `okResult` does to a payload before it is decorated: an
 * object passes through, anything else (an ARRAY, most often) is wrapped as
 * `{ data }`. Skipping this made the two transports disagree on every
 * list-returning tool for a reason that was purely the harness's.
 */
const asStructured = (data) =>
  data && typeof data === "object" && !Array.isArray(data) ? data : { data };

// ── Live state minted BY the run, for the tools that need it ────────────────
const liveState = {};

/**
 * 🔴 IDEMPOTENCY KEYS MUST BE PER-RUN, AND THE SERVER IS RIGHT TO REFUSE OTHERWISE.
 *
 * These were stable strings for one commit. That works exactly once. The walk
 * CREATES the watch and then MUTATES it (`update_portfolio_watch`), so on the
 * next run the server answers the replayed create with:
 *
 *   idempotent_resource_superseded — "The original mutation was applied once,
 *   but the resource changed later. Read its current state instead of replaying
 *   an obsolete mutation response."
 *
 * That is correct API behaviour, not a bug to work around: replaying a create
 * whose resource has since changed would hand back an obsolete response. A
 * stable key is only safe for a request the harness never mutates afterwards,
 * and this one mutates it two tools later.
 *
 * Seeded here rather than written into WRITE_INPUTS because `resolveWriteArgs`
 * substitutes a WHOLE value that begins with `$` — it does no interpolation, so
 * "envelope-sweep-watch-$runId" would be sent literally.
 *
 * ⚠️ Consequence, deliberately accepted: each run creates a NEW watch and leaves
 * it active. Retire them periodically, or the harness accrues evaluated watches.
 */
const RUN_ID = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
liveState.watchIdemKey = `envelope-sweep-watch-${RUN_ID}`;
liveState.watchUpdateIdemKey = `envelope-sweep-watch-update-${RUN_ID}`;
liveState.subIdemKey = `envelope-sweep-sub-${RUN_ID}`;
liveState.subUpdateIdemKey = `envelope-sweep-sub-update-${RUN_ID}`;
liveState.subDeleteIdemKey = `envelope-sweep-sub-delete-${RUN_ID}`;

/** Substitute $watchId / $subscriptionId / $verdictId, or report what is absent. */
function resolveWriteArgs(name) {
  const spec = WRITE_INPUTS[name];
  if (!spec) return { args: null, missing: "no WRITE_INPUTS entry" };
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (typeof v === "string" && v.startsWith("$")) {
      const key = v.slice(1);
      // Never substitute a synthetic id. A fabricated uuid is correctly rejected
      // with a 400, which would measure the validator and report a green run.
      if (!liveState[key]) return { args: null, missing: `${key} was never minted by this run` };
      out[k] = liveState[key];
    } else out[k] = v;
  }
  return { args: out, missing: null };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Pull the ids a later tool will need out of the envelope that just arrived. */
function captureState(name, envelope) {
  if (!envelope) return;
  const findId = (...keys) => {
    let found = null;
    const seek = (node) => {
      if (found || !node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(seek);
      for (const [k, v] of Object.entries(node)) {
        if (found) return;
        if (keys.includes(k) && typeof v === "string" && UUID.test(v)) { found = v; return; }
        seek(v);
      }
    };
    seek(envelope);
    return found;
  };
  if (name === "fahali_watch_portfolio") liveState.watchId ??= findId("watch_id", "watchId", "id");
  /**
   * Fallback that follows the server's own instruction. When a create IS
   * refused as `idempotent_resource_superseded`, the error says: "Read its
   * current state instead of replaying an obsolete mutation response." This
   * list call runs immediately after the create, so the walk recovers a
   * watchId rather than cascading ten tools into UNCOVERED behind one error.
   * `??=` keeps the create's own id authoritative when the create succeeded.
   */
  if (name === "fahali_list_portfolio_watches") {
    liveState.watchId ??= findId("watch_id", "watchId", "id");
    /**
     * THE SAME ENVELOPE CARRIES A VERDICT ID. Measured 2026-09-03: a live
     * `fahali_list_portfolio_watches` returned
     * `lastVerdictId: "67d9ec97-a8c8-4c42-a7b5-3544afb55b60"` beside the
     * watchId, and the payload's own `nextActions` hands both to the agent.
     * Capturing only the watchId here left `verdictId` to be minted by
     * `fahali_get_portfolio_decision`, which is why four tools reported
     * "requires an id that no read path yields" -- a claim this one read path
     * had already falsified.
     */
    liveState.verdictId ??= findId("lastVerdictId", "verdict_id", "verdictId", "currentVerdictId");
  }
  if (name === "fahali_subscribe_risk") liveState.subscriptionId ??= findId("subscription_id", "subscriptionId", "id");
  /**
   * 🔴 THERE WAS NO INCIDENT CAPTURE AT ALL (added 2026-09-03).
   *
   * `fahali_acknowledge_incident` and `fahali_get_incident_timeline` reported
   * "incidentId was never minted by this run" on every `--with-writes` run — and
   * that read as a product limitation. It was not. `fahali_get_active_incidents`
   * returned `count: 1` with a real `incidentId` in the same walk, seconds
   * earlier; nothing here ever looked at it.
   *
   * The key name is MEASURED from the saved envelope (`incidentId`, camelCase),
   * not guessed — which is the lesson the verdictId comment below was written to
   * record, applied before making the same mistake a third time.
   */
  if (name === "fahali_get_active_incidents") {
    liveState.incidentId ??= findId("incidentId", "incident_id");
  }
  if (name === "fahali_get_portfolio_decision") {
    // 🔴 This looked for "verdict_id"/"verdictId" ONLY and reported "never
    // minted" for an id the envelope carried in FIVE places: $.verdict.id,
    // $.watch.lastVerdictId, $.delta.currentVerdictId and two more. The harness
    // then published that as a product finding — "no read path yields a verdict
    // id" — which was false. A key-name guess is not a measurement; the same
    // mistake as matching a judged record on its DISPLAY LABEL.
    liveState.verdictId ??=
      findId("verdict_id", "verdictId", "currentVerdictId", "lastVerdictId") ??
      (envelope.verdict && typeof envelope.verdict === "object" &&
      UUID.test(String(envelope.verdict.id ?? ""))
        ? String(envelope.verdict.id)
        : null);
  }
}

function compareShapes(a, b) {
  const sa = skeleton(a);
  const sb = skeleton(b);
  const onlyEndpoint = [...sa].filter((p) => !sb.has(p));
  const onlyMcp = [...sb].filter((p) => !sa.has(p));
  return { onlyEndpoint, onlyMcp, differs: onlyEndpoint.length > 0 || onlyMcp.length > 0 };
}

// ── Run ─────────────────────────────────────────────────────────────────────
const cred = credential();
const token = cred.token ?? (await demoToken());
console.log(
  cred.kind === "api_key"
    ? "credential: FAHALI_API_KEY (sk_live_, from env) — write tools are reachable with --with-writes"
    : "credential: public demo token — requireNotDemo refuses every write; run with FAHALI_API_KEY set to cover them",
);
// Fetched ONCE and reused, exactly as the server's 5-minute cache does. A
// per-tool fetch would give different tools different records and make the
// record-dependent fields incomparable between transports.
const judgedRecord = await fetchJudgedRecord(token);
if (judgedRecord?.state === "unavailable") {
  // A harness that runs on a dead record still reports rows, and every one of
  // them is measured against an envelope that says "record unknown". That is a
  // degraded run wearing a passing run's clothes. Refuse instead.
  console.error(
    "ABORT: the judged record is unavailable, so every envelope would carry an " +
      "unavailable producer record and be checked in that state.",
  );
  console.error("  Reason: " + String(judgedRecord.reason ?? "not stated"));
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

let mcp = null;
if (USE_MCP) {
  mcp = new McpStdioClient({ apiKey: token, apiUrl: API });
  await mcp.initialize();
  const advertised = await mcp.listTools();
  // The built artifact and the module this process imported must advertise the
  // same population, or the sweep is checking one server and reporting on
  // another. This is the cheap version of the assertion the old header claimed.
  if (advertised.length !== TOOL_DEFINITIONS.length) {
    console.error(
      `ABORT: the running server advertises ${advertised.length} tools but the imported ` +
        `dist/tools.js declares ${TOOL_DEFINITIONS.length}. dist is stale — run npm run build.`,
    );
    mcp.close();
    process.exit(2);
  }
}

/**
 * PREFETCH THE ID-YIELDING READS, before anything that needs their output.
 *
 * The main loop walks TOOL_DEFINITIONS in advertised order, so whether
 * `fahali_list_portfolio_watches` happens to run before the four tools that
 * need a `watch_id` is an accident of roster ordering. Chaining that depends on
 * declaration order is chaining that breaks the next time a tool is added.
 *
 * Both calls are pure reads and both are swept again in the main loop; this
 * pass exists only to populate `liveState`. A caller with no watches simply
 * captures nothing, and the dependents report UNCOVERED naming whose state is
 * absent — which is the honest answer, and a different one from "no read path
 * yields an id".
 */
const ID_YIELDING_READS = ["fahali_list_portfolio_watches", "fahali_get_active_incidents"];
if (USE_MCP) {
  for (const name of ID_YIELDING_READS) {
    if (!TOOL_DEFINITIONS.some((t) => t.name === name)) continue;
    try {
      const r = await mcp.callTool(name, INPUTS[name] || {});
      if (r.envelope) captureState(name, r.envelope);
    } catch {
      // Never fatal. A prefetch that cannot run leaves the dependents exactly
      // where they were, and the main loop still sweeps this tool on its own
      // turn and reports whatever happened there.
    }
  }
  const held = Object.entries(liveState).filter(([, v]) => v).map(([k]) => k);
  if (!JSON_MODE) {
    console.log(`prefetch: ${held.length ? `captured ${held.join(", ")}` : "no ids available to this credential"}`);
  }
}

const rows = [];
for (const tool of TOOL_DEFINITIONS) {
  let args = INPUTS[tool.name] || {};
  const isWrite = SKIP_WRITE_TOOLS.has(tool.name);

  if (NEVER_WRITE_TOOLS.has(tool.name)) {
    rows.push({
      tool: tool.name,
      state: "SKIPPED",
      note: "never swept at any flag — writes into the same `alerts` table the detection fleet writes to",
    });
    continue;
  }
  if (isWrite && !WITH_WRITES) {
    rows.push({ tool: tool.name, state: "SKIPPED", note: "write tool — pass --with-writes to include it" });
    continue;
  }
  if (WRITE_INPUTS[tool.name]) {
    // No longer gated on WITH_WRITES: a READ tool taking a path id needs its
    // args resolved on an ordinary run too. Real write tools never reach here —
    // SKIP_WRITE_TOOLS returned them above unless --with-writes was passed.
    const resolved = resolveWriteArgs(tool.name);
    if (!resolved.args) {
      rows.push({
        tool: tool.name,
        state: "UNCOVERED",
        note: `mcp: ${resolved.missing} — this credential holds no such state, so the populated path is unswept`,
      });
      continue;
    }
    args = resolved.args;
  }

  const epBlocked = endpointCannotReach(tool);
  const mcpBlocked = mcpCannotReach(tool);
  const envelopes = {};
  /**
   * The MARKDOWN a host actually renders to a person, saved beside the
   * envelope. Every invariant below reads `structuredContent`; a human reads
   * only this. The two CAN disagree — a payload can carry a complete reading
   * while the prose declines to state a call — and saving just one of them is
   * how that stays invisible.
   */
  let mcpText = null;
  const notes = [];
  const violations = [];

  if (USE_ENDPOINT && !epBlocked) {
    const { body, error } = await fetchPayload(tool, token);
    if (error) notes.push(`endpoint: ${error}`);
    else {
      try {
        const decorated = decorateForAgent(
          tool.name,
          attachJudgedRecord({ content: [], structuredContent: asStructured(body) }, judgedRecord, tool.name),
          responseOptions(args, STDIO_AUTH),
        );
        envelopes.endpoint = asWire(decorated.structuredContent);
      } catch (e) {
        notes.push(`endpoint: envelope threw: ${e.message}`);
      }
    }
  } else if (USE_ENDPOINT) {
    notes.push(`endpoint: ${epBlocked}`);
  }

  if (USE_MCP && !mcpBlocked) {
    const r = await mcp.callTool(tool.name, args);
    if (r.error) notes.push(`mcp: ${r.error}`);
    else if (r.isError) notes.push(`mcp: tool returned isError — ${String(r.text).slice(0, 120)}`);
    else if (!r.envelope) notes.push("mcp: result carried no structuredContent");
    else {
      envelopes.mcp = r.envelope;
      mcpText = r.text ?? "";
      // Capture on EVERY run. Reading ids out of an envelope that already
      // arrived is not a write, and gating it on --with-writes is what left the
      // read-only sweep reporting six tools UNCOVERED for want of ids that two
      // read paths were already returning.
      captureState(tool.name, r.envelope);
    }
  } else if (USE_MCP) {
    notes.push(`mcp: ${mcpBlocked}`);
  }

  const reached = Object.keys(envelopes);
  if (reached.length === 0) {
    // No transport produced a payload. WHY decides the column: a tool no
    // transport is able to address is UNCOVERED; a tool that should have
    // answered and did not is UNREACHABLE, which is a defect.
    //
    // 🔴 A REFUSAL BY DESIGN IS NOT A FAULT (2026-08-28).
    // This harness authenticates with a DEMO token. `requireNotDemo` gates every
    // mutating agent-monitoring route on purpose — an anonymous demo session must
    // not be able to schedule durable recurring work or point an outbound webhook
    // at an address it chooses (`server/tests/demoCannotScheduleRecurringWork.test.ts`).
    // So `ENTITLEMENT_REQUIRED` here is the SECURITY CONTROL WORKING, and filing it
    // as UNREACHABLE told a reader the write path was broken when it was defended.
    // It is structurally uncoverable by THIS harness — which is the honest column,
    // and it keeps UNREACHABLE meaning "should have answered and did not".
    const refusedByDesign = /ENTITLEMENT_REQUIRED|requireNotDemo|demo account/i.test(notes.join(" "));
    if (refusedByDesign) {
      rows.push({
        tool: tool.name,
        state: "UNCOVERED",
        note:
          `${notes.join(" · ")} — refused by design: a demo credential cannot perform this write ` +
          "(requireNotDemo). Sweeping it needs a real account, not a harness change.",
      });
      continue;
    }
    const structural = (!USE_ENDPOINT || epBlocked) && (!USE_MCP || mcpBlocked);
    rows.push({
      tool: tool.name,
      state: structural ? "UNCOVERED" : "UNREACHABLE",
      note: notes.join(" · "),
    });
    continue;
  }

  if (mcpText !== null) writeFileSync(join(OUT, `${tool.name}.text.md`), mcpText);

  for (const [transport, env] of Object.entries(envelopes)) {
    writeFileSync(join(OUT, `${tool.name}.${transport}.json`), JSON.stringify(env, null, 1));
    for (const [name, fn] of INVARIANTS) {
      for (const v of fn(env, args)) violations.push(`[${transport}][${name}] ${v}`);
    }
  }

  let disagreement = null;
  if (envelopes.endpoint && envelopes.mcp) {
    const cmp = compareShapes(envelopes.endpoint, envelopes.mcp);
    if (cmp.differs) disagreement = cmp;
  }

  rows.push({
    tool: tool.name,
    state: violations.length ? "FAILING" : disagreement ? "DISAGREE" : "CHECKED",
    transports: reached,
    callerScoped: CALLER_SCOPED_TOOLS.has(tool.name),
    /**
     * 🔴 MEASURED, because the caller-scoped note used to be printed from set
     * membership alone (2026-09-08). Every one of these tools was annotated
     * "empty is correct here" whether or not the payload was empty — and on a
     * run with a real API key, NINE OF ELEVEN came back full: 3 watches,
     * 5 subscriptions, 5 incidents, 20 verdicts, 2 accounts, 7 positions.
     * The report was stating a fact about a body it never opened, which is the
     * same defect class the columns above exist to catch.
     */
    rowsReturned: envelopes.mcp
      ? Object.entries(envelopes.mcp)
          .filter(([, v]) => Array.isArray(v) && v.length > 0)
          .reduce((n, [, v]) => n + v.length, 0)
      : null,
    dataState: envelopes.mcp?.dataState ?? null,
    violations,
    disagreement,
    note: notes.join(" · ") || undefined,
  });
}

if (mcp) {
  if (mcp.malformedFrames.length) {
    console.error(
      `\nPROTOCOL FAULT: the server wrote ${mcp.malformedFrames.length} non-JSON line(s) to stdout. ` +
        "stdout is the frame channel; anything else corrupts every host session.\n  " +
        mcp.malformedFrames.slice(0, 3).join("\n  "),
    );
  }
  mcp.close();
}

// ── Report ──────────────────────────────────────────────────────────────────
const count = (s) => rows.filter((r) => r.state === s).length;
const summary = {
  total: TOOL_DEFINITIONS.length,
  transports: TRANSPORT_ARG,
  checked: count("CHECKED"),
  failing: count("FAILING"),
  disagree: count("DISAGREE"),
  unreachable: count("UNREACHABLE"),
  skipped: count("SKIPPED"),
  uncovered: count("UNCOVERED"),
};

if (JSON_MODE) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  for (const r of rows) {
    const via = r.transports ? ` [${r.transports.join("+")}]` : "";
    if (r.state === "FAILING") {
      console.log(`FAILING      ${r.tool}${via}`);
      for (const v of r.violations) console.log(`             ${v}`);
    } else if (r.state === "DISAGREE") {
      console.log(`DISAGREE     ${r.tool}${via} — the two transports returned different envelope shapes`);
      for (const p of r.disagreement.onlyEndpoint.slice(0, 6)) console.log(`             endpoint only: ${p}`);
      for (const p of r.disagreement.onlyMcp.slice(0, 6)) console.log(`             mcp only:      ${p}`);
    } else if (r.state === "UNREACHABLE") {
      console.log(`UNREACHABLE  ${r.tool} — ${r.note}`);
    } else if (r.state === "UNCOVERED") {
      console.log(`UNCOVERED    ${r.tool} — ${r.note}`);
    } else if (r.state === "SKIPPED") {
      console.log(`skipped      ${r.tool} — ${r.note}`);
    } else {
      // Say what ARRIVED, never what membership in a set predicts would arrive.
      const scoped = !r.callerScoped
        ? ""
        : r.rowsReturned === null
          ? " (caller-scoped: nothing measured)"
          : r.rowsReturned > 0
            ? ` (caller-scoped: POPULATED — ${r.rowsReturned} rows on this credential)`
            : ` (caller-scoped: empty — correct for a caller owning no book; dataState=${r.dataState})`;
      const partial = r.note ? ` — ${r.note}` : "";
      console.log(`ok           ${r.tool}${via}${scoped}${partial}`);
    }
  }

  console.log(
    `\n${summary.checked} checked · ${summary.failing} FAILING · ${summary.disagree} DISAGREE · ` +
      `${summary.unreachable} UNREACHABLE · ${summary.skipped} skipped · ${summary.uncovered} UNCOVERED ` +
      `/ ${summary.total} tools   (transport: ${summary.transports}, credential: ${cred.kind})`,
  );
  // A count is not a measurement without its instrument. "0 failing" over a
  // demo credential and "0 failing" over a real key describe different runs.
  if (cred.kind === "demo" && (summary.skipped || summary.uncovered)) {
    console.log(
      [
        "",
        `🔑 ${summary.skipped + summary.uncovered} tools were NOT exercised, and this run could not reach them:`,
        "   the demo credential is refused by requireNotDemo on every write, and the read tools that need a",
        "   watchId/verdictId depend on those writes. To cover them, export FAHALI_API_KEY (a real sk_live_)",
        "   and re-run with --with-writes. Do NOT paste that key into a chat, an issue, or a commit.",
      ].join("\n"),
    );
  }

  if (summary.unreachable) {
    console.log(
      "\n⚠️  UNREACHABLE tools had NOTHING checked. That is not a pass — it is the absence-as-safety\n" +
        "   failure this harness exists to catch. Fix the cause (usually a missing tool-roster INPUTS\n" +
        "   entry, or a genuinely broken endpoint) rather than reading the run as green.",
    );
  }
  if (summary.disagree) {
    console.log(
      "\n⚠️  DISAGREE means both transports answered and the SHAPES differ. A legitimate cause exists\n" +
        "   (the calls are seconds apart and conditional fields come and go with the data), so this is\n" +
        "   a finding for a human, not a verdict. Read the two envelopes in .sweep/ before concluding.",
    );
  }
  console.log(
    `\nCoverage is ${summary.checked + summary.failing + summary.disagree} of ${summary.total}. ` +
      `The other ${summary.skipped + summary.uncovered + summary.unreachable} are NOT passes:\n` +
      `  ${summary.skipped} skipped   write tools — calling them inserts real rows\n` +
      `  ${summary.uncovered} uncovered no transport can address them (see each line above for why)\n` +
      `  ${summary.unreachable} unreachable should have answered and did not`,
  );
  console.log(`\nEnvelopes written to ${OUT} for inspection.`);
}

process.exit(summary.failing ? 1 : 0);
