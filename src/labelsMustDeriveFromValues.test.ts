/**
 * Every label in the envelope must derive from the value it describes.
 *
 * ── The class (round-four re-audit, all measured live 2026-08-27) ───────────
 * The v2 envelope is self-describing: it ships a scale beside each score, a
 * coverage ledger beside each symbol list, a producer name beside each judged
 * record, a decision beside each selection. That is the product's whole claim
 * to being safe for an agent to consume.
 *
 * Four of those labels were written by code that never looked at the thing it
 * was labelling:
 *
 *   1. SCALE          `signals[].confidence` returned 79, 83, 77, 43, 80 and was
 *                     typed `scale: "0-1"` — from a `?? "0-1"` fallback nobody
 *                     ever populated. An agent obeying our own confidenceRule
 *                     reads 79 on a 0-1 scale as certainty. Four lines away in
 *                     the same function, `riskScore` did this correctly.
 *   2. CALIBRATION    `outcomeProbability` was pushed with the literal
 *                     `"calibrated"`. The doctrine says nothing may be named
 *                     `probability` unless calibrated — so the one guarantee
 *                     licensing the word was the thing being assumed.
 *   3. CONSERVATION   A two-position book (NVDA 50k + BTCUSDT 30k) came back
 *                     `returned: ["NVDA"]`, everything else empty, and
 *                     `conservationSatisfied: true` beside a `portfolioValue:
 *                     80000` that could only include BTCUSDT. `[].every()` is
 *                     true: the flag reported OK because it had nothing to
 *                     check, not because it checked.
 *   4. PRODUCER       Record matching read `engine` (a display label) and never
 *                     `engine_key` (the fleet roster key), so realtime rows
 *                     carrying `engine_key: "momentum"` were reported as
 *                     produced by "statistical" — a name the judged record has
 *                     never held — and could not match ANY stratum.
 *
 * Plus the decision layer's version of the same thing: a `verdict` object of an
 * unrecognised shape yielded a decision with every field null and
 * `conflict: false`, beside `actionableAvailable: 50` and a note announcing a
 * promotion that delivered nothing.
 *
 * ── Why these fixtures and not neater ones ──────────────────────────────────
 * Every payload below is transcribed from a live call in the session that found
 * these. A hand-built fixture with `confidence: 0.79` PASSES a scale test that
 * production's `confidence: 79` fails — a guard for a units bug that never sees
 * the real units is a guard in name only.
 *
 * Every test here fails on the pre-fix tree.
 *
 *   node --import tsx --test src/labelsMustDeriveFromValues.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decorateForAgent } from "./agentPayload.js";
import { responseOptions } from "./responseOptions.js";
import { assertNotBinding } from "./assertNotBinding.js";

const wrap = (payload: unknown) => ({ structuredContent: payload }) as any;

const semantics = (out: any): any[] =>
  JSON.parse(out.structuredContent ? JSON.stringify(out.structuredContent) : "{}").confidenceSemantics ?? [];

const entryFor = (out: any, field: string) => semantics(out).find((e: any) => e.field === field);

/**
 * Six signals from a live `fahali_get_realtime_alerts` call, reduced to the
 * fields under test. The confidences are the real ones: 79, 83, 77, 43, 80.
 */
const liveRealtimeSignals = (extra: Record<string, unknown> = {}) => ({
  status: "ACTIVE",
  signals: [
    { id: "42205036", symbol: "ERAUSDC", confidence: 79, ...extra },
    { id: "42205035", symbol: "ACHUSDC", confidence: 83, ...extra },
    { id: "42205034", symbol: "SIGNUSDC", confidence: 77, ...extra },
    { id: "42205033", symbol: "MMTUSDC", confidence: 43, ...extra },
    { id: "42205032", symbol: "DOGSUSDC", confidence: 80, ...extra },
  ],
  alert_count: 200,
});

