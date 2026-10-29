// Pure request builders for the two engine-board tools (kept free of the proxy's
// transport so they can be unit-tested directly).

const ENGINE_KEY = /^[a-z][a-z0-9_]*$/;

function cleanSymbol(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? encodeURIComponent(raw.trim().toUpperCase()) : null;
}

/** A limit is sent only when it is a finite number or a non-empty numeric string. */
function cleanLimit(raw: unknown): string | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else return null;
  if (!Number.isFinite(n)) return null;
  return String(Math.max(1, Math.min(200, Math.trunc(n))));
}

export function fallWarningsRequest(args: any): { path: string; params?: Record<string, string> } {
  const symbol = cleanSymbol(args?.symbol);
  const limit = cleanLimit(args?.limit);
  return {
    path: symbol ? `/api/engines/fall-warning-8h/${symbol}` : "/api/engines/fall-warning-8h",
    ...(limit !== null ? { params: { limit } } : {}),
  };
}

export function engineBoardRequest(args: any): { path: string } | { error: string } {
  const engine = String(args?.engine ?? "").trim();
  if (!ENGINE_KEY.test(engine)) return { error: "engine must be a registry key like fall_warning_8h" };
  const symbol = cleanSymbol(args?.symbol);
  return { path: `/api/engines/${engine}/board${symbol ? `/${symbol}` : ""}` };
}
