import "dotenv/config";
import http from "node:http";
import { google } from "googleapis";

/**
 * One-time helper: run on your own computer to get YOUTUBE_REFRESH_TOKEN.
 *   1. Put YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env (OAuth client type "Desktop app").
 *   2. npm run auth:youtube
 *   3. Open the printed link, sign in with the Google account that owns the channel, pick the channel.
 *   4. Copy the printed refresh token into .env and your GitHub secrets.
 */

const PORT = 5317;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;

const id = process.env.YOUTUBE_CLIENT_ID;
const secret = process.env.YOUTUBE_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const auth = new google.auth.OAuth2(id, secret, REDIRECT);
const url = auth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
});

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) return void res.end();
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.end("No code in the callback. Try again.");
    return;
  }
  try {
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    const yt = google.youtube({ version: "v3", auth });
    const me = await yt.channels.list({ part: ["snippet"], mine: true });
    const channel = me.data.items?.[0]?.snippet?.title ?? "(unknown)";
    res.end(`Done. Authorised channel: ${channel}. You can close this tab.`);
    console.log(`\nChannel: ${channel}`);
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    if (!tokens.refresh_token) console.log("No refresh token returned. Remove the app at myaccount.google.com/permissions and run again.");
  } catch (e) {
    res.end("Token exchange failed. See the terminal.");
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("Open this link in your browser and approve access:\n");
  console.log(url + "\n");
});
