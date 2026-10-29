import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import Ajv from "ajv";

import {
  FAHALI_CAPABILITY_WORKFLOWS,
  TOOL_DEFINITIONS,
  annotationsForTool,
  buildToolTaxonomy,
  executableCapabilityWorkflows,
  requiredOAuthScopesForTool,
} from "./tools.js";
import { addFahaliSchemaFormats } from "./ajvFormats.js";

const catalog = TOOL_DEFINITIONS as any[];
const byName = new Map(catalog.map((tool) => [String(tool.name), tool]));

test("canonical decision tools are thin aliases over one verdict contract", () => {
  const verdict = byName.get("fahali_get_market_verdict");
  const market = byName.get("fahali_get_market_decision");
  const symbol = byName.get("fahali_get_symbol_decision");

  assert.ok(verdict);
  assert.ok(market);
  assert.ok(symbol);
  assert.equal(market.outputSchema, verdict.outputSchema);
  assert.equal(symbol.outputSchema, verdict.outputSchema);
  assert.equal(market._meta.aliasOf, "fahali_get_market_verdict");
  assert.equal(symbol._meta.aliasOf, "fahali_get_market_verdict");
  assert.deepEqual(symbol.inputSchema.required, ["symbol"]);

  for (const name of [market.name, symbol.name]) {
    assert.deepEqual(requiredOAuthScopesForTool(name), ["read:market"]);
    assert.deepEqual(annotationsForTool(name), {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.equal(byName.get(name)._meta.surfaceRole, "primary");
    assert.equal(byName.get(name)._meta.canonicalEntryPoint, true);
  }
});

test("decision schemas advertise complete committee and canonical-roster operating evidence", () => {
  const verdict = byName.get("fahali_get_market_verdict");
  const canonical = verdict.outputSchema.properties.data.items.properties.canonical;
  const row = verdict.outputSchema.properties.data.items.properties;
  const compatibilityVerdict = row.verdict.properties;
  const committee = canonical.properties.committee;
  const intelligence = committee.properties.engineIntelligence;
  const runtime = committee.properties.engineRuntimeTelemetry;
  const committeeVerdict = committee.properties.verdict;
  const missingDecision = verdict.outputSchema.properties.notReturned.items.properties;

  assert.ok(canonical.properties.explanation, "canonical explanation is accepted but undiscoverable");
  assert.ok(canonical.properties.probabilities, "canonical forecast distribution is undiscoverable");
  assert.ok(canonical.properties.record, "canonical judged record is undiscoverable");
  assert.ok(canonical.properties.invalidation, "canonical invalidation is undiscoverable");
  assert.deepEqual(compatibilityVerdict.confidenceProducer.enum, ["agent_verdict"]);
  assert.deepEqual(compatibilityVerdict.confidenceRole.enum, ["legacy_master_evidence_non_binding"]);
  assert.deepEqual(compatibilityVerdict.bindingConfidenceProducer.enum, ["canonical_verdict", null]);
  assert.match(compatibilityVerdict.confidence.description, /non-binding.*never decision confidence/i);
  assert.match(compatibilityVerdict.bindingConfidence.description, /only decision confidence/i);
  assert.match(canonical.properties.compositeConfidencePct.description, /only confidence.*binding market decision/i);
  assert.ok(compatibilityVerdict.masterAgentEvidence, "nested master-agent evidence is undiscoverable");
  assert.ok(row.masterAgentEvidence, "row-level master-agent evidence is undiscoverable");
  assert.match(row.masterAgentEvidence.description, /non-binding inputs/i);
  assert.ok(committeeVerdict.properties.actionOptions, "full committee actions are undiscoverable");
  assert.ok(committeeVerdict.properties.invalidationConditions, "full committee invalidation is undiscoverable");
  assert.ok(committeeVerdict.properties.evidence, "full committee evidence is undiscoverable");

  assert.equal(intelligence.properties.coverage.properties.expectedEngines.type, "integer");
  assert.equal(intelligence.properties.coverage.properties.expectedEngines.enum, undefined);
  assert.equal(intelligence.properties.coverage.properties.emittedEngines.enum, undefined);
  assert.deepEqual(
    intelligence.properties.coverage.properties.completeMeaning.enum,
    ["all_canonical_roster_entries_emitted"],
  );
  assert.equal(intelligence.properties.engines.minItems, 1);
  assert.equal(intelligence.properties.engines.maxItems, undefined);
  const engine = intelligence.properties.engines.items.properties;
  assert.ok(engine.operationalStatus);
  assert.ok(engine.freshness);
  assert.ok(engine.evidencePackets);
  assert.ok(engine.evidencePackets.items.properties.contributingRawSignals);
  assert.ok(runtime.properties.status);
  assert.ok(runtime.properties.snapshot);
  assert.ok(missingDecision.engineRuntimeTelemetry, "unjudged requested symbols lose their runtime evidence");
  assert.deepEqual(missingDecision.bindingDecision.properties.direction.type, "null");
  assert.deepEqual(missingDecision.bindingDecision.properties.producer.enum, ["canonical_verdict"]);
  assert.match(verdict.description, /notReturned.*runtime telemetry/i);

  const conviction = byName.get("fahali_get_highest_conviction_signals");
  const directCommittee = conviction.outputSchema.properties.verdicts.items.properties;
  assert.ok(directCommittee.committee);
  assert.ok(directCommittee.engineIntelligence);
  assert.ok(directCommittee.engineRuntimeTelemetry);
  assert.match(verdict.description, /sole direction authority/i);
  assert.match(conviction.description, /non-binding committee/i);

  for (const name of [
    "fahali_get_market_verdict",
    "fahali_get_market_decision",
    "fahali_get_symbol_decision",
    "fahali_get_highest_conviction_signals",
  ]) {
    const detail = byName.get(name).inputSchema.properties.detail;
    assert.equal(detail.default, "audit", `${name} lost the full-fidelity default`);
    assert.equal(byName.get(name).inputSchema.properties.include_withheld.default, true);
  }
});

test("primary, audit, and operations taxonomy is live, disjoint, and exhaustive", () => {
  const taxonomy = buildToolTaxonomy(catalog);
  assert.deepEqual(taxonomy.primary.tools.slice(0, 2), [
    "fahali_get_market_decision",
    "fahali_get_symbol_decision",
  ]);
  assert.ok(taxonomy.audit.tools.includes("fahali_get_market_verdict"));
  assert.ok(taxonomy.audit.tools.includes("fahali_get_engine_status"));
  assert.ok(taxonomy.operations.tools.includes("fahali_subscribe_risk"));

  const classified = [
    ...taxonomy.primary.tools,
    ...taxonomy.audit.tools,
    ...taxonomy.operations.tools,
  ];
  const live = catalog
    .filter((tool) => tool?._meta?.disabled !== true)
    .map((tool) => String(tool.name));
  assert.equal(new Set(classified).size, classified.length, "a tool appears in more than one surface role");
  assert.deepEqual([...classified].sort(), [...live].sort(), "taxonomy omitted or invented a live tool");

  for (const role of ["primary", "audit", "operations"] as const) {
    for (const name of taxonomy[role].tools) assert.equal(byName.get(name)?._meta?.surfaceRole, role);
  }
});

test("every advertised capability workflow is executable against the live registry", () => {
  const executable = executableCapabilityWorkflows(catalog);
  assert.equal(executable.length, FAHALI_CAPABILITY_WORKFLOWS.length);

  const AjvConstructor: any = Ajv;
  const ajv = new AjvConstructor({ strict: false });
  addFahaliSchemaFormats(ajv);
  for (const workflow of executable) {
    assert.ok(workflow.steps.length > 0, `${workflow.id} has no calls`);
    for (const step of workflow.steps) {
      const tool = byName.get(step.tool);
      assert.ok(tool, `${workflow.id} references missing ${step.tool}`);
      assert.notEqual(tool._meta?.disabled, true, `${workflow.id} references disabled ${step.tool}`);
      const validate = ajv.compile(tool.inputSchema);
      assert.equal(
        validate(step.arguments),
        true,
        `${workflow.id}/${step.tool}: ${ajv.errorsText(validate.errors)}`,
      );
    }
  }
});

test("dispatcher and capabilities route agents through the canonical judgment path", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /case "fahali_get_market_decision"/);
  assert.match(source, /case "fahali_get_symbol_decision"/);
  assert.match(source, /recommendedStart: "fahali_get_market_decision"/);
  assert.match(source, /buildToolTaxonomy\(TOOL_DEFINITIONS as any\[\]\)/);
  assert.match(source, /executableCapabilityWorkflows\(TOOL_DEFINITIONS as any\[\]\)/);
});

