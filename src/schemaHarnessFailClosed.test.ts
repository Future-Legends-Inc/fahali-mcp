import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TOOL_DEFINITIONS } from "./tools.js";

const require = createRequire(import.meta.url);

const source = readFileSync(
  new URL("../scripts/validate-schemas.mjs", import.meta.url),
  "utf8",
);

test("production schema sweep fails closed when an invoked read returns isError", () => {
  const branchStart = source.indexOf("else if (result.isError)");
  const branchEnd = source.indexOf("else if (!tool.outputSchema)", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);

  const branch = source.slice(branchStart, branchEnd);
  assert.match(branch, /verdict = "FAIL \(tool-error\)"/);
  assert.match(branch, /failing\+\+/);
  assert.doesNotMatch(branch, /unvalidated\+\+/);
  assert.match(source, /process\.exit\(failing \? 1 : 0\)/);
  assert.match(source, /r\.status !== 200 \|\| !result/);
});

test("only explicitly listed write and lifecycle tools remain unvalidated", () => {
  assert.match(source, /SKIP_WRITE_TOOLS\.has\(tool\.name\)[\s\S]*?unvalidated\+\+/);
  assert.match(source, /SKIP_LIFECYCLE_READS\.has\(tool\.name\)[\s\S]*?unvalidated\+\+/);
});

test("production sweep proves the complete paginated remote manifest", () => {
  assert.match(source, /method: "tools\/list"/);
  assert.match(source, /while \(cursor\)/);
  assert.match(source, /seenCursors\.has\(nextCursor\)/);
  assert.match(source, /MCP_MANIFEST_PAGINATION_INVALID/);
  assert.match(source, /MCP_MANIFEST_PAGINATION_NO_PROGRESS/);
  assert.match(source, /missingRemote\.length \|\| unexpectedRemote\.length/);
  assert.match(source, /expectedRemoteTools/);
  assert.match(source, /annotationsForTool/);
  assert.match(source, /JSON\.stringify\(canonical\(expected\)\)/);
  assert.match(source, /contractDrift\.length/);
  assert.match(source, /orderDrift/);
  assert.match(source, /MCP_MANIFEST_MISMATCH/);
});

test("production sweep registers and enforces JSON Schema formats", () => {
  assert.match(source, /require\("ajv-formats"\)/);
  assert.match(source, /addFormats\(ajv\)/);

  const Ajv = require("ajv").default || require("ajv");
  const addFormats = require("ajv-formats").default || require("ajv-formats");
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile({
    type: "object",
    required: ["id", "observedAt"],
    properties: {
      id: { type: "string", format: "uuid" },
      observedAt: { type: "string", format: "date-time" },
    },
  });

  assert.equal(validate({ id: "not-a-uuid", observedAt: "not-a-date" }), false);
});

test("production sweep rejects a JSON-RPC initialize error carried by HTTP 200", () => {
  assert.match(
    source,
    /init\.status !== 200 \|\| init\.json\?\.error \|\| !init\.json\?\.result/,
  );
  assert.match(source, /MCP_INITIALIZE_FAILED/);
});

test("production response schemas preserve exact fail-closed and proxy semantics", () => {
  const Ajv = require("ajv").default || require("ajv");
  const addFormats = require("ajv-formats").default || require("ajv-formats");
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const byName = new Map((TOOL_DEFINITIONS as any[]).map((tool) => [tool.name, tool]));

  const accepts = (name: string, payload: unknown): boolean => {
    const tool = byName.get(name);
    assert.ok(tool, `missing tool ${name}`);
    return Boolean(ajv.compile(tool.outputSchema)(payload));
  };

  // A withheld canonical decision has no urgency measurement. Null is not zero.
  for (const name of [
    "fahali_get_market_verdict",
    "fahali_get_market_decision",
    "fahali_get_symbol_decision",
  ]) {
    const verdict = { direction: "neutral", confidence: 0.5, uncertainty: 0.5 };
    assert.equal(
      accepts(name, { data: [{ verdict: { ...verdict, urgencyScore: null }, canonical: null }] }),
      true,
      name,
    );
    assert.equal(accepts(name, { data: [{ verdict: { ...verdict, urgencyScore: "urgent" } }] }), false, name);
    assert.equal(
      accepts(name, { data: [{ verdict, canonical: "neutral" }] }),
      false,
      `${name} must not encode missing canonical authority as a direction string`,
    );
  }

  assert.equal(
    accepts("fahali_get_unusual_money_movement", { dataOrigin: "candle_derived_order_flow_proxy" }),
    true,
  );
  assert.equal(
    accepts("fahali_get_unusual_money_movement", { dataOrigin: "participant_identity" }),
    false,
  );
  assert.equal(accepts("fahali_get_capital_flow", { dataOrigin: "order_flow_imbalance_proxy" }), true);
  assert.equal(accepts("fahali_get_capital_flow", { dataOrigin: "fund_flow" }), false);

  assert.equal(accepts("fahali_get_market_risk_score", { coverage: 3612 }), true);
  assert.equal(accepts("fahali_get_market_risk_score", { coverage: { measured: 3612 } }), false);
  assert.equal(
    accepts("fahali_get_track_record_scorecard", {
      blended: { directional_accuracy: null, magnitude_precision: null, blended_score: null },
    }),
    true,
  );
  assert.equal(
    accepts("fahali_get_track_record_scorecard", {
      blended: { directional_accuracy: "unknown", magnitude_precision: null, blended_score: null },
    }),
    false,
  );

  assert.equal(accepts("fahali_get_market_regime", { timestamp: "2026-09-01T05:34:11.560Z" }), true);
  assert.equal(accepts("fahali_get_market_regime", { timestamp: { epoch: 1 } }), false);
  assert.equal(accepts("fahali_get_lead_time", { status: "partial" }), true);
  assert.equal(
    accepts("fahali_get_lead_time", { calculationStatus: "no_verified_identity_population" }),
    true,
  );
  assert.equal(
    accepts("fahali_get_lead_time", { calculationStatus: "identity_authority_unavailable" }),
    true,
  );
  assert.equal(accepts("fahali_get_lead_time", { status: "healthy" }), false);
  assert.equal(accepts("fahali_get_lead_time", { calculationStatus: "assumed_verified" }), false);
});
