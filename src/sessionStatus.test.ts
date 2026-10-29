/**
 * The session-status rule — the difference between a connector that recovers
 * itself and one that needs a human.
 *
 * Run from the repo root (tsx lives there, not in mcp-server/):
 *   node --import tsx --test mcp-server/src/sessionStatus.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  sessionErrorStatus,
  SESSION_EXPIRED_MESSAGE,
  NO_SESSION_MESSAGE,
} from "./sessionStatus.js";

test("a live session is never an error", () => {
  assert.equal(sessionErrorStatus({ hasSessionId: true, known: true, isInitialize: false }), null);
  assert.equal(sessionErrorStatus({ hasSessionId: true, known: true, isInitialize: true }), null);
});

test("an EXPIRED session id gets 404 — the only code that makes a client re-initialize", () => {
  // This is the whole bug. Sessions live in an in-memory Map, so every deploy
  // drops them; returning 400 here left connectors dead until a human
  // reconnected them (observed 3x on 2026-08-13/14).
  const e = sessionErrorStatus({ hasSessionId: true, known: false, isInitialize: false });
  assert.ok(e, "an unknown session id must be an error");
  assert.equal(e!.status, 404);
  assert.equal(e!.message, SESSION_EXPIRED_MESSAGE);
});

test("no session id at all gets 400 — a different failure with a different code", () => {
  // Spec §Session Management 2: requests WITHOUT the header (other than
  // initialization) SHOULD be 400. Collapsing this into the 404 case would be
  // just as wrong in the other direction.
  const e = sessionErrorStatus({ hasSessionId: false, known: false, isInitialize: false });
  assert.ok(e);
  assert.equal(e!.status, 400);
  assert.equal(e!.message, NO_SESSION_MESSAGE);
});

test("THE LOOP HAZARD: an initialize carrying a stale session id must pass, not 404", () => {
  // A client that correctly re-initializes but leaves its old Mcp-Session-Id
  // header attached would otherwise get 404 -> re-init -> 404 forever. This is
  // the single most breakable line in the rule: any "simplification" that
  // checks hasSessionId before isInitialize reintroduces the hot loop.
  assert.equal(
    sessionErrorStatus({ hasSessionId: true, known: false, isInitialize: true }),
    null,
    "a stale session id on an initialize must fall through and mint a new session",
  );
});

test("a first-contact initialize (no session id) passes", () => {
  assert.equal(sessionErrorStatus({ hasSessionId: false, known: false, isInitialize: true }), null);
});

test("the 404 message tells the client what to DO, and names no internals", () => {
  // These strings can surface in a third-party host's error UI (ChatGPT,
  // Claude connectors). A message naming a variable or file is a developer
  // talking to himself in front of someone else's user.
  for (const m of [SESSION_EXPIRED_MESSAGE, NO_SESSION_MESSAGE]) {
    assert.ok(!m.includes("`"), `protocol message must not contain backticks: ${m}`);
    assert.ok(
      !/streamSessions|index\.ts|sessionErrorStatus|undefined|null/.test(m),
      `protocol message must not name internals: ${m}`,
    );
    assert.match(m, /initialize/, "both messages must state the recovery step");
  }
});

test("only 404 and 400 are ever returned", () => {
  const cases = [true, false].flatMap((hasSessionId) =>
    [true, false].flatMap((known) =>
      [true, false].map((isInitialize) => ({ hasSessionId, known, isInitialize })),
    ),
  );
  for (const c of cases) {
    const e = sessionErrorStatus(c);
    if (e) assert.ok(e.status === 404 || e.status === 400, `unexpected status ${e.status}`);
  }
  // And exactly 2 of the 8 combinations are errors: the two non-initialize,
  // not-known cases. If this count changes, the rule changed shape.
  assert.equal(cases.filter((c) => sessionErrorStatus(c) !== null).length, 2);
});
