import { test } from "node:test";
import assert from "node:assert/strict";
import { fallWarningsRequest, engineBoardRequest } from "./engineBoardRequest.js";

test("fall warnings: limit is sent only when finite, truncated, clamped", () => {
  assert.equal(fallWarningsRequest({ limit: null }).params, undefined);
  assert.equal(fallWarningsRequest({ limit: "" }).params, undefined);
  assert.equal(fallWarningsRequest({}).params, undefined);
  assert.equal(fallWarningsRequest({ limit: "abc" }).params, undefined);
  assert.deepEqual(fallWarningsRequest({ limit: 999 }).params, { limit: "200" });
  assert.deepEqual(fallWarningsRequest({ limit: 0 }).params, { limit: "1" });
  assert.deepEqual(fallWarningsRequest({ limit: "5.9" }).params, { limit: "5" });
});

test("fall warnings: symbol is trimmed, upper-cased, encoded", () => {
  assert.equal(fallWarningsRequest({ symbol: " btcusdt " }).path, "/api/engines/fall-warning-8h/BTCUSDT");
  assert.equal(fallWarningsRequest({}).path, "/api/engines/fall-warning-8h");
});

test("engine board: key validated, path built", () => {
  assert.deepEqual(engineBoardRequest({ engine: "fall_warning_8h", symbol: "ethusdt" }), { path: "/api/engines/fall_warning_8h/board/ETHUSDT" });
  assert.deepEqual(engineBoardRequest({ engine: "fall_warning_8h" }), { path: "/api/engines/fall_warning_8h/board" });
  for (const bad of ["../x", "Fall_Warning", "", "a/b"]) assert.ok("error" in engineBoardRequest({ engine: bad }), bad);
  assert.ok("error" in engineBoardRequest({}));
});
