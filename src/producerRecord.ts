/**
 * What each claim producer's own judged record says.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `judgedRecord.ts` attaches the HEADLINE stratum and reports whether it
 * matches the response. On every market/symbol decision it does not match, and
 * the agent got: "This response does not name the engine that produced it...
 * The decision is UNSCORED." Two things were wrong with that wording.
 *
 * 1. It described a defect in OUR payload as a property of the response. The
 *    payload did name a producer; the matcher just did not read that field.
 * 2. `agent_verdict` is a non-binding evidence producer, while
 *    `canonical_verdict` is the sole arbiter that sets market direction on the
 *    enriched rows. The canonical engine IS registered and IS measured. Its stratum is withheld because its
 *    precision does not beat its own base rate. Telling an agent "no record
 *    exists" when we hold a measured, UNFLATTERING record is the flattering
 *    error, and it is the one the doctrine cares about.
 *
 * So: report the producer's own record status, always, with a real answer in
 * every branch. "We hold no record for this producer" and "we hold a record and
 * it did not clear the gate" are different facts and an agent must get the
 * right one.
 *
 * ── 🔴 The figure-redaction rule ────────────────────────────────────────────
 * The upstream withheld reasons embed diagnostics: "precision does not beat its
 * own base rate (46.3 vs 54.06)". Those numbers are REAL and NOT QUOTABLE — the
 * endpoint says so itself. An LLM handed that string will restate "46.3%
 * precision" as a Fahali figure, which is precisely the retraction risk the
 * doctrine exists to prevent, and this codebase has already shipped a
 * republished retracted number twice inside explanatory prose.
 *
 * So every reason crossing into the agent channel has its FIGURES STRIPPED and
 * keeps its QUALITATIVE claim. "precision does not beat its own base rate" is
 * the honest, damning, unquotable sentence. The number adds nothing an agent
 * may act on and everything it may misquote.
 */

/** Claim producers and their authority roles. Only canonical_verdict binds direction. */
export const VERDICT_PRODUCERS = {
  canonical_verdict: "The current canonical verdict arbiter and sole binding market-direction authority — the same authority the app renders.",
  agent_verdict: "The master agent's non-binding evidence synthesis (modelVersion spectra-master-agent-v1); never a direction authority.",
  committee_verdict: "The committee's non-binding evidence product for canonical arbitration; never a direction authority.",
} as const;

/** @deprecated Compatibility alias. This is a producer registry, not an authority registry. */
export const DIRECTION_PRODUCERS = VERDICT_PRODUCERS;

export type VerdictProducer = keyof typeof VERDICT_PRODUCERS;
/** @deprecated Compatibility type name. */
export type DirectionProducer = VerdictProducer;

export type ProducerRecord =
  | {
      engine: string;
      state: "published";
      quotable: true;
      horizonTier: string; barRegime: string;
      precisionPct: number; recallPct: number; baseRatePct: number;
      effectiveSample: number; measuredOn: string | null;
      /** Optional because older lead-time rows predate explicit claim-family registration. */
      claimFamily?: string | null;
      /** Which identity population produced this stratum; binding use requires verified_only. */
      identityPopulation?: string | null;
      note: string;
    }
  | {
      engine: string;
      state: "withheld";
      quotable: false;
      /** Figures stripped. Qualitative only. */
      reasons: string[];
      strataMeasured: number;
      /** Present for a candidate tied to one refused stratum; absent on the legacy aggregate. */
      horizonTier?: string | null;
      barRegime?: string | null;
      claimFamily?: string | null;
      /** Population is qualitative provenance, not a withheld performance figure. */
      identityPopulation?: string | null;
      /**
       * The measured grade the server's verification canon attached to this
       * stratum (founder ruling 2026-09-25: every read carries its grade). The
       * label only — the figures behind it stay stripped like the reasons.
       * Null when the stratum carried no grade.
       */
      grade?: string | null;
      gradeLabel?: string | null;
      note: string;
    }
  | {
      engine: string;
      state: "not_registered";
      quotable: false;
      note: string;
    }
  | {
      engine: string;
      state: "unavailable";
      quotable: false;
      note: string;
    };

