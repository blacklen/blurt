'use strict';

/*
 * Blurt backend (Cloudflare Worker + D1) — single user.
 * One secret (APP_SECRET) logs you in from any device and unlocks your data
 * plus the Gemini/ntfy proxies. No accounts, no sign-up: same secret => same data.
 *
 * Storage (binding: BLURT_DB, schema in ../migrations/0001_init.sql):
 *   documents(key, value, updated_at)        -- 'blurt:state', 'blurt:aiPrompts'
 *   chunks(id, data, due, ord, updated_at)   -- one row per chunk
 *
 * KV (binding: BLURT_KV) is kept only for two TTL counters — the login throttle
 * and the daily-reminder marker — plus reading the pre-D1 data once to migrate it.
 *
 * Why the move off KV: KV bills per operation (1,000 writes/day free) and has no
 * multi-get, so a key-per-chunk layout cost one request per chunk on load and one
 * write per graded rep. D1 is 100,000 row writes/day, loads the bank in a single
 * query, and can answer "what's due" in SQL instead of parsing the whole bank.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// D1 free-plan ceilings that shape every bulk write below: at most 100 bound
// parameters in one query, and at most 50 queries per Worker invocation.
const CHUNK_COLS = 5; // id, data, due, ord, updated_at
const ROWS_PER_STMT = Math.floor(100 / CHUNK_COLS); // 20
const MAX_STMTS = 25; // leaves headroom under the 50-query ceiling
const MAX_ROWS_PER_REQUEST = ROWS_PER_STMT * MAX_STMTS; // 500

// Constant-time string compare so a wrong secret can't be narrowed down by timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True only if the request carries the correct secret.
function authed(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return !!(env.APP_SECRET && m && safeEqual(m[1].trim(), env.APP_SECRET));
}

// Login brute-force throttle: a KV counter keyed by client IP, written only on a
// failed login, so the happy path stays free. 10 failures in 10 min → blocked.
const LOGIN_MAX = 10;
const LOGIN_WINDOW = 600; // seconds
async function loginBlocked(env, ip) {
  if (!env.BLURT_KV) return false;
  return (Number(await env.BLURT_KV.get('login:fail:' + ip)) || 0) >= LOGIN_MAX;
}
async function noteLoginFailure(env, ip) {
  if (!env.BLURT_KV) return;
  const key = 'login:fail:' + ip;
  const n = (Number(await env.BLURT_KV.get(key)) || 0) + 1;
  await env.BLURT_KV.put(key, String(n), { expirationTtl: LOGIN_WINDOW }); // count decays after the window
}

/* ================= documents (singleton JSON blobs) ================= */

async function getDoc(env, key) {
  const row = await env.BLURT_DB.prepare('SELECT value, updated_at FROM documents WHERE key = ?')
    .bind(key)
    .first();
  if (!row) return json({ value: null, updated_at: null });
  return json({ value: row.value, updated_at: row.updated_at });
}

async function putDoc(req, env, key) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (!body || typeof body.value !== 'string') return json({ error: 'value must be a string' }, 400);
  const updated_at = new Date().toISOString();
  await setDoc(env, key, body.value, updated_at);
  return json({ ok: true, updated_at });
}

