'use strict';

/*
 * Blurt backend (Cloudflare Worker + KV) — single user.
 * One secret (APP_SECRET) logs you in from any device and unlocks your data
 * plus the Gemini/ntfy proxies. No accounts, no sign-up: same secret => same data.
 *
 * KV layout (binding: BLURT_KV):
 *   doc:<key>  ->  JSON { value, updated_at }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

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

async function getDoc(env, key) {
  const raw = await env.BLURT_KV.get('doc:' + key);
  if (raw == null) return json({ value: null, updated_at: null });
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    doc = { value: raw, updated_at: null };
  }
  return json({ value: doc.value, updated_at: doc.updated_at || null });
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
  await env.BLURT_KV.put('doc:' + key, JSON.stringify({ value: body.value, updated_at }));
  return json({ ok: true, updated_at });
}

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
  const headers = { 'X-Title': body.title || 'Blurt', 'X-Tags': body.tags || 'books' };
  if (body.delay) headers['X-Delay'] = String(body.delay); // unix timestamp for scheduled delivery
  const r = await fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), {
    method: 'POST',
    headers,
    body: String(body.message || ''),
  });
  if (!r.ok) return json({ error: 'ntfy responded ' + r.status }, 502);
  return json({ ok: true });
}

// Send the one daily homework ping when the current hour matches the user's
// chosen time. Reads the synced app state (doc:blurt:state) for { ntfy }, and
// guards on a per-day marker so a cron retry can't double-send.
async function fireDueReminder(env) {
  if (!env.NTFY_TOPIC) return;
  const raw = await env.BLURT_KV.get('doc:blurt:state');
  if (!raw) return;
  let ntfy;
  try {
    ntfy = JSON.parse(JSON.parse(raw).value).ntfy; // doc.value is itself a JSON string
  } catch (e) {
    return;
  }
  if (!ntfy || !ntfy.on) return;
  const off = Number(ntfy.tzOffset) || 0; // minutes the user's clock is behind UTC
  const local = new Date(Date.now() - off * 60000);
  if (local.getUTCHours() !== Number(ntfy.hour)) return;
  const today = local.toISOString().slice(0, 10); // user's local calendar day
  if ((await env.BLURT_KV.get('ntfy:lastsent')) === today) return; // already sent today
  await env.BLURT_KV.put('ntfy:lastsent', today);
  await fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), {
    method: 'POST',
    headers: { 'X-Title': 'Blurt homework ⏰', 'X-Tags': 'books' },
    body: '3 blurts + due chunks. ~5 minutes. No homework, no streak.',
  });
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

    // Throttle only the login endpoint, so the AI/KV proxies stay write-free.
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
      const m = pathname.match(/^\/api\/kv\/(.+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]);
        if (req.method === 'GET') return await getDoc(env, key);
        if (req.method === 'PUT') return await putDoc(req, env, key);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
