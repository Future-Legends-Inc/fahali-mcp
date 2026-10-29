import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { liveAuthContext } from "./responseOptions.js";
import {
  HttpInputError,
  credentialFingerprint,
  credentialFingerprintMatches,
  readJsonBody,
  validateClientRegistration,
  validateCodeChallenge,
  validateRedirectUri,
  validateScopes,
  DEFAULT_AUTHORIZE_SCOPES,
  ALLOWED_OAUTH_SCOPES,
} from "./security.js";

function request(body: string, headers: Record<string, string> = {}): any {
  const stream = Readable.from([Buffer.from(body)]) as Readable & {
    headers: Record<string, string>;
  };
  stream.headers = headers;
  return stream;
}

test("MCP request bodies are bounded before parsing", async () => {
  await assert.rejects(
    () => readJsonBody(request("{}", { "content-length": String(1024 * 1024 + 1) })),
    (error: unknown) => error instanceof HttpInputError && error.status === 413,
  );
  await assert.rejects(
    () => readJsonBody(request("{")),
    (error: unknown) => error instanceof HttpInputError && error.status === 400,
  );
});

test("OAuth redirect URIs reject credentials, fragments, and insecure remote HTTP", () => {
  assert.equal(validateRedirectUri("https://client.example/callback"), "https://client.example/callback");
  assert.equal(validateRedirectUri("http://localhost:8787/callback"), "http://localhost:8787/callback");
  for (const uri of [
    "http://client.example/callback",
    "https://user:pass@client.example/callback",
    "https://client.example/callback#fragment",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => validateRedirectUri(uri), HttpInputError);
  }
});

test("dynamic client registration is bounded", () => {
  const registration = validateClientRegistration({
    redirect_uris: ["https://client.example/callback"],
    client_name: "Risk agent",
  });
  assert.equal(registration.redirect_uris.length, 1);
  assert.throws(
    () => validateClientRegistration({ redirect_uris: Array(11).fill("https://client.example/callback") }),
    HttpInputError,
  );
});

test("OAuth scope and PKCE inputs are allowlisted", () => {
  assert.deepEqual(
    validateScopes("read:market read:portfolio read:memory read:delivery write:memory write:alerts write:portfolio write:delivery"),
    ["read:market", "read:portfolio", "read:memory", "read:delivery", "write:memory", "write:alerts", "write:portfolio", "write:delivery"],
  );
  assert.throws(() => validateScopes("write:trades"), HttpInputError);
  assert.equal(validateCodeChallenge("a".repeat(43)), "a".repeat(43));
  assert.throws(() => validateCodeChallenge("short"), HttpInputError);
});

test("credential fingerprints remain constant-time helpers for static API-key identity", () => {
  const expected = credentialFingerprint("fahali_oat_secret");
  assert.equal(credentialFingerprintMatches(expected, "fahali_oat_secret"), true);
  assert.equal(credentialFingerprintMatches(expected, "fahali_oat_attacker"), false);
  assert.equal(credentialFingerprintMatches(expected, undefined), false);
});

test("hosted MCP sessions validate credentials before allocating transport state", () => {
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("./oauth/store.ts", import.meta.url), "utf8");
  assert.match(index, /oauthStore\.isActiveApiKey\(raw\)/);
  assert.match(store, /WHERE key_hash = \$1 AND revoked_at IS NULL/);
  assert.match(index, /MAX_ACTIVE_TRANSPORT_SESSIONS/);
  assert.match(index, /mcp-init:global/);
  assert.match(index, /X-Content-Type-Options/);
  assert.match(index, /Strict-Transport-Security/);
  assert.match(index, /Content-Security-Policy/);
  assert.doesNotMatch(index, /session initialized \(\$\{newId\}/);
});

