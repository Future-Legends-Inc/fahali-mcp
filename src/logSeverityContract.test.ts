/**
 * Railway classifies stderr as error-level output. MCP's hosted transport used
 * to write every normal start/connect/disconnect event through console.error,
 * making healthy sessions indistinguishable from failures in production logs.
 *
 * Stdio is the deliberate exception: stdout is the JSON-RPC frame channel, so
 * even an informational line there corrupts the MCP protocol. These assertions
 * keep the two transport contracts separate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

function block(startMarker: string, endMarker: string): string {
  const start = SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return SOURCE.slice(start, end);
}

test("hosted startup and session lifecycle events are informational", () => {
  const hosted = block("async function runSSE", "const PORT =");
  const normalMarkers = [
    "keyless introspection session",
    "HTTP session initialized",
    "HTTP session closed",
    "SSE client connected",
    "SSE client disconnected",
    "SSE server listening",
    "per-connection auth via Authorization header is required",
  ];

  for (const marker of normalMarkers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      hosted,
      new RegExp(`console\\.info\\([\\s\\S]{0,180}${escaped}`),
      `${marker} is normal hosted lifecycle output and must go to stdout`,
    );
    assert.doesNotMatch(
      hosted,
      new RegExp(`console\\.error\\([\\s\\S]{0,180}${escaped}`),
      `${marker} must not appear as an error-level Railway event`,
    );
  }
});

test("real hosted transport failures remain error-level", () => {
  const hosted = block("async function runSSE", "const PORT =");
  for (const marker of [
    "oauth] table init error",
    "inactive HTTP session close failed",
    "/mcp handler error",
  ]) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      hosted,
      new RegExp(`console\\.error\\([\\s\\S]{0,180}${escaped}`),
      `${marker} is a real failure and must remain on stderr`,
    );
  }
});

test("stdio lifecycle logging stays off the JSON-RPC stdout channel", () => {
  const stdio = block("async function runStdio", "async function runSSE");
  assert.match(stdio, /console\.error\([\s\S]*?stdio transport connected/);
  assert.doesNotMatch(stdio, /console\.(?:log|info)\([\s\S]*?stdio transport connected/);
});
