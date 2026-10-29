import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { TOOL_DEFINITIONS, annotationsForTool, requiredOAuthScopesForTool } from "./tools.js";
import { addFahaliSchemaFormats } from "./ajvFormats.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const find = (n: string) => (TOOL_DEFINITIONS as any[]).find((t) => t.name === n);

test("both engine tools are advertised, read-only, market-scoped, with compact reading rules", () => {
  for (const name of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    const t = find(name);
    assert.ok(t, name);
    assert.equal(annotationsForTool(name).readOnlyHint, true);
    assert.deepEqual(requiredOAuthScopesForTool(name), ["read:market"]);
    assert.match(t.description, /unmeasured/i);
    assert.match(t.description, /own judged/i);
    assert.doesNotMatch(t.description, /\b\d+\s+engines\b/i);
  }
  assert.equal(find("fahali_get_fall_warnings")._meta.endpoint, "/api/engines/fall-warning-8h");
  assert.equal(find("fahali_get_engine_board")._meta.endpoint, "/api/engines/fall_warning_8h/board");
});

test("the output schema accepts a real envelope and rejects a bare-null block", () => {
  const AjvC: any = Ajv; const ajv = new AjvC({ strict: false }); addFahaliSchemaFormats(ajv);
  const validate = ajv.compile(find("fahali_get_fall_warnings").outputSchema);
  const ok = { status: "ok", engine: "fall_warning_8h", asOf: "2026-10-12T07:00:00Z", dataState: "measured",
    roster: { value: { display_name: "x" } }, board: { value: { symbols: {} } }, record: { strata: { value: [] }, grade: { value: null, reason: "no_judged_rows_yet" } }, boardAgeSeconds: 12 };
  assert.equal(validate(ok), true, JSON.stringify(validate.errors));
  const bad = { ...ok, board: { value: null } };
  assert.equal(validate(bad), false);
});

test("dispatch and roster carry both tools", () => {
  const index = readFileSync(join(SRC, "index.ts"), "utf8");
  const roster = readFileSync(join(SRC, "..", "scripts", "tool-roster.mjs"), "utf8");
  for (const name of ["fahali_get_fall_warnings", "fahali_get_engine_board"]) {
    assert.match(index, new RegExp(`case "${name}":`));
    assert.match(roster, new RegExp(name));
  }
  assert.match(index, /version: "1\.28\.0"/);
});
