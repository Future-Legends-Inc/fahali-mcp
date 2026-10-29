#!/usr/bin/env node
/**
 * THE TWO SURFACES NO HARNESS IN THIS DIRECTORY HAS EVER TOUCHED — 2026-09-08.
 *
 * `sweep-invariants.mjs`, `validate-schemas.mjs` and `audit-substance.mjs` all
 * start from `tools/list`. That enumerates 54 tools and NOTHING else, so two
 * user-reachable surfaces have never been called even once:
 *
 *   1. PROMPTS — a separate MCP primitive with its own JSON-RPC methods. A user
 *      picking "Fahali risk desk" from a host's prompt menu lands here. A prompt
 *      that throws, renders empty, or tells the agent to call a tool that was
 *      renamed is invisible to every tools/list-based check.
 *
 *   2. DEPRECATED TOOL NAMES — `agentPayload.ts:641` keeps four of them as
 *      ADAPTER_ALIASES after the honest-naming rename (whale/dark-pool/
 *      smart-money/institutional-risk). They are deliberately absent from
 *      tools/list. But an agent holding a cached roster, or a saved workflow
 *      written before the rename, still calls the OLD name. Whether that routes
 *      or hard-fails has never been measured — only assumed from the presence
 *      of the alias map, which governs adapter lookup, not dispatch.
 *
 * Read-only. Neither surface writes.
 *
 *   node scripts/probe-prompts-and-aliases.mjs [--json]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpStdioClient } from "./mcp-stdio-client.mjs";

const API = process.env.FAHALI_API_URL || "https://app.fahaliai.com";
const JSON_OUT = process.argv.includes("--json");

/**
 * The key is read from the environment or from a file the operator already
 * placed on this machine. It is never echoed, never interpolated into a shell
 * command, and never returned in output — only its presence is reported.
 */
function credential() {
  if (process.env.FAHALI_API_KEY) return { key: process.env.FAHALI_API_KEY, from: "FAHALI_API_KEY" };
  try {
    const k = readFileSync(join(homedir(), ".fahali_sweep_key"), "utf8").trim();
    if (k) return { key: k, from: "~/.fahali_sweep_key" };
  } catch {
    /* not present */
  }
  return null;
}

/** Realistic values for the six declared prompt arguments. */
const ARG_VALUES = {
  symbols: "BTCUSDT,ETHUSDT,NVDA",
  holdings: "BTCUSDT 50000, NVDA 30000, ETHUSDT 20000",
  horizon: "24h",
  objective: "balanced",
  intent: "increase BTC exposure by 20%",
  claim: "Bitcoin is about to crash.",
};

/** The four names removed by the honest-naming rename, kept as adapter aliases. */
const DEPRECATED_ALIASES = {
  fahali_get_whale_activity: {},
  fahali_get_dark_pool_activity: { symbol: "BTCUSDT" },
  fahali_get_smart_money_dashboard: {},
  fahali_get_institutional_risk_score: {},
};

(async () => {
  const cred = credential();
  const token = cred
    ? cred.key
    : await (async () => {
        const r = await fetch(`${API}/api/auth/demo-token`, { method: "POST", headers: { "Content-Type": "application/json" } });
        if (!r.ok) throw new Error(`demo-token mint failed: HTTP ${r.status}`);
        return (await r.json())?.token;
      })();
  const authNote = cred ? `credential from ${cred.from}` : "demo token (no operator key found)";

  const mcp = new McpStdioClient({ apiKey: token, apiUrl: API });
  await mcp.initialize();

  const promptRows = [];
  const listed = await mcp.listPrompts();
  if (listed.error) {
    promptRows.push({ prompt: "(prompts/list)", state: "ERROR", detail: listed.error });
  } else {
    for (const p of listed.prompts) {
      const declared = p.arguments ?? [];
      const args = {};
      for (const a of declared) if (a.name in ARG_VALUES) args[a.name] = ARG_VALUES[a.name];
      const missing = declared.filter((a) => a.required && !(a.name in args)).map((a) => a.name);
      const res = await mcp.getPrompt(p.name, args);
      const text = res.text ?? "";
      // A prompt's whole job is to hand the agent an instruction. Empty text is
      // a dead menu entry no matter how well-formed the JSON-RPC reply was.
      const state = res.error ? "ERROR" : text.trim().length === 0 ? "EMPTY" : "OK";
      promptRows.push({
        prompt: p.name,
        state,
        declaredArgs: declared.map((a) => `${a.name}${a.required ? "*" : ""}`),
        unfilledRequired: missing,
        chars: text.length,
        detail: res.error ?? `${res.messages.length} message(s)`,
        // Which tools the prompt tells the agent to call — checked against the
        // live roster below, because a prompt naming a renamed tool is a
        // user-visible dead end that no schema check can see.
        namesTools: [...new Set((text.match(/fahali_[a-z_]+/g) ?? []))],
        text,
      });
    }
  }

  // Cross-check every tool a prompt names against what the server advertises.
  const live = new Set((await mcp.listTools()).map((t) => t.name));
  for (const r of promptRows) {
    r.namesMissingTools = (r.namesTools ?? []).filter((n) => !live.has(n));
  }

  const aliasRows = [];
  for (const [name, args] of Object.entries(DEPRECATED_ALIASES)) {
    const res = await mcp.callTool(name, args);
    aliasRows.push({
      alias: name,
      advertised: live.has(name),
      state: res.error ? "RPC_ERROR" : res.isError ? "REFUSED" : res.envelope ? "ROUTED" : "NO_PAYLOAD",
      detail: (res.error ?? res.text ?? "").slice(0, 160).replace(/\s+/g, " "),
    });
  }
  mcp.close();

  const out = { auth: authNote, prompts: promptRows, aliases: aliasRows };
  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`auth: ${authNote}\n`);
    console.log(`─── PROMPTS [${promptRows.length}] ───`);
    for (const r of promptRows) {
      console.log(
        `  ${String(r.state).padEnd(6)} ${r.prompt.padEnd(34)} args:${(r.declaredArgs ?? []).join(",") || "none"}  ${r.chars ?? 0} chars  ${r.detail}`,
      );
      if (r.namesMissingTools?.length) console.log(`         🔴 names tools that do not exist: ${r.namesMissingTools.join(", ")}`);
    }
    console.log(`\n─── DEPRECATED ALIASES [${aliasRows.length}] ───`);
    for (const r of aliasRows) {
      console.log(`  ${r.state.padEnd(10)} ${r.alias.padEnd(38)} advertised:${r.advertised}  ${r.detail}`);
    }
  }
  const bad =
    promptRows.filter((r) => r.state !== "OK" || r.namesMissingTools?.length).length +
    aliasRows.filter((r) => r.state === "RPC_ERROR").length;
  process.exit(bad > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(2);
});
