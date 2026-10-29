import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FahaliOAuthProvider,
  refreshScopesForGrant,
  sameAuthenticatedPrincipal,
} from "./oauth/provider.js";
import {
  FAHALI_OAUTH_SCOPES,
  TOOL_DEFINITIONS,
  annotationsForTool,
  requiredOAuthScopesForTool,
} from "./tools.js";

test("refresh token rotation preserves or narrows scope but never expands it", () => {
  const grant = ["read:market", "read:portfolio", "write:portfolio"];
  assert.deepEqual(refreshScopesForGrant(grant), grant);
  assert.deepEqual(
    refreshScopesForGrant(grant, ["read:portfolio", "write:portfolio"]),
    ["read:portfolio", "write:portfolio"],
  );
  assert.throws(
    () => refreshScopesForGrant(grant, ["write:delivery"]),
    /invalid_scope/,
  );
});

test("session identity follows principal and OAuth client, not access-token bytes", () => {
  const original = {
    principalId: "user-123",
    clientId: "oauth-client-a",
    credentialType: "oauth" as const,
  };
  assert.equal(sameAuthenticatedPrincipal(original, { ...original }), true);
  assert.equal(
    sameAuthenticatedPrincipal(original, { ...original, clientId: "oauth-client-b" }),
    false,
  );
  assert.equal(
    sameAuthenticatedPrincipal(original, { ...original, principalId: "user-456" }),
    false,
  );
});

test("verifyAccessToken reports the persisted expiry instead of minting a new lifetime", async () => {
  const expiresAt = new Date(Date.now() + 17 * 60_000).toISOString();
  const store = {
    getAccessToken: async () => ({
      userId: "user-123",
      clientId: "oauth-client-a",
      scope: ["read:market"],
      expires_at: expiresAt,
    }),
  } as any;
  const provider = new FahaliOAuthProvider(store);
  const info = await provider.verifyAccessToken("rotated-token-not-logged");
  assert.equal(info.expiresAt, Math.floor(new Date(expiresAt).getTime() / 1000));
  assert.deepEqual(info.scopes, ["read:market"]);
});

test("refresh exchange consumes once and persists the narrowed grant", async () => {
  const queries: string[] = [];
  const savedScopes: string[][] = [];
  const store = {
    pool: {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT scope")) {
          return { rows: [{ scope: ["read:market", "read:portfolio", "write:portfolio"] }] };
        }
        if (sql.includes("DELETE FROM mcp_oauth_tokens")) {
          return { rows: [{ user_id: "user-123", scope: ["read:market", "read:portfolio", "write:portfolio"] }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
    saveAccessToken: async (_token: string, _userId: string, _clientId: string, scopes: string[]) => {
      savedScopes.push(scopes);
    },
    saveRefreshToken: async (_token: string, _userId: string, _clientId: string, scopes: string[]) => {
      savedScopes.push(scopes);
    },
  } as any;
  const provider = new FahaliOAuthProvider(store);
  const tokens = await provider.exchangeRefreshToken(
    { client_id: "oauth-client-a" } as any,
    "refresh-token-value",
    ["read:portfolio", "write:portfolio"],
  );
  assert.equal(tokens.scope, "read:portfolio write:portfolio");
  assert.equal(queries.filter((query) => query.includes("DELETE FROM mcp_oauth_tokens")).length, 1);
  assert.deepEqual(savedScopes, [
    ["read:portfolio", "write:portfolio"],
    ["read:portfolio", "write:portfolio"],
  ]);
});

test("invalid refresh scope is rejected before the one-time token is consumed", async () => {
  const queries: string[] = [];
  const store = {
    pool: {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ scope: ["read:market"] }] };
      },
    },
  } as any;
  const provider = new FahaliOAuthProvider(store);
  await assert.rejects(
    () => provider.exchangeRefreshToken(
      { client_id: "oauth-client-a" } as any,
      "refresh-token-value",
      ["write:delivery"],
    ),
    /invalid_scope/,
  );
  assert.equal(queries.some((query) => query.includes("DELETE FROM mcp_oauth_tokens")), false);
});

