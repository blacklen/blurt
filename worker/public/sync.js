/* sync.js — Talking to the server: auth, the write queue, loading, logging attempts.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

/* ================= sync config (optional server) ================= */
let API_BASE =
  (function () {
    try {
      return localStorage.getItem('blurt:apiBase');
    } catch (e) {
      return null;
    }
  })() ||
  (location.protocol.indexOf('http') === 0
    ? location.origin
    : 'http://localhost:8787');

 /* served from the Worker → same origin; opened as a file → localhost */
let secret =
  (function () {
    try {
      return localStorage.getItem('blurt:secret');
    } catch (e) {
      return '';
    }
  })() || '';

function loggedIn() {
  return !!secret;
}

function apiBase() {
  const f = $('gateBaseIn');
  const v = (f && f.value.trim()) || API_BASE;
  return v.replace(/\/+$/, '');
}

async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (secret) headers['Authorization'] = 'Bearer ' + secret;
  const r = await fetch(apiBase() + path, Object.assign({}, opts, { headers }));
  if (!r.ok) {
    const err = new Error('server said ' + r.status);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/* AI + notifications run through the Worker so the Gemini key / ntfy topic stay server-side. */
/* Set when Gemini says the daily free quota is used up (HTTP 429 /
   RESOURCE_EXHAUSTED), so the header can say why feedback fell back to the bank. */
let aiQuotaHit = false;

async function geminiJSON(payload) {
  if (!loggedIn()) return null;
  try {
    const data = await api('/api/ai', {
      method: 'POST',
      body: JSON.stringify({ model: GEM_MODEL, body: payload }),
    });
    if (data && data.error && data.error.status === 'RESOURCE_EXHAUSTED') throw Object.assign(new Error('quota'), { status: 429 });
    if (aiQuotaHit) {
      aiQuotaHit = false;
      setSync(pendingCount() ? 'pending' : 'idle');
    }
    return data;
  } catch (e) {
    if (e.status === 429) {
      aiQuotaHit = true;
      setSync(pendingCount() ? 'pending' : 'idle');
    }
    console.error('AI proxy failed:', e);
    return null;
  }
}

/* One AI round-trip → parsed JSON object (or null): wraps geminiJSON plus the
   shared "first { … last }" extraction. Per-call validation stays at the call site. */
async function aiObj(payload) {
  const data = await geminiJSON(payload);
  if (!data) return null;
  try {
    const text = ((data.candidates || [])[0]?.content?.parts || [])
      .map((x) => x.text || '')
      .join('');
    const s = text.indexOf('{'),
      e = text.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    return JSON.parse(text.slice(s, e + 1));
  } catch (err) {
    console.error('AI parse failed:', err);
    return null;
  }
}

/* ================= storage (online only — the server is the single source of truth) =================
   There is no localStorage copy of your data and no offline mode: everything is
   read from and written to the database. That removes the old timestamp-merge
   dance (cache the server's updated_at per key, re-push whenever the server
   looked older) which, on top of being fiddly, fired a write on every load
   whenever the two clocks disagreed by a hair.

   Writes don't go out one-per-edit though. They land in a queue keyed by
   document name / chunk id, so a whole drill session — dozens of grades, each
   touching the same chunk and the same state doc — collapses into one round of
   requests. A failed flush keeps its payload and retries with backoff, and says
   so on screen: online-only means a silently swallowed write is lost work, so
   nothing here fails quietly. */

const FLUSH_MS = 1500;

 // idle time before a queued write goes out
const RETRY_MAX = 30000;

const CHUNK_PAGE = 500;

 // must not exceed the server's MAX_ROWS_PER_REQUEST
const ATTEMPT_PAGE = 175;

 // must not exceed the server's MAX_ATTEMPTS_PER_REQUEST

let dataLoaded = false;

 /* no write leaves the queue until a load has succeeded */
const pendingDocs = new Map();

 /* key -> latest value string */
const pendingChunks = new Map();

 /* id  -> latest chunk object */
const pendingChunkDels = new Set();

const pendingDocDels = new Set();

const pendingAttempts = new Map();

 /* id -> latest attempt object */
let flushTimer = null,
  flushing = false,
  retryDelay = 0;

function pendingCount() {
  return (
    pendingDocs.size +
    pendingChunks.size +
    pendingChunkDels.size +
    pendingDocDels.size +
    pendingAttempts.size
  );
}

function scheduleFlush(delay) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay == null ? FLUSH_MS : delay);
}

function queueDoc(k, v) {
  pendingDocs.set(k, v);
  pendingDocDels.delete(k);
  setSync('pending');
  scheduleFlush();
}

