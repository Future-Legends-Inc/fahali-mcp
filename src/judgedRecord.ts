/**
 * CLAIM-MATCHED JUDGED RECORDS.
 *
 * Before this file, every briefing routed the agent to `fahali_get_lead_time`
 * as a follow-up (`TO_RECORD` in agentPayload.ts). That made "what is your
 * read" and "what is your record" two round trips, and an agent that stops
 * after the first one quotes a verdict with no denominator attached. The whole
 * product claim is that the misses travel with the wins; a record reachable
 * only by a second call is a record most callers never fetch.
 *
 * ── WHY THE RECORD IS MERGED INTO THE PAYLOAD, NOT RENDERED FROM A FETCH ─────
 * agentPayload.ts is governed by one rule: THE BRIEFING IS A PROJECTION OF THE
 * PAYLOAD, IT NEVER ADDS A FACT. A renderer that went and fetched its own
 * numbers would break that rule outright — the briefing would assert something
 * the JSON beside it could not corroborate. So the record is fetched HERE,
 * merged into `structuredContent` as `judgedRecord`, and only then projected.
 * The prose and the JSON stay the same object.
 *
 * ── THE SELECTION RULE IS NOT OURS ──────────────────────────────────────────
 * 🔴 We take `headline` from `/api/track-record/lead-time` verbatim. We do NOT
 * pick a more flattering row. We attach that headline to another response ONLY
 * when engine, horizon, regime, and claim family match fields that response
 * actually carries. Otherwise `matchedTrackRecord` is null with a reason.
 * `pickLeadTimeHeadline` (server/lib/leadTimeHeadline.ts) is the ONE selection
 * rule, and the comment on that endpoint is explicit that the Floor, the case
 * studies, /enterprise and this MCP tool all read it and "none of them may
 * re-derive it" — four surfaces picking their own row is how a 4.7%-recall
 * stratum reached the home screen while a 29.1%-recall one sat in the same
 * payload. Re-deriving per-payload would be a fifth.
 *
 * That rule already handles, upstream and for free:
 *   - `publishable = true` only (the gate's rejects never reach us),
 *   - one row per stratum, latest day,
 *   - HEADLINE_MAX_STRATUM_LAG_DAYS — a stratum whose engine stopped judging
 *     ages out and CANNOT headline, which is the "has not judged since X" state
 *     as a first-class outcome rather than a stale number rendered as current,
 *   - VERDICT_ENGINES excluded (an arbiter is not a warner),
 *   - ranked by RECALL, not lift or precision.
 *
 * ── THE THREE THINGS THIS FILE REFUSES TO DO ────────────────────────────────
 *  1. Emit precision without recall. Precision alone is the flattering half of
 *     a warning product: "right 72% of the time" says nothing about how often
 *     it stayed silent. `measured` requires BOTH, and every other field it
 *     prints; one missing number demotes the whole record to `withheld` with
 *     that field named. There is no partial record.
 *  2. Emit a figure without its stratum and its measurement date. A number
 *     detached from "which engine, which horizon, which regime, measured when"
 *     is not checkable, and uncheckable is the one thing we do not ship.
 *  3. Return a bare null. Every branch is {state, reason} — the NullReasonValue
 *     discipline. A field that is simply absent renders as safety, which is the
 *     defect class this codebase has shipped 8+ times.
 */

import { authHeaders } from "./auth.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  buildProducerCandidateIndex,
  buildProducerIndex,
  producerRecordCandidatesFor,
  producerRecordFor,
  type ProducerCandidateIndex,
  type ProducerRecord,
} from "./producerRecord.js";

const API_BASE =
  process.env.FAHALI_API_URL || process.env.SPECTRA_API_URL || "http://localhost:5000";

/**
 * Deliberately far below proxy.ts's 15s. This call is SECONDARY: the user asked
 * for a verdict, not for the record. If the record is slow, the verdict must
 * still land on time carrying an honest "we could not read it" — never a hang.
 */
