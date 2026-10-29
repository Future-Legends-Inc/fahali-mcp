/**
 * RFC 8785 (JCS) conformance for `canonical.ts`.
 *
 * The conformance evidence is DELIBERATE and layered, because "it matches my
 * own expected string" proves nothing:
 *
 *  1. DIFFERENTIAL — the RFC's own sample canonicalizer (Appendix A) is
 *     transcribed here verbatim and compared against ours over a broad,
 *     deterministic corpus. Two independent implementations, one output.
 *  2. NORMATIVE TABLES — the Appendix B IEEE-754 number table is asserted
 *     value-by-value. This is the RFC pinning Node's serializer, not us.
 *  3. §3.2.3 SORTING — the RFC's UTF-16 ordering sample, asserted exactly.
 *  4. ABORT CASES — NaN / Infinity / lone surrogate / non-I-JSON types must
 *     throw, each with a negative control proving the guard is load-bearing
 *     (a naive `JSON.stringify`-based impl passes all of these silently).
 *  5. INVARIANTS — key-order independence, idempotence, and re-parse equality.
 *
 *   node --import tsx --test mcp-server/src/canonical.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeJson, canonicalSha256, JcsError } from "./canonical.js";

/* ── RFC 8785 Appendix A, transcribed as published ───────────────────────── */
function rfc8785AppendixA(object: unknown): string {
  let buffer = "";
  serialize(object);
  return buffer;

  function serialize(value: unknown): void {
    if (value === null || typeof value !== "object" || (value as any).toJSON != null) {
      buffer += JSON.stringify(value);
    } else if (Array.isArray(value)) {
      buffer += "[";
      let next = false;
      value.forEach((element) => {
        if (next) buffer += ",";
        next = true;
        serialize(element);
      });
      buffer += "]";
    } else {
      buffer += "{";
      let next = false;
      Object.keys(value)
        .sort()
        .forEach((property) => {
          if (next) buffer += ",";
          next = true;
          buffer += JSON.stringify(property);
          buffer += ":";
          serialize((value as Record<string, unknown>)[property]);
        });
      buffer += "}";
    }
  }
}

/* ── deterministic corpus (seeded, so a failure is reproducible) ──────────── */
function xorshift32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

const STRING_POOL = [
  "",
  "a",
  "aa",
  "ab",
  "Z",
  "0",
  "\u0000",
  "\u0008",
  "\t",
  "\n",
  "\u000b",
  "\f",
  "\r",
  "\u001f",
  "\u0080",
  "ö",
  "€",
  "\ufb33",
  "\ud83d\ude00",
  "😀",
  '"',
  "\\",
  "/",
  "a/b",
  "\u2028",
  "line\nbreak",
  "quote\"inside",
  "back\\slash",
];

const NUMBER_POOL = [
  0,
  1,
  -1,
  0.5,
  -0.5,
  333333333.33333329,
  1e30,
  4.5,
  2e-3,
  1e-27,
  5e-324,
  1.7976931348623157e308,
  9007199254740992,
  -9007199254740992,
  1424953923781206.2,
  1e21,
  1e23,
];

function buildCorpus(seed: number, count: number): unknown[] {
  const rand = xorshift32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;

  function value(depth: number): unknown {
    if (depth >= 3) {
      const r = rand();
      if (r < 0.5) return pick(STRING_POOL);
      if (r < 0.8) return pick(NUMBER_POOL);
      return r < 0.9 ? true : r < 0.95 ? false : null;
    }
    const r = rand();
    if (r < 0.42) {
      const n = Math.floor(rand() * 4);
      return Array.from({ length: n }, () => value(depth + 1));
    }
    if (r < 0.8) {
      const n = Math.floor(rand() * 5);
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) obj[pick(STRING_POOL)] = value(depth + 1);
      return obj;
    }
    if (r < 0.9) return pick(STRING_POOL);
    return pick(NUMBER_POOL);
  }

  return Array.from({ length: count }, () => value(0));
}

test("differential: matches the RFC's own Appendix A canonicalizer over 400 generated values", () => {
  const corpus = buildCorpus(0x5eed, 400);
  let compared = 0;
  for (const value of corpus) {
    const ours = canonicalizeJson(value);
    const theirs = rfc8785AppendixA(value);
    assert.equal(ours, theirs, `divergence for ${JSON.stringify(value)}`);
    compared++;
  }
  // Negative control: the differential harness must be able to DETECT a
  // difference. A plain JSON.stringify does not sort keys, so it must disagree.
  assert.notEqual(canonicalizeJson({ b: 1, a: 2 }), JSON.stringify({ b: 1, a: 2 }));
  assert.equal(canonicalizeJson({ b: 1, a: 2 }), rfc8785AppendixA({ b: 1, a: 2 }));
  assert.equal(compared, 400);
});

test("differential: explicit non-ASCII / control-character keys (UTF-16 sort is not locale order)", () => {
  const value = {
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  };
  assert.equal(canonicalizeJson(value), rfc8785AppendixA(value));
});

test("RFC 8785 §3.2.3: the published sorting sample yields the published order", () => {
  const canonical = canonicalizeJson({
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  });

  const expected =
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}';

  assert.equal(canonical, expected);
});

