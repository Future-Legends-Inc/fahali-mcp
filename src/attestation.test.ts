/**
 * Ed25519 receipt attestation — `attestation.ts`.
 *
 * What this suite is defending, in order of importance:
 *
 *  1. AN UNSIGNED RECEIPT MUST NEVER READ AS VERIFIED. Every path where a
 *     signature is absent returns `valid: false`, and there is no code path
 *     that invents a key to fill the gap. `server/routes.ts:2700-2704` is
 *     explicit that the existing hash is not a signature; this suite is what
 *     keeps the new one from being quietly downgraded to that.
 *  2. TAMPERING IS DETECTED PER-FIELD — payload, claim id, timestamp, and
 *     signature each break verification a different way, so a mismatch can be
 *     attributed rather than reported as a generic failure.
 *  3. `signed` IS DERIVED. A hand-forged `{ signed: true, signature: null }`
 *     still fails, which is the property that makes the flag trustworthy.
 *  4. THE JWKS CANNOT OVER-CLAIM. Unconfigured publishes an EMPTY set with a
 *     note; configured publishes public material only (no `d`).
 *
 *   node --import tsx --test mcp-server/src/attestation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";

import {
  buildReceipt,
  getJwks,
  loadReceiptKeys,
  receiptKeyThumbprint,
  verifyReceipt,
  type FahaliReceipt,
  type ReceiptKeys,
} from "./attestation.js";

const ISSUED_AT = "2026-10-17T12:00:00.000Z";

function makeEd25519Pair(): { privatePem: string; publicPem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    publicKey,
  };
}

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

function configuredKeys(): { keys: ReceiptKeys; publicPem: string; privatePem: string } {
  const pair = makeEd25519Pair();
  const { keys, report } = loadReceiptKeys(
    env({
      FAHALI_RECEIPT_ED25519_PRIVATE_KEY: pair.privatePem,
      FAHALI_RECEIPT_ED25519_PUBLIC_KEY: pair.publicPem,
    })
  );
  assert.equal(report.configured, true, report.reason ?? "expected configured");
  assert.ok(keys);
  return { keys: keys as ReceiptKeys, publicPem: pair.publicPem, privatePem: pair.privatePem };
}

const PAYLOAD = {
  symbol: "BTCUSDT",
  engine_key: "early_warning_6h",
  verdict: "down",
  horizon_hours: 8,
};

/* ── 1. absence is reported as absence ───────────────────────────────────── */

test("unconfigured: no key is invented, the receipt says so, and it never verifies", () => {
  const { keys, report } = loadReceiptKeys(env());

  assert.equal(keys, null);
  assert.equal(report.configured, false);
  assert.equal(report.key_id, null);
  assert.equal(report.public_key_pem, null);
  assert.ok(report.reason && report.reason.length > 0, "unconfigured must state a reason");
  assert.match(String(report.reason), /FAHALI_RECEIPT_ED25519_PRIVATE_KEY/);

  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-1", issuedAt: ISSUED_AT }, keys);

  assert.equal(receipt.signature, null);
  assert.equal(receipt.key_id, null);
  assert.equal(receipt.signed, false);
  assert.ok(receipt.unsigned_reason && receipt.unsigned_reason.length > 0);
  // Still an integrity hash — useful, but not a claim of attestation.
  assert.match(receipt.payload_sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.provenance_root, /^[a-f0-9]{64}$/);

  const check = verifyReceipt(PAYLOAD, receipt, makeEd25519Pair().publicPem);
  assert.equal(check.valid, false);
  assert.equal(check.verdict, "UNSIGNED");
});

test("empty / whitespace-only env is treated as unconfigured", () => {
  for (const value of ["", "   ", "\n"]) {
    const { keys, report } = loadReceiptKeys(env({ FAHALI_RECEIPT_ED25519_PRIVATE_KEY: value }));
    assert.equal(keys, null);
    assert.equal(report.configured, false);
  }
});

test("a mismatched public key is refused rather than published", () => {
  const a = makeEd25519Pair();
  const b = makeEd25519Pair();

  const { keys, report } = loadReceiptKeys(
    env({
      FAHALI_RECEIPT_ED25519_PRIVATE_KEY: a.privatePem,
      FAHALI_RECEIPT_ED25519_PUBLIC_KEY: b.publicPem,
    })
  );

  assert.equal(keys, null);
  assert.equal(report.configured, false);
  assert.match(String(report.reason), /does not correspond|verify/i);
});

test("a non-Ed25519 key is refused, not silently used", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const { keys, report } = loadReceiptKeys(env({ FAHALI_RECEIPT_ED25519_PRIVATE_KEY: pem }));
  assert.equal(keys, null);
  assert.equal(report.configured, false);
  assert.match(String(report.reason), /Ed25519/);
});

