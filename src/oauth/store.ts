import pg from "pg";
import { createHash, randomBytes } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { sealSecret, openSecret } from "./secretbox.js";

const DB_URL = process.env.DATABASE_URL;
// NOTE: deliberately NOT a module-load throw. This file is imported unconditionally
// by index.ts, so throwing here crashed the entire server whenever DATABASE_URL was
// absent — which broke every standalone run: directory/registry checks that boot the
// Docker image, and `npm start` from the published package. pg.Pool connects lazily,
// so OAuth simply fails at query time (ensureTables is already .catch()-wrapped)
// while static-key mode keeps working.
export const oauthStorageAvailable = Boolean(DB_URL);
if (!DB_URL) {
  console.error("[oauth] DATABASE_URL not set - OAuth storage unavailable; static-key mode only.");
}

const POOL_CONFIG = {
  connectionString: DB_URL,
  max: 5,
  idleTimeoutMillis: 30000,
};

/**
 * Tiers whose subscribers get a `paid` API-key scope on OAuth connect.
 *
 * 🔴 THE AGENT LADDER WAS MISSING (2026-08-14). This list held only the human
 * ladder, so a subscriber on **Agent Starter ($49), Agent Pro ($199) or Agent
 * Scale ($999)** — SKUs sold specifically for MCP/agent access — resolved to
 * `developer_free` and was then 403'd by `rejectFreeScope` on the paid
 * endpoints (`/agent/portfolio-risk`, `/agent/contagion`, `/agent/capital-flow`,
 * `/api/forecast/72h`). They paid for API access and got the free verdict
 * teaser. Nobody noticed because the agent ladder has no customers yet — this
 * was found by tracing a founder-account 403, not by a complaint.
 *
 * Membership rule, so this list can be extended safely:
 * - IN: every tier at or above the API-access threshold (Professional), plus
 *   every PAID agent SKU.
 * - OUT, deliberately: `retail` ($19) is app-only — API access starts at
 *   Professional (CLAUDE.md §5). `agent_free` ($0, routes.ts) is the free
 *   teaser and MUST stay out, or free keys reach the moat.
 *
 * Guarded by `server/tests/oauthPaidScopeCoversAgentLadder.test.ts`.
 */
const PAID_API_TIERS = new Set([
  // Human ladder (API access starts at Professional)
  "professional",
  "elite",
  "institutional", // code key; public name is "Desk"
  "desk",
  "enterprise",
  // Agent ladder — paid SKUs only
  "agent_starter",
  "agent_pro",
  "agent_scale",
]);

/**
 * Thrown when the email -> account bridge could not RUN. Deliberately distinct
 * from "no such account", which is a legitimate brand-new user and still
 * resolves to the authenticated uid. Only an infrastructure failure lands here.
 */
export class UnresolvedIdentityError extends Error {
  constructor() {
    super("Could not match this login to a Fahali account.");
    this.name = "UnresolvedIdentityError";
  }
}

export class OAuthStore implements OAuthRegisteredClientsStore {
  private pool: pg.Pool;

  constructor() {
    this.pool = new pg.Pool(POOL_CONFIG);
  }