/** Digit-free sentinels for tokens that must survive redaction (see below). */
const KEEP_OPEN = "";
const KEEP_CLOSE = "";

/**
 * Strip anything an agent could quote as a Fahali figure, keeping the sentence.
 *
 * Deliberately STRUCTURAL, not an enumeration of banned phrases: every previous
 * attempt in this codebase to enumerate the words around a banned number found
 * something new the next time someone widened it.
 *
 * ── 🔴 What must SURVIVE (fixed 2026-08-27, caught in production output) ─────
 * The first version stripped every digit, which turned
 *   "judged by v1-identification-2026-08-23 on whether..."
 * into
 *   "judged by v[withheld]-identification[withheld][withheld][withheld]on..."
 *
 * A methodology version NAMES THE RULE a claim was judged under. It is
 * provenance an agent needs, and nobody can misquote it as an accuracy. Same
 * for a measurement date. The doctrine's concern is a PERFORMANCE figure —
 * precision, base rate, lift, recall, sample size — travelling somewhere it can
 * be restated as Fahali's accuracy. Identifiers are not that.
 *
 * The second attempt indexed protected tokens as " 0 ", " 1 " — numeric
 * placeholders, inside a function whose job is deleting bare numbers, so every
 * protected identifier was stripped by the exact step it was hidden from. The
 * sentinel is digit-free by construction, and the index is encoded a-j.
 */
export function stripFigures(reason: string): string {
  const keepers: string[] = [];
  const keep = (m: string): string => {
    keepers.push(m);
    const tag = String(keepers.length - 1).replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)));
    return KEEP_OPEN + tag + KEEP_CLOSE;
  };

  const stripped = String(reason)
    // v1-identification-2026-08-23, v6-material-lift-2026-08-22, v5-first-passage
    .replace(/\bv\d+(?:[-.][A-Za-z]+)*(?:-\d{4}-\d{2}-\d{2})?\b/g, keep)
    // bare ISO measurement dates
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, keep)
    // Parenthetical diagnostics: "(46.3 vs 54.06)", "(+0.48pp, ..., n_eff=2080)"
    .replace(/\s*\([^)]*\d[^)]*\)/g, "")
    // "n_eff=2080", "warned_events=0" — keep the key, drop the value.
    .replace(/\b([A-Za-z_]+)\s*=\s*-?\d[\d.,]*/g, "$1=[withheld]")
    // Any remaining standalone number. Whitespace is consumed ONLY as part of a
    // "12 pp" / "12 %" unit — an unconditional \s* ate the space after every
    // number and shipped "[withheld]consecutive daily snapshots".
    .replace(/[-+]?\d[\d.,]*(?:\s*(?:pp|%))?/g, "[withheld]")
    .replace(/\s{2,}/g, " ");

  return stripped
    .replace(new RegExp(KEEP_OPEN + "([a-j]+)" + KEEP_CLOSE, "g"), (_m, tag: string) => {
      const i = Number(tag.replace(/[a-j]/g, (c) => String(c.charCodeAt(0) - 97)));
      return keepers[i] ?? "";
    })
    .trim();
}

type LeadTimeBody = {
  trackRecord?: Array<Record<string, any>>;
  /** The VLT envelope explicitly declares the population used by every row. */
  identity_population?: string;
  identityPopulation?: string;
  withheld?: {
    strata?: Array<{
      stratum?: string;
      effectiveSample?: number;
      reason?: string;
      identity_population?: string;
      identityPopulation?: string;
      claim_family?: string | null;
      verdict?: { grade?: string | null; label?: string | null } | null;
    }>;
  };
};

/** Every judged stratum for an engine. The old per-engine Map remains as a compatibility view. */
export type ProducerCandidateIndex = Map<string, ProducerRecord[]>;

