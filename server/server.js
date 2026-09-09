'use strict';

/*
 * Blurt backend (Node + Express + SQLite) — single user.
 * One secret (APP_SECRET) logs you in from any device and unlocks your data
 * plus the Gemini/ntfy proxies. No accounts, no sign-up: same secret => same data.
 * This is the local-dev twin of the Cloudflare Worker in ../worker.
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 8787;
const DB_PATH = process.env.BLURT_DB || path.join(__dirname, 'blurt.db');
const APP_SECRET = process.env.APP_SECRET || '';
const GEMINI_KEY = process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// Same shape as the Worker's D1 schema (worker/migrations/0001_init.sql) so both
// backends store data identically. `ord` is the chunk's creation position: the
// practice engine addresses chunks[idx], so the array has to rebuild in a stable
// order on every load.
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    due        TEXT,
    ord        INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_due ON chunks(due);
  CREATE INDEX IF NOT EXISTS idx_chunks_ord ON chunks(ord, id);
`);

const nowIso = () => new Date().toISOString();

// Constant-time secret compare (length-guarded so timingSafeEqual won't throw).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// In-memory login brute-force throttle (the local twin of the Worker's KV counter).
// 10 failures in 10 min from one IP → blocked; the window resets once it lapses.
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginFails = new Map(); // ip -> { count, first }
function loginBlocked(ip) {
  const e = loginFails.get(ip);
  if (!e) return false;
  if (Date.now() - e.first > LOGIN_WINDOW_MS) { loginFails.delete(ip); return false; }
  return e.count >= LOGIN_MAX;
}
function noteLoginFailure(ip) {
  const now = Date.now();
  let e = loginFails.get(ip);
  if (!e || now - e.first > LOGIN_WINDOW_MS) { e = { count: 0, first: now }; loginFails.set(ip, e); }
  e.count++;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Gate every /api route on the single shared secret. The login endpoint is also
// brute-force throttled (failed attempts only, so normal use is unaffected).
app.use('/api', (req, res, next) => {
  const isLogin = req.method === 'GET' && req.path === '/login';
  if (isLogin && loginBlocked(req.ip)) return res.status(429).json({ error: 'too many attempts, try later' });
  const m = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!APP_SECRET || !m || !safeEqual(m[1].trim(), APP_SECRET)) {
    if (isLogin) noteLoginFailure(req.ip);
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.get('/api/login', (req, res) => res.json({ ok: true }));

app.get('/api/doc/:key', (req, res) => {
  const row = db.prepare('SELECT value, updated_at FROM documents WHERE key = ?').get(req.params.key);
  res.json(row ? { value: row.value, updated_at: row.updated_at } : { value: null, updated_at: null });
});

app.put('/api/doc/:key', (req, res) => {
  const value = req.body && req.body.value;
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  const ts = nowIso();
  db.prepare(
    `INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(req.params.key, value, ts);
  res.json({ ok: true, updated_at: ts });
});

app.delete('/api/doc/:key', (req, res) => {
  db.prepare('DELETE FROM documents WHERE key = ?').run(req.params.key);
  res.json({ ok: true });
});

/* ================= chunks ================= */

// The whole bank in one query, ordered so chunks[idx] means the same thing on
// every device. The Worker twin returns the identical shape.
app.get('/api/chunks', (req, res) => {
  const rows = db.prepare('SELECT id, data FROM chunks ORDER BY ord ASC, id ASC').all();
  const chunks = [];
  for (const row of rows) {
    try {
      const c = JSON.parse(row.data);
      c.id = row.id;
      chunks.push(c);
    } catch (e) {
      /* skip a corrupt row rather than failing the whole load */
    }
  }
  res.json({ chunks });
});

// Batch upsert. ON CONFLICT leaves `ord` alone so editing a chunk never moves it.
const upsertChunk = () =>
  db.prepare(
    `INSERT INTO chunks (id, data, due, ord, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, due = excluded.due, updated_at = excluded.updated_at`
  );

