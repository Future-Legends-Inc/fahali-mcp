#!/usr/bin/env node
/**
 * MCP schema ↔ live-payload validation harness.
 *
 * Calls every tool in TOOL_DEFINITIONS against a running Fahali MCP server and
 * validates each success result's `structuredContent` against the tool's
 * `outputSchema` using Ajv — the SAME check SDK >=1.29 clients (Claude Desktop)
 * enforce. A schema that drifts from its real payload makes the tool fail on
 * every SUCCESSFUL call for enforcing clients while errors pass (isError is
 * exempt) — the exact asymmetry behind the 2026-07-03 connector incident.
 *
 * Run before shipping any tool schema or backend payload change:
 *   MCP_URL=https://mcp.fahaliai.com/mcp \
 *   FAHALI_DIAG_KEY=sk_live_... \
 *   node scripts/validate-schemas.mjs
 *
 * Exits non-zero if any tool fails validation (CI-friendly).
 * Use a paid-scope key; provision a temporary one and revoke it after.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const KEY = process.env.FAHALI_DIAG_KEY;
const BASE = process.env.MCP_URL || "https://mcp.fahaliai.com/mcp";
if (!KEY) { console.error("Set FAHALI_DIAG_KEY (paid-scope sk_live_ key)."); process.exit(2); }

const { TOOL_DEFINITIONS, annotationsForTool } = await import(
  "file://" + join(__dirname, "..", "dist", "tools.js")
);
// THE ONE ROSTER. INPUTS and SKIP_WRITE_TOOLS live in tool-roster.mjs and are
// imported, never copied — a local copy drifted on 2026-09-04 (missing
// fahali_fetch_resource INPUTS false-FAILed a healthy tool; missing incident
// skips fired argless calls at production). Local additions below are
// harness-specific extras, each with its reason, and they EXTEND the roster.
const { INPUTS: ROSTER_INPUTS, SKIP_WRITE_TOOLS: ROSTER_SKIP_WRITES } = await import(
  "file://" + join(__dirname, "tool-roster.mjs")
);
const Ajv = require("ajv").default || require("ajv");
const addFormats = require("ajv-formats").default || require("ajv-formats");
const ajv = new Ajv({ strict: false });
addFormats(ajv);

// Minimal valid inputs for tools that require arguments: the roster first,
// then harness-specific extras (this harness calls tools directly by name, so
// it needs entries the sweep derives differently).
const INPUTS = {
  ...ROSTER_INPUTS,
  fahali_get_market_sentiment: { symbol: "BTCUSDT" },
  fahali_search_memories: { query: "release validation", limit: 1 },
};

// Write tools are skipped DELIBERATELY, not by accident: calling them would
// insert real rows (agent_memory, alerts) every time anyone runs this harness.
// Their schemas go unvalidated as a consequence — a known, chosen gap, printed
// as "skipped (write tool)" so it can never be mistaken for a pass.
const SKIP_WRITE_TOOLS = ROSTER_SKIP_WRITES;

// These reads require IDs created by the authorized production lifecycle.
// Fabricating an ID would only validate an error envelope, while creating one
// here would mutate production and make this read-only schema sweep unsafe.
// Gate 5 validates them transactionally in watch -> delta -> subscription ->
// verdict -> evidence -> unsubscribe order.
const SKIP_LIFECYCLE_READS = new Set([
  "fahali_get_portfolio_decision",
  "fahali_get_watch_delta",
  "fahali_get_verdict_by_id",
  "fahali_get_evidence",
  // An incident id only exists after a watch evaluates into a breach —
// fabricating one validates only an error envelope. (Was missing: the harness
  // fired it argless at production.)
  "fahali_get_incident_timeline",
]);

async function rpc(body, sid) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${KEY}`,
  };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(BASE, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); }
  catch { const m = text.match(/^data: (.*)$/m); if (m) json = JSON.parse(m[1]); }
  return { status: res.status, json, sid: res.headers.get("mcp-session-id") };
}

const init = await rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: {
  protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "schema-validator", version: "1.0" } } });
if (init.status !== 200 || init.json?.error || !init.json?.result) {
  console.error("MCP_INITIALIZE_FAILED", JSON.stringify({
    httpStatus: init.status,
    rpcCode: init.json?.error?.code ?? null,
  }));
  process.exit(1);
}
const sid = init.sid;
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);
let listId = 1;
let cursor;
const remoteTools = [];
const seenCursors = new Set();
do {
  const listed = await rpc({
    jsonrpc: "2.0",
    id: listId++,
    method: "tools/list",
    params: cursor ? { cursor } : {},
  }, sid);
  if (listed.status !== 200 || !Array.isArray(listed.json?.result?.tools)) {
    console.error("tools/list failed:", listed.status, JSON.stringify(listed.json?.error ?? null));
    process.exit(1);
  }
  remoteTools.push(...listed.json.result.tools);
  const nextCursor = listed.json.result.nextCursor;
  if (nextCursor != null) {
    if (typeof nextCursor !== "string" || !nextCursor || seenCursors.has(nextCursor)) {
      console.error("MCP_MANIFEST_PAGINATION_INVALID");
      process.exit(1);
    }
    if (listed.json.result.tools.length === 0 || remoteTools.length > TOOL_DEFINITIONS.length) {
      console.error("MCP_MANIFEST_PAGINATION_NO_PROGRESS");
      process.exit(1);
    }
    seenCursors.add(nextCursor);
  }
  cursor = nextCursor;
} while (cursor);

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};
const titleForTool = (name) => name
  .replace(/^fahali_/, "")
  .split("_")
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(" ");
const expectedRemoteTools = TOOL_DEFINITIONS.map((tool) => ({
  ...tool,
  annotations: {
    title: titleForTool(tool.name),
    ...annotationsForTool(tool.name),
  },
}));
const localOrder = expectedRemoteTools.map((tool) => tool.name);
const remoteOrder = remoteTools.map((tool) => String(tool?.name ?? ""));
const localNames = [...localOrder].sort();
const remoteNames = [...remoteOrder].sort();
const missingRemote = localNames.filter((name) => !remoteNames.includes(name));
const unexpectedRemote = remoteNames.filter((name) => !localNames.includes(name));
const remoteByName = new Map(remoteTools.map((tool) => [tool.name, tool]));
const contractDrift = expectedRemoteTools.filter((expected) => {
  const remote = remoteByName.get(expected.name);
  if (!remote) return false;
  return JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(remote));
}).map((tool) => tool.name);
const orderDrift = localOrder.length === remoteOrder.length &&
  localOrder.some((name, index) => name !== remoteOrder[index]);
if (missingRemote.length || unexpectedRemote.length || remoteNames.some((name) => !name) ||
    remoteNames.length !== localNames.length || new Set(remoteNames).size !== remoteNames.length ||
    contractDrift.length || orderDrift) {
  console.error(
    "MCP_MANIFEST_MISMATCH",
    JSON.stringify({ missingRemote, unexpectedRemote, contractDrift, orderDrift }),
  );
  process.exit(1);
}

console.log(
  `server ${init.json?.result?.serverInfo?.version} · ` +
  `${TOOL_DEFINITIONS.length} local / ${remoteTools.length} remote tools\n`,
);

function valueAtInstancePath(root, instancePath) {
  if (!instancePath) return root;
  return instancePath.split("/").slice(1).reduce((value, token) => {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    return value != null && typeof value === "object" ? value[key] : undefined;
  }, root);
}

function observedSummary(root, validationErrors) {
  const first = validationErrors?.[0];
  if (!first) return "";
  const value = valueAtInstancePath(root, first.instancePath || "");
  if (value != null && typeof value === "object") {
    return ` observedType=${Array.isArray(value) ? "array" : "object"}`;
  }
  const rendered = JSON.stringify(value);
  return ` observedType=${value === null ? "null" : typeof value}` +
    (rendered === undefined ? "" : ` observed=${rendered.slice(0, 100)}`);
}

let id = listId, failing = 0, unvalidated = 0;
for (const tool of TOOL_DEFINITIONS) {
  if (SKIP_WRITE_TOOLS.has(tool.name)) {
    console.log("skipped (write tool)".padEnd(26), tool.name);
    unvalidated++;
    continue;
  }
  if (SKIP_LIFECYCLE_READS.has(tool.name)) {
    console.log("skipped (lifecycle ID)".padEnd(26), tool.name);
    unvalidated++;
    continue;
  }
  const r = await rpc({ jsonrpc: "2.0", id: ++id, method: "tools/call",
    params: { name: tool.name, arguments: INPUTS[tool.name] || {} } }, sid);
  const result = r.json?.result;
  let verdict = "OK", detail = "";
  if (r.status !== 200 || !result) { verdict = "RPC_ERR"; detail = JSON.stringify(r.json?.error || r.status).slice(0, 160); failing++; }
  else if (result.isError) {
    // NOT a pass. isError is exempt from structuredContent validation, so this
    // tool's schema was not checked at all. Deliberate write/lifecycle skips
    // are counted above; an invoked read returning isError is an unexpected
    // release failure, never another allowed skip.
    verdict = "FAIL (tool-error)";
    failing++;
    const msg = result.content?.find?.((c) => c.type === "text")?.text ?? "";
    detail = String(msg).replace(/\s+/g, " ").slice(0, 180);
  }
  else if (!tool.outputSchema) { verdict = "OK (no schema)"; }
  else if (!result.structuredContent) { verdict = "FAIL: no structuredContent"; failing++; }
  else {
    const validate = ajv.compile(tool.outputSchema);
    if (!validate(result.structuredContent)) {
      verdict = "SCHEMA_FAIL";
      detail = (
        ajv.errorsText(validate.errors).slice(0, 240) +
        observedSummary(result.structuredContent, validate.errors)
      ).slice(0, 380);
      failing++;
    }
  }
  console.log(verdict.padEnd(26), tool.name, detail ? "— " + detail : "");
}
const validated = TOOL_DEFINITIONS.length - failing - unvalidated;
console.log(
  `\n${failing} failing · ${unvalidated} UNVALIDATED · ${validated} validated / ${TOOL_DEFINITIONS.length} total`,
);
if (unvalidated) {
  console.log(
    "\n⚠️  UNVALIDATED tools are the explicitly listed write/lifecycle calls skipped to keep\n" +
    "   this production sweep read-only. They are Gate-5 work, not schema passes. Every\n" +
    "   read tool invoked by this harness must return a successful structured envelope.",
  );
}
process.exit(failing ? 1 : 0);
