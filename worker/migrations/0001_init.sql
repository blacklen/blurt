-- Blurt schema (D1 / SQLite). Mirrors server/server.js so the Worker and the
-- local dev twin run the same shape of storage.
--
-- Why D1 and not KV: KV bills per operation (1,000 writes/day on the free plan)
-- and has no multi-get, so "one key per chunk" cost one request per chunk on
-- load and burned the daily write quota on a single drill session. D1 gives
-- 100,000 row writes/day, loads the whole bank in one query, and lets the cron
-- reminder ask for due chunks instead of parsing the entire bank.

-- Singleton JSON docs: 'blurt:state', 'blurt:aiPrompts', plus internal markers.
CREATE TABLE IF NOT EXISTS documents (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per chunk. `data` is the chunk JSON as the client already shapes it;
-- `due` and `ord` are lifted out as real columns so SQL can filter and order.
--
-- `ord` fixes array-position identity: the practice engine addresses chunks as
-- chunks[idx], so the array must rebuild in the same order on every device.
-- Migrated rows take their old blob position (0..N-1); new rows take Date.now(),
-- which is always larger, so they land after in creation order.
CREATE TABLE IF NOT EXISTS chunks (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  due        TEXT,
  ord        INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_due ON chunks(due);
CREATE INDEX IF NOT EXISTS idx_chunks_ord ON chunks(ord, id);