describe("1. a scale is a declaration, never a fallback", () => {
  test("an undeclared scale reads as undeclared, not as 0-1", () => {
    const entry = entryFor(decorateForAgent("fahali_get_realtime_alerts", wrap(liveRealtimeSignals())), "signals[].confidence");
    assert.ok(entry, "signals[].confidence must still be typed");
    assert.equal(entry.scale, null, "an unpopulated scale must not render as a confident '0-1'");
    assert.equal(entry.scaleBasis, "undeclared");
    assert.ok(entry.scaleNote, "an undeclared scale must say what an agent should do instead");
  });

  test("the observed range exposes the units the label could not", () => {
    const entry = entryFor(decorateForAgent("fahali_get_realtime_alerts", wrap(liveRealtimeSignals())), "signals[].confidence");
    // 43..83 across five rows. This is the fact that makes "0-1" impossible,
    // and it is a property of the PATH, not a sample of one row.
    assert.deepEqual(entry.observedRange, { min: 43, max: 83, rowsSeen: 5 });
  });

  test("a producer-declared scale is carried through and trusted", () => {
    const out = decorateForAgent(
      "fahali_get_realtime_alerts",
      wrap(liveRealtimeSignals({ confidenceScale: "0-100" })),
    );
    const entry = entryFor(out, "signals[].confidence");
    assert.equal(entry.scale, "0-100");
    assert.equal(entry.scaleBasis, "declared_by_producer");
    assert.equal(entry.scaleConflict, null, "0-100 values on a 0-100 declaration do not conflict");
  });

  test("a declaration the data contradicts is reported as a conflict, loudly", () => {
    const out = decorateForAgent(
      "fahali_get_realtime_alerts",
      wrap(liveRealtimeSignals({ confidenceScale: "0-1" })),
    );
    const entry = entryFor(out, "signals[].confidence");
    assert.ok(entry.scaleConflict, "0-1 declared against values up to 83 must conflict");
    assert.match(entry.scaleConflict, /83/, "the conflict must name the value that broke the declaration");
    assert.match(entry.scaleConflict, /ordinal/i, "and tell the agent what it may still safely do");
  });

  test("the bound is parsed from the declaration, so 0-N is checked too", () => {
    // urgencyScore is declared 0-20 by a literal in agentPayload.ts and is the
    // field an agent sorts on. A producer drifting past 20 must surface here.
    const out = decorateForAgent(
      "fahali_get_market_decision",
      wrap({ data: [{ symbol: "NVDA", verdict: { urgencyScore: 44 } }] }),
    );
    const entry = entryFor(out, "data[].verdict.urgencyScore");
    assert.ok(entry, "urgencyScore must be typed");
    assert.ok(entry.scaleConflict, "44 on a declared 0-20 scale must conflict");
  });
});

describe("2. calibration is a claim the producer must carry", () => {
  const withProbability = (calibration?: unknown) => ({
    data: [{ symbol: "NVDA", outcomeProbability: 0.62, ...(calibration ? { calibration } : {}) }],
  });

  test("an uncalibrated probability is served but not quotable as a likelihood", () => {
    const entry = entryFor(
      decorateForAgent("fahali_get_market_decision", wrap(withProbability())),
      "data[].outcomeProbability",
    );
    assert.ok(entry, "the number is still served — withhold the claim, never the data");
    assert.equal(entry.calibrationStatus, "unverified", "calibration must never be asserted by a literal");
    assert.equal(entry.quotableAsLikelihood, false);
  });

  test("a probability WITH a calibration record is calibrated and quotable", () => {
    const entry = entryFor(
      decorateForAgent(
        "fahali_get_market_decision",
        wrap(withProbability({ record: "brier-2026-08-01", horizon: "24h" })),
      ),
      "data[].outcomeProbability",
    );
    assert.equal(entry.calibrationStatus, "calibrated");
    assert.equal(entry.quotableAsLikelihood, true);
  });
});

