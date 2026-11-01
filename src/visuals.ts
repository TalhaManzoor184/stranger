import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { config, req, ROOT, type VisualsProvider } from "./config";
import { run } from "./media";
import type { Reel, Shot } from "./reel";
import { withRetry } from "./retry";

export type ShotSource = { path: string; kind: "video" | "image" };

const NEGATIVE =
  "text, captions, subtitles, watermark, logo, celebrity likeness, recognizable actors, cartoon, anime, oversaturated, modern smartphones, modern cars, deformed hands";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function styleBlock(): Promise<string> {
  return (await fs.readFile(config.paths.style, "utf8")).trim();
}

/** Gemini video (Veo): one 8-second 9:16 clip per shot. */
async function makeVideo(prompt: string, out: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
  let op = await withRetry(`video (${config.videoModel})`, () =>
    ai.models.generateVideos({
      model: config.videoModel,
      prompt,
      config: {
        aspectRatio: "9:16",
        durationSeconds: 8,
        resolution: config.videoResolution,
        numberOfVideos: 1,
        negativePrompt: NEGATIVE,
      },
    }),
  );
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > 10 * 60_000) throw new Error("Video generation took over 10 minutes.");
    await sleep(10_000);
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  if (op.error) throw new Error(`Video generation failed: ${JSON.stringify(op.error).slice(0, 300)}`);
  const video = op.response?.generatedVideos?.[0]?.video;
  if (!video) {
    const why = op.response?.raiMediaFilteredReasons?.join("; ");
    throw new Error(`No video returned${why ? ` (safety filter: ${why})` : ""}.`);
  }
  if (video.videoBytes) await fs.writeFile(out, Buffer.from(video.videoBytes, "base64"));
  else await ai.files.download({ file: video, downloadPath: out });
}

/** Gemini image, 9:16. The composer adds a slow zoom so it reads as motion. */
async function makeImage(prompt: string, out: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
  const res = await withRetry(`image (${config.imageModel})`, () =>
    ai.models.generateContent({
      model: config.imageModel,
      contents: `${prompt}\nAvoid: ${NEGATIVE}.`,
      config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } },
    }),
  );
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini returned no image (it may have been blocked).");
  await fs.writeFile(out, Buffer.from(part.inlineData.data, "base64"));
}

function themeFor(shot: Shot): string {
  const p = shot.prompt.toLowerCase();
  if (/corridor|hallway|exit|locker|diner/.test(p)) return "corridor";
  if (/television|tv|living room|bedroom|wallpaper|kitchen|clock|calendar/.test(p)) return "room";
  if (/street|suburb|lawn|graduat|house/.test(p)) return "street";
  if (/die|dice|table|binder|shelf|hands|gown/.test(p)) return "object";
  return "forest";
}

async function makeProcedural(shot: Shot, seconds: number, seed: number, out: string): Promise<void> {
  await run("python3", [path.join(ROOT, "scripts/procedural_shot.py"), out, seconds.toFixed(2), String(seed), themeFor(shot)], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Make the source footage for every shot. Video failures fall back to an image for that shot. */
export async function makeVisuals(reel: Reel, durations: number[], workDir: string, provider: VisualsProvider): Promise<ShotSource[]> {
  const style = await styleBlock();
  const sources: ShotSource[] = [];
  for (const [i, shot] of reel.shots.entries()) {
    const prompt = `${style}\n\nScene: ${shot.prompt}`;
    const label = `  shot ${i + 1}/${reel.shots.length}`;
    if (provider === "procedural") {
      const out = path.join(workDir, `shot-${i}.src.mp4`);
      await makeProcedural(shot, durations[i] + 0.5, i + reel.part * 10, out);
      sources.push({ path: out, kind: "video" });
      console.log(`${label}: procedural`);
      continue;
    }
    if (provider === "video") {
      const out = path.join(workDir, `shot-${i}.src.mp4`);
      try {
        await makeVideo(prompt, out);
        sources.push({ path: out, kind: "video" });
        console.log(`${label}: Gemini video`);
        continue;
      } catch (err) {
        if (!config.fallbackToImage) throw err;
        console.warn(`${label}: video failed (${String((err as Error).message).slice(0, 200)}); making an image instead`);
      }
    }
    const out = path.join(workDir, `shot-${i}.src.png`);
    await makeImage(prompt, out);
    sources.push({ path: out, kind: "image" });
    console.log(`${label}: Gemini image`);
  }
  return sources;
}