test("RFC 8785 §3.2.2: the worked sample canonicalizes with no whitespace and sorted keys", () => {
  const value = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
      '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
      '"literals":[null,true,false]}'
  );

  const canonical = canonicalizeJson(value);

  assert.equal(canonical, rfc8785AppendixA(value));
  // §3.2.1 — no whitespace between tokens.
  assert.equal(/\s/.test(canonical), false);
  // Numbers are ECMAScript-serialized: 333333333.33333329 rounds, 1E30 -> 1e+30, 4.50 -> 4.5.
  assert.ok(canonical.includes('"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]'));
  assert.ok(canonical.includes('"literals":[null,true,false]'));
  assert.ok(canonical.startsWith('{"literals":'));
});

test("RFC 8785 Appendix B: the published IEEE-754 number table", () => {
  const cases: Array<[string, string]> = [
    ["0000000000000000", "0"],
    ["8000000000000000", "0"], // minus zero
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ];

  for (const [hex, expected] of cases) {
    const value = Buffer.from(hex, "hex").readDoubleBE(0);
    assert.equal(canonicalizeJson(value), expected, `IEEE-754 ${hex}`);
  }
  assert.equal(cases.length, 24);
});

test("RFC 8785 §3.2.2.2: escape table is ECMAScript's — short escapes for the five, lowercase \\uhhhh otherwise, '/' untouched", () => {
  const cases: Array<[string, string]> = [
    ["\u0008", '\\b'],
    ["\t", '\\t'],
    ["\n", '\\n'],
    ["\f", '\\f'],
    ["\r", '\\r'],
    ["\u0000", '\\u0000'],
    ["\u000b", '\\u000b'],
    ["\u001f", '\\u001f'],
    ['"', '\\"'],
    ["\\", "\\\\"],
    ["/", "/"], // NOT escaped
    ["\u0080", "\u0080"], // outside ASCII control range -> "as is"
    ["\u2028", "\u2028"], // as is
    ["ö", "ö"],
    ["😀", "😀"],
  ];

  for (const [input, escaped] of cases) {
    assert.equal(canonicalizeJson(input), `"${escaped}"`, `escape of ${JSON.stringify(input)}`);
  }
});

test("invariants: key order, idempotence, and re-parse equality", () => {
  const a = { z: 1, a: { d: 2, c: 3 }, m: [1, { b: 1, a: 2 }, "x"] };
  const b = { m: [1, { a: 2, b: 1 }, "x"], a: { c: 3, d: 2 }, z: 1 };

  const ca = canonicalizeJson(a);
  assert.equal(ca, canonicalizeJson(b), "insertion order must not affect the output");
  assert.equal(canonicalizeJson(JSON.parse(ca)), ca, "canonicalization must be idempotent");

  for (const value of buildCorpus(0xc0ffee, 250)) {
    const canonical = canonicalizeJson(value);
    assert.deepEqual(JSON.parse(canonical), value, "canonical output must re-parse equal");
  }
});

test("minus zero canonicalizes to 0 (§3.2.2.3 / ECMAScript number serialization)", () => {
  assert.equal(canonicalizeJson(-0), "0");
  assert.equal(canonicalizeJson([-0]), "[0]");
  assert.equal(canonicalizeJson({ z: -0 }), '{"z":0}');
});

test("abort: non-finite numbers throw, and the guard is load-bearing", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalizeJson(bad), (e: unknown) => {
      assert.ok(e instanceof JcsError);
      assert.equal((e as JcsError).code, "NON_FINITE_NUMBER");
      return true;
    });
    assert.throws(() => canonicalizeJson({ nested: [1, bad] }), JcsError);
  }

  // Negative control — the defect this prevents: JSON.stringify(NaN) === "null",
  // so a serializer that delegates blindly substitutes a silent null.
  assert.equal(JSON.stringify(NaN), "null");
  assert.throws(() => canonicalizeJson(NaN));
});

test("abort: lone surrogates throw; a valid surrogate pair does not", () => {
  for (const bad of ["\ud800", "\udc00", "a\ud800b", "\ud83d", "\ude00"]) {
    assert.throws(
      () => canonicalizeJson(bad),
      (e: unknown) => (e as JcsError).code === "LONE_SURROGATE"
    );
    assert.throws(
      () => canonicalizeJson({ k: bad }),
      (e: unknown) => (e as JcsError).code === "LONE_SURROGATE"
    );
    // Negative control: Node ESCAPES a lone surrogate instead of throwing, so a
    // conformant implementation cannot simply delegate here.
    assert.doesNotThrow(() => JSON.stringify(bad));
  }

  assert.doesNotThrow(() => canonicalizeJson("😀")); // U+D83D U+DE00, a real pair
});

test("abort: non-I-JSON types throw rather than being silently dropped", () => {
  for (const bad of [undefined, () => 1, Symbol("s"), 10n]) {
    assert.throws(
      () => canonicalizeJson(bad),
      (e: unknown) => (e as JcsError).code === "UNSUPPORTED_TYPE"
    );
  }

  // The integrity hazard this closes: dropping an `undefined` property would
  // make two DIFFERENT payloads share one canonical digest.
  assert.notEqual(rfc8785AppendixA({ a: 1 }), rfc8785AppendixA({ a: 1, b: undefined }));
  assert.throws(() => canonicalizeJson({ a: 1, b: undefined }));
  assert.equal(canonicalizeJson({ a: 1 }), '{"a":1}');
});

test("sha256 helpers: digest is stable, lowercase, and changes with content", () => {
  assert.equal(canonicalSha256({ b: 1, a: 2 }), canonicalSha256({ a: 2, b: 1 }));
  assert.notEqual(canonicalSha256({ a: 1 }), canonicalSha256({ a: 2 }));
  assert.match(canonicalSha256({ a: 1 }), /^[a-f0-9]{64}$/);
});