function queueDocDel(k) {
  pendingDocs.delete(k);
  pendingDocDels.add(k);
  setSync('pending');
  scheduleFlush();
}

function queueChunk(c) {
  if (!c || !c.id) return;
  pendingChunks.set(c.id, c);
  pendingChunkDels.delete(c.id);
  setSync('pending');
  scheduleFlush();
}

function queueAttempt(a) {
  if (!a || !a.id) return;
  pendingAttempts.set(a.id, a);
  setSync('pending');
  scheduleFlush();
}

function queueChunkDel(id) {
  pendingChunks.delete(id);
  pendingChunkDels.add(id);
  setSync('pending');
  scheduleFlush();
}

/* Push everything queued. On failure the payload goes back on the queue — but
   only where a newer edit hasn't already replaced it — and we back off and retry. */
async function flush(opts) {
  opts = opts || {};
  if ((flushing && !opts.force) || !dataLoaded || !loggedIn()) return;
  if (!pendingCount()) {
    setSync('idle');
    return;
  }
  flushing = true;
  setSync('saving');

  const docs = new Map(pendingDocs);
  const chunkList = [...pendingChunks.values()];
  const chunkDels = [...pendingChunkDels];
  const docDels = [...pendingDocDels];
  const attemptList = [...pendingAttempts.values()];
  pendingAttempts.clear();
  pendingDocs.clear();
  pendingChunks.clear();
  pendingChunkDels.clear();
  pendingDocDels.clear();

  const extra = opts.keepalive ? { keepalive: true } : {};
  try {
    /* Attempts go first: the one-time repLog migration deletes the old log from
       the state doc, and that must not land before the attempts it became. */
    for (let i = 0; i < attemptList.length; i += ATTEMPT_PAGE)
      await api('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({ attempts: attemptList.slice(i, i + ATTEMPT_PAGE) }),
        ...extra,
      });
    for (const [k, v] of docs)
      await api('/api/doc/' + encodeURIComponent(k), {
        method: 'PUT',
        body: JSON.stringify({ value: v }),
        ...extra,
      });
    for (let i = 0; i < chunkList.length; i += CHUNK_PAGE)
      await api('/api/chunks', {
        method: 'PUT',
        body: JSON.stringify({ chunks: chunkList.slice(i, i + CHUNK_PAGE) }),
        ...extra,
      });
    for (const id of chunkDels)
      await api('/api/chunks/' + encodeURIComponent(id), { method: 'DELETE', ...extra });
    for (const k of docDels)
      await api('/api/doc/' + encodeURIComponent(k), { method: 'DELETE', ...extra });
    retryDelay = 0;
    flushing = false;
    if (pendingCount()) scheduleFlush(0);
    else setSync('idle');
  } catch (e) {
    /* put the payload back, without clobbering anything edited while it was in flight */
    for (const [k, v] of docs) if (!pendingDocs.has(k) && !pendingDocDels.has(k)) pendingDocs.set(k, v);
    for (const a of attemptList) if (!pendingAttempts.has(a.id)) pendingAttempts.set(a.id, a);
    for (const c of chunkList)
      if (!pendingChunks.has(c.id) && !pendingChunkDels.has(c.id)) pendingChunks.set(c.id, c);
    chunkDels.forEach((id) => {
      if (!pendingChunks.has(id)) pendingChunkDels.add(id);
    });
    docDels.forEach((k) => {
      if (!pendingDocs.has(k)) pendingDocDels.add(k);
    });
    flushing = false;
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 2000, RETRY_MAX);
    setSync('error');
    console.error('sync failed, retrying in ' + retryDelay + 'ms:', e);
    scheduleFlush(retryDelay);
  }
}

/* Last-gasp flush when the tab goes away. keepalive lets the requests outlive the
   page. `force` gets past the in-flight guard — a normal flush already drained the
   queue into its own snapshot before its first await, so this can only pick up
   what was typed since, never send anything twice. */
function flushOnExit() {
  if (!pendingCount() || !dataLoaded || !loggedIn()) return;
  if (flushTimer) clearTimeout(flushTimer);
  flush({ keepalive: true, force: true });
}

window.addEventListener('pagehide', flushOnExit);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushOnExit();
});

window.addEventListener('online', () => {
  if (pendingCount()) scheduleFlush(0);
});