function stratumParts(label: string): string[] {
  // "correlation · 24h · equity" — the separator arrives as a mojibake'd
  // middot over the wire, so split on runs of non-alphanumerics rather than on
  // a literal character that may not survive transport.
  return String(label).split(/[^A-Za-z0-9_]+/).filter(Boolean);
}

function engineOfStratum(label: string): string {
  return stratumParts(label)[0] ?? "";
}

/**
 * Build the per-engine index from ONE lead-time body.
 *
 * `published` is only ever taken from `trackRecord` (rows that cleared the
 * gate). A withheld stratum can never be promoted here — that would be
 * re-deriving a refused number, which is the exact move
 * [[fahali_scorecard_denominator_retracted]] forbids.
 */
function candidateKey(record: ProducerRecord): string {
  const stateRank = record.state === "published" ? "0" : record.state === "withheld" ? "1" : "2";
  const horizon = "horizonTier" in record ? String(record.horizonTier ?? "") : "";
  const regime = "barRegime" in record ? String(record.barRegime ?? "") : "";
  const family = "claimFamily" in record ? String(record.claimFamily ?? "") : "";
  const identityPopulation = "identityPopulation" in record ? String(record.identityPopulation ?? "") : "";
  const measuredOn = record.state === "published" ? String(record.measuredOn ?? "") : "";
  return [stateRank, record.engine, horizon, regime, family, identityPopulation, measuredOn].join("\u0000");
}

function pushCandidate(index: ProducerCandidateIndex, record: ProducerRecord): void {
  const rows = index.get(record.engine) ?? [];
  rows.push(record);
  rows.sort((a, b) => candidateKey(a).localeCompare(candidateKey(b)));
  index.set(record.engine, rows);
}

/**
 * Preserve every producer stratum. Authority checks must select from this
 * collection by engine + horizon + instrument class (+ claim family when the
 * source supplies it); a Map keyed by engine alone necessarily destroys that
 * distinction.
 */