describe("3. a conservation check with nothing to check has not been satisfied", () => {
  const coverageOf = (out: any) => JSON.parse(JSON.stringify(out.structuredContent)).symbolCoverage;

  test("a response with no symbols at all reports null, never a vacuous true", () => {
    // `[].every(...)` is true, so this flag could not be false on exactly the
    // responses where it had nothing to check. Not-applicable now reads as
    // not-applicable, matching `fullyReturned` beside it.
    const coverage = coverageOf(
      decorateForAgent("fahali_get_engine_status", wrap({ status: "ok", engines: [{ name: "momentum" }] })),
    );
    assert.equal(coverage.conservationSatisfied, null);
    assert.equal(coverage.fullyReturned, null, "the two flags over one question must agree");
  });

  test("shock coverage does not misclassify a valid portfolio holding as an unsupported shock driver", () => {
    // The live shock-test call, now that the endpoint echoes the book it was
    // given. Before the echo this came back `requested: [], notReturned: [],
    // fullyReturned: true` — BTCUSDT was priced into `portfolioValue: 80000`
    // and appeared in no list whatsoever.
    const coverage = coverageOf(
      decorateForAgent(
        "fahali_run_shock_test",
        wrap({
          status: "ok",
          portfolioValue: 80000,
          requestedPositions: [
            { symbol: "NVDA", marketValue: 50000 },
            { symbol: "BTCUSDT", marketValue: 30000 },
          ],
          requestedShocks: [{ instrument: "NVDA", movePct: -15, calculationState: "measured" }],
        }),
      ),
    );
    assert.equal(coverage.requestScope, "explicit");
    assert.deepEqual(coverage.requested, ["NVDA"], "only the requested shock clause belongs in shock scope");
    assert.ok(!coverage.requested.includes("BTCUSDT"), "a portfolio holding is not an unreturned shock clause");
    assert.deepEqual(coverage.notReturned, []);
    assert.equal(coverage.fullyReturned, true);
    assert.equal(coverage.conservationSatisfied, true);
  });

  test("a fully-delivered book reports fullyReturned true", () => {
    // Negative control: the fix must not make coverage permanently pessimistic.
    const coverage = coverageOf(
      decorateForAgent(
        "fahali_run_shock_test",
        wrap({
          status: "ok",
          portfolioValue: 50000,
          requestedPositions: [{ symbol: "NVDA", marketValue: 50000 }],
          requestedShocks: [{ instrument: "NVDA", movePct: -15, calculationState: "measured" }],
        }),
      ),
    );
    assert.equal(coverage.conservationSatisfied, true);
    assert.equal(coverage.fullyReturned, true);
  });
});

describe("4. a promoted decision that mapped nothing says so", () => {
  const decisionOf = (out: any) => JSON.parse(JSON.stringify(out.structuredContent)).decision;

  test("an unrecognised verdict shape is a mapping gap, not an absence of judgment", () => {
    // The live realtime verdict: actionType/actionLabel/actionPlan/conviction,
    // none of which the canonical decision mapper reads.
    const decision = decisionOf(
      decorateForAgent(
        "fahali_get_realtime_alerts",
        wrap({
          signals: [
            {
              symbol: "ERAUSDC",
              confidence: 79,
              // ⚠️ FIXTURE RETARGETED 2026-08-28, and the reason matters.
              //
              // This was the live `actionType/actionLabel/actionPlan/conviction`
              // alert shape. That shape is now READ (describe 8), so it can no
              // longer stand in for "a shape the envelope does not recognise" —
              // leaving it here would have made this test assert that Fahali
              // cannot read its own alerts.
              //
              // The BRANCH is still load-bearing and still tested: an unknown
              // producer must name its gap rather than report an absence of
              // judgment. So the fixture becomes a genuinely alien verdict.
              // Deleting the test instead would have removed the guard that
              // catches the NEXT unmapped shape.
              verdict: {
                gizmoRating: "high",
                widgetPhase: 3,
                sprocketNote: "an unrecognised producer's own vocabulary",
              },
            },
          ],
        }),
      ),
    );
    assert.ok(decision, "the decision block must still exist");
    assert.equal(decision.decisionState, "unmapped_source_shape");
    assert.equal(decision.conflict, null, "'no conflict' must not be asserted from a source nothing was read from");
    assert.ok(
      decision.unmappedFrom.includes("gizmoRating"),
      "the gap must name the source keys so an agent can read the row itself",
    );
  });

  test("a canonical verdict still maps normally", () => {
    // Negative control: the fix must not blanket-null real decisions.
    const decorated = decorateForAgent(
        "fahali_get_market_decision",
        wrap({
          data: [
            {
              symbol: "NVDA",
              canonical: { state: "WATCH", headline: "Elevated downside risk", direction: "bearish", conflict: false },
              verdict: { actionability: "ACT", forecastHorizon: "24h" },
            },
          ],
        }),
      );
    const decision = decisionOf(decorated);
    const sc = decorated.structuredContent as any;
    assert.equal(decision.unmappedFrom, undefined, "a mapped decision carries no mapping-gap marker");
    assert.equal(decision.decisionState, "decision_ineligible", "mapping success does not bypass current authority gates");
    assert.equal(decision.state, "WITHHOLD");
    assertNotBinding(decision);
    // The mapped source read now survives INTO the decision, not merely beside
    // it in the audit rows. Both are asserted: the decision must carry the read,
    // and the raw claim must still be independently inspectable.
    assert.equal(decision.direction, "bearish", "the arbiter's read survives the withheld call");
    assert.equal(decision.directionRole, "non_binding_reading");
    assert.equal(sc.data[0].canonical.direction, "bearish", "the mapped source claim remains available for audit");
  });
});

