/**
 * Every advertised tool must be dispatchable.
 *
 * WHY (2026-07-30): `fahali_get_lead_time` was declared in tools.ts — full
 * description, input schema, `_meta.endpoint` — so it appeared in tools/list and
 * any connected agent could discover it. But dispatch in index.ts is a hardcoded
 * `switch (name)`, and it had no `case`, so every call fell through to
 * `default` -> `unknown tool: fahali_get_lead_time`.
 *
 * That was live for the Verified Lead Time tool: the single number the product is
 * sold on. It failed silently in the sense that nothing on our side logged an
 * error — the caller got the error, we didn't. Nothing type-checked it either,
 * because a listing entry and a switch case are unrelated as far as tsc is
 * concerned.
 *
 * This closes the gap the cheap way: assert the two lists agree.
 * Run: npm run check-dispatch   (no credentials needed, unlike validate-schemas)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const toolsSrc = readFileSync(join(SRC, "tools.ts"), "utf8");
const indexSrc = readFileSync(join(SRC, "index.ts"), "utf8");

/**
 * Deprecated tool names, kept DISPATCHABLE but deliberately NOT advertised.
 *
 * Each previously claimed a data feed Fahali does not have. The advertised name
 * now says what the tool measures; the old name still resolves so live
 * integrations do not break. They must never be re-added to TOOL_DEFINITIONS —
 * that would put the claim back in front of every agent.
 *
 * Listed here so this script reports them as INTENTIONAL rather than as orphan
 * cases somebody might tidy away.
 */
const DEPRECATED_ALIASES = new Set([
  "fahali_get_dark_pool_activity",   // -> fahali_get_microstructure_proxy
  "fahali_get_smart_money_dashboard", // -> fahali_get_detection_activity
  "fahali_get_whale_activity",        // -> fahali_get_unusual_money_movement (2026-08-26)
  "fahali_get_institutional_risk_score", // -> fahali_get_market_risk_score (global, not participant-specific)
  "fahali_get_72h_forecast",          // -> fahali_get_forecast (2026-08-06)
  "save_memory",                       // -> fahali_save_memory (2026-08-26)
  "search_memories",                   // -> fahali_search_memories (2026-08-26)
  "create_alert",                      // -> fahali_create_alert (2026-08-26)
  "list_agent_sessions",               // -> fahali_list_agent_sessions (2026-08-26)
]);

// Declared tools: `name: "fahali_..."` entries in the tool definitions.
const declared = [...toolsSrc.matchAll(/^\s*name:\s*"([a-z0-9_]+)"/gim)].map((m) => m[1]);
// Dispatchable: `case "..."` labels in the CallTool switch.
const dispatched = new Set([...indexSrc.matchAll(/case\s+"([a-z0-9_]+)"/gi)].map((m) => m[1]));

const undispatchable = [...new Set(declared)].filter((n) => !dispatched.has(n)).sort();
const orphanCases = [...dispatched]
  .filter((n) => !declared.includes(n) && !DEPRECATED_ALIASES.has(n))
  .sort();
const aliasesPresent = [...DEPRECATED_ALIASES].filter((n) => dispatched.has(n)).sort();
const aliasesMissing = [...DEPRECATED_ALIASES].filter((n) => !dispatched.has(n)).sort();
const aliasesReadvertised = [...DEPRECATED_ALIASES].filter((n) => declared.includes(n)).sort();

if (declared.length === 0) {
  console.error("check-dispatch: parsed 0 tool names from tools.ts — the regex has drifted.");
  process.exit(2);
}

console.log(`check-dispatch: ${new Set(declared).size} declared, ${dispatched.size} dispatch cases`);

if (aliasesPresent.length) {
  console.log(`check-dispatch: ${aliasesPresent.length} deprecated alias(es) still dispatchable (intended): ${aliasesPresent.join(", ")}`);
}
if (aliasesMissing.length) {
  console.error(
    [
      "",
      "FAIL: deprecated alias(es) no longer dispatchable, which BREAKS live callers:",
      ...aliasesMissing.map((n) => `  - ${n}`),
      "",
      "Restore the case in src/index.ts. These names are public API.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
if (aliasesReadvertised.length) {
  console.error(
    [
      "",
      "FAIL: deprecated alias(es) have been RE-ADVERTISED in tools.ts:",
      ...aliasesReadvertised.map((n) => `  - ${n}`),
      "",
      "Each names a data feed we do not have. Keep them dispatchable, not advertised.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
if (orphanCases.length) {
  console.warn(`  note: dispatch cases with no declared tool: ${orphanCases.join(", ")}`);
}

if (undispatchable.length) {
  console.error(
    `\nFAIL: ${undispatchable.length} tool(s) are advertised but will return "unknown tool":\n` +
      undispatchable.map((n) => `  - ${n}`).join("\n") +
      `\n\nAdd a case to the switch in src/index.ts (and a handler in src/proxy.ts).\n`,
  );
  process.exit(1);
}

console.log("check-dispatch: OK — every advertised tool has a dispatch case.");
