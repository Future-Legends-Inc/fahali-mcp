#!/usr/bin/env node
/**
 * THE ENVELOPE INVARIANTS — one definition, read by every transport.
 *
 * These ask the question a schema cannot: **is what the envelope SAYS about the
 * payload true of the payload.** Schema conformance is satisfied by a response
 * that is confidently wrong — `scale: "0-1"` over values of 79 passes any schema
 * that types `scale` as a string.
 *
 * They live here, apart from any harness, because `sweep-invariants.mjs` now
 * runs them over TWO transports (a direct endpoint fetch and a real MCP stdio
 * session). If each transport carried its own copy, the two could drift and the
 * sweep would be comparing two instruments rather than two readings — the same
 * trap `tool-roster.mjs` was created to close for the tool population.
 *
 * Pure functions, no I/O: each takes (envelope, args) and returns an array of
 * violation strings. Empty array means the invariant held.
 */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Walk every object in a payload, yielding [path, object]. */
function* walk(node, path = "", depth = 0) {
  if (depth > 8 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const [i, item] of node.slice(0, 40).entries()) yield* walk(item, `${path}[${i}]`, depth + 1);
    return;
  }
  yield [path || "$", node];
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object") yield* walk(v, path ? `${path}.${k}` : k, depth + 1);
  }
}

// ── The invariants ──────────────────────────────────────────────────────────
// Each returns an array of violation strings. Every one of these exists because
// the corresponding defect was found in production, not because it seemed wise.

/** A1. Absence must be EARNED — never asserted over substantive content. */
function absenceIsEarned(env) {
  const out = [];
  const empty = env.responseState === "NO_COVERAGE" || env.dataState === "no_data";
  if (empty && !isObj(env.absence)) {
    out.push("responseState/dataState reports an absence but `absence` is null — the reason is unstated");
  }
  if (empty && isObj(env.absence) && !env.absence.kind) {
    out.push("absence is present but carries no `kind`, so an agent cannot tell a source failure from an empty market");
  }
  // The scorecard defect: substantive content served as NO_COVERAGE.
  if (empty && Array.isArray(env.adapterGap?.unrecognisedKeys) && env.adapterGap.unrecognisedKeys.length) {
    out.push(
      `reports NO_COVERAGE while holding ${env.adapterGap.unrecognisedKeys.length} unrecognised content key(s) — ` +
        "an adapter gap is being published as an absence of data",
    );
  }
  return out;
}

/** A2. A row is not a judgment because it is a row. */
function actionabilityIsJudgment(env) {
  const out = [];
  const sel = env.decisionSelection;
  if (!isObj(sel)) return out;
  const n = Number(sel.actionableAvailable ?? 0);
  if (n > 0 && env.decision === null) {
    out.push(`actionableAvailable=${n} but decision is null — nothing was actually promoted`);
  }
  if (n > 0 && isObj(env.decision) && env.decision.decisionState === "unmapped_source_shape") {
    out.push(
      `actionableAvailable=${n} while the promoted decision mapped NOTHING (unmapped_source_shape) — ` +
        "the count describes rows, not judgments",
    );
  }
  /**
   * 🔴 BOTH CHECKS ABOVE ARE GATED ON `n > 0`, so the TOTAL failure was silent.
   *
   * Live 2026-08-28, `fahali_analyze_custom_portfolio` returned
   * `actionableAvailable: 0, judgmentUnreadable: 8` over eight rows that each
   * carried `claim: {kind, basis, action, authorizedBy}` and a
   * `recommendation.rationale`. A PARTIAL mapping failure was caught; the case
   * where the envelope could read NONE of the judgments in front of it passed
   * green — absence rendering as safety, inside the checker.
   *
   * This FAILS rather than notes it. Disclosure was the response to the same
   * defect on 2026-08-27 (`agentPayload.ts` :1795) and a third shape appeared
   * the next day. A mapper that cannot read its own producers is a defect to
   * fix at the source, not a caveat to publish.
   */
  const unreadable = Number(sel.judgmentUnreadable ?? 0);
  if (unreadable > 0) {
    const among = Number(sel.among ?? 0);
    out.push(
      `judgmentUnreadable=${unreadable}${among ? ` of ${among}` : ""} — the envelope could not read a judgment from ` +
        "rows that carry one. Converge the producer's shape with the canonical one; do not add a disclosure branch",
    );
  }
  return out;
}