function setDoc(env, key, value, updated_at) {
  return env.BLURT_DB.prepare(
    `INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, value, updated_at || new Date().toISOString())
    .run();
}

async function readDoc(env, key) {
  const row = await env.BLURT_DB.prepare('SELECT value FROM documents WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

/* ================= chunks ================= */

// Rebuild the client's array in a stable order: ord is the chunk's creation
// position, id breaks ties. The practice engine addresses chunks[idx], so this
// order has to come back identical on every device and every load.
async function listChunks(env) {
  const { results } = await env.BLURT_DB.prepare(
    'SELECT id, data FROM chunks ORDER BY ord ASC, id ASC'
  ).all();
  const out = [];
  for (const row of results || []) {
    try {
      const c = JSON.parse(row.data);
      c.id = row.id; // the row id always wins over whatever the blob carried
      out.push(c);
    } catch (e) {
      /* skip a corrupt row rather than failing the whole load */
    }
  }
  return out;
}

// Upsert a batch of chunks in as few queries as possible: rows are packed
// ROWS_PER_STMT at a time to stay inside D1's 100-bound-parameter limit, and the
// statements go up as one batch. ON CONFLICT deliberately leaves `ord` alone so
// editing a chunk never moves it in the array.
async function upsertChunks(env, list, nowIso) {
  const stmts = [];
  const base = Date.now();
  for (let i = 0; i < list.length; i += ROWS_PER_STMT) {
    const page = list.slice(i, i + ROWS_PER_STMT);
    const binds = [];
    page.forEach((c, j) => {
      binds.push(c.id, JSON.stringify(c), c.due || null, base + i + j, nowIso);
    });
    const values = page.map(() => '(?, ?, ?, ?, ?)').join(', ');
    stmts.push(
      env.BLURT_DB.prepare(
        `INSERT INTO chunks (id, data, due, ord, updated_at) VALUES ${values}
         ON CONFLICT(id) DO UPDATE SET
           data = excluded.data, due = excluded.due, updated_at = excluded.updated_at`
      ).bind(...binds)
    );
  }
  if (stmts.length) await env.BLURT_DB.batch(stmts);
}

async function putChunks(req, env) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'invalid JSON' }, 400);
  }
  const list = body && Array.isArray(body.chunks) ? body.chunks : null;
  if (!list) return json({ error: 'chunks must be an array' }, 400);
  const bad = list.find((c) => !c || typeof c.id !== 'string' || !c.id);
  if (bad !== undefined) return json({ error: 'every chunk needs a string id' }, 400);
  // The client pages to this size; refusing beyond it keeps us under D1's
  // per-invocation query ceiling instead of silently dropping the tail.
  if (list.length > MAX_ROWS_PER_REQUEST)
    return json({ error: 'too many chunks in one request (max ' + MAX_ROWS_PER_REQUEST + ')' }, 413);
  const updated_at = new Date().toISOString();
  await upsertChunks(env, list, updated_at);
  return json({ ok: true, saved: list.length, updated_at });
}

/* ================= one-time migration off KV ================= */

const MIGRATED_KEY = '_kv_migrated';
const MIGRATE_POS_KEY = '_kv_migrate_pos';

// Read a pre-D1 KV doc. They were stored as { value, updated_at } where `value`
// is itself a JSON string, so this returns the inner string.
async function kvDocValue(env, key) {
  if (!env.BLURT_KV) return null;
  const raw = await env.BLURT_KV.get('doc:' + key);
  if (raw == null) return null;
  try {
    const doc = JSON.parse(raw);
    return typeof doc.value === 'string' ? doc.value : raw;
  } catch (e) {
    return raw; // very old rows were stored bare
  }
}

// Collect the full pre-D1 chunk array from whichever KV layout is in place: the
// original single blob, or the later index + one-doc-per-chunk split.
async function kvChunkIds(env) {
  const idxRaw = await kvDocValue(env, 'blurt:chunk-index');
  if (idxRaw) {
    try {
      const ids = JSON.parse(idxRaw);
      if (Array.isArray(ids)) return { layout: 'split', ids };
    } catch (e) {}
  }
  const blobRaw = await kvDocValue(env, 'blurt:chunks');
  if (blobRaw) {
    try {
      const arr = JSON.parse(blobRaw);
      if (Array.isArray(arr)) return { layout: 'blob', arr };
    } catch (e) {}
  }
  return { layout: 'none' };
}

function newChunkId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Import KV data into D1, at most MAX_ROWS_PER_REQUEST chunks per call so a big
// bank can't blow D1's per-invocation query ceiling. Progress is recorded in
// `documents`, so the client just calls back until `done` comes back true.
async function migrateFromKv(env) {
  if (await readDoc(env, MIGRATED_KEY)) return { done: true, imported: 0, total: 0 };
  if (!env.BLURT_KV) {
    await setDoc(env, MIGRATED_KEY, new Date().toISOString());
    return { done: true, imported: 0, total: 0 };
  }

  const pos = Number(await readDoc(env, MIGRATE_POS_KEY)) || 0;

  // On the first pass, carry the singleton docs across too.
  if (pos === 0) {
    const state = await kvDocValue(env, 'blurt:state');
    if (state) await setDoc(env, 'blurt:state', state);
  }

  const src = await kvChunkIds(env);
  let page = [];
  let total = 0;

  if (src.layout === 'blob') {
    total = src.arr.length;
    page = src.arr.slice(pos, pos + MAX_ROWS_PER_REQUEST);
  } else if (src.layout === 'split') {
    total = src.ids.length;
    const slice = src.ids.slice(pos, pos + MAX_ROWS_PER_REQUEST);
    page = (
      await Promise.all(
        slice.map(async (id) => {
          const raw = await kvDocValue(env, 'chunk:' + id);
          if (!raw) return null;
          try {
            const c = JSON.parse(raw);
            c.id = id;
            return c;
          } catch (e) {
            return null;
          }
        })
      )
    ).filter(Boolean);
  }

  page.forEach((c) => {
    if (!c.id) c.id = newChunkId();
  });

  if (page.length) {
    // ord = the chunk's position in the original array, so the imported bank
    // rebuilds in exactly the order it had before.
    const nowIso = new Date().toISOString();
    const stmts = [];
    for (let i = 0; i < page.length; i += ROWS_PER_STMT) {
      const rows = page.slice(i, i + ROWS_PER_STMT);
      const binds = [];
      rows.forEach((c, j) => {
        binds.push(c.id, JSON.stringify(c), c.due || null, pos + i + j, nowIso);
      });
      const values = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
      stmts.push(
        env.BLURT_DB.prepare(
          `INSERT INTO chunks (id, data, due, ord, updated_at) VALUES ${values}
           ON CONFLICT(id) DO NOTHING`
        ).bind(...binds)
      );
    }
    await env.BLURT_DB.batch(stmts);
  }

  const next = pos + (src.layout === 'blob' ? page.length : Math.min(MAX_ROWS_PER_REQUEST, total - pos));
  const done = next >= total;
  if (done) {
    await setDoc(env, MIGRATED_KEY, new Date().toISOString());
  } else {
    await setDoc(env, MIGRATE_POS_KEY, String(next));
  }
  return { done, imported: next, total };
}

/* ================= AI + notification proxies ================= */

// Proxy a Gemini generateContent call, injecting the server-side key.
async function proxyAi(req, env) {
  if (!env.GEMINI_KEY) return json({ error: 'AI not configured (set GEMINI_KEY)' }, 503);
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'invalid JSON' }, 400);
  }
  const model = (body && body.model) || env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!body || !body.body) return json({ error: 'missing body' }, 400);
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent?key=' +
      encodeURIComponent(env.GEMINI_KEY),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.body) }
  );
  const text = await r.text(); // forward Google's response (and status) verbatim
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// Proxy an ntfy notification, injecting the server-side topic.
async function proxyNotify(req, env) {
  if (!env.NTFY_TOPIC) return json({ error: 'notify not configured (set NTFY_TOPIC)' }, 503);
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'invalid JSON' }, 400);
  }
  // ntfy header values travel as Latin-1; Workers' fetch mangles any multibyte
  // char (emoji etc.) into a control byte, which ntfy rejects (400 -> our 502).
  // Keep headers ASCII-only — emoji belongs in the UTF-8 message body instead.
  const ascii = (s, fb) =>
    String(s == null ? '' : s)
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || fb;
  const headers = { 'X-Title': ascii(body.title, 'Blurt'), 'X-Tags': ascii(body.tags, 'books') };
  if (body.delay) headers['X-Delay'] = String(body.delay); // unix timestamp for scheduled delivery
  const r = await fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), {
    method: 'POST',
    headers,
    body: String(body.message || ''),
  });
  // Forward ntfy's real status so the client can tell rate-limiting (429) apart
  // from an actual outage, instead of collapsing everything into a vague 502.
  if (!r.ok) return json({ error: 'ntfy responded ' + r.status }, r.status === 429 ? 429 : 502);
  return json({ ok: true });
}

/* ================= daily reminder (cron) ================= */

// Send the one daily homework ping when the current hour matches the user's
// chosen time. Reads the synced app state for { ntfy }, and guards on a per-day
// marker (in KV, so it expires by itself) so a cron retry can't double-send.
async function fireDueReminder(env) {
  if (!env.NTFY_TOPIC) return;
  const raw = await readDoc(env, 'blurt:state');
  if (!raw) return;
  let ntfy;
  try {
    ntfy = JSON.parse(raw).ntfy;
  } catch (e) {
    return;
  }
  if (!ntfy || !ntfy.on) return;
  const off = Number(ntfy.tzOffset) || 0; // minutes the user's clock is behind UTC
  const local = new Date(Date.now() - off * 60000);
  if (local.getUTCHours() !== Number(ntfy.hour)) return;
  const today = local.toISOString().slice(0, 10); // user's local calendar day
  if (env.BLURT_KV && (await env.BLURT_KV.get('ntfy:lastsent')) === today) return; // already sent today
  if (env.BLURT_KV) await env.BLURT_KV.put('ntfy:lastsent', today, { expirationTtl: 172800 });
  await fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), {
    method: 'POST',
    // Title stays ASCII (Workers' fetch can't carry multibyte chars in a header);
    // the ⏰ lives in the UTF-8 body instead.
    headers: { 'X-Title': 'Blurt homework', 'X-Tags': 'books' },
    body: '⏰ ' + (await reminderBody(env, today)),
  });
}

// Build a reminder that names an actual due chunk. This used to pull the entire
// chunk bank down and JSON.parse it twice just to count what was due; with a
// real table it's two small queries.
async function reminderBody(env, today) {
  const generic = '3 blurts + due chunks. ~5 minutes. No homework, no streak.';
  try {
    const countRow = await env.BLURT_DB.prepare(
      'SELECT COUNT(*) AS n FROM chunks WHERE due IS NOT NULL AND due <= ?'
    )
      .bind(today)
      .first();
    const n = (countRow && countRow.n) || 0;
    if (!n) return generic;
    const pick = await env.BLURT_DB.prepare(
      'SELECT data FROM chunks WHERE due IS NOT NULL AND due <= ? ORDER BY RANDOM() LIMIT 1'
    )
      .bind(today)
      .first();
    const chunk = pick ? JSON.parse(pick.data).chunk : '';
    if (!chunk) return n + ' chunk' + (n > 1 ? 's' : '') + ' due + 3 blurts (~5 min).';
    return n + ' chunk' + (n > 1 ? 's' : '') + ' due + 3 blurts (~5 min). First up: “' + chunk + '”';
  } catch (e) {
    return generic;
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fireDueReminder(env));
  },
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(req.url);

    if (!pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: CORS });

    const isLogin = pathname === '/api/login' && req.method === 'GET';
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';

    // Throttle only the login endpoint, so the data endpoints stay write-free.
    if (isLogin && (await loginBlocked(env, ip))) return json({ error: 'too many attempts, try later' }, 429);

    // Everything under /api requires the secret.
    if (!authed(req, env)) {
      if (isLogin) await noteLoginFailure(env, ip); // only failed logins cost a KV write
      return json({ error: 'unauthorized' }, 401);
    }
    try {
      if (pathname === '/api/login' && req.method === 'GET') return json({ ok: true });
      if (pathname === '/api/ai' && req.method === 'POST') return await proxyAi(req, env);
      if (pathname === '/api/notify' && req.method === 'POST') return await proxyNotify(req, env);

      if (pathname === '/api/chunks') {
        if (req.method === 'GET') {
          // Anything still in KV is pulled across before the first read. A bank
          // too big for one invocation reports progress and asks to be called
          // again, rather than coming back quietly truncated.
          const mig = await migrateFromKv(env);
          if (!mig.done) return json({ migrating: true, imported: mig.imported, total: mig.total });
          return json({ chunks: await listChunks(env) });
        }
        if (req.method === 'PUT') return await putChunks(req, env);
      }
      const cm = pathname.match(/^\/api\/chunks\/(.+)$/);
      if (cm && req.method === 'DELETE') {
        await env.BLURT_DB.prepare('DELETE FROM chunks WHERE id = ?').bind(decodeURIComponent(cm[1])).run();
        return json({ ok: true });
      }

      const m = pathname.match(/^\/api\/doc\/(.+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]);
        if (key.startsWith('_')) return json({ error: 'reserved key' }, 400); // internal markers
        if (req.method === 'GET') return await getDoc(env, key);
        if (req.method === 'PUT') return await putDoc(req, env, key);
        if (req.method === 'DELETE') {
          await env.BLURT_DB.prepare('DELETE FROM documents WHERE key = ?').bind(key).run();
          return json({ ok: true });
        }
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