test("conditional watch refresh requires write scope only when it can persist", () => {
  assert.deepEqual(
    requiredOAuthScopesForTool("fahali_get_portfolio_decision", { refresh: false }),
    ["read:portfolio"],
  );
  assert.deepEqual(
    requiredOAuthScopesForTool("fahali_get_portfolio_decision", {}),
    ["read:portfolio", "write:portfolio"],
  );
  assert.deepEqual(
    requiredOAuthScopesForTool("fahali_get_watch_delta", { refresh: true }),
    ["read:portfolio", "write:portfolio"],
  );
  for (const name of ["fahali_get_portfolio_decision", "fahali_get_watch_delta"]) {
    const tool = (TOOL_DEFINITIONS as any[]).find((entry) => entry.name === name);
    assert.equal(tool?._meta?.conditionalWrite, true);
    assert.deepEqual(tool?._meta?.oauthScopeCondition?.whenFalse, ["read:portfolio"]);
    assert.match(tool?.inputSchema?.properties?.refresh?.description ?? "", /write:portfolio/);
  }
});

test("every advertised tool publishes only recognized OAuth scopes", () => {
  const allowed = new Set<string>(FAHALI_OAUTH_SCOPES);
  for (const tool of TOOL_DEFINITIONS as any[]) {
    const declared = tool._meta?.oauthScopes;
    assert.ok(Array.isArray(declared), `${tool.name} has no oauthScopes contract`);
    assert.deepEqual(declared, requiredOAuthScopesForTool(tool.name));
    for (const scope of declared) {
      assert.ok(allowed.has(scope), `${tool.name} declares unknown scope ${scope}`);
    }
  }
});

test("every advertised mutation is guarded by a write scope", () => {
  for (const tool of TOOL_DEFINITIONS as any[]) {
    const annotations = annotationsForTool(tool.name);
    const scopes = requiredOAuthScopesForTool(tool.name);
    if (!annotations.readOnlyHint) {
      assert.ok(
        scopes.some((scope) => scope.startsWith("write:")),
        `${tool.name} mutates state without a write OAuth scope`,
      );
    }
  }
});

test("stateful and delivery tools advertise truthful MCP execution hints", () => {
  assert.deepEqual(annotationsForTool("fahali_save_memory"), {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(annotationsForTool("fahali_create_alert").readOnlyHint, false);
  assert.equal(annotationsForTool("fahali_watch_portfolio").readOnlyHint, false);
  assert.equal(annotationsForTool("fahali_get_portfolio_decision").readOnlyHint, false);
  assert.equal(annotationsForTool("fahali_subscribe_risk").openWorldHint, true);
  assert.equal(annotationsForTool("fahali_update_subscription").destructiveHint, true);
  assert.equal(annotationsForTool("fahali_unsubscribe_risk").idempotentHint, true);
  assert.equal(annotationsForTool("fahali_get_capabilities").openWorldHint, false);
  assert.equal(annotationsForTool("fahali_get_market_snapshot").openWorldHint, true);
});

test("legacy aliases inherit the canonical write scopes and annotations", () => {
  assert.deepEqual(requiredOAuthScopesForTool("save_memory"), ["write:memory"]);
  assert.deepEqual(requiredOAuthScopesForTool("create_alert"), ["write:alerts"]);
  assert.equal(annotationsForTool("save_memory").readOnlyHint, false);
  assert.equal(annotationsForTool("fahali_get_whale_activity").readOnlyHint, true);
});

test("refresh credentials are one-time and transport logs redact every Fahali credential class", () => {
  const provider = readFileSync(new URL("./oauth/provider.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(provider, /DELETE FROM mcp_oauth_tokens[\s\S]*RETURNING user_id, scope/);
  assert.match(index, /fahali_oat_/);
  assert.match(index, /fahali_ort_/);
  assert.match(index, /fahali_ac_/);
  assert.match(index, /safeLogMessage/);
});
