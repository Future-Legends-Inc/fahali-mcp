import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TOOL_DEFINITIONS } from "./tools.js";

const correlationTool = (TOOL_DEFINITIONS as any[])
  .find((tool) => tool.name === "fahali_get_correlation_matrix");
const contagionTool = (TOOL_DEFINITIONS as any[])
  .find((tool) => tool.name === "fahali_get_contagion_map");
const portfolioTools = (TOOL_DEFINITIONS as any[])
  .filter((tool) => ["fahali_get_portfolio_risk", "fahali_analyze_custom_portfolio"].includes(tool.name));

test("correlation MCP schema exposes every honest artifact failure state", () => {
  assert.ok(correlationTool, "correlation tool must remain advertised");
  const properties = correlationTool.outputSchema?.properties ?? {};

  assert.deepEqual(properties.status?.enum, ["ok", "partial", "withheld", "error"]);
  assert.deepEqual(properties.dataState?.enum, ["measured", "partial", "no_data", "stale", "error"]);
  assert.deepEqual(
    properties.responseState?.enum,
    ["OK_WITH_FINDINGS", "PARTIAL", "OK_NO_FINDINGS", "WITHHELD", "ERROR"],
  );
  assert.deepEqual(
    properties.reason?.enum,
    ["invalid_request", "not_found", "query_failed", "stale", "invalid_artifact"],
  );
  assert.equal(properties.message?.type, "string");
  assert.equal(properties.error?.type, "string");
});

test("contagion schema describes measured association fields and no invented lag", () => {
  assert.ok(contagionTool, "contagion tool must remain advertised");
  const properties = contagionTool.outputSchema?.properties ?? {};
  const edge = properties.edges?.items?.properties ?? {};

  assert.match(contagionTool.description, /lower-tail-dependence association/i);
  // RETARGETED 2026-10-15: the served description leads with intelligence;
  // the association-is-not-causation distinction rides in one compact clause
  // ("precedence, not causation") instead of a lecture paragraph.
  assert.match(contagionTool.description, /precedence, not causation/i);

  // RETARGETED 2026-09-17. This asserted `lagHours.type === "null"` -- a
  // ratchet against the route's old habit of publishing a hardcoded 2/6/12
  // ternary as if it were a measurement. The route now reads a real measured
  // lag out of spectra_lead_lag, so pinning the type to "null" would have
  // failed on the honest implementation and demanded the lie back. The
  // invariant underneath was never "lag is null"; it was ABSENCE MUST STAY
  // EXPRESSIBLE -- an unmeasured pair reads as absent, never as zero hours.
  assert.ok(
    Array.isArray(edge.lagHours?.type) && edge.lagHours.type.includes("null"),
    "an unmeasured pair must be able to report null lag, never a 0 that reads as simultaneous",
  );
  assert.equal(edge.sampleSize?.type, "integer");
  assert.equal(edge.strength?.type, "number");
  assert.equal(edge.correlationStrength, undefined);
  assert.equal(edge.timeToMaterialize, undefined);
  assert.equal(properties.measurement?.type, "object");
});

test("a measured lag is advertised as precedence, and never as causation", () => {
  const edge = contagionTool.outputSchema?.properties?.edges?.items?.properties ?? {};

  // leadSymbol is the end that moved FIRST. The description must not let an
  // agent read that as the thing that CAUSED the move: both instruments may be
  // following a third the graph never sees. This is the one claim in the
  // payload that nothing behind it supports, which is why the route keeps
  // causalDirectionMeasured false while temporalDirectionMeasured goes true.
  assert.ok(edge.leadSymbol, "a measured lag without its leader is a direction with no subject");
  assert.match(edge.leadSymbol.description, /not causation|temporal precedence/i);
  assert.ok(
    Array.isArray(edge.leadSymbol.type) && edge.leadSymbol.type.includes("null"),
    "a pair with no measured ordering must report no leader",
  );
  assert.match(
    contagionTool.description,
    /edgesWithMeasuredLag/,
    "the agent needs the COVERAGE of the measured lag; association edges and lead-lag edges are different graphs and most pairs carry no lag",
  );
});

