#!/usr/bin/env node
// Pre-trade risk check — a risk conscience for a trading agent.
// Fahali is observation, not advice: this informs a decision, it does not trade.
// Node 18+ (native fetch), zero dependencies.

const BASE = process.env.FAHALI_BASE || "https://app.fahaliai.com";
const KEY = process.env.FAHALI_KEY || "";
const SYMBOL = (process.argv[2] || "BTCUSDT").toUpperCase();

const auth = KEY ? { Authorization: `Bearer ${KEY}` } : {};

// Fetch JSON, never throw: return {ok, status, data} so the agent can reason
// about missing access or a down endpoint instead of crashing.
async function get(path, useKey = false) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: useKey ? auth : {} });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: String(err) };
  }
}

// Pull the first present field from a list of candidate names. Response shapes
// evolve; read defensively rather than assume one key exists.
const pick = (obj, ...names) => {
  for (const n of names) if (obj && obj[n] != null) return obj[n];
  return undefined;
};

function line(label, value) {
  console.log(`${label.padEnd(24)}${value}`);
}

const run = async () => {
  if (!KEY) {
    console.log("No FAHALI_KEY set — running the public checks only.");
    console.log("Get a free key at https://app.fahaliai.com/developer\n");
  }

  // 1. Public: is the platform live and what does it cover? (no auth)
  const stats = await get("/api/public/stats");
  if (stats.ok && stats.data) {
    const scanned = pick(stats.data, "instrumentsMonitored", "active_symbols", "scanned");
    console.log(
      `Fahali is live${scanned ? ` · monitoring ${scanned} instruments` : ""}.\n`,
    );
  } else {
    console.log("Could not reach Fahali public stats. Continuing.\n");
  }

  // 2. Flash-crash precursor for this symbol. Abstains honestly when unknown.
  const flash = await get(`/api/risk/flash-crash?symbol=${SYMBOL}`, true);
  let flashRead = "unavailable";
  let elevated = false;
  if (flash.ok && flash.data) {
    if (pick(flash.data, "abstained") === true) {
      flashRead = "abstained (not enough signal to call)";
    } else {
      const stance = pick(flash.data, "stance", "observation", "headline");
      const strength = pick(flash.data, "detectionStrength", "strength");
      flashRead = [stance, strength != null ? `strength ${strength}` : null]
        .filter(Boolean)
        .join(", ") || "no precursor firing";
      const s = String(stance || "").toLowerCase();
      elevated = s.includes("elevat") || s.includes("warn") || s.includes("critical");
    }
  } else if (!KEY) {
    flashRead = "needs a free key";
  } else if ([401, 402, 403].includes(flash.status)) {
    flashRead = "your key's lane does not include this tool";
  }
  line("Flash-crash precursor", flashRead);

  // 3. Judged read + confidence + missing inputs + signed receipt.
  const verdict = await get(`/agent/verdict?symbol=${SYMBOL}`, true);
  let conf = null;
  let missing = [];
  let receipt = null;
  let verdictGated = false;
  if (verdict.ok && verdict.data) {
    const v = pick(verdict.data, "verdict", "direction") || "no clear signal";
    conf = pick(verdict.data, "confidence");
    missing = pick(verdict.data, "missingSignals", "missing") || [];
    receipt = pick(verdict.data, "receipt", "provenanceRoot");
    const missTxt = missing.length ? `, missing: ${missing.join(", ")}` : "";
    const confTxt = conf != null ? `, confidence ${conf}` : "";
    line("Judged read", `${v}${confTxt}${missTxt}`);
  } else if (!KEY) {
    verdictGated = true;
    line("Judged read", "needs a free key — skipping");
  } else if ([401, 402, 403].includes(verdict.status)) {
    verdictGated = true;
    line("Judged read", "your key's lane does not include verdicts, skipping");
  } else {
    line("Judged read", "unavailable");
  }

  // 4. The verified lead-time record — the thing a price feed cannot show.
  const lead = await get("/api/track-record/lead-time", true);
  if (lead.ok && lead.data && Array.isArray(lead.data.trackRecord)) {
    const engines = new Set(lead.data.trackRecord.map((r) => r.engine || r.engine_key)).size;
    const tier = pick(lead.data, "claimTier") || "measured";
    line("Verified lead-time base", `${engines} engines, ${tier}, outcome-scored`);
  } else if ([401, 402, 403].includes(lead.status)) {
    line("Verified lead-time base", "your key's lane does not include this tool");
  } else {
    line("Verified lead-time base", "still accumulating");
  }

  // Compose a risk posture. This is a transparent rule over what Fahali returned,
  // not a Fahali instruction — your agent owns the decision.
  console.log("");
  let posture = "PROCEED";
  const reasons = [];
  if (elevated) {
    posture = "HOLD";
    reasons.push("a flash-crash precursor is firing");
  }
  if (conf != null && conf < 0.5) {
    if (posture !== "HOLD") posture = "CAUTION";
    reasons.push(`low conviction (confidence ${conf})`);
  }
  if (missing.length) {
    if (posture === "PROCEED") posture = "CAUTION";
    reasons.push(`missing input${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }
  if (verdictGated && !elevated) {
    reasons.push(KEY
      ? "verdict not on this key's lane; decide on the free signals or upgrade"
      : "add a free key for the judged verdict; free signals shown above");
  }

  console.log(`RISK POSTURE: ${posture}`);
  if (reasons.length) console.log(`  ${reasons.join("; ")}.`);
  if (posture === "PROCEED" && !reasons.length) {
    console.log("  No precursor, adequate conviction, no missing inputs.");
  }
  if (receipt) console.log(`  Receipt: ${receipt} (attach to your trade log)`);

  // Show the raw responses so a developer sees exactly what the agent consumed.
  if (process.env.FAHALI_RAW === "1") {
    console.log("\n--- raw responses ---");
    console.log(JSON.stringify({ flash: flash.data, verdict: verdict.data, lead: lead.data }, null, 2));
  }
};

run();
