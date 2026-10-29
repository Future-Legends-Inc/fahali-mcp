import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";

import { TOOL_DEFINITIONS } from "./tools.js";
import { addFahaliSchemaFormats } from "./ajvFormats.js";

const tool = (TOOL_DEFINITIONS as any[]).find(
  (candidate) => candidate.name === "fahali_get_engine_status",
);
assert.ok(tool, "engine-status tool must remain registered");

const AjvConstructor: any = Ajv;
const ajv = new AjvConstructor({ strict: false });
addFahaliSchemaFormats(ajv);
const validate = ajv.compile(tool.outputSchema);

function partialPayload() {
  return {
    status: "partial",
    data_state: "partial",
    asof: "2026-08-31T12:00:00.000Z",
    engines: [{
      key: "cascade_engine",
      name: "Cascade Engine",
      status: "partial",
      data_state: "partial",
      count_1h: null,
      count_24h: null,
      count_7d: null,
      last_fired: null,
      compute: {},
      judgment: {
        data_state: "partial",
        registrations_1h: null,
        registrations_24h: null,
        registrations_7d: null,
        resolutions_24h: null,
        resolutions_7d: null,
        last_registered_at: null,
        last_resolved_at: null,
      },
      publication: {
        data_state: "partial",
        attribution: "alert_type_proxy",
        alerts_1h: null,
        alerts_24h: null,
        alerts_7d: null,
        last_published_at: null,
      },
      interpretation: "Coverage is incomplete.",
    }],
    attribution: {
      alerts_7d_total: null,
      alerts_7d_attributed: null,
      alerts_7d_unattributed: null,
      alerts_7d_mixed_bucket: null,
      unattributed_pct: null,
      no_alerts_in_window: null,
      alert_types_known: 43,
      note: "diagnostic",
    },
    unmapped_alert_types: null,
    unmatched_subsystem_heartbeats: [],
    probe_errors: [{ source: "engine_health_activity_rollup", error: "window_incomplete" }],
    agent_authored_excluded: {
      alerts_7d: null,
      distinct_types_7d: null,
      note: "excluded",
    },
  };
}

test("engine-status schema accepts null only for fallible measurements", () => {
  const payload = partialPayload();
  assert.equal(validate(payload), true, ajv.errorsText(validate.errors));

  const invalidIdentity = partialPayload();
  invalidIdentity.engines[0].key = null as any;
  assert.equal(validate(invalidIdentity), false, "engine identity must never become nullable");

  const invalidStatus = partialPayload();
  invalidStatus.status = null as any;
  assert.equal(validate(invalidStatus), false, "response status must never become nullable");

  const invalidInterpretation = partialPayload();
  invalidInterpretation.engines[0].interpretation = null as any;
  assert.equal(validate(invalidInterpretation), false, "semantic labels must never become nullable");
});

test("engine-status schema rejects fabricated numeric strings in incomplete fields", () => {
  const payload = partialPayload();
  payload.engines[0].count_7d = "0" as any;
  assert.equal(validate(payload), false, "a string zero must not bypass count nullability");
});