app.put('/api/chunks', (req, res) => {
  const list = req.body && Array.isArray(req.body.chunks) ? req.body.chunks : null;
  if (!list) return res.status(400).json({ error: 'chunks must be an array' });
  if (list.some((c) => !c || typeof c.id !== 'string' || !c.id))
    return res.status(400).json({ error: 'every chunk needs a string id' });
  const ts = nowIso();
  const base = Date.now();
  const stmt = upsertChunk();
  db.transaction(() => {
    list.forEach((c, i) => stmt.run(c.id, JSON.stringify(c), c.due || null, base + i, ts));
  })();
  res.json({ ok: true, saved: list.length, updated_at: ts });
});

app.delete('/api/chunks/:id', (req, res) => {
  db.prepare('DELETE FROM chunks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Proxy a Gemini generateContent call, injecting the server-side key.
app.post('/api/ai', async (req, res) => {
  if (!GEMINI_KEY) return res.status(503).json({ error: 'AI not configured (set GEMINI_KEY)' });
  const model = (req.body && req.body.model) || GEMINI_MODEL;
  const payload = req.body && req.body.body;
  if (!payload) return res.status(400).json({ error: 'missing body' });
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) +
        ':generateContent?key=' +
        encodeURIComponent(GEMINI_KEY),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const text = await r.text();
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
});

// Proxy an ntfy notification, injecting the server-side topic.
app.post('/api/notify', async (req, res) => {
  if (!NTFY_TOPIC) return res.status(503).json({ error: 'notify not configured (set NTFY_TOPIC)' });
  const b = req.body || {};
  const headers = { 'X-Title': b.title || 'Blurt', 'X-Tags': b.tags || 'books' };
  if (b.delay) headers['X-Delay'] = String(b.delay);
  try {
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(NTFY_TOPIC), {
      method: 'POST',
      headers,
      body: String(b.message || ''),
    });
    if (!r.ok) return res.status(502).json({ error: 'ntfy responded ' + r.status });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
});

// Convenience: also serve the app itself from worker/public/ (same-origin, no CORS needed).
app.use(express.static(path.join(__dirname, '../worker/public')));

// Local twin of the Worker cron: send the one daily homework ping when the
// current hour matches the user's chosen time. The server owning the schedule
// (rather than pre-queuing un-cancellable ntfy X-Delay messages) is what keeps
// changing the reminder time from producing duplicate pings.
let ntfyLastSent = null;
async function fireDueReminder() {
  if (!NTFY_TOPIC) return;
  const row = db.prepare('SELECT value FROM documents WHERE key = ?').get('blurt:state');
  if (!row) return;
  let ntfy;
  try {
    ntfy = JSON.parse(row.value).ntfy;
  } catch (e) {
    return;
  }
  if (!ntfy || !ntfy.on) return;
  const off = Number(ntfy.tzOffset) || 0; // minutes the user's clock is behind UTC
  const local = new Date(Date.now() - off * 60000);
  if (local.getUTCHours() !== Number(ntfy.hour)) return;
  const today = local.toISOString().slice(0, 10);
  if (ntfyLastSent === today) return; // already sent today
  ntfyLastSent = today;
  try {
    await fetch('https://ntfy.sh/' + encodeURIComponent(NTFY_TOPIC), {
      method: 'POST',
      headers: { 'X-Title': 'Blurt homework ⏰', 'X-Tags': 'books' },
      body: reminderBody(today),
    });
  } catch (e) {
    ntfyLastSent = null; // failed → let the next tick retry
  }
}
// Name an actual due chunk in the ping so it's useful at a glance.
function reminderBody(today) {
  const generic = '3 blurts + due chunks. ~5 minutes. No homework, no streak.';
  try {
    const row = db.prepare('SELECT value FROM documents WHERE key = ?').get('blurt:chunks');
    if (!row) return generic;
    const arr = JSON.parse(row.value);
    const due = Array.isArray(arr) ? arr.filter((c) => c && c.due && c.due <= today) : [];
    if (!due.length) return generic;
    const pick = due[Math.floor(Math.random() * due.length)];
    return due.length + ' chunk' + (due.length > 1 ? 's' : '') + ' due + 3 blurts (~5 min). First up: “' + pick.chunk + '”';
  } catch (e) {
    return generic;
  }
}
setInterval(fireDueReminder, 5 * 60 * 1000); // check a few times an hour
fireDueReminder();

app.listen(PORT, () => {
  console.log(`Blurt server listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  if (!APP_SECRET) console.warn('WARNING: APP_SECRET is not set — every /api request returns 401. Set it before use.');
});
