import { z } from "zod";

/** CONFIRMED = official / reported fact. THEORY = fan claim or speculation. NONE = no badge. */
export const Badge = z.enum(["CONFIRMED", "THEORY", "NONE"]);
export type Badge = z.infer<typeof Badge>;

export const Shot = z.object({
  /** The part of the voiceover spoken over this shot. */
  vo: z.string().min(3),
  /** What to show. The vertical style block from series/style.md is added in front of it. */
  prompt: z.string().min(10),
  /** Big on-screen text for this shot (short, CAPS). Empty for none. */
  overlay: z.string().default(""),
  badge: Badge.default("NONE"),
});
export type Shot = z.infer<typeof Shot>;

export const Reel = z.object({
  id: z.string(),
  series: z.string().default("The Conformity Gate"),
  part: z.number().int().positive(),
  title: z.string().max(95),
  /** 0–2 s hook text shown over the first shot. */
  hook: z.string().max(40),
  shots: z.array(Shot).min(2).max(5),
  caption: z.string(),
  hashtags: z.array(z.string()).min(3).max(8),
  /** Optional on-screen fact-check line shown at the end. */
  factNote: z.string().optional(),
});
export type Reel = z.infer<typeof Reel>;

export const voiceText = (r: Reel) => r.shots.map((s) => s.vo.trim()).join(" ");
