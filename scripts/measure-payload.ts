/**
 * Pre-deploy gate: what did the agent briefing cost on the wire?
 *
 * `fahali_get_market_snapshot` blew past a client token limit once at 161K
 * characters, so "the briefing reads nicely" is not the question. The question
 * is whether the envelope scales WITH the payload or sits beside it. The
 * renderer caps evidence at MAX_EVIDENCE rows and absences at MAX_ABSENCES, so
 * the briefing should be roughly constant and its share should collapse as
 * payloads grow. This script proves that rather than asserting it.
 *
 * Run from mcp-server/:  npx tsx scripts/measure-payload.ts
 *
 * Exits non-zero if the envelope is not bounded — i.e. if the briefing grows
 * with row count, or if a large payload more than doubles.
 */
import { decorateForAgent } from "../src/agentPayload.js";

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const wire = (r: any) =>
  bytes(JSON.stringify({ content: r.content, structuredContent: r.structuredContent, isError: r.isError }));

function snapshot(n: number) {
  return {
    count: n,
    sortedBy: "volume",
    assetClass: "all",
    generatedAt: "2026-08-21T18:05:00Z",
    entries: Array.from({ length: n }, (_, i) => ({
      symbol: `SYM${i}`,
      assetClass: i % 3 === 0 ? "crypto" : "equity",
      venue: i % 3 === 0 ? "binance" : "alpaca",
      underlying: null,
      price: 100 + i,
      changePct: (i % 17) - 8,
      volumeUsd24h: 1_000_000 * (i + 1),
      detectionStrength: (i % 100) / 100,
      alertType: "momentum_shift",
      lastDetectionAt: "2026-08-21T18:04:00Z",
    })),
  };
}

function leadTime(n: number) {
  return {
    count: n,
    measuredAt: "2026-08-21T00:00:00Z",
    strata: Array.from({ length: n }, (_, i) => ({
      engine: ["risk_intelligence", "correlation", "leverage", "funding_stress"][i % 4],
      horizon_tier: ["24h", "48h", "72h"][i % 3],
      bar_regime: i % 2 ? "crypto" : "equity",
      publishable: i % 3 === 0,
      precision_pct: 60 + (i % 20),
      base_rate_pct: 30 + (i % 15),
      recall_pct: 10 + (i % 30),
      lead_median_hours: 12 + (i % 40),
      effective_sample: 30 + i,
      withheld_reason: i % 3 === 0 ? null : "n_eff below 30",
    })),
  };
}

/** What the tool returned BEFORE this change: a generic table + the JSON. */
const raw = (data: any) => ({
  content: [
    { type: "text" as const, text: "| col | col |\n| --- | --- |\n" + "| a | b |\n".repeat(Math.min(25, data.entries?.length ?? data.strata?.length ?? 1)) },
    { type: "text" as const, text: JSON.stringify(data) },
  ],
  structuredContent: data,
});

const failures: string[] = [];

console.log("tool                         rows      before       after      delta   ratio");
console.log("-".repeat(76));
for (const [tool, mk] of [["fahali_get_market_snapshot", snapshot], ["fahali_get_lead_time", leadTime]] as const) {
  for (const n of [1, 10, 25, 100, 500, 800, 2000]) {
    const data = mk(n);
    const before = wire(raw(data));
    const after = wire(decorateForAgent(tool, raw(data) as any));
    const ratio = after / before;
    console.log(
      `${tool.padEnd(28)} ${String(n).padStart(4)} ${String(before).padStart(11)} ${String(after).padStart(11)} ${String(after - before).padStart(10)}   ${ratio.toFixed(2)}x`,
    );
    if (n >= 500 && ratio > 2) failures.push(`${tool} at ${n} rows grew ${ratio.toFixed(2)}x — the envelope is scaling with the payload`);
  }
  console.log("-".repeat(76));
}

console.log("\nthe briefing alone — the part that is NEW — must not grow with row count:");
let prev = 0;
for (const n of [1, 25, 500, 2000]) {
  const r: any = decorateForAgent("fahali_get_market_snapshot", raw(snapshot(n)) as any);
  const size = bytes(r.structuredContent.agentBriefing);
  console.log(`  ${String(n).padStart(4)} rows -> ${String(size).padStart(5)} bytes`);
  if (n > 1 && size > prev * 1.5) failures.push(`briefing grew from ${prev} to ${size} bytes between row counts — it is not bounded`);
  prev = size;
}

// The number to quote is the one a caller can actually reach. `limit` is
// documented "default 50, max 800", so the 2000-row rows above are a scaling
// probe, not a worst case — reporting them as one would overstate the exposure
// in the frightening direction, which is the same error as understating it.
const reach: any = decorateForAgent("fahali_get_market_snapshot", raw(snapshot(800)) as any);
const big: any = decorateForAgent("fahali_get_market_snapshot", raw(snapshot(2000)) as any);
console.log(`\nREACHABLE worst case — 800 rows, the schema's advertised max for \`limit\`:`);
console.log(`  ${(wire(reach) / 1024).toFixed(0)} KB, ~${Math.round(wire(reach) / 4).toLocaleString()} tokens`);
console.log(`The 2000-row line above is a scaling probe only (${(wire(big) / 1024).toFixed(0)} KB); no caller can request it.`);
console.log("Note: the JSON payload is duplicated across content[] and structuredContent by the MCP");
console.log("spec itself (structured tools SHOULD serialise into content for older clients). That");
console.log("duplication predates this change and is not attributable to the briefing.");

if (failures.length) {
  console.error("\nFAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("\nOK: the agent envelope is bounded and does not scale with payload size.");
