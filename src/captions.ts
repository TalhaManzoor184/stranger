import type { Reel } from "./reel";
import type { Word } from "./voice";

/** ASS subtitle file: burned-in captions, hook, per-shot overlay text, CONFIRMED / FAN THEORY badges. */

const ts = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const esc = (t: string) => t.replace(/[{}]/g, "").replace(/\n/g, "\\N");

// &HAABBGGRR
const WHITE = "&H00FFFFFF";
const YELLOW = "&H0033D7FF";
const RED = "&H002A1FE0";
const GREEN = "&H004CAF2E";
const BLACK = "&H00000000";
const SHADOW = "&H96000000";

export function buildAss(reel: Reel, words: Word[], shotStarts: number[], end: number): string {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Anton,94,${WHITE},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,1,0,1,7,3,5,80,80,0,1
Style: Hook,Anton,132,${WHITE},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,2,0,1,9,4,8,70,70,300,1
Style: Overlay,Anton,112,${WHITE},${WHITE},${RED},${SHADOW},0,0,0,0,100,100,2,0,1,6,3,8,70,70,330,1
Style: BadgeTheory,Anton,54,${WHITE},${WHITE},${RED},${RED},0,0,0,0,100,100,3,0,3,14,0,8,70,70,500,1
Style: BadgeConfirmed,Anton,54,${WHITE},${WHITE},${GREEN},${GREEN},0,0,0,0,100,100,3,0,3,14,0,8,70,70,500,1
Style: Tag,Anton,40,&H00D0D0D0,&H00D0D0D0,${BLACK},${SHADOW},0,0,0,0,100,100,3,0,1,3,0,7,60,60,120,1
Style: Note,Anton,40,&H00E0E0E0,&H00E0E0E0,${BLACK},${SHADOW},0,0,0,0,100,100,1,0,1,4,0,2,90,90,560,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev: string[] = [];
  const add = (start: number, stop: number, style: string, text: string, layer = 0) =>
    ev.push(`Dialogue: ${layer},${ts(start)},${ts(stop)},${style},,0,0,0,,${text}`);

  add(0, end, "Tag", esc(`${reel.series.toUpperCase()} · PART ${reel.part}`));

  // Hook for the first ~2.2 s, then each shot's overlay + badge.
  const hookEnd = Math.min(2.3, (shotStarts[1] ?? end) - 0.2);
  add(0, hookEnd, "Hook", `{\\fad(120,150)\\t(0,300,\\fscx106\\fscy106)}${esc(reel.hook)}`, 2);
  reel.shots.forEach((shot, i) => {
    const s = i === 0 ? hookEnd + 0.1 : shotStarts[i] + 0.15;
    const e = (shotStarts[i + 1] ?? end) - 0.05;
    if (e - s < 0.4) return;
    if (shot.overlay) add(s, e, "Overlay", `{\\fad(150,120)}${esc(shot.overlay)}`, 2);
    if (shot.badge !== "NONE") {
      const style = shot.badge === "THEORY" ? "BadgeTheory" : "BadgeConfirmed";
      add(Math.max(i === 0 ? 0 : s, s), e, style, `{\\fad(150,120)} ${shot.badge === "THEORY" ? "FAN THEORY" : "CONFIRMED"} `, 3);
    }
  });
  if (reel.factNote) add(Math.max(0, end - 4), end, "Note", `{\\fad(200,0)}${esc(reel.factNote)}`, 2);

  // Captions: 3-word chunks centred at ~2/3 height, active word yellow.
  const Y = 1240;
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length === 3 || /[.,?!…]$/.test(w.text)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    chunk.forEach((w, j) => {
      const stop = j < chunk.length - 1 ? chunk[j + 1].start : Math.min(w.end + 0.25, end);
      const text = chunk
        .map((x, k) => {
          const t = esc(x.text.toUpperCase());
          return k === j ? `{\\c${YELLOW}}${t}{\\c${WHITE}}` : t;
        })
        .join(" ");
      add(w.start, stop, "Caption", `{\\an5\\pos(540,${Y})}${text}`, 1);
    });
  }
  return head + ev.join("\n") + "\n";
}
