import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { unsubscribeRisk } from "./proxy.js";
import { annotationsForTool, TOOL_DEFINITIONS } from "./tools.js";

const definitions = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const keyedWrites = [
  "fahali_watch_portfolio",
  "fahali_update_portfolio_watch",
  "fahali_subscribe_risk",
  "fahali_update_subscription",
  "fahali_unsubscribe_risk",
];

test("retryable lifecycle MCP writes require the bounded request identity they advertise", () => {
  for (const name of keyedWrites) {
    const tool: any = definitions.get(name);
    assert.ok(tool, `${name} must remain in the public registry`);
    assert.ok(tool.inputSchema.required.includes("idempotency_key"), `${name} must require idempotency_key`);
    assert.equal(tool.inputSchema.properties.idempotency_key.minLength, 8);
    assert.equal(tool.inputSchema.properties.idempotency_key.maxLength, 128);
    assert.equal(tool.inputSchema.properties.idempotency_key.pattern, "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$");
    assert.equal(annotationsForTool(name).idempotentHint, true, `${name} may claim idempotency only because the key is mandatory`);
  }
});

test("unsubscribe requires an explicit retry identity and refresh reads do not overclaim idempotency", () => {
  const unsubscribe: any = definitions.get("fahali_unsubscribe_risk");
  assert.deepEqual(unsubscribe.inputSchema.required, ["subscription_id", "idempotency_key"]);
  assert.equal(annotationsForTool("fahali_unsubscribe_risk").idempotentHint, true);
  assert.equal(annotationsForTool("fahali_get_portfolio_decision").idempotentHint, false);
  assert.equal(annotationsForTool("fahali_get_watch_delta").idempotentHint, false);
});

test("persistent autonomous watch input is explicitly long-only and fails shorts closed", () => {
  for (const name of ["fahali_watch_portfolio", "fahali_update_portfolio_watch"]) {
    const tool: any = definitions.get(name);
    const position = tool.inputSchema.properties.positions.items;
    assert.deepEqual(position.properties.side.enum, ["long"]);
    assert.equal(position.properties.market_value.exclusiveMinimum, 0);
    assert.equal(position.properties.quantity.minimum, 0);
    assert.match(position.properties.quantity.description, /negative quantities fail closed/i);
    assert.match(position.properties.side.description, /short and hedged watches fail closed/i);
    assert.deepEqual(tool.inputSchema.properties.mandate.properties.can_short, {
      type: "boolean",
      const: false,
      default: false,
      description: "Must remain false. Persistent autonomous watches are long-only until signed-exposure authority is separately certified.",
    });
  }
});

test("unsubscribe sends one request identity in both the DELETE header and JSON body", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = (async (input, init) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({ status: "ok", dataState: "measured" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await unsubscribeRisk(undefined, "subscription-1", {
      idempotency_key: "gate5-unsubscribe-0001",
    });
    assert.equal(result.isError, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(captured);
  const request = captured as { url: string; init?: RequestInit };
  assert.match(request.url, /\/agent\/risk-subscriptions\/subscription-1$/);
  assert.equal(request.init?.method, "DELETE");
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get("Idempotency-Key"), "gate5-unsubscribe-0001");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    idempotency_key: "gate5-unsubscribe-0001",
  });
});

test("generated subscribe secrets document exact-response recovery, not one-shot loss", () => {
  const subscribe: any = definitions.get("fahali_subscribe_risk");
  assert.match(subscribe.description, /recoverable only through the exact authenticated idempotent request/i);
  assert.match(subscribe.inputSchema.properties.signing_secret.description, /recoverable by an exact authenticated idempotent replay/i);
  assert.doesNotMatch(subscribe.inputSchema.properties.signing_secret.description, /returned once/i);
});

test("lifecycle success schemas expose the machine-enforced monitor-only boundary", () => {
  for (const name of [
    ...keyedWrites,
    "fahali_list_portfolio_watches",
    "fahali_get_portfolio_decision",
    "fahali_get_watch_delta",
    "fahali_get_verdict_history",
    "fahali_get_verdict_by_id",
    "fahali_get_evidence",
    "fahali_list_risk_subscriptions",
    "fahali_unsubscribe_risk",
  ]) {
    const schema: any = (definitions.get(name) as any)?.outputSchema;
    assert.ok(schema?.required?.includes("operatingMode"), `${name} must require operatingMode in successful output`);
    assert.ok(schema?.required?.includes("outputClassification"), `${name} must require outputClassification in successful output`);
    assert.ok(schema?.required?.includes("legacyFieldSemantics"), `${name} must classify archived decision field names`);
    assert.deepEqual(schema.properties.operatingMode.enum, ["MONITOR_ONLY"]);
    const classification = schema.properties.outputClassification;
    assert.deepEqual(classification.properties.capitalPath.enum, ["NONE"]);
    assert.deepEqual(classification.properties.executionAuthority.enum, ["NONE"]);
    assert.deepEqual(classification.properties.personalizedRecommendation.enum, [false]);
    assert.deepEqual(classification.properties.portfolioAction.enum, [false]);
    assert.deepEqual(classification.properties.orderAction.enum, [false]);
    assert.deepEqual(classification.properties.executionAllowed.enum, [false]);
    assert.deepEqual(classification.properties.humanFinancialDecisionRequired.enum, [true]);
    assert.deepEqual(schema.properties.legacyFieldSemantics.properties["decision.action"].enum, ["monitoring_escalation_only_not_portfolio_action"]);
  }
});

test("evidence schema requires both immutable-identity drift controls", () => {
  const schema: any = (definitions.get("fahali_get_evidence") as any)?.outputSchema;
  for (const field of ["identityMismatchEvidenceIds", "sourceMaterialMismatchEvidenceIds"]) {
    assert.ok(schema.required.includes(field), `${field} must be present on every successful evidence response`);
    assert.deepEqual(schema.properties[field].type, "array");
    assert.deepEqual(schema.properties[field].items, { type: "string" });
  }
});

test("MCP dispatch forwards watch idempotency and preserves subscription write bodies", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const watchCase = source.slice(source.indexOf('case "fahali_watch_portfolio"'), source.indexOf('case "fahali_list_portfolio_watches"'));
  assert.match(watchCase, /idempotency_key:\s*a\.idempotency_key/);
  for (const [start, end] of [
    ['case "fahali_update_portfolio_watch"', 'case "fahali_get_portfolio_decision"'],
    ['case "fahali_subscribe_risk"', 'case "fahali_list_risk_subscriptions"'],
    ['case "fahali_update_subscription"', 'case "fahali_unsubscribe_risk"'],
    ['case "fahali_unsubscribe_risk"', 'case "fahali_get_capabilities"'],
  ]) {
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(body, /const \{[^}]*\.\.\.body \} = a;/);
    assert.match(body, /\(apiKey,[\s\S]*body\);/);
    assert.doesNotMatch(body, /idempotency_key\s*[,}]/, `${start} must not strip idempotency_key from its forwarded body`);
  }
});