const RECORD_TIMEOUT_MS = 4_000;

/**
 * The upstream endpoint is `cacheRoute(900)`, and the underlying strata are
 * DAILY rows. Caching here for 5 minutes bounds our own fan-out (one record
 * fetch per tool call would otherwise double upstream traffic) while staying
 * far shorter than the data's own period, so we can never serve a record that
 * is stale by our own doing.
 */
const CACHE_TTL_MS = 300_000;

export type JudgedStratum = {
  engine: string;
  horizonTier: string;
  barRegime: string;
  recallPct: number;
  precisionPct: number;
  baseRatePct: number;
  leadMedianHours: number;
  effectiveSample: number;
  warnedEvents: number;
  measuredOn: string | null;
  /**
   * What this stratum's precision is ABOUT: `directional` (price moved the way
   * we said) or `magnitude` (a move exceeded the judge bar — no direction in it
   * at all). Both come from the endpoint; neither is inferred here.
   */
  claimFamily: string;
  /** The endpoint's own sentence explaining the family. Never authored here. */
  claimMeans: string;
};

/**
 * 🔴 `liftPp` IS DELIBERATELY ABSENT FROM THE TYPE ABOVE.
 *
 * The live headline stratum is `magnitude`, and CLAUDE.md §2 lists "any
 * magnitude lift" under Never Sayable — the conditional denominator behind it
 * is unconfirmed. Publishing `+38.67pp` into the agent channel would be worse
 * than publishing it on the site: an agent restates it to a human as Fahali's
 * own figure, with our name on it.
 *
 * `lift_pp` is still READ below, because the publishability gate is defined in
 * terms of it — a headline row that lost its lift is a row we do not trust.
 * Reading it to decide, and not shipping it, is the whole distinction.
 */

/**
 * Three states, never a bare null. `withheld` means the gate ran and refused;
 * `unavailable` means we could not reach the gate at all. Collapsing those two
 * would report an infrastructure failure as an editorial refusal — they are
 * different truths and the agent is entitled to know which one it got.
 */
export type JudgedRecord =
  | { state: "measured"; stratum: JudgedStratum; dataAsOf: string | null }
  | { state: "withheld"; reason: string; dataAsOf: string | null }
  | { state: "unavailable"; reason: string };

type CacheEntry = {
  at: number;
  value: JudgedRecord;
  producers: Map<string, ProducerRecord> | null;
  producerCandidates: ProducerCandidateIndex | null;
};
let cache: CacheEntry | null = null;

/** Exposed so tests can assert cold behaviour without waiting out the TTL. */
export function __resetJudgedRecordCache(): void {
  cache = null;
}

/**
 * The per-engine index built from the SAME body the headline came from.
 *
 * Same fetch, same instant — deriving it from a second call would let the
 * headline and the producer status describe two different readings of the
 * record, which is the drift this codebase keeps paying for.
 */
export function getProducerIndex(): Map<string, ProducerRecord> | null {
  return cache?.producers ?? null;
}

/** Complete per-stratum producer records used for exact authority matching. */
export function getProducerCandidateIndex(): ProducerCandidateIndex | null {
  return cache?.producerCandidates ?? null;
}