/** A3. Every label must derive from the value it describes. */
function labelsDeriveFromValues(env) {
  const out = [];
  for (const e of env.confidenceSemantics ?? []) {
    if (e.scale !== null && e.scale !== undefined && !e.scaleBasis) {
      out.push(`${e.field}: declares scale "${e.scale}" with no scaleBasis — the label has no stated source`);
    }
    if (e.scaleBasis === "undeclared" && e.scale !== null) {
      out.push(`${e.field}: scaleBasis "undeclared" but scale is "${e.scale}" — contradictory`);
    }
    if (e.calibrationStatus === "calibrated" && e.quotableAsLikelihood !== true) {
      out.push(`${e.field}: calibrated but not quotable — one of the two is wrong`);
    }
    if (e.isProbability === true && e.calibrationStatus === "calibrated" && !e.observedRange) {
      out.push(`${e.field}: claims calibration with no observed range to check it against`);
    }
    // The headline defect: a declared 0-N contradicted by the data.
    const m = /^0-(\d+(?:\.\d+)?)$/.exec(String(e.scale ?? ""));
    if (m && e.observedRange && Number(e.observedRange.max) > Number(m[1]) && !e.scaleConflict) {
      out.push(
        `${e.field}: values reach ${e.observedRange.max} on a declared ${e.scale} scale and no scaleConflict was raised`,
      );
    }
  }
  return out;
}

/** A4. Any endpoint taking a list must echo the list. */
function listsAreEchoed(env, args) {
  const out = [];
  const cov = env.symbolCoverage;
  if (!isObj(cov)) return out;
  const askedFor = [];
  if (typeof args?.symbols === "string") askedFor.push(...args.symbols.split(","));
  else if (Array.isArray(args?.symbols)) askedFor.push(...args.symbols);
  if (args?.symbol) askedFor.push(String(args.symbol));
  for (const p of args?.positions ?? []) if (p?.symbol) askedFor.push(String(p.symbol));

  if (askedFor.length && cov.requestScope !== "explicit") {
    out.push(
      `caller named ${askedFor.length} instrument(s) but requestScope is "${cov.requestScope}" — ` +
        "the supplied list never reached the coverage ledger",
    );
  }
  if (askedFor.length) {
    const known = new Set([...(cov.requested ?? [])].map((s) => String(s).toUpperCase()));
    const missing = askedFor.map((s) => s.trim().toUpperCase()).filter((s) => s && !known.has(s));
    if (missing.length) out.push(`requested instruments absent from the ledger: ${missing.join(", ")}`);
  }
  return out;
}

/** A5. Tri-state flags: unknown must be null, never false. */
function triStateFlags(env) {
  const out = [];
  const cov = env.symbolCoverage;
  if (isObj(cov)) {
    const nothingToCheck = !(cov.requested ?? []).length && !(cov.returned ?? []).length;
    if (nothingToCheck && cov.conservationSatisfied === true) {
      out.push("conservationSatisfied=true with nothing to conserve — a vacuous pass ([].every() is true)");
    }
    if (nothingToCheck && cov.fullyReturned === true) {
      out.push("fullyReturned=true with no symbols in scope — vacuous");
    }
  }
  const fresh = env.freshnessNormalized;
  if (isObj(fresh) && fresh.known === false && fresh.stale === false) {
    out.push("freshness is unknown yet stale=false — unknown age is being reported as fresh");
  }
  const eq = env.evidenceQuality;
  if (isObj(eq) && eq.dataState !== "measured" && eq.stale === false) {
    out.push(`evidenceQuality.stale=false on dataState "${eq.dataState}" — staleness asserted without a basis`);
  }
  return out;
}

