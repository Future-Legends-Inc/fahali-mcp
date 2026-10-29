/**
 * Guard for `GET /.well-known/jwks.json`.
 *
 * `index.ts` starts an HTTP server on import, and its own note forbids adding a
 * main-module guard to make it importable (`railway.json` sets
 * `restartPolicyMaxRetries: 3`, so a guard that evaluates wrong in the container
 * is three crash-loops and a dead endpoint). So this guard is split the same way
 * `security.test.ts:109-113` splits it, and for the same stated reason:
 *
 *  - ROUTE WIRING is asserted by source shape. Unavoidable for a file that
 *    cannot be imported — but it is only ever used to assert reachability
 *    (registered publicly, GET-only, per-request load), never behaviour.
 *  - THE HONESTY CONTRACT is asserted by BEHAVIOUR on the module that IS
 *    importable. A grep for an identifier would pass even if the computation
 *    were deleted and the name left behind in a comment.
 *
 *   node --import tsx --test mcp-server/src/jwksRoute.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getJwks, loadReceiptKeys } from "./attestation.js";

const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

function jwksRouteBlock(): string {
  const start = index.indexOf('if (req.method === "GET" && url.pathname === "/.well-known/jwks.json"');
  assert.notEqual(start, -1, "GET /.well-known/jwks.json is not registered in index.ts");
  const end = index.indexOf('if (url.pathname === "/register"', start);
  assert.notEqual(end, -1, "could not delimit the JWKS route block");
  return index.slice(start, end);
}

test("the JWKS route is public, GET-only, and answers before the auth-gated /mcp handler", () => {
  const block = jwksRouteBlock();

  assert.match(block, /req\.method === "GET"/);
  assert.match(block, /writeHead\(200/);
  // A discovery document behind an auth challenge is unusable to a verifier.
  assert.doesNotMatch(block, /WWW-Authenticate/);

  const jwksAt = index.indexOf('"/.well-known/jwks.json"');
  const mcpAt = index.indexOf('if (url.pathname === "/mcp")');
  assert.notEqual(mcpAt, -1, "expected the /mcp handler to still be present");
  assert.ok(
    jwksAt < mcpAt,
    "the JWKS route must be registered alongside the other public .well-known routes, before /mcp"
  );
  assert.ok(
    jwksAt > index.indexOf('"/.well-known/oauth-authorization-server"'),
    "JWKS should live with the existing .well-known group"
  );
});

test("an unconfigured server publishes an EMPTY key set plus a reason — never a fabricated key", () => {
  // Behaviour, not shape: this is the contract the route depends on.
  const { keys, report } = loadReceiptKeys({} as NodeJS.ProcessEnv);
  assert.equal(keys, null);
  assert.equal(report.configured, false);

  const jwks = getJwks(keys);
  assert.deepEqual(jwks.keys, []);
  assert.ok(jwks.note, "an empty key set must say why it is empty");

  // The route must pass the LOADER's result, so an unconfigured server cannot
  // reach a populated key set by any other route through the code.
  assert.match(jwksRouteBlock(), /getJwks\(keys\)/);

  // Negative control — the defect this prevents: the server inventing key
  // material so that "signed" receipts become unverifiable after a restart.
  assert.doesNotMatch(index, /generateKeyPairSync|generateKeyPair/);
});

test("keys are loaded per request, not memoized across a deploy", () => {
  const block = jwksRouteBlock();
  assert.match(block, /loadReceiptKeys\(\)/);

  // A module-scope memo would let a deploy that ENABLES signing keep serving a
  // stale empty set — publishing "Fahali signs nothing" over a signing server.
  assert.doesNotMatch(index, /^const \w+ = loadReceiptKeys/m);
  assert.match(
    block,
    /report\.configured \? "public, max-age=300" : "no-store"/,
    "an unconfigured empty set must not be cacheable, or a later deploy is masked"
  );
});