test("an unparseable private key is refused", () => {
  const { keys, report } = loadReceiptKeys(
    env({ FAHALI_RECEIPT_ED25519_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" })
  );
  assert.equal(keys, null);
  assert.equal(report.configured, false);
  assert.ok(report.reason);
});

/* ── 2. configured: sign, then verify the happy path ─────────────────────── */

test("configured: signs, verifies against the public key alone, and leaks no private material", () => {
  const { keys, publicPem } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-2", issuedAt: ISSUED_AT }, keys);

  assert.equal(receipt.signed, true);
  assert.equal(receipt.unsigned_reason, null);
  assert.equal(receipt.key_id, keys.keyId);
  assert.ok(receipt.signature);
  assert.equal(JSON.stringify(receipt).includes("PRIVATE KEY"), false);

  const check = verifyReceipt(PAYLOAD, receipt, publicPem);
  assert.equal(check.valid, true);
  assert.equal(check.verdict, "VALID");
  assert.equal(check.key_id, keys.keyId);
});

test("verification needs only the public key (offline verifier, no shared secret)", () => {
  const { keys, publicPem } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-3", issuedAt: ISSUED_AT }, keys);

  // Deliberately no access to `keys` at the call site.
  assert.equal(verifyReceipt(PAYLOAD, receipt, publicPem).verdict, "VALID");
  assert.equal(getJwks(keys).keys.length, 1);
});

test("signing is deterministic — same inputs, same signature", () => {
  const { keys } = configuredKeys();
  const a = buildReceipt(PAYLOAD, { claimId: "c", issuedAt: ISSUED_AT }, keys);
  const b = buildReceipt(PAYLOAD, { claimId: "c", issuedAt: ISSUED_AT }, keys);
  assert.equal(a.signature, b.signature);
  assert.equal(a.payload_sha256, b.payload_sha256);
  assert.equal(a.provenance_root, b.provenance_root);
});

test("payload key order does not change the attested digest", () => {
  const { keys } = configuredKeys();
  const a = buildReceipt({ a: 1, b: 2 }, { claimId: "c", issuedAt: ISSUED_AT }, keys);
  const b = buildReceipt({ b: 2, a: 1 }, { claimId: "c", issuedAt: ISSUED_AT }, keys);
  assert.equal(a.payload_sha256, b.payload_sha256);
  assert.equal(a.signature, b.signature);
});

test("a \\n-escaped PEM (as env vars often arrive) is accepted", () => {
  const pair = makeEd25519Pair();
  const escaped = pair.privatePem.replace(/\n/g, "\\n");
  const { keys, report } = loadReceiptKeys(
    env({ FAHALI_RECEIPT_ED25519_PRIVATE_KEY: escaped })
  );
  assert.equal(report.configured, true, report.reason ?? "expected configured");
  assert.equal(report.public_key_pem, pair.publicPem);
  assert.ok(keys);
});

/* ── 3. tampering, attributed per field ──────────────────────────────────── */

test("a mutated payload is HASH_MISMATCH, and the untampered one still verifies", () => {
  const { keys, publicPem } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-4", issuedAt: ISSUED_AT }, keys);

  const tampered = { ...PAYLOAD, verdict: "up" };
  const check = verifyReceipt(tampered, receipt, publicPem);

  assert.equal(check.valid, false);
  assert.equal(check.verdict, "HASH_MISMATCH");
  // Negative control: the guard is comparing, not always failing.
  assert.equal(verifyReceipt(PAYLOAD, receipt, publicPem).verdict, "VALID");
});

test("a mutated claim id or timestamp breaks the provenance root", () => {
  const { keys, publicPem } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-5", issuedAt: ISSUED_AT }, keys);

  for (const forged of [
    { ...receipt, claim_id: "claim-5-other" },
    { ...receipt, issued_at: "2026-10-17T12:00:01.000Z" },
  ]) {
    const check = verifyReceipt(PAYLOAD, forged, publicPem);
    assert.equal(check.valid, false);
    assert.equal(check.verdict, "PROVENANCE_MISMATCH");
  }
});

test("a mutated signature is SIGNATURE_INVALID, not a pass", () => {
  const { keys, publicPem } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-6", issuedAt: ISSUED_AT }, keys);

  const bytes = Buffer.from(String(receipt.signature), "base64url");
  bytes[0] ^= 0xff;
  const check = verifyReceipt(PAYLOAD, { ...receipt, signature: bytes.toString("base64url") }, publicPem);

  assert.equal(check.valid, false);
  assert.equal(check.verdict, "SIGNATURE_INVALID");
});

test("signature verification against the wrong key fails", () => {
  const { keys } = configuredKeys();
  const other = makeEd25519Pair();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-7", issuedAt: ISSUED_AT }, keys);

  const check = verifyReceipt(PAYLOAD, receipt, other.publicPem);
  assert.equal(check.valid, false);
  assert.equal(check.verdict, "SIGNATURE_INVALID");
});

test("a missing public key is NO_PUBLIC_KEY — key_id is never trusted on its own", () => {
  const { keys } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-8", issuedAt: ISSUED_AT }, keys);

  for (const absent of [undefined, "", "   "]) {
    const check = verifyReceipt(PAYLOAD, receipt, absent);
    assert.equal(check.valid, false);
    assert.equal(check.verdict, "NO_PUBLIC_KEY");
  }
});

test("a payload that cannot be canonicalized is MALFORMED, not a pass", () => {
  const { keys, publicPem } = configuredKeys();
  const receipt = buildReceipt(PAYLOAD, { claimId: "claim-9", issuedAt: ISSUED_AT }, keys);

  const check = verifyReceipt({ ...PAYLOAD, poison: Number.NaN }, receipt, publicPem);
  assert.equal(check.valid, false);
  assert.equal(check.verdict, "MALFORMED");
});

test("a structurally broken receipt is MALFORMED", () => {
  const { publicPem } = configuredKeys();
  const check = verifyReceipt(PAYLOAD, { signed: true } as unknown as FahaliReceipt, publicPem);
  assert.equal(check.valid, false);
  assert.equal(check.verdict, "MALFORMED");
});

/* ── 4. `signed` is derived, so a forged flag cannot help ────────────────── */

test("signed is exactly (signature !== null) in both directions", () => {
  const { keys, publicPem } = configuredKeys();

  const signed = buildReceipt(PAYLOAD, { claimId: "c", issuedAt: ISSUED_AT }, keys);
  assert.equal(signed.signed, signed.signature !== null);

  const unsigned = buildReceipt(PAYLOAD, { claimId: "c", issuedAt: ISSUED_AT }, null);
  assert.equal(unsigned.signed, unsigned.signature !== null);

  // Forged: claims signed, carries nothing. The flag is not what is checked.
  const forged: FahaliReceipt = { ...signed, signature: null, signed: true, unsigned_reason: null };
  const check = verifyReceipt(PAYLOAD, forged, publicPem);
  assert.equal(check.valid, false);
  assert.equal(check.verdict, "UNSIGNED");
});

/* ── 5. the published key set ────────────────────────────────────────────── */

test("jwks: unconfigured publishes an empty set plus a note, never a key", () => {
  const jwks = getJwks(null);
  assert.deepEqual(jwks.keys, []);
  assert.ok(jwks.note);
  assert.match(String(jwks.note), /not currently issuing signed receipts/i);
  assert.equal(getJwks().keys.length, 0);
});

test("jwks: configured publishes public material only, with a derived kid", () => {
  const { keys } = configuredKeys();
  const jwks = getJwks(keys);

  assert.equal(jwks.keys.length, 1);
  const jwk = jwks.keys[0] as Record<string, unknown>;
  assert.equal(jwk.kty, "OKP");
  assert.equal(jwk.crv, "Ed25519");
  assert.equal(jwk.alg, "EdDSA");
  assert.equal(jwk.use, "sig");
  assert.equal(jwk.kid, keys.keyId);
  assert.equal(typeof jwk.x, "string");
  assert.equal(jwk.d, undefined, "private exponent must never be published");
  assert.equal(jwks.note, undefined);
});

test("key id falls back to the RFC 7638 thumbprint and an env override wins", () => {
  const pair = makeEd25519Pair();

  const byThumbprint = loadReceiptKeys(env({ FAHALI_RECEIPT_ED25519_PRIVATE_KEY: pair.privatePem }));
  assert.ok(byThumbprint.keys);
  assert.equal((byThumbprint.keys as ReceiptKeys).keyId, receiptKeyThumbprint(pair.publicKey));
  // base64url of a 32-byte digest: 43 chars, unpadded.
  assert.match((byThumbprint.keys as ReceiptKeys).keyId, /^[A-Za-z0-9_-]{43}$/);

  const byEnv = loadReceiptKeys(
    env({
      FAHALI_RECEIPT_ED25519_PRIVATE_KEY: pair.privatePem,
      FAHALI_RECEIPT_KEY_ID: "fahali-receipt-2026-10",
    })
  );
  assert.ok(byEnv.keys);
  assert.equal((byEnv.keys as ReceiptKeys).keyId, "fahali-receipt-2026-10");
});

test("the report never carries private key material", () => {
  const { keys } = configuredKeys();
  const serialized = JSON.stringify(keys);
  assert.equal(serialized.includes("PRIVATE KEY"), false);
  assert.ok(keys.publicKeyPem.includes("PUBLIC KEY"));
});
