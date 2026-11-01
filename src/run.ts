import fs from "node:fs/promises";
import path from "node:path";
import { composeReel, shotTiming } from "./compose";
import { config, type TtsProvider, type VisualsProvider } from "./config";
import { appendHistory, loadHistory, todayPk } from "./history";
import { durationOf } from "./media";
import { pickReel } from "./script";
import { uploadReel } from "./upload";
import { makeVisuals } from "./visuals";
import { voiceReel } from "./voice";

/**
 * npm run reel                     next reel, Gemini voice + video, upload (schedule mode)
 * npm run reel -- --reel=ep1-r3    a specific reel
 * npm run reel -- --no-upload      render only
 * npm run reel -- --if-slot-free   do nothing if today's reel is already in data/history.json
 * npm run reel:test                keyless: placeholder visuals + offline voice, no upload
 *   --visuals=video|image|procedural   --tts=gemini|kokoro
 */
function flag(name: string): string | true | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : true;
}

async function main() {
  const visuals = (flag("visuals") as VisualsProvider) || config.visuals;
  const tts = (flag("tts") as TtsProvider) || config.ttsProvider;
  const upload = !flag("no-upload");
  const reelArg = typeof flag("reel") === "string" ? (flag("reel") as string) : undefined;
  const history = await loadHistory();

  if (flag("if-slot-free") && history.some((h) => h.date === todayPk() && h.videoId)) {
    console.log(`Today's reel (${todayPk()}) is already uploaded. Nothing to do.`);
    return;
  }

  const reel = await pickReel(history, reelArg);
  console.log(`Reel: ${reel.id} — ${reel.title}`);
  const workDir = path.join(config.paths.out, `${todayPk()}-${reel.id}`);
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(path.join(workDir, "reel.json"), JSON.stringify(reel, null, 2));

  console.log(`Voice (${tts})…`);
  const voice = await voiceReel(reel, workDir, tts);
  const { durations, end } = shotTiming(voice);
  console.log(`  ${voice.duration.toFixed(1)} s of voice, reel ${end.toFixed(1)} s`);

  console.log(`Visuals (${visuals})…`);
  const sources = await makeVisuals(reel, durations, workDir, visuals);

  console.log("Composing…");
  const file = await composeReel(reel, voice, sources, workDir);
  console.log(`  ${file} (${(await durationOf(file)).toFixed(1)} s)`);

  if (!upload) {
    console.log("Upload skipped (--no-upload).");
    return;
  }
  console.log(`Uploading to YouTube (${config.uploadMode})…`);
  const { videoId, publishAt } = await uploadReel(file, reel);
  console.log(`  https://youtube.com/shorts/${videoId}${publishAt ? ` — goes public ${publishAt}` : ""}`);
  await appendHistory({ date: todayPk(), reelId: reel.id, title: reel.title, videoId, publishAt });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