test("OAuth reconnect reuses a valid key instead of clearing it unconditionally", () => {
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const callback = index.slice(
    index.indexOf("Authorize callback"),
    index.indexOf("if (url.pathname === \"/token\""),
  );
  assert.doesNotMatch(callback, /clearUserKey\(/);
  assert.match(callback, /autoProvisionApiKey/);
});

test("auth failures are typed and OAuth lifetime is visible before a workflow dies", () => {
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("./oauth/store.ts", import.meta.url), "utf8");
  for (const code of ["AUTH_REQUIRED", "AUTH_EXPIRED", "AUTH_INVALID", "AUTH_SCOPE", "AUTH_SERVICE_UNAVAILABLE", "SESSION_EXPIRED"]) {
    assert.match(index, new RegExp(code), `${code} is not distinguishable at the transport boundary`);
  }
  // `secondsRemaining` used to be grepped for in index.ts. That asserted a
  // STRING in a FILE: it broke when the (unchanged) function moved to
  // responseOptions.ts, and it would have PASSED had the computation been
  // deleted and the identifier left behind in a comment. Now that the module is
  // importable without starting a server, assert the behaviour it stands for.
  const ctx = liveAuthContext({
    credentialType: "oauth",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    refreshSupported: true,
  });
  assert.ok(
    typeof ctx.secondsRemaining === "number" && ctx.secondsRemaining > 90 && ctx.secondsRemaining <= 120,
    "an agent cannot avoid starting a workflow its credential will not outlive unless the lifetime is computed",
  );
  const noExpiry = liveAuthContext({
    credentialType: "process_key",
    expiresAt: null,
    refreshSupported: false,
  });
  assert.equal(
    noExpiry.secondsRemaining,
    null,
    "no expiry must read as null, NEVER 0 — 0 means 'expired now' and would make a valid credential look dead",
  );
  assert.match(index, /refreshSupported/);
  assert.match(index, /reauthUrl/);
  assert.match(index, /X-Request-ID/);
  assert.match(index, /sameAuthenticatedPrincipal/);
  assert.match(index, /lastSeen/);
  assert.match(index, /SESSION_IDLE_TIMEOUT_MS/);
  assert.match(index, /inactive HTTP session close failed/);
  assert.doesNotMatch(index, /credentialHash/);
  assert.doesNotMatch(index, /credentialFingerprintMatches/);
  assert.match(store, /WHERE token_hash = \$1 AND token_type = 'access'`/);
  assert.match(store, /INTERVAL '7 days'/, "expired tokens vanish too early to classify AUTH_EXPIRED");
});

// --- The default grant --------------------------------------------------------
//
// Measured live 2026-08-29: a session holding read:market + read:portfolio had
// TWELVE tools refused before dispatch, including fahali_get_watch_delta and
// fahali_get_portfolio_decision — the two this server's own instructions name
// as the default repeat read. The /authorize default was one scope, written in
// two places.

test("a client that omits scope gets EVERY supported scope, not the floor", () => {
  const granted = validateScopes(DEFAULT_AUTHORIZE_SCOPES);
  assert.deepEqual(
    [...granted].sort(),
    ["read:delivery", "read:market", "read:memory", "read:portfolio",
     "write:alerts", "write:delivery", "write:memory", "write:portfolio"],
    "the omit-scope default must be the full supported set",
  );
});

test("REGRESSION: the default is not a single read scope", () => {
  assert.notDeepEqual(validateScopes(DEFAULT_AUTHORIZE_SCOPES), ["read:market"]);
  assert.ok(DEFAULT_AUTHORIZE_SCOPES.includes("write:portfolio"),
    "without write:portfolio the whole watch -> delta -> decision loop stays blocked");
});

test("DRIFT: a newly supported scope is in the default automatically", () => {
  // The default is derived from FAHALI_OAUTH_SCOPES, never restated. If someone
  // adds a scope and hand-maintains a second list, this catches it.
  const supported = [...ALLOWED_OAUTH_SCOPES].sort();
  assert.deepEqual(validateScopes(DEFAULT_AUTHORIZE_SCOPES).sort(), supported);
});

test("🔴 an EMPTY scope is refused, never silently substituted", () => {
  // validateScopes is also the re-validation boundary for the signed assertion
  // and for refresh_token. `body.scope = ""` on refresh used to come back as
  // ["read:market"] — silently narrowing a live 8-scope connector to one, with
  // no error raised anywhere.
  for (const empty of ["", "   ", null, undefined]) {
    assert.throws(() => validateScopes(empty), HttpInputError, `empty scope accepted: ${String(empty)}`);
  }
  // Negative control: a real scope still validates, so the throws above are
  // about emptiness and not a blanket rejection.
  assert.deepEqual(validateScopes("read:market"), ["read:market"]);
});

test("SOURCE: no second author re-inlines the old floor", () => {
  // The defect was the SAME default in two files. A future edit that reinstates
  // either one silently reverts the fix, and no behavioural test would notice
  // because the constant would still be correct.
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const security = readFileSync(new URL("./security.ts", import.meta.url), "utf8");
  for (const [name, src] of [["index.ts", index], ["security.ts", security]] as const) {
    assert.doesNotMatch(src, /\|\|\s*"read:market"/,
      `${name} re-inlines the single-scope floor instead of using DEFAULT_AUTHORIZE_SCOPES`);
  }
  assert.match(index, /DEFAULT_AUTHORIZE_SCOPES/, "the /authorize handler must use the shared default");
});
