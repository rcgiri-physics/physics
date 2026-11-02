-- Cloudflare D1 database for the site's small dynamic parts. Apply with:
--   npx wrangler d1 execute physics-decoded --remote --file=worker/schema.sql
-- Everything still works without it (reports and messages are then refused politely,
-- events are dropped), so the static site never depends on the database.

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  page TEXT NOT NULL,
  title TEXT,
  item TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'          -- open | done
);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS messages_status ON messages (status, created_at);

-- Anonymous daily counters: (day, event, key) -> count. No visitor identifiers are stored.
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, key)
);

-- Rate limits for forms and admin logins: a daily-rotating hash, deleted after a day.
CREATE TABLE IF NOT EXISTS hits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_key ON hits (key, at);

-- Admin activity log (who saved, deleted or signed in), kept 180 days.
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT
);
