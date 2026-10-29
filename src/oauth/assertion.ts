import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = () => process.env.FAHALI_OAUTH_SIGNING_SECRET;
const ASSERTION_TTL_SECONDS = 60;
const NONCE_CLEANUP_INTERVAL = 60_000; // sweep every 60s

// In-memory nonce store for single-use enforcement.
// Entries are cleaned up after ASSERTION_TTL_SECONDS + grace period.
const seenNonces = new Map<string, number>();

// Periodic cleanup of expired nonces.
setInterval(() => {
  const cutoff = Date.now() - (ASSERTION_TTL_SECONDS + 10) * 1000;
  for (const [nonce, ts] of seenNonces) {
    if (ts < cutoff) seenNonces.delete(nonce);
  }
}, NONCE_CLEANUP_INTERVAL).unref();

/** Mark a nonce as consumed. Returns true if already seen (replay detected). */
export function consumeNonce(nonce: string): boolean {
  if (seenNonces.has(nonce)) return true;
  seenNonces.set(nonce, Date.now());
  return false;
}

export type OAuthAssertionPayload = {
  user_id: string;
  email: string;
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  scope: string[];
  exp: number;
  nonce: string;
};

/** Sign an assertion payload with the shared HMAC secret. */
export function signAssertion(payload: Omit<OAuthAssertionPayload, "nonce" | "exp">): {
  payload: OAuthAssertionPayload;
  sig: string;
  encoded: string;
} {
  const secret = SECRET();
  if (!secret) throw new Error("FAHALI_OAUTH_SIGNING_SECRET not set");

  const full: OAuthAssertionPayload = {
    ...payload,
    nonce: randomBytes(16).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + ASSERTION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("hex");
  return { payload: full, sig, encoded };
}

/** Verify an HMAC-signed assertion. Returns the decoded payload or throws.
 *  Also enforces single-use via nonce replay protection. */
export function verifyAssertion(encoded: string, sig: string): OAuthAssertionPayload {
  const secret = SECRET();
  if (!secret) throw new Error("FAHALI_OAUTH_SIGNING_SECRET not set");
  if (encoded.length === 0 || encoded.length > 16_384 || !/^[a-fA-F0-9]{64}$/.test(sig)) {
    throw new Error("invalid_assertion: malformed envelope");
  }

  const expected = createHmac("sha256", secret).update(encoded).digest();
  const sigBuf = Buffer.from(sig, "hex");
  if (sigBuf.length !== expected.length || !timingSafeEqual(expected, sigBuf)) {
    throw new Error("invalid_assertion: signature mismatch");
  }

  let payload: OAuthAssertionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    throw new Error("invalid_assertion: malformed payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.user_id !== "string" ||
    payload.user_id.length < 3 ||
    payload.user_id.length > 256 ||
    typeof payload.email !== "string" ||
    payload.email.length > 320 ||
    typeof payload.client_id !== "string" ||
    payload.client_id.length < 3 ||
    payload.client_id.length > 256 ||
    typeof payload.code_challenge !== "string" ||
    typeof payload.redirect_uri !== "string" ||
    !Array.isArray(payload.scope) ||
    payload.scope.some((scope) => typeof scope !== "string") ||
    typeof payload.exp !== "number" ||
    typeof payload.nonce !== "string" ||
    !/^[a-fA-F0-9]{32}$/.test(payload.nonce)
  ) {
    throw new Error("invalid_assertion: invalid claims");
  }

  if (payload.exp < now) {
    throw new Error("invalid_assertion: expired");
  }
  if (payload.exp > now + ASSERTION_TTL_SECONDS + 10) {
    throw new Error("invalid_assertion: expiry outside allowed window");
  }

  // Single-use nonce enforcement — reject replay within TTL window
  if (consumeNonce(payload.nonce)) {
    throw new Error("invalid_assertion: nonce already consumed (replay detected)");
  }

  return payload;
}

