import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_DEFINITIONS, requiredOAuthScopesForTool } from "./tools.js";

/**
 * The capabilities catalogue must not advertise a tool this session cannot call.
 *
 * ── The measurement that forced this (2026-08-29) ────────────────────────────
 * A live Claude connector session held exactly two of the eight OAuth scopes:
 * `read:market` and `read:portfolio`. Twelve tools were refused before dispatch.
 * `fahali_get_capabilities` reported `executable: true` for every one of them,
 * `blockedEndpoints: []`, and workflow `persist_portfolio_watch` as
 * `executable: true, blockedBy: []` — a workflow whose first step cannot run.
 * The response then TOLD the agent that `blockedEndpoints` was the authority.
 *
 * An external audit read that surface and filed ten "missing capabilities" as a
 * P0. Nothing was missing. Seven of the eight were live; the eighth was built
 * and unshipped. They were unreachable, and this surface said otherwise.
 *
 * Root cause: two independent gates refuse a call — the upstream API-key
 * entitlement, and the OAuth scope check enforced in-process — and
 * `capabilitiesResult` only ever received the first, because it was never
 * passed the session's authorization.
 *
 * This is the same class as scripts/check-dispatch.mjs: a listing entry and a
 * switch case are unrelated as far as tsc is concerned. So are an
 * `executable: true` flag and the dispatcher's scope refusal. Nothing type-checks
 * the agreement, so it is asserted here.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(SRC, "index.ts"), "utf8");
const catalog = TOOL_DEFINITIONS as any[];

/** The grant measured on the live connector session, 2026-08-29. */
const MEASURED_LIVE_GRANT = ["read:market", "read:portfolio"];

const refusedUnder = (grant: string[], args?: Record<string, unknown>) =>
  catalog
    .map((tool) => String(tool.name))
    .filter((name) =>
      requiredOAuthScopesForTool(name, args).some((scope) => !grant.includes(scope)),
    );

test("the measured live grant really does refuse a large part of the catalogue", () => {
  const refused = refusedUnder(MEASURED_LIVE_GRANT);

  // If this ever reaches zero the fixture has drifted, and every assertion
  // below would pass vacuously while proving nothing.
  assert.ok(
    refused.length >= 8,
    `expected the two-scope grant to refuse many tools, got ${refused.length}`,
  );

  // The four delivery tools. All four were reported executable while refusing.
  for (const name of [
    "fahali_subscribe_risk",
    "fahali_update_subscription",
    "fahali_unsubscribe_risk",
    "fahali_list_risk_subscriptions",
  ]) {
    assert.ok(refused.includes(name), `${name} must be refused under the measured grant`);
  }

  // Confirmed empirically by a direct call on 2026-08-29.
  assert.ok(refused.includes("fahali_watch_portfolio"));
  assert.ok(refused.includes("fahali_search_memories"));

  // Read-only judgment must still work, or the diagnosis is wrong.
  for (const name of [
    "fahali_resolve_instrument",
    "fahali_get_verdict_history",
    "fahali_get_verdict_by_id",
    "fahali_get_capabilities",
  ]) {
    assert.ok(!refused.includes(name), `${name} must remain callable on a read grant`);
  }
});

test("fahali_get_watch_delta is refused on a DEFAULT call and allowed at refresh:false", () => {
  // The sharpest instance of the bug. SERVER_INSTRUCTIONS calls this "the
  // default repeat read" for continuous portfolio work, and its default
  // `refresh: true` requires write:portfolio — so the documented primary loop
  // is unreachable on a read grant, while the catalogue called it executable.
  const onDefault = requiredOAuthScopesForTool("fahali_get_watch_delta");
  assert.ok(onDefault.includes("write:portfolio"));

  const onReadOnly = requiredOAuthScopesForTool("fahali_get_watch_delta", { refresh: false });
  assert.deepEqual(onReadOnly, ["read:portfolio"]);

  // Which means arguments decide the gate, so a step must be judged WITH its
  // arguments. Judging the bare tool name reports the wrong answer for a
  // refresh:false step.
  assert.notDeepEqual(onDefault, onReadOnly);
});

