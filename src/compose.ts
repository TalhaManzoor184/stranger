import fs from "node:fs/promises";
import path from "node:path";
import { buildAss } from "./captions";
import { config } from "./config";
import { durationOf, ffmpeg } from "./media";
import type { Reel } from "./reel";
import type { ShotSource } from "./visuals";
import type { Voiced } from "./voice";

const { width: W, height: H, fps: FPS } = config;
const TAIL = 1.2; // seconds of picture after the last word

/** Shot start times and lengths, cut in the pause between voice lines. */
export function shotTiming(v: Voiced): { starts: number[]; durations: number[]; end: number } {
  const end = v.duration + TAIL;
  const starts = [0, ...v.shotEnds.slice(0, -1).map((t) => t + 0.12)];
  const durations = starts.map((s, i) => (starts[i + 1] ?? end) - s);
  return { starts, durations, end };
}

const GRADE = "eq=contrast=1.08:saturation=0.82:gamma=0.97,colorbalance=rs=0.03:bs=0.03:rh=0.02,vignette=PI/5,noise=alls=4:allf=t";

async function normaliseShot(src: ShotSource, seconds: number, out: string, first: boolean): Promise<void> {
  const frames = Math.round(seconds * FPS);
  const fadeIn = `fade=t=in:st=0:d=${first ? 0.35 : 0.12}`;
  let vf: string;
  let input: string[];
  if (src.kind === "image") {
    // Slow push-in (Ken Burns) over the whole shot.
    input = ["-loop", "1", "-i", src.path];
    vf = [
      `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2}`,
      `zoompan=z='1+0.18*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    ].join(",");
  } else {
    input = ["-i", src.path];
    const srcDur = await durationOf(src.path);
    // Stretch a short clip up to 1.35x slower, then hold the last frame if still short.
    const slow = Math.min(Math.max(seconds / Math.max(srcDur, 0.1), 1), 1.35);
    vf = [
      `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
      `setpts=${slow.toFixed(3)}*PTS`,
      `fps=${FPS}`,
      `tpad=stop_mode=clone:stop_duration=${seconds}`,
    ].join(",");
  }
  await ffmpeg([
    ...input,
    "-vf", `${vf},${GRADE},${fadeIn},format=yuv420p`,
    "-frames:v", String(frames),
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(FPS),
    out,
  ]);
}

/** Low synth drone + a sub "boom" on each cut. Generated locally, no music licence needed. */
async function makeBed(seconds: number, cuts: number[], workDir: string): Promise<string> {
  const drone = path.join(workDir, "drone.wav");
  await ffmpeg([
    "-f", "lavfi", "-i", `sine=f=55:d=${seconds}`,
    "-f", "lavfi", "-i", `sine=f=82.41:d=${seconds}`,
    "-f", "lavfi", "-i", `anoisesrc=color=brown:d=${seconds}:a=0.5`,
    "-filter_complex",
    `[0]volume=0.5[a];[1]volume=0.25,tremolo=f=0.18:d=0.6[b];[2]lowpass=f=300,volume=0.35[c];` +
      `[a][b][c]amix=inputs=3:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, seconds - 1.5)}:d=1.5,volume=0.22[out]`,
    "-map", "[out]", "-ar", "44100", "-ac", "2", drone,
  ]);
  const boom = path.join(workDir, "boom.wav");
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=f=42:d=1.4",
    "-f", "lavfi", "-i", "anoisesrc=color=pink:d=0.25:a=0.6",
    "-filter_complex", "[0]volume='exp(-2.6*t)':eval=frame[s];[1]lowpass=f=900,afade=t=out:d=0.25[n];[s][n]amix=inputs=2:normalize=0,volume=0.9[o]",
    "-map", "[o]", "-ar", "44100", "-ac", "2", boom,
  ]);
  const bed = path.join(workDir, "bed.wav");
  const hits = cuts.map((t, i) => `[${i + 1}]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[h${i}]`).join(";");
  const mix = `[0]${cuts.map((_, i) => `[h${i}]`).join("")}amix=inputs=${cuts.length + 1}:normalize=0:duration=first[out]`;
  await ffmpeg(["-i", drone, ...cuts.flatMap(() => ["-i", boom]), "-filter_complex", `${hits ? hits + ";" : ""}${mix}`, "-map", "[out]", bed]);
  return bed;
}

export async function composeReel(reel: Reel, voice: Voiced, sources: ShotSource[], workDir: string): Promise<string> {
  const { starts, durations, end } = shotTiming(voice);

  const shotFiles: string[] = [];
  for (const [i, src] of sources.entries()) {
    const out = path.join(workDir, `shot-${i}.mp4`);
    await normaliseShot(src, durations[i], out, i === 0);
    shotFiles.push(out);
  }
  const list = path.join(workDir, "shots.txt");
  await fs.writeFile(list, shotFiles.map((f) => `file '${f}'`).join("\n") + "\n");
  const video = path.join(workDir, "video.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);

  const ass = path.join(workDir, "captions.ass");
  await fs.writeFile(ass, buildAss(reel, voice.words, starts, end));

  const bed = await makeBed(end, starts.slice(1), workDir);
  const out = path.join(workDir, "reel.mp4");
  const assArg = `ass='${ass.replace(/'/g, "\\'")}':fontsdir='${config.paths.fonts}'`;
  await ffmpeg([
    "-i", video, "-i", voice.wavPath, "-i", bed,
    "-filter_complex",
    `[0:v]${assArg},fade=t=out:st=${(end - 0.5).toFixed(2)}:d=0.5[v];` +
      `[1:a]aformat=channel_layouts=stereo,apad[vo];[vo][2:a]amix=inputs=2:normalize=0:duration=longest,` +
      `atrim=0:${end.toFixed(2)},afade=t=out:st=${(end - 0.6).toFixed(2)}:d=0.6,alimiter=limit=0.95[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-t", end.toFixed(2),
    out,
  ]);
  return out;
}