test("public discovery omits compatibility-only names and participant-identity proxy labels", () => {
  const retiredNames = [
    "fahali_get_72h_forecast",
    "fahali_get_dark_pool_activity",
    "fahali_get_smart_money_dashboard",
    "fahali_get_whale_activity",
    "fahali_get_institutional_risk_score",
  ];
  const discovery = JSON.stringify(catalog);
  for (const name of retiredNames) {
    assert.ok(!byName.has(name), `${name} must remain dispatch-only`);
    assert.ok(!discovery.includes(name), `${name} leaked through a public tool description or schema`);
  }
  for (const label of [/dark[ -]?pool/i, /\bwhale\b/i, /smart[ -]?money/i, /institutional (?:flow|activity|buying|selling|risk)/i]) {
    assert.doesNotMatch(discovery, label);
  }

  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const capabilityBlock = indexSource.slice(
    indexSource.indexOf("async function capabilitiesResult"),
    indexSource.indexOf("function buildServer", indexSource.indexOf("async function capabilitiesResult")),
  );
  assert.doesNotMatch(capabilityBlock, /deprecatedAliases/);
  for (const name of retiredNames) assert.ok(!capabilityBlock.includes(name));

  // Compatibility is intentionally retained at dispatch, outside discovery.
  for (const name of retiredNames) assert.match(indexSource, new RegExp(`case "${name}"`));
});

