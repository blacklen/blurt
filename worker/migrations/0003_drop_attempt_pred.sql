-- Drop `pred` (the "predict the fix" score from 0002): the feature is gone from
-- the app, so nothing writes or reads the column any more. Mirrors the CREATE in
-- server/server.js, which no longer declares it.
--
-- Deploy the Worker BEFORE applying this: a Worker still listing `pred` in its
-- INSERT would fail once the column is missing. A client that still sends `pred`
-- is harmless — the new Worker ignores fields outside ATTEMPT_COLS.
ALTER TABLE attempts DROP COLUMN pred;