/** A6. A zero counter beside a live error is an unearned zero. */
const ERROR_KEYS = ["lastError", "last_error", "error", "errorMessage", "failureReason"];
const ZERO_COUNTERS = ["failures", "failureCount", "errors", "errorCount", "missing", "missingCount"];
function zeroBesideError(env) {
  const out = [];
  for (const [path, obj] of walk(env)) {
    const errKey = ERROR_KEYS.find((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== "");
    if (!errKey) continue;
    /**
     * A zero is EARNED when the block counts the error somewhere else.
     *
     * `referenceHealth` reports `failures: 0` beside `lastError: "crypto: HTTP
     * 418"` — and also `partialRefreshes: 1`, `failedSources: ["crypto"]`,
     * `degraded: true` and a note. A partial refresh genuinely is not a total
     * failure; naming it separately was the 2026-08-27 fix for this exact
     * field, and flagging it again would be the checker crying wolf at its own
     * previous fix. A bare `failures: 0` with nothing accounting for the error
     * still fails.
     */
    const accountedFor =
      obj.degraded === true ||
      (Array.isArray(obj.failedSources) && obj.failedSources.length > 0) ||
      Object.entries(obj).some(
        ([k, v]) => /partial|degraded|skipped|withheld|unavailable/i.test(k) && typeof v === "number" && v > 0,
      );
    if (accountedFor) continue;
    for (const c of ZERO_COUNTERS) {
      if (obj[c] === 0) {
        out.push(
          `${path}: ${c}=0 beside a non-null ${errKey} (${String(obj[errKey]).slice(0, 60)}) — ` +
            "the counter did not count the error it is sitting next to",
        );
      }
    }
  }
  return out;
}

/** A7. A success envelope must not be empty of everything. */
function successCarriesSomething(env) {
  const out = [];
  if (env.status === "ok" && env.responseState === undefined && env.dataState === undefined) {
    out.push("status ok with no responseState or dataState — the envelope did not classify this payload at all");
  }
  if (env.data === null && env.status === "ok" && !env.absence && !env.adapterGap) {
    out.push("status ok with data:null and no absence — a successful call that says nothing about why it is empty");
  }
  return out;
}

/**
 * A8. THE ENVELOPE'S SUMMARY OF THE PAYLOAD MUST MATCH THE PAYLOAD.
 *
 * 🔴 Every other invariant in this file compares one envelope field with
 * another envelope field. That is why the whole set was green on 2026-08-28
 * over a live response whose `edges[].confidence` declared an observed range of
 * [0.54, 0.74] while carrying 0.46 and 0.84 IN THE SAME PAYLOAD.
 *
 * Cause: `agentPayload.ts` aggregated scalars from `child.slice(0, 5)` and
 * published the result as `appliesTo: "every row at this path"`. `A3` then
 * validated that summary against the DECLARED SCALE and never against the rows —
 * so the checker and the thing it checked shared one blind spot, and a
 * self-refuting payload passed.
 *
 * This invariant is the one that cannot be satisfied by a consistent story: it
 * re-derives the range from the rows themselves and compares. It is also the
 * only check here that would catch a future producer emitting 79 on a path
 * whose first five rows all sat under 1.
 */
function rangesDeriveFromPayload(env) {
  const out = [];
  for (const e of env.confidenceSemantics ?? []) {
    if (!e || !e.field || !isObj(e.observedRange)) continue;
    const values = resolveWildcardPath(env, e.field).filter((v) => typeof v === "number" && Number.isFinite(v));

    // A path the response does not contain. The envelope is describing
    // something that is not there — the R6 defect ("a number that appears
    // nowhere in the response it describes"). Only assert it when nothing was
    // truncated, or a legitimate projection would read as a fault.
    if (!values.length) {
      if (Number(e.observedRange.rowsSeen) > 0 && env.responseControl?.truncated !== true) {
        out.push(
          `${e.field}: observedRange claims ${e.observedRange.rowsSeen} row(s) but the path resolves to no ` +
            "numeric value in this response — the envelope describes a path the payload does not carry",
        );
      }
      continue;
    }

    const actualMin = Math.min(...values);
    const actualMax = Math.max(...values);
    const declMin = Number(e.observedRange.min);
    const declMax = Number(e.observedRange.max);

    // Compare with a relative tolerance. `0.692` vs `0.6920000000000001` is IEEE
    //754, not a mis-summarised range, and the first sweep run reported exactly
    // that as a violation — a checker crying wolf teaches people to skip it.
    const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (Number.isFinite(declMin) && actualMin < declMin && !near(actualMin, declMin)) {
      out.push(
        `${e.field}: observedRange.min is ${declMin} but the payload carries ${actualMin} — ` +
          "the declared range does not describe the rows it claims to summarise",
      );
    }
    if (Number.isFinite(declMax) && actualMax > declMax && !near(actualMax, declMax)) {
      out.push(
        `${e.field}: observedRange.max is ${declMax} but the payload carries ${actualMax} — ` +
          "the declared range does not describe the rows it claims to summarise",
      );
    }

    // "every row" is a coverage CLAIM. It must be true, or say what it covers.
    const seen = Number(e.observedRange.rowsSeen);
    if (Number.isFinite(seen) && seen < values.length && /every row/i.test(String(e.appliesTo ?? ""))) {
      out.push(
        `${e.field}: appliesTo says "every row" but rowsSeen=${seen} of ${values.length} present — ` +
          "the summary was sampled and is published as complete",
      );
    }

    // A3 raises scaleConflict from observedRange.max. If the PAYLOAD breaches a
    // declared 0-N bound and no conflict was raised, the detector was blind —
    // which is precisely what the sampling bug caused.
    const m = /^0-(\d+(?:\.\d+)?)$/.exec(String(e.scale ?? ""));
    if (m && actualMax > Number(m[1]) && !e.scaleConflict) {
      out.push(
        `${e.field}: payload reaches ${actualMax} on a declared ${e.scale} scale and no scaleConflict was raised — ` +
          "the conflict detector did not see the row that breaches the declaration",
      );
    }
  }
  return out;
}

/**
 * Resolve a `confidenceSemantics.field` path against a payload.
 *
 * Paths are the wildcard form the envelope publishes — `positions[].riskScore`,
 * `data[].verdict.confidence` — where `[]` means "every element", not "the
 * first five". Returns every value found at that path.
 */
function resolveWildcardPath(root, path) {
  let cursor = [root];
  for (const raw of String(path).split(".")) {
    const isArr = raw.endsWith("[]");
    const key = isArr ? raw.slice(0, -2) : raw;
    const next = [];
    for (const node of cursor) {
      if (!isObj(node)) continue;
      const v = node[key];
      if (v === undefined || v === null) continue;
      if (isArr) {
        if (Array.isArray(v)) next.push(...v);
      } else {
        next.push(v);
      }
    }
    cursor = next;
  }
  return cursor;
}

const INVARIANTS = [
  ["absence-earned", absenceIsEarned],
  ["actionability-is-judgment", actionabilityIsJudgment],
  ["labels-derive-from-values", labelsDeriveFromValues],
  ["ranges-derive-from-payload", rangesDeriveFromPayload],
  ["lists-echoed", listsAreEchoed],
  ["tri-state-flags", triStateFlags],
  ["zero-beside-error", zeroBesideError],
  ["success-carries-something", successCarriesSomething],
];

export { isObj, walk, INVARIANTS };
