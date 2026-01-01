import { Database } from "bun:sqlite";

const SCHEMA_SQL = `
-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  name TEXT NOT NULL,
  google_place_id TEXT UNIQUE,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  rating REAL,
  review_count INTEGER,
  creci_number TEXT,
  creci_verified INTEGER DEFAULT 0,
  social_instagram TEXT,
  social_facebook TEXT,
  social_linkedin TEXT,
  source TEXT NOT NULL CHECK (source IN ('google_maps', 'website', 'linkedin', 'manual')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Decision makers table
CREATE TABLE IF NOT EXISTS decision_makers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('website', 'linkedin', 'manual')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Interactions table
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  decision_maker_id TEXT REFERENCES decision_makers(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'phone', 'linkedin', 'meeting', 'note')),
  notes TEXT,
  outcome TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pipeline status table
CREATE TABLE IF NOT EXISTS pipeline_status (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  company_id TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  last_contact TEXT,
  next_step TEXT,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Cache table for scraper results
CREATE TABLE IF NOT EXISTS scrape_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('google_maps', 'website', 'linkedin', 'creci')),
  lookup_key TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (source, lookup_key)
);

-- Scrape jobs table for resumability
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('google_maps', 'website', 'linkedin', 'creci')),
  target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  retry_count INTEGER DEFAULT 0,
  checkpoint TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_google_place_id ON companies(google_place_id);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_decision_makers_company_id ON decision_makers(company_id);
CREATE INDEX IF NOT EXISTS idx_interactions_company_id ON interactions(company_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_status_company_id ON pipeline_status(company_id);
CREATE INDEX IF NOT EXISTS idx_scrape_cache_lookup ON scrape_cache(source, lookup_key);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
`;

export const initDatabase = (dbPath = "data/leads.db"): Database => {
  // Ensure data directory exists
  const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  if (dir) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  return db;
};

export const closeDatabase = (db: Database): void => {
  db.close();
};

