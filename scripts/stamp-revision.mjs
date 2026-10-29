#!/usr/bin/env node
/**
 * STAMP THE GIT REVISION INTO THE MCP BUILD, SO `/health` CAN NAME IT.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * On 2026-09-11 `spectra-mcp` was found running a build 94 hours old. Nothing
 * detected it, because the only currency signal the service published was
 * `version: "1.25.0"` — a hand-bumped string that read IDENTICALLY on both
 * sides of that gap. `package.json`, `server.json` and `SERVER_INFO` all agreed
 * with each other and all three were useless: they name a RELEASE, not a BUILD.
 *
 * The api-server does not have this problem. Its `/health` carries
 * `release.revision` — the actual git SHA — which is what lets
 * `scripts/preflight-deploy.mjs` ask the only question that decides whether a
 * deploy destroys work:
 *
 *     is the live revision an ANCESTOR of what I am about to upload?
 *
 * The MCP could not be given that guard, because it published no SHA to test.
 * This script is the missing half.
 *
 * ─── Why a generated FILE, and not an env var ───────────────────────────────
 *
 * Three constraints, all discovered by reading the deploy path rather than
 * assuming it:
 *
 * 1. `railway.json` sets `builder: DOCKERFILE`, so Railway builds the image
 *    INSIDE a container from the uploaded tarball. The build has no git.
 * 2. `RAILWAY_GIT_COMMIT_SHA` is set for repo-triggered deploys. `spectra-mcp`
 *    ships by TARBALL (`railway up`), where there is no commit to report. It is
 *    empty exactly when we need it.
 * 3. The Dockerfile copies `src/` and `llms.txt` and DELIBERATELY NOT
 *    `scripts/` — a 2026-07-30 attempt to copy it failed with
 *    `"/scripts": not found`, because Railway's tarball filter drops
 *    directories on its own terms.
 *
 * `src/` is therefore the only path that reliably reaches the image. So the
 * stamp is a generated TypeScript file under `src/`, written HERE, on a machine
 * that has git, and compiled into `dist/` by the in-container `tsc`.
 *
 * ─── The part that makes it safe ────────────────────────────────────────────
 *
 * 🔴 A STAMP SOMEONE MUST REMEMBER TO RUN IS WORSE THAN NO STAMP. If it goes
 * stale, `/health` names a revision that is not what is running, and the
 * ancestor gate then evaluates a TRUE test against a FALSE input — it would
 * clear a deploy that erases work, with a green checkmark. That is strictly
 * worse than today's honest silence.
 *
 * Two things prevent it:
 *
 *   - `npm run deploy:mcp` runs this script, then preflight, then the upload.
 *     The stamp cannot be forgotten because the deploy regenerates it.
 *   - The committed placeholder is `development`, and preflight REFUSES on it
 *     by name. A build that never ran this script cannot be mistaken for a
 *     stamped one — it fails closed, loudly, instead of reading as current.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *
 *     node scripts/stamp-revision.mjs           # stamp from git HEAD
 *     node scripts/stamp-revision.mjs --reset   # restore the placeholder
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(HERE, "..");
const TARGET = join(MCP_ROOT, "src", "buildRevision.ts");
const RESET = process.argv.includes("--reset");

const git = (...args) =>
  execFileSync("git", ["-C", MCP_ROOT, ...args], { encoding: "utf8" }).trim();

function stamp() {
  if (RESET) {
    return { revision: "development", sourceState: "development", stampedAt: "development" };
  }
  const revision = git("rev-parse", "HEAD");
  /**
   * The tarball ships the WORKING TREE, not the commit. So a dirty tree means
   * the running code is NOT the commit this stamp names — the SHA is then a
   * lower bound, not an identity. Say so in the payload rather than rounding it
   * to `clean`; the whole point of this file is that a build must not claim a
   * currency it does not have.
   *
   * Untracked files are excluded deliberately: scratch files and local .env are
   * normal and do not change what `tsc` compiles from `src/`.
   */
  const dirty = git("status", "--porcelain")
    .split("\n")
    .filter((line) => line && !line.startsWith("??"));
  return {
    revision,
    sourceState: dirty.length ? "dirty" : "clean",
    stampedAt: new Date().toISOString(),
  };
}

const info = stamp();

const contents = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by \`mcp-server/scripts/stamp-revision.mjs\`, which runs as the first
 * step of \`npm run deploy:mcp\`. It is COMMITTED with the \`development\`
 * placeholder so a fresh clone type-checks; the deploy overwrites it, and
 * \`scripts/preflight-deploy.mjs\` REFUSES a live service still reporting the
 * placeholder rather than treating it as a revision.
 *
 * Read this, never \`version\`. \`version\` is hand-bumped at release and read
 * \`1.25.0\` on both sides of a 94-hour-stale build (2026-09-07 → 09-11).
 */
export const BUILD_REVISION = Object.freeze({
  schema: "fahali.mcp.build/v1",
  revision: ${JSON.stringify(info.revision)},
  sourceState: ${JSON.stringify(info.sourceState)},
  stampedAt: ${JSON.stringify(info.stampedAt)},
});
`;

const previous = (() => {
  try {
    return readFileSync(TARGET, "utf8");
  } catch {
    return "";
  }
})();

if (previous === contents) {
  console.log(`  stamp unchanged — ${info.revision.slice(0, 12)} (${info.sourceState})`);
} else {
  writeFileSync(TARGET, contents, "utf8");
  console.log(`  stamped src/buildRevision.ts → ${info.revision.slice(0, 12)} (${info.sourceState})`);
}

if (info.sourceState === "dirty") {
  console.log(
    `  \x1b[33mwarn\x1b[0m  the tree is dirty, so this SHA is a LOWER BOUND on what will ship,\n` +
      `        not an identity. Commit the tree you deploy.`,
  );
}
