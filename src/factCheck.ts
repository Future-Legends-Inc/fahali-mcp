/**
 * fahali_fact_check_narrative — the guardrail tool.
 *
 * A financial AI agent that invents a number is not a bad product, it is a
 * liability. This tool takes the sentence an agent is ABOUT TO SAY and checks
 * each assertion in it against what Fahali actually measured, returning one of:
 *
 *   SUPPORTED          a Fahali reading agrees with the assertion
 *   CONTRADICTED       a Fahali reading disagrees with it
 *   NO_READ            Fahali has no reading — which is NOT agreement
 *   UNSUPPORTED_SOURCE the claim names a data feed Fahali does not ingest
 *   OUT_OF_SCOPE       Fahali does not answer this kind of question at all
 *   UNVERIFIABLE       nothing in the claim is checkable against this system
 *
 * ── WHY THIS IS COMPOSED HERE AND NOT BEHIND A NEW ENDPOINT ──────────────────
 * Every branch below is grounded in an endpoint that is already live and
 * already carries its own withholding logic (`/agent/verdict`, the judged
 * record). Composing them here adds no new authority and no new place for a
 * number to be minted. A new server route would have been a second author of
 * claims that already have one.
 *
 * ── THE RULE THAT MAKES IT HONEST ────────────────────────────────────────────
 * 🔴 NO_READ IS NOT SUPPORT. The failure mode this tool would otherwise create
 * is an agent reading "not contradicted" as "verified" — the single most
 * expensive mistake available here, because it launders a hallucination through
 * a checking tool and comes out looking audited. Every NO_READ verdict says so
 * in a sentence, and `safeToRepeat` is false for everything except SUPPORTED.
 */

/** Feeds Fahali does not ingest. Naming one of these is a fabrication, not a disagreement. */
const ABSENT_SOURCES: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /\bdark[ _-]?pool/i, what: "dark-pool / off-exchange print data" },
  { pattern: /\boff-?exchange\b/i, what: "off-exchange venue data" },
  { pattern: /\bon-?chain\b/i, what: "on-chain transaction data" },
  { pattern: /\b(?:whale |crypto )?wallets?\b/i, what: "wallet attribution" },
  { pattern: /\bblockchain\b/i, what: "blockchain / ledger data" },
  { pattern: /\b13-?f\b|\bsec filing/i, what: "regulatory holdings filings" },
  { pattern: /\binsider (?:buy|sell|trad)/i, what: "insider transaction filings" },
  { pattern: /\bshort interest\b/i, what: "short-interest reporting" },
  { pattern: /\boptions? (?:flow|chain)\b/i, what: "options flow / chain data" },
  { pattern: /\b(?:social|twitter|reddit|news) sentiment\b/i, what: "social or news sentiment feeds" },
];

/** Question shapes Fahali does not answer, whatever the data says. */
const OUT_OF_SCOPE: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bprice target\b|\btarget(?:ing)? \$?\d|\bwill (?:reach|hit|touch|top out|bottom) \$?\d|\bfair value (?:of|is) \$?\d|\bPT \$?\d/i,
    why: "Fahali provides risk reads, not price targets. No price, level, or target is produced anywhere in this system.",
  },
  {
    pattern: /\b(?:should|recommend|advise)\s+(?:you\s+)?(?:buy|sell|short|long|add|exit)\b|\bbuy the dip\b|\bgo (?:long|short)\b/i,
    why: "Fahali is read-only and gives observations, not investment advice or trade instructions. It routes no orders and has no path to capital.",
  },
  {
    pattern: /\bguarantee|\bprotects? your capital\b|\bprevents? (?:losses|a loss)\b|\brisk-?free\b|\bcan'?t lose\b/i,
    why: "Fahali makes no loss-prevention claim. It measures warning time and publishes the misses; it does not protect capital.",
  },
  {
    pattern: /\btamper-?proof\b/i,
    why: "Fahali's receipts are tamper-EVIDENT, not tamper-proof: alteration is detectable, not prevented. The distinction is load-bearing.",
  },
  {
    pattern: /\ball\s+(?:eighteen|18|22)\s+(?:detection\s*)?(?:engines|layers|models)\s+(?:agree|align|concur|confirm|indicate|say|show|signal)\b/i,
    why: "Fahali publishes a complete 18-row canonical evidence roster, but roster completeness is not agreement. Rows can be quiet, stale, unavailable, or retired; committee evidence is non-binding and the canonical verdict is the sole direction authority.",
  },
];

