/**
 * A ratchet, not a unit test.
 *
 * The server instructions are the most tempting place in this repo to bake a
 * flattering number. The pasted growth plan that prompted this file wanted
 * exactly that — "right 71% of the time against a 33% base rate across 1.6M+
 * tracked calls" — and two of those three figures do not survive contact with
 * the endpoint:
 *
 *   - the 1.6M was `effective_sample` SUMMED across 220 strata spanning 24 days,
 *     but that column is a rolling window republished daily and is byte-identical
 *     day to day, so the sum multiplies one 23,891-row sample by the day count;
 *   - the 71% arrives with 26.84% recall, and precision without recall is the
 *     flattering half for a product that sells warning.
 *
 * Both were caught before shipping. This test is what stops the next attempt.
 *
 * Run from the repo root:
 *   node --import tsx --test mcp-server/src/serverInstructions.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

// Imported from its own module, NOT from index.ts: importing index.ts boots a
// listening MCP server and the test never returns.
import { SERVER_INSTRUCTIONS } from "./serverInstructions.js";

test("the instructions state no accuracy figure of their own", () => {
  assert.doesNotMatch(
    SERVER_INSTRUCTIONS,
    /\d+(\.\d+)?\s*%/,
    "A percentage here is frozen at deploy time while the endpoint recomputes daily and re-selects which engine is the headline. Describe the property and send the caller to fahali_get_lead_time.",
  );
  assert.doesNotMatch(
    SERVER_INSTRUCTIONS,
    /\b\d[\d,.]*\s*(M\b|million|\+\s*(tracked|calls))/i,
    "A sample-size claim here cannot be re-derived by the reader, and the obvious one (summing effective_sample) is a double count.",
  );
});

test("the instructions name recall, the publishable flag, and the stratum", () => {
  for (const [needle, why] of [
    ["recall", "precision without recall is the flattering half"],
    ["publishable", "readers must branch on the flag, not the percentage"],
    ["stratum", "a figure without its stratum is not a claim about anything"],
    ["withheld", "refusal is the feature; it has to be stated"],
  ] as const) {
    assert.match(SERVER_INSTRUCTIONS, new RegExp(needle, "i"), `instructions must mention ${needle} — ${why}`);
  }
});

test("the instructions warn against summing effective_sample", () => {
  // This is the specific error that reached a growth plan before being caught.
  assert.match(SERVER_INSTRUCTIONS, /do not sum/i);
  assert.match(SERVER_INSTRUCTIONS, /effective_sample/);
});

test("the read-only posture is stated, since agents route capital", () => {
  assert.match(SERVER_INSTRUCTIONS, /read-only/i);
  assert.match(SERVER_INSTRUCTIONS, /not.*(investment )?advice/i);
});