  async ensureTables(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
        client_id         TEXT PRIMARY KEY,
        client_secret     TEXT,
        redirect_uris     TEXT[] NOT NULL,
        client_name       TEXT,
        client_uri        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        client_secret_expires_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
        code_hash         TEXT PRIMARY KEY,
        client_id         TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
        code_challenge    TEXT NOT NULL,
        redirect_uri      TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        scope             TEXT[],
        expires_at        TIMESTAMPTZ NOT NULL,
        used              BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
        token_hash        TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        client_id         TEXT NOT NULL,
        scope             TEXT[],
        token_type        TEXT NOT NULL DEFAULT 'access',
        expires_at        TIMESTAMPTZ NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON mcp_oauth_codes(client_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON mcp_oauth_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON mcp_oauth_tokens(expires_at);

      -- Per-OAuth-user upstream API key. spectra_api_keys is hash-only (the raw
      -- key can't be recovered), but the MCP must replay a raw sk_live_ key to
      -- the Fahali API, so we keep an encrypted copy here (see secretbox.ts).
      CREATE TABLE IF NOT EXISTS mcp_oauth_user_keys (
        user_id     TEXT PRIMARY KEY,
        api_key     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const { rows } = await this.pool.query(
      `SELECT client_id, client_secret, redirect_uris, client_name, client_uri, client_secret_expires_at
       FROM mcp_oauth_clients WHERE client_id = $1`,
      [clientId],
    );
    if (!rows[0]) return undefined;
    const r = rows[0];
    return {
      client_id: r.client_id,
      client_secret: r.client_secret || undefined,
      redirect_uris: r.redirect_uris,
      client_name: r.client_name || undefined,
      client_uri: r.client_uri || undefined,
      client_id_issued_at: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
      client_secret_expires_at: r.client_secret_expires_at ? Math.floor(new Date(r.client_secret_expires_at).getTime() / 1000) : 0,
    };
  }

  async registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): Promise<OAuthClientInformationFull> {
    const clientId = `fahali_${randomBytes(16).toString("hex")}`;
    // PUBLIC client: we advertise token_endpoint_auth_methods_supported:["none"],
    // so we issue NO client_secret — the code exchange is authenticated by PKCE.
    // (Issuing a secret here while requiring it at /token 401s every MCP client.)
    await this.pool.query(
      `INSERT INTO mcp_oauth_clients (client_id, client_secret, redirect_uris, client_name, client_uri)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, null, client.redirect_uris, client.client_name || null, client.client_uri || null],
    );
    return {
      client_id: clientId,
      redirect_uris: client.redirect_uris,
      client_name: client.client_name,
      client_uri: client.client_uri,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
    } as OAuthClientInformationFull;
  }

  async saveAuthorizationCode(
    code: string,
    clientId: string,
    codeChallenge: string,
    redirectUri: string,
    userId: string,
    scope: string[],
  ): Promise<void> {
    const codeHash = createHash("sha256").update(code).digest("hex");
    await this.pool.query(
      `INSERT INTO mcp_oauth_codes (code_hash, client_id, code_challenge, redirect_uri, user_id, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '10 minutes')`,
      [codeHash, clientId, codeChallenge, redirectUri, userId, scope],
    );
  }

  async consumeAuthorizationCode(code: string): Promise<{
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    userId: string;
    scope: string[];
  } | null> {
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { rows } = await this.pool.query(
      `UPDATE mcp_oauth_codes SET used = TRUE
       WHERE code_hash = $1 AND used = FALSE AND expires_at > NOW()
       RETURNING client_id, code_challenge, redirect_uri, user_id, scope`,
      [codeHash],
    );
    if (!rows[0]) return null;
    return {
      clientId: rows[0].client_id,
      codeChallenge: rows[0].code_challenge,
      redirectUri: rows[0].redirect_uri,
      userId: rows[0].user_id,
      scope: rows[0].scope || [],
    };
  }

  async challengeForAuthorizationCode(code: string): Promise<string> {
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { rows } = await this.pool.query(
      `SELECT code_challenge FROM mcp_oauth_codes WHERE code_hash = $1`,
      [codeHash],
    );
    return rows[0]?.code_challenge || "";
  }

  async saveAccessToken(
    token: string,
    userId: string,
    clientId: string,
    scope: string[],
    ttlSeconds: number = 3600,
  ): Promise<void> {
    const hash = createHash("sha256").update(token).digest("hex");
    await this.pool.query(
      `INSERT INTO mcp_oauth_tokens (token_hash, user_id, client_id, scope, token_type, expires_at)
       VALUES ($1, $2, $3, $4, 'access', NOW() + make_interval(secs => $5))`,
      [hash, userId, clientId, scope, ttlSeconds],
    );
  }

  async saveRefreshToken(
    token: string,
    userId: string,
    clientId: string,
    scope: string[],
  ): Promise<void> {
    const hash = createHash("sha256").update(token).digest("hex");
    await this.pool.query(
      `INSERT INTO mcp_oauth_tokens (token_hash, user_id, client_id, scope, token_type, expires_at)
       VALUES ($1, $2, $3, $4, 'refresh', NOW() + INTERVAL '30 days')`,
      [hash, userId, clientId, scope],
    );
  }

  async verifyAccessToken(token: string): Promise<{
    userId: string;
    clientId: string;
    scope: string[];
  } | null> {
    const hash = createHash("sha256").update(token).digest("hex");
    const { rows } = await this.pool.query(
      `SELECT user_id, client_id, scope FROM mcp_oauth_tokens
       WHERE token_hash = $1 AND token_type = 'access' AND expires_at > NOW()`,
      [hash],
    );
    if (!rows[0]) return null;
    return {
      userId: rows[0].user_id,
      clientId: rows[0].client_id,
      scope: rows[0].scope || [],
    };
  }

  async getAccessToken(token: string): Promise<{
    userId: string;
    clientId: string;
    scope: string[];
    expires_at: string;
  } | null> {
    const hash = createHash("sha256").update(token).digest("hex");
    const { rows } = await this.pool.query(
      `SELECT user_id, client_id, scope, expires_at FROM mcp_oauth_tokens
       WHERE token_hash = $1 AND token_type = 'access'`,
      [hash],
    );
    if (!rows[0]) return null;
    return {
      userId: rows[0].user_id,
      clientId: rows[0].client_id,
      scope: rows[0].scope || [],
      expires_at: rows[0].expires_at,
    };
  }

  /**
   * Validate a plaintext Fahali API key before it is allowed to allocate an
   * MCP transport session. The upstream API remains the authority for scopes,
   * but a random string must not be enough to consume a long-lived SSE/HTTP
   * session on this service.
   */
  async isActiveApiKey(token: string): Promise<boolean> {
    if (!/^sk_live_[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    const { rows } = await this.pool.query(
      `SELECT 1 FROM spectra_api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL
       LIMIT 1`,
      [hash],
    );
    return Boolean(rows[0]);
  }

  async getUserApiKey(userId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query(
      `SELECT api_key FROM mcp_oauth_user_keys WHERE user_id = $1`,
      [userId],
    );
    if (!rows[0]?.api_key) return undefined;
    try {
      return openSecret(rows[0].api_key);
    } catch {
      // Corrupt / undecryptable (e.g. salt version bump) — treat as missing so
      // the caller re-provisions a fresh key rather than handing back garbage.
      return undefined;
    }
  }

  async verifyClientSecret(clientId: string, secret: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT client_secret FROM mcp_oauth_clients WHERE client_id = $1 AND client_secret IS NOT NULL`,
      [clientId],
    );
    if (!rows[0]) return true;
    return constantTimeCompare(rows[0].client_secret, secret);
  }

  /**
   * Resolve the CANONICAL Fahali user id for an OAuth login. OAuth gives a
   * Firebase UID, but a user's real account (often pre-Firebase) is keyed by
   * email — minting the API key under the Firebase UID 401s at the API
   * ("owner not found") because no users row exists for that UID. We bridge by
   * email; if there's no match (brand-new user) we fall back to the Firebase UID.
   */
  private async resolveCanonicalUserId(firebaseUid: string, email?: string): Promise<string> {
    if (!email) {
      console.error("[oauth] canonical owner lookup has no verified email; using authenticated uid");
      return firebaseUid;
    }
    let rows: Array<{ id?: unknown }>;
    try {
      // NOTE: the users table has NO created_at column - ordering by it threw
      // and the catch silently fell back to the Firebase UID (-> API 401).
      //
      // Order by CAN-THIS-ROW-PAY first, then id. `ORDER BY id ASC` alone is
      // oldest-wins, which is exactly backwards for billing: a person holding
      // two rows on one address (an old free signup plus the paid account they
      // opened later) was bound to the free one and re-minted a developer_free
      // key on every reconnect. COALESCE+LOWER because a NULL tier under
      // `= ANY(...)` yields NULL, and NULLs sort FIRST under DESC.
      ({ rows } = await this.pool.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) OR id = $3
          ORDER BY (LOWER(COALESCE(subscription_tier, '')) = ANY($2)) DESC, id ASC
          LIMIT 1`,
        [email, Array.from(PAID_API_TIERS), firebaseUid],
      ));
    } catch (e: any) {
      // Do NOT fall back here. An unresolvable identity is an authorization
      // failure, not a free-tier customer: falling back mints a developer_free
      // key, and the subscriber is then refused by scope on every paid endpoint
      // while being told to upgrade the plan they have already bought.
      console.error(`[oauth] canonical owner lookup failed: ${e?.message || e}; refusing to guess`);
      throw new UnresolvedIdentityError();
    }
    const resolved = rows[0]?.id ? String(rows[0].id) : firebaseUid;
    console.error(`[oauth] canonical owner lookup ${rows[0]?.id ? "matched an account" : "used authenticated uid"}`);
    return resolved;
  }

  /** Drop the cached per-(Firebase-UID) key so the next provision re-mints under
   *  the freshly-resolved canonical owner (fixes keys minted before the bridge). */
  async clearUserKey(firebaseUid: string): Promise<void> {
    await this.pool.query(`DELETE FROM mcp_oauth_user_keys WHERE user_id = $1`, [firebaseUid]);
  }

  /**
   * Key scope follows the owner's subscription tier (API access starts at
   * Professional — retail is app-only, mirroring connect-hub tierToKeyScope).
   * Was hardcoded 'developer_free' as a Stage-2 safety cap while requireAuth
   * still decoded JWTs unverified; that P0 is fixed, and the cap turned into a
   * trap: a verified Enterprise Google login was handed a free-scope key and
   * tier-blocked from the product it pays for.
   */
  private async scopeForOwner(ownerId: string): Promise<"paid" | "developer_free"> {
    try {
      const { rows } = await this.pool.query(
        `SELECT subscription_tier FROM users WHERE id = $1 LIMIT 1`,
        [ownerId],
      );
      /**
       * 🔴 "NO ACCOUNT" AND "A RETAIL ACCOUNT" ARE DIFFERENT FACTS.
       *
       * `rows[0]?.subscription_tier || ""` collapsed them: a caller with no
       * `users` row at all produced the same `developer_free` as a caller on a
       * tier without API access, silently and forever.
       *
       * Measured 2026-08-28: one Firebase UID has **27 OAuth tokens over 16
       * days, still connecting today**, a provisioned API key, and NO users
       * row — an active Codex integrator who cannot be tier-resolved, would
       * stay free-scoped even after paying, and appears in no user count. Five
       * `spectra_api_keys` rows are owned by a user id that does not exist.
       *
       * The SCOPE is unchanged and still correct: without an account we cannot
       * establish entitlement, so the safe credential is the free one. What
       * changes is that the condition is no longer invisible. Absence rendering
       * as safety is this codebase's most expensive recurring defect, and a
       * silent default is how it always begins.
       */
      if (!rows[0]) {
        console.error(
          `[oauth] owner ${ownerId.slice(0, 6)}… has NO users row — provisioning fallback user row.`,
        );
        try {
          const safeUsername = "user_" + ownerId.slice(0, 20).replace(/[^a-zA-Z0-9_]/g, "") + "_" + Date.now().toString(36);
          const safeEmail = (ownerId.includes("@") ? ownerId : `${ownerId}@fahaliai.com`).toLowerCase().trim();
          await this.pool.query(
            `INSERT INTO users (id, username, password, email, name, subscription_tier, subscription_status)
             VALUES ($1, $2, 'oauth-auto', $3, 'Fahali User', 'retail', 'active')
             ON CONFLICT (id) DO NOTHING`,
            [ownerId, safeUsername, safeEmail],
          );
        } catch (e: any) {
          console.error(`[oauth] fallback user row insert error: ${e?.message || e}`);
        }
        return "developer_free";
      }
      const tier = String(rows[0].subscription_tier || "").toLowerCase();
      return PAID_API_TIERS.has(tier) ? "paid" : "developer_free";
    } catch (e: any) {
      console.error(`[oauth] owner scope lookup failed: ${e?.message || e} → developer_free`);
      return "developer_free";
    }
  }

  /**
   * Idempotently ensure the OAuth user has an upstream API key the MCP can
   * replay to the Fahali API. Mints a real `sk_live_` key whose SHA-256 hash is
   * registered in `spectra_api_keys` under the CANONICAL owner (so the API
   * resolves the user) and stores the raw key encrypted in mcp_oauth_user_keys
   * keyed by the Firebase UID (the token's user_id, for retrieval).
   */
  async autoProvisionApiKey(firebaseUid: string, email?: string): Promise<string> {
    const ownerId = await this.resolveCanonicalUserId(firebaseUid, email);
    const scope = await this.scopeForOwner(ownerId);

    const existing = await this.getUserApiKey(firebaseUid);
    if (existing) {
      // The cached key must still be ALIVE upstream: if the user revoked it
      // from Settings → Developer, replaying it fails every call and the
      // connector is permanently bricked. Check, and re-mint when dead.
      const existingHash = createHash("sha256").update(existing, "utf8").digest("hex");
      try {
        const { rows } = await this.pool.query(
          `SELECT revoked_at, user_id FROM spectra_api_keys WHERE key_hash = $1 LIMIT 1`,
          [existingHash],
        );
        if (
          rows[0] &&
          rows[0].revoked_at === null &&
          String(rows[0].user_id) === ownerId
        ) {
          // Heal scope on reconnect: keys minted under the old hardcoded free
          // cap (or before a tier change) re-scope to the owner's current tier.
          await this.pool.query(
            `UPDATE spectra_api_keys SET scope = $1
             WHERE key_hash = $2 AND scope IS DISTINCT FROM $1`,
            [scope, existingHash],
          );
          return existing;
        }
        // A pre-email-bridge key can be live but attached to the wrong owner.
        // Revoke it before replacing the encrypted reference; otherwise each
        // reconnect leaves another usable orphan credential behind.
        if (rows[0]?.revoked_at === null) {
          await this.pool.query(
            `UPDATE spectra_api_keys SET revoked_at = NOW()
             WHERE key_hash = $1 AND revoked_at IS NULL`,
            [existingHash],
          );
        }
        console.error("[oauth] cached key is revoked, missing, or owner-mismatched — re-minting");
        await this.clearUserKey(firebaseUid);
      } catch (e: any) {
        console.error(`[oauth] key liveness check failed: ${e?.message || e} — returning cached key`);
        return existing;
      }
    }

    // Key format MUST match server/apiKeys/keygen.ts so the API validates it.
    const plaintext = `sk_live_${randomBytes(32).toString("base64url")}`;
    const sealed = sealSecret(plaintext);
    const keyHash = createHash("sha256").update(plaintext, "utf8").digest("hex");
    const keyPrefix = `${plaintext.slice(0, 16)}…`;

    // Claim the per-user slot first (keyed by Firebase UID). Only the winner of a
    // concurrent race registers the hash, so a loser never leaves an orphan key.
    const claim = await this.pool.query(
      `INSERT INTO mcp_oauth_user_keys (user_id, api_key)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING api_key`,
      [firebaseUid, sealed],
    );
    if (!claim.rows[0]) {
      const winner = await this.getUserApiKey(firebaseUid);
      if (winner) return winner;
      // Existing row is undecryptable (e.g. signing secret rotated) — overwrite.
      await this.pool.query(
        `UPDATE mcp_oauth_user_keys SET api_key = $2, created_at = NOW() WHERE user_id = $1`,
        [firebaseUid, sealed],
      );
    }

    await this.pool.query(
      `INSERT INTO spectra_api_keys (key_hash, key_prefix, user_id, scope, name)
       VALUES ($1, $2, $3, $4, 'MCP OAuth')`,
      [keyHash, keyPrefix, ownerId, scope],
    );
    console.error(`[oauth] provisioned an MCP key with scope=${scope}`);
    return plaintext;
  }

  async cleanupExpired(): Promise<void> {
    await this.pool.query(`DELETE FROM mcp_oauth_codes WHERE expires_at < NOW()`);
    // Keep recently expired access-token fingerprints long enough to return a
    // typed AUTH_EXPIRED response instead of collapsing expiry into AUTH_INVALID.
    // They remain unusable: resolveSessionAuth checks expires_at before binding
    // an MCP session. Refresh tokens are removed immediately on expiry.
    await this.pool.query(
      `DELETE FROM mcp_oauth_tokens
       WHERE (token_type = 'refresh' AND expires_at < NOW())
          OR (token_type = 'access' AND expires_at < NOW() - INTERVAL '7 days')`,
    );
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.pool.query(`DELETE FROM mcp_oauth_tokens WHERE token_hash = $1`, [tokenHash]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let result = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      result |= (a.charCodeAt(Math.min(i, a.length - 1)) ?? 0) ^ (b.charCodeAt(Math.min(i, b.length - 1)) ?? 0);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