export function buildProducerCandidateIndex(body: unknown): ProducerCandidateIndex {
  const out: ProducerCandidateIndex = new Map();
  const b = (body ?? {}) as LeadTimeBody;

  for (const row of Array.isArray(b.trackRecord) ? b.trackRecord : []) {
    const engine = String(row?.engine ?? "").trim();
    if (!engine || row?.publishable !== true) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const precisionPct = num(row.precision_pct);
    const recallPct = num(row.recall_pct);
    const baseRatePct = num(row.base_rate_pct);
    const effectiveSample = num(row.effective_sample);
    // Precision without recall is the flattering half and is never published
    // alone. A row missing either is not a record we can state.
    if (precisionPct == null || recallPct == null || baseRatePct == null || effectiveSample == null) continue;
    pushCandidate(out, {
      engine, state: "published", quotable: true,
      horizonTier: String(row.horizon_tier ?? ""), barRegime: String(row.bar_regime ?? ""),
      precisionPct, recallPct, baseRatePct, effectiveSample,
      measuredOn: row.day ? String(row.day) : null,
      claimFamily: row.claim_family_resolved ? String(row.claim_family_resolved) :
        row.claim_family ? String(row.claim_family) : null,
      identityPopulation: row.identity_population ? String(row.identity_population) :
        row.identityPopulation ? String(row.identityPopulation) :
          row.identity_status === "verified" ? "verified_only" :
            row.identity_status ? String(row.identity_status) : null,
      note: "Quote precision and recall together, and always with the stratum (horizon tier and instrument class). This figure describes this stratum only and is not a platform accuracy.",
    });
  }

  const withheldByStratum = new Map<string, {
    engine: string;
    horizonTier: string | null;
    barRegime: string | null;
    claimFamily: string | null;
    identityPopulation: string | null;
    grade: string | null;
    gradeLabel: string | null;
    reasons: string[];
  }>();
  for (const s of b.withheld?.strata ?? []) {
    const parts = stratumParts(String(s?.stratum ?? ""));
    const engine = parts[0] ?? "";
    if (!engine) continue;
    const reason = stripFigures(String(s?.reason ?? "")).trim();
    if (!reason) continue;
    const horizonTier = parts[1] ?? null;
    const barRegime = parts[2] ?? null;
    // The envelope publishes the family as its own field; the label is only
    // "engine · horizon · class" and has no fourth part. Reading parts[3]
    // alone made every withheld family null, which (a) merged the measured
    // directional stratum with the not-measured one under the same key and
    // (b) made decision eligibility report a "stratum mismatch" for a stratum
    // that matched exactly and was refused on its record. Explicit producer
    // data only — never derived.
    const claimFamily = s?.claim_family ? String(s.claim_family) : parts[3] ?? null;
    const grade = s?.verdict && typeof s.verdict.grade === "string" ? s.verdict.grade : null;
    const gradeLabel = s?.verdict && typeof s.verdict.label === "string" ? s.verdict.label : null;
    // readWithheldStrata selects verified-only rows and the VLT response states
    // that contract at the envelope. Preserve it here even for gate-withheld,
    // frozen and stale rows: population provenance is not a performance figure
    // and stripping it makes Gate 3 misdiagnose a below-base record as an
    // unknown/mixed identity population.
    const identityPopulation = s?.identity_population ? String(s.identity_population) :
      s?.identityPopulation ? String(s.identityPopulation) :
        b.identity_population ? String(b.identity_population) :
          b.identityPopulation ? String(b.identityPopulation) : null;
    const key = [engine, horizonTier ?? "", barRegime ?? "", claimFamily ?? ""].join("\u0000");
    const entry = withheldByStratum.get(key) ?? {
      engine, horizonTier, barRegime, claimFamily, identityPopulation, grade, gradeLabel, reasons: [],
    };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    withheldByStratum.set(key, entry);
  }
  for (const entry of withheldByStratum.values()) {
    pushCandidate(out, {
      engine: entry.engine, state: "withheld", quotable: false,
      reasons: entry.reasons.slice(0, 4),
      strataMeasured: entry.reasons.length,
      horizonTier: entry.horizonTier,
      barRegime: entry.barRegime,
      claimFamily: entry.claimFamily,
      identityPopulation: entry.identityPopulation,
      grade: entry.grade,
      gradeLabel: entry.gradeLabel,
      note: "Fahali holds a MEASURED record for this producer and it did not clear the publishability gate. The figures behind these reasons are real and are not quotable — do not restate any number for this engine. An engine that fails its gate is a disclosed limitation, not an absence of evidence.",
    });
  }
  return out;
}

/**
 * Legacy one-record-per-engine view. Kept for schema compatibility only; new
 * authority code must use buildProducerCandidateIndex/producerRecordCandidatesFor.
 */
export function buildProducerIndex(body: unknown): Map<string, ProducerRecord> {
  const candidates = buildProducerCandidateIndex(body);
  const out = new Map<string, ProducerRecord>();
  for (const [engine, rows] of candidates) {
    const published = rows.filter((row) => row.state === "published");
    if (published.length) {
      out.set(engine, published[0]);
      continue;
    }
    const withheld = rows.filter((row): row is Extract<ProducerRecord, { state: "withheld" }> => row.state === "withheld");
    if (withheld.length) {
      const reasons = [...new Set(withheld.flatMap((row) => row.reasons))];
      const identityPopulations = [...new Set(
        withheld.map((row) => row.identityPopulation).filter((value): value is string => Boolean(value)),
      )];
      out.set(engine, {
        engine,
        state: "withheld",
        quotable: false,
        reasons: reasons.slice(0, 4),
        strataMeasured: withheld.length,
        identityPopulation: identityPopulations.length === 1 ? identityPopulations[0] : null,
        note: withheld[0].note,
      });
    }
  }
  return out;
}

