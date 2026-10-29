#!/usr/bin/env node
/**
 * SUBSTANCE AUDIT — does every advertised tool actually hand an agent a
 * reading, and when it does not, does it SAY SO?
 *
 * Three harnesses already exist and NONE of them answers this:
 *   validate-schemas.mjs   does the payload match its declared schema
 *   sweep-invariants.mjs   is what the envelope SAYS true of the payload
 *   diag-agent-usage.cjs   what status code did production return
 *
 * All three are satisfied by a tool that returns `200 OK_NO_FINDINGS {}`
 * forever. A status code is not data; a valid envelope over an empty body is
 * not a reading. On 2026-09-08 the MCP door showed 4,622 of 4,691 calls as
 * 2xx — which says nothing about whether an agent got an answer.
 *
 * -- The classification, and why WITHHELD is not a failure -------------------
 *
 * Withholding is REQUIRED here. The publishability gate (n_eff >= 30 and
 * lift > 0) exists so a thin stratum is refused rather than rounded up, and
 * "refusal is a feature" is doctrine. So an absence is only a defect when it
 * arrives WITHOUT A STATED REASON — that is the "absence renders as safety"
 * class this codebase has found 7+ times.
 *
 *   DATA        substantive content reached the agent
 *   WITHHELD    no reading, and the payload NAMES why  (correct)
 *   SILENT      no reading, and NOTHING says why       (🔴 defect)
 *   CALLER      empty because a demo caller owns no book (correct, not proof)
 *   ERROR       the call failed
 *   SKIPPED     write tool, deliberately not called
 *
 * A tool is only "verified serving" in the DATA column. CALLER and SKIPPED are
 * printed separately and never folded into a pass count — an unproven path
 * reported as green is the exact failure the sweep header warns about.
 *
 *   node scripts/audit-substance.mjs          # read-only, public demo token
 *   node scripts/audit-substance.mjs --json
 */
import { writeFileSync } from "node:fs";
import { McpStdioClient } from "./mcp-stdio-client.mjs";
import { INPUTS, SKIP_WRITE_TOOLS, CALLER_SCOPED_TOOLS } from "./tool-roster.mjs";

const API = process.env.FAHALI_API_URL || "https://app.fahaliai.com";
const JSON_OUT = process.argv.includes("--json");

/** Keys whose presence means the envelope explained itself. */
const REASON_KEYS = [
  "reason", "reasons", "why", "absence", "absenceReason", "withheldReason",
  "note", "notes", "explanation", "adapterGap", "unavailableReason",
  "insufficientReason", "message", "detail", "details", "limitations",
];

/** Envelope scaffolding — present on every response, so it is never evidence. */
const ENVELOPE_KEYS = new Set([
  "responseState", "dataState", "absence", "asOf", "as_of", "generatedAt",
  "provenanceRoot", "auth", "nextActions", "coverage", "judgedRecord",
  "_meta", "meta", "tool", "view", "schemaVersion", "contract", "disclaimer",
  "adapterGap", "children", "sourceDecision", "sourceEvidenceQuality",
  "sourceConfidenceSemantics", "compliance", "notice",
]);

