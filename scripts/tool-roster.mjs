/**
 * THE ONE ROSTER. Both harnesses import this; neither owns its own copy.
 *
 * `validate-schemas.mjs` checks each tool's payload against its outputSchema.
 * `sweep-invariants.mjs` checks each payload against the envelope invariants.
 * They ask different questions of the same population, so the population — and
 * the decisions about what is skipped and why — must live in exactly one place.
 * Two rosters is how you end up with two answers to "how many tools are green".
 *
 * ⚠️ A MISSING `INPUTS` ENTRY IS INVISIBLE IN BOTH HARNESSES. A tool called
 * without its required argument returns an error, and an error carries no
 * payload to check — so it is reported UNREACHABLE, never as a pass. On
 * 2026-08-09 that hid 4 of 30 tools: a rename moved `fahali_get_72h_forecast`
 * out of coverage without failing anything.
 *
 * If you add a tool with a required argument, add it here in the same commit.
 */

/** Minimal valid inputs for tools that require arguments. */
export const INPUTS = {
  fahali_get_fall_warnings: {},
  fahali_get_engine_board: { engine: "fall_warning_8h" },
  fahali_get_market_verdict: { symbols: "BTCUSDT,ETHUSDT" },
  fahali_get_market_decision: { symbols: "BTCUSDT,ETHUSDT" },
  fahali_get_symbol_decision: { symbol: "BTCUSDT" },
  fahali_get_forecast: { symbol: "BTCUSDT" },
  fahali_get_72h_forecast: { symbol: "BTCUSDT" }, // deprecated alias, still dispatchable
  fahali_get_capital_flow: { symbol: "BTCUSDT" },
  fahali_get_microstructure_proxy: { symbol: "BTCUSDT" },
  fahali_resolve_instrument: { symbols: "GBTC,NVDA,BTCUSDT" },
  fahali_fact_check_narrative: { claim: "Bitcoin is about to crash." },
  // A sized, signed scenario. "crash stress" carries no magnitude and no
  // direction, so parseShockScenario ABSTAINS by design and the tool never
  // reaches the code path worth checking.
  fahali_run_shock_test: {
    scenario: "BTC drops 30%",
    positions: [
      { symbol: "BTCUSDT", market_value: 50000 },
      { symbol: "ETHUSDT", market_value: 50000 },
    ],
  },
  fahali_analyze_custom_portfolio: {
    positions: [
      { symbol: "BTCUSDT", market_value: 10000 },
      { symbol: "NVDA", market_value: 40000 },
    ],
  },
  /**
   * Called with no argument this tool answers `unknown_resource: ``` — an
   * HONEST refusal of an empty path, which every harness here then recorded as
   * UNREACHABLE, i.e. "should have answered and did not". It was the only
   * non-green row in the 2026-09-08 full sweep and it was the harness's fault,
   * not the tool's. The path is one of the 206 that `fahali_list_resources`
   * returns, so the roster can supply a real one instead of an empty string.
   */
  fahali_fetch_resource: { resource: "/api/situations" },
};

/**
 * Write tools are skipped DELIBERATELY, not by accident: calling them would
 * insert real rows (agent_memory, alerts, subscriptions) every time anyone runs
 * a harness. Their contracts go unchecked as a consequence — a known, chosen
 * gap, printed as "skipped (write tool)" so it can never read as a pass.
 */
export const SKIP_WRITE_TOOLS = new Set([
  /**
   * 🔴 MISCLASSIFIED UNTIL 2026-09-03. Acknowledging an incident CHANGES ITS
   * STATE on production, but this tool was listed only in
   * NEEDS_LIVE_STATE_TOOLS. It was never called in a read-only run purely
   * because no incident id was captured there -- an accident of two unrelated
   * guards, not a decision.
   *
   * Read-only chaining (added the same day) captures ids from read paths, which
   * removes BOTH of those accidental guards at once. Without this line, the
   * default `node scripts/sweep-invariants.mjs` -- documented as read-only --
   * would have acknowledged a live incident on someone's book.
   *
   * A tool belongs here because of what it DOES, never because of whether the
   * harness currently happens to be able to reach it.
   */
  "fahali_acknowledge_incident",
  "fahali_save_memory",
  "fahali_create_alert",
  "fahali_subscribe_risk",
  "fahali_unsubscribe_risk",
  "fahali_update_subscription",
  "fahali_watch_portfolio",
  "fahali_update_portfolio_watch",
  "save_memory", // deprecated alias, not advertised
  "create_alert", // deprecated alias, not advertised
]);

/**
 * Tools composed IN THE MCP rather than proxied to an endpoint — their
 * `_meta.endpoint` is a `local://` sentinel, so there is nothing to fetch.
 *
 * The `endpoint` transport cannot reach them. The `mcp` transport can, and does:
 * it dispatches by name through the built artifact, so these are CHECKED now
 * rather than counted as an uncovered gap.
 */