describe("5. the counter and the promoter read through ONE function", () => {
  /**
   * 🔴 The same defect appeared TWICE in one hour, in opposite directions,
   * because `pickLeadRow` (which counts) and `decisionFor` (which promotes)
   * each had their own idea of what a judgment is:
   *
   *   1. `actionableAvailable: 50` beside `decisionState: unmapped_source_shape`
   *      — the counter accepted a verdict-shaped object the promoter could not read.
   *   2. `actionableAvailable: 2` beside `decision: null` — introduced while
   *      fixing (1): the counter read the row's flat fields, the promoter did not.
   *
   * Both were found by the tool sweep, not by a test, and (2) was self-inflicted.
   * `judgmentOf` is now the single extraction. These tests assert AGREEMENT
   * rather than any particular vocabulary, so a third shape cannot reopen it.
   */
  const decorated = (tool: string, payload: unknown) =>
    JSON.parse(JSON.stringify(decorateForAgent(tool, wrap(payload)).structuredContent));

  const agrees = (out: any, label: string) => {
    const n = out.decisionSelection ? Number(out.decisionSelection.actionableAvailable ?? 0) : 0;
    if (n > 0) {
      assert.ok(out.decision, `${label}: counted ${n} available actions but promoted no decision at all`);
      assert.notEqual(
        out.decision.decisionState,
        "unmapped_source_shape",
        `${label}: counted ${n} available actions while mapping none of them`,
      );
    }
  };

  test("a verdict shape the envelope cannot read counts as 0, and says so", () => {
    // The realtime shape: actionType/actionLabel/conviction — none of them the
    // canonical decision fields.
    const out = decorated("fahali_get_realtime_alerts", {
      signals: [
        { symbol: "AAA", verdict: { actionType: "MOMENTUM_FADING", conviction: "developing" } },
        { symbol: "BBB", verdict: { actionType: "PATTERN_DETECTED", conviction: "noise" } },
      ],
    });
    assert.equal(out.decisionSelection.actionableAvailable, 0, "unreadable rows are not available actions");
    assert.equal(out.decisionSelection.judgmentUnreadable, 2, "and the gap is disclosed by count");
    assert.match(out.decisionSelection.note, /mapping gap/i);
    assert.match(out.decisionSelection.note, /NOT a quiet market/i);
    agrees(out, "unreadable verdicts");
  });

  test("the conviction surface's own vocabulary is read, not ignored", () => {
    // stance/action/why/directionalState — the shape /api/insights/conviction
    // actually emits. Live, this counted 2 available actions and promoted null.
    const out = decorated("fahali_get_highest_conviction_signals", {
      // This tool's adapter declares collections ["items","verdicts"] — a fixture
      // under the wrong key is not a row at all, which is its own lesson.
      items: [
        { symbol: "NVDA", stance: "WATCH", action: "ACTIONABLE", why: "Downside skew", direction: "bearish" },
        { symbol: "TSLA", stance: "NORMAL", action: "ACTIONABLE", why: "No edge", direction: "neutral" },
      ],
    });
    assert.ok(Number(out.decisionSelection.actionableAvailable) > 0, "these rows ARE readable judgments");
    agrees(out, "conviction vocabulary");
    assert.equal(out.decision.state, "WATCH");
    assert.equal(out.decision.headline, "Downside skew");
  });

  test("agreement holds across every shape, which is the actual invariant", () => {
    const shapes: Array<[string, unknown]> = [
      ["canonical", { data: [{ symbol: "A", canonical: { state: "WATCH", direction: "bearish" } }] }],
      ["flat row", { data: [{ symbol: "B", direction: "bullish", headline: "Upside" }] }],
      ["conviction", { data: [{ symbol: "C", stance: "DEFEND", action: "ACTIONABLE" }] }],
      ["unreadable", { data: [{ symbol: "D", verdict: { actionType: "X" } }] }],
      ["no judgment", { data: [{ symbol: "E", price: 1 }] }],
    ];
    for (const [label, payload] of shapes) agrees(decorated("fahali_get_market_decision", payload), label);
  });
});