function finite(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Convert the endpoint's headline row into a record, or say why we cannot.
 *
 * Every field below is REQUIRED. That is the point: a record missing its recall
 * is not a weaker record, it is a different and more flattering claim, and the
 * only safe thing to do with it is refuse it by name.
 */
export function toJudgedRecord(body: unknown): JudgedRecord {
  if (!body || typeof body !== "object") {
    return { state: "unavailable", reason: "The judged record endpoint returned no readable body." };
  }
  const b = body as Record<string, unknown>;
  const dataAsOf = nonEmpty(b.dataAsOf) ?? nonEmpty(b.asOf);

  const head = b.headline;
  if (!head || typeof head !== "object") {
    // The endpoint states its own reason when it withholds; prefer its words.
    return {
      state: "withheld",
      reason:
        nonEmpty(b.headlineWithheldReason) ??
        "No stratum currently clears the publishability gate.",
      dataAsOf,
    };
  }

  const h = head as Record<string, unknown>;
  const engine = nonEmpty(h.engine);
  const horizonTier = nonEmpty(h.horizon_tier);
  const barRegime = nonEmpty(h.bar_regime);
  const recallPct = finite(h.recall_pct);
  const precisionPct = finite(h.precision_pct);
  const baseRatePct = finite(h.base_rate_pct);
  const liftPp = finite(h.lift_pp);
  const leadMedianHours = finite(h.lead_median_hours);
  const effectiveSample = finite(h.effective_sample);
  const warnedEvents = finite(h.warned_events);
  const measuredOn = nonEmpty(h.measured_on) ?? nonEmpty(h.day);

  // SOURCED, NEVER AUTHORED. The server owns this wording in
  // leadTimeHeadline.ts (claimFamilyLabel), and it is returned on the headline
  // row and again at the top level as `claimKind`. Retyping the sentence here
  // would make a second author of one claim, which is how the three-authors-of-
  // <head> problem started. Read whichever channel arrived.
  const kind = (b.claimKind && typeof b.claimKind === "object" ? b.claimKind : {}) as Record<string, unknown>;
  const claimFamily = nonEmpty(h.claim_family_resolved) ?? nonEmpty(kind.family);
  const claimMeans = nonEmpty(h.claim_family_label) ?? nonEmpty(kind.means);

  // Name the missing field. "Incomplete" tells nobody what to go and fix.
  const missing: string[] = [];
  if (!engine) missing.push("engine");
  if (!horizonTier) missing.push("horizon tier");
  if (!barRegime) missing.push("bar regime");
  if (recallPct === null) missing.push("recall");
  if (precisionPct === null) missing.push("precision");
  if (baseRatePct === null) missing.push("base rate");
  // Read for the GATE, never shipped — see the note on JudgedStratum.
  if (liftPp === null) missing.push("base-rate lift");
  if (leadMedianHours === null) missing.push("median lead time");
  if (effectiveSample === null) missing.push("effective sample");
  if (warnedEvents === null) missing.push("warned events");
  if (!measuredOn) missing.push("measurement date");
  // A record with no claim family is not a weaker record, it is a MORE
  // flattering one: an unlabelled precision reads as a directional forecast,
  // which is the claim this stratum does not make. Withhold rather than let it
  // default — the same rule as `?? "retail"` for an unresolved tier.
  if (!claimFamily) missing.push("claim family");
  if (!claimMeans) missing.push("what the claim family measures");

  if (missing.length) {
    return {
      state: "withheld",
      reason:
        `The headline stratum is missing ${missing.join(", ")}, so it cannot be stated as a record. ` +
        `A partial record reads as a stronger claim than a complete one.`,
      dataAsOf,
    };
  }

  return {
    state: "measured",
    dataAsOf,
    stratum: {
      engine: engine!,
      horizonTier: horizonTier!,
      barRegime: barRegime!,
      recallPct: recallPct!,
      precisionPct: precisionPct!,
      baseRatePct: baseRatePct!,
      leadMedianHours: leadMedianHours!,
      effectiveSample: effectiveSample!,
      warnedEvents: warnedEvents!,
      measuredOn,
      claimFamily: claimFamily!,
      claimMeans: claimMeans!,
    },
  };
}

/**
 * Fetch the record, cached. NEVER throws and never rejects: a failure here must
 * degrade the record line, not the tool call the user actually made.
 *
 * Only `measured` and `withheld` are cached. An `unavailable` is caller-shaped
 * — a 401 belongs to one key's session, and caching it would hand another
 * caller's agent a refusal that was never theirs.
 */
export async function fetchJudgedRecord(apiKey: string | undefined): Promise<JudgedRecord> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECORD_TIMEOUT_MS);
  try {
    const res = await fetch(new URL("/api/track-record/lead-time", API_BASE).toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Fahali-Source": "mcp-record",
        ...authHeaders(apiKey),
      },
    });

    if (!res.ok) {
      return {
        state: "unavailable",
        reason: `The judged record could not be read (HTTP ${res.status}). No record figure is available for this response.`,
      };
    }

    const body = await res.json().catch(() => null);
    const value = toJudgedRecord(body);
    if (value.state !== "unavailable") {
      cache = {
        at: Date.now(),
        value,
        producers: buildProducerIndex(body),
        producerCandidates: buildProducerCandidateIndex(body),
      };
    }
    return value;
  } catch (err: any) {
    const why =
      err?.name === "AbortError"
        ? `The judged record did not answer within ${RECORD_TIMEOUT_MS}ms.`
        : `The judged record could not be read: ${err?.message ?? "unknown error"}.`;
    return { state: "unavailable", reason: `${why} No record figure is available for this response.` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merge the record into a successful payload.
 *
 * Skipped in two cases, both deliberate:
 *   - `result.isError` — there is no payload to merge into, and a record beside
 *     a failed call invites the agent to quote the record as though the call
 *     had succeeded.
 *   - the payload already carries `headline` — that IS the lead-time response;
 *     attaching a projection of itself would print the same stratum twice and
 *     imply two independent readings.
 */
function normalised(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function valuesForKeys(
  value: unknown,
  keys: Set<string>,
  depth = 0,
  out = new Set<string>(),
): Set<string> {
  if (depth > 5 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 25)) valuesForKeys(item, keys, depth + 1, out);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(normalised(key))) {
      if (Array.isArray(child)) for (const item of child) out.add(normalised(item));
      else if (child !== null && typeof child !== "object") out.add(normalised(child));
    }
    if (child && typeof child === "object") valuesForKeys(child, keys, depth + 1, out);
  }
  return out;
}

