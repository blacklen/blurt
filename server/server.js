'use strict';

/*
 * Blurt backend (Node + Express + SQLite) — single user.
 * One secret (APP_SECRET) logs you in from any device and unlocks your data
 * plus the Gemini/ntfy proxies. No accounts, no sign-up: same secret => same data.
 * This is the local-dev twin of the Cloudflare Worker in ../worker.
 */

const path = require('path');
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
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const nowIso = () => new Date().toISOString();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Gate every /api route on the single shared secret.
app.use('/api', (req, res, next) => {
  const m = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!APP_SECRET || !m || m[1].trim() !== APP_SECRET) return res.status(401).json({ error: 'unauthorized' });
  next();
});

app.get('/api/login', (req, res) => res.json({ ok: true }));

app.get('/api/kv/:key', (req, res) => {
  const row = db.prepare('SELECT value, updated_at FROM documents WHERE key = ?').get(req.params.key);
  res.json(row ? { value: row.value, updated_at: row.updated_at } : { value: null, updated_at: null });
});

app.put('/api/kv/:key', (req, res) => {
  const value = req.body && req.body.value;
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  const ts = nowIso();
  db.prepare(
    `INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(req.params.key, value, ts);
  res.json({ ok: true, updated_at: ts });
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

// Convenience: also serve the app itself at /blurt-standalone.html (same-origin, no CORS needed).
app.use(express.static(path.join(__dirname, '..')));

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
      body: '3 blurts + due chunks. ~5 minutes. No homework, no streak.',
    });
  } catch (e) {
    ntfyLastSent = null; // failed → let the next tick retry
  }
}
setInterval(fireDueReminder, 5 * 60 * 1000); // check a few times an hour
fireDueReminder();

app.listen(PORT, () => {
  console.log(`Blurt server listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  if (!APP_SECRET) console.warn('WARNING: APP_SECRET is not set — every /api request returns 401. Set it before use.');
});