test("propagation answers where stress starts, travels and arrives -- with its basis", () => {
  const prop = contagionTool.outputSchema?.properties?.propagation;
  assert.ok(prop, "propagation must be advertised or the agent cannot see it at all");

  assert.ok(
    Array.isArray(prop.type) && prop.type.includes("null"),
    "a pass where the producer wrote nothing must be distinguishable from one that found no origins",
  );

  const origin = prop.properties?.origins?.items?.properties ?? {};
  const arrival = origin.arrivals?.items?.properties ?? {};

  assert.equal(arrival.arrivalHours?.type, "number", "WHEN it arrives");
  assert.equal(arrival.path?.type, "array", "WHERE it travels");
  assert.deepEqual(
    arrival.basis?.enum,
    ["measured", "composed"],
    "a composed arrival sums lags that were never tested together -- publishing an hour without its basis is publishing an untested number as a measurement",
  );
  assert.equal(arrival.lagOffGrid?.type, "boolean");
  assert.match(
    arrival.weakestAsymmetry?.description ?? "",
    /minimum/i,
    "a path is as strong as its weakest link; a mean would let one strong hop carry a chain of noise",
  );

  // A refusal is not a balanced score.
  assert.ok(
    Array.isArray(origin.originationScore?.type) && origin.originationScore.type.includes("null"),
    "a symbol with no edges has no score -- 0.0 would read as 'leads and follows equally'",
  );

  // Absence renders as safety unless coverage travels with the claim.
  const eligible = contagionTool.outputSchema?.properties?.symbolsEligible;
  assert.ok(eligible, "origins without the eligible count imply universe-wide coverage");
  assert.match(eligible.description ?? "", /subset|coverage/i);
});

test("stateless portfolio schemas encode non-binding compatibility monitoring", () => {
  assert.equal(portfolioTools.length, 2);
  for (const tool of portfolioTools) {
    const position = tool.outputSchema.properties.positions.items.properties;
    assert.equal(position.correlationToPortfolio.type, "null");
    assert.deepEqual(position.recommendation.properties.binding.enum, [false]);
    assert.deepEqual(position.recommendation.properties.directional.enum, [false]);
    assert.deepEqual(
      position.recommendation.properties.deprecatedSemantics.enum,
      ["monitoring_priority_only"],
    );
  }
});

test("the contagion description has two authors, and they may not drift apart", () => {
  // COMPACT_TOOL_DESCRIPTIONS overwrites tool.description unconditionally, so
  // the detailed description written beside the schema in tools.ts is never
  // sent to any agent. Both were edited together on 2026-09-17; nothing
  // structural stops the next edit landing on the unread one and looking done.
  // This reads the SOURCE, because the built object only ever holds the winner.
  const src = readFileSync(new URL("./tools.ts", import.meta.url), "utf-8");

  const detailed = src.match(
    /"Read the latest one-hour lower-tail-dependence association graph[^"]*"/,
  )?.[0];
  assert.ok(detailed, "the detailed contagion description must remain findable");

  const served = contagionTool.description as string;
  assert.notEqual(
    served,
    detailed,
    "if these ever become identical the compact map is pointless -- delete one author instead",
  );

  // The claims an agent gets WRONG if only one author carries them.
  const loadBearing: Array<[string, RegExp]> = [
    ["non-causation", /not\s+caus/i],
    ["measured-lag coverage", /edgesWithMeasuredLag/],
    ["composed vs measured basis", /composed/i],
    ["graph-vs-universe coverage", /symbolsEligible/],
  ];
  for (const [label, re] of loadBearing) {
    assert.match(served, re, `the SERVED description dropped: ${label}`);
    assert.match(detailed, re, `the detailed description dropped: ${label}`);
  }
});
