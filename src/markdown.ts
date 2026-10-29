/**
 * Render a tool payload as Markdown, for clients that display tool output to a
 * human (ChatGPT, Claude Desktop). Emitted ALONGSIDE the JSON, never instead of
 * it — see okResult() in proxy.ts.
 *
 * 🔴 THE RULE THIS FILE EXISTS TO ENFORCE: a missing measurement must read as
 * missing. A Markdown table renders null as an empty cell, and an empty cell is
 * indistinguishable from zero, from "fine", and from "we didn't look". This
 * codebase has shipped that defect 7+ times ("absence renders as safety"), so
 * every absent value here is rendered with the WORD for what it is, and every
 * withheld value carries its reason into the cell.
 *
 * The second rule: `publishable: false` means the number in that row is not
 * quotable. Rendering it as a bare percentage in a table invites exactly the
 * quote the flag exists to prevent, so those rows are marked inline.
 */

const MAX_ROWS = 25;
const MAX_DEPTH = 4;
const MAX_CELL = 200;

/** Reasons we could not render a value, in the words a reader needs. */
const NOT_REPORTED = "*not reported*";
const EMPTY_LIST = "*none returned*";

function escapeCell(s: string): string {
  // A pipe or newline inside a cell silently destroys the table's column
  // alignment, which is how a value ends up displayed under the wrong header.
  const flat = s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  return flat.length > MAX_CELL ? flat.slice(0, MAX_CELL - 1) + "…" : flat;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The provenance envelopes this API returns. Each one encodes "we do not have
 * this, and here is why" — the whole point is that the why survives rendering.
 */
function renderEnvelope(v: Record<string, unknown>): string | null {
  // { withheld: { reason } } — a claim deliberately not published.
  if (isPlainObject(v.withheld)) {
    const reason = v.withheld.reason ?? v.withheld.message;
    return `**withheld** — ${reason ? escapeCell(String(reason)) : "no reason given"}`;
  }
  // NullReasonValue<T> = { value: T | null, reason?: string }
  if ("value" in v && (("reason" in v) || Object.keys(v).length === 1)) {
    if (v.value === null || v.value === undefined) {
      return `**withheld** — ${v.reason ? escapeCell(String(v.reason)) : "no value reported"}`;
    }
    return renderScalar(v.value);
  }
  return null;
}

function renderScalar(v: unknown): string {
  if (v === null || v === undefined) return NOT_REPORTED;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return NOT_REPORTED;
    // toPrecision(15) strips IEEE representation noise (38.669999999999995
    // -> 38.67) WITHOUT rounding the value: doubles carry ~15-17 significant
    // digits, so nothing a measurement actually holds is lost. A number that
    // looks broken in a table gets transcribed wrong, and these are published
    // figures.
    return String(Number(v.toPrecision(15)));
  }
  if (typeof v === "string") return v.length ? escapeCell(v) : NOT_REPORTED;
  if (Array.isArray(v)) {
    if (!v.length) return EMPTY_LIST;
    if (v.every((x) => !isPlainObject(x) && !Array.isArray(x)))
      return v.slice(0, 8).map(renderScalar).join(", ") + (v.length > 8 ? `, …(${v.length} total)` : "");
    return `*${v.length} ${v.length === 1 ? "entry" : "entries"} — see JSON*`;
  }
  if (isPlainObject(v)) {
    const env = renderEnvelope(v);
    if (env) return env;
    return "*object — see JSON*";
  }
  return escapeCell(String(v));
}

/** Human label for a key: snake_case / camelCase -> "Snake case". */
function label(key: string): string {
  const spaced = key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A row whose own `publishable` flag is false carries numbers that must not be
 * quoted. Say so in the row itself — a footnote is not read, and the number is.
 */
function unpublishableNote(row: Record<string, unknown>): string | null {
  if (row.publishable !== false) return null;
  const w = isPlainObject(row.withheld) ? row.withheld.reason : undefined;
  const reason = w ?? row.withheldReason ?? row.reason;
  return reason
    ? `⚠️ not publishable — ${escapeCell(String(reason))}`
    : "⚠️ not publishable — do not quote this row's figures";
}

function renderTable(rows: Record<string, unknown>[]): string {
  const shown = rows.slice(0, MAX_ROWS);
  // Union of keys, in first-seen order, so a field present on only some rows is
  // never silently dropped from the table.
  const cols: string[] = [];
  for (const r of shown) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);

  const flagged = shown.some((r) => r.publishable === false);
  const header = flagged ? [...cols, "note"] : cols;

  const lines = [
    `| ${header.map(label).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const r of shown) {
    const cells = cols.map((c) => (c in r ? renderScalar(r[c]) : NOT_REPORTED));
    if (flagged) cells.push(unpublishableNote(r) ?? "");
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (rows.length > shown.length) {
    lines.push("", `*${rows.length - shown.length} further rows not shown here — the full set is in the JSON block below.*`);
  }
  return lines.join("\n");
}

function renderNode(data: unknown, depth: number, heading: string | null, out: string[]): void {
  if (depth > MAX_DEPTH) {
    out.push("*nested further — see JSON*");
    return;
  }
  if (Array.isArray(data)) {
    if (!data.length) { out.push(EMPTY_LIST); return; }
    if (data.every(isPlainObject)) { out.push(renderTable(data as Record<string, unknown>[])); return; }
    out.push(data.slice(0, MAX_ROWS).map((v) => `- ${renderScalar(v)}`).join("\n"));
    return;
  }
  if (!isPlainObject(data)) { out.push(renderScalar(data)); return; }

  const env = renderEnvelope(data);
  if (env) { out.push(env); return; }

  const scalars: [string, unknown][] = [];
  const sections: [string, unknown][] = [];
  for (const [k, v] of Object.entries(data)) {
    const nested = (Array.isArray(v) && v.length && v.every(isPlainObject)) ||
      (isPlainObject(v) && !renderEnvelope(v) && Object.keys(v).length > 0);
    (nested ? sections : scalars).push([k, v]);
  }

  if (scalars.length) {
    const note = unpublishableNote(data);
    if (note) out.push(`> ${note}`, "");
    out.push("| Field | Value |", "| --- | --- |");
    for (const [k, v] of scalars) out.push(`| ${label(k)} | ${renderScalar(v)} |`);
  }
  for (const [k, v] of sections) {
    out.push("", `${"#".repeat(Math.min(depth + 3, 6))} ${label(k)}`, "");
    renderNode(v, depth + 1, k, out);
  }
}

/**
 * Never throws. A rendering bug must degrade to "no table" — it must never take
 * down a tool call that otherwise succeeded, because the JSON block beside it
 * still carries the complete answer.
 */
export function toMarkdown(data: unknown): string | null {
  try {
    const out: string[] = [];
    renderNode(data, 0, null, out);
    const md = out.join("\n").trim();
    return md.length ? md : null;
  } catch {
    return null;
  }
}