export const LOCAL_COMPOSED_TOOLS = new Set([
  "fahali_get_bundle",
  "fahali_get_capabilities",
]);

/**
 * Tools that require an id minted by earlier live state (a watch, a verdict).
 * Uncovered in the DEFAULT read-only run; `--with-writes` mints the state and
 * covers all three.
 *
 * 🔴 An earlier version of this comment claimed "no read path hands a caller an
 * id to replay" and "an agent following the documented workflow is never handed
 * an id for the tool that advertises replay by permanent ID." **That was wrong,
 * and it was the harness's fault, not the product's.** `captureState` searched
 * for keys named `verdict_id`/`verdictId` only; a portfolio decision carries the
 * id in FIVE places under other names — `$.verdict.id`, `$.watch.lastVerdictId`,
 * `$.delta.currentVerdictId` and two more. Verified 2026-08-28:
 * `fahali_get_verdict_by_id` answers `status: ok`, `dataState: measured` for
 * that id. A key-name guess is not a measurement.
 *
 * What survives, narrowed: a MARKET decision returns only a `provenanceRoot`
 * hash, and `get_verdict_history` is empty for a demo caller — so the id is
 * discoverable through the WATCH path, not through market reads.
 */
export const NEEDS_LIVE_STATE_TOOLS = new Set([
  "fahali_get_portfolio_decision",
  "fahali_get_watch_delta",
  "fahali_get_verdict_by_id",
  // An incident id only exists after a watch has been evaluated into a
  // breach, so neither of these is addressable by a demo caller. Same
  // category as verdict_by_id, not a broken endpoint.
  "fahali_acknowledge_incident",
  "fahali_get_incident_timeline",
  /**
   * 🔴 ADDED 2026-09-03 — it was in NEITHER this set nor WRITE_INPUTS, so it
   * was called with no `verdict_id`, returned `isError: verdict_id_must_be…`,
   * and was reported **UNREACHABLE** — the one state this harness's own header
   * says can never read as green, and whose stated usual cause is "a missing
   * tool-roster INPUTS entry". It was exactly that.
   *
   * It takes the SAME `$verdictId` as `fahali_get_verdict_by_id` and is
   * dispatched immediately after it, so the id its call needs is already
   * captured by the time it runs — this needed no new state, only the entry.
   */
  "fahali_get_evidence",
]);

/**
 * Tools whose reading is scoped to the CALLER's own connected accounts or
 * saved state. A demo credential legitimately has none, so an empty result is
 * correct rather than a defect — but it is still not a check of the populated
 * path, so these are counted separately and never as passes.
 */
export const CALLER_SCOPED_TOOLS = new Set([
  "fahali_list_connected_accounts",
  "fahali_get_portfolio_risk",
  "fahali_get_portfolio_decision",
  "fahali_get_portfolio_metrics",
  "fahali_list_portfolio_watches",
  "fahali_list_risk_subscriptions",
  "fahali_list_agent_sessions",
  "fahali_get_watch_delta",
  "fahali_search_memories",
  // Returns items: [] for a demo caller — verified, not assumed.
  "fahali_get_verdict_history",
  // A demo caller owns no watches, so it owns no incidents. Empty is the
  // correct answer here and is still not a check of the populated path.
  "fahali_get_active_incidents",
]);

/**
 * Tools whose handler RESHAPES the upstream payload before returning it.
 *
 * `_meta.endpoint` names the SOURCE a tool reads, not the SHAPE it returns.
 * For these the two differ on purpose, so fetching the endpoint directly
 * yields a payload the tool never emits, and checking an envelope over it
 * measures nothing an agent will ever receive:
 *
 *   get_flash_crash_risk   renames the uncalibrated `probability` to
 *                          `detectionStrength` and drops the fabricated
 *                          timeToCrash/estimatedMove bands (Truth Firewall).
 *   get_detection_activity reshapes the smart-money dashboard.
 *   fact_check_narrative   COMPOSES from /agent/verdict per recognised symbol.
 *   get_lead_time          collapses to the latest row per stratum — the lag
 *                          guard. The endpoint-only harness was therefore
 *                          checking the judged record INCLUDING the stale
 *                          strata that collapse exists to remove, on the one
 *                          tool where the honesty doctrine actually lives.
 *   fetch_resource         returns WHICHEVER path it is asked for (the roster
 *                          asks for /api/situations), while its `_meta.endpoint`
 *                          is the resource CATALOGUE. The endpoint transport
 *                          therefore compared the catalogue listing against a
 *                          situations reading — the unexplained DISAGREE seen
 *                          on 2026-09-24, exactly as predicted below.
 *
 * The `mcp` transport is authoritative for these; the `endpoint` transport is
 * skipped rather than compared. This list is hand-maintained and will drift —
 * but drift is VISIBLE, because a transforming tool that is not listed here
 * shows up as an unexplained DISAGREE rather than passing quietly.
 */