/** A percentage attached to skill. These are only quotable from the judged record. */
const SKILL_FIGURE =
  /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of the time\b|accura|correct|win[- ]?rate|success|hit[- ]?rate|precision|right)|(?:accuracy|win[- ]?rate|hit[- ]?rate|success rate|precision)\s*(?:of|is|was|at|:)?\s*(\d{1,3}(?:\.\d+)?)\s*%/i;

/** A directional assertion about a named instrument. */
// Flow verbs ("selling", "distribution", "outflows") are directional claims too.
// They were missing, so "NVDA is seeing heavy institutional selling" scored as
// UNVERIFIABLE while Fahali's own NVDA read pointed the other way (2026-10-06).
const BEARISH = /\b(?:fall|drop|decline|crash|sell[- ]?off|downside|slump|tumble|plunge|breakdown|bearish|lower|weaken|sink|selling|sellers|distribution|outflows?)\b/i;
const BULLISH = /\b(?:rally|rise|climb|surge|upside|breakout|bullish|higher|strengthen|pump|gain|buying|buyers|accumulation|inflows?)\b/i;
/** A claim about WHO traded. Fahali scores direction; it attributes no participant. */
const PARTICIPANT = /\b(?:institution(?:s|al)?|smart money|whales?|hedge funds?|insiders?|retail (?:traders|investors))\b/i;

/**
 * Plain names an agent writes for an instrument instead of its ticker. Kept to
 * unambiguous crypto majors: the SERVER resolves the ticker to its pair
 * (`resolveQuerySymbol`), so this table only turns a word into the ticker a
 * caller would have typed — it is not a second resolver.
 */
const NAME_ALIASES: Array<{ pattern: RegExp; symbol: string }> = [
  { pattern: /\bbitcoin\b/i, symbol: "BTC" },
  { pattern: /\bether(?:eum)?\b/i, symbol: "ETH" },
  { pattern: /\bsolana\b/i, symbol: "SOL" },
  { pattern: /\bdogecoin\b/i, symbol: "DOGE" },
  { pattern: /\bcardano\b/i, symbol: "ADA" },
  { pattern: /\bripple\b/i, symbol: "XRP" },
];

/**
 * Detection-type claims: "X had a volume spike", "momentum shifted", "X is in
 * a bearish regime". These are claims about what a detector OBSERVED, so they
 * are checked against the alert tape for that instrument — never against the
 * canonical forward skew, which is a different quantity.
 *
 * `match` is tested against every type label a row carries (column, nested
 * `details.alert_type`, title/phenomenon) and its message, because the tape
 * stores a volume spike as `alert_type: multi_indicator_confluence` with
 * `volume_spike` nested in `details` — filtering on the column misses it.
 */
const DETECTION_CLAIMS: Array<{ kind: "volume_spike" | "momentum_shift"; claim: RegExp; match: RegExp; label: string }> = [
  {
    kind: "volume_spike",
    claim: /\bvolume (?:spike|surge|burst|explosion|shock|anomal)|\b(?:spike|surge|jump|explosion) in (?:trading )?volume|\bvolume (?:spiked|surged|exploded|jumped)|\bunusual(?:ly high)? (?:trading )?volume|\babnormal (?:trading )?volume/i,
    // Not `anomal`: volume_anomaly covers spikes AND drains, and a drain must
    // never support "had a volume spike".
    match: /volume[ _-]?(?:spike|surge|shock)/i,
    label: "volume spike",
  },
  {
    kind: "momentum_shift",
    claim: /\bmomentum (?:shift|shifted|surge|reversal|reversed|flip|flipped|turn|turned|break)|\bshift in momentum|\bmomentum is (?:shifting|turning|reversing)/i,
    match: /momentum/i,
    label: "momentum shift",
  },
];

