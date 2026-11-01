import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}. Add it to .env (local) or the GitHub repository secrets.`);
  return v;
}

export type VisualsProvider = "video" | "image" | "procedural";
export type TtsProvider = "gemini" | "kokoro";

export const config = {
  // Script writer (used once the hand-written reels in data/reels are used up)
  textModel: opt("GEMINI_TEXT_MODEL", "gemini-3.8-flash"),
  textFallback: opt("GEMINI_TEXT_FALLBACK", "gemini-3.5-flash-lite"),

  // Voice
  ttsProvider: opt("TTS_PROVIDER", "gemini") as TtsProvider,
  ttsModel: opt("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"),
  ttsFallback: opt("GEMINI_TTS_FALLBACK", "gemini-3.8-flash-lite-tts"),
  /** Deep, documentary voices: Charon, Orus, Iapetus, Algenib, Rasalgethi. */
  geminiVoice: opt("GEMINI_VOICE", "Charon"),
  geminiStyle: opt(
    "GEMINI_STYLE",
    "deep cinematic documentary narrator, calm and suspenseful, natural American accent, slow on reveals, short pauses at each ellipsis",
  ),
  /** Offline voice used by --tts=kokoro (free, no key). am_onyx / am_michael / am_adam are deep male voices. */
  kokoroVoice: opt("KOKORO_VOICE", "am_onyx"),
  kokoroSpeed: Number(opt("KOKORO_SPEED", "0.95")),

  // Visuals: video = Gemini video clips (Veo), image = Gemini images + slow zoom, procedural = local fog test look
  visuals: opt("VISUALS", "video") as VisualsProvider,
  videoModel: opt("GEMINI_VIDEO_MODEL", "veo-3.1-fast-generate-preview"),
  videoResolution: opt("VIDEO_RESOLUTION", "720p"),
  imageModel: opt("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image"),
  /** When a video clip fails (quota, safety block, model retired), make an image for that shot instead. */
  fallbackToImage: opt("FALLBACK_TO_IMAGE", "true") === "true",

  // Upload
  uploadMode: opt("UPLOAD_MODE", "schedule") as "schedule" | "private" | "public",
  publishTime: opt("PUBLISH_TIME", "18:00"),
  publishUtcOffset: Number(opt("PUBLISH_UTC_OFFSET", "5")),

  // Output
  width: 1080,
  height: 1920,
  fps: 30,

  paths: {
    reels: path.join(ROOT, "data/reels"),
    history: path.join(ROOT, "data/history.json"),
    facts: path.join(ROOT, "series/facts.md"),
    plan: path.join(ROOT, "series/plan.md"),
    style: path.join(ROOT, "series/style.md"),
    fonts: path.join(ROOT, "assets/fonts"),
    kokoroScript: path.join(ROOT, "scripts/kokoro_tts.py"),
    kokoroModels: path.join(ROOT, ".cache/kokoro"),
    out: path.join(ROOT, "out"),
  },
};
