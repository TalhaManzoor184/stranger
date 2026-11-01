/** True for errors that usually go away on their own: overload, server errors, network blips. */
export function isTransient(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  const status = e?.status ?? e?.code;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(e?.message ?? err);
  if (/\b(503|UNAVAILABLE|high demand|overloaded|ECONNRESET|ETIMEDOUT|fetch failed)\b/i.test(msg)) return true;
  // Per-minute rate limits clear quickly; per-day quota ("per day", "retry in 19h") does not.
  if ((status === 429 || /\b429\b/.test(msg)) && !/per day|requests per day|retry in \d+h/i.test(msg)) return true;
  return false;
}

/** True when a model's quota is used up (per-day or per-minute). Another model has its own quota. */
export function isQuota(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  const msg = String(e?.message ?? err);
  return e?.status === 429 || e?.code === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
}

/** Worth switching to the fallback model: overloaded, or this model's quota is used up. */
export function shouldFallBack(err: unknown): boolean {
  return isTransient(err) || isQuota(err);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry `fn` on transient errors with backoff: 15 s, 30 s, 60 s, 120 s. */
export async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries || !isTransient(err)) throw err;
      const wait = 15_000 * 2 ** (attempt - 1);
      console.warn(`  ${label}: ${String((err as Error)?.message ?? err).slice(0, 160)} — retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}
