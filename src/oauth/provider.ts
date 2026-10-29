import { randomBytes, createHash } from "node:crypto";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { OAuthStore } from "./store.js";

const FAHALI_APP = "https://app.fahaliai.com";
const ACCESS_TOKEN_TTL = 3600; // 1 hour
const API_BASE = process.env.FAHALI_API_URL || "http://localhost:5000";

/**
 * RFC 6749 refresh requests may keep or narrow the original grant, but they
 * may never use a refresh token to add permissions the user did not approve.
 */
export function refreshScopesForGrant(
  grantedScopes: readonly string[],
  requestedScopes?: readonly string[],
): string[] {
  const granted = Array.from(new Set(grantedScopes.map(String).filter(Boolean)));
  if (!requestedScopes?.length) return granted;
  const requested = Array.from(new Set(requestedScopes.map(String).filter(Boolean)));
  if (requested.some((scope) => !granted.includes(scope))) {
    throw new Error("invalid_scope: refresh cannot expand the original authorization grant");
  }
  return requested;
}

export type AuthenticatedSessionPrincipal = {
  /** Stable account/key identity. Never log this value. */
  principalId: string;
  /** OAuth client registration, or the MCP client identity for static keys. */
  clientId: string;
  credentialType: "oauth" | "api_key" | "process_key" | "none";
};

/** Access-token bytes are intentionally absent: refresh rotation must match. */
export function sameAuthenticatedPrincipal(
  expected: AuthenticatedSessionPrincipal,
  candidate: AuthenticatedSessionPrincipal | undefined,
): boolean {
  return Boolean(
    candidate &&
    expected.credentialType === candidate.credentialType &&
    expected.principalId === candidate.principalId &&
    expected.clientId === candidate.clientId,
  );
}

export class FahaliOAuthProvider implements OAuthServerProvider {
  constructor(public readonly clientsStore: OAuthStore) {}

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: any,
  ): Promise<void> {
    const state = params.state || "";
    const redirectUri = encodeURIComponent(params.redirectUri);
    const clientId = encodeURIComponent(client.client_id);
    const codeChallenge = encodeURIComponent(params.codeChallenge);

    // Delegate to app.fahaliai.com login → app authenticates → app POSTs to
    // /api/oauth/assertion → redirects to /authorize/callback with an HMAC-signed
    // assertion bound to the verified user.
    //
    // OAuth params stay TOP-LEVEL so AuthScreen can read client_id/redirect_uri
    // from window.location.search. Use the current Auth route; /login is a
    // legacy app URL and can fall through to the default dashboard.
    const encState = encodeURIComponent(state);
    const scope = encodeURIComponent((params.scopes || []).join(" "));
    const loginUrl =
      `${FAHALI_APP}/auth?client_id=${clientId}&redirect_uri=${redirectUri}` +
      `&code_challenge=${codeChallenge}&state=${encState}&scope=${scope}`;
    res.redirect(loginUrl);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    return this.clientsStore.challengeForAuthorizationCode(authorizationCode);
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    if (!codeVerifier) {
      throw new Error("invalid_grant: code_verifier is required (PKCE S256 enforcement)");
    }

    const record = await this.clientsStore.consumeAuthorizationCode(authorizationCode);
    if (!record) {
      throw new Error("invalid_grant: authorization code not found, expired, or already used");
    }

    if (record.clientId !== client.client_id) {
      throw new Error("invalid_grant: client_id mismatch");
    }
    if (redirectUri && record.redirectUri !== redirectUri) {
      throw new Error("invalid_grant: redirect_uri mismatch");
    }

    // PKCE S256 verification (mandatory)
    const expectedChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (expectedChallenge !== record.codeChallenge) {
      throw new Error("invalid_grant: code_verifier does not match code_challenge");
    }

    // Generate tokens
    const accessToken = `fahali_oat_${randomBytes(32).toString("base64url")}`;
    const refreshToken = `fahali_ort_${randomBytes(32).toString("base64url")}`;

    await this.clientsStore.saveAccessToken(accessToken, record.userId, client.client_id, record.scope, ACCESS_TOKEN_TTL);
    await this.clientsStore.saveRefreshToken(refreshToken, record.userId, client.client_id, record.scope);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
      scope: record.scope.join(" "),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const hash = createHash("sha256").update(refreshToken).digest("hex");
    const store = this.clientsStore as OAuthStore;

    const pool = (store as any).pool;
    const grantResult = await pool.query(
      `SELECT scope FROM mcp_oauth_tokens
       WHERE token_hash = $1 AND token_type = 'refresh' AND client_id = $2 AND expires_at > NOW()`,
      [hash, client.client_id],
    );
    if (!grantResult.rows[0]) {
      throw new Error("invalid_grant: refresh token not found or expired");
    }
    const nextScopes = refreshScopesForGrant(grantResult.rows[0].scope || [], scopes);

    // Atomically consume after validating requested scope. DELETE ... RETURNING
    // prevents two concurrent refreshes from rotating the same credential.
    const { rows } = await pool.query(
      `DELETE FROM mcp_oauth_tokens
       WHERE token_hash = $1 AND token_type = 'refresh' AND client_id = $2 AND expires_at > NOW()
       RETURNING user_id, scope`,
      [hash, client.client_id],
    );
    if (!rows[0]) {
      throw new Error("invalid_grant: refresh token not found or expired");
    }

    // Rotate: the old refresh is already consumed; issue a new pair.
    const accessToken = `fahali_oat_${randomBytes(32).toString("base64url")}`;
    const newRefreshToken = `fahali_ort_${randomBytes(32).toString("base64url")}`;

    await store.saveAccessToken(accessToken, rows[0].user_id, client.client_id, nextScopes, ACCESS_TOKEN_TTL);
    await store.saveRefreshToken(newRefreshToken, rows[0].user_id, client.client_id, nextScopes);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: newRefreshToken,
      scope: nextScopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // Use the persisted expiry rather than inventing a fresh one-hour lifetime
    // every time a token is inspected.  The old implementation made an access
    // token look valid for another hour immediately before it expired.
    const info = await this.clientsStore.getAccessToken(token);
    const expiresAt = info ? Math.floor(new Date(info.expires_at).getTime() / 1000) : Number.NaN;
    if (!info || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new Error("invalid_token");
    }
    return {
      token,
      clientId: info.clientId,
      scopes: info.scope,
      expiresAt,
      extra: { userId: info.userId },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const hash = createHash("sha256").update(request.token).digest("hex");
    await this.clientsStore.revokeToken(hash);
  }
}