const REGIME_CLAIM = /\bregime\b/i;
const REGIME_WORDS: Array<{ pattern: RegExp; state: string }> = [
  { pattern: /\bbear(?:ish)?\b/i, state: "BEARISH" },
  { pattern: /\bbull(?:ish)?\b/i, state: "BULLISH" },
  { pattern: /\bhigh[- ]?vol(?:atility)?\b/i, state: "HIGH_VOLATILITY" },
  { pattern: /\b(?:neutral|range[- ]?bound|sideways)\b/i, state: "NEUTRAL" },
];

function regimeStateOf(raw: unknown): string | null {
  const t = String(raw ?? "").toUpperCase();
  if (!t) return null;
  if (/BEAR/.test(t)) return "BEARISH";
  if (/BULL/.test(t)) return "BULLISH";
  if (/HIGH[_ ]?VOL/.test(t)) return "HIGH_VOLATILITY";
  if (/NEUTRAL|RANGE|SIDEWAYS/.test(t)) return "NEUTRAL";
  return null;
}

/** One alert-tape row, normalised by the caller from `/api/spectra/realtime`. */
export type TapeRow = {
  id: string | null;
  symbol: string;
  /** "signal" = a per-row detail (carries data state); "cluster" = a cluster summary. */
  source: "signal" | "cluster";
  /** Every type label the row carries — column, nested detail type, title. */
  types: string[];
  message: string;
  timestamp: string;
  /** `details.data_state`; null when the row does not carry one. */
  dataState: string | null;
  /** `claimScope.scope` — "instrument" or "market_wide". */
  scope: string | null;
  /** Instrument-scoped regime nowcast, when the row is a regime reading. */
  regime: string | null;
  instrumentIdentity?: unknown;
};

export type TapeRead =
  | { ok: true; rows: TapeRow[]; truncated: boolean; sinceIso: string }
  | { ok: false; reason: string };

export type TimeWindow = { sinceIso: string; untilIso?: string; label: string; stated: boolean; exceedsTape: boolean };

/** The tape serves 24h. A claim's time words set the window inside it. */
export const TAPE_WINDOW_HOURS = 24;

/** Read the time words of one sentence. PURE — `now` is passed in. */
export function timeWindowOf(sentence: string, now: Date = new Date()): TimeWindow {
  const nowMs = now.getTime();
  const tapeFloor = nowMs - TAPE_WINDOW_HOURS * 3600_000;
  const hoursAgo = (h: number, label: string): TimeWindow => {
    const since = nowMs - h * 3600_000;
    return {
      sinceIso: new Date(Math.max(since, tapeFloor)).toISOString(),
      label: since < tapeFloor ? `${label} (the tape covers only the last ${TAPE_WINDOW_HOURS}h)` : label,
      stated: true,
      exceedsTape: since < tapeFloor,
    };
  };
  if (/\btoday\b|\bthis (?:morning|session)\b/i.test(sentence)) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return { sinceIso: new Date(midnight).toISOString(), label: "today (since 00:00 UTC)", stated: true, exceedsTape: false };
  }
  const nHours = sentence.match(/\b(?:last|past)\s+(\d{1,3})\s*(?:hours?|hrs?|h)\b/i);
  if (nHours) return hoursAgo(Number(nHours[1]), `the last ${nHours[1]}h`);
  if (/\b(?:last|past) hour\b|\bthis hour\b/i.test(sentence)) return hoursAgo(1, "the last hour");
  const nDays = sentence.match(/\b(?:last|past)\s+(\d{1,3})\s*days?\b/i);
  if (nDays) return hoursAgo(Number(nDays[1]) * 24, `the last ${nDays[1]} days`);
  if (/\byesterday\b/i.test(sentence)) {
    // Yesterday ENDS at today 00:00 UTC — a spike an hour ago is not yesterday's.
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = midnight - 24 * 3600_000;
    return {
      sinceIso: new Date(Math.max(start, tapeFloor)).toISOString(),
      untilIso: new Date(midnight).toISOString(),
      label: start < tapeFloor
        ? `yesterday (UTC; the tape covers only the last ${TAPE_WINDOW_HOURS}h, so the start of the day is unread)`
        : "yesterday (UTC)",
      stated: true,
      exceedsTape: start < tapeFloor,
    };
  }
  if (/\bovernight\b|\b(?:last|past) (?:day|24 ?h(?:ours)?)\b/i.test(sentence)) return hoursAgo(24, "the last 24h");
  if (/\bthis week\b|\b(?:last|past) week\b|\brecently\b/i.test(sentence)) return hoursAgo(24 * 7, "this week");
  return {
    sinceIso: new Date(tapeFloor).toISOString(),
    label: `the last ${TAPE_WINDOW_HOURS}h (the claim states no time)`,
    stated: false,
    exceedsTape: false,
  };
}

