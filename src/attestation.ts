/**
 * Ed25519 attestation for Fahali receipts — the missing half of the documented backlog.
 *
 * `server/routes.ts:2699-2704` carries this note verbatim:
 *
 *   "HONESTY: this is an INTEGRITY hash, not a cryptographic signature — no
 *    private key is involved, so it proves the payload wasn't altered in
 *    transit/storage, NOT that Fahali attested it. True signed receipts need a
 *    persisted, key-signed root ledger (backlog). Don't market this as 'signed'
 *    until that exists."
 *
 * This module is the signing primitive for that backlog item. It is asymmetric
 * on purpose: a verifier needs only the public key from `getJwks()`, so third
 * parties can check a receipt offline with **no shared secret** to leak or
 * rotate.
 *
 * ── Two design decisions that differ from a naive version, both honesty-driven ──
 *
 * 1. NO ephemeral key is ever generated. If the key is not configured, receipts
 *    are returned with `signed: false` and a stated `unsigned_reason`. A version
 *    that generated a throwaway key when unconfigured would let the server emit
 *    "signed" receipts that are unverifiable after the next restart/deploy, and
 *    that are signed by nothing anyone can identify. Absence is reported as
 *    absence.
 *
 * 2. `signed` is derived, never asserted — it is exactly `signature !== null`,
 *    and `verifyReceipt` returns `valid: false` for anything unsigned. There is
 *    no code path where a missing signature reads as a passing check.
 *
 * There are no module-level side effects: keys are loaded by an explicit call,
 * so importing this file cannot generate key material or read the environment.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

import { canonicalizeJson, sha256HexUtf8 } from "./jcs.js";

export interface ReceiptKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Stable, verifiable identifier — env override, else the RFC 7638 thumbprint. */
  keyId: string;
  publicKeyPem: string;
}

export interface ReceiptKeyReport {
  configured: boolean;
  key_id: string | null;
  public_key_pem: string | null;
  /** Why receipts are unsigned. Present iff `configured` is false. */
  reason: string | null;
}

export interface FahaliReceipt {
  claim_id: string;
  horizon_hours: number | null;
  issued_at: string;
  payload_sha256: string;
  provenance_root: string;
  /** base64url Ed25519 signature, or null when no key is configured. */
  signature: string | null;
  key_id: string | null;
  /** Derived: exactly `signature !== null`. Never set independently. */
  signed: boolean;
  unsigned_reason: string | null;
}

export type ReceiptVerdict =
  | "VALID"
  | "UNSIGNED"
  | "HASH_MISMATCH"
  | "PROVENANCE_MISMATCH"
  | "SIGNATURE_INVALID"
  | "NO_PUBLIC_KEY"
  | "MALFORMED";

export interface ReceiptVerification {
  valid: boolean;
  verdict: ReceiptVerdict;
  detail: string;
  key_id: string | null;
}

export interface BuildReceiptOptions {
  claimId: string;
  horizonHours?: number | null;
  /** Caller-supplied so the signed material is explicit and tests are deterministic. */
  issuedAt: string;
}

const PRIVATE_KEY_ENV = "FAHALI_RECEIPT_ED25519_PRIVATE_KEY";
const PUBLIC_KEY_ENV = "FAHALI_RECEIPT_ED25519_PUBLIC_KEY";
const KEY_ID_ENV = "FAHALI_RECEIPT_KEY_ID";

/**
 * Load the receipt keypair from the environment.
 *
 * Returns `keys: null` plus a stated reason when unconfigured or unusable. It
 * never falls back to a generated key.
 */
