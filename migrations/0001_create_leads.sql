CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('booking', 'audit')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  brand_url TEXT DEFAULT '',
  revenue_tier TEXT DEFAULT '',
  bottleneck TEXT DEFAULT '',
  topic TEXT DEFAULT '',
  slot_date TEXT DEFAULT '',
  slot_time TEXT DEFAULT '',
  start_utc TEXT DEFAULT '',
  timezone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_kind ON leads (kind);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);