export const TRANSFORMING_TOOLS = new Set([
  "fahali_get_flash_crash_risk",
  "fahali_get_detection_activity",
  "fahali_fact_check_narrative",
  "fahali_get_lead_time",
  "fahali_fetch_resource",
  // The engine-board tools add findings[], matchedTrackRecord, recordMatchReason,
  // ownStrataCount (and pass record.withheldOnly) on top of the api envelope.
  "fahali_get_fall_warnings",
  "fahali_get_engine_board",
]);

/**
 * Writes this harness must never make, at any flag. **Currently empty.**
 *
 * ## History, and the correction — 2026-09-03
 *
 * This set held `create_alert` from 2026-08-14. The reason given for keeping it
 * closed was that the tool "writes into the same `alerts` table the detection
 * fleet writes to" and that **the moat never prunes**.
 *
 * That reason was WRONG ABOUT WHICH TABLE, and it had never been measured.
 * Traced to primary source on 2026-09-03:
 *
 *   - `POST /agent/alerts` INSERTs into `alerts` and touches nothing else.
 *   - Moat writes come from `SPECTRA_LEARNING_ENGINE.py:1458`, driven by engine
 *     registration. **Nothing reads `alerts` to register into the moat.**
 *   - `compute_vlt.py` — which produces every published stratum — reads only
 *     `spectra_signal_outcomes`, and contains no reference to `alerts` at all.
 *   - `alerts` retention is **3 days**. It is the *moat* that never prunes, and
 *     an agent row cannot reach it.
 *
 * So the permanence this guard was defending against did not exist.
 *
 * ## What it WAS protecting, which nobody had written down
 *
 * The 2026-08-14 P0 was real: agent alerts were counted as ENGINES in 8 of 8
 * attribution sites, including the `>= 2` consensus gate, so two alerts from one
 * agent could manufacture Fahali's own consensus. The api-server read side is
 * now filtered at 20+ sites behind `NOT_AGENT_AUTHORED_SQL` and guarded by
 * `server/tests/agentAlertsNotEngines.test.ts`.
 *
 * But that test is source-level over `server/` and **structurally cannot see the
 * Python backend.** A widened census there (FROM/JOIN/UPDATE/INTO, aliases,
 * `alerts_archive`) found one unfiltered reader that writes a STORED
 * measurement:
 *
 *   `spectra-backend/scripts/compute_recall_daily.py` computed **recall** from
 *   raw `alerts`. Its disclosed definition — "flagged = ANY alert on that
 *   symbol" — counted an agent's own alert as a Fahali warning, in the numerator
 *   AND in the universe. An agent could raise Fahali's own recall by writing
 *   alerts about symbols that later moved.
 *
 * That is the contaminant that actually justified this guard. It is fixed, with
 * `tests/test_recall_excludes_agent_alerts.py` — 5 assertions, each verified to
 * FAIL when its filter is removed — so it cannot silently come back.
 *
 * ## Why sweeping it is now safe
 *
 * The row is inert everywhere a claim is made: excluded from engine attribution
 * and consensus, excluded from recall, segregated (not mixed) under
 * `agent_authored` in `spectra_health_rollup.py`, never registered into the
 * moat, no push/SMS fan-out, severity capped below `critical`. It stays visible
 * in the caller's own alert feed — which is correct: an agent that writes an
 * alert is entitled to read it back.
 *
 * **State the cost honestly: the write RECURS.** The idempotency window is 24h
 * and `alerts` retention is 3d, so a daily sweep steady-states at ~3 probe rows,
 * not one. That is the price of MEASURING this tool rather than asserting it
 * works, and it is the right trade only because of the paragraph above it.
 *
 * The mechanism stays though the set is empty — it is the documented place for a
 * future write that genuinely must never run, and the report NAMES such a tool
 * rather than letting it disappear into a total.
 */
export const NEVER_WRITE_TOOLS = new Set([]);

/**
 * Arguments for the stateful write chain, run only under `--with-writes`.
 *
 * `$watchId`, `$subscriptionId` and `$verdictId` are substituted at call time
 * from state the sweep captured EARLIER IN THE SAME RUN. That works because
 * TOOL_DEFINITIONS happens to be declared in dependency order — watch (34), its
 * dependents (36-40), subscribe (41), update (43), unsubscribe LAST (44) — so
 * the loop mints the state its later tools need as it walks. A tool whose id was
 * never captured is reported UNCOVERED with the reason, never called with a
 * synthetic id (which would measure the validator, not the tool).
 *
 * Channel `push` needs no target_url and a demo account has no registered
 * device, so nothing is delivered; `minimum_action: EXIT` means it could not
 * fire in the seconds before `unsubscribe_risk` deletes it.
 */
