import assert from "node:assert/strict";

/**
 * THE SAFETY PROPERTY OF A WITHHELD DECISION — asserted in one place.
 *
 * Until 2026-09-08 thirty-seven test sites spelled this as
 * `assert.equal(sc.decision.direction, null)`. That conflated two different
 * claims:
 *
 *   1. "This response does not authorise action."   ← the actual invariant
 *   2. "This response contains no directional read." ← an implementation detail
 *
 * Only (1) protects anyone. (2) was the *mechanism* the code happened to use,
 * and pinning it made the mechanism unchangeable — so when the arbiter formed a
 * view it could not bind, the payload erased the view rather than labelling it,
 * and every one of those thirty-seven guards called that correct.
 *
 * `server/lib/verdictAbstain.ts` states the governing rule in its own header:
 * the gate "may only withhold actionability and the signed expected move" and
 * "does NOT choose, replace, or erase direction... a below-floor directional
 * lean is still useful early-warning evidence even when it is not actionable."
 * These assertions now check exactly that contract.
 *
 * 🔴 `expectedMovePct` is the load-bearing one. It is SIGNED, and it is the only
 * concrete number in the block — so it is what an agent acts on. A direction
 * without it is a lean; a direction with it is an instruction.
 */
export function assertNotBinding(decision: any, msg?: string): void {
  const where = msg ? ` [${msg}]` : "";
  assert.equal(decision.binding, false, `a withheld decision must never be binding${where}`);
  assert.equal(
    decision.directionIsBinding,
    false,
    `direction may survive a withhold, but never as a binding call${where}`,
  );
  assert.equal(decision.actionability, "ABSTAIN", `a withheld decision is never actionable${where}`);
  assert.equal(
    decision.expectedMovePct ?? null,
    null,
    `a SIGNED expected move turns a non-binding lean into an action claim${where}`,
  );
  for (const field of ["action", "recommendedAction", "portfolioAction"]) {
    assert.equal(decision[field] ?? null, null, `${field} must not survive a withhold${where}`);
  }
}

/**
 * THE OPPOSITE CASE, and it is not a weaker version of the one above.
 *
 * A `portfolio_monitoring` / portfolio-risk decision has no market direction to
 * withhold in the first place. When one appears there it has LEAKED — typically
 * an individual position row's internal skew (`DOWNSIDE_SKEW`) surfacing as
 * though the response were a call on the market. That absence is by design and
 * must stay absolute, so these paths keep asserting `direction === null`.
 *
 * Both rules exist because the two situations look identical in a payload and
 * are opposite in meaning:
 *
 *   market_direction WITHHELD   → the arbiter HAS a read; the CALL is withheld
 *                                 → direction survives, labelled non-binding
 *   portfolio_monitoring        → there is no market read to have
 *                                 → direction must be absent entirely
 *
 * Collapsing them is what produced the original defect in both directions: a
 * blanket "erase direction" rule silenced the first, and a blanket "keep
 * direction" rule would leak the second.
 */
export function assertDirectionAbsent(decision: any, msg?: string): void {
  const where = msg ? ` [${msg}]` : "";
  assert.equal(decision.direction ?? null, null, `a monitoring assessment carries no market direction${where}`);
  assert.equal(decision.binding ?? false, false, `and it never binds${where}`);
  assert.equal(decision.actionability, "ABSTAIN", `and it is never actionable${where}`);
}

/**
 * The positive half, used where a test needs to prove the read SURVIVED rather
 * than merely that it did not bind. Without this, `assertNotBinding` alone is
 * satisfied by the old erase-everything behaviour it was written to retire.
 */
export function assertReadingSurvives(decision: any, msg?: string): void {
  const where = msg ? ` [${msg}]` : "";
  assertNotBinding(decision, msg);
  assert.ok(
    typeof decision.direction === "string" && decision.direction.length > 0,
    `the arbiter's reading must survive the withheld call${where}`,
  );
  assert.ok(
    decision.directionRole === "non_binding_reading" || decision.directionRole === "no_conclusion_reached",
    `a surviving direction must say which kind of absence it is${where}`,
  );
}