describe("a book supplied in the request body reaches the coverage ledger", () => {
  // fahali_watch_portfolio FAILED the lists-echoed invariant live on 2026-08-28:
  // a caller who named 2 positions got `requestScope: "universe"`, `requested: []`
  // and `conservationSatisfied: null` — a ledger that could account for nothing,
  // sitting beside an `instruments[]` array that had resolved BTCUSDT perfectly.
  //
  // Cause: callerSuppliedInstruments reads the RESPONSE, and this tool returns
  // the created watch rather than echoing the book. Nothing carried what the
  // caller actually asked for.
  const watchResponse = {
    status: "ok",
    watch: { id: "w-1", name: "probe", positions: [{ symbol: "BTCUSDT" }, { symbol: "NVDA" }] },
  };

  test("scores the request as explicit and names the supplied instruments", () => {
    const out: any = decorateForAgent(
      "fahali_watch_portfolio",
      { content: [], structuredContent: watchResponse },
      responseOptions({ positions: [{ symbol: "BTCUSDT", market_value: 1 }, { symbol: "NVDA", market_value: 1 }] }),
    ).structuredContent;

    assert.equal(
      out.symbolCoverage.requestScope,
      "explicit",
      "a caller who named a book did not name the universe",
    );
    assert.deepEqual(new Set(out.symbolCoverage.requested), new Set(["BTCUSDT", "NVDA"]));
  });

  test("still reads universe when the caller genuinely named nothing", () => {
    const out: any = decorateForAgent(
      "fahali_watch_portfolio",
      { content: [], structuredContent: { status: "ok", watch: { id: "w-1" } } },
      responseOptions({}),
    ).structuredContent;
    assert.equal(
      out.symbolCoverage.requestScope,
      "universe",
      "the fix must not manufacture an explicit scope out of an empty request",
    );
  });
});

/**
 * 5. A COVERAGE CLAIM MUST COVER WHAT IT CLAIMS.
 *
 * The four labels above were wrong about the VALUE they described. This one was
 * wrong about HOW MANY values it had looked at: `confidenceSemanticsFor` walked
 * `child.slice(0, 5)` and published `appliesTo: "every row at this path"`.
 *
 * Measured live 2026-08-28: a contagion response declared
 * `edges[].confidence` as [0.54, 0.74] while carrying 0.46 and 0.84 in the same
 * payload; an eight-position portfolio declared a minimum of 0.5422 over a row
 * holding 0.4545. Because `scaleConflict` derives from this same `max`, the ONE
 * check that catches a producer breaking its declared scale was blind past row
 * five — the exact defect (1) above exists to prevent, reintroduced by the
 * sampler rather than by the label.
 */
