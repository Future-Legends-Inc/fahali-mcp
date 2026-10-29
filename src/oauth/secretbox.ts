import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored at rest in the
 * MCP's own Postgres — specifically the per-user upstream `sk_live_` API key,
 * which (unlike `spectra_api_keys`, which is hash-only) must be replayable to
 * the Fahali API and therefore cannot be hashed.
 *
 * The encryption key is DERIVED from FAHALI_OAUTH_SIGNING_SECRET so we don't
 * introduce a new required env var. That secret is already mandatory for the
 * OAuth flow (assertion verification fails closed without it), so encryption
 * shares the same availability contract: if it's unset, the whole flow is down,
 * not silently weakened.
 */

const SECRET = process.env.FAHALI_OAUTH_SIGNING_SECRET;
// Fixed, non-secret salt — domain-separates this derived key from any other
// use of the same signing secret. Bumping the version invalidates old rows
// (they fail to decrypt → treated as missing → re-provisioned).
const SALT = "fahali-mcp-apikey-v1";

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!SECRET) {
    throw new Error(
      "FAHALI_OAUTH_SIGNING_SECRET is required to encrypt stored API keys.",
    );
  }
  if (!cachedKey) cachedKey = scryptSync(SECRET, SALT, 32);
  return cachedKey;
}

/** Encrypt a plaintext secret. Output: `v1:<iv>:<tag>:<ciphertext>` (base64url). */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/** Decrypt a value produced by sealSecret. Throws if tampered or wrong version. */
export function openSecret(sealed: string): string {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("unrecognized sealed-secret format");
  }
  const [, ivb, tagb, ctb] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivb, "base64url"));
  decipher.setAuthTag(Buffer.from(tagb, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctb, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