export function loadReceiptKeys(
  env: NodeJS.ProcessEnv = process.env
): { keys: ReceiptKeys | null; report: ReceiptKeyReport } {
  const rawPrivate = env[PRIVATE_KEY_ENV];
  if (!rawPrivate || rawPrivate.trim() === "") {
    return {
      keys: null,
      report: {
        configured: false,
        key_id: null,
        public_key_pem: null,
        reason: `${PRIVATE_KEY_ENV} is not set, so receipts are returned unsigned rather than signed by an unidentifiable key`,
      },
    };
  }

  const privatePem = normalizePem(rawPrivate);
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(privatePem);
  } catch (error) {
    return {
      keys: null,
      report: {
        configured: false,
        key_id: null,
        public_key_pem: null,
        reason: `${PRIVATE_KEY_ENV} could not be parsed as a private key (${(error as Error).message}); refusing to substitute a generated key`,
      },
    };
  }

  if (privateKey.asymmetricKeyType !== "ed25519") {
    return {
      keys: null,
      report: {
        configured: false,
        key_id: null,
        public_key_pem: null,
        reason: `${PRIVATE_KEY_ENV} is a ${privateKey.asymmetricKeyType ?? "unknown"} key; this scheme is Ed25519`,
      },
    };
  }

  const derivedPublic = createPublicKey(privateKey);
  const derivedSpki = derivedPublic.export({ type: "spki", format: "der" }).toString("base64");

  const rawPublic = env[PUBLIC_KEY_ENV];
  if (rawPublic && rawPublic.trim() !== "") {
    const provided = normalizePem(rawPublic);
    let providedKey: KeyObject;
    try {
      providedKey = createPublicKey(provided);
    } catch (error) {
      return {
        keys: null,
        report: {
          configured: false,
          key_id: null,
          public_key_pem: null,
          reason: `${PUBLIC_KEY_ENV} could not be parsed (${(error as Error).message})`,
        },
      };
    }
    const providedSpki = providedKey.export({ type: "spki", format: "der" }).toString("base64");
    if (providedSpki !== derivedSpki) {
      // A mismatched pair would publish a JWKS that cannot verify our own
      // signatures. That is worse than being unsigned, so refuse outright.
      return {
        keys: null,
        report: {
          configured: false,
          key_id: null,
          public_key_pem: null,
          reason: `${PUBLIC_KEY_ENV} does not correspond to ${PRIVATE_KEY_ENV}; publishing it would produce receipts nobody can verify`,
        },
      };
    }
  }

  const publicKeyPem = derivedPublic.export({ type: "spki", format: "pem" }).toString();
  const envKeyId = env[KEY_ID_ENV];
  const keyId =
    envKeyId && envKeyId.trim() !== "" ? envKeyId.trim() : receiptKeyThumbprint(derivedPublic);

  return {
    keys: { privateKey, publicKey: derivedPublic, keyId, publicKeyPem },
    report: { configured: true, key_id: keyId, public_key_pem: publicKeyPem, reason: null },
  };
}

/**
 * Build a receipt over `payload`. With `keys === null` the receipt is returned
 * UNSIGNED and says why — it is never silently omitted and never faked.
 */
export function buildReceipt(
  payload: unknown,
  options: BuildReceiptOptions,
  keys: ReceiptKeys | null,
  unsignedReason: string | null = null
): FahaliReceipt {
  const payloadSha256 = canonicalSha256(payload);
  const provenanceRoot = sha256HexUtf8(
    `${options.claimId}:${payloadSha256}:${options.issuedAt}`
  );

  const base = {
    claim_id: options.claimId,
    horizon_hours: options.horizonHours ?? null,
    issued_at: options.issuedAt,
    payload_sha256: payloadSha256,
    provenance_root: provenanceRoot,
  };

  if (!keys) {
    return {
      ...base,
      signature: null,
      key_id: null,
      signed: false,
      unsigned_reason:
        unsignedReason ?? `${PRIVATE_KEY_ENV} is not configured; this receipt is an integrity hash, not an attestation`,
    };
  }

  const signature = sign(null, Buffer.from(receiptSigningInput(base), "utf8"), keys.privateKey);

  return {
    ...base,
    signature: signature.toString("base64url"),
    key_id: keys.keyId,
    signed: true,
    unsigned_reason: null,
  };
}

/**
 * Verify a receipt against `payload`.
 *
 * `publicKeyPem` is the key obtained from `getJwks()`. Without it the result is
 * `NO_PUBLIC_KEY` + `valid: false` — there is no "trust the embedded key id" path.
 */
