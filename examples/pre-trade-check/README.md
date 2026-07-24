# Pre-trade risk check (Fahali MCP example)

A risk conscience for a trading agent, in about 40 lines and one command.

Your agent decides what it wants to trade. Before it acts, this check asks Fahali
three things and folds the answer into the decision:

1. Is a flash-crash precursor firing on this symbol right now?
2. What is the judged read, how confident is it, and what data is missing?
3. How early does Fahali's own record say its engines usually warn?

It then prints a risk posture (`PROCEED` / `CAUTION` / `HOLD`) and the signed
receipt, so the decision is auditable later. Fahali is observation, not advice:
this check informs your agent, it does not trade for you.

## Run it

Node 18+ (uses native `fetch`, zero dependencies).

```bash
cp .env.example .env      # then paste your free developer key
node agent.mjs BTCUSDT
```

Get a free key at https://app.fahaliai.com/developer (no card, 50 calls/day).

## What you get

```
$ node agent.mjs BTCUSDT

Fahali is live · monitoring 1877 instruments.

Flash-crash precursor   no precursor firing
Judged read             cautious, confidence 0.41, missing: funding_rate
Verified lead-time base 9 engines, verified, outcome-scored

RISK POSTURE: CAUTION
  low conviction (confidence 0.41); missing input: funding_rate.
  Receipt: sha256:… (attach to your trade log)
```

The lead-time record is **public** — it prints even before you add a key, which
is the fastest way to see that Fahali is scored against outcomes, not asserted.

The exact fields come from the live JSON; the script prints the raw responses
too, so you can see precisely what your agent would consume.

## Why this is not a price feed

- **Verified lead time.** `/api/track-record/lead-time` returns a per-engine
  record scored against what the market actually did, misses included. Your
  agent can weight a signal by proven lead, not by tone.
- **Signed receipts.** Every verdict carries a SHA-256 receipt and a provenance
  root. Your agent can attach proof of what was said and when.
- **Honest absence.** When Fahali cannot tell, it abstains and says so. Silence
  is never scored as a win.

## Endpoints this uses

| Call | Auth | Purpose |
|------|------|---------|
| `GET /api/public/stats` | none | is the platform live, what is covered |
| `GET /api/risk/flash-crash?symbol=` | key | precursor strength (abstains if unknown) |
| `GET /agent/verdict?symbol=` | key | judged read + confidence + missing inputs + receipt |
| `GET /api/track-record/lead-time` | none | the verified, outcome-scored lead-time record (public) |

If your key's lane does not include verdicts, the script skips that call and
still runs on the free signals. Nothing here fabricates a value it does not have.
