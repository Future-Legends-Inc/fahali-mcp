import { test } from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

/**
 * "brief" must actually be brief, and what it drops must be DIAGNOSTICS.
 *
 * Measured on production 2026-09-14, a single-symbol detail:"brief" call was
 * 67KB, of which engineRuntimeTelemetry was 40.7% and engineIntelligence 15.6%
 * against 1.0% for the decision itself. Neither could ever be reached by the
 * row cap: both are deeply nested SINGLE objects, and `engines` had length ONE
 * while still weighing 11KB.
 *
 * The line this guards: a compact projection may drop per-engine telemetry, but
 * it may never drop the committee's CONCLUSION, and it must DECLARE whatever it
 * dropped. Silent omission is the failure mode, not size.
 */
const committeePayload = () => ({
  data: [{
    symbol: "BTCUSDT",
    canonical: {
      committee: {
        agreeing: ["momentum"],
        disagreeing: [],
        silent: ["sentiment", "ofi", "microstructure"],
        verdict: {
          direction: "bearish",
          confidence: 0.564,
          confidenceScale: "ensemble_agreement",
          headline: "Downside skew",
        },
        engineRuntimeTelemetry: {
          status: "ok", source: "snapshot", snapshot: { a: 1, b: 2, c: 3 },
          asOf: "2026-09-14T20:00:00.000Z", ageSeconds: 12.5,
        },
        engineIntelligence: {
          schemaVersion: "2", symbol: "BTCUSDT",
          engines: [{ engineKey: "momentum", evidencePackets: [1, 2, 3] }],
        },
      },
    },
  }],
});

const render = (detail: string) =>
  decorateForAgent(
    "fahali_get_symbol_decision",
    { structuredContent: committeePayload(), content: [] } as any,
    { detail } as any,
  ).structuredContent as Record<string, any>;

const committeeOf = (sc: Record<string, any>) => sc.data[0].canonical.committee;

for (const detail of ["brief", "standard"]) {
  test(`${detail} drops per-engine runtime diagnostics`, () => {
    const comm = committeeOf(render(detail));
    assert.equal(comm.engineRuntimeTelemetry.snapshot, undefined);
    assert.equal(comm.engineIntelligence.engines, undefined);
    assert.ok(comm.engineRuntimeTelemetry.omittedEntryCount > 0);
    assert.ok(comm.engineIntelligence.omittedEntryCount > 0);
  });

  test(`${detail} DECLARES what it dropped`, () => {
    const sc = render(detail);
    const omitted = sc.responseControl.omitted ?? {};
    // A silent omission is the defect; the declaration is the whole point.
    assert.ok(
      Object.keys(omitted).some((k) => k.endsWith("engineRuntimeTelemetry")),
      `engineRuntimeTelemetry must appear in responseControl.omitted, got ${JSON.stringify(omitted)}`,
    );
    assert.ok(Object.keys(omitted).some((k) => k.endsWith("engineIntelligence")));
  });

  test(`${detail} never drops the committee CONCLUSION`, () => {
    const comm = committeeOf(render(detail));
    assert.deepEqual(comm.agreeing, ["momentum"]);
    assert.deepEqual(comm.disagreeing, []);
    assert.equal(comm.silent.length, 3);
    assert.equal(comm.verdict.direction, "bearish");
    assert.equal(comm.verdict.confidence, 0.564);
    assert.equal(comm.verdict.headline, "Downside skew");
  });
}

test("audit keeps the full diagnostics — it is the audit surface", () => {
  const comm = committeeOf(render("audit"));
  assert.deepEqual(comm.engineRuntimeTelemetry.snapshot, { a: 1, b: 2, c: 3 });
  assert.equal(comm.engineIntelligence.engines.length, 1);
  assert.equal(comm.engineRuntimeTelemetry.omittedEntryCount, undefined);
});

test("the compact payload is materially smaller than the audit one", () => {
  const brief = JSON.stringify(render("brief")).length;
  const audit = JSON.stringify(render("audit")).length;
  assert.ok(brief < audit, `brief ${brief} should be smaller than audit ${audit}`);
});

/**
 * The key match is PATH-CONSTRAINED, not bare.
 *
 * Caught in review before it could bite: matching `engineIntelligence` at any
 * depth would stub a payload that legitimately owns a field by that name.
 * fahali_get_engine_status is entirely engine state; replacing a tool's own
 * content with an omission stub is a far worse bug than the bloat.
 */
test("a same-named field OUTSIDE the committee is never stubbed", () => {
  const sc = decorateForAgent(
    "fahali_get_engine_status",
    {
      structuredContent: {
        engineIntelligence: { engines: [{ key: "momentum", status: "firing" }] },
        data: [{ symbol: "BTCUSDT", engineRuntimeTelemetry: { snapshot: { a: 1 } } }],
      },
      content: [],
    } as any,
    { detail: "standard" } as any,
  ).structuredContent as Record<string, any>;

  assert.equal(sc.engineIntelligence.engines.length, 1, "top-level engine state must survive");
  assert.equal(sc.engineIntelligence.omittedEntryCount, undefined);
  assert.deepEqual(sc.data[0].engineRuntimeTelemetry.snapshot, { a: 1 },
    "a row-level field outside canonical.committee must survive");
});