export function producerRecordCandidatesFor(
  index: ProducerCandidateIndex | null,
  engine: string,
): ProducerRecord[] {
  if (!index) return [producerRecordFor(null, engine)];
  const rows = index.get(engine);
  return rows?.length ? [...rows] : [producerRecordFor(new Map(), engine)];
}

export type ClassCoverage = {
  instrumentClass: string;
  publishedStrata: number;
  measuredButWithheld: number;
  noResolvedRows: number;
  /** Engines with a real sample that did not clear the gate. Figures stripped. */
  withheldExamples: Array<{ engine: string; reason: string }>;
};

/**
 * Coverage of the judged record BY INSTRUMENT CLASS.
 *
 * ── Why (re-audit M3, 2026-08-27) ───────────────────────────────────────────
 * Both publishable strata are crypto, and an agent asking what Fahali knows
 * about equities got nothing it could act on. The truthful answer is neither
 * "we cover equities" nor "we don't": equity IS measured — several strata carry
 * real effective samples — and every one of them is WITHHELD for a measured
 * reason (lift not distinguishable from zero, precision below its own base
 * rate, no warned events). That is a much stronger statement than silence, and
 * it is the honest one.
 *
 * `measuredButWithheld` and `noResolvedRows` are counted SEPARATELY on purpose.
 * They are different facts: one is "we measured and it failed", the other is
 * "there was nothing to measure". Folding them into a single withheld count is
 * how "we have no equity evidence" and "our equity evidence is weak" become
 * indistinguishable.
 */
export function buildInstrumentClassCoverage(body: unknown): ClassCoverage[] {
  const b = (body ?? {}) as LeadTimeBody;
  const byClass = new Map<string, ClassCoverage>();
  const get = (cls: string): ClassCoverage => {
    let hit = byClass.get(cls);
    if (!hit) {
      hit = { instrumentClass: cls, publishedStrata: 0, measuredButWithheld: 0, noResolvedRows: 0, withheldExamples: [] };
      byClass.set(cls, hit);
    }
    return hit;
  };

  for (const row of Array.isArray(b.trackRecord) ? b.trackRecord : []) {
    const cls = String(row?.bar_regime ?? "").trim();
    if (cls && row?.publishable === true) get(cls).publishedStrata++;
  }

  for (const s of b.withheld?.strata ?? []) {
    const parts = stratumParts(String(s?.stratum ?? ""));
    const cls = parts[parts.length - 1] ?? "";
    if (!cls) continue;
    const entry = get(cls);
    const sample = typeof s?.effectiveSample === "number" ? s.effectiveSample : 0;
    if (sample > 0) {
      entry.measuredButWithheld++;
      if (entry.withheldExamples.length < 5) {
        entry.withheldExamples.push({ engine: parts[0] ?? "", reason: stripFigures(String(s?.reason ?? "")) });
      }
    } else {
      entry.noResolvedRows++;
    }
  }
  return [...byClass.values()].sort((a, b2) => b2.publishedStrata - a.publishedStrata);
}

/**
 * Answer for one producer. Never returns "unknown" without saying which kind of
 * unknown it is — the whole point of the module.
 */
export function producerRecordFor(
  index: Map<string, ProducerRecord> | null,
  engine: string,
): ProducerRecord {
  if (!index) {
    return {
      engine, state: "unavailable", quotable: false,
      note: "The judged record could not be read on this request, so this producer's record status is unknown. Unknown is not a pass — retry before treating this producer's claim or evidence as scored or unscored.",
    };
  }
  const hit = index.get(engine);
  if (hit) return hit;
  return {
    engine, state: "unavailable", quotable: false,
    note:
      `${engine} has no identity-valid published or withheld stratum in this record response. That does not prove the producer never registered: the response carries no producer-specific registration census, and excluded or incomplete populations may exist. ` +
      "No precision, recall, lead time, or absence claim is authorized. Retry the record and keep this producer non-binding unless an explicit producer census proves its registration state. Only canonical_verdict may supply the binding market direction, and only after its exact stratum clears every authority gate.",
  };
}