/* The visible half of the contract: you can always see whether your reps are saved. */
function setSync(s) {
  const el = $('syncState');
  if (!el) return;
  const n = pendingCount();
  if (s === 'error') {
    el.textContent = '⚠ Not saved — retrying';
    el.style.color = 'var(--bad)';
  } else if (s === 'saving' || (s === 'pending' && n)) {
    el.textContent = 'Saving…';
    el.style.color = 'var(--muted)';
  } else if (aiQuotaHit) {
    el.textContent = 'AI quota reached for today — bank feedback only';
    el.style.color = 'var(--muted)';
  } else {
    el.textContent = '';
  }
}

/* While the first load is in flight the header would otherwise read "0 day
   streak · 0 reps" and "My chunks (0)" — the same false alarm the error banner
   exists to prevent. Placeholders sit in those spots instead, and the homework
   card holds its height so nothing jumps when the real content lands. */
function setLoading(on) {
  if (document.body) document.body.classList.toggle('loading', !!on);
}

/* Load failures get a blocking banner rather than a console line: with no local
   copy to fall back on, a silent failure looks exactly like "all my chunks are
   gone". Writes stay locked (dataLoaded === false) until a retry succeeds. */
function showLoadError(e) {
  const el = $('loadError');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML =
    "<b>Couldn't load your data.</b> Nothing has been changed on the server — " +
    'your chunks are safe. <button class="btn ghost" onclick="retryLoad()">Try again</button>' +
    '<small>' +
    esc(String((e && e.message) || e)) +
    '</small>';
}

function hideLoadError() {
  const el = $('loadError');
  if (el) el.style.display = 'none';
}

function setLoadNote(msg) {
  const el = $('loadError');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = '<b>' + esc(msg) + '</b>';
}

async function retryLoad() {
  setLoadNote('Loading…');
  await loadAll();
}

const store = {
  async get(k) {
    const d = await api('/api/doc/' + encodeURIComponent(k));
    return d && d.value != null ? { value: d.value } : null;
  },
  async set(k, v) {
    queueDoc(k, v);
  },
  async del(k) {
    queueDocDel(k);
  },
};

/* Pull everything from the server. If this fails we must NOT fall through into
   the defaulting below: that would leave the app holding an empty bank and then
   happily save it over your real data. Instead: say so, keep writes locked, and
   let you retry. */
async function loadAll() {
  dataLoaded = false;
  setLoading(true);
  try {
    // These read different things and don't depend on each other, so they
    // go out together — the wait is one round trip, not three stacked up.
    const [r] = await Promise.all([
      store.get('blurt:state'),
      loadAiPrompts(),
      loadMyReflexes(),
      loadChunks(),
      loadAttempts(),
    ]);
    if (r) state = { ...state, ...JSON.parse(r.value) };
  } catch (e) {
    setLoading(false); /* uncover the page so the error banner is actually visible */
    showLoadError(e);
    return;
  }
  dataLoaded = true;
  hideLoadError();
  if (!state.cats || !state.cats.length) state.cats = CATS.map((c) => c.id);
  if (!Array.isArray(state.disliked)) state.disliked = []; /* bank prompt texts to never re-serve */
  if (!['vn', 'sit', 'reflex', 'expr', 'mix', 'three', 'ladder'].includes(state.ptype)) state.ptype = 'vn';
  if (!state.settings) state.settings = { hwReps: 3 };
  if (!(state.settings.hwReps > 0)) state.settings.hwReps = 3;
  if (typeof state.settings.voice !== 'boolean') state.settings.voice = false;
  if (!state.hw || state.hw.date !== dayStr(0)) state.hw = { date: dayStr(0), reps: 0 };
  if (!state.warmup || state.warmup.date !== dayStr(0))
    state.warmup = { date: dayStr(0), done: false };
  // migrate old chunks into the schedule: anything without a due date is due today,
  // and anything still on the old step-ladder gets SM-2 fields (ef/interval/reps).
  const migratedChunks = [];
  chunks.forEach((c) => {
    if (migrateChunk(c)) migratedChunks.push(c);
  });
  if (migratedChunks.length) chunkSaveMany(migratedChunks);
  // streak decay: missing a homework day resets you — unless banked freeze tokens
  // can cover the gap (one token per missed day, auto-spent).
  const today = dayStr(0);
  if (state.lastDate && state.lastDate !== today && state.lastDate !== dayStr(-1)) {
    const missed = daysBetween(state.lastDate, today) - 1; // whole days before today with no homework
    if (missed > 0 && (state.freezes || 0) >= missed) {
      state.freezes -= missed;
      state.lastDate = dayStr(-1); // bridge the gap so the streak survives
      state.streakFrozeNote = missed; // one-time UI note (cleared after it's shown)
    } else {
      state.streak = 0;
    }
  }
  migrateRepLog();
  if (state.write && state.write.date !== dayStr(0)) delete state.write; /* drafts last one day */
  if (!state.ntfy) state.ntfy = { on: false, hour: 14, tzOffset: new Date().getTimezoneOffset() };
  if (state.ntfy.on === undefined)
    state.ntfy.on = !!state.ntfy.topic; /* migrate old topic-based opt-in */
  delete state.ntfy.until; /* obsolete: the server now owns the schedule */
  renderAll();
  setLoading(false); /* real numbers are on screen now — drop the placeholders */
  initNtfy();
  maybeQuickStart();
  maybeWeeklyRecap();
}

