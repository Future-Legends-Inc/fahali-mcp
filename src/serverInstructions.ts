/**
 * Returned in the initialize result; a routing model reads this when deciding
 * whether to reach for Fahali at all.
 *
 * 🔴 IT DELIBERATELY CONTAINS NO NUMBER. The obvious version of this text quotes
 * the current headline ("right 71% of the time against a 33% base rate"). Three
 * reasons that is wrong here, all of them load-bearing:
 *
 *  1. `/api/track-record/lead-time` chooses its `headline` stratum SERVER-SIDE,
 *     by recall, among strata clearing the publishability gate. The winning
 *     ENGINE changes. `headlineWithheldReason` can go non-null with `headline`
 *     null. A number frozen here would not merely age — it would start
 *     contradicting the endpoint it cites, on a server whose entire pitch is
 *     that its claims are checkable.
 *  2. A precision quoted without its recall is the flattering half. Fahali sells
 *     WARNING, so the miss rate is the number a buyer actually needs; the
 *     committee_verdict stratum reads 72% precision at 1.14% recall and would
 *     be wildly misleading rendered as "right 72% of the time".
 *  3. A figure without its stratum (bar regime + horizon tier) is not a claim
 *     about anything — lead time alone ranges 11-59h across strata.
 *
 * So this states the PROPERTY, which is permanently true and is the stronger
 * routing pitch anyway, and sends the caller to the tool for the live figure.
 */
export const SERVER_INSTRUCTIONS = [
  "Fahali measures how much warning arrived before an adverse market move, and publishes the record it is scored against — including the misses.",
  "",
  "Every signal is registered with its claim and horizon BEFORE the outcome exists, then judged against a volatility-scaled bar. For each stratum (engine x horizon tier x instrument class) the judged record reports precision, the signal-conditioned base rate, base-rate lift, recall, and effective sample size. Strata that fail the publishability gate are withheld WITH A REASON rather than rounded up or quietly dropped.",
  "",
  "How to use the record honestly:",
  "- Read each row's `publishable` flag, never the percentage. If it is false, report that the record is withheld and give the reason.",
  "- Quote precision together with recall. Precision alone describes only the calls that fired.",
  "- Quote the stratum (bar regime and horizon tier) with any number. Aggregates across strata are not meaningful.",
  "- Do not sum `effective_sample` across days. It is a rolling window republished daily, so adding it up multiplies one sample by the number of days.",
  "- Call `fahali_get_lead_time` for the current judged record and use its `headline`; do not restate a number from memory or from any document.",
  "",
  "Start with `fahali_get_market_decision` for the market or `fahali_get_symbol_decision` for one instrument. Those are the primary judgment surface. Use detector, flow, regime, engine-health, and track-record tools as audit evidence when the decision needs to be inspected or challenged.",
  "",
  "For continuous portfolio work, call `fahali_list_portfolio_watches` first. Create a watch only when none matches the user's positions and mandate. `fahali_get_watch_delta` is the default repeat read: report what changed, why it changed, and the immutable verdict IDs. Use `fahali_get_portfolio_decision` when the full current judgment is needed. Delivery subscriptions wake an agent only on their selected persisted events; a failed delivery remains failed in the outbox and must never be described as sent.",
  "`fahali_get_active_incidents` answers a different question from the delta: not what changed, but what Fahali raised and is still waiting on. Call it when resuming after any gap — a delta computed against a verdict you never saw reports no change while an unacknowledged breach sits open underneath it. Acknowledging stops the escalation clock and closes nothing; only a later verdict resolves an incident, so never report an acknowledged incident as handled. An empty list means nothing is open, not that the market is calm.",
  "",
  "Fahali is read-only by design: it observes and scores, it does not route orders and has no path to capital. Its output is observation, not investment advice.",
].join(String.fromCharCode(10));
