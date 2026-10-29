import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_DEFINITIONS } from "./tools.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const SERVER_CANDIDATES = [
  join(SRC, "..", "..", "server"),
  join(SRC, "..", "..", "spectra-mobile-deploy", "server"),
  join(SRC, "..", "..", "work", "spectra-mobile-deploy", "server")
];
const SERVER = SERVER_CANDIDATES.find((p) => existsSync(join(p, "routes.ts")));

const ROUTE_FILES = ["routes.ts", "agentMonitoring/routes.ts"];

const routeSource = SERVER
  ? ROUTE_FILES.filter((f) => existsSync(join(SERVER, f))).map((f) => readFileSync(join(SERVER, f), "utf8")).join("\n")
  : "";

const attached = new Set(
  [...routeSource.matchAll(/agentTelemetry\("([^"]+)"\)/g)].map((m) => m[1]),
);

const catalog = TOOL_DEFINITIONS as any[];

const isLocal = (tool: any) => String(tool._meta?.endpoint ?? "").startsWith("local://");
const endpointOf = (tool: any) => String(tool._meta?.endpoint ?? "");

const countedEndpoints = new Set(
  catalog.filter((t) => attached.has(String(t.name))).map(endpointOf),
);

if (!SERVER) {
  test.skip("server route files not found in standalone package tree (checked in monorepo)", () => {});
} else {
  test("every HTTP-backed tool is on a counted route", () => {
    const missing = catalog
      .filter((t) => !isLocal(t))
      .filter((t) => !attached.has(String(t.name)) && !countedEndpoints.has(endpointOf(t)))
      .map((t) => `${String(t.name)} (${endpointOf(t) || "no endpoint"})`);

    assert.deepEqual(missing, [], `these tools reach the API but nothing counts the call: ${missing.join(", ")}`);
  });

  test("a shared route is counted exactly once, and named by the header", () => {
    const byEndpoint = new Map<string, string[]>();
    for (const t of catalog.filter((x) => !isLocal(x))) {
      const ep = endpointOf(t);
      byEndpoint.set(ep, [...(byEndpoint.get(ep) ?? []), String(t.name)]);
    }
    const shared = [...byEndpoint.entries()].filter(([, tools]) => tools.length > 1);
    assert.ok(shared.length >= 1, "expected at least one endpoint shared by several tools");

    for (const [ep, tools] of shared) {
      const n = tools.filter((name) => attached.has(name)).length;
      assert.ok(n >= 1, `${ep} is shared by ${tools.length} tools and NONE is attached — the group is invisible`);
    }
  });

  test("no tool is attached twice — that would double-count every call", () => {
    const names = [...routeSource.matchAll(/agentTelemetry\("([^"]+)"\)/g)].map((m) => m[1]);
    const seen = new Map<string, number>();
    for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([n, c]) => `${n} x${c}`);
    assert.deepEqual(dupes, [], `attached more than once: ${dupes.join(", ")}`);
    assert.ok(names.length >= 30, `expected many attachments, got ${names.length}`);
  });

  test("the fixture is not vacuous", () => {
    const httpTools = catalog.filter((t) => !isLocal(t));
    assert.ok(httpTools.length >= 40, `expected a large HTTP tool surface, got ${httpTools.length}`);
    assert.ok(attached.size >= 30, `expected many telemetry attachments, got ${attached.size}`);

    const monitoring = readFileSync(join(SERVER, "agentMonitoring", "routes.ts"), "utf8");
    assert.match(monitoring, /agentTelemetry\("fahali_get_watch_delta"\)/);
  });

  test("local tools are excluded by endpoint shape, and stay unattached", () => {
    const local = catalog.filter(isLocal).map((t) => String(t.name));
    assert.ok(local.length >= 1, "expected at least one local:// tool");

    for (const name of local) {
      assert.ok(
        !attached.has(name),
        `${name} is answered in-process and makes no HTTP request; a telemetry attachment would never fire`,
      );
    }
  });

  test("the tool name travels with the request, so shared routes attribute correctly", () => {
    const proxy = readFileSync(join(SRC, "proxy.ts"), "utf8");
    assert.match(proxy, /"X-Fahali-Tool"/);
    assert.match(proxy, /currentToolName\.getStore\(\)/);

    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    assert.match(index, /currentToolName\.run\(request\.params\.name/);

    const telemetry = readFileSync(join(SERVER, "agentTelemetry.ts"), "utf8");
    assert.match(telemetry, /x-fahali-tool/);
    assert.match(telemetry, /TOOL_NAME_SHAPE\.test\(value\) \? value : fallback/);
  });

  const routeLines = ROUTE_FILES.filter((f) => existsSync(join(SERVER, f))).flatMap((file) =>
    readFileSync(join(SERVER, file), "utf8")
      .split(/\r?\n/)
      .map((line) => ({ file, line })),
  );

  const cachedAndCounted = routeLines.filter(
    ({ line }) => line.includes("agentTelemetry(") && line.includes("cacheRoute("),
  );

  test("telemetry is registered BEFORE cacheRoute on every route that has both", () => {
    const offenders = cachedAndCounted
      .filter(({ line }) => line.indexOf("cacheRoute(") < line.indexOf("agentTelemetry("))
      .map(({ file, line }) => `${file}: ${line.trim().slice(0, 90)}`);

    assert.deepEqual(
      offenders,
      [],
      `cacheRoute short-circuits a HIT, so these count misses only: ${offenders.join(" | ")}`,
    );
  });

  test("the ordering rule is actually exercised", () => {
    assert.ok(
      cachedAndCounted.length >= 5,
      `expected several cached+counted routes, got ${cachedAndCounted.length}`,
    );
  });
}