test("current MCP and LLM documentation uses canonical names and live proof-tool tiers", () => {
  const docUrls = [
    new URL("../README.md", import.meta.url),
    new URL("../llms.txt", import.meta.url),
    new URL("../../server/llms-full.ts", import.meta.url),
    new URL("../../landing-static/llms.txt", import.meta.url),
    new URL("../../landing-static/llms-full.txt", import.meta.url),
  ];
  const currentDocs = docUrls
    .filter((u) => existsSync(u))
    .map((u) => readFileSync(u, "utf8"))
    .join("\n");

  for (const name of [
    "fahali_get_72h_forecast",
    "fahali_get_dark_pool_activity",
    "fahali_get_smart_money_dashboard",
    "fahali_get_whale_activity",
    "fahali_get_institutional_risk_score",
  ]) {
    assert.ok(!currentDocs.includes(name), `${name} leaked into current public documentation`);
  }
  for (const label of [/dark[ -]?pool/i, /\bwhale\b/i, /smart[ -]?money/i, /institutional (?:flow|activity|buying|selling|risk)/i]) {
    assert.doesNotMatch(currentDocs, label);
  }

  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
  assert.match(readme, /`fahali_get_track_record_scorecard`[^\n]*\| Professional \|/);
  assert.match(readme, /`fahali_get_case_studies`[^\n]*\| Professional \|/);
  assert.match(llms, /fahali_get_track_record_scorecard[^\n]*\(Professional\)/);
  assert.match(llms, /fahali_get_case_studies[^\n]*\(Professional\)/);

  const archiveUrl = new URL("../../docs/all-endpoints.md", import.meta.url);
  if (existsSync(archiveUrl)) {
    const archive = readFileSync(archiveUrl, "utf8");
    assert.match(archive, /^# Fahali API — Archived Endpoint Inventory/m);
    assert.match(archive, /ARCHIVAL SNAPSHOT — NOT CURRENT API DOCUMENTATION/i);
    assert.match(archive, /Do not use it for product discovery/i);
  }
});
