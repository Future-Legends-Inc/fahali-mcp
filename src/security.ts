import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { FAHALI_OAUTH_SCOPES } from "./tools.js";

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const ALLOWED_OAUTH_SCOPES = new Set<string>(FAHALI_OAUTH_SCOPES);

/**
 * What a client gets when it omits `scope` from /authorize: EVERYTHING we
 * support.
 *
 * 🔴 It used to be the single scope `read:market`, and that default was written
 * TWICE — once at the /authorize call site and once inside `validateScopes` —
 * so a scope-omitting client was granted 1 of 8 and saw almost nothing. Of the
 * ~49 tools in the catalogue, only the market reads would dispatch: no memory,
 * no alerts, no watches, and neither `fahali_get_watch_delta` nor
 * `fahali_get_portfolio_decision` — the two tools this server's OWN
 * instructions call the default repeat read for continuous portfolio work.
 * The entire autonomous-analyst loop was behind a default nobody chose.
 *
 * RFC 6749 §3.3 lets an authorization server pick any pre-defined default when
 * the client omits `scope`. Picking the floor is a product decision disguised
 * as a safe one. **A default is a revenue surface.**
 *
 * Why granting the writes is right here: every `write:*` scope writes to
 * FAHALI — a saved watch, a memory, an alert, a delivery subscription. Fahali
 * is read-only toward capital by construction: no order routing, no path to a
 * broker. There is no privilege to escalate to, and the user still approves
 * the list on the consent screen. A client that genuinely wants less asks for
 * less, explicitly.
 */
export const DEFAULT_AUTHORIZE_SCOPES: string = FAHALI_OAUTH_SCOPES.join(" ");

export class HttpInputError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpInputError";
  }
}

async function readBody(
  req: IncomingMessage,
  maximumBytes = MAX_REQUEST_BODY_BYTES,
): Promise<string> {
  const advertised = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(advertised) && advertised > maximumBytes) {
    throw new HttpInputError(413, "payload_too_large", "Request body exceeds the 1 MiB limit");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maximumBytes) {
      throw new HttpInputError(413, "payload_too_large", "Request body exceeds the 1 MiB limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpInputError(400, "invalid_json", "Request body is not valid JSON");
  }
}

export async function readFormOrJsonBody(
  req: IncomingMessage,
): Promise<Record<string, any>> {
  const raw = await readBody(req);
  if (!raw) return {};
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpInputError(400, "invalid_request", "Request body must be an object");
    }
    return body as Record<string, any>;
  } catch (error) {
    if (error instanceof HttpInputError) throw error;
    // Some OAuth clients omit/mislabel Content-Type. Accept a real form body,
    // but do not silently turn arbitrary malformed JSON into an empty object.
    const params = new URLSearchParams(raw);
    if ([...params.keys()].length > 0 && raw.includes("=")) {
      return Object.fromEntries(params.entries());
    }
    throw new HttpInputError(400, "invalid_request", "Request body is not valid JSON or form data");
  }
}

export function sendInputError(res: ServerResponse, error: unknown): boolean {
  if (!(error instanceof HttpInputError)) return false;
  res.writeHead(error.status, {
    "Content-Type": "application/json",
    ...(error.status === 413 ? { Connection: "close" } : {}),
  });
  res.end(JSON.stringify({ error: error.code, error_description: error.message }));
  return true;
}

export function validateRedirectUri(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new HttpInputError(400, "invalid_redirect_uri", "redirect_uri must be a URL under 2048 characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpInputError(400, "invalid_redirect_uri", "redirect_uri is not a valid URL");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new HttpInputError(400, "invalid_redirect_uri", "redirect_uri must not contain credentials or a fragment");
  }
  const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localhost)) {
    throw new HttpInputError(400, "invalid_redirect_uri", "redirect_uri must use HTTPS (HTTP is allowed only for localhost)");
  }
  return parsed.toString();
}

export function validateClientRegistration(body: unknown): {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpInputError(400, "invalid_client_metadata", "Client metadata must be an object");
  }
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length < 1 || input.redirect_uris.length > 10) {
    throw new HttpInputError(400, "invalid_client_metadata", "redirect_uris must contain 1 to 10 URLs");
  }
  const redirect_uris = Array.from(new Set(input.redirect_uris.map(validateRedirectUri)));
  if (redirect_uris.length !== input.redirect_uris.length) {
    throw new HttpInputError(400, "invalid_client_metadata", "redirect_uris must be unique");
  }

  const client_name = input.client_name === undefined ? undefined : String(input.client_name).trim();
  if (client_name && client_name.length > 200) {
    throw new HttpInputError(400, "invalid_client_metadata", "client_name is too long");
  }
  let client_uri: string | undefined;
  if (input.client_uri !== undefined) {
    client_uri = validateRedirectUri(input.client_uri);
  }
  return { redirect_uris, client_name: client_name || undefined, client_uri };
}

/**
 * 🔴 This REFUSES an empty scope; it no longer substitutes one.
 *
 * The default now lives at exactly one place — `DEFAULT_AUTHORIZE_SCOPES`,
 * applied at /authorize where a client legitimately omits `scope`. This
 * function is also the re-validation boundary for the signed assertion coming
 * back from app.fahaliai.com and for a refresh_token's requested scope, and a
 * default is WRONG at both:
 *
 * - An assertion that arrives with no scope is malformed. Silently substituting
 *   one turns a broken handshake into a quiet, arbitrary grant.
 * - `refresh_token` with an explicit empty `scope=` used to be handed back
 *   `["read:market"]` — silently NARROWING a working 8-scope connector to one
 *   scope at refresh time, with no error anywhere. A grant may narrow only when
 *   the client actually asks it to.
 *
 * Substituting a value for absent input is how absence renders as something
 * definite. Here the honest answer is a 400.
 */
export function validateScopes(value: unknown): string[] {
  const scopes = String(value ?? "").split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => !ALLOWED_OAUTH_SCOPES.has(scope))) {
    throw new HttpInputError(400, "invalid_scope", "Requested scope is empty or not recognized");
  }
  return Array.from(new Set(scopes));
}

export function validateCodeChallenge(value: unknown): string {
  const challenge = typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    throw new HttpInputError(400, "invalid_request", "A valid S256 code_challenge is required");
  }
  return challenge;
}

export function credentialFingerprint(value: string | undefined): string | undefined {
  return value ? createHash("sha256").update(value, "utf8").digest("hex") : undefined;
}

export function credentialFingerprintMatches(
  expected: string | undefined,
  credential: string | undefined,
): boolean {
  if (!expected || !credential) return false;
  const actual = credentialFingerprint(credential)!;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