async function saveState() {
  await store.set('blurt:state', JSON.stringify(state));
}

/* ================= chunk storage =================
   One row per chunk in the `chunks` table, fetched as a single query. The bank
   comes back in full because the practice engine genuinely needs it in memory —
   capsule mode walks every chunk, Frankenstein picks a second one at random,
   import de-dupes against every existing text, and the whole engine addresses
   chunks by array position — but "the whole bank" costs one request, not one
   per chunk. Writes go through the queue above, so grading ten chunks in a row
   is one batched upsert rather than ten round trips. */
function newChunkId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function loadChunks() {
  // The server imports anything left in the old KV store on first read; a bank
  // too big for one invocation comes back in pages, so keep asking until done.
  let guard = 0;
  for (;;) {
    const r = await api('/api/chunks');
    if (!r || !r.migrating) {
      chunks = (r && Array.isArray(r.chunks) ? r.chunks : []).filter((c) => c && c.id);
      return;
    }
    setLoadNote('Moving your chunks to the new database… ' + r.imported + '/' + r.total);
    if (++guard > 200) throw new Error('migration stalled at ' + r.imported + '/' + r.total);
  }
}

async function loadAttempts() {
  const r = await api('/api/attempts?since=' + dayStr(-ATTEMPT_DAYS));
  attempts = (r && Array.isArray(r.attempts) ? r.attempts : []).reverse(); /* server sends newest first */
}

/* Record one attempt: kept in memory for stats/replay and queued for the server.
   Returns the attempt so a later grading pass can re-log the same id. */
function logAttempt(a) {
  const now = new Date().toISOString();
  const row = {
    id: a.id || newChunkId(),
    d: a.d || dayStr(0),
    source: a.source,
    kind: a.kind || null,
    prompt: a.prompt || '',
    blurt: a.blurt || '',
    fix: a.fix || '',
    natural: a.natural || '',
    note: a.note || '',
    tags: cleanTags(a.tags),
    clean: a.clean == null ? null : !!a.clean,
    conf: a.conf || null,
    pred: a.pred == null ? null : !!a.pred,
    created_at: a.created_at || now,
  };
  const i = attempts.findIndex((x) => x.id === row.id);
  if (i >= 0) attempts[i] = row;
  else attempts.push(row);
  queueAttempt(row);
  if (dataLoaded) {
    renderHeader(); /* clean rate */
    renderHW();
  }
  return row;
}

/* One-time: the old 30-entry state.repLog becomes rows in the attempts table. */
function migrateRepLog() {
  const log = state.repLog;
  if (!Array.isArray(log)) return;
  log.forEach((r, i) => {
    if (!r || !r.blurt) return;
    logAttempt({
      source: 'practice',
      d: r.d || dayStr(0),
      prompt: r.prompt,
      blurt: r.blurt,
      fix: r.fix,
      note: r.note,
      /* keep their order: same day, one millisecond apart */
      created_at: new Date(Date.parse((r.d || dayStr(0)) + 'T12:00:00Z') + i).toISOString(),
    });
  });
  attempts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  delete state.repLog;
  saveState();
}

function chunkSave(c) {
  queueChunk(c);
}

function chunkSaveMany(list) {
  list.forEach(queueChunk);
}

async function chunkAdd(c) {
  if (!c.id) c.id = newChunkId();
  queueChunk(c);
}

async function chunkAddMany(list) {
  list.forEach((c) => {
    if (!c.id) c.id = newChunkId();
    queueChunk(c);
  });
}

async function chunkRemove(id) {
  queueChunkDel(id);
}

/* Every attempt on the server, not just the 90 days kept in memory. */
async function fetchAllAttempts() {
  let all = [],
    before = '';
  for (;;) {
    const r = await api('/api/attempts?limit=5000' + (before ? '&before=' + encodeURIComponent(before) : ''));
    const got = (r && r.attempts) || [];
    all = all.concat(got);
    if (got.length < 5000) return all;
    before = got[got.length - 1].created_at;
  }
}
