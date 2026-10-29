/**
 * EVERY DECLARED CONFIDENCE PATH MUST RESOLVE IN THE PUBLISHED PAYLOAD.
 *
 * `confidenceSemantics` is the envelope telling an agent how to read each score
 * in the response: its scale, whether it is calibrated, the range observed. An
 * entry naming a path the payload does not carry is worse than a missing entry.
 * It sends the agent looking for a number that is not there, and it is evidence
 * the describing code and the published payload disagree about the shape.
 *
 * ── The instance this was written for (live, 2026-09-03) ────────────────────
 * `fahali_get_bundle`:
 *   decision.committee.verdict.confidence: observedRange claims 1 row(s) but
 *   the path resolves to no numeric value in this response
 *
 * `confidenceSemanticsFor` walked `conserved.data`, whose `decision` is the
 * UPSTREAM object. The envelope publishes a different one: `mergeDecision`
 * rebuilds it from an allow-list of seven prose keys merged with the selected
 * row, and `committee` is not among them.
 *
 * ── Why the general invariant and not a fixture match ───────────────────────
 * This was the THIRD instance of one shape in a single day -- a label computed
 * over an object a later transform rebuilds. The other two were `getFlashCrash`
 * (rebuilt from seven named keys, so a resolver fix deployed and changed
 * nothing) and a roster-drift breakdown that did not inherit its parent's
 * population. Asserting only that `decision.committee...` is gone would guard
 * one path; asserting that NO declared path dangles guards the class.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";

const wrap = (payload: unknown) => ({ structuredContent: payload }) as any;
const published = (out: any): any =>
  JSON.parse(out.structuredContent ? JSON.stringify(out.structuredContent) : "{}");

/**
 * Resolve a declared field path against the payload, returning every numeric
 * value found. Understands the `a.b[].c` wildcard the declarations use.
 */
function resolveNumbers(root: unknown, path: string): number[] {
  let frontier: unknown[] = [root];
  for (const rawSeg of path.split(".")) {
    const wild = rawSeg.endsWith("[]");
    const seg = wild ? rawSeg.slice(0, -2) : rawSeg;
    const next: unknown[] = [];
    for (const node of frontier) {
      if (node === null || typeof node !== "object") continue;
      const child = (node as Record<string, unknown>)[seg];
      if (child === undefined) continue;
      if (wild) {
        if (Array.isArray(child)) next.push(...child);
      } else {
        next.push(child);
      }
    }
    frontier = next;
  }
  return frontier
    .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
}

/**
 * A bundle-shaped payload whose upstream `decision` carries a committee
 * confidence that `mergeDecision`'s allow-list drops. Modelled on the live
 * response, not invented: the failing path was exactly this one.
 */
const bundleWithCommitteeConfidence = () => ({
  status: "ok",
  dataState: "measured",
  decision: {
    headline: "Watch — upside skew",
    direction: null,
    rationale: "composite read",
    committee: { verdict: { confidence: 0.62, direction: "NEUTRAL" } },
  },
  data: [
    {
      symbol: "NVDA",
      canonical: {
        headline: "Watch — upside skew",
        committee: { verdict: { confidence: 0.62 } },
      },
      confidence: 0.62,
    },
  ],
});

describe("declared confidence paths resolve in the published payload", () => {
  test("no confidenceSemantics entry names a path the response does not carry", () => {
    const out = decorateForAgent("fahali_get_bundle", wrap(bundleWithCommitteeConfidence()));
    const body = published(out);
    const entries: any[] = body.confidenceSemantics ?? [];
    assert.ok(entries.length > 0, "fixture must produce at least one declaration to be meaningful");

    const dangling = entries
      .map((e) => e.field as string)
      .filter((field) => resolveNumbers(body, field).length === 0);

    assert.deepEqual(
      dangling,
      [],
      `these declared paths resolve to no numeric value in the published payload: ${dangling.join(", ")}`,
    );
  });

  test("the observed range of every entry is drawn from values actually published", () => {
    const out = decorateForAgent("fahali_get_bundle", wrap(bundleWithCommitteeConfidence()));
    const body = published(out);
    for (const entry of (body.confidenceSemantics ?? []) as any[]) {
      const found = resolveNumbers(body, entry.field);
      if (!found.length || !entry.observedRange) continue;
      const lo = Math.min(...found);
      const hi = Math.max(...found);
      const { min, max } = entry.observedRange;
      if (typeof min === "number") {
        assert.ok(min >= lo - 1e-9 && min <= hi + 1e-9,
          `${entry.field}: declared min ${min} is outside the published values [${lo}, ${hi}]`);
      }
      if (typeof max === "number") {
        assert.ok(max >= lo - 1e-9 && max <= hi + 1e-9,
          `${entry.field}: declared max ${max} is outside the published values [${lo}, ${hi}]`);
      }
    }
  });
});
