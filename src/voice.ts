import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { config, req, type TtsProvider } from "./config";
import { durationOf, ffmpeg, findSilences, run, toVoiceWav } from "./media";
import type { Reel } from "./reel";
import { shouldFallBack, withRetry } from "./retry";

export type Word = { text: string; start: number; end: number };
export type Voiced = {
  wavPath: string;
  duration: number;
  /** End time (s) of each shot's voiceover; the last equals duration. */
  shotEnds: number[];
  words: Word[];
};

const GAP = 0.3; // pause between shots, seconds

/** Spread a line's words across [t0, t1] by length. Gemini/Kokoro give no word timings. */
function estimateWords(text: string, t0: number, t1: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => t.replace(/[^\w']/g, "").length + 1.5 + (/[.,?!…]$/.test(t) ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = t0;
  return tokens.map((text, i) => {
    const d = (weights[i] / total) * (t1 - t0);
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

function buildWords(lines: string[], ends: number[]): Word[] {
  const words: Word[] = [];
  lines.forEach((line, i) => {
    const start = i === 0 ? 0 : ends[i - 1] + GAP * 0.5;
    words.push(...estimateWords(line, start, ends[i] - (i < lines.length - 1 ? GAP * 0.5 : 0)));
  });
  return words;
}

// ---------- Kokoro (offline) ----------

const KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";

async function ensureKokoroModels(): Promise<string> {
  const dir = config.paths.kokoroModels;
  await fs.mkdir(dir, { recursive: true });
  for (const [local, remote] of [["kokoro.onnx", "kokoro-v1.0.int8.onnx"], ["voices.bin", "voices-v1.0.bin"]]) {
    const file = path.join(dir, local);
    try {
      await fs.access(file);
    } catch {
      console.log(`  downloading ${remote}…`);
      const res = await fetch(`${KOKORO_URL}/${remote}`);
      if (!res.ok) throw new Error(`Kokoro model download failed: ${res.status}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
  }
  return dir;
}

async function kokoro(lines: string[], workDir: string): Promise<Voiced> {
  const models = await ensureKokoroModels();
  await run("python3", [config.paths.kokoroScript, models, config.kokoroVoice, String(config.kokoroSpeed), workDir, ...lines], {
    maxBuffer: 16 * 1024 * 1024,
  });
  // Normalise each segment, then join with a short gap so shot boundaries are exact.
  const segs: string[] = [];
  const ends: number[] = [];
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    const seg = path.join(workDir, `seg-${i}.norm.wav`);
    await toVoiceWav(path.join(workDir, `seg-${i}.wav`), seg);
    const d = await durationOf(seg);
    t += d;
    ends.push(t);
    segs.push(seg);
    if (i < lines.length - 1) t += GAP;
  }
  const out = path.join(workDir, "voice.wav");
  const inputs = segs.flatMap((s) => ["-i", s]);
  const pad = segs.map((_, i) => (i < segs.length - 1 ? `[${i}]apad=pad_dur=${GAP}[a${i}]` : `[${i}]anull[a${i}]`)).join(";");
  const cat = segs.map((_, i) => `[a${i}]`).join("") + `concat=n=${segs.length}:v=0:a=1[out]`;
  await ffmpeg([...inputs, "-filter_complex", `${pad};${cat}`, "-map", "[out]", "-ar", "44100", "-ac", "1", out]);
  const duration = await durationOf(out);
  ends[ends.length - 1] = duration;
  return { wavPath: out, duration, shotEnds: ends, words: buildWords(lines, ends) };
}

// ---------- Gemini TTS ----------

async function geminiOnce(model: string, text: string, rawPath: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
  const interaction = await ai.interactions.create({
    model,
    input: [
      {
        type: "user_input",
        content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: config.geminiStyle }] }],
      },
    ],
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice: config.geminiVoice, language: "en-US" }] },
  });
  const data = interaction.output_audio?.data;
  if (!data) throw new Error("Gemini returned no audio.");
  await fs.writeFile(rawPath, Buffer.from(data, "base64"));
}

/** One TTS request for the whole reel (free tier allows few a day), then find the pause between shots. */
async function gemini(lines: string[], workDir: string): Promise<Voiced> {
  const raw = path.join(workDir, "voice.raw.wav");
  const text = lines.join("\n<short pause>\n");
  try {
    await withRetry(`voice (${config.ttsModel})`, () => geminiOnce(config.ttsModel, text, raw));
  } catch (err) {
    if (!shouldFallBack(err) || !config.ttsFallback) throw err;
    console.warn(`  ${config.ttsModel} unavailable; using ${config.ttsFallback}`);
    await withRetry(`voice (${config.ttsFallback})`, () => geminiOnce(config.ttsFallback, text, raw));
  }
  const out = path.join(workDir, "voice.wav");
  await toVoiceWav(raw, out);
  const duration = await durationOf(out);
  const ends = await shotEndsFromPauses(out, lines, duration);
  return { wavPath: out, duration, shotEnds: ends, words: buildWords(lines, ends) };
}

/** Expected boundary by text length, snapped to the longest nearby pause. */
async function shotEndsFromPauses(file: string, lines: string[], duration: number): Promise<number[]> {
  const silences = (await findSilences(file)).filter((s) => s.start > 0.5 && s.end < duration - 0.5);
  const weights = lines.map((l) => l.replace(/[^\w]/g, "").length + 4);
  const sum = weights.reduce((a, b) => a + b, 0);
  const ends: number[] = [];
  let acc = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    acc += weights[i];
    const expected = (acc / sum) * duration;
    const near = silences
      .filter((s) => Math.abs((s.start + s.end) / 2 - expected) < 2.5)
      .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    ends.push(near ? near.start : expected);
  }
  ends.push(duration);
  return ends;
}

export async function voiceReel(reel: Reel, workDir: string, provider: TtsProvider): Promise<Voiced> {
  const lines = reel.shots.map((s) => s.vo.trim());
  if (provider === "kokoro") return kokoro(lines, workDir);
  try {
    return await gemini(lines, workDir);
  } catch (err) {
    console.warn(`  Gemini voice failed (${String((err as Error).message).slice(0, 160)}); using the offline Kokoro voice.`);
    return kokoro(lines, workDir);
  }
}
