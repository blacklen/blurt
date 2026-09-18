-- Every attempt you write, kept for good: the proof layer (clean rate, error
-- types, the archive). Mirrors the CREATE in server/server.js.
--
-- source: practice | replay | three | chat | write | free | react (and later ones)
-- tags:   comma-joined error tags (see ERROR_TAGS in app.js)
-- clean:  1 = needed no meaningful change, 0 = had a fix, NULL = never graded
-- conf:   'sure' | 'unsure' | NULL — how sure you felt before seeing the fix
-- pred:   1 = you predicted the fix, 0 = missed it, NULL = not played
CREATE TABLE IF NOT EXISTS attempts (
  id         TEXT PRIMARY KEY,
  d          TEXT NOT NULL,
  source     TEXT NOT NULL,
  kind       TEXT,
  prompt     TEXT,
  blurt      TEXT,
  fix        TEXT,
  natural    TEXT,
  note       TEXT,
  tags       TEXT,
  clean      INTEGER,
  conf       TEXT,
  pred       INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_d ON attempts(d);
CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts(created_at);