test("capabilities computes `executable` from the scope gate, not only the API-key gate", () => {
  assert.match(
    indexSrc,
    /async function capabilitiesResult\(\s*apiKey: string \| undefined,\s*authorization: SessionAuthorizationState,/,
    "capabilitiesResult must receive the session authorization; without it the OAuth gate is invisible",
  );

  assert.match(
    indexSrc,
    /const missingScopesFor = \(name: string, args\?: Record<string, unknown>\): string\[\] =>\s*missingOAuthScopes\(name, args, authorization\);/,
    "the catalogue must measure scope with missingOAuthScopes — the SAME function the dispatcher refuses with, so the two cannot drift",
  );

  assert.match(indexSrc, /executable: toolExecutable\(tool\.name\)/);
  assert.match(indexSrc, /missingScopes: missingScopesFor\(tool\.name\)/);
  assert.match(indexSrc, /scopeBlockedTools:/);
  assert.match(indexSrc, /oauthGrant:/);

  // Negative control. This is the exact expression that produced the lie: it
  // consults only the API-key entitlement. If it returns, the tests above can
  // still pass while the bug is back.
  assert.doesNotMatch(
    indexSrc,
    /executable: endpointExecutable\(entitlement, tool\._meta\?\.endpoint\)/,
    "the API-key-only executable flag is the defect; it must not return",
  );

  assert.match(
    indexSrc,
    /return capabilitiesResult\(apiKey, authorization\);/,
    "the capabilities dispatch case must forward the authorization it was given",
  );
});

test("a blocked workflow step names the scope that would unblock it", () => {
  // `requiredScope: "paid"` was hardcoded, naming neither the gate that refuses
  // nor the action that clears it. An agent cannot act on "paid".
  assert.doesNotMatch(indexSrc, /requiredScope: "paid",\s*\n\s*reason:/);
  assert.match(indexSrc, /missingScopes,\s*\n\s*requiredScope: missingScopes\.length/);
  assert.match(indexSrc, /Re-authorize with that scope to run it/);
});

test("every tool the catalogue lists is scope-classifiable", () => {
  // Guards the sweep itself: a tool absent from requiredOAuthScopesForTool's
  // branches silently falls through to the read:market default, which would
  // report a write tool as callable on a read grant.
  for (const tool of catalog) {
    const scopes = requiredOAuthScopesForTool(String(tool.name));
    assert.ok(Array.isArray(scopes), `${tool.name} must resolve to a scope list`);
    // index.ts publishes `_meta.oauthScopes ?? requiredOAuthScopesForTool(name)`.
    // An EMPTY declared array is therefore published verbatim and reads as "no
    // scopes needed" for a tool that refuses — the same lie one field over from
    // the one this file exists to prevent. So assert the PUBLISHED value, which
    // is what an agent actually reads, rather than only a non-empty declaration.
    const declared = tool._meta?.oauthScopes;
    const published = Array.isArray(declared) ? declared : scopes;
    assert.deepEqual(
      [...published].sort(),
      [...scopes].sort(),
      `${tool.name}: published oauthScopes disagree with requiredOAuthScopesForTool — the catalogue would advertise a different gate than the dispatcher enforces`,
    );
  }
});

/**
 * ── A conditionally-blocked tool must disclose the variant that WORKS ────────
 *
 * Measured 2026-08-31 on a live connector holding exactly
 * `read:market` + `read:portfolio` (the same two-scope grant as the fixture
 * above): `fahali_get_watch_delta` with `{refresh: false}` returned
 * `watch_not_found` — it dispatched — while the default `{refresh: true}`
 * returned `insufficient_scope`. So the tool was CALLABLE, and
 * `scopeBlockedTools` reported it blocked with no qualification, because it
 * measures scopes with no arguments and therefore always at the worst case.
 *
 * That is the server disagreeing with itself inside one response: the same
 * process sets `_meta.oauthScopeCondition` describing the escape hatch. And it
 * lands on the worst possible tool — this server's instructions call
 * `fahali_get_watch_delta` "the default repeat read", so every narrow-grant
 * connector was told continuous monitoring was shut when it was not.
 */
test("a conditionally-blocked tool discloses the argument variant that works", () => {
  const conditional = catalog.filter((tool) => tool._meta?.oauthScopeCondition);

  // Fixture guard: if no tool is conditional any more, every assertion below
  // would pass vacuously.
  assert.ok(
    conditional.length >= 2,
    `expected conditional-scope tools to exist, got ${conditional.length}`,
  );

  for (const tool of conditional) {
    const name = String(tool.name);
    const condition = tool._meta.oauthScopeCondition;

    // Blocked as called by default — this is what makes the row appear at all.
    assert.ok(
      requiredOAuthScopesForTool(name).some((s) => !MEASURED_LIVE_GRANT.includes(s)),
      `${name} should be blocked under the two-scope grant when called by default`,
    );

    // ...and callable with the condition's argument set to false. This is the
    // claim the new `alsoCallableAs` row makes to the agent.
    const relaxed = requiredOAuthScopesForTool(name, { [condition.argument]: false });
    assert.deepEqual(
      relaxed.filter((s) => !MEASURED_LIVE_GRANT.includes(s)),
      [],
      `${name} with ${condition.argument}=false must be callable under the measured grant`,
    );
  }
});

test("the catalogue emits alsoCallableAs, and ONLY for conditional tools", () => {
  // The disclosure must be wired into the response, not merely computable.
  assert.match(indexSrc, /alsoCallableAs:/);
  assert.match(indexSrc, /callableNow: alternativeMissing\.length === 0/);

  // NEGATIVE CONTROL. Without this the field could be emitted unconditionally,
  // which would tell an agent that a flatly-blocked tool has a way through.
  assert.match(
    indexSrc,
    /if \(!condition \|\| missingScopes\.length === 0\) \{[\s\S]{0,40}?return \{ tool: tool\.name, missingScopes \};/,
    "tools with no oauthScopeCondition must return the plain row — no alsoCallableAs",
  );

  // fahali_save_memory is flatly blocked under the measured grant and has no
  // condition, so no argument can rescue it. If this ever gains a condition the
  // negative control above stops proving anything.
  const saveMemory = catalog.find((t) => t.name === "fahali_save_memory");
  assert.ok(saveMemory, "fixture drift: fahali_save_memory not in the catalogue");
  assert.equal(
    saveMemory._meta?.oauthScopeCondition,
    undefined,
    "fahali_save_memory must stay unconditional for the negative control to hold",
  );
});

// The agent only reads what the note points it at.
test("the entitlement note tells the agent to read alsoCallableAs", () => {
  assert.match(indexSrc, /alsoCallableAs\.callableNow/);
});