function recordMatchesPayload(
  data: Record<string, unknown>,
  stratum: JudgedStratum,
): { matches: boolean; reason: string } {
  // `directionproducer` added 2026-08-27: /agent/verdict now names the producer
  // of every row, so the "this response does not name its engine" branch below
  // was left asserting the opposite of a field sitting two keys away in the
  // same envelope. Two blocks describing one call must not disagree.
  /**
   * 🔴 `engine_key` — THE FLEET ROSTER KEY — WAS NOT IN THIS SET (R7, live 2026-08-27).
   *
   * `fahali_get_realtime_alerts` returned rows carrying
   * `engine_key: "momentum"` and `producer_id: "orchestrator:momentum"`, and
   * this lookup collected `statistical, momentum_shift, anomaly, volume_spike`
   * — two display labels and two alert types. The judged record is keyed on
   * fleet engine keys. `statistical` and `anomaly` are not engine keys and
   * never have been, so the match could not succeed on ANY realtime response,
   * and `matchedTrackRecord` was structurally null on the highest-traffic
   * surface we have. The reason string then named `statistical` as the
   * producer, which is a confident answer about a producer that does not exist.
   *
   * `engine_key` is now read, and `producer_id` is stripped of its namespace
   * (`orchestrator:momentum` normalises to `orchestrator_momentum`; the fleet
   * key is the segment after the namespace). Display labels are still read —
   * they can match — but canonical keys are named FIRST in the reason, because
   * telling an agent its response came from "statistical" sends it to look up a
   * name the record has never held. [[engine keys ≠ alert_types]]
   */
  const canonicalEngines = valuesForKeys(data, new Set([
    "engine_key", "enginekey", "canonical_engine_key", "canonicalenginekey",
  ]));
  for (const producer of valuesForKeys(data, new Set(["producer_id", "producerid"]))) {
    const withoutNamespace = producer.replace(/^[a-z0-9]+_/, "");
    if (withoutNamespace) canonicalEngines.add(withoutNamespace);
  }
  /**
   * 🔴 `engineNames` — THE SAME DEFECT, ONE FIELD NAME LATER (live 2026-08-29).
   *
   * `fahali_get_contagion_map` returns `provenance.engineNames:
   * ["tail_dependence"]` and `provenance.source: "tail_dependence"`, and
   * `recordMatchReason` said "This response does not name the engine that
   * produced it" — an assertion contradicted by a field in the same envelope,
   * which is the exact wording this block was already rewritten once to stop
   * producing. `engines` was in the set; `engineNames` normalises to
   * `enginenames` and was not, so the plural-with-suffix form fell through.
   *
   * The lesson is not "add one more key". It is that this matcher reads a
   * hand-maintained list of field names, so any producer naming its engine in a
   * spelling nobody listed reads as ANONYMOUS — and anonymity here prints a
   * confident sentence about our own payload being deficient. When adding a
   * producer, add its identity field here, or it will silently be unscored.
   */
  const labelEngines = valuesForKeys(data, new Set([
    "engine", "engine_name", "engines", "engine_names", "enginenames",
    "alert_type", "top_type",
    "directionproducer", "direction_producer",
  ]));
  const engines = new Set([...canonicalEngines, ...labelEngines]);
  const horizons = valuesForKeys(data, new Set(["horizon", "horizon_tier", "forecast_horizon", "timeframe"]));
  const regimes = valuesForKeys(data, new Set(["bar_regime", "asset_class", "assetclass", "instrument_class"]));
  const families = valuesForKeys(data, new Set(["claim_family", "claimfamily", "claim_family_resolved", "family"]));

  const expectedEngine = normalised(stratum.engine);
  const expectedHorizon = normalised(stratum.horizonTier);
  const expectedRegime = normalised(stratum.barRegime);
  const expectedFamily = normalised(stratum.claimFamily);

  if (!engines.size || !engines.has(expectedEngine)) {
    /**
     * Re-audit M1 (2026-08-27), and the most consequential finding in it.
     *
     * Every decision the auditor received came from `spectra-master-agent-v1`
     * (provenance.source "agent_verdict") and every one returned
     * matchedTrackRecord: null. The judged record covers `committee_verdict`
     * and `forecast_72h`. So the trust architecture and the RECOMMENDED entry
     * point sit on different engines: an agent following our own documented
     * workflow gets a decision that is, by our own admission, unscored.
     *
     * That is real and it is not fixable in this file — bringing agent_verdict
     * into the judged record is its own piece of work. What IS fixable here is
     * that the old reason ("No publishable record matches this response's
     * engine") was a dead end: it named neither the engine that produced the
     * decision nor the engines that ARE judged, so an agent could not tell a
     * transient gap from a structural one, and had nothing to do next.
     *
     * Say which engine, say which is judged, and say what to call instead.
     */
    // Canonical fleet keys first — a display label sends an agent looking up a
    // name the judged record has never held.
    const observed = [...canonicalEngines, ...[...labelEngines].filter((e) => !canonicalEngines.has(e))]
      .filter(Boolean)
      .slice(0, 4);
    return {
      matches: false,
      reason:
        (observed.length
          ? `This response was produced by ${observed.join(", ")}, which is not the engine the headline stratum covers (${stratum.engine}). ` +
            "That is a statement about the HEADLINE only. Read `producerRecord` for what each of these producers' OWN judged record says — one of them may hold a measured record that did not clear the gate, which is a different fact from holding none. "
          : "This response does not name the engine that produced it, so it cannot be matched to the judged record. ") +
        "No judged figure from the headline stratum may be attached to this response. " +
        "Call fahali_get_lead_time for the full set of strata that carry a publishable record.",
    };
  }
  if (!horizons.size || !horizons.has(expectedHorizon)) {
    return { matches: false, reason: "The engine matched, but the response did not carry the same judged horizon." };
  }
  if (!regimes.size || !regimes.has(expectedRegime)) {
    return { matches: false, reason: "The engine and horizon matched, but the instrument class or regime did not." };
  }
  if (families.size && !families.has(expectedFamily)) {
    return { matches: false, reason: "The record measures a different claim family from this response." };
  }
  return { matches: true, reason: "Matched on engine, horizon, regime, and claim family." };
}

