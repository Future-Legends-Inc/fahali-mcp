import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_DEFINITIONS } from "./tools.js";

// A fleet count is operational state, not product copy. The roster has changed
// before and will change again; publishing a literal count makes tool discovery
// stale even while the response itself is correct.
const FIXED_ENGINE_COUNT =
  /\b(?:all\s+)?(?:\d+\s*\/\s*)?\d+(?:-|\s+)(?:(?:current|active|registered|detection|evidence)\s+)*(?:engines?|engine rows?|evidence rows?|agents?|agent rows?)\b/i;

function collectStrings(value: unknown, path = "tool"): Array<{ path: string; value: string }> {
  if (typeof value === "string") return [{ path, value }];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${path}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) => collectStrings(entry, `${path}.${key}`));
}

test("the fixed-engine-count detector catches every previously shipped shape", () => {
  for (const bad of [
    "all 18 evidence rows",
    "all 18 current engine rows",
    "18 engines",
    "18-engine stack",
    "18-agent registry",
    "5/18 engine rows",
  ]) {
    assert.match(bad, FIXED_ENGINE_COUNT, `negative control did not catch: ${bad}`);
  }
});

test("published MCP contracts derive fleet membership from the canonical roster", () => {
  const violations = (TOOL_DEFINITIONS as unknown[])
    .flatMap((tool, index) => collectStrings(tool, `TOOL_DEFINITIONS[${index}]`))
    .filter((entry) => FIXED_ENGINE_COUNT.test(entry.value));

  assert.deepEqual(
    violations,
    [],
    `fixed engine counts reached agent-facing MCP contracts:\n${violations
      .map((entry) => `  ${entry.path}: ${entry.value}`)
      .join("\n")}`,
  );
});