function deepFind(node, pred, depth = 0) {
  if (depth > 8 || node == null) return false;
  if (Array.isArray(node)) return node.some((v) => deepFind(v, pred, depth + 1));
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (pred(k, v)) return true;
      if (deepFind(v, pred, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * Substance = anything outside the envelope scaffolding that carries a value.
 * Counted structurally, NOT by byte size: a 40KB payload of empty arrays and
 * nulls is large and says nothing, and byte size is exactly the measure that
 * would call it healthy.
 */
function substanceOf(env) {
  if (!env || typeof env !== "object") return { fields: 0, sample: [] };
  const sample = [];
  let fields = 0;
  const walk = (node, path, depth) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      if (node.length) { fields += node.length; if (sample.length < 4) sample.push(`${path}[${node.length}]`); }
      node.slice(0, 3).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (depth === 0 && ENVELOPE_KEYS.has(k)) continue;
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
      return;
    }
    if (typeof node === "string" && !node.trim()) return;
    fields += 1;
    if (sample.length < 4 && path) sample.push(path);
  };
  walk(env, "", 0);
  return { fields, sample };
}

function classify(tool, res) {
  if (SKIP_WRITE_TOOLS.has(tool)) return { state: "SKIPPED", detail: "write tool — not called" };
  if (res.error) return { state: "ERROR", detail: res.error.slice(0, 120) };
  if (res.isError) return { state: "ERROR", detail: (res.text || "isError with no text").slice(0, 120) };

  const env = res.envelope;
  if (!env) {
    // Text-only content still reaches the agent, so it is not nothing —
    // but it is not a structured reading either. Named, not silently passed.
    return res.text?.trim()
      ? { state: "DATA", detail: `text-only, ${res.text.trim().length} chars`, fields: 0 }
      : { state: "SILENT", detail: "no structuredContent and no text" };
  }

  const { fields, sample } = substanceOf(env);
  const rs = String(env.responseState ?? "");
  const ds = String(env.dataState ?? "");
  const hasReason =
    Boolean(env.absence) ||
    (Array.isArray(env.adapterGap) && env.adapterGap.length > 0) ||
    deepFind(env, (k, v) => REASON_KEYS.includes(k) && typeof v === "string" && v.trim().length > 3) ||
    deepFind(env, (k, v) => REASON_KEYS.includes(k) && Array.isArray(v) && v.length > 0);

  const meta = { responseState: rs, dataState: ds, fields, sample };
  if (fields > 0 && ds !== "no_data") return { state: "DATA", detail: `${fields} value fields`, ...meta };
  if (CALLER_SCOPED_TOOLS.has(tool)) return { state: "CALLER", detail: `caller-scoped; ${hasReason ? "reason given" : "NO reason"}`, ...meta };
  if (hasReason) return { state: "WITHHELD", detail: "absence is explained", ...meta };
  return { state: "SILENT", detail: `empty and unexplained (${rs || "no responseState"})`, ...meta };
}

(async () => {
  const r = await fetch(`${API}/api/auth/demo-token`, { method: "POST", headers: { "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`demo-token mint failed: HTTP ${r.status}`);
  const token = (await r.json())?.token;
  if (!token) throw new Error("demo-token response carried no token");

  const mcp = new McpStdioClient({ apiKey: token, apiUrl: API });
  await mcp.initialize();
  const tools = await mcp.listTools();

  const rows = [];
  // State captured from read paths, so id-taking tools are reached without a
  // single write — the same chaining sweep-invariants.mjs performs.
  const state = {};
  const fill = (args) => JSON.parse(JSON.stringify(args ?? {}).replace(/"\$(\w+)"/g, (m, k) => JSON.stringify(state[k] ?? "")));
  /**
   * 🔴 CAPTURE BY PATH, NOT BY KEY NAME.
   *
   * The first version of this matched key names — verdictId, lastVerdictId,
   * currentVerdictId — and missed the verdict id entirely, because
   * get_verdict_history carries it at `$.items[0].id`, whose key is `id`.
   * Four tools were then called with an empty string and reported ERROR:
   * three of them serve perfectly well when handed a real id. That is exactly
   * the failure tool-roster.mjs already documents — "a key-name guess is not a
   * measurement" — arrived at independently a second time.
   */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const take = (v) => (typeof v === "string" && UUID.test(v) ? v : undefined);
  const capture = (tool, env) => {
    if (!env) return;
    if (tool === "fahali_list_portfolio_watches") state.watchId ??= take(env.watches?.[0]?.watchId);
    if (tool === "fahali_get_verdict_history") state.verdictId ??= take(env.items?.[0]?.id);
    if (tool === "fahali_get_active_incidents") state.incidentId ??= take(env.incidents?.[0]?.incidentId);
  };

  // fetch_resource takes a catalogued PATH under `resource`. Called with no
  // argument it answers `unknown_resource: \`\`` — an honest refusal that a
  // harness misreads as a broken tool.
  const EXTRA_INPUTS = { fahali_fetch_resource: { resource: "/api/situations" } };

  const ID_ARGS = {
    fahali_get_verdict_by_id: { verdict_id: "$verdictId" },
    fahali_get_evidence: { verdict_id: "$verdictId" },
    fahali_get_portfolio_decision: { watch_id: "$watchId" },
    fahali_get_watch_delta: { watch_id: "$watchId" },
    fahali_get_incident_timeline: { incident_id: "$incidentId" },
  };
  // Read the id-yielding tools first so the chained ones can be reached.
  const order = [...tools].sort((a, b) => Number(a.name in ID_ARGS) - Number(b.name in ID_ARGS));
  if (order.some((t) => t.name in ID_ARGS) && !order.some((t) => t.name === "fahali_list_portfolio_watches")) throw new Error("id-consuming tools present but no id-yielding read in the roster");

  for (const t of order) {
    const name = t.name;
    if (SKIP_WRITE_TOOLS.has(name)) { rows.push({ tool: name, ...classify(name, {}) }); continue; }
    const args = name in ID_ARGS ? fill(ID_ARGS[name]) : (INPUTS[name] ?? EXTRA_INPUTS[name] ?? {});
    const res = await mcp.callTool(name, args);
    capture(name, res.envelope);
    rows.push({ tool: name, args: Object.keys(args), ...classify(name, res) });
  }
  mcp.close();

  const by = {};
  for (const x of rows) (by[x.state] ??= []).push(x);
  const summary = { total: rows.length, ...Object.fromEntries(Object.keys(by).sort().map((k) => [k, by[k].length])) };

  if (JSON_OUT) {
    writeFileSync("audit-substance.json", JSON.stringify({ summary, rows }, null, 2));
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    for (const k of ["SILENT", "ERROR", "WITHHELD", "CALLER", "DATA", "SKIPPED"]) {
      if (!by[k]) continue;
      console.log(`\n─── ${k}  [${by[k].length}] ───`);
      for (const x of by[k].sort((a, b) => a.tool.localeCompare(b.tool))) {
        const st = x.responseState ? `  ${x.responseState}/${x.dataState}` : "";
        console.log(`  ${x.tool.padEnd(40)} ${String(x.detail).padEnd(34)}${st}`);
      }
    }
    console.log("\n" + JSON.stringify(summary));
    console.log("\nDATA = verified serving. CALLER/SKIPPED are UNPROVEN, never a pass.");
  }
  process.exit((by.SILENT?.length ?? 0) + (by.ERROR?.length ?? 0) > 0 ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(2); });