export function attachJudgedRecord(
  result: CallToolResult,
  record: JudgedRecord,
  toolName?: string,
): CallToolResult {
  if (result.isError) return result;
  const data = result.structuredContent;
  if (!data || typeof data !== "object" || Array.isArray(data)) return result;
  if (toolName === "fahali_get_lead_time" || "headlineSelection" in (data as Record<string, unknown>)) return result;
  if (toolName === "fahali_get_bundle") {
    return {
      ...result,
      structuredContent: {
        ...(data as Record<string, unknown>),
        matchedTrackRecord: null,
        recordMatchReason:
          "A bundle contains multiple claim scopes. No generic record is attached; inspect each decision's exact engine, horizon, instrument class, and claim family before requesting its record.",
      },
    };
  }

  if (toolName === "fahali_get_fall_warnings" || toolName === "fahali_get_engine_board") {
    const rec = (data as any).record ?? {};
    const strata: unknown = rec?.strata?.value ?? null;
    const own: any[] = Array.isArray(strata) ? strata : [];
    // Pick rule (deterministic, independent of server array order): publishable
    // rows first, then withheld, then rows with no boolean flag; within a group the
    // shortest horizon tier first (parsed to minutes, unparseable last), then
    // bar_regime lexically. The first row is attached; ALL own strata stay in
    // record.strata and ownStrataCount says how many there are.
    const rank = (s: any) => (s?.publishable === true ? 0 : s?.publishable === false ? 1 : 2);
    const tierMinutes = (t: unknown): number => {
      const m = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i.exec(String(t ?? "").trim());
      if (!m) return Number.MAX_SAFE_INTEGER;
      return Number(m[1]) * ({ m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2].toLowerCase()];
    };
    const sorted = [...own].sort((a, b) =>
      rank(a) - rank(b) ||
      tierMinutes(a?.horizon_tier) - tierMinutes(b?.horizon_tier) ||
      String(a?.bar_regime ?? "").localeCompare(String(b?.bar_regime ?? "")));
    const first = sorted[0] ?? null;
    const num = (x: unknown): number | null => {
      if (x === null || x === undefined || x === "") return null;
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    // `verdict` is an OBJECT on the wire ({grade, label, probabilityOfSkill, reason}); a
    // string is tolerated only defensively. Any non-string is never interpolated or
    // String()-ed, so "[object Object]" cannot reach an agent (ruling R39).
    const str = (x: unknown): string | null => (typeof x === "string" && x.length ? x : null);
    const verdictObj = (v: unknown): any => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
    const withheldReason = (r: any): string =>
      str(r?.withheld_reason) ??
      (verdictObj(r?.verdict) ? str(verdictObj(r.verdict).reason) : str(r?.verdict)) ??
      "withheld";
    const unreadable = (strata !== null && !Array.isArray(strata)) || (first !== null && rank(first) === 2);
    const withheldOnly = own.length > 0 && own.every((r) => r?.publishable === false);
    const matched = unreadable || !first
      ? null
      : first.publishable === true
        ? { state: "measured", dataAsOf: first.day ?? null, stratum: {
            engine: String(first.engine), horizonTier: String(first.horizon_tier), barRegime: String(first.bar_regime),
            recallPct: num(first.recall_pct), precisionPct: num(first.precision_pct), baseRatePct: num(first.base_rate_pct),
            leadMedianHours: num(first.lead_median_hours), effectiveSample: num(first.effective_sample),
            warnedEvents: num(first.warned_events), measuredOn: first.day ?? null,
            claimFamily: String(first.claim_family ?? "event_detection"),
            // The label derives from the row's own family: only an event_detection row is
            // described as a warned fall; any other family says what its verdict judged.
            claimMeans: String(first.claim_family ?? "event_detection") === "event_detection"
              ? "event_detection: a warned fall within the horizon"
              : (verdictObj(first.verdict) ? str(verdictObj(first.verdict).reason) : null) ?? `${String(first.claim_family)}: see the row's verdict`,
            grade: verdictObj(first.verdict) ? str(verdictObj(first.verdict).grade) : null,
            gradeReason: verdictObj(first.verdict) ? str(verdictObj(first.verdict).reason) : null } }
        : { state: "withheld", reason: withheldReason(first), dataAsOf: first.day ?? null };
    return {
      ...result,
      structuredContent: {
        ...(data as Record<string, unknown>),
        matchedTrackRecord: matched,
        recordMatchReason: matched
          ? (withheldOnly ? "engine_own_stratum_withheld" : "engine_own_stratum")
          : unreadable
            ? "strata_unreadable"
            : String(rec?.strata?.reason ?? "no_judged_rows_yet"),
        ownStrataCount: own.length,
      },
    };
  }

  if (record.state !== "measured") {
    // The producer block belongs HERE too, and this is the branch that needs it
    // most. When the HEADLINE record is withheld or unreadable, the old code
    // returned early and the agent got no producer disclosure at all — so the
    // one moment it most needs "canonical_verdict holds a measured record that
    // failed its gate" is the moment that sentence disappeared. This branch is
    // live-reachable: the whole record was withheld on 2026-08-24.
    return {
      ...result,
      structuredContent: {
        ...(data as Record<string, unknown>),
        matchedTrackRecord: null,
        recordMatchReason: record.reason,
        ...producerRecordBlock(data as Record<string, unknown>),
      },
    };
  }

  const match = recordMatchesPayload(data as Record<string, unknown>, record.stratum);
  return {
    ...result,
    structuredContent: {
      ...(data as Record<string, unknown>),
      matchedTrackRecord: match.matches ? record : null,
      recordMatchReason: match.reason,
      ...producerRecordBlock(data as Record<string, unknown>),
    },
  };
}

/**
 * The producer's OWN record, attached whenever the payload names a producer.
 *
 * `matchedTrackRecord` answers one narrow question — does the HEADLINE stratum
 * score this response? — and on market/symbol decisions the answer is always
 * no, because the headline is a different engine. That "no" was the entire
 * record signal an agent received, and it read as "Fahali holds nothing."
 *
 * Fahali usually holds something, and on `canonical_verdict` what it holds is
 * unflattering. Saying so is the product working. Read
 * [[fahali_a_withhold_must_withhold_the_numbers]] before widening what travels.
 */
function producerRecordBlock(data: Record<string, unknown>): Record<string, unknown> {
  // `normalised()` lowercases and collapses non-alphanumerics, so camelCase
  // arrives WITHOUT separators: `directionProducer` -> "directionproducer",
  // while `direction_producer` -> "direction_producer". Both spellings have to
  // be listed in already-normalised form. (This is the same trap that makes the
  // existing `engine_name` key silently fail to match a payload's
  // `engineNames` — see recordMatchesPayload.)
  const producers = [...valuesForKeys(data, new Set(["directionproducer", "direction_producer"]))]
    .filter(Boolean);
  if (!producers.length) return {};
  const index = getProducerIndex();
  const candidateIndex = getProducerCandidateIndex();
  const records = producers.map((engine) => producerRecordFor(index, engine));
  const candidates = producers.flatMap((engine) => producerRecordCandidatesFor(candidateIndex, engine));
  return {
    producerRecord: records.length === 1 ? records[0] : records,
    producerRecordCandidates: candidates,
    producerRecordNote:
      records.length > 1
        ? "This response mixes producers. Each entry is the judged record of ONE of them; match a row to its record by that row's provenance.directionProducer before quoting anything."
        : "producerRecord is the legacy one-record compatibility view. producerRecordCandidates preserves every judged stratum; binding authority must select an exact engine, horizon, instrument class, and claim-family match from that collection.",
  };
}