/** Which detection the sentence claims, if any. Regime is handled separately. */
export function detectionClaimOf(sentence: string) {
  return DETECTION_CLAIMS.find((d) => d.claim.test(sentence)) ?? null;
}

/** True when the sentence asserts a regime state and so needs the tape. */
export function claimsRegime(sentence: string): boolean {
  return REGIME_CLAIM.test(sentence);
}

export type Verdict =
  | "SUPPORTED"
  | "CONTRADICTED"
  | "NO_READ"
  | "UNSUPPORTED_SOURCE"
  | "OUT_OF_SCOPE"
  | "UNVERIFIABLE";

export type Assertion = {
  text: string;
  verdict: Verdict;
  /** 🔴 Only ever true for SUPPORTED. NO_READ is not permission to repeat. */
  safeToRepeat: boolean;
  explanation: string;
  fahaliSays?: string;
  symbol?: string;
  /** Every instrument the sentence named, when it named more than one. */
  symbols?: string[];
  /** The identity the producer resolved — so the envelope never re-guesses it. */
  instrumentIdentity?: unknown;
  /** Tape rows a detection claim was checked against (newest first, max 3). */
  evidence?: Array<{ id: string | null; alertType: string; message: string; timestamp: string }>;
  /** The window a detection claim was checked over, from its own time words. */
  window?: { sinceIso: string; label: string };
};

export type Read = {
  direction: string | null;
  headline: string | null;
  actionability: string | null;
  abstainReason: string | null;
  instrumentIdentity?: unknown;
};

export type CheckContext = {
  /** Caller-typed ticker → the key the server looked it up under (BTC → BTCUSDT). */
  resolutions?: Map<string, string>;
  /** Alert tape per resolved symbol. Absent key = the tape was not read. */
  tape?: Map<string, TapeRead>;
  now?: Date;
};

/** Split a narrative into sentences. Crude on purpose — over-splitting is safe here. */
export function splitAssertions(claim: string): string[] {
  return String(claim)
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, 12);
}

/**
 * The instruments ONE sentence names, in the order it names them: plain names
 * (Bitcoin → BTC) and uppercase ticker shapes. Never invents one.
 */
export function symbolsInSentence(text: string): string[] {
  const hits: Array<{ at: number; symbol: string }> = [];
  for (const { pattern, symbol } of NAME_ALIASES) {
    const m = new RegExp(pattern.source, "gi");
    for (const x of String(text).matchAll(m)) hits.push({ at: x.index ?? 0, symbol });
  }
  for (const x of String(text).matchAll(/\b[A-Z]{2,10}(?:USDT|USDC|USD)?\b/g)) {
    // Common English words that are also valid ticker shapes. Better to miss a
    // symbol than to invent one and report a confident NO_READ about it.
    if (/^(THE|AND|FOR|BUT|NOT|ALL|ANY|CAN|WILL|USD|CEO|CFO|GDP|API|ETF|AI|IT|IS|A|I|OK|NO|ON|IN|TO|OF|AT|BY|UP|WE|US|UTC|GMT|EST|EDT|FOMC|FED|CPI|PPI|PCE|IPO|EPS|YOY|QOQ|SEC|NYSE|USA|EU|UK|AM|PM|ATH|ATL)$/.test(x[0])) continue;
    hits.push({ at: x.index ?? 0, symbol: x[0] });
  }
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.symbol))];
}

/** Every instrument to look up for a whole claim: caller hints + each sentence's names. */
export function symbolsInClaim(text: string, hint?: string[]): string[] {
  const out = new Set<string>();
  for (const h of hint ?? []) if (h && /^[A-Za-z0-9.:_-]{1,20}$/.test(h)) out.add(h.toUpperCase());
  for (const s of symbolsInSentence(text)) out.add(s);
  return [...out].slice(0, 8);
}

