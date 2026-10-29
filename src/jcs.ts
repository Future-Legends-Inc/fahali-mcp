/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * Why this exists, and what it is NOT
 * ──────────────────────────────────
 * `server/routes.ts:2699-2704` emits a per-verdict `provenance.integrity` value
 * that is a SHA-256 over `JSON.stringify(payload)`, and its own comment states
 * plainly that this is an INTEGRITY hash and **not** a signature — "no private
 * key is involved, so it proves the payload wasn't altered in transit/storage,
 * NOT that Fahali attested it. True signed receipts need a persisted, key-signed
 * root ledger (backlog)."
 *
 * That backlog item cannot be built honestly on `JSON.stringify`: ECMAScript
 * preserves property *insertion* order, so the same logical payload hashes
 * differently depending on how it was assembled, and a REORDERED payload would
 * still produce a "valid" hash. Canonicalization is the missing primitive that
 * makes a signature meaningful. This module is that primitive.
 *
 * Scope: this file performs NO signing, NO hashing of live data, and claims
 * nothing about the Fahali record. It is a pure transform. `attestation.ts`
 * consumes it.
 *
 * Conformance notes (measured against the RFC, not assumed):
 *  - §3.2.2.2 String serialization is *defined to be* ECMAScript's, so we
 *    delegate to `JSON.stringify` for the escape table rather than hand-rolling
 *    UTF-16 escaping. Node's `\b \t \n \f \r` short escapes and lowercase
 *    `\uhhhh` for other control characters are exactly what JCS requires.
 *  - §3.2.2.3 Number serialization is likewise ECMAScript's; `JSON.stringify`
 *    on a finite JS number IS the specified output (incl. `-0` -> `0`).
 *  - §3.2.2.2/§3.2.2.3 require that NaN, Infinity and lone surrogates ABORT the
 *    operation. Node's well-formed `JSON.stringify` (ES2019) *escapes* a lone
 *    surrogate instead of throwing, so this module must detect them itself —
 *    otherwise it would silently emit non-conformant output that still verifies.
 *  - §3.2.3 sorting is on UTF-16 code units with `<`; `Array.prototype.sort()`
 *    on the raw keys is exactly that, locale-independent.
 *
 * Deviation from a naive implementation, on purpose: `undefined`, functions,
 * symbols and BigInt are REJECTED, not dropped. Dropping an `undefined` key
 * would make two materially different payloads canonicalize to the same bytes,
 * i.e. it would let one attested payload stand in for another. I-JSON has no
 * representation for them; the caller must omit them explicitly.
 */

import { createHash } from "node:crypto";

export type JcsErrorCode = "NON_FINITE_NUMBER" | "LONE_SURROGATE" | "UNSUPPORTED_TYPE";

export class JcsError extends Error {
  readonly code: JcsErrorCode;
  readonly path: string;

  constructor(code: JcsErrorCode, path: string, message: string) {
    super(`${message} (at ${path})`);
    this.name = "JcsError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Serialize `value` to its RFC 8785 canonical form.
 *
 * @throws {JcsError} when the value is not representable in I-JSON. Callers
 * MUST treat a throw as "cannot be attested", never as "skip this field".
 */
export function canonicalizeJson(value: unknown): string {
  return serialize(value, "$");
}

/** SHA-256 (lowercase hex) of the UTF-8 bytes of `text`. */
export function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * Convenience: canonicalize then hash. Equivalent to
 * `sha256HexUtf8(canonicalizeJson(value))` and throws the same `JcsError`s.
 */
export function canonicalSha256(value: unknown): string {
  return sha256HexUtf8(canonicalizeJson(value));
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number": {
      const n = value as number;
      if (!Number.isFinite(n)) {
        throw new JcsError(
          "NON_FINITE_NUMBER",
          path,
          `JCS §3.2.2.3 requires abort on ${Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity"}; ` +
            "JSON has no representation for it, and emitting null would be a silent substitution"
        );
      }
      // ECMAScript number serialization == JCS number serialization.
      return JSON.stringify(n);
    }

    case "string": {
      const s = value as string;
      assertNoLoneSurrogate(s, path);
      return JSON.stringify(s);
    }

    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new JcsError(
        "UNSUPPORTED_TYPE",
        path,
        `${typeof value} is not representable in I-JSON; JCS cannot canonicalize it, ` +
          "and dropping it would let two different payloads share one digest"
      );

    default:
      break;
  }

  if (Array.isArray(value)) {
    // Array order is preserved (§3.2.3). Indexed loop (not .map) so a sparse
    // hole is surfaced as UNSUPPORTED_TYPE rather than silently becoming "".
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      parts.push(serialize(value[i], `${path}[${i}]`));
    }
    return `[${parts.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;

  // RFC 8785 Appendix A honors `toJSON` on primitives; mirror that.
  const toJSON = (obj as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    return serialize((toJSON as () => unknown).call(obj), path);
  }

  // §3.2.3 — recurse into objects, sort property names by UTF-16 code unit.
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    assertNoLoneSurrogate(key, path);
    parts.push(`${JSON.stringify(key)}:${serialize(obj[key], `${path}.${key}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * RFC 8785 §3.2.2.2: "occurrences of such data MUST cause a compliant JCS
 * implementation to terminate with an appropriate error."
 *
 * A lone surrogate is a `\uD800`–`\uDBFF` not followed by a low surrogate, or a
 * `\uDC00`–`\uDFFF` not preceded by a high surrogate.
 */
function assertNoLoneSurrogate(s: string, path: string): void {
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new JcsError(
          "LONE_SURROGATE",
          path,
          `unpaired high surrogate U+${unit.toString(16).toUpperCase()} — RFC 8785 requires abort`
        );
      }
      i++; // valid pair consumed
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new JcsError(
        "LONE_SURROGATE",
        path,
        `unpaired low surrogate U+${unit.toString(16).toUpperCase()} — RFC 8785 requires abort`
      );
    }
  }
}