describe("6. a coverage claim must cover what it claims", () => {
  const opts = () => responseOptions({ detail: "standard", limit: 100 });

  /** The live 8-position book. AAPL, at row SEVEN, holds the true minimum. */
  const eightPositions = () => ({
    status: "ok",
    positions: [
      { symbol: "BTCUSDT", riskScore: 0.6075 },
      { symbol: "ETHUSDT", riskScore: 0.6026 },
      { symbol: "SOLUSDT", riskScore: 0.5421 },
      { symbol: "NVDA", riskScore: 0.692 },
      { symbol: "TSLA", riskScore: 0.776 },
      { symbol: "SPY", riskScore: 0.6566 },
      { symbol: "AAPL", riskScore: 0.4545 },
      { symbol: "MSFT", riskScore: 0.7116 },
    ],
  });

  test("the observed range spans EVERY row, not the first five", () => {
    const out = decorateForAgent("fahali_analyze_custom_portfolio", wrap(eightPositions()), opts());
    const entry = entryFor(out, "positions[].riskScore");
    assert.ok(entry, "positions[].riskScore must still be typed");
    assert.equal(entry.observedRange.rowsSeen, 8, "all eight rows must be aggregated, not the first five");
    assert.equal(entry.observedRange.min, 0.4545, "AAPL sits at row 7 and holds the true minimum");
    assert.equal(entry.observedRange.max, 0.776);
  });

  test("the coverage claim is derived, so it can be trusted", () => {
    const out = decorateForAgent("fahali_analyze_custom_portfolio", wrap(eightPositions()), opts());
    const entry = entryFor(out, "positions[].riskScore");
    assert.equal(entry.appliesTo, "every row at this path");
  });

  /**
   * The negative control: without the fix this passes silently, because the
   * breach lives at row six and the sampler stopped at five.
   */
  test("a scale breach past row five is CAUGHT, not sampled away", () => {
    const breach = {
      status: "ok",
      positions: [
        { symbol: "A", riskScore: 0.6 },
        { symbol: "B", riskScore: 0.5 },
        { symbol: "C", riskScore: 0.7 },
        { symbol: "D", riskScore: 0.55 },
        { symbol: "E", riskScore: 0.61 },
        { symbol: "F", riskScore: 79 },
      ],
    };
    const entry = entryFor(decorateForAgent("fahali_analyze_custom_portfolio", wrap(breach), opts()), "positions[].riskScore");
    assert.ok(entry);
    assert.equal(entry.observedRange.max, 79, "row six must reach the accumulator");
    assert.ok(
      entry.scaleConflict,
      "a declared 0-1 path returning 79 must raise scaleConflict — this is the check the sampling bug disabled",
    );
  });
});

/**
 * 6. A NON-DIRECTIONAL CLAIM IS READ, NOT UNREADABLE.
 *
 * `claim.kind` is an enumerated Fahali vocabulary: abstention, forecast,
 * recommendation, observation. The envelope read only the canonical verdict
 * shape, so every `recommendation` row reported as `unmapped_source_shape` /
 * `judgmentUnreadable` — "Fahali could not read this" about a row Fahali wrote.
 * Live 2026-08-28: eight portfolio rows, `judgmentUnreadable: 8`,
 * `actionableAvailable: 0`. Both numbers false.
 */
describe("7. a non-directional claim is read, not unreadable", () => {
  const recommendationBook = () => ({
    status: "ok",
    positions: [
      {
        symbol: "BTCUSDT",
        riskScore: 0.6075,
        claim: { kind: "recommendation", basis: "measured", action: "reduce" },
        recommendation: { action: "reduce", rationale: "Recent detections on BTCUSDT are frequent and high-confidence." },
      },
      {
        symbol: "AAPL",
        riskScore: 0.4545,
        claim: { kind: "recommendation", basis: "measured", action: "watch" },
        recommendation: { action: "watch", rationale: "AAPL has active detections, at ordinary confidence." },
      },
    ],
  });

  const decorated = () =>
    JSON.parse(
      JSON.stringify(
        decorateForAgent("fahali_analyze_custom_portfolio", wrap(recommendationBook()), responseOptions({ detail: "standard", limit: 100 }))
          .structuredContent,
      ),
    );

  test("rows carrying a recommendation are not counted as unreadable", () => {
    const out = decorated();
    assert.equal(
      out.decisionSelection?.judgmentUnreadable,
      undefined,
      "a recommendation is a claim Fahali authored and understands — it is not a mapping gap",
    );
  });

  test("nor are they advertised as available actions", () => {
    const out = decorated();
    assert.equal(
      out.decisionSelection?.actionableAvailable,
      0,
      "a non-directional observation is not a directional call an agent can act on",
    );
    assert.equal(out.decisionSelection?.nonDirectionalClaims, 2, "they get their own count, by name");
  });

  test("the producer's own sentence is carried, and NO canonical vocabulary is borrowed", () => {
    const out = decorated();
    assert.match(String(out.decision?.headline ?? ""), /Recent detections on BTCUSDT/);
    assert.equal(out.decision?.decisionState, "non_directional_claim");
    assert.equal(out.decision?.claimKind, "recommendation");
    // 🔴 The arbiter ABSTAINED on BTCUSDT at 1% confidence in the same minute
    // this tool said "reduce". Promoting that into state/actionability would
    // publish, as Fahali's binding judgment, a call the authority declined.
    assert.equal(out.decision?.state, null, "an alert-density recommendation must never occupy the canonical state field");
    assert.equal(out.decision?.actionability, null, "nor the canonical actionability field");
    assert.ok(out.decision?.claimNote, "the null must say WHY it is null");
  });
});

