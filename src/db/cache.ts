import { Database } from "bun:sqlite";
import type { CacheEntry, ScrapeJob } from "../schemas";

type CacheSource = "google_maps" | "website" | "linkedin" | "creci";

// Cache TTL in hours per source
const CACHE_TTL: Record<CacheSource, number> = {
  google_maps: 24 * 7, // 7 days
  website: 24 * 3, // 3 days
  linkedin: 24 * 7, // 7 days
  creci: 24 * 30, // 30 days
};

export const getCacheEntry = <T>(
  db: Database,
  source: CacheSource,
  lookupKey: string
): T | null => {
  const stmt = db.prepare(`
    SELECT data FROM scrape_cache
    WHERE source = ? AND lookup_key = ? AND expires_at > datetime('now')
  `);

  const result = stmt.get(source, lookupKey) as { data: string } | null;
  if (!result) return null;

  try {
    return JSON.parse(result.data) as T;
  } catch {
    return null;
  }
};

export const setCacheEntry = (
  db: Database,
  source: CacheSource,
  lookupKey: string,
  data: unknown
): void => {
  const ttlHours = CACHE_TTL[source];
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO scrape_cache (source, lookup_key, data, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (source, lookup_key) DO UPDATE SET
      data = excluded.data,
      expires_at = excluded.expires_at,
      created_at = datetime('now')
  `);

  stmt.run(source, lookupKey, JSON.stringify(data), expiresAt);
};

export const invalidateCache = (
  db: Database,
  source?: CacheSource,
  lookupKey?: string
): number => {
  if (source && lookupKey) {
    const stmt = db.prepare(
      `DELETE FROM scrape_cache WHERE source = ? AND lookup_key = ?`
    );
    return stmt.run(source, lookupKey).changes;
  } else if (source) {
    const stmt = db.prepare(`DELETE FROM scrape_cache WHERE source = ?`);
    return stmt.run(source).changes;
  } else {
    const stmt = db.prepare(`DELETE FROM scrape_cache`);
    return stmt.run().changes;
  }
};

export const clearExpiredCache = (db: Database): number => {
  const stmt = db.prepare(
    `DELETE FROM scrape_cache WHERE expires_at < datetime('now')`
  );
  return stmt.run().changes;
};

// Scrape job management
export const createScrapeJob = (
  db: Database,
  source: CacheSource,
  target: string
): number => {
  const stmt = db.prepare(`
    INSERT INTO scrape_jobs (source, target, status)
    VALUES (?, ?, 'pending')
    RETURNING id
  `);

  const result = stmt.get(source, target) as { id: number };
  return result.id;
};

export const updateScrapeJobStatus = (
  db: Database,
  jobId: number,
  status: ScrapeJob["status"],
  checkpoint?: string,
  error?: string
): void => {
  const stmt = db.prepare(`
    UPDATE scrape_jobs
    SET status = ?, checkpoint = ?, error = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  stmt.run(status, checkpoint ?? null, error ?? null, jobId);
};

export const getPendingJobs = (
  db: Database,
  source?: CacheSource
): ScrapeJob[] => {
  if (source) {
    const stmt = db.prepare(`
      SELECT * FROM scrape_jobs
      WHERE source = ? AND status IN ('pending', 'in_progress')
      ORDER BY created_at
    `);
    return stmt.all(source) as ScrapeJob[];
  }

  const stmt = db.prepare(`
    SELECT * FROM scrape_jobs
    WHERE status IN ('pending', 'in_progress')
    ORDER BY created_at
  `);
  return stmt.all() as ScrapeJob[];
};

export const getJobByTarget = (
  db: Database,
  source: CacheSource,
  target: string
): ScrapeJob | null => {
  const stmt = db.prepare(`
    SELECT * FROM scrape_jobs
    WHERE source = ? AND target = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get(source, target) as ScrapeJob | null;
};

export const getCacheStats = (
  db: Database
): {
  total_entries: number;
  by_source: Record<string, number>;
  expired_count: number;
} => {
  const total = db
    .prepare(`SELECT COUNT(*) as count FROM scrape_cache`)
    .get() as { count: number };

  const bySource = db
    .prepare(`SELECT source, COUNT(*) as count FROM scrape_cache GROUP BY source`)
    .all() as { source: string; count: number }[];

  const expired = db
    .prepare(
      `SELECT COUNT(*) as count FROM scrape_cache WHERE expires_at < datetime('now')`
    )
    .get() as { count: number };

  return {
    total_entries: total.count,
    by_source: Object.fromEntries(bySource.map((r) => [r.source, r.count])),
    expired_count: expired.count,
  };
};

