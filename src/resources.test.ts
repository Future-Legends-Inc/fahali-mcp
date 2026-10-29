import test from "node:test";
import assert from "node:assert/strict";

import { FAHALI_RESOURCES, readFahaliResource } from "./resources.js";

test("Fahali publishes unique, readable MCP resources", () => {
  const uris = FAHALI_RESOURCES.map((resource) => resource.uri);
  assert.equal(new Set(uris).size, uris.length);
  for (const resource of FAHALI_RESOURCES) {
    assert.equal(resource.mimeType, "application/json");
    assert.doesNotThrow(() => JSON.parse(readFahaliResource(resource.uri) ?? ""));
  }
});

test("the response-contract resource contains the load-bearing state machines", () => {
  const contract = JSON.parse(readFahaliResource("fahali://schema/response-contract")!);
  assert.equal(contract.schemaVersion, "2.0");
  assert.equal(contract.responseState.WITHHELD.length > 0, true);
  assert.equal(contract.dataState.not_instrumented.length > 0, true);
  assert.match(contract.absenceRule, /not neutral|not.*safe/i);
  assert.match(contract.recordRule, /engine.*horizon.*claim family/i);
  assert.match(contract.decisionAuthority.bindingDirection, /canonical_verdict.*sole binding/i);
  assert.match(contract.decisionAuthority.bindingConfidence, /only confidence/i);
  assert.match(contract.decisionAuthority.agentVerdict, /non-binding evidence producer/i);
  assert.match(contract.decisionAuthority.committeeVerdict, /non-binding evidence/i);
  assert.match(contract.outputDetail.audit, /^Default\./);
  assert.doesNotMatch(contract.outputDetail.brief, /^Default\./);
});

test("the glossary resolves fields agents must not infer from their names", () => {
  const glossary = JSON.parse(readFahaliResource("fahali://schema/glossary")!);
  for (const field of [
    "confidence",
    "confidenceProducer",
    "confidenceRole",
    "bindingConfidence",
    "bindingConfidenceProducer",
    "masterAgentEvidence",
    "correlationWithMarket",
    "glowIntensity",
    "proximity",
    "claimTier",
    "dataOrigin",
    "provenanceHash",
  ]) {
    assert.equal(typeof glossary[field], "string", `${field} is missing from the glossary`);
    assert.ok(glossary[field].length > 20, `${field} has no usable definition`);
  }
  assert.match(glossary.confidence, /agent_verdict.*non-binding.*never the decision confidence/i);
  assert.match(glossary.bindingConfidence, /only market-decision confidence/i);
  assert.match(glossary.masterAgentEvidence, /non-binding evidence/i);
  assert.match(glossary.matchedTrackRecord, /canonical_verdict.*sole binding authority/i);
  assert.match(glossary.matchedTrackRecord, /agent_verdict and committee_verdict remain evidence producers/i);
});

test("unknown resource URIs fail closed", () => {
  assert.equal(readFahaliResource("fahali://schema/not-real"), null);
});
