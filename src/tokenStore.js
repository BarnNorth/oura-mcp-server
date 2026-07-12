import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_TOKEN_PATH = path.join(os.homedir(), ".oura-mcp", "tokens.json");
const TOKEN_PATH = process.env.OURA_TOKEN_PATH || DEFAULT_TOKEN_PATH;
const TOKEN_URL = "https://api.ouraring.com/oauth/token";

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in, or export it before running.`
    );
  }
  return val;
}

export function ensureTokenDir() {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(TOKEN_PATH, "utf8");
  return JSON.parse(raw);
}

export function saveTokens(tokens) {
  ensureTokenDir();
  const record = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    // expires_in is seconds from now; store an absolute epoch ms timestamp instead
    // so we don't need to track "when we fetched this".
    expires_at: Date.now() + Number(tokens.expires_in) * 1000,
    scope: tokens.scope,
    token_type: tokens.token_type,
  };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

async function refreshAccessToken(refreshToken) {
  const clientId = requireEnv("OURA_CLIENT_ID");
  const clientSecret = requireEnv("OURA_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to refresh Oura access token (HTTP ${res.status}): ${text}. ` +
        `You may need to re-run "npm run authorize" if the refresh token was revoked or expired.`
    );
  }

  const json = await res.json();
  return saveTokens(json);
}

/**
 * Returns a currently-valid access token, transparently refreshing it
 * (and rewriting the refresh token, which Oura rotates on every use)
 * if it's expired or close to expiring.
 */
export async function getValidAccessToken() {
  let tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      'No stored Oura tokens found. Run "npm run authorize" once to complete the OAuth flow before starting the server.'
    );
  }

  // Refresh a bit early (60s buffer) rather than right at the expiry edge.
  const isExpiringSoon = Date.now() > tokens.expires_at - 60_000;
  if (isExpiringSoon) {
    tokens = await refreshAccessToken(tokens.refresh_token);
  }

  return tokens.access_token;
}

/**
 * Force a refresh regardless of expiry — used as a fallback if the API
 * returns 401 even though our locally stored token looked unexpired
 * (clock skew, manual revocation, etc.).
 */
export async function forceRefresh() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) {
    throw new Error(
      'No refresh token available. Run "npm run authorize" again to re-authenticate.'
    );
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  return refreshed.access_token;
}

export { TOKEN_PATH };