/**
 * The instruments a single sentence is ABOUT.
 *
 * 🔴 2026-10-06: the whole-claim symbol list used to be passed as the hint for
 * EVERY sentence and the first entry won, so "Bitcoin is in a bearish regime"
 * was scored against NVDA's skew because NVDA appeared earlier in the input.
 * A sentence now binds only to what it names. A caller hint applies to a
 * sentence that names nothing ONLY when it is a single instrument — with two
 * or more there is no honest way to pick, so the sentence binds to none.
 */
export function bindSentence(sentence: string, hint: string[] | undefined, resolutions?: Map<string, string>): string[] {
  const named = symbolsInSentence(sentence);
  const cleanHint = (hint ?? []).filter((h) => h && /^[A-Za-z0-9.:_-]{1,20}$/.test(h)).map((h) => h.toUpperCase());
  const chosen = named.length ? named : cleanHint.length === 1 ? cleanHint : [];
  return [...new Set(chosen.map((s) => resolutions?.get(s) ?? s))];
}

type Base = { text: string; safeToRepeat: boolean };

const cite = (rows: TapeRow[]) =>
  rows.slice(0, 3).map((r) => ({ id: r.id, alertType: r.types[0] ?? "unknown", message: r.message, timestamp: r.timestamp }));

/** One instrument, one detection/regime claim, against that instrument's tape. */
function checkTapeClaim(
  sentence: string,
  sym: string,
  detection: ReturnType<typeof detectionClaimOf>,
  reads: Map<string, Read>,
  ctx: CheckContext,
  base: Base,
): Assertion {
  const window = timeWindowOf(sentence, ctx.now ?? new Date());
  const identity = reads.get(sym)?.instrumentIdentity;
  const tape = ctx.tape?.get(sym);
  const at = { ...base, symbol: sym, window: { sinceIso: window.sinceIso, label: window.label }, ...(identity ? { instrumentIdentity: identity } : {}) };
  const what = detection ? `a ${detection.label}` : "a regime reading";
  if (!tape || !tape.ok) {
    return {
      ...at,
      verdict: "NO_READ",
      explanation:
        `This claims ${what} on ${sym}. Fahali's alert tape could not be read for it` +
        (tape && !tape.ok ? ` (${tape.reason})` : "") +
        `, so the check did not run — this is NOT a finding either way. Do not present the claim as checked.`,
    };
  }
  const sinceMs = Date.parse(window.sinceIso);
  const untilMs = window.untilIso ? Date.parse(window.untilIso) : Number.POSITIVE_INFINITY;
  const inWindow = tape.rows
    .filter((r) => r.symbol === sym && Date.parse(r.timestamp) >= sinceMs && Date.parse(r.timestamp) < untilMs)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const partial = tape.truncated || window.exceedsTape;
  const absenceNote =
    ` That is not evidence the claim is false — detectors do not see every move, and absence of a detection is not a finding that ${sym} was calm.` +
    (partial ? ` The tape read was PARTIAL (${tape.truncated ? "more matching rows existed than were read" : `the claim's window reaches past the ${TAPE_WINDOW_HOURS}h tape`}).` : "");

  if (detection) {
    const matches = (r: TapeRow) => r.types.some((t) => detection.match.test(t)) || detection.match.test(r.message);
    // Detail rows decide whenever any detail row matches: they carry the data
    // state, and a proxy/synthetic row is not support. A cluster summary is
    // used ONLY when no detail row matched at all — otherwise a proxy row's
    // own cluster would let it back in through the side door.
    const signalMatches = inWindow.filter((r) => r.source === "signal" && matches(r));
    const hits = signalMatches.length
      ? signalMatches.filter((r) => r.dataState === "measured")
      : inWindow.filter((r) => r.source === "cluster" && matches(r));
    const viaCluster = !signalMatches.length && hits.length > 0;
    if (hits.length) {
      return {
        ...at,
        verdict: "SUPPORTED",
        safeToRepeat: true,
        evidence: cite(hits),
        ...(at.instrumentIdentity ? {} : hits[0].instrumentIdentity ? { instrumentIdentity: hits[0].instrumentIdentity } : {}),
        fahaliSays: hits[0].message,
        explanation:
          `Fahali's tape holds ${viaCluster ? "a clustered" : hits.length} ${detection.label} detection${viaCluster || hits.length === 1 ? "" : "s"} on ${sym} in ${window.label}; ` +
          `newest at ${hits[0].timestamp}.` +
          (viaCluster ? ` It was found in the clustered tape (its detail row is past the per-row cap), so its data state is not shown here.` : "") +
          ` This confirms a detector fired — it says nothing about direction. Cite the detection, not a forecast.`,
      };
    }
    return {
      ...at,
      verdict: "NO_READ",
      explanation:
        `Fahali's tape holds no measured ${detection.label} detection on ${sym} in ${window.label}.` +
        (signalMatches.length ? ` ${signalMatches.length} matching row(s) declared a non-measured data state and were not counted.` : "") +
        absenceNote + ` Unchecked is not verified.`,
    };
  }

  // Regime: the newest INSTRUMENT-scoped reading. A market-wide reading is
  // not a statement about this instrument and must not be read as one.
  const claimed = REGIME_WORDS.find((w) => w.pattern.test(sentence))?.state ?? null;
  const reading = inWindow.find((r) => r.regime && r.scope !== "market_wide");
  if (!reading) {
    return {
      ...at,
      verdict: "NO_READ",
      explanation: `Fahali's tape holds no instrument-scoped regime reading on ${sym} in ${window.label}.` + absenceNote + ` Unchecked is not verified.`,
    };
  }
  const state = regimeStateOf(reading.regime);
  const withEvidence = { ...at, evidence: cite([reading]), fahaliSays: reading.message };
  if (!claimed || !state) {
    return {
      ...withEvidence,
      verdict: "UNVERIFIABLE",
      explanation:
        `Fahali's newest regime nowcast on ${sym} is \`${reading.regime}\` (${reading.timestamp}), but this sentence names no regime state it can be compared with. ` +
        `Included for context; it neither confirms nor denies the sentence.`,
    };
  }
  if (state === claimed) {
    return {
      ...withEvidence,
      verdict: "SUPPORTED",
      safeToRepeat: true,
      explanation:
        `Fahali's newest regime nowcast on ${sym} is \`${state}\` (${reading.timestamp}), which agrees. ` +
        `A regime is a description of the current state, not a forecast — do not restate it as a prediction.`,
    };
  }
  return {
    ...withEvidence,
    verdict: "CONTRADICTED",
    explanation:
      `Fahali's newest regime nowcast on ${sym} is \`${state}\` (${reading.timestamp}), not \`${claimed}\`. ` +
      `Do not present this claim as supported by Fahali. If you state it, state the disagreement with it.`,
  };
}

/** One instrument, one directional claim, against its canonical read. */
function checkDirection(
  sentence: string,
  sym: string,
  read: Read | undefined,
  claimsDown: boolean,
  claimsUp: boolean,
  base: Base,
): Assertion {
  // Fahali scores direction; it never attributes a move to a participant.
  const who = PARTICIPANT.test(sentence)
    ? ` Note: the sentence also says WHO is trading. Fahali does not attribute flow to any participant, so that part is unchecked whatever the direction says.`
    : "";
  if (!read) {
    return {
      ...base,
      verdict: "NO_READ",
      symbol: sym,
      explanation:
        `Fahali returned no read for ${sym}. That is absence of coverage, NOT agreement and NOT a finding that ${sym} is calm.` + who,
    };
  }
  const dir = (read.direction ?? "").toUpperCase();
  const fahaliDown = /DOWNSIDE|BEARISH/.test(dir);
  const fahaliUp = /UPSIDE|BULLISH/.test(dir);
  const at = { ...base, symbol: sym, ...(read.instrumentIdentity ? { instrumentIdentity: read.instrumentIdentity } : {}) };

  if (read.actionability === "ABSTAIN" || dir === "" || /INSUFFICIENT|MIXED/.test(dir)) {
    return {
      ...at,
      verdict: "NO_READ",
      fahaliSays: read.headline ?? read.direction ?? "no directional call",
      explanation:
        `Fahali is making NO directional call on ${sym}` +
        (read.abstainReason ? ` — ${read.abstainReason}` : ".") +
        ` That is an absence of a read, NOT agreement with the claim and NOT a finding that ${sym} is calm. ` +
        `The claim is unverified here; say so rather than presenting it as checked.` + who,
    };
  }
  if ((claimsDown && fahaliDown) || (claimsUp && fahaliUp)) {
    // A participant attribution cannot be SUPPORTED: half the sentence is unchecked.
    if (who) {
      return {
        ...at,
        verdict: "NO_READ",
        fahaliSays: read.headline ?? dir,
        explanation: `Fahali's canonical read on ${sym} is \`${dir}\`, which agrees on direction only.` + who,
      };
    }
    return {
      ...at,
      safeToRepeat: true,
      verdict: "SUPPORTED",
      fahaliSays: read.headline ?? dir,
      explanation:
        `Fahali's canonical read on ${sym} is \`${dir}\`, which agrees with this claim. ` +
        `Attribute it as an observation over Fahali's registered horizon, not as a prediction of a level.`,
    };
  }
  // CONTRADICTED only for an explicitly OPPOSITE read. A range-bound or
  // unrecognised direction is not a disagreement and must not be printed as one.
  if ((claimsDown && fahaliUp) || (claimsUp && fahaliDown)) {
    return {
      ...at,
      verdict: "CONTRADICTED",
      fahaliSays: read.headline ?? dir,
      explanation:
        `Fahali's canonical read on ${sym} is \`${dir}\`, which points the other way. ` +
        `Do not present this claim as supported by Fahali. If you state it, state the disagreement with it.` + who,
    };
  }
  return {
    ...at,
    verdict: "NO_READ",
    fahaliSays: read.headline ?? dir,
    explanation:
      `Fahali's canonical read on ${sym} is \`${dir}\`, which neither agrees nor points the other way. ` +
      `The claim is unverified here, not supported.` + who,
  };
}

/**
 * One sentence naming several instruments is checked for EACH of them.
 * "BTC and ETH had volume spikes" used to be SUPPORTED on BTC alone. Now:
 * any contradiction wins; SUPPORTED only when every named instrument
 * supports; otherwise NO_READ that says which went unchecked.
 */
function combine(results: Assertion[]): Assertion {
  if (results.length === 1) return results[0];
  const symbols = results.map((r) => r.symbol).filter((s): s is string => Boolean(s));
  const ledger = results.map((r) => `${r.symbol}: ${r.verdict}`).join("; ");
  const contradicted = results.find((r) => r.verdict === "CONTRADICTED");
  if (contradicted) {
    return { ...contradicted, symbols, explanation: `${contradicted.explanation} (Per instrument — ${ledger}.)` };
  }
  if (results.every((r) => r.verdict === "SUPPORTED")) {
    return {
      ...results[0],
      symbols,
      evidence: results.flatMap((r) => r.evidence ?? []).slice(0, 6),
      explanation: results.map((r) => r.explanation).join(" "),
    };
  }
  const unchecked = results.find((r) => r.verdict !== "SUPPORTED")!;
  return {
    ...unchecked,
    verdict: unchecked.verdict === "UNVERIFIABLE" ? "UNVERIFIABLE" : "NO_READ",
    safeToRepeat: false,
    symbols,
    explanation:
      `This sentence names ${symbols.length} instruments and not all of them could be confirmed (${ledger}). ` +
      `A read on one never vouches for another. ${unchecked.explanation}`,
  };
}

/**
 * Classify one sentence. PURE — no network, no clock, fully testable.
 * `reads` maps SYMBOL -> the canonical direction Fahali currently holds.
 */
export function checkAssertion(
  sentence: string,
  reads: Map<string, Read>,
  symbolHint?: string[],
  ctx: CheckContext = {},
): Assertion {
  const base = { text: sentence, safeToRepeat: false as boolean };

  for (const { pattern, why } of OUT_OF_SCOPE) {
    if (pattern.test(sentence)) {
      return { ...base, verdict: "OUT_OF_SCOPE", explanation: why };
    }
  }

  for (const { pattern, what } of ABSENT_SOURCES) {
    if (pattern.test(sentence)) {
      return {
        ...base,
        verdict: "UNSUPPORTED_SOURCE",
        explanation:
          `This names ${what}, which Fahali does not ingest. Any statement resting on it is unsourced — ` +
          `do not repeat it, and do not soften it into a hedge. Fahali reads public market data only.`,
      };
    }
  }

  const skill = sentence.match(SKILL_FIGURE);
  if (skill) {
    const pct = skill[1] ?? skill[2];
    return {
      ...base,
      verdict: "NO_READ",
      explanation:
        `This quotes a skill figure (${pct}%) that did not come from Fahali's judged record in this session. ` +
        `Call \`fahali_get_lead_time\` and use its \`headline\`; quote the number WITH its stratum ` +
        `(engine, horizon tier, instrument class) AND its recall. A precision without its recall describes only ` +
        `the calls that fired, and Fahali sells warning — the miss rate is the half a reader needs. ` +
        `Do not repeat this figure as it stands.`,
    };
  }

  // The instruments THIS sentence is about — never the whole claim's list.
  const bound = bindSentence(sentence, symbolHint, ctx.resolutions).slice(0, 4);
  const claimsDown = BEARISH.test(sentence);
  const claimsUp = BULLISH.test(sentence);

  // Detection-type claims are checked against the tape, BEFORE the directional
  // branch: "a bearish regime" is a nowcast STATE, and scoring it against the
  // forward skew is a category error.
  const detection = detectionClaimOf(sentence);
  if (bound.length && (detection || claimsRegime(sentence))) {
    return combine(bound.map((sym) => checkTapeClaim(sentence, sym, detection, reads, ctx, base)));
  }

  // Directional: every instrument the sentence names must be checked. A name
  // with no Fahali read cannot be blessed by its neighbour's read.
  if (bound.some((s) => reads.has(s)) && (claimsDown || claimsUp)) {
    return combine(bound.map((sym) => checkDirection(sentence, sym, reads.get(sym), claimsDown, claimsUp, base)));
  }

  const symbols = bound.filter((s) => reads.has(s));

  if (symbols.length) {
    const sym = symbols[0];
    const read = reads.get(sym)!;
    return {
      ...base,
      verdict: "UNVERIFIABLE",
      symbol: sym,
      ...(read.instrumentIdentity ? { instrumentIdentity: read.instrumentIdentity } : {}),
      fahaliSays: read.headline ?? read.direction ?? undefined,
      explanation:
        `${sym} is covered, but this sentence makes no directional or measurable assertion Fahali can score. ` +
        `Fahali's current read is included for context; it neither confirms nor denies this sentence.`,
    };
  }

  return {
    ...base,
    verdict: "UNVERIFIABLE",
    explanation:
      "Nothing in this sentence maps to a Fahali measurement. That is not a pass — it means this system cannot " +
      "check it, and it should not be presented as verified by Fahali.",
  };
}

/** Roll individual verdicts into one instruction. Worst case wins; never averaged. */
export function summarise(assertions: Assertion[]): { safeToPublish: boolean; instruction: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const a of assertions) counts[a.verdict] = (counts[a.verdict] ?? 0) + 1;

  const bad = assertions.filter((a) => a.verdict === "CONTRADICTED" || a.verdict === "UNSUPPORTED_SOURCE" || a.verdict === "OUT_OF_SCOPE");
  const unchecked = assertions.filter((a) => a.verdict === "NO_READ" || a.verdict === "UNVERIFIABLE");

  if (bad.length) {
    return {
      safeToPublish: false,
      counts,
      instruction:
        `DO NOT publish this narrative as written. ${bad.length} of ${assertions.length} ` +
        `${bad.length === 1 ? "assertion is" : "assertions are"} contradicted by Fahali, rest on a feed Fahali does not ` +
        `ingest, or ask a question Fahali does not answer. Remove or correct them, then re-check.`,
    };
  }
  if (unchecked.length) {
    return {
      safeToPublish: false,
      counts,
      instruction:
        `Nothing here is contradicted, but ${unchecked.length} of ${assertions.length} ` +
        `${unchecked.length === 1 ? "assertion was" : "assertions were"} NOT CHECKABLE against Fahali. ` +
        `Unchecked is not verified. Either drop those sentences or attribute them to their real source — ` +
        `do not let a Fahali fact-check imply Fahali stands behind them.`,
    };
  }
  return {
    safeToPublish: true,
    counts,
    instruction:
      `Every assertion is supported by a current Fahali reading. Attribute them as observations over Fahali's ` +
      `registered horizon, quote any judged figure with its stratum and recall, and state no price target.`,
  };
}
