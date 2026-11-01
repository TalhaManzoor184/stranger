import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const run = promisify(execFile);

export async function ffmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 64 * 1024 * 1024 });
}

export async function durationOf(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(stdout.trim());
}

/** Any TTS output → 44.1 kHz mono WAV, edge silence trimmed, loudness levelled for reels. */
export async function toVoiceWav(input: string, output: string): Promise<void> {
  await ffmpeg([
    "-i", input,
    "-af", [
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05",
      "areverse",
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1",
      "areverse",
      "loudnorm=I=-15:TP=-1.5:LRA=9",
    ].join(","),
    "-ar", "44100", "-ac", "1", output,
  ]);
}

type Silence = { start: number; end: number };

export async function findSilences(file: string, minDur = 0.18): Promise<Silence[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=-36dB:d=${minDur}`, "-f", "null", "-"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const out: Silence[] = [];
  let start: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") start = Math.max(0, Number(m[2]));
    else if (start !== null) {
      out.push({ start, end: Number(m[2]) });
      start = null;
    }
  }
  return out;
}
