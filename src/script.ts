import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { config, req } from "./config";
import type { HistoryEntry } from "./history";
import { Reel } from "./reel";
import { shouldFallBack, withRetry } from "./retry";

async function loadQueued(): Promise<Reel[]> {
  const files = (await fs.readdir(config.paths.reels)).filter((f) => f.endsWith(".json")).sort();
  const reels: Reel[] = [];
  for (const f of files) {
    const parsed = Reel.safeParse(JSON.parse(await fs.readFile(path.join(config.paths.reels, f), "utf8")));
    if (!parsed.success) throw new Error(`data/reels/${f} is not a valid reel: ${parsed.error.message}`);
    reels.push(parsed.data);
  }
  return reels.sort((a, b) => a.part - b.part);
}

/** A specific reel by id, the next unposted hand-written reel, or a new one written by Gemini. */
export async function pickReel(history: HistoryEntry[], reelId?: string): Promise<Reel> {
  const queued = await loadQueued();
  if (reelId) {
    const r = queued.find((q) => q.id === reelId || String(q.part) === reelId);
    if (!r) throw new Error(`No reel "${reelId}" in data/reels.`);
    return r;
  }
  const done = new Set(history.map((h) => h.reelId));
  const next = queued.find((q) => !done.has(q.id));
  if (next) return next;
  return writeReel(queued);
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "YouTube title, max 90 chars, ends with ' | Conformity Gate Part N'" },
    hook: { type: "string", description: "2-6 word CAPS hook shown in the first 2 seconds" },
    shots: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          vo: { type: "string", description: "Voiceover for this shot, 15-28 words" },
          prompt: { type: "string", description: "Original visual for an 8-second vertical AI video clip. No real people, no show scenes, no logos." },
          overlay: { type: "string", description: "1-4 word CAPS on-screen text" },
          badge: { type: "string", enum: ["CONFIRMED", "THEORY", "NONE"] },
        },
        required: ["vo", "prompt", "overlay", "badge"],
      },
    },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 6 },
    topic: { type: "string", description: "The plan topic this reel covers, copied exactly" },
  },
  required: ["title", "hook", "shots", "caption", "hashtags", "topic"],
};

async function writeReel(existing: Reel[]): Promise<Reel> {
  const [facts, plan] = await Promise.all([fs.readFile(config.paths.facts, "utf8"), fs.readFile(config.paths.plan, "utf8")]);
  const part = Math.max(0, ...existing.map((r) => r.part)) + 1;
  const prompt = `You write 20-28 second vertical reels for a faceless YouTube channel that explains the Stranger Things
"Conformity Gate" fan theory. Tone: cinematic documentary, suspense, curiosity gaps, natural spoken English.

RULES
- State as fact ONLY what is in the "Confirmed" list of the fact sheet. Never invent plot details, quotes, dates or numbers.
- Fan claims must be spoken as claims ("fans claim", "the theory says") and their shot badge is THEORY.
- A shot that only states confirmed facts gets CONFIRMED; transitions get NONE.
- Total voiceover 55-70 words across exactly 3 shots. Shot 1 opens with a hook. Shot 3 ends on a cliffhanger into the next part.
- Visual prompts are original atmospheric scenes (1980s small town, fog, forests, labs). No actors, characters, logos or recreated Netflix scenes.

FACT SHEET
${facts}

SERIES PLAN (pick the first topic not covered yet)
${plan}

ALREADY POSTED (titles)
${existing.map((r) => `- ${r.title}`).join("\n")}

This is Part ${part}. Return JSON matching the schema.`;

  const ai = new GoogleGenAI({ apiKey: req("GEMINI_API_KEY") });
  const call = (model: string) =>
    withRetry(`script (${model})`, () =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.9 },
      }),
    );
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await call(config.textModel);
    } catch (err) {
      if (!shouldFallBack(err) || !config.textFallback) throw err;
      console.warn(`  ${config.textModel} unavailable; using ${config.textFallback}`);
      res = await call(config.textFallback);
    }
    const raw = JSON.parse(res.text ?? "{}");
    const reel = Reel.safeParse({ ...raw, id: `auto-${String(part).padStart(3, "0")}`, part, series: "The Conformity Gate" });
    if (reel.success) {
      await fs.writeFile(path.join(config.paths.reels, `${reel.data.id}.json`), JSON.stringify(reel.data, null, 2) + "\n");
      return reel.data;
    }
    console.warn(`  Script attempt ${attempt} invalid: ${reel.error.message.slice(0, 200)}`);
  }
  throw new Error("Gemini did not return a valid reel after 3 tries.");
}
