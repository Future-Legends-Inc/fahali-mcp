/**
 * A prompt pack is a PUBLISHED SURFACE. It ships to every MCP client, is
 * pasted into agents nobody reviews, and outlives whatever was true when it
 * was written. It needs the same gates as the homepage.
 *
 *   node --import tsx --test src/prompts.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { FAHALI_PROMPTS, PROMPTS_BY_NAME } from "./prompts.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const TOOL_NAMES = new Set((TOOL_DEFINITIONS as any[]).map((t) => t.name));
const ALL_TEXT = FAHALI_PROMPTS.map((p) =>
  p.render(Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "TESTVAL"]))),
).join("\n\n");

test("every tool a prompt tells an agent to call actually exists", () => {
  // An agent fires these autonomously with nobody reviewing them first, so a
  // plausible-looking wrong tool name is worse here than in documentation.
  const bad: string[] = [];
  for (const p of FAHALI_PROMPTS) {
    const text = p.render(Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "X"])));
    for (const m of text.matchAll(/`(fahali_[a-z0-9_]+)/g)) {
      if (!TOOL_NAMES.has(m[1])) bad.push(`${p.name} → ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `prompts name tools that do not exist:\n  ${bad.join("\n  ")}`);
});

test("no prompt bakes in a measured figure", () => {
  // 🔴 THE central rule. A number in a template ages exactly the way the
  // homepage did, except a prompt carries no measurement date and no deploy to
  // refresh it. Templates route to fahali_get_lead_time and say to use
  // `headline`; they never state what it will say.
  const offenders: string[] = [];
  for (const p of FAHALI_PROMPTS) {
    const text = p.render(Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "X"])));
    for (const m of text.matchAll(/\d+(?:\.\d+)?\s*(?:%|percentage points?|pp\b)/gi)) {
      offenders.push(`${p.name}: "${m[0]}"`);
    }
    // "~22h median", "20-40 hours of warning" — a lead time is a measured
    // figure even without a percent sign.
    for (const m of text.matchAll(/\d+\s*(?:-|–|to)?\s*\d*\s*(?:h|hours?)\b(?=[^\n]*\b(?:lead|warning|median|ahead)\b)/gi)) {
      offenders.push(`${p.name}: "${m[0]}"`);
    }
  }
  assert.deepEqual(offenders, [], `a prompt states a figure instead of routing to the record:\n  ${offenders.join("\n  ")}`);
});

test("every prompt carries the refusal contract", () => {
  for (const p of FAHALI_PROMPTS) {
    const text = p.render(Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "X"])));
    assert.match(text, /risk reads, not price targets/i, `${p.name} omits the price-target refusal`);
    assert.match(text, /read-only|routes no orders|observes/i, `${p.name} omits the read-only boundary`);
    assert.match(text, /recall/i, `${p.name} lets a precision be quoted without its recall`);
  }
});

test("no prompt lets an absent reading render as safety", () => {
  // The systemic defect class. A template that does not say this produces an
  // agent that answers "nothing flagged" as though it meant "nothing wrong".
  for (const p of FAHALI_PROMPTS) {
    const text = p.render(Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "X"])));
    assert.match(
      text,
      /not covered|absence|unmeasured|is missing|not a (calm|clean)|never let silence|cannot be known|NOT known/i,
      `${p.name} never tells the agent what to do with a missing reading`,
    );
  }
});

test("no prompt promises protection or prevention", () => {
  assert.doesNotMatch(ALL_TEXT, /protects? (your |their )?capital/i);
  assert.doesNotMatch(ALL_TEXT, /prevents? (losses|drawdowns?)/i);
  assert.doesNotMatch(ALL_TEXT, /before it becomes (a )?loss/i);
  assert.doesNotMatch(ALL_TEXT, /tamper[- ]proof/i);
  assert.doesNotMatch(ALL_TEXT, /\bguarantee/i);
  // An engine or layer count is never publishable, in any surface.
  assert.doesNotMatch(ALL_TEXT, /\b\d{1,2}\b[\s-]+(?:\w+[\s-]+){0,3}(?:engines?|layers?)\b/i);
});

test("prompt names and arguments are well formed", () => {
  const seen = new Set<string>();
  for (const p of FAHALI_PROMPTS) {
    assert.match(p.name, /^fahali_[a-z0-9_]+$/, `bad prompt name: ${p.name}`);
    assert.ok(!seen.has(p.name), `duplicate prompt name: ${p.name}`);
    seen.add(p.name);
    assert.ok(p.title.length > 0 && p.description.length > 20, `${p.name} needs a real description`);
    assert.equal(PROMPTS_BY_NAME.get(p.name), p, `${p.name} missing from the lookup map`);
    for (const a of p.arguments ?? []) {
      assert.match(a.name, /^[a-z][a-zA-Z0-9]*$/, `${p.name} arg "${a.name}"`);
      assert.ok(a.description.length > 5, `${p.name} arg "${a.name}" needs a description`);
    }
  }
});

test("a prompt renders with no arguments supplied without emitting undefined", () => {
  // Clients may call prompts/get with nothing. A template that interpolates
  // `undefined` into a system prompt ships a broken instruction to an agent.
  for (const p of FAHALI_PROMPTS) {
    const text = p.render({});
    assert.doesNotMatch(text, /undefined|\[object Object\]|NaN/, `${p.name} renders a placeholder artifact`);
    assert.ok(text.trim().length > 200, `${p.name} rendered suspiciously short with no args`);
  }
});

test("the user's argument is interpolated, not ignored", () => {
  // A template that silently drops its argument answers a different question
  // than the one asked.
  for (const p of FAHALI_PROMPTS.filter((x) => (x.arguments ?? []).some((a) => a.required))) {
    const args = Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "ZZSENTINEL"]));
    assert.match(p.render(args), /ZZSENTINEL/, `${p.name} ignores its required argument`);
  }
});
