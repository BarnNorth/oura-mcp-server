import { getValidAccessToken, forceRefresh } from "./tokenStore.js";

const BASE_URL = "https://api.ouraring.com/v2";

// Endpoints this server is allowed to hit. Deliberately excludes
// /v2/webhook/* (subscription management is an account-level admin action,
// not a personal-data-read action, and has no business being reachable from
// a "give Claude my health data" tool).
function assertReadOnlyUserEndpoint(pathSegment) {
  const normalized = pathSegment.replace(/^\/+/, "");
  const allowed =
    normalized.startsWith("usercollection/") || normalized.startsWith("sandbox/usercollection/");
  if (!allowed) {
    throw new Error(
      `Refusing to call "${pathSegment}": this server only allows GET access to usercollection/* endpoints.`
    );
  }
}

/**
 * GET a v2 usercollection endpoint with query params, transparently handling
 * token refresh. Returns the parsed JSON body.
 */
export async function ouraGet(pathSegment, params = {}) {
  assertReadOnlyUserEndpoint(pathSegment);

  const url = new URL(`${BASE_URL}/${pathSegment.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let accessToken = await getValidAccessToken();
  let res = await doFetch(url, accessToken);

  // Safety net: if our local expiry bookkeeping was wrong for any reason
  // (clock skew, manual revocation elsewhere) and Oura says 401, force one
  // refresh and retry exactly once before giving up.
  if (res.status === 401) {
    accessToken = await forceRefresh();
    res = await doFetch(url, accessToken);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(formatApiError(res.status, pathSegment, text));
  }

  return res.json();
}

async function doFetch(url, accessToken) {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
}

function formatApiError(status, pathSegment, body) {
  switch (status) {
    case 401:
      return `Oura API returned 401 Unauthorized for ${pathSegment} even after refreshing the token. The refresh token may have been revoked — re-run "npm run authorize".`;
    case 403:
      return `Oura API returned 403 Forbidden for ${pathSegment}. This usually means the granted scope doesn't cover this endpoint, or the Oura membership on the account has lapsed.`;
    case 429:
      return `Oura API rate limit hit (429) for ${pathSegment}. The v2 limit is 5000 requests per 5-minute window; back off and retry shortly.`;
    default:
      return `Oura API request to ${pathSegment} failed with HTTP ${status}: ${body}`;
  }
}
