import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";

import { classifyAgentPayload } from "./agentPayload.js";
import { buildShockTestRequestBody } from "./proxy.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { addFahaliSchemaFormats } from "./ajvFormats.js";

const shockTool = (TOOL_DEFINITIONS as any[]).find((tool) => tool.name === "fahali_run_shock_test");

test("shock MCP accepts the exact compound request in structured form", () => {
  const AjvConstructor: any = Ajv;
  const ajv = new AjvConstructor({ strict: false });
  addFahaliSchemaFormats(ajv);
  const validate = ajv.compile(shockTool.inputSchema);
  const input = {
    scenario: "Nasdaq falls 12%, Bitcoin falls 20%, volatility doubles, and correlations converge toward 0.85.",
    shocks: [
      { kind: "instrument", instrument: "Nasdaq", movePct: -12 },
      { kind: "instrument", instrument: "Bitcoin", movePct: -20 },
      { kind: "factor", factor: "volatility", operation: "multiply", value: 2 },
      { kind: "factor", factor: "cross_asset_correlation", operation: "set", value: 0.85 },
    ],
  };
  assert.equal(validate(input), true, JSON.stringify(validate.errors));
});

test("shock MCP rejects malformed factor operations and bounds", () => {
  const AjvConstructor: any = Ajv;
  const ajv = new AjvConstructor({ strict: false });
  addFahaliSchemaFormats(ajv);
  const validate = ajv.compile(shockTool.inputSchema);
  assert.equal(validate({ shocks: [{ kind: "factor", factor: "volatility", operation: "set", value: 2 }] }), false);
  assert.equal(validate({ shocks: [{ kind: "factor", factor: "cross_asset_correlation", operation: "set", value: 1.2 }] }), false);
});

test("proxy request preserves structured shocks, horizon, and legacy compatibility", () => {
  const shocks = [{ kind: "instrument", instrument: "Bitcoin", movePct: -20 }];
  assert.deepEqual(
    buildShockTestRequestBody("Bitcoin falls 20%", undefined, shocks, "5d", "BTCUSDT", -20),
    {
      scenario: "Bitcoin falls 20%",
      positions: undefined,
      shocks,
      horizon: "5d",
      shockSymbol: "BTCUSDT",
      shockPct: -20,
    },
  );
});

test("dispatcher forwards structured shock arguments instead of dropping them", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const branch = source.slice(source.indexOf('case "fahali_run_shock_test"'), source.indexOf('case "fahali_get_market_briefing"'));
  for (const field of ["shocks", "horizon", "shockSymbol", "shockPct"]) {
    assert.match(branch, new RegExp(`a\\?\\.${field}`), `${field} is not passed through the MCP dispatcher`);
  }
});

test("a partial deterministic result is a finding, not NO_COVERAGE", () => {
  const result = classifyAgentPayload("fahali_run_shock_test", {
    status: "PARTIAL",
    dataState: "measured",
    simulations: [],
    requestedScenario: { mode: "deterministic", calculationState: "partial" },
    requestedShocks: [
      { kind: "instrument", calculationState: "measured" },
      { kind: "factor", calculationState: "not_instrumented" },
    ],
    compoundResult: { calculationState: "partial" },
  });
  assert.equal(result.responseState, "PARTIAL");
  assert.equal(result.dataState, "partial");
});

test("output contract exposes deterministic results and nullable legacy fields", () => {
  const properties = shockTool.outputSchema.properties;
  for (const key of ["requestedScenario", "requestedShocks", "compoundResult", "requestedShock", "responseState", "dataState"]) {
    assert.ok(properties[key], `${key} missing from shock output schema`);
  }
  assert.deepEqual(properties.capitalAtRisk.type, ["number", "null"]);
  assert.deepEqual(properties.simulations.items.properties.probability.type, ["number", "null"]);
});


test("a SHORT position is expressible, and the request body carries it", () => {
  /**
   * The server has applied signed exposure since f99e7536be and REFUSES a
   * negative market_value with "express direction with side=long or
   * side=short" — but `side` was absent from this tool's inputSchema until
   * 2026-08-29. The only documented way to express direction was refused, and
   * the working way was undiscoverable from the schema.
   *
   * Measured live the same day, $10,000 NVDA at -20%: long -> -$2,000,
   * short -> +$2,000, exact hedge -> $0.
   */
  const AjvConstructor: any = Ajv;
  const ajv = new AjvConstructor({ strict: false });
  addFahaliSchemaFormats(ajv);
  const validate = ajv.compile(shockTool.inputSchema);

  const hedged = {
    positions: [
      { symbol: "NVDA", market_value: 10000, side: "long" },
      { symbol: "NVDA", market_value: 10000, side: "short" },
    ],
    shocks: [{ kind: "instrument", instrument: "NVDA", movePct: -20 }],
  };
  assert.equal(validate(hedged), true, JSON.stringify(validate.errors));

  // A negative market_value is the wrong way to say "short" and must not
  // validate — the server refuses it, so accepting it here would only move the
  // failure later.
  assert.equal(
    validate({ positions: [{ symbol: "NVDA", market_value: -10000 }], shocks: hedged.shocks }),
    false,
    "a negative market_value must be rejected; direction belongs in `side`",
  );

  // The schema must actually offer the enum, or an agent cannot discover it.
  const sideSchema = shockTool.inputSchema.properties.positions.items.properties.side;
  assert.deepEqual(sideSchema.enum, ["long", "short"]);

  // And the proxy must carry it through to the server.
  const body = buildShockTestRequestBody(undefined, hedged.positions as any, hedged.shocks);
  assert.deepEqual((body.positions as any[])[1].side, "short");
});
