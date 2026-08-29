-- Server Studio usage counter — D1 schema.
CREATE TABLE IF NOT EXISTS events (
  id    TEXT    NOT NULL,   -- random anonymous per-install id
  event TEXT    NOT NULL,   -- 'install' | 'start' | 'uninstall'
  v     TEXT,               -- app version
  os    TEXT,               -- darwin | win32 | linux | other
  arch  TEXT,               -- x64 | arm64 | ...
  node  TEXT,               -- node major version
  day   TEXT    NOT NULL,   -- YYYY-MM-DD (UTC)
  ts    INTEGER NOT NULL    -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
CREATE INDEX IF NOT EXISTS idx_events_day   ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_id    ON events(id);

-- Opt-in email signups (people who typed their address into the dashboard).
CREATE TABLE IF NOT EXISTS emails (
  email TEXT    NOT NULL UNIQUE,  -- one row per address; signing up twice is a no-op
  v     TEXT,
  os    TEXT,
  day   TEXT    NOT NULL,
  ts    INTEGER NOT NULL
);

-- Feature requests and messages. Deliberately NOT unique on email: a person can
-- send as many as they like, and the second one must not be silently dropped the
-- way the UNIQUE index on emails would do.
CREATE TABLE IF NOT EXISTS requests (
  email   TEXT    NOT NULL,
  message TEXT    NOT NULL,
  v       TEXT,
  os      TEXT,
  day     TEXT    NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_ts    ON requests(ts);
CREATE INDEX IF NOT EXISTS idx_requests_email ON requests(email);
