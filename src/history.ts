import fs from "node:fs/promises";
import { config } from "./config";

export type HistoryEntry = {
  date: string;
  reelId: string;
  title: string;
  videoId?: string;
  publishAt?: string;
};

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(await fs.readFile(config.paths.history, "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const all = await loadHistory();
  all.push(entry);
  await fs.writeFile(config.paths.history, JSON.stringify(all, null, 2) + "\n");
}

/** Today's date in Pakistan time, YYYY-MM-DD. */
export function todayPk(now = new Date()): string {
  return new Date(now.getTime() + config.publishUtcOffset * 3600_000).toISOString().slice(0, 10);
}
