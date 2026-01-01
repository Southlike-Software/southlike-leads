import { createChildLogger } from "../utils/logger";

const log = createChildLogger("rate-limiter");

type Source = "google_maps" | "website" | "linkedin" | "creci";

// Rate limits per source
const RATE_LIMITS: Record<
  Source,
  { minDelayMs: number; maxDelayMs: number; dailyLimit?: number }
> = {
  google_maps: { minDelayMs: 2000, maxDelayMs: 3000 },
  website: { minDelayMs: 1000, maxDelayMs: 2000 },
  linkedin: { minDelayMs: 10000, maxDelayMs: 15000, dailyLimit: 100 },
  creci: { minDelayMs: 2000, maxDelayMs: 3000 },
};

// Track request counts per source per day
const dailyCounts: Record<Source, { date: string; count: number }> = {
  google_maps: { date: "", count: 0 },
  website: { date: "", count: 0 },
  linkedin: { date: "", count: 0 },
  creci: { date: "", count: 0 },
};

const getToday = (): string => new Date().toISOString().slice(0, 10);

const resetDailyCountIfNeeded = (source: Source): void => {
  const today = getToday();
  if (dailyCounts[source].date !== today) {
    dailyCounts[source] = { date: today, count: 0 };
  }
};

export const canMakeRequest = (source: Source): boolean => {
  resetDailyCountIfNeeded(source);

  const limit = RATE_LIMITS[source].dailyLimit;
  if (limit && dailyCounts[source].count >= limit) {
    log.warn({ source, count: dailyCounts[source].count, limit }, "daily limit reached");
    return false;
  }

  return true;
};

export const recordRequest = (source: Source): void => {
  resetDailyCountIfNeeded(source);
  dailyCounts[source].count++;
};

export const getRandomDelay = (source: Source): number => {
  const { minDelayMs, maxDelayMs } = RATE_LIMITS[source];
  return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
};

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitForRateLimit = async (source: Source): Promise<void> => {
  const delay = getRandomDelay(source);
  log.debug({ source, delay }, "rate limit delay");
  await wait(delay);
};

export const getRemainingRequests = (source: Source): number | null => {
  resetDailyCountIfNeeded(source);
  const limit = RATE_LIMITS[source].dailyLimit;
  if (!limit) return null;
  return Math.max(0, limit - dailyCounts[source].count);
};

export const getDailyStats = (): Record<
  Source,
  { count: number; limit: number | null; remaining: number | null }
> => {
  const sources: Source[] = ["google_maps", "website", "linkedin", "creci"];
  return Object.fromEntries(
    sources.map((source) => {
      resetDailyCountIfNeeded(source);
      const limit = RATE_LIMITS[source].dailyLimit ?? null;
      return [
        source,
        {
          count: dailyCounts[source].count,
          limit,
          remaining: limit ? limit - dailyCounts[source].count : null,
        },
      ];
    })
  ) as Record<Source, { count: number; limit: number | null; remaining: number | null }>;
};

