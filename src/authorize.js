#!/usr/bin/env node
// One-time interactive OAuth2 setup. Run this once (npm run authorize) after
// registering an application at https://cloud.ouraring.com/oauth/applications.
// It starts a tiny local HTTP server to catch the OAuth redirect, exchanges
// the code for tokens, and saves them via tokenStore for the MCP server to use.

import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { saveTokens } from "./tokenStore.js";

const CLIENT_ID = process.env.OURA_CLIENT_ID;
const CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const PORT = Number(process.env.OURA_AUTH_PORT || 8734);
const REDIRECT_URI = process.env.OURA_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";

// Request every scope so all the server's tools work. Trim this list if you'd
// rather not grant everything (see README for what each scope unlocks).
const SCOPES = ["email", "personal", "daily", "heartrate", "workout", "tag", "session", "spo2"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing OURA_CLIENT_ID and/or OURA_CLIENT_SECRET.\n" +
      "Set them in a .env file (see .env.example) or export them in your shell, then re-run:\n" +
      "  npm run authorize"
  );
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");

const authUrl = new URL(AUTHORIZE_URL);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES.join(" "));
authUrl.searchParams.set("state", state);

console.log("\nOura OAuth setup\n=================\n");
console.log("1. Open this URL in a browser where you're logged into Oura:\n");
console.log(`   ${authUrl.toString()}\n`);
console.log(`2. Approve access. You'll be redirected to ${REDIRECT_URI}`);
console.log(`   This script is listening on port ${PORT} and will finish automatically.\n`);
console.log("Waiting for authorization...\n");

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }

    const error = reqUrl.searchParams.get("error");
    if (error) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(
        `Authorization denied or failed: ${error}`
      );
      console.error(`\nAuthorization failed: ${error}`);
      server.close();
      process.exit(1);
    }

    const returnedState = reqUrl.searchParams.get("state");
    const code = reqUrl.searchParams.get("code");

    if (!code || returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(
        "Missing authorization code or state mismatch. Possible CSRF attempt or stale link — try again."
      );
      console.error("\nState mismatch or missing code — aborting for safety.");
      server.close();
      process.exit(1);
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      res.writeHead(500, { "Content-Type": "text/plain" }).end(
        "Token exchange failed. Check the terminal for details."
      );
      console.error(`\nToken exchange failed (HTTP ${tokenRes.status}): ${text}`);
      server.close();
      process.exit(1);
    }

    const tokenJson = await tokenRes.json();
    const saved = saveTokens(tokenJson);

    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Oura authorization complete.</h2>You can close this tab and return to the terminal."
    );

    console.log("Authorization complete. Tokens saved.");
    console.log(`Granted scopes: ${saved.scope}`);
    console.log(`Access token expires in ~${Math.round((saved.expires_at - Date.now()) / 60000)} minutes; it will auto-refresh after that using the stored refresh token.`);
    console.log("\nYou can now configure Claude Desktop to run: npm start (see README.md).");

    server.close();
    process.exit(0);
  } catch (err) {
    console.error("Unexpected error during callback handling:", err);
    res.writeHead(500).end("Unexpected error — see terminal.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  // Server is up; user opens the printed URL manually.
});
