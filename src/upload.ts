import fs from "node:fs";
import { google } from "googleapis";
import { config, req } from "./config";
import type { Reel } from "./reel";

export function youtubeClient() {
  const auth = new google.auth.OAuth2(req("YOUTUBE_CLIENT_ID"), req("YOUTUBE_CLIENT_SECRET"));
  auth.setCredentials({ refresh_token: req("YOUTUBE_REFRESH_TOKEN") });
  return google.youtube({ version: "v3", auth });
}

/** Next PUBLISH_TIME in PUBLISH_UTC_OFFSET local time, as ISO UTC (today if still 15+ min away, else tomorrow). */
export function publishAtIso(now = new Date()): string {
  const [hh, mm] = config.publishTime.split(":").map(Number);
  const offsetMs = config.publishUtcOffset * 3600_000;
  const local = new Date(now.getTime() + offsetMs);
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - offsetMs;
  while (target < now.getTime() + 15 * 60_000) target += 24 * 3600_000;
  return new Date(target).toISOString();
}

const FOOTER = `

The Conformity Gate — a fan-made mini-series explaining the viral Stranger Things theory, one short part a day.
Fan theories are labelled as theories. Independent fan channel, not affiliated with or endorsed by Netflix or the Duffer Brothers. All visuals are original AI footage.`;

export async function uploadReel(file: string, reel: Reel): Promise<{ videoId: string; publishAt?: string }> {
  const yt = youtubeClient();
  const publishAt = config.uploadMode === "schedule" ? publishAtIso() : undefined;
  const tags = ["stranger things", "conformity gate", "stranger things theory", "stranger things episode 9", "fan theory", "vecna", "stranger things 5", "shorts"];
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: reel.title.slice(0, 100),
        description: `${reel.caption}\n\n${reel.hashtags.join(" ")} #Shorts${FOOTER}`.slice(0, 4900),
        tags,
        categoryId: "24", // Entertainment
        defaultLanguage: "en",
        defaultAudioLanguage: "en",
      },
      status: {
        privacyStatus: config.uploadMode === "public" ? "public" : "private",
        publishAt,
        selfDeclaredMadeForKids: false,
        // Synthetic visuals and voice: YouTube asks creators to disclose realistic AI content.
        containsSyntheticMedia: true,
        embeddable: true,
      },
    },
    media: { mimeType: "video/mp4", body: fs.createReadStream(file) },
  });
  const videoId = res.data.id;
  if (!videoId) throw new Error("YouTube did not return a video id.");
  return { videoId, publishAt };
}