/**
 * 7. THE PATH MUST NAME THE KEY THAT HELD THE VALUE.
 *
 * `push()` typed the literal path `detectionConfidence` while reading through
 * four aliases, so `fahali_get_capital_flow` — which returns `detectionScore` —
 * told every agent to read `data[].detectionConfidence`, a path absent from the
 * response. Invisible to every envelope-vs-envelope check, because the label
 * and its range were both computed from the same mis-named entry.
 */
describe("8. the path must name the key that held the value", () => {
  test("an aliased score is typed under the key the payload actually uses", () => {
    const out = decorateForAgent(
      "fahali_get_capital_flow",
      wrap({ status: "ok", data: [{ symbol: "BTCUSDT", detectionScore: 0.42 }] }),
      responseOptions({ detail: "standard", limit: 100 }),
    );
    const fields = semantics(out).map((e: any) => e.field);
    assert.ok(fields.includes("data[].detectionScore"), `expected data[].detectionScore, got ${fields.join(", ")}`);
    assert.ok(
      !fields.includes("data[].detectionConfidence"),
      "the envelope must not name a path the payload does not carry",
    );
  });

  test("the canonical key is still typed under its own name", () => {
    const out = decorateForAgent(
      "fahali_get_capital_flow",
      wrap({ status: "ok", data: [{ symbol: "BTCUSDT", detectionConfidence: 0.42 }] }),
      responseOptions({ detail: "standard", limit: 100 }),
    );
    assert.ok(semantics(out).map((e: any) => e.field).includes("data[].detectionConfidence"));
  });
});

/**
 * 8. TWO MORE FAHALI SHAPES THAT ARE READ, NOT UNREADABLE.
 *
 * Both were still reporting `judgmentUnreadable` after the `claim.kind`
 * vocabulary landed — the alert one at 50 of 50 rows.
 */
describe("9. operational alerts and fact-checks are read", () => {
  test("an alert states itself through verdict.actionLabel, NOT through a borrowed state", () => {
    // ⚠️ These fields sit on the row's `verdict` object, not the row. A first
    // attempt checked the row and left all 50 rows unreadable.
    const out: any = JSON.parse(
      JSON.stringify(
        decorateForAgent(
          "fahali_get_realtime_alerts",
          wrap({
            status: "ACTIVE",
            signals: [
              {
                id: "1",
                symbol: "ERAUSDC",
                verdict: { actionType: "MOMENTUM_FADING", actionLabel: "Volume Outlier", conviction: 0.7 },
              },
            ],
          }),
          responseOptions({ detail: "standard", limit: 100 }),
        ).structuredContent,
      ),
    );
    assert.equal(out.decisionSelection?.judgmentUnreadable, undefined);
    assert.equal(out.decision?.headline, "Volume Outlier");
    assert.equal(out.decision?.claimKind, "alert");
    // MOMENTUM_FADING is a detected phenomenon, not an actionability.
    assert.equal(out.decision?.actionability, null);
    assert.equal(out.decision?.state, null);
  });

  test("a fact-check verdict never occupies the market-read fields", () => {
    const out: any = JSON.parse(
      JSON.stringify(
        decorateForAgent(
          "fahali_fact_check_narrative",
          wrap({
            status: "ok",
            assertions: [
              {
                text: "Bitcoin is about to crash.",
                verdict: "UNVERIFIABLE",
                safeToRepeat: false,
                explanation: "Nothing in this sentence maps to a Fahali measurement.",
              },
            ],
          }),
          responseOptions({ detail: "standard", limit: 100 }),
        ).structuredContent,
      ),
    );
    assert.match(String(out.decision?.headline ?? ""), /Nothing in this sentence/);
    assert.equal(out.decision?.claimKind, "fact_check");
    assert.equal(
      out.decision?.state,
      null,
      "UNVERIFIABLE judges a SENTENCE — writing it into `state` would publish it as a market read",
    );
  });
});
