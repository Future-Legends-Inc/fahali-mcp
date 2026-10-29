import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyAgentPayload } from "./agentPayload.js";

const liveEmptySentiment = (overrides: Record<string, unknown> = {}) => ({
  status: "ok",
  dataState: "no_data",
  responseState: "OK_NO_FINDINGS",
  history: [],
  count: 0,
  requested: ["BTCUSDT"],
  measuredWindow: "7d",
  instrumentation: {
    alertSource: "measured",
    judgedOutcomeSource: "measured",
    legacyMarketSentimentTableUsed: false,
  },
  probeErrors: [],
  asOf: "2026-08-28T12:00:00.000Z",
  ...overrides,
});

test("verified empty sentiment is a measured scoped empty, never a neutral reading", () => {
  const state = classifyAgentPayload("fahali_get_market_sentiment", liveEmptySentiment());

  assert.deepEqual(
    [state.responseState, state.dataState, state.absence?.kind, state.sourceError],
    ["OK_NO_FINDINGS", "measured", "measured_empty", null],
  );
  assert.doesNotMatch(state.absence?.reason ?? "", /\b(?:neutral|calm)\b/i);
});

test("empty sentiment with one failed probe remains PARTIAL and names the unresolved source", () => {
  const state = classifyAgentPayload("fahali_get_market_sentiment", liveEmptySentiment({
    status: "partial",
    dataState: "partial",
    instrumentation: {
      alertSource: "measured",
      judgedOutcomeSource: "error",
      legacyMarketSentimentTableUsed: false,
    },
    probeErrors: [{ source: "spectra_signal_outcomes.sentiment", error: "57014" }],
  }));

  assert.deepEqual(
    [state.responseState, state.dataState, state.absence?.kind, state.sourceError],
    ["PARTIAL", "partial", "source_unverified", null],
  );
  assert.match(state.absence?.reason ?? "", /spectra_signal_outcomes\.sentiment/);
  assert.match(state.absence?.reason ?? "", /unknown rather than measured zeros/i);
});

test("sentiment source failure remains ERROR rather than becoming an empty market read", () => {
  const state = classifyAgentPayload("fahali_get_market_sentiment", liveEmptySentiment({
    status: "error",
    dataState: "error",
    responseState: "ERROR",
    error: "sentiment_sources_unavailable",
    instrumentation: undefined,
    probeErrors: undefined,
  }));

  assert.deepEqual(
    [state.responseState, state.dataState, state.absence?.kind, state.sourceError],
    ["ERROR", "error", "source_error", "sentiment_sources_unavailable"],
  );
});

test("an empty sentiment payload without probe-completion proof remains source-unverified", () => {
  const state = classifyAgentPayload("fahali_get_market_sentiment", liveEmptySentiment({
    instrumentation: undefined,
    probeErrors: undefined,
  }));

  assert.deepEqual(
    [state.responseState, state.dataState, state.absence?.kind],
    ["NO_COVERAGE", "no_data", "source_unverified"],
  );
});

test("the default commercial sweep uses aggregate sentiment instead of a sparse optional symbol slice", () => {
  const roster = readFileSync(new URL("../scripts/tool-roster.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(roster, /^\s*fahali_get_market_sentiment\s*:/m);
});