/**
 * 🔴 EVERY WRITE HERE REQUIRES AN `idempotency_key` AND NONE OF THEM SENT ONE
 * (found by the first `--with-writes` run, 2026-09-03).
 *
 * `fahali_watch_portfolio` returned `TOOL_ERROR: idempotency_key` and no watch
 * was minted — so `$watchId` was never captured, and **ten** downstream tools
 * cascaded to UNCOVERED behind it: update_portfolio_watch, get_portfolio_decision,
 * get_watch_delta, subscribe_risk, update_subscription, unsubscribe_risk, plus
 * get_verdict_by_id / get_evidence (verdictId comes from the watch decision) and
 * acknowledge_incident / get_incident_timeline (an incident needs a watch to
 * breach). One missing field, ten unmeasured tools.
 *
 * Audited across the whole roster rather than patched where it failed: five
 * entries were missing it — the entire idempotent-write family gained the
 * required field in `tools.ts` and this file was never updated. That is the same
 * defect class as the `fahali_get_evidence` omission fixed earlier the same day,
 * and exactly what this file's own header warns about.
 *
 * The keys are PER-RUN, seeded in sweep-invariants.mjs as `$…IdemKey`. Stable keys
 * were tried first and are WRONG here: the walk creates the watch and then mutates
 * it two tools later, so the next run's replayed create is refused with
 * `idempotent_resource_superseded` — correctly, since replaying it would return an
 * obsolete response. See the note at the seeding site for the full reasoning.
 * Pattern is `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$` — leading alphanumeric.
 */
export const WRITE_INPUTS = {
  fahali_watch_portfolio: {
    idempotency_key: "$watchIdemKey",
    name: "envelope-sweep probe",
    positions: [
      { symbol: "BTCUSDT", market_value: 10000 },
      { symbol: "NVDA", market_value: 10000 },
    ],
    mandate: { objective: "balanced", horizon: "24h" },
  },
  fahali_update_portfolio_watch: {
    watch_id: "$watchId",
    idempotency_key: "$watchUpdateIdemKey",
    evaluation_interval_minutes: 30,
  },
  fahali_get_portfolio_decision: { watch_id: "$watchId", refresh: true },
  fahali_get_watch_delta: { watch_id: "$watchId", refresh: false },
  fahali_get_verdict_by_id: { verdict_id: "$verdictId" },
  // Same id as the line above, captured from the same watch-decision walk.
  // Left out until 2026-09-03, which is what made it UNREACHABLE rather than
  // UNCOVERED — the harness could not tell a missing entry from a broken tool.
  fahali_get_evidence: { verdict_id: "$verdictId" },
  fahali_acknowledge_incident: { incident_id: "$incidentId", note: "swept" },
  fahali_get_incident_timeline: { incident_id: "$incidentId" },
  fahali_subscribe_risk: {
    watch_id: "$watchId",
    idempotency_key: "$subIdemKey",
    channel: "push",
    minimum_action: "EXIT",
  },
  fahali_update_subscription: {
    subscription_id: "$subscriptionId",
    idempotency_key: "$subUpdateIdemKey",
    status: "paused",
  },
  fahali_unsubscribe_risk: {
    subscription_id: "$subscriptionId",
    idempotency_key: "$subDeleteIdemKey",
  },
  /**
   * The one write whose key is STABLE rather than per-run, and the distinction
   * is load-bearing rather than a style choice.
   *
   * The watch chain uses per-run `$...IdemKey` values because that walk CREATES
   * a watch and then MUTATES it two tools later, so a replayed create is
   * correctly answered with `idempotent_resource_superseded`. **Nothing mutates
   * an alert after creation**, so a replay is the right answer here — and it is
   * what stops the sweep leaving a fresh row on every run. First run inserts;
   * runs inside the 24h idempotency window return the original with
   * `idempotentReplay: true`. Both are valid green envelopes, and writes are
   * performed on ONE transport, so no cross-transport comparison sees the
   * difference either.
   *
   * The message is written to be legible to a human who finds this row in the
   * live in-app feed, because one will.
   */
  fahali_create_alert: {
    idempotency_key: "envelope-sweep-create-alert",
    symbol: "BTCUSDT",
    alert_type: "envelope_sweep_probe",
    message: "Envelope-invariant sweep probe — harness verification, not a detection. Safe to ignore.",
    severity: "low",
    confidence: 0.5,
  },
  fahali_save_memory: {
    key: "envelope_sweep:probe",
    value: { note: "written by scripts/sweep-invariants.mjs --with-writes" },
    memory_type: "semantic",
  },
};