export function verifyReceipt(
  payload: unknown,
  receipt: FahaliReceipt,
  publicKeyPem?: string
): ReceiptVerification {
  if (typeof receipt?.payload_sha256 !== "string" || typeof receipt?.provenance_root !== "string") {
    return {
      valid: false,
      verdict: "MALFORMED",
      detail: "receipt is missing payload_sha256 / provenance_root",
      key_id: receipt?.key_id ?? null,
    };
  }

  if (receipt.signed !== true || receipt.signature === null) {
    return {
      valid: false,
      verdict: "UNSIGNED",
      detail:
        receipt.unsigned_reason ??
        "receipt carries no signature; an unsigned payload must never read as verified",
      key_id: receipt.key_id ?? null,
    };
  }

  let payloadSha256: string;
  try {
    payloadSha256 = canonicalSha256(payload);
  } catch (error) {
    return {
      valid: false,
      verdict: "MALFORMED",
      detail: `payload cannot be canonicalized: ${(error as Error).message}`,
      key_id: receipt.key_id,
    };
  }

  if (payloadSha256 !== receipt.payload_sha256) {
    return {
      valid: false,
      verdict: "HASH_MISMATCH",
      detail: "payload does not canonicalize to the attested digest",
      key_id: receipt.key_id,
    };
  }

  const expectedRoot = sha256HexUtf8(
    `${receipt.claim_id}:${receipt.payload_sha256}:${receipt.issued_at}`
  );
  if (expectedRoot !== receipt.provenance_root) {
    return {
      valid: false,
      verdict: "PROVENANCE_MISMATCH",
      detail: "claim_id / issued_at do not reproduce the receipt's provenance root",
      key_id: receipt.key_id,
    };
  }

  if (!publicKeyPem || publicKeyPem.trim() === "") {
    return {
      valid: false,
      verdict: "NO_PUBLIC_KEY",
      detail: "no public key supplied; fetch it from the JWKS endpoint rather than trusting key_id",
      key_id: receipt.key_id,
    };
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch (error) {
    return {
      valid: false,
      verdict: "MALFORMED",
      detail: `public key could not be parsed (${(error as Error).message})`,
      key_id: receipt.key_id,
    };
  }

  let signatureValid = false;
  try {
    signatureValid = verify(
      null,
      Buffer.from(receiptSigningInput(receipt), "utf8"),
      publicKey,
      Buffer.from(receipt.signature, "base64url")
    );
  } catch {
    signatureValid = false;
  }

  return signatureValid
    ? { valid: true, verdict: "VALID", detail: "canonical payload matches the Ed25519 signature", key_id: receipt.key_id }
    : {
        valid: false,
        verdict: "SIGNATURE_INVALID",
        detail: "signature does not verify against the supplied public key",
        key_id: receipt.key_id,
      };
}

/**
 * The exact bytes signed: `${payload_sha256}.${provenance_root}`.
 * Exposed so an offline verifier holding only digests can reproduce it.
 */
export function receiptSigningInput(receipt: {
  payload_sha256: string;
  provenance_root: string;
}): string {
  return `${receipt.payload_sha256}.${receipt.provenance_root}`;
}

/**
 * RFC 7638 JWK thumbprint (base64url, no padding) over the required members in
 * lexicographic order. Used as the `kid` when no explicit id is configured, so
 * the id is a derivable function of the key rather than a hand-picked string.
 */
export function receiptKeyThumbprint(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { crv: string; kty: string; x: string };
  const requiredMembers = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
  return createHash("sha256")
    .update(Buffer.from(canonicalizeJson(requiredMembers), "utf8"))
    .digest("base64url");
}

/**
 * Publishable public key set for `GET /.well-known/jwks.json`.
 *
 * With no key configured this returns an EMPTY key set plus a note, and that is
 * deliberate: an empty `keys` array cannot be mistaken for a verification.
 */
export function getJwks(
  keys: ReceiptKeys | null = null
): { keys: Array<Record<string, unknown>>; note?: string } {
  if (!keys) {
    return {
      keys: [],
      note: `No receipt signing key is configured (${PRIVATE_KEY_ENV} unset); Fahali is not currently issuing signed receipts.`,
    };
  }
  const jwk = keys.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    keys: [{ ...jwk, kid: keys.keyId, use: "sig", alg: "EdDSA" }],
  };
}

function canonicalSha256(value: unknown): string {
  return sha256HexUtf8(canonicalizeJson(value));
}

function normalizePem(value: string): string {
  // Railway/Vercel env vars frequently arrive with literal "\n" sequences.
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}
