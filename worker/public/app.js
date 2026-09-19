/* ================= prompt bank ================= */
// prettier-ignore
const CATS = [
  {id:'work',   label:'💼 Work'},
  {id:'daily',  label:'☀️ Daily life'},
  {id:'social', label:'💬 Small talk'},
  {id:'opinion',label:'🧠 Opinions'},
  {id:'story',  label:'📖 Storytelling'},
  {id:'travel', label:'🧳 Travel'},
  {id:'health', label:'🩺 Health & body'},
  {id:'money',  label:'💸 Money & shopping'},
  {id:'career', label:'🎯 Interviews & career'},
  {id:'conflict',label:'💥 Conflict & pushback'},
  {id:'feelings',label:'🫂 Feelings & venting'},
  {id:'meeting',label:'🎤 Meetings & presenting'},
  {id:'admin',  label:'☎️ Calls & admin'},
  {id:'food',   label:'🍜 Food & eating out'},
  {id:'family', label:'❤️ Family & relationships'},
  {id:'learning',label:'🎓 Learning & self-study'},
  {id:'tech',   label:'📱 Tech & gadgets'},
  {id:'plans',  label:'📅 Plans & scheduling'}
];
// prettier-ignore
let PROMPTS = [
 /* Compact cold-start fallback. The full ~100-prompt bank loads from /prompts.json
    via loadPrompts(); this keeps something to practise on screen before that
    fetch lands, or if it fails. */
 {cat:'work',kind:'vn', text:'Cái bug này khó chịu thật, mình tìm cả buổi sáng mà chưa ra.', sample:"This bug is driving me crazy — I've been digging into it all morning and still nothing.", chunk:'driving me crazy', note:'“Driving me crazy” is the natural way to vent about something annoying.'},
 {cat:'work',kind:'sit', text:'Your standup update: yesterday a bug fix, today a new task, no blockers.', sample:"Quick one from me — wrapped up the login bug yesterday, picking up the export task today. No blockers.", chunk:'wrapped up / picking up', note:'Standup verbs: wrap up, pick up, look into, follow up.'},
 {cat:'daily',kind:'vn', text:'Mình định nghỉ sớm hôm nay vì hơi mệt.', sample:"I'm thinking of heading out early today — feeling a bit off.", chunk:'feeling a bit off', note:'“A bit off” covers tired, sick-ish, weird — all of it.'},
 {cat:'daily',kind:'sit', text:'Your food delivery is 40 minutes late. Message the shipper without being rude.', sample:"Hey, just checking in — any idea how far out you are? No worries if you're stuck in traffic.", chunk:'just checking in', note:'Softens any “where is it?!” message.'},
 {cat:'social',kind:'vn', text:'Lâu lắm rồi không gặp, dạo này thế nào?', sample:"Hey, it's been ages! How've you been?", chunk:"it's been ages", note:'Greeting chunk. Fires automatically once memorized.'},
 {cat:'social',kind:'sit', text:'End a conversation politely because you need to leave.', sample:"Anyway, I should get going — it was really good catching up!", chunk:'I should get going', note:'The universal polite exit. “Anyway” signals the landing.'},
 {cat:'opinion',kind:'vn', text:'Càng nghĩ càng thấy giải pháp này không ổn.', sample:"The more I think about it, the more this feels wrong.", chunk:'the more... the more...', note:'A pattern chunk — memorize the shape, swap the words.'},
 {cat:'opinion',kind:'sit', text:'Hot take time: is AI going to replace developers? Honest opinion, 2 sentences.', sample:"Honestly, I think it replaces tasks, not developers — the job just shifts up a level. The people in trouble are the ones who refuse to use it.", chunk:'honestly, I think...', note:'“Honestly” buys you a second to think AND sounds confident.'},
 {cat:'story',kind:'vn', text:'Suýt nữa thì mình xóa nhầm database production.', sample:"I almost dropped the production database by accident.", chunk:'almost + verb', note:'No “suýt nữa thì” gymnastics — just “almost did”.'},
 {cat:'story',kind:'sit', text:'Tell the story of the worst bug you ever shipped — 3 sentences, make it dramatic.', sample:"So picture this: Friday night, everyone's gone home, and I push one tiny fix. Turns out that tiny fix logged every user out of the entire app. I spent the weekend pretending my phone was broken.", chunk:'so picture this...', note:'“Picture this” makes any story instantly cinematic.'}
];

const REP_BASE = 45,
  REP_MIN = 30; /* timer shrinks 1s per streak day */
/* Reflex is typed, not spoken: one short line, fired back fast. */
const REFLEX_SECONDS = 8;
function repSeconds() {
  if (current && current.ladder) return LADDER_SECONDS[current.ladder.round - 1];
  if (current && current.prompt && current.prompt.kind === 'reflex') return REFLEX_SECONDS;
  return Math.max(REP_MIN, REP_BASE - (state.streak || 0));
}
let repTotal = REP_BASE;
function hwReps() {
  return state.settings.hwReps;
} /* daily blurt quota (user setting) */
const LADDER = [1, 3, 7, 14, 30, 60]; /* days between successful reviews */

let state = {
  streak: 0,
  lastDate: null,
  total: 0,
  freezes: 0,
  cats: CATS.map((c) => c.id),
  hw: { date: null, reps: 0 },
  ntfy: { on: false, hour: 14, tzOffset: new Date().getTimezoneOffset() },
  history: {},
  lastRecap: null,
  lastPattern: null,
  settings: { hwReps: 3, voice: false },
};
const GEM_MODEL = 'gemini-2.5-flash';
let chunks = [];
/* Your attempts from the last ATTEMPT_DAYS days, oldest first. Older ones stay
   on the server and are reached through the archive (GET /api/attempts). */
let attempts = [];
const ATTEMPT_DAYS = 90;
let current = null,
  timer = null,
  secondsLeft = REP_BASE,
  lastResult = null,
  recentPrompts = [];
let drillCurrent = null,
  rec = null,
  micLive = false,
  micBtnId = 'micBtn',
  lastShownEx = null;
let aiPrompts = []; /* generated prompts, kept server-side so they follow you across devices */
let myReflexes = []; /* reflex scenes mined from shows you watched (doc blurt:myReflexes) */
const MY_REFLEX_CAP = 500;

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
    : 'http://localhost:8787'); /* served from the Worker → same origin; opened as a file → localhost */
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

const FLUSH_MS = 1500; // idle time before a queued write goes out
const RETRY_MAX = 30000;
const CHUNK_PAGE = 500; // must not exceed the server's MAX_ROWS_PER_REQUEST
const ATTEMPT_PAGE = 175; // must not exceed the server's MAX_ATTEMPTS_PER_REQUEST

let dataLoaded = false; /* no write leaves the queue until a load has succeeded */
const pendingDocs = new Map(); /* key -> latest value string */
const pendingChunks = new Map(); /* id  -> latest chunk object */
const pendingChunkDels = new Set();
const pendingDocDels = new Set();
const pendingAttempts = new Map(); /* id -> latest attempt object */
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
function dayStr(off) {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

/* ================= scheduling ================= */
function dueChunks() {
  const t = dayStr(0);
  return chunks.filter((c) => c.due <= t);
}
/* SM-2 spaced repetition. grade: 'again' (missed — stays due today) |
   'hard' | 'good' | 'easy' (all correct, with growing intervals). Each chunk
   carries ef (ease, ≥1.3), interval (days), reps (consecutive successes). */
function previewInterval(c, grade) {
  const ef = c.ef || 2.5,
    I = c.interval || 0,
    first = (c.reps || 0) < 1;
  if (grade === 'again') return 0;
  if (grade === 'hard') return Math.max(1, Math.round((I || 1) * 1.2));
  if (grade === 'easy')
    return Math.max(
      1,
      first ? Math.round((ef + 0.15) * 1.3) : Math.round((I || 1) * (ef + 0.15) * 1.3),
    );
  return Math.max(1, first ? 1 : Math.round((I || 1) * ef)); /* good */
}
function scheduleAfter(c, grade) {
  if (c.ef == null) c.ef = 2.5;
  if (grade === 'again') {
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.reps = 0;
    c.interval = 0;
    c.due = dayStr(0); /* stays due today until you get it right */
    c.misses = (c.misses || 0) + 1;
    c.lapses = (c.lapses || 0) + 1; /* drives leech detection */
    return;
  }
  c.interval = previewInterval(c, grade);
  if (grade === 'hard') c.ef = Math.max(1.3, c.ef - 0.15);
  else if (grade === 'easy') c.ef = c.ef + 0.15;
  c.reps = (c.reps || 0) + 1;
  c.due = dayStr(c.interval);
  c.hits = (c.hits || 0) + 1;
}
function fmtDays(n) {
  return n <= 0 ? 'today' : n === 1 ? '1d' : n < 30 ? n + 'd' : Math.round(n / 30) + 'mo';
}
/* Fields every freshly-saved chunk starts with (first review tomorrow, unseen by SM-2). */
function newChunkBase() {
  return { date: dayStr(0), hits: 0, misses: 0, due: dayStr(1), ef: 2.5, interval: 0, reps: 0 };
}
/* Bring a chunk up to date: give it a due date and SM-2 fields if it predates them. */
function migrateChunk(c) {
  let changed = false;
  if (!c.due) {
    c.due = dayStr(0);
    changed = true;
  }
  if (c.ef == null) {
    c.ef = 2.5;
    c.reps = c.step || 0;
    c.interval = c.step > 0 ? LADDER[Math.min(c.step - 1, LADDER.length - 1)] : 0;
    delete c.step;
    changed = true;
  }
  return changed;
}

/* ================= homework ================= */
function hwComplete() {
  return state.hw.reps >= hwReps() && dueChunks().length === 0;
}
function creditStreakIfDone() {
  if (!hwComplete()) return;
  const today = dayStr(0);
  if (state.lastDate !== today) {
    state.streak = state.lastDate === dayStr(-1) ? state.streak + 1 : 1;
    state.lastDate = today;
    if (state.streak > 0 && state.streak % 7 === 0)
      state.freezes = Math.min(3, (state.freezes || 0) + 1); // earn a freeze every 7-day run (cap 3)
    saveState();
  }
}
function renderHW() {
  const due = dueChunks().length;
  const quota = hwReps();
  const repsDone = Math.min(state.hw.reps, quota);
  const repsOk = state.hw.reps >= quota,
    drillOk = due === 0;
  let html = '<div class="eyebrow">Today\'s homework</div>';
  html +=
    '<div class="hwItem ' +
    (repsOk ? 'done' : '') +
    '"><span class="box">' +
    (repsOk ? '✓' : '') +
    '</span> Blurt ' +
    quota +
    ' prompts (' +
    repsDone +
    '/' +
    quota +
    ')</div>';
  if (chunks.length > 0) {
    html +=
      '<div class="hwItem ' +
      (drillOk ? 'done' : '') +
      '"><span class="box">' +
      (drillOk ? '✓' : '') +
      '</span> Clear due chunks (' +
      (drillOk ? 'all clear' : due + ' waiting') +
      ')</div>';
  }
  if (hwComplete()) {
    html += '<div class="hwDone">✦ Homework done — streak banked. See you tomorrow.</div>';
  } else {
    html += '<div class="hwWarn">No homework, no streak. That\'s the deal you asked for.</div>';
  }
  /* something that went well always sits next to the thing owed */
  const cw = cleanWeekText();
  if (cw) html += '<div class="hwClean">' + cw + '</div>';
  if (state.streakFrozeNote) {
    html +=
      '<div class="hwDone">❄️ A streak freeze covered ' +
      state.streakFrozeNote +
      ' missed day' +
      (state.streakFrozeNote > 1 ? 's' : '') +
      ' — streak safe.</div>';
  }
  if (state.freezes > 0) {
    html +=
      '<div class="hint">❄️ ' +
      state.freezes +
      ' streak freeze' +
      (state.freezes > 1 ? 's' : '') +
      ' banked — auto-used to cover a missed day. Earn one every 7-day run.</div>';
  }
  const n = smartNext();
  /* reps still owed → a freewrite is offered too; it counts as one rep */
  const free = state.hw.reps < hwReps() && loggedIn();
  if (n || free)
    html +=
      '<div class="row">' +
      (free
        ? '<button class="btn ' + (n ? 'ghost' : 'pulse') + '" onclick="startFreewriteFromHW()">✍️ Freewrite ' + freeMin() + ' min</button>'
        : '') +
      (n ? '<button class="btn pulse" onclick="startSmartSession()">' + n.label + '</button>' : '') +
      '</div>';
  $('hwCard').innerHTML = html;
  if (state.streakFrozeNote) {
    delete state.streakFrozeNote;
    saveState();
  } /* show the freeze note once */
  const badge = $('dueBadge');
  if (due > 0) {
    badge.style.display = '';
    badge.textContent = due;
  } else badge.style.display = 'none';
}
/* Smart daily session: surface the single highest-value next action — clear due
   drills first (best retention ROI), then hit the rep quota with nemesis-targeted
   AI prompts, then one mistake replay. */
function smartNext() {
  if (loggedIn() && warmupPick())
    return { fn: 'warmup', label: "🔥 Warm up — beat yesterday's miss" };
  const due = dueChunks().length;
  if (due) return { fn: 'drill', label: '▶ Drill ' + due + ' due chunk' + (due > 1 ? 's' : '') };
  if (state.hw.reps < hwReps())
    return { fn: 'practice', label: '▶ Blurt a prompt (' + state.hw.reps + '/' + hwReps() + ')' };
  if (loggedIn() && replayPool().length) return { fn: 'replay', label: '▶ Replay a past mistake' };
  return null;
}
function startSmartSession() {
  const n = smartNext();
  if (!n) return;
  if (n.fn === 'drill') showTab('drill');
  else if (n.fn === 'practice') {
    showTab('practice');
    loggedIn() ? genPrompt() : startRep();
  } else if (n.fn === 'warmup') {
    showTab('practice');
    startReplay(warmupPick(), { warmup: true });
  } else if (n.fn === 'replay') {
    showTab('practice');
    startReplay();
  }
}
function renderAll() {
  renderHeader();
  renderVoice();
  renderChips();
  renderTypeChips();
  renderHW();
  renderChunks();
}

/* ================= UI ================= */
const $ = (id) => document.getElementById(id);
/* Share of graded attempts (clean true/false, not null) that needed no fix,
   for days from..to inclusive. pct is null when nothing was graded. */
function cleanStats(from, to) {
  /* copying a text isn't producing English, so it stays out of the clean rate */
  const g = attempts.filter((a) => a.clean != null && a.source !== 'copy' && a.d >= from && (!to || a.d <= to));
  const c = g.filter((a) => a.clean).length;
  return { n: g.length, clean: c, pct: g.length ? Math.round((100 * c) / g.length) : null };
}
function cleanWeekText() {
  const w = cleanStats(dayStr(-6));
  return w.pct == null ? '' : '✓ ' + w.pct + '% clean this week';
}
function renderHeader() {
  $('streakNum').textContent = state.streak;
  $('totalNum').textContent = state.total;
  /* short form here; the homework card spells out "this week" */
  const w = cleanStats(dayStr(-6));
  $('cleanRate').textContent = w.pct == null ? '' : ' · ✓ ' + w.pct + '% clean';
  $('cleanRate').title = w.pct == null ? '' : w.clean + ' of ' + w.n + ' checked answers this week needed no fix';
  $('chunkCount').textContent = chunks.length;
  const rb = $('replayBtn');
  if (rb) rb.style.display = loggedIn() && replayPool().length ? '' : 'none';
}
function toggleSettings() {
  const o = $('settingsOverlay');
  const open = o.style.display !== 'flex';
  o.style.display = open ? 'flex' : 'none';
  if (open) {
    stopTimer();
    stopMic();
    $('hwRepsIn').value = state.settings.hwReps;
    $('hwCfgStatus').textContent = '';
    $('freeMinIn').value = freeMin();
    $('vnShareIn').value = vnShare();
    $('vnShareLbl').textContent = vnShare() + '%';
    $('freeMinStatus').textContent = '';
    $('personalCtx').value = state.settings.context || '';
    $('ctxStatus').textContent = '';
    renderVoice();
    renderPredict();
  } /* don't run a rep behind the panel */
}
function savePersonalCtx() {
  state.settings.context = $('personalCtx').value.trim();
  saveState();
  $('ctxStatus').textContent = state.settings.context
    ? 'Saved — AI prompts will use your context.'
    : 'Cleared.';
}
function saveHwReps() {
  const n = Math.floor(Number($('hwRepsIn').value));
  if (!(n >= 1)) {
    $('hwCfgStatus').textContent = 'Enter a whole number of 1 or more.';
    return;
  }
  state.settings.hwReps = n;
  $('hwRepsIn').value = n;
  saveState();
  renderAll();
  $('hwCfgStatus').textContent = 'Saved — ' + n + ' prompt' + (n === 1 ? '' : 's') + ' a day.';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('settingsOverlay').style.display === 'flex') toggleSettings();
});
/* First on-screen, still-enabled Save button — the one keyboard focus targets. */
function visibleSaveBtn() {
  return ['saveFixedBtn', 'saveSuggestBtn', 'saveChunkBtn']
    .map((id) => $(id))
    .find((b) => b && !b.disabled && b.offsetParent !== null);
}
function showTab(t) {
  if (t !== 'write' && write.phase === 'running') finishFreewrite(); /* leaving ends it; what's written counts */
  ['practice', 'drill', 'random', 'chat', 'write', 'chunks', 'stats'].forEach(
    (x) => ($(x).style.display = x === t ? '' : 'none'),
  );
  $('tabPractice').classList.toggle('active', t === 'practice');
  $('tabDrill').classList.toggle('active', t === 'drill');
  $('tabRandom').classList.toggle('active', t === 'random');
  $('tabChat').classList.toggle('active', t === 'chat');
  $('tabWrite').classList.toggle('active', t === 'write');
  $('tabChunks').classList.toggle('active', t === 'chunks');
  $('tabStats').classList.toggle('active', t === 'stats');
  if (t !== 'drill')
    $('drillBody').innerHTML = ''; /* keep drillInput/drillVerdict ids unique across the two tabs */
  if (t !== 'random') $('randomBody').innerHTML = '';
  if (t === 'chunks') renderChunks();
  if (t === 'drill') drillNext();
  if (t === 'random') randomLauncher();
  if (t === 'chat') convLauncher();
  if (t === 'write') writeRender();
  if (t === 'stats') renderStats();
  if (t !== 'practice') {
    stopTimer();
    stopMic();
  }
}
function show(cardId) {
  ['readyCard', 'blurtCard', 'resultCard'].forEach(
    (id) => ($(id).style.display = id === cardId ? '' : 'none'),
  );
}
function renderChips() {
  $('catChips').innerHTML = CATS.map(
    (c) =>
      '<button class="chip ' +
      (state.cats.includes(c.id) ? 'on' : '') +
      '" onclick="toggleCat(\'' +
      c.id +
      '\')">' +
      c.label +
      '</button>',
  ).join('');
}
function toggleCat(id) {
  if (state.cats.includes(id)) {
    if (state.cats.length > 1) state.cats = state.cats.filter((x) => x !== id);
  } else state.cats.push(id);
  saveState();
  renderChips();
}

const PTYPES = [
  { id: 'vn', label: 'Say it in English' },
  { id: 'sit', label: 'Situation' },
  { id: 'reflex', label: 'Reflex' },
  { id: 'expr', label: 'Expression' },
  { id: 'mix', label: 'Mix' },
  { id: 'three', label: '3 ways' },
  { id: 'ladder', label: '🪜 Ladder' },
];
/* Speed ladder: one prompt, three rounds, less time each round. */
const LADDER_SECONDS = [30, 20, 12];
/* '3 ways' is a flow variation, not a prompt kind — under the hood it draws any
   kind, like Mix. Keep this list in sync wherever ptype gates kind filtering.
   'reflex' and 'expr' are judged like 'sit' (see askGemini) but each draws
   only its own curated bank, and both are kept OUT of the mix/3-ways pool
   (see pool()). 'expr' drills a fixed sentence PATTERN (e.g. "have no right
   to ___") across different scenarios — the chunk is the pattern, not a
   literal phrase to paste in verbatim. */
const KIND_PTYPES = ['vn', 'sit', 'reflex', 'expr'];
function renderTypeChips() {
  $('typeChips').innerHTML = PTYPES.map(
    (t) =>
      '<button class="chip ' +
      (state.ptype === t.id ? 'on' : '') +
      '" onclick="setPtype(\'' +
      t.id +
      '\')">' +
      t.label +
      '</button>',
  ).join('');
}
function setPtype(id) {
  state.ptype = id;
  saveState();
  renderTypeChips();
}

/* ================= prompt bank loading ================= */
/* These three banks are static files shipped with the app, not user data, so
   they're just fetched — the browser's own HTTP cache handles repeat loads, and
   hand-rolling a localStorage copy on top of it bought nothing. Each keeps a
   small in-file fallback so a failed fetch still leaves something to practise. */
async function loadBank(file, apply) {
  try {
    const r = await fetch(apiBase() + '/' + file);
    if (!r.ok) return;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length) apply(arr);
  } catch (e) {
    console.error('could not load ' + file + ':', e);
  }
}
async function loadPrompts() {
  await loadBank('prompts.json', (arr) => {
    PROMPTS = arr;
  });
}
/* Reflex prompts (the "Reflex" ptype): tiny everyday moments + the one short line a
   native fires off automatically. Kept in a SEPARATE hand-curated /reflexes.json so a
   gen_prompts.py regen of the main bank can't wipe them. Merged into the draw pool()
   at runtime; a compact cold-start fallback lives here so it works offline first-run. */
let REFLEXES = [
  { cat: 'daily', kind: 'reflex', text: 'Bạn cùng phòng mở cửa, mặt tái mét: "Dude, I think I just broke your laptop."', sample: "You're kidding, right?", chunk: "you're kidding", note: 'Câu bật ra khi nghe tin sốc mà chưa muốn tin ngay.' },
  { cat: 'daily', kind: 'reflex', text: 'Chuông cửa reo. Bạn cùng phòng đang tắm hét vọng ra: "Can someone get that?"', sample: "I'll get it!", chunk: "I'll get it", note: 'Nhận làm việc ngay tức thì, dùng cho cửa, điện thoại.' },
  { cat: 'daily', kind: 'reflex', text: 'Bạn cùng phòng than: "Mondays are the worst."', sample: 'Tell me about it.', chunk: 'tell me about it', note: 'Đồng cảm kiểu "ai mà chẳng biết", không phải bảo kể thêm.' },
];
async function loadReflexes() {
  await loadBank('reflexes.json', (arr) => {
    REFLEXES = arr;
  });
}
/* Expression prompts (the "Expression" ptype): fixed sentence PATTERNS (nomad-
   english style, e.g. "have no right to ___") paired with a scenario to apply
   them in. Same hand-curated-bank pattern as REFLEXES, in its own /expressions.json
   so a bank regen can't wipe it. A compact cold-start fallback lives here. */
let EXPRESSIONS = [
  { cat: 'social', kind: 'expr', text: "Trễ có vài phút thôi mà, đâu có nghĩa là mình không quý buổi này đâu.", sample: "Just because I'm late doesn't mean I don't care about our time together.", chunk: "just because ___ doesn't mean ___", note: 'Classic deflection pattern — pushes back without denying the fact.' },
  { cat: 'work', kind: 'expr', text: 'Cậu không có quyền tự ý làm lại cái này mà không hỏi qua cả team đâu.', sample: "You have no right to redo this without asking the team first.", chunk: 'you have no right to ___', note: 'Blunt boundary-setting — pairs well with a softer follow-up sentence.' },
  { cat: 'daily', kind: 'expr', text: 'Ít ra cậu cũng phải nói một tiếng trước khi lấy đồ của tớ chứ.', sample: "The least you could do is tell me before you take it.", chunk: 'the least you could do is ___', note: 'Signals a minimum expectation was not met.' },
];
async function loadExpressions() {
  await loadBank('expressions.json', (arr) => {
    EXPRESSIONS = arr;
  });
}
const CAT_IDS = CATS.map((c) => c.id);
/* AI-generated prompts accumulate into their own document, so the pool you've
   built up follows you between devices instead of living on whichever machine
   happened to generate it. */
async function loadMyReflexes() {
  const r = await store.get('blurt:myReflexes');
  myReflexes = [];
  if (!r) return;
  try {
    const arr = JSON.parse(r.value);
    if (Array.isArray(arr)) myReflexes = arr.filter((p) => p && p.text && p.sample && p.chunk).map((p) => ({ ...p, kind: 'reflex', mine: true }));
  } catch (e) {}
}
async function loadAiPrompts() {
  const r = await store.get('blurt:aiPrompts');
  if (!r) return;
  try {
    const arr = JSON.parse(r.value);
    if (Array.isArray(arr)) aiPrompts = arr;
  } catch (e) {
    aiPrompts = [];
  }
}
function cacheAiPrompt(p) {
  if (!p || !CAT_IDS.includes(p.cat) || !p.text || !p.sample || !p.chunk)
    return; /* only cache well-formed, categorized prompts */
  aiPrompts.push({
    cat: p.cat,
    kind: ['vn', 'sit', 'reflex', 'expr'].includes(p.kind) ? p.kind : 'sit',
    text: p.text,
    sample: p.sample,
    chunk: p.chunk,
    note: p.note || '',
  });
  if (aiPrompts.length > 200) aiPrompts = aiPrompts.slice(-200);
  store.set('blurt:aiPrompts', JSON.stringify(aiPrompts));
}

/* ================= practice flow ================= */
function pool() {
  const disliked = new Set((state.disliked || []).map(norm));
  const byCat = PROMPTS.concat(aiPrompts, REFLEXES, EXPRESSIONS).filter(
    (p) => state.cats.includes(p.cat) && !disliked.has(norm(p.text)),
  );
  /* mix / 3-ways draw any kind — but NOT reflexes or expressions (both are
     focused single-pattern drills; "say it 3 ways" makes no sense for either). */
  if (!KIND_PTYPES.includes(state.ptype))
    return byCat.filter((p) => p.kind !== 'reflex' && p.kind !== 'expr');
  let byKind = byCat.filter((p) => p.kind === state.ptype);
  /* scenes you mined are yours: they skip the mood filter */
  if (state.ptype === 'reflex') byKind = byKind.concat(myReflexes.filter((p) => !disliked.has(norm(p.text))));
  /* never strand the learner: if this kind is empty for the chosen moods, fall back to all */
  return byKind.length ? byKind : byCat;
}
const MAX_RECENT = 40; /* how many recent prompts to avoid re-serving */
/* Remember a prompt by TEXT (not object ref): identity breaks when the bank
   reloads from the network, and text lets bank + AI prompts share one history. */
function rememberPrompt(text) {
  if (!text) return;
  recentPrompts.push(text);
  while (recentPrompts.length > MAX_RECENT) recentPrompts.shift();
}
/* Settings → "Vietnamese prompts": the share of Mix / 3-ways draws that are
   Vietnamese sentences rather than English situations. */
function vnShare() {
  const v = state.settings.vnShare;
  return v >= 0 && v <= 100 ? v : 100;
}
/* 'vn' or 'sit' by that share; null at 100% (no weighting, draw as before). */
function mixDrawKind() {
  const share = vnShare();
  if (share >= 100) return null;
  return Math.random() * 100 < share ? 'vn' : 'sit';
}
function pickPrompt() {
  const ps = pool();
  let avail = ps.filter((p) => !recentPrompts.includes(p.text));
  if (!avail.length)
    avail = ps.filter(
      (p) => !current || !current.prompt || current.prompt.text !== p.text,
    ); /* tiny pool: at least dodge the last one */
  if (!avail.length) avail = ps;
  if (!KIND_PTYPES.includes(state.ptype)) {
    const k = mixDrawKind();
    const byK = k ? avail.filter((p) => p.kind === k) : [];
    if (byK.length) avail = byK;
  }
  const p = avail[Math.floor(Math.random() * avail.length)];
  rememberPrompt(p.text);
  return p;
}
/* Three explicit prompt sources: 'bank' (Start a rep), 'ai' (✨ AI prompt) and
   'replay' (a run through your past mistakes).
   nextRep / skip continue whichever you started with. */
let repSource = 'bank';
function startRep() {
  repSource = 'bank';
  endReplayRun();
  startRepWith(pickPrompt());
}
/* Result-card "Next rep →" and "Different prompt": stay on the current source. */
function nextRep() {
  if (repSource === 'replay') nextReplay();
  else if (repSource === 'ai' && loggedIn()) genPrompt();
  else startRep();
}
function startRepWith(p) {
  current = { prompt: p };
  $('promptKind').textContent =
    p.kind === 'vn'
      ? 'Say this in English'
      : p.kind === 'reflex'
        ? p.mine
          ? 'In the moment · 📺 yours'
          : 'In the moment'
        : p.kind === 'expr'
          ? 'Apply this expression'
          : 'Situation';
  $('promptText').textContent = p.text;
  const hint = $('chunkHint');
  /* 'sit' shows the target up front — you're meant to consciously reach
     for a known chunk/pattern, unlike 'reflex' where recall itself is the test.
     'expr' already gives the expression in promptText, so no separate hint. */
  if (p.kind === 'sit' && p.chunk) {
    $('chunkHintText').textContent = p.chunk;
    hint.style.display = '';
  } else hint.style.display = 'none';
  /* '3 ways': collect three different phrasings before checking. */
  const three = state.ptype === 'three';
  current.three = three ? { attempts: [], n: 1 } : null;
  current.ladder = state.ptype === 'ladder' ? { round: 1, texts: [] } : null;
  renderThreeUI();
  renderConf();
  /* "Not for me" only applies to real bank prompts (not AI-generated ones). */
  const isBank = PROMPTS.concat(REFLEXES, EXPRESSIONS, myReflexes).some((x) => norm(x.text) === norm(p.text));
  $('dislikeBtn').style.display = isBank ? '' : 'none';
  $('blurtInput').value = '';
  $('blurtInput').disabled = false;
  $('checkBtn').disabled = false;
  show('blurtCard');
  $('blurtInput').focus();
  startTimer();
}
/* Reflect the current 3-ways step in the counter + primary button label. */
/* How sure you felt before seeing the fix (optional): stored on the attempt. */
function setConf(v) {
  if (!current) return;
  current.conf = current.conf === v ? null : v;
  renderConf();
}
function renderConf() {
  const v = current && current.conf;
  $('confUnsure').classList.toggle('on', v === 'unsure');
  $('confSure').classList.toggle('on', v === 'sure');
}
function renderThreeUI() {
  const l = current && current.ladder;
  $('ladderCounter').style.display = l ? '' : 'none';
  if (l) {
    $('ladderNum').textContent = l.round;
    $('checkBtn').textContent = l.round < 3 ? 'Next round →' : 'Check it';
    return;
  }
  const t = current && current.three;
  $('threeCounter').style.display = t ? '' : 'none';
  if (t) {
    $('threeNum').textContent = t.n;
    $('checkBtn').textContent = t.n < 3 ? 'Next phrasing →' : 'Check all three';
  } else {
    $('checkBtn').textContent = 'Done — check it';
  }
}
/* The primary action: in 3-ways mode, banks the phrasing and advances (or checks
   on the third); otherwise just checks the single rep. */
/* Keep this round's text and go again with less time. */
function ladderAdvance() {
  const l = current.ladder;
  l.texts.push($('blurtInput').value.trim());
  l.round++;
  renderThreeUI();
  $('blurtInput').value = '';
  $('blurtInput').focus();
  startTimer();
}
function repPrimary() {
  if (current && current.ladder && current.ladder.round < 3) return ladderAdvance();
  const t = current && current.three;
  if (t && t.n < 3) {
    t.attempts.push($('blurtInput').value.trim());
    t.n++;
    renderThreeUI();
    $('blurtInput').value = '';
    $('blurtInput').focus();
    return;
  }
  finishRep();
}
function skipPrompt() {
  stopTimer();
  stopMic();
  nextRep(); /* "Different prompt" stays on the current source (bank or AI) */
}
/* Hide this bank prompt for good, then move on. Bank-only — pool() filters
   state.disliked out of future picks; AI prompts are never recorded here. */
function dislikePrompt() {
  if (!current || !current.prompt) return;
  const t = current.prompt.text;
  if (!state.disliked.some((x) => norm(x) === norm(t))) state.disliked.push(t);
  saveState();
  stopTimer();
  stopMic();
  nextRep();
}
function startTimer() {
  stopTimer();
  repTotal = repSeconds();
  secondsLeft = repTotal;
  $('clock').textContent = secondsLeft;
  const bar = $('timebar');
  bar.classList.remove('running');
  bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.classList.add('running');
      tick();
    }),
  );
}
function tick() {
  timer = setInterval(() => {
    secondsLeft--;
    $('clock').textContent = Math.max(secondsLeft, 0);
    $('timebar').style.transform = 'scaleX(' + secondsLeft / repTotal + ')';
    if (secondsLeft <= 0) {
      if (current && current.ladder && current.ladder.round < 3) ladderAdvance();
      else finishRep();
    }
  }, 1000);
}
function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const bar = $('timebar');
  bar.classList.remove('running');
  bar.style.transform = 'scaleX(0)';
}
function backToReady() {
  stopTimer();
  stopMic();
  endReplayRun(); /* leaving practice abandons any mistake-replay run */
  repSource = 'bank';
  const note = $('replayDoneNote');
  if (note) note.style.display = 'none';
  show('readyCard');
}

/* One homework rep done: totals, today's history, homework count, streak. */
function creditRep() {
  state.total++;
  hist().reps++;
  if (state.hw.date !== dayStr(0)) state.hw = { date: dayStr(0), reps: 0 };
  state.hw.reps++;
  saveState();
  creditStreakIfDone();
  renderHeader();
  renderHW();
}
async function finishRep() {
  stopTimer();
  stopMic();
  $('blurtInput').disabled = true;
  $('checkBtn').disabled = true;
  const blurt = $('blurtInput').value.trim();
  const p = current.prompt;

  creditRep();

  if (current.replay) {
    await finishReplay(blurt);
    return;
  }

  if (current.three) {
    await finishThreeWays(blurt);
    return;
  }

  if (current.ladder) {
    await finishLadder(blurt);
    return;
  }

  show('resultCard');
  $('yourBlurt').textContent = blurt
    ? 'You: ' + blurt
    : "You: (blank — that's okay, blank reps count too)";
  resetResultCard();

  /* Every kind uses the same layout: your sentence with only the mistakes fixed
     (as a word diff), then a native version. */
  const judged = !!blurt && p.kind !== 'expr';
  $('vnResult').style.display = 'none';
  $('sitResult').style.display = '';
  $('fixedBlock').style.display = judged ? '' : 'none';
  $('suggestBlock').style.display = '';
  if (judged) $('fixedText').innerHTML = '<span class="spin"></span> Fixing your answer...';
  $('suggestText').innerHTML = '<span class="spin"></span> Cooking up a suggestion...';
  $('noteText').textContent = '';

  let result = null;
  /* expr has no AI judging — the curated sample IS the model answer, so there's
     nothing for the AI to correct against. */
  const aiCall = judged ? askGemini(p, blurt) : Promise.resolve(null);
  /* Predict the fix: while the AI works, tap the words you expect to change. */
  const predicting = judged && state.settings.predict !== false;
  let picks = null;
  if (predicting) {
    $('sitResult').style.display = 'none';
    picks = await predictGate(blurt);
    $('sitResult').style.display = '';
  }
  result = await aiCall;
  /* No AI answer (blank rep, expr, or AI down): show the bank's sample only —
     never present it as a correction of what they wrote. */
  const fallback = !result;
  if (fallback) result = { natural: p.sample, chunk: p.chunk, note: p.note };
  if (p.kind !== 'vn' && p.chunk) result.chunk = p.chunk;
  /* Reflex: the bank's line is the model answer (it holds the chunk, so it's
     what gets saved and drilled); the AI's extra lines are just alternatives. */
  let others = '';
  if (p.kind === 'reflex' && p.sample) {
    others = fallback ? '' : String(result.natural || '').trim();
    result.natural = p.sample;
  }
  const fixed = fallback ? '' : result.fixedAnswer || '';
  const native = result.natural || fixed;
  const clean = !!fixed && (result.clean === true || norm(blurt) === norm(fixed));
  result.clean = clean;
  lastResult = result;
  showCalque(clean ? '' : result.calque);

  $('cleanLead').style.display = clean ? '' : 'none';
  const pred = picks && !fallback && fixed ? predictScore(blurt, fixed, clean, picks) : null;
  if (picks) predictShow(blurt, fixed, clean, picks, pred);
  const showFixed = judged && !!fixed && !clean;
  $('fixedBlock').style.display = showFixed ? '' : 'none';
  if (showFixed) {
    $('fixedText').innerHTML = wordDiff(blurt, fixed);
    $('fixedChunkText').textContent = result.chunk;
    /* The chunk box saves your own fixed sentence as the drill example, so only
       offer it when Drill can actually blank the chunk in that sentence. */
    $('fixedChunkBox').style.display = drillBlank(result.chunk, fixed).hasBlank ? '' : 'none';
  }
  const dupe = !!fixed && norm(native) === norm(fixed);
  $('suggestEyebrow').textContent = clean
    ? dupe
      ? 'Exactly how a native would say it'
      : 'Another way a native might say it'
    : showFixed
      ? 'Or say it like this'
      : p.kind === 'expr'
        ? 'How the pattern fills in'
        : 'How a native might say it';
  /* A native version identical to the fix adds nothing — unless it's all we show. */
  $('suggestBlock').style.display = showFixed && dupe ? 'none' : '';
  $('suggestText').innerHTML =
    esc(native) +
    (others && norm(others) !== norm(native)
      ? '<div class="meta" style="margin-top:6px;font-size:.85rem;color:var(--muted)">also: ' + esc(others) + '</div>'
      : '');
  $('suggestChunkText').textContent = result.chunk;
  $('noteText').textContent = result.note || '';

  /* answer's in — put focus on the Save button so Tab/Enter work without the mouse. */
  const saveBtn = visibleSaveBtn();
  if (saveBtn) saveBtn.focus();

  /* Blank reps have nothing to learn from. clean stays null when no AI graded it. */
  if (blurt)
    logAttempt({
      source: 'practice',
      kind: p.kind,
      prompt: p.text,
      blurt,
      fix: fixed || result.natural || '',
      natural: native,
      note: result.note || '',
      tags: fallback ? [] : result.tags,
      clean: fallback || p.kind === 'expr' ? null : clean,
      conf: current.conf || null,
      pred,
    });
}

/* ---- predict the fix ---- */
let predictResolve = null;
/* Shows your words as buttons; resolves with the picked word indexes on Reveal. */
function predictGate(blurt) {
  const words = blurt.split(/\s+/).filter(Boolean);
  $('predBox').style.display = '';
  $('predBox').innerHTML =
    '<div class="eyebrow">🎯 Before you see it: tap the words you think will change</div>' +
    '<div class="predWords">' +
    words.map((w, i) => '<button class="predWord" data-i="' + i + '" onclick="this.classList.toggle(\'picked\')">' + esc(w) + '</button>').join('') +
    '</div><div class="row"><button class="btn pulse" id="predReveal" onclick="predictReveal()">Reveal</button></div>';
  $('predReveal').focus({ preventScroll: true });
  return new Promise((res) => (predictResolve = res));
}
function predictReveal() {
  const picks = [...document.querySelectorAll('#predBox .predWord.picked')].map((b) => Number(b.dataset.i));
  $('predBox').innerHTML = '<p class="hint"><span class="spin"></span> Checking…</p>';
  if (predictResolve) predictResolve(picks);
  predictResolve = null;
}
/* Right when every changed word was picked (a missing word counts as found if
   you picked a word next to the gap), with at most one extra pick. A clean rep
   is right only with no picks. */
function predictScore(blurt, fixed, clean, picks) {
  const P = new Set(picks);
  if (clean) return P.size === 0;
  const { ops } = diffOps(blurt, fixed);
  const n = blurt.split(/\s+/).filter(Boolean).length;
  const dels = ops.filter((o) => o.op === 'del').map((o) => o.i);
  const gaps = ops.filter((o) => o.op === 'ins').map((o) => [o.i - 1, o.i].filter((x) => x >= 0 && x < n));
  const expected = new Set(dels.concat(...gaps));
  const found = dels.every((d) => P.has(d)) && gaps.every((g) => !g.length || g.some((x) => P.has(x)));
  return found && [...P].filter((x) => !expected.has(x)).length <= 1;
}
function predictShow(blurt, fixed, clean, picks, pred) {
  const words = blurt.split(/\s+/).filter(Boolean);
  const changed = new Set(clean ? [] : diffOps(blurt, fixed).ops.filter((o) => o.op === 'del').map((o) => o.i));
  const P = new Set(picks);
  $('predBox').innerHTML =
    '<div class="eyebrow">🎯 ' +
    (pred === null ? 'Your picks' : pred ? 'You saw it coming' : clean ? 'Nothing needed changing' : 'Not quite') +
    '</div><div class="predWords">' +
    words
      .map((w, i) => '<button class="predWord' + (changed.has(i) ? (P.has(i) ? ' hit' : ' miss') : P.has(i) ? ' picked' : '') + '" disabled>' + esc(w) + '</button>')
      .join('') +
    '</div>';
}
function togglePredict() {
  state.settings.predict = state.settings.predict === false;
  saveState();
  renderPredict();
}
function renderPredict() {
  const on = state.settings.predict !== false;
  $('predictChip').textContent = on ? '🎯 on' : 'off';
  $('predictChip').classList.toggle('on', on);
}

/* Flag a word-for-word translation from Vietnamese when the AI spots one. */
function showCalque(text) {
  const has = !!(text && String(text).trim());
  $('calqueNote').style.display = has ? '' : 'none';
  if (has) $('calqueText').textContent = String(text).trim();
}

/* Internal labels for what went wrong, used only for stats (never shown as
   grammar jargon in the notes). */
const ERROR_TAGS = ['article', 'tense', 'preposition', 'word-order', 'word-choice', 'plural', 'missing-word', 'calque', 'none'];
const TAGS_FIELD =
  '"tags":["which of these describe their mistakes: ' + ERROR_TAGS.join(', ') + '. Use [\\"none\\"] when there were none."]';
/* Keep only known tags, once each; "none" is implied by an empty list. */
function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()))].filter(
    (t) => t !== 'none' && ERROR_TAGS.includes(t),
  );
}
const truthy = (v) => v === true || v === 'true';

async function askGemini(p, blurt) {
  let task, instr;
  if (p.kind === 'vn') {
    task = 'The prompt was a Vietnamese sentence to express in English: "' + p.text + '"';
    instr =
      '{"fixedAnswer":"THEIR sentence, corrected. Keep their own words and structure; change only what is grammatically wrong, unclear, or unnatural. This is their answer cleaned up — NOT a rewrite. If nothing needs changing, copy it exactly.","clean":"true if their sentence needed no meaningful change (a native would say it that way, ignoring capitalization and punctuation), else false","natural":"how a native speaker would naturally say it (casual register, 1-2 sentences, keep their intended meaning)","chunk":"the single most reusable multi-word phrase from your natural version worth memorizing","calque":"ONLY if their attempt is a word-for-word translation from Vietnamese that a native would never say (e.g. wrong word order, literal idiom): one short line naming the calque and the natural shape instead. Otherwise empty string.",' +
      TAGS_FIELD +
      ',"note":"one short encouraging coaching note (max 22 words). If clean, say specifically what they did well. Otherwise name the main fix."}';
  } else if (p.kind === 'reflex') {
    task =
      'Reflex drill: a scene narrated in Vietnamese; quoted lines are what the learner just heard, in English. They had 8 seconds to TYPE the instant reply a native would fire back.\nScene: "' +
      p.text +
      '"\nExample reply: "' +
      p.sample +
      '"';
    instr =
      '{"fixedAnswer":"THEIR reply, minimally corrected: keep their words, fix only what a native would not say. Copy it exactly if it works.","clean":"true if their reply would land as a natural instant reaction in that moment. Be generous: any idiomatic line that fits counts, it does NOT have to match the example. Else false.","natural":"up to 2 other short lines a native might fire back here, separated by \\" / \\"","chunk":"the key phrase from the example reply, copied exactly","calque":"ONLY if their reply is a word-for-word translation a native would never say: one short line naming it. Otherwise empty string.",' +
      TAGS_FIELD +
      ',"note":"ONE line IN VIETNAMESE (max 20 words): did it land as an instant reaction, and when this kind of line fires"}';
  } else {
    task =
      'Situation: "' +
      p.text +
      '"' +
      (p.chunk ? '\nTarget chunk to practice: "' + p.chunk + '"' : '');
    instr =
      '{"fixedAnswer":"THEIR sentence, corrected. Keep their own words and structure; change only what is grammatically wrong, unclear, or unnatural, and make sure the target chunk is used. This is their answer cleaned up — NOT a rewrite.","clean":"true if their sentence needed no meaningful change (natural as written and it uses the target chunk; ignore capitalization and punctuation), else false","natural":"a different, native way to say it that uses the target chunk. Must NOT be the same sentence as fixedAnswer.","chunk":"the target chunk, copied exactly","calque":"ONLY if their attempt is a word-for-word translation from Vietnamese that a native would never say (wrong word order, literal idiom): one short line naming the calque and the natural shape instead. Otherwise empty string.",' +
      TAGS_FIELD +
      ',"note":"one short tip (max 20 words). If clean, say specifically what they did well. Otherwise: did they use the chunk well, and the key fix."}';
  }
  const userMsg = `You are a friendly English fluency coach for a Vietnamese software developer practicing fast speech-like production.
${task}
Their fast, unedited attempt: "${blurt}"

Reply with ONLY a JSON object:
${instr}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: userMsg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !obj.chunk) return null;
  obj.clean = truthy(obj.clean);
  obj.tags = cleanTags(obj.tags);
  if (p.kind === 'sit' || p.kind === 'reflex' || p.kind === 'expr') {
    /* situation/reflex/expression need at least one answer field; fill the missing
       one from the other so the renderer always has a real value to show. */
    if (!obj.fixedAnswer && !obj.natural) return null;
    if (!obj.fixedAnswer) obj.fixedAnswer = obj.natural;
    if (!obj.natural) obj.natural = obj.fixedAnswer;
    return obj;
  }
  if (obj.natural) return obj;
  return null;
}

/* '3 ways': judge three phrasings of the same idea. Returns {best, natural, chunk,
   note} or null on failure. `best` is a 1-based index into the attempts. */
async function askGeminiThreeWays(p, attempts) {
  const tries = attempts
    .map((a, i) => i + 1 + ') ' + (a || '(blank)'))
    .join('\n');
  const framing =
    p.kind === 'vn'
      ? 'Idea to express (Vietnamese): "' + p.text + '"'
      : 'Situation they responded to: "' + p.text + '"';
  const userMsg = `A Vietnamese software developer practiced saying ONE idea three different ways to build fluency flexibility.
${framing}
Their three attempts:
${tries}
Pick which attempt sounds most natural, then give one fresh native model version, the key reusable chunk, and a short note.
Reply with ONLY a JSON object:
{"best":1,"clean":"true if the best attempt needed no meaningful change (ignore capitalization and punctuation), else false",${TAGS_FIELD.replace('their mistakes', 'the mistakes in the best attempt')},"natural":"one natural native version (1-2 sentences)","chunk":"the single most reusable phrase from your native version","note":"max 22 words: which attempt was most natural and one quick tip"}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: userMsg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !obj.natural || !obj.chunk) return null;
  obj.clean = truthy(obj.clean);
  obj.tags = cleanTags(obj.tags);
  return obj;
}

async function askGeminiLadder(p, rounds) {
  const framing =
    p.kind === 'vn' ? 'Idea to express (Vietnamese): "' + p.text + '"' : 'Situation: "' + p.text + '"';
  const obj = await aiObj({
    contents: [
      {
        parts: [
          {
            text: `A Vietnamese software developer said ONE idea three times with a shrinking timer (30s, then 20s, then 12s) to beat their inner editor.
${framing}
Round 1: "${rounds[0] || '(blank)'}"
Round 2: "${rounds[1] || '(blank)'}"
Round 3: "${rounds[2] || '(blank)'}"
Reply with ONLY a JSON object:
{"fixedAnswer":"their ROUND 3 attempt, minimally corrected: keep their words, change only what is wrong or unnatural; copy exactly if fine","clean":"true if round 3 needed no meaningful change, else false",${TAGS_FIELD.replace('their mistakes', 'the mistakes in round 3')},"natural":"one natural native version (1-2 sentences)","chunk":"the single most reusable phrase from your native version","note":"max 22 words: what got looser or better under time pressure, and one tip"}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !obj.natural) return null;
  obj.clean = truthy(obj.clean);
  obj.tags = cleanTags(obj.tags);
  return obj;
}
async function finishLadder(last) {
  const p = current.prompt;
  const rounds = [...current.ladder.texts, last];
  const final = [...rounds].reverse().find(Boolean) || '';
  show('resultCard');
  resetResultCard();
  showCalque('');
  $('vnResult').style.display = '';
  $('sitResult').style.display = 'none';
  $('yourBlurt').innerHTML =
    'Your three rounds:' +
    rounds
      .map(
        (r, i) =>
          '<div>' + LADDER_SECONDS[i] + 's · ' + (r ? esc(r) + ' <small>(' + r.split(/\s+/).length + ' words)</small>' : '(blank)') + '</div>',
      )
      .join('');
  $('naturalText').innerHTML = '<span class="spin"></span> Checking round 3...';
  $('chunkText').textContent = '...';
  $('noteText').textContent = '';
  const res = final ? await askGeminiLadder(p, rounds) : null;
  const out = res || { natural: p.sample, chunk: p.chunk || '', note: p.note || '' };
  lastResult = { natural: out.natural, chunk: out.chunk || '', note: out.note || '' };
  const fixed = res ? String(res.fixedAnswer || '').trim() : '';
  const clean = !!fixed && (res.clean || norm(final) === norm(fixed));
  $('cleanLead').style.display = clean ? '' : 'none';
  $('naturalText').innerHTML =
    (fixed && !clean ? '<div class="diff">' + wordDiff(final, fixed) + '</div><div class="eyebrow" style="margin:12px 0 4px">A native might say</div>' : '') +
    esc(out.natural);
  $('chunkText').textContent = out.chunk || '—';
  $('noteText').textContent = out.note || '';
  if (final)
    logAttempt({
      source: 'practice',
      kind: 'ladder',
      conf: current.conf || null,
      prompt: p.text,
      blurt: final,
      fix: fixed || out.natural || '',
      natural: out.natural || '',
      note: out.note || '',
      tags: res ? res.tags : [],
      clean: res && fixed ? clean : null,
    });
}
async function finishThreeWays(lastAttempt) {
  const p = current.prompt;
  const takes = [...current.three.attempts, lastAttempt]; /* 3 entries, blanks allowed */
  const nonBlank = takes.filter(Boolean);

  show('resultCard');
  showCalque('');
  $('vnResult').style.display = '';
  $('sitResult').style.display = 'none';
  $('yourBlurt').innerHTML =
    'You tried:' +
    takes.map((a, i) => '<div>' + (i + 1) + '. ' + (a ? esc(a) : '(blank)') + '</div>').join('');
  resetResultCard();
  $('naturalText').innerHTML = '<span class="spin"></span> Picking your most natural take...';
  $('chunkText').textContent = '...';
  $('noteText').textContent = '';

  let res = null;
  if (nonBlank.length) res = await askGeminiThreeWays(p, takes);
  const graded = !!res;
  if (!res) res = { best: 1, natural: p.sample, chunk: p.chunk || '', note: p.note || '' };
  lastResult = { natural: res.natural, chunk: res.chunk, note: res.note };

  /* mark the AI's pick among the three tries */
  const bi = Math.min(Math.max(parseInt(res.best, 10) || 1, 1), takes.length) - 1;
  $('yourBlurt').innerHTML =
    'You tried:' +
    takes
      .map(
        (a, i) =>
          '<div' +
          (i === bi ? ' style="color:var(--mint)"' : '') +
          '>' +
          (i + 1) +
          '. ' +
          (a ? esc(a) : '(blank)') +
          (i === bi ? ' ← most natural' : '') +
          '</div>',
      )
      .join('');
  $('naturalText').textContent = res.natural;
  $('chunkText').textContent = res.chunk || '—';
  $('noteText').textContent = res.note || '';

  /* log the chosen take so warm-up / replay can re-serve it */
  if (nonBlank.length)
    logAttempt({
      source: 'three',
      kind: p.kind,
      conf: current.conf || null,
      prompt: p.text,
      blurt: takes[bi] || nonBlank[0],
      fix: res.natural || '',
      natural: res.natural || '',
      note: res.note || '',
      tags: res.tags,
      clean: graded ? res.clean : null,
    });
}

/* ================= mistake replay ================= */
/* Re-serve a past prompt you flubbed so you can beat your earlier attempt; the
   AI judges whether the old slip is gone. A prompt stays in the pool until its
   latest attempt is clean, and only the 30 most recent misses are kept. */
const REPLAY_SOURCES = ['practice', 'three', 'replay'];
function replayPool() {
  const latest = new Map();
  attempts.forEach((a) => {
    if (REPLAY_SOURCES.includes(a.source) && a.prompt && a.blurt) latest.set(a.prompt, a);
  });
  return [...latest.values()]
    .filter((r) => r.fix && r.clean !== true && norm(r.blurt) !== norm(r.fix))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-30);
}
/* Chunks you've saved but never actually used in a rep answer — the ones rotting
   on the shelf. genPrompt targets these to force them into real use. */
function avoidedChunks() {
  const used = attempts.map((r) => norm(r.blurt || ''));
  return chunks.filter((c) => c.chunk && !used.some((b) => b && b.includes(norm(c.chunk))));
}
/* The session warm-up: re-serve one recent miss. Prefer a miss from a PRIOR day —
   a day-later retry is exactly when retrieval cements the fix — else the latest one.
   Null once it's been done today, so it stops nagging. */
function warmupPick() {
  if (state.warmup && state.warmup.done) return null;
  const p = replayPool();
  if (!p.length) return null;
  const today = dayStr(0);
  const prior = p.filter((r) => r.d && r.d < today);
  return (prior.length ? prior : p)[(prior.length ? prior : p).length - 1];
}
/* A replay RUN: entering "Replay a past mistake" queues up EVERY unfixed miss and
   walks it oldest-first, so Next rep keeps serving misses until the queue is empty
   instead of dropping you back into fresh practice. */
let replayRun = null; /* { queue: [...pending], total, done } */
function endReplayRun() {
  replayRun = null;
}
/* Next miss in the run, or wrap it up when there are none left. */
function nextReplay() {
  if (replayRun && replayRun.queue.length) return startReplay();
  const total = replayRun ? replayRun.total : 0;
  endReplayRun();
  repSource = 'bank';
  show('readyCard');
  const note = $('replayDoneNote');
  if (note && total) {
    note.textContent =
      '✓ That’s all ' + total + ' past mistake' + (total > 1 ? 's' : '') + ' re-attempted. Nice.';
    note.style.display = '';
  }
}
function startReplay(orig, opts) {
  const warmup = !!(opts && opts.warmup);
  const single = !!(opts && opts.single); /* one attempt from the archive, outside any run */
  if (single) {
    endReplayRun();
    repSource = 'bank'; /* Next rep goes back to normal practice */
  } else if (!warmup) {
    /* start a fresh run unless one is already in progress */
    if (!replayRun || !replayRun.queue.length) {
      const pool = replayPool();
      if (!pool.length) return;
      replayRun = { queue: pool.slice(), total: pool.length, done: 0 };
    }
    repSource = 'replay';
    orig = replayRun.queue.shift();
    replayRun.done++;
  }
  if (!orig) return;
  const note = $('replayDoneNote');
  if (note) note.style.display = 'none';
  current = { prompt: { kind: 'replay', text: orig.prompt }, replay: orig };
  if (warmup) current.warmup = true;
  $('promptKind').textContent = current.warmup
    ? '🔥 Warm-up — beat last time'
    : replayRun
      ? 'Re-attempt ' + replayRun.done + ' of ' + replayRun.total + ' — beat last time'
      : 'Re-attempt — beat last time';
  $('promptText').textContent = orig.prompt;
  $('chunkHint').style.display = 'none';
  $('dislikeBtn').style.display = 'none'; /* replays aren't bank prompts */
  renderThreeUI(); /* clear any leftover 3-ways counter/label from a prior rep */
  renderConf();
  $('blurtInput').value = '';
  $('blurtInput').disabled = false;
  $('checkBtn').disabled = false;
  show('blurtCard');
  $('blurtInput').focus();
  startTimer();
}
async function replayJudge(orig, blurt) {
  const msg = `A Vietnamese software developer is re-attempting a past speaking prompt to fix an earlier mistake.
Prompt: "${orig.prompt}"
Their earlier attempt (had issues): "${orig.blurt}"
The corrected version they were shown then: "${orig.fix}"
Their NEW attempt: "${blurt}"
Judge whether the new attempt avoids the earlier mistake and sounds natural. Reply with ONLY JSON:
{"improved":true or false,"clean":"true if the NEW attempt needed no meaningful change (ignore capitalization and punctuation), else false",${TAGS_FIELD.replace('their mistakes', 'the mistakes in the NEW attempt')},"natural":"the most natural way to say it (1-2 sentences)","chunk":"the single most reusable phrase from the natural version","note":"one short coaching note, max 22 words"}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: msg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !obj.natural) return null;
  obj.improved = truthy(obj.improved) ? true : obj.improved === false || obj.improved === 'false' ? false : null;
  obj.clean = truthy(obj.clean);
  obj.tags = cleanTags(obj.tags);
  return obj;
}
async function finishReplay(blurt) {
  if (current.warmup) {
    state.warmup = { date: dayStr(0), done: true };
    saveState();
    renderHW(); /* advance the action button to the next thing */
  }
  show('resultCard');
  showCalque('');
  $('yourBlurt').textContent = blurt ? 'You now: ' + blurt : "You: (blank — that's okay)";
  resetResultCard();
  $('vnResult').style.display = '';
  $('sitResult').style.display = 'none';
  $('naturalText').innerHTML = '<span class="spin"></span> Comparing with last time...';
  $('chunkText').textContent = '...';
  $('noteText').textContent = '';
  const orig = current.replay;
  const res = blurt ? await replayJudge(orig, blurt) : null;
  const out = res || { improved: null, natural: orig.fix, chunk: '', note: '' };
  if (blurt)
    logAttempt({
      source: 'replay',
      kind: orig.kind || null,
      prompt: orig.prompt,
      blurt,
      fix: out.natural || '',
      natural: out.natural || '',
      note: out.note || '',
      tags: res ? res.tags : [],
      clean: res ? res.clean : null,
    });
  lastResult = { natural: out.natural, chunk: out.chunk || '', note: out.note || '' };
  const verdict =
    out.improved === true
      ? '<div class="verdict good">✓ Better this time!</div>'
      : out.improved === false
        ? '<div class="verdict badv">Same slip crept in — worth another go.</div>'
        : '';
  $('naturalText').innerHTML =
    verdict +
    (blurt
      ? '<div class="replayOld diff" style="margin:6px 0">Last time → now: ' +
        wordDiff(orig.blurt, blurt) +
        '</div>'
      : '<div class="replayOld" style="opacity:.7;margin:6px 0">Last time you said: ' +
        esc(orig.blurt) +
        '</div>') +
    '<div>' +
    esc(out.natural) +
    '</div>';
  $('chunkText').textContent = out.chunk || '—';
  $('noteText').textContent = out.note || '';
}

/* ================= write tab: freewrite, journal, draft ================= */
const WRITE_MODES = [
  { id: 'free', label: '⏱ Freewrite' },
  { id: 'journal', label: '📓 Journal' },
  { id: 'draft', label: '✉️ Draft a message' },
  { id: 'react', label: '💬 React' },
  { id: 'copy', label: '📄 Copy' },
  { id: 'explain', label: '🧑‍🏫 Explain' },
  { id: 'dialogue', label: '🗣 Two voices' },
];
const EXPLAIN_TOPICS = ['what a race condition is', 'why we use feature flags', 'how our deploy works', 'what a code review is for', 'why tests sometimes flake', 'what technical debt is', 'how caching speeds things up', 'what an API is, to a non-developer', 'why we write migrations', 'how git branches work', 'what a memory leak is', 'why the build is slow', 'what "eventual consistency" means', 'how you debug a bug you can\'t reproduce', 'why naming things is hard', 'what a database index does', 'how retries can make things worse', 'what a staging environment is for', 'why we pair program', 'how you estimate a task', 'what an on-call rotation is', 'why rollbacks matter', 'what a feature freeze is', 'how rate limiting works', 'why logs matter at 3 a.m.', 'what a pull request should include', 'how you onboard to a new codebase', 'what "done" means for a ticket', 'why small commits help', 'how a queue decouples services', 'what a timezone bug looks like', 'why we avoid global state', 'how you say no to scope creep', 'what a postmortem is', 'why accessibility matters', 'how CI catches problems early', 'what the difference is between a bug and a feature request', 'how you split a big task', 'why we document decisions', 'what happens when you type a URL'];
/* A dev topic to explain, sometimes built from your own context in Settings. */
function explainTopic() {
  const bits = (state.settings.context || '')
    .split(/[;.,\n]+/)
    .map((x) => x.trim())
    /* needs to be a real thing to explain, not "PM is Minh" */
    .filter((x) => x.split(/\s+/).length >= 4 && x.length <= 60);
  if (bits.length && Math.random() < 0.3) return 'something from your work: ' + bits[Math.floor(Math.random() * bits.length)];
  return EXPLAIN_TOPICS[Math.floor(Math.random() * EXPLAIN_TOPICS.length)];
}
/* The other voice in a dialogue: a name from "PM is Minh"-style context, else PM. */
function dialogueRole() {
  const m = (state.settings.context || '').match(/\b(?:PM|manager|lead|boss)\s+is\s+([A-Z][a-z]+)/);
  return m ? m[1] : 'PM';
}
function dialogueSeed() {
  const sit = PROMPTS.filter((p) => p.kind === 'sit' && state.cats.includes(p.cat));
  const src = sit.length ? sit : PROMPTS.filter((p) => p.kind === 'sit');
  return src.length ? src[Math.floor(Math.random() * src.length)].text : 'You need to ask for a deadline extension.';
}
const REACT_ICONS = { reddit: '👽 Reddit comment', slack: '💬 Slack', text: '📱 Text', email: '✉️ Email' };
let REACTS = null; /* backup texts (reacts.json) for when the AI is down */
const STALL_MS = 5000; /* no keystroke this long → nudge */
/* mode, seed prompt, and the live freewrite (timer, attempt) */
let write = { mode: 'free', seed: null, phase: 'idle', left: 0, timer: null, lastKey: 0, attempt: null, sents: [] };

function freeMin() {
  return state.settings.freeMin || 3;
}
/* What the freewrite starts from. Each stage leans less on Vietnamese; the app
   suggests the next one once the current one is going well, never forces it. */
const FREE_STAGES = [
  { id: 'vi', label: '🇻🇳 Vietnamese idea' },
  { id: 'en', label: '🇬🇧 English situation' },
  { id: 'topic', label: '🏷 One word' },
  { id: 'none', label: '⬜ Blank page' },
];
const FREE_TOPICS = ['deadlines', 'coffee', 'weekends', 'your commute', 'a bug', 'rain', 'your manager', 'sleep', 'money', 'a movie', 'music', 'your hometown', 'cooking', 'a friend', 'mistakes', 'luck', 'your phone', 'the gym', 'meetings', 'holidays', 'noise', 'waiting', 'a gift', 'your desk', 'learning', 'traffic', 'a promise', 'food delivery', 'family dinners', 'a decision', 'being late', 'first days', 'small talk', 'your laptop', 'patience', 'a surprise', 'code reviews', 'moving house', 'weather', 'tomorrow'];
function freeStage() {
  return FREE_STAGES.some((x) => x.id === state.settings.freeSeed) ? state.settings.freeSeed : 'vi';
}
function freeSeed() {
  const st = freeStage();
  const draw = (kind) => {
    const all = PROMPTS.filter((p) => p.kind === kind);
    const mine = all.filter((p) => state.cats.includes(p.cat));
    const src = mine.length ? mine : all;
    return src.length ? src[Math.floor(Math.random() * src.length)] : null;
  };
  if (st === 'en') return draw('sit') || { text: 'Tell someone about your day.' };
  if (st === 'topic') return { text: FREE_TOPICS[Math.floor(Math.random() * FREE_TOPICS.length)] };
  if (st === 'none') return { text: 'Blank page. Whatever is on your mind.' };
  return draw('vn') || { text: 'Hôm nay của bạn thế nào?' };
}
function setFreeStage(id) {
  state.settings.freeSeed = id;
  saveState();
  write.seed = freeSeed();
  writeRender();
}
/* 5+ freewrites at this stage, and ≥70% clean among the ones you had checked. */
function freeStageReady() {
  const st = freeStage();
  if (st === 'none') return null;
  const done = attempts.filter((a) => a.source === 'free' && a.kind === 'free:' + st);
  const graded = done.filter((a) => a.clean != null);
  if (done.length < 5 || (graded.length && graded.filter((a) => a.clean).length / graded.length < 0.7)) return null;
  return FREE_STAGES[FREE_STAGES.findIndex((x) => x.id === st) + 1];
}
function setWriteMode(m) {
  if (write.phase === 'running') return; /* finish the freewrite first */
  write.mode = m;
  write.phase = 'idle';
  write.attempt = null;
  write.sents = [];
  if (m === 'free') write.seed = freeSeed();
  if (m === 'react') write.react = null;
  if (m === 'copy') write.copy = null;
  if (m === 'explain') write.topic = null;
  if (m === 'dialogue') write.scene = null;
  if (m === 'explain' || m === 'dialogue') $('writeInput').value = '';
  if (m === 'rewrite') {
    write.rewrite = yesterdayEntry();
    $('writeInput').value = '';
  }
  writeRender();
}
function writeRender() {
  const m = write.mode,
    inp = $('writeInput');
  const modes = yesterdayEntry() ? WRITE_MODES.concat({ id: 'rewrite', label: '↻ Rewrite yesterday' }) : WRITE_MODES;
  if (m === 'rewrite' && !write.rewrite) write.rewrite = yesterdayEntry();
  if (m === 'rewrite' && !write.rewrite) return setWriteMode('journal'); /* nothing from yesterday anymore */
  $('writeModes').innerHTML = modes.map(
    (x) =>
      '<button class="chip ' +
      (m === x.id ? 'on' : '') +
      '" onclick="setWriteMode(\'' +
      x.id +
      '\')">' +
      x.label +
      '</button>',
  ).join('');
  $('writeTimer').style.display = m === 'free' ? '' : 'none';
  inp.classList.remove('stalling');
  $('writeSeed').style.fontSize = '';
  if (m === 'free') {
    if (!write.seed) write.seed = freeSeed();
    $('writeEyebrow').textContent = 'no backspace · keep going';
    if (freeStage() === 'en') $('writeSeed').style.fontSize = '1.1rem'; /* situations are long */
    $('writeSeed').textContent = write.seed.text;
    inp.placeholder = 'Start typing in English. Anything that comes to mind. Mistakes stay.';
    if (write.phase === 'idle') {
      inp.value = '';
      inp.disabled = true;
      $('writeTimer').textContent = fmtClock(freeMin() * 60);
      $('writeHint').textContent =
        freeMin() + ' minutes, no deleting, no pasting. It only gets checked if you ask.';
      $('writeActions').innerHTML =
        '<button class="btn pulse" onclick="startFreewrite()">▶ Start ' +
        freeMin() +
        ':00</button><button class="btn ghost" onclick="setWriteMode(\'free\')">Another idea</button>';
      const next = freeStageReady();
      $('writeResult').innerHTML =
        '<div class="chips">' +
        FREE_STAGES.map(
          (x) =>
            '<button class="chip ' + (freeStage() === x.id ? 'on' : '') + '" onclick="setFreeStage(\'' + x.id + '\')">' + x.label + '</button>',
        ).join('') +
        '</div>' +
        (next
          ? '<p class="hint">This stage is going well. Ready for the next one? <button class="btn ghost" style="margin-left:6px;padding:6px 12px" onclick="setFreeStage(\'' +
            next.id +
            '\')">→ ' +
            next.label +
            '</button></p>'
          : '');
    }
  } else if (m === 'rewrite' && write.rewrite) {
    const y = write.rewrite;
    $('writeEyebrow').textContent = '↻ Rewrite yesterday · fresh, from memory';
    $('writeSeed').style.fontSize = '1.02rem';
    $('writeSeed').innerHTML =
      '<span class="reactMeta">Yesterday you wrote about</span><span class="reactText">' + esc(y.prompt || '(no prompt)') + '</span>';
    /* a cue, never the whole entry: at most 8 words, at most half of it */
    const words = y.text.split(/\s+/);
    const cue = words
      .slice(0, Math.min(8, Math.ceil(words.length / 2)))
      .join(' ')
      .replace(/[^A-Za-z0-9'’]+$/, '');
    $('writeHint').textContent = 'It started: “' + cue + '…”. Write it again from scratch; the fixes come after.';
    inp.disabled = false;
    inp.placeholder = 'Write it again…';
    $('writeActions').innerHTML =
      write.phase === 'checked' ? '' : '<button class="btn pulse" id="writeCheckBtn" onclick="writeCheckNow()">Check it</button>';
    if (write.phase === 'idle') $('writeResult').innerHTML = '';
  } else if (m === 'explain' || m === 'dialogue') {
    const ex = m === 'explain';
    if (ex && !write.topic) write.topic = explainTopic();
    if (!ex && !write.scene) write.scene = dialogueSeed();
    $('writeEyebrow').textContent = ex ? 'Explain it · to a new teammate' : 'Two voices · write both sides';
    if (!ex) $('writeSeed').style.fontSize = '1.1rem';
    $('writeSeed').textContent = ex ? 'Explain ' + write.topic + '.' : write.scene;
    inp.disabled = false;
    if (write.phase === 'idle') {
      const role = dialogueRole();
      inp.value = ex ? '' : inp.value.trim() ? inp.value : 'You: \n' + role + ': \nYou: \n' + role + ': ';
      $('writeResult').innerHTML = ex
        ? '<input class="drillIn" id="explainOwn" autocomplete="off" placeholder="…or type your own topic, then Enter" style="margin-top:14px">'
        : '';
      const own = $('explainOwn');
      if (own)
        own.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !own.value.trim()) return;
          e.preventDefault();
          write.topic = own.value.trim();
          writeRender();
        });
    }
    inp.placeholder = ex ? 'A few sentences, plain words…' : '';
    $('writeHint').textContent = ex
      ? 'Plain words, like you would say it at the whiteboard. The check also says if a new teammate would get it.'
      : 'Play both people. The check looks at every line, and at how your questions sound.';
    $('writeActions').innerHTML =
      (write.phase === 'checked' ? '' : '<button class="btn pulse" id="writeCheckBtn" onclick="writeCheckNow()">Check it</button>') +
      '<button class="btn ghost" onclick="writeNewSeed()">' + (ex ? 'Another topic' : 'Another scene') + '</button>';
  } else if (m === 'copy') {
    $('writeEyebrow').textContent = 'Copy · type it out, word for word';
    inp.disabled = write.phase === 'checked';
    inp.placeholder = 'Type it out…';
    $('writeHint').textContent = 'The clock starts on your first key. Native phrasing goes in through your fingers.';
    $('writeActions').innerHTML =
      (write.phase === 'checked' ? '' : '<button class="btn pulse" onclick="copyDone()">Done</button>') +
      '<button class="btn ghost" onclick="copyNext()">Another one</button>';
    if (!write.copy) copyNext();
    else renderReactSeed(write.copy.r);
  } else if (m === 'react') {
    $('writeEyebrow').textContent = 'React · read it, then reply';
    inp.disabled = false;
    inp.placeholder = 'Your reply…';
    $('writeHint').textContent = 'Reply like you would for real. The check also says if your tone fits theirs.';
    $('writeActions').innerHTML =
      (write.phase === 'checked' ? '' : '<button class="btn pulse" id="writeCheckBtn" onclick="writeCheckNow()">Check it</button>') +
      '<button class="btn ghost" onclick="reactNext()">Another one</button>';
    if (!write.react) reactNext();
    else renderReactSeed();
    if (write.phase === 'idle') $('writeResult').innerHTML = '';
  } else {
    const journal = m === 'journal';
    $('writeEyebrow').textContent = journal ? 'Journal · casual' : 'Draft · a real message';
    $('writeSeed').textContent = journal
      ? 'What happened today? A few sentences.'
      : 'Write the Slack message or email you actually need to send.';
    inp.placeholder = journal
      ? 'Today I…'
      : 'Hi Minh, quick question about…';
    inp.disabled = false;
    const saved = state.write && state.write.date === dayStr(0) && state.write.mode === m ? state.write.text : '';
    if (write.phase === 'idle') {
      inp.value = saved || '';
      $('writeResult').innerHTML = '';
    }
    $('writeHint').textContent = journal
      ? 'Each sentence comes back as ✓ already natural, or with only the mistakes marked.'
      : 'Keeps your tone. Fixes only what a native colleague would notice.';
    /* checked text can't be checked (and credited) again; start fresh instead */
    $('writeActions').innerHTML =
      write.phase === 'checked'
        ? '<button class="btn ghost" onclick="writeStartOver()">Start over</button>'
        : '<button class="btn pulse" id="writeCheckBtn" onclick="writeCheckNow()">Check it</button>';
  }
}
function fmtClock(s) {
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* ---- react: a short native text to read and reply to ---- */
function renderReactSeed(r = write.react) {
  $('writeSeed').style.fontSize = '1.02rem';
  $('writeSeed').innerHTML = r
    ? '<span class="reactMeta">' + esc(REACT_ICONS[r.kind] || r.kind) + ' · from ' + esc(r.from) + '</span><span class="reactText">' + esc(r.text) + '</span>'
    : '<span class="spin"></span> Finding something to react to…';
}
/* A short native text (Reddit comment, Slack thread, text, email): AI-written
   around your moods and due chunks, or one of reacts.json when the AI is down.
   Shared by React (reply to it) and Copy (type it out). */
async function fetchNativeText() {
  let r = null;
  if (loggedIn()) {
    const topics = CATS.filter((c) => state.cats.includes(c.id)).map((c) => c.label.slice(2).trim());
    const ctx = (state.settings.context || '').trim();
    const due = dueChunks().slice(0, 2).map((c) => c.chunk);
    const obj = await aiObj({
      contents: [
        {
          parts: [
            {
              text: `Write ONE short, real-sounding piece of native English that a software developer might read and want to reply to: a Reddit comment, a Slack thread (2-3 short messages, each "Name: line"), a text from a friend, or a short email.
2-5 lines, casual and natural, ending with a question or something to react to. Topic from: ${topics.join(', ') || 'daily life'}.
${ctx ? 'Their real life (names, role, project), use it if it fits: ' + ctx : ''}
${due.length ? 'If it fits naturally, make it easy to reply with one of these phrases: ' + due.join(' | ') : ''}
Reply ONLY JSON: {"kind":"reddit|slack|text|email","from":"who wrote it","text":"the text, with \\n between lines"}`,
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    });
    if (obj && obj.text && REACT_ICONS[obj.kind]) r = { kind: obj.kind, from: String(obj.from || 'someone'), text: String(obj.text).trim() };
  }
  if (!r) {
    if (!REACTS) {
      try {
        const res = await fetch(apiBase() + '/reacts.json');
        REACTS = res.ok ? await res.json() : [];
      } catch (e) {
        REACTS = [];
      }
    }
    const pick = REACTS.filter((x) => !write.lastReact || x.text !== write.lastReact);
    r = pick.length ? pick[Math.floor(Math.random() * pick.length)] : { kind: 'text', from: 'a friend', text: 'hey! how was your weekend?' };
  }
  return r;
}
async function reactNext() {
  write.react = null;
  write.phase = 'idle';
  $('writeInput').value = '';
  $('writeResult').innerHTML = '';
  renderReactSeed();
  const r = await fetchNativeText();
  if (write.mode !== 'react') return; /* switched modes while waiting */
  write.react = r;
  write.lastReact = r.text;
  renderReactSeed();
  $('writeInput').focus();
}

function writeNewSeed() {
  if (write.mode === 'explain') write.topic = explainTopic();
  if (write.mode === 'dialogue') write.scene = dialogueSeed();
  write.phase = 'idle';
  $('writeInput').value = '';
  writeRender();
}
/* ---- rewrite yesterday: the latest Write / Freewrite / React entry from yesterday ---- */
const REWRITE_SOURCES = ['write', 'free', 'react'];
function yesterdayEntry() {
  const y = attempts.filter((a) => a.d === dayStr(-1) && REWRITE_SOURCES.includes(a.source));
  if (!y.length) return null;
  const last = y[y.length - 1];
  /* one entry = the sentences logged together for the same prompt */
  const items = y.filter((a) => a.source === last.source && a.prompt === last.prompt);
  return { source: last.source, prompt: last.prompt, items, text: items.map((a) => a.blurt).join(' ') };
}
/* Yesterday's fixes next to today's, with what they were about. */
function rewriteCompareHTML(y, sents) {
  const tagLine = (tags) => {
    const m = {};
    tags.forEach((t) => (m[t] = (m[t] || 0) + 1));
    const k = Object.keys(m);
    return k.length ? k.map((t) => esc(TAG_LABELS[t] || t) + (m[t] > 1 ? ' ×' + m[t] : '')).join(' · ') : 'no fixes';
  };
  const col = (title, rows, tags) =>
    '<div class="rewriteCol"><div class="eyebrow">' + title + '</div>' + rows.join('') + '<p class="hint">' + tagLine(tags) + '</p></div>';
  const row = (orig, fix, clean) =>
    '<div class="writeSent">' +
    (clean === true
      ? '<div class="cleanSent">✓ ' + esc(fix || orig) + '</div>'
      : clean === false && fix
        ? '<div class="diff">' + wordDiff(orig, fix) + '</div>'
        : '<div>' + esc(orig) + ' <small class="meta">not checked</small></div>') +
    '</div>';
  return (
    '<div class="rewriteCmp">' +
    col('Yesterday', y.items.map((a) => row(a.blurt, a.fix, a.clean)), y.items.flatMap((a) => a.tags || [])) +
    col('Today', sents.map((x) => row(x.original, x.fixed, x.clean)), sents.flatMap((x) => x.tags)) +
    '</div>'
  );
}

/* ---- copy: type a native text out exactly (no AI) ---- */
async function copyNext() {
  write.copy = null;
  write.phase = 'idle';
  $('writeInput').value = '';
  $('writeInput').disabled = false;
  $('writeResult').innerHTML = '';
  renderReactSeed(null);
  const r = await fetchNativeText();
  if (write.mode !== 'copy') return;
  write.copy = { r, start: 0 };
  write.lastReact = r.text;
  writeRender();
  $('writeInput').focus();
}
function copyDone() {
  const c = write.copy,
    typed = $('writeInput').value.trim();
  if (!c || !typed || write.phase === 'checked') return;
  const { ops, B } = diffOps(typed, c.r.text);
  const acc = B.length ? Math.round((100 * ops.filter((o) => o.op === 'same').length) / B.length) : 0;
  const mins = c.start ? (Date.now() - c.start) / 60000 : 0;
  const words = typed.split(/\s+/).length;
  write.phase = 'checked';
  logAttempt({ source: 'copy', kind: c.r.kind, prompt: c.r.text, blurt: typed, fix: c.r.text, clean: acc >= 95 });
  $('writeResult').innerHTML =
    '<div class="writeSum"' + (acc >= 95 ? ' style="color:var(--mint)"' : '') + '>' + acc + '% accurate' + (mins > 0 ? ' · ' + Math.round(words / mins) + ' words/min' : '') + '</div>' +
    (acc < 100 ? '<div class="natural diff" style="margin-top:12px">' + wordDiff(typed, c.r.text) + '</div>' : '<p class="note">Word for word.</p>');
  writeRender();
}

/* ---- freewrite: forward-only typing ---- */
function startFreewrite() {
  const inp = $('writeInput');
  write.phase = 'running';
  write.left = freeMin() * 60;
  write.lastKey = Date.now();
  write.attempt = null;
  inp.value = '';
  inp.disabled = false;
  inp.focus();
  $('writeTimer').textContent = fmtClock(write.left);
  $('writeHint').textContent = '';
  $('writeActions').innerHTML = '';
  $('writeResult').innerHTML = '';
  clearInterval(write.timer);
  write.timer = setInterval(freewriteTick, 1000);
}
function freewriteTick() {
  write.left--;
  $('writeTimer').textContent = fmtClock(Math.max(0, write.left));
  const stalled = Date.now() - write.lastKey > STALL_MS;
  $('writeInput').classList.toggle('stalling', stalled);
  $('writeHint').textContent = stalled ? 'keep typing…' : '';
  if (write.left <= 0) finishFreewrite();
}
/* Only ever append: deletes, cuts, pastes and drops are refused, and typing
   anywhere but the end is moved to the end. beforeinput covers phone keyboards,
   whose keydown events don't say which key was pressed. */
function freewriteGuard(e) {
  if (write.mode !== 'free' || write.phase !== 'running') return;
  const inp = $('writeInput');
  const t = e.inputType || '';
  if (t.startsWith('delete') || t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'historyUndo' || t === 'historyRedo') {
    e.preventDefault();
    return;
  }
  const atEnd = inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length;
  if (!atEnd && (t === 'insertText' || t === 'insertLineBreak' || t === 'insertParagraph')) {
    e.preventDefault();
    inp.value += t === 'insertText' ? e.data || '' : '\n';
    caretToEnd();
    write.lastKey = Date.now();
  }
}
function caretToEnd() {
  const inp = $('writeInput');
  inp.setSelectionRange(inp.value.length, inp.value.length);
}
function freewriteWords(text) {
  return (text.match(/[A-Za-z0-9'’]+/g) || []).length;
}
function finishFreewrite() {
  clearInterval(write.timer);
  write.timer = null;
  if (write.phase !== 'running') return;
  write.phase = 'done';
  const inp = $('writeInput');
  inp.disabled = true;
  inp.classList.remove('stalling');
  const text = inp.value.trim();
  const words = freewriteWords(text);
  const mins = (freeMin() * 60 - Math.max(0, write.left)) / 60 || freeMin();
  if (words) {
    write.attempt = logAttempt({ source: 'free', kind: 'free:' + freeStage(), prompt: write.seed.text, blurt: text, clean: null });
    creditRep();
  }
  $('writeHint').textContent = '';
  $('writeResult').innerHTML =
    '<div class="writeSum">' +
    words +
    ' words · ' +
    Math.round(words / mins) +
    ' per minute</div>' +
    (words ? '<p class="hint">Saved as it is. Nobody graded it.</p>' : '<p class="hint">Nothing written — nothing logged. Try again?</p>');
  $('writeActions').innerHTML =
    (words && loggedIn()
      ? '<button class="btn" id="writeCheckBtn" onclick="writeCheckNow()">What would a native tweak?</button>'
      : '') + '<button class="btn ghost" onclick="setWriteMode(\'free\')">Again</button>';
}

/* ---- checking: one AI call, one verdict per sentence ---- */
async function writeCheck(mode, text) {
  const ctx = (state.settings.context || '').trim();
  const r = write.react;
  const instr =
    mode === 'explain'
      ? 'This is an explanation of "' + (write.topic || 'a topic') + '" for a new teammate. Judge it as clear, spoken-style English.'
      : mode === 'dialogue'
        ? 'This is a short dialogue they wrote, playing both people, for this scene: "' + (write.scene || '') + '". Treat each line as one sentence; "original" is the line WITHOUT the "Name:" label.'
        : mode === 'react' && r
      ? 'This is their REPLY to this ' + r.kind + ' from ' + r.from + ':\n"""' + r.text + '"""\nJudge it as a natural reply in the same register.'
      : mode === 'draft'
      ? 'This is a real work message they are about to send. Keep their tone, intent and length; fix only what a native colleague would notice.'
      : mode === 'free'
        ? 'This is a timed freewrite: fast, unedited, stream of thought. Judge it as casual written English.'
        : 'This is a casual journal entry, like a diary or a text to a friend. Casual register is fine.';
  const msg = `You are a friendly English coach for a Vietnamese software developer building confidence in writing.
${instr}
${ctx ? 'Their context (names, role, project): ' + ctx : ''}
Their text:
"""${text}"""
Split it into sentences, in order; don't merge, drop or reorder any. For each sentence return:
{"original":"the sentence exactly as written","fixed":"THEIR sentence minimally corrected: keep their words and structure, change only what is wrong or unnatural. Copy it exactly if nothing needs changing.","natural":"how a native would phrase it, or empty if fixed already is","chunk":"one reusable multi-word phrase from fixed or natural worth saving, or empty","clean":true or false (true = no meaningful change needed, ignoring capitalization and punctuation),${TAGS_FIELD}}
Reply with ONLY JSON: {"sentences":[...],"note":"one encouraging line (max 25 words) about the whole text: what worked, and the one thing to watch","ready":"${mode === 'draft' ? 'the full message, cleaned up, in their tone, ready to send' : ''}"${mode === 'react' ? ',"fit":"one line: does the reply match the tone and register of the original (too formal, too blunt, just right)?"' : ''}${mode === 'explain' ? ',"clarity":"one line: would a new teammate get it? What to add or cut."' : ''}${mode === 'dialogue' ? ',"questions":"one line on whether the questions in it sound natural"' : ''}}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: msg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !Array.isArray(obj.sentences)) return null;
  const sents = obj.sentences
    .filter((x) => x && x.original && String(x.original).trim())
    .map((x) => {
      const original = String(x.original).trim(),
        fixed = String(x.fixed || x.original).trim();
      const natural = x.natural && norm(x.natural) !== norm(fixed) ? String(x.natural).trim() : '';
      return {
        original,
        fixed,
        natural,
        chunk: String(x.chunk || '').trim(),
        tags: cleanTags(x.tags),
        clean: truthy(x.clean) || norm(original) === norm(fixed),
      };
    });
  if (!sents.length) return null;
  return {
    sents,
    note: String(obj.note || ''),
    ready: String(obj.ready || ''),
    /* the one mode-specific line, per mode */
    fit: String((mode === 'explain' ? obj.clarity : mode === 'dialogue' ? obj.questions : obj.fit) || ''),
  };
}
async function writeCheckNow() {
  const mode = write.mode;
  const text = $('writeInput').value.trim();
  if (!text) return;
  const btn = $('writeCheckBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Reading…';
  }
  const res = await writeCheck(mode, text);
  if (!res) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
    $('writeResult').innerHTML =
      '<p class="hint">Couldn\'t reach the AI. Your text is still here' + (mode === 'free' ? ' and saved' : '') + '.</p>';
    return;
  }
  const seed = $('writeSeed').textContent;
  if (mode === 'free' && write.attempt) {
    /* grade the freewrite you already logged: same id, so it's an update */
    write.attempt = logAttempt({
      ...write.attempt,
      fix: res.sents.map((x) => x.fixed).join(' '),
      natural: res.sents.map((x) => x.natural || x.fixed).join(' '),
      note: res.note,
      tags: [...new Set(res.sents.flatMap((x) => x.tags))],
      clean: res.sents.every((x) => x.clean),
    });
  } else {
    res.sents.forEach((x) =>
      logAttempt({
        source: mode === 'react' ? 'react' : mode === 'rewrite' ? 'rewrite' : 'write',
        kind: mode === 'react' && write.react ? write.react.kind : mode === 'rewrite' ? write.rewrite.source : mode,
        prompt:
          mode === 'react' && write.react
            ? write.react.text
            : mode === 'rewrite'
              ? write.rewrite.prompt
              : mode === 'dialogue'
                ? write.scene
                : seed,
        blurt: x.original,
        fix: x.fixed,
        natural: x.natural,
        tags: x.tags,
        clean: x.clean,
      }),
    );
    creditRep();
  }
  write.phase = 'checked';
  write.sents = res.sents;
  write.ready = res.ready;
  writeRenderResult(res);
  if (mode === 'rewrite') $('writeResult').insertAdjacentHTML('afterbegin', rewriteCompareHTML(write.rewrite, res.sents));
  if (mode === 'free') {
    if (btn) btn.remove();
  } else writeRender(); /* swaps Check for Start over */
}
function writeStartOver() {
  write.phase = 'idle';
  write.sents = [];
  state.write = null;
  saveState();
  $('writeInput').value = '';
  writeRender();
}
/* The example saved with a chunk must contain it, or Drill can't blank it. */
function writeChunkExample(x) {
  if (!x.chunk) return '';
  if (drillBlank(x.chunk, x.fixed).hasBlank) return x.fixed;
  if (x.natural && drillBlank(x.chunk, x.natural).hasBlank) return x.natural;
  return '';
}
function writeRenderResult(res) {
  const n = res.sents.length,
    c = res.sents.filter((x) => x.clean).length;
  let html =
    (c
      ? '<div class="writeSum" style="color:var(--mint)">✓ ' + c + ' of ' + n + ' sentence' + (n > 1 ? 's' : '') + ' already natural</div>'
      : '<div class="writeSum">' + n + ' sentence' + (n > 1 ? 's' : '') + ', small fixes below</div>') +
    (res.note ? '<p class="note">' + esc(res.note) + '</p>' : '') +
    (res.fit ? '<p class="note">🎯 ' + esc(res.fit) + '</p>' : '');
  res.sents.forEach((x, i) => {
    html +=
      '<div class="writeSent">' +
      (x.clean
        ? '<div class="cleanSent">✓ ' + esc(x.fixed) + '</div>'
        : '<div class="natural diff">' + wordDiff(x.original, x.fixed) + '</div>') +
      (x.natural ? '<details><summary>show a native version</summary>' + esc(x.natural) + '</details>' : '') +
      (writeChunkExample(x)
        ? '<div class="chunkBox"><div>chunk → <b>' +
          esc(x.chunk) +
          '</b></div><button class="btn ghost" id="writeSave' +
          i +
          '" onclick="saveWriteChunk(' +
          i +
          ')">Save</button></div>'
        : '') +
      '</div>';
  });
  const savable = res.sents.filter(writeChunkExample).length;
  if (savable > 1)
    html += '<div class="row"><button class="btn ghost" id="writeSaveAll" onclick="saveWriteChunk(\'all\')">Save all ' + savable + ' chunks</button></div>';
  if (write.mode === 'draft' && res.ready)
    html +=
      '<div class="eyebrow" style="margin-top:22px">Clean version</div><div class="natural writeReady">' +
      esc(res.ready) +
      '</div><div class="row"><button class="btn pulse" id="writeCopyBtn" onclick="copyWriteReady()">Copy the clean version</button></div>';
  $('writeResult').innerHTML = html;
}
async function saveWriteChunk(which) {
  const idx = which === 'all' ? write.sents.map((_, i) => i) : [which];
  const added = [];
  idx.forEach((i) => {
    const x = write.sents[i],
      b = $('writeSave' + i);
    const example = x && writeChunkExample(x);
    if (!example || !b || b.disabled) return;
    added.push({ ...newChunkBase(), chunk: x.chunk, example, context: x.original });
    b.textContent = 'Saved ✓';
    b.disabled = true;
  });
  if (!added.length) return;
  added.forEach((c) => chunks.unshift(c));
  await chunkAddMany(added);
  if (which === 'all') {
    $('writeSaveAll').textContent = 'Saved ✓';
    $('writeSaveAll').disabled = true;
  }
  renderHeader();
  renderHW();
}
async function copyWriteReady() {
  const b = $('writeCopyBtn');
  try {
    await navigator.clipboard.writeText(write.ready || '');
    b.textContent = 'Copied ✓';
  } catch (e) {
    b.textContent = 'Copy failed — select it by hand';
  }
}
/* Journal/draft text survives a reload until the day ends. */
let writeSaveTimer = null;
function persistWriteText() {
  if (write.mode !== 'journal' && write.mode !== 'draft') return;
  clearTimeout(writeSaveTimer);
  writeSaveTimer = setTimeout(() => {
    state.write = { date: dayStr(0), mode: write.mode, text: $('writeInput').value };
    saveState();
  }, 800);
}
let vnShareTimer = null;
function setVnShare(v) {
  state.settings.vnShare = Math.max(0, Math.min(100, Math.round(Number(v) / 10) * 10));
  $('vnShareLbl').textContent = state.settings.vnShare + '%';
  clearTimeout(vnShareTimer);
  vnShareTimer = setTimeout(saveState, 400);
}
function saveFreeMin() {
  const n = Math.floor(Number($('freeMinIn').value));
  if (!(n >= 1 && n <= 30)) {
    $('freeMinStatus').textContent = 'Enter a whole number from 1 to 30.';
    return;
  }
  state.settings.freeMin = n;
  $('freeMinIn').value = n;
  saveState();
  if (write.phase !== 'running') writeRender();
  $('freeMinStatus').textContent = 'Saved — ' + n + ' minute' + (n === 1 ? '' : 's') + '.';
}
function startFreewriteFromHW() {
  showTab('write');
  setWriteMode('free');
}
document.addEventListener('DOMContentLoaded', () => {
  const inp = $('writeInput');
  inp.addEventListener('beforeinput', freewriteGuard);
  ['cut', 'paste', 'drop'].forEach((ev) =>
    inp.addEventListener(ev, (e) => {
      if ((write.mode === 'free' && write.phase === 'running') || write.mode === 'copy') e.preventDefault();
    }),
  );
  inp.addEventListener('keydown', (e) => {
    if (write.mode === 'free' && write.phase === 'running' && (e.key === 'Backspace' || e.key === 'Delete'))
      e.preventDefault();
  });
  inp.addEventListener('input', () => {
    write.lastKey = Date.now();
    if (write.mode === 'copy' && write.copy && !write.copy.start) write.copy.start = Date.now();
    if (write.mode === 'free' && write.phase === 'running') {
      inp.classList.remove('stalling');
      $('writeHint').textContent = '';
      caretToEnd();
    } else persistWriteText();
  });
});

/* ================= "Your English": the archive of everything you wrote ================= */
const ARCH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'clean', label: '✓ Clean only' },
  { id: 'practice', label: 'Practice', source: 'practice' },
  { id: 'write', label: 'Write', source: 'write' },
  { id: 'free', label: 'Free', source: 'free' },
  { id: 'react', label: 'React', source: 'react' },
  { id: 'chat', label: 'Chat', source: 'chat' },
];
const ARCH_PAGE = 50;
const SOURCE_LABELS = { practice: 'practice', three: '3 ways', replay: 'replay', write: 'write', free: 'freewrite', chat: 'chat', react: 'react', copy: 'copy', rewrite: 'rewrite' };
let arch = { q: '', filter: 'all', rows: [], more: true, loading: false, seq: 0 };
let archTimer = null;

function archiveHTML() {
  return (
    '<div style="margin-top:28px" id="archive"><div class="eyebrow">Your English · everything you wrote</div>' +
    '<input class="drillIn" id="archSearch" type="search" autocomplete="off" placeholder="Search your sentences…" oninput="archSearchInput()" style="margin-top:0">' +
    '<div class="chips" id="archChips"></div>' +
    '<div id="archList"></div>' +
    '<div class="row" id="archMore"></div></div>'
  );
}
function archFilter() {
  return ARCH_FILTERS.find((f) => f.id === arch.filter) || ARCH_FILTERS[0];
}
function archMatches(a) {
  const f = archFilter();
  if (f.id === 'clean' && a.clean !== true) return false;
  if (f.source && a.source !== f.source) return false;
  return true;
}
/* First page comes from the attempts already in memory (last 90 days) unless
   you're searching; everything older, and every search, asks the server. */
async function archReset() {
  arch.rows = [];
  arch.more = true;
  const seq = ++arch.seq;
  $('archSearch').value = arch.q;
  $('archChips').innerHTML = ARCH_FILTERS.map(
    (f) =>
      '<button class="chip ' + (arch.filter === f.id ? 'on' : '') + '" onclick="setArchFilter(\'' + f.id + '\')">' + f.label + '</button>',
  ).join('');
  if (!arch.q) {
    arch.rows = attempts.filter(archMatches).slice().reverse().slice(0, ARCH_PAGE);
    archRenderList();
  } else {
    $('archList').innerHTML = '<p class="hint"><span class="spin"></span> Searching…</p>';
    await archFetch(seq);
  }
}
async function archFetch(seq) {
  if (arch.loading) return;
  arch.loading = true;
  const f = archFilter();
  const qs = ['limit=' + ARCH_PAGE];
  const last = arch.rows[arch.rows.length - 1];
  if (last) qs.push('before=' + encodeURIComponent(last.created_at));
  if (arch.q) qs.push('q=' + encodeURIComponent(arch.q));
  if (f.id === 'clean') qs.push('clean=1');
  if (f.source) qs.push('source=' + f.source);
  try {
    const r = await api('/api/attempts?' + qs.join('&'));
    if (seq !== arch.seq) return; /* a newer search or filter took over */
    const got = (r && r.attempts) || [];
    arch.rows = arch.rows.concat(got);
    arch.more = got.length === ARCH_PAGE;
  } catch (e) {
    if (seq === arch.seq) $('archMore').innerHTML = '<p class="hint">Couldn\'t load more. <button class="btn ghost" onclick="archLoadMore()">Try again</button></p>';
    return;
  } finally {
    arch.loading = false;
  }
  archRenderList();
}
function archLoadMore() {
  archFetch(arch.seq);
}
function setArchFilter(id) {
  arch.filter = id;
  archReset();
}
function archSearchInput() {
  clearTimeout(archTimer);
  archTimer = setTimeout(() => {
    arch.q = $('archSearch').value.trim();
    archReset();
  }, 300);
}
function archRenderList() {
  const rows = arch.rows;
  $('archList').innerHTML = rows.length
    ? rows.map(archRowHTML).join('')
    : '<p class="hint">' + (arch.q ? 'Nothing matches “' + esc(arch.q) + '”.' : 'Nothing here yet.') + '</p>';
  $('archMore').innerHTML = arch.more
    ? '<button class="btn ghost" onclick="archLoadMore()">Load ' + (rows.length ? 'older' : 'more') + '</button>'
    : rows.length
      ? '<p class="hint">That\'s everything.</p>'
      : '';
}
function archRowHTML(a, i) {
  const hasFix = !!a.fix && norm(a.fix) !== norm(a.blurt);
  const body =
    a.clean === true
      ? '<div class="cleanSent">✓ ' + esc(a.fix || a.blurt) + '</div>'
      : hasFix && a.clean === false
        ? '<div class="diff">' + wordDiff(a.blurt, a.fix) + '</div>'
        : '<div>' + esc(a.blurt) + (a.clean == null ? ' <small class="meta">not checked</small>' : '') + '</div>';
  const btns =
    (hasFix && a.clean === false
      ? '<button class="btn ghost" onclick="archSaveChunk(' + i + ', this)">Save as chunk</button>'
      : '') +
    (a.prompt && a.fix && a.source !== 'free'
      ? '<button class="btn ghost" onclick="archRetry(' + i + ')">Retry</button>'
      : '');
  return (
    '<div class="archRow"><div class="archMeta">' +
    esc(a.d) +
    ' <span class="srcBadge">' +
    esc(SOURCE_LABELS[a.source] || a.source) +
    '</span></div>' +
    (a.prompt ? '<div class="archPrompt">' + esc(a.prompt) + '</div>' : '') +
    body +
    (btns ? '<div class="row archBtns">' + btns + '</div>' : '') +
    '</div>'
  );
}
/* Save the part you got wrong, as fixed. The suggestion is editable; it has to
   appear in the fixed sentence so Drill can blank it. */
async function archSaveChunk(i, btn) {
  const a = arch.rows[i];
  if (!a || btn.disabled) return;
  const pick = prompt('Chunk to save (a phrase from the fixed sentence):', fixSpan(a.blurt, a.fix));
  if (pick == null) return;
  const chunk = pick.trim();
  if (!chunk || !drillBlank(chunk, a.fix).hasBlank) {
    alert('That phrase isn\'t in the fixed sentence:\n\n' + a.fix);
    return;
  }
  const c = { ...newChunkBase(), chunk, example: a.fix, context: a.prompt || a.blurt };
  chunks.unshift(c);
  await chunkAdd(c);
  renderHeader();
  renderHW();
  btn.textContent = 'Saved ✓';
  btn.disabled = true;
}
function archRetry(i) {
  const a = arch.rows[i];
  if (!a) return;
  showTab('practice');
  startReplay({ prompt: a.prompt, blurt: a.blurt, fix: a.fix, kind: a.kind, d: a.d }, { single: true });
}

/* ================= "do natives say this?" ================= */
/* Select any phrase in a result, a write-up or the archive and ask about it. */
const NATIVES_AREAS = ['resultCard', 'writeResult', 'convBody', 'archList', 'drillBody', 'randomBody'];
let nativesSel = null;
function nativesContainer(node) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el) {
    if (NATIVES_AREAS.includes(el.id)) return el;
    el = el.parentElement;
  }
  return null;
}
function onSelectionChange() {
  const sel = document.getSelection();
  const btn = $('nativesBtn');
  if (!sel || sel.isCollapsed || !loggedIn()) return hideNatives();
  const text = sel.toString().trim();
  const box = nativesContainer(sel.anchorNode);
  if (!box || text.length < 2 || text.length > 120) return hideNatives();
  /* the sentence it sits in, so a saved alternative has an example to drill */
  const around = (sel.anchorNode && sel.anchorNode.parentElement ? sel.anchorNode.parentElement.textContent : '') || text;
  nativesSel = { text, around };
  const r = sel.getRangeAt(0).getBoundingClientRect();
  btn.style.display = '';
  const w = btn.offsetWidth || 180,
    h = btn.offsetHeight || 38;
  const top = r.top > h + 16 ? r.top - h - 8 : r.bottom + 8;
  btn.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  btn.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, top)) + 'px'; /* always reachable */
}
function hideNatives() {
  nativesSel = null;
  $('nativesBtn').style.display = 'none';
}
function closeNativesPop() {
  $('nativesPop').style.display = 'none';
}
async function askNatives() {
  const sel = nativesSel;
  if (!sel) return;
  hideNatives();
  const pop = $('nativesPop');
  pop.style.display = '';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 348, window.innerWidth / 2 - 170)) + 'px';
  pop.style.top = Math.max(60, window.innerHeight / 2 - 120) + 'px';
  pop.innerHTML = '<span class="spin"></span> Asking…';
  const obj = await aiObj({
    contents: [
      {
        parts: [
          {
            text: `A Vietnamese developer learning English asks whether this English phrase is something natives actually say: "${sel.text}"
Context it appeared in: "${sel.around}"
Reply with ONLY JSON: {"common":"yes|rare|no","why":"one short line in plain words — no grammar terms","alts":["a natural alternative","another one"]}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj) {
    pop.innerHTML = '<button class="popClose" onclick="closeNativesPop()">✕</button>Couldn\'t ask right now.';
    return;
  }
  const common = String(obj.common || '').toLowerCase();
  nativesAlts = (Array.isArray(obj.alts) ? obj.alts : []).map(String).filter(Boolean).slice(0, 3);
  pop.innerHTML =
    '<button class="popClose" onclick="closeNativesPop()">✕</button>' +
    '<p class="verdict ' + (common === 'yes' ? 'good">✓ Yes, natives say this' : common === 'rare' ? 'badv">△ Rare — understood, but unusual' : 'badv">✗ Not really') + '</p>' +
    '<p class="note">' + esc(obj.why || '') + '</p>' +
    nativesAlts
      .map(
        (a, i) =>
          '<div class="alt"><span>' + esc(a) + '</span><button class="btn ghost" id="natSave' + i + '" onclick="saveNativeAlt(' + i + ')">Save as chunk</button></div>',
      )
      .join('');
  nativesAround = sel.around;
  nativesText = sel.text;
}
let nativesAlts = [],
  nativesAround = '',
  nativesText = '';
async function saveNativeAlt(i) {
  const alt = nativesAlts[i],
    b = $('natSave' + i);
  if (!alt || !b || b.disabled) return;
  /* drop the alternative into the sentence it came from, so Drill can blank it */
  let example = nativesAround && nativesAround.includes(nativesText) ? nativesAround.replace(nativesText, alt) : alt;
  if (!drillBlank(alt, example).hasBlank) example = alt;
  const c = { ...newChunkBase(), chunk: alt, example, context: nativesText };
  chunks.unshift(c);
  await chunkAdd(c);
  renderHeader();
  renderHW();
  b.textContent = 'Saved ✓';
  b.disabled = true;
}
document.addEventListener('selectionchange', onSelectionChange);
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#nativesPop') && !e.target.closest('#nativesBtn')) closeNativesPop();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideNatives();
    closeNativesPop();
  }
});

/* ================= voice ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
/* Mic buttons only when the browser supports it AND Voice input is switched on
   in Settings (off by default: recognition mishears accents). */
function micOk() {
  return !!(SR && state.settings && state.settings.voice);
}
function renderVoice() {
  const on = !!state.settings.voice;
  $('voiceChip').textContent = on ? '🎤 Voice input: on' : 'Voice input: off';
  $('voiceChip').classList.toggle('on', on);
  $('micBtn').style.display = micOk() ? '' : 'none';
}
function toggleVoice() {
  state.settings.voice = !state.settings.voice;
  if (!state.settings.voice) stopMic();
  saveState();
  renderVoice();
}

/* ================= theme ================= */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
}
function updateThemeBtn() {
  const btn = $('themeBtn');
  if (btn) btn.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('blurt:theme', next); } catch (e) {}
  updateThemeBtn();
}
document.addEventListener('DOMContentLoaded', updateThemeBtn);
function toggleMic() {
  micLive ? stopMic() : startMic();
}
function startMic(inputId, btnId) {
  if (!SR) return;
  micBtnId = btnId || 'micBtn';
  rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (e) => {
    let t = '';
    for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
    const box = $(inputId || 'blurtInput');
    if (box) box.value = (box.value + ' ' + t).trim();
  };
  rec.onend = () => {
    micLive = false;
    const b = $(micBtnId);
    if (b) b.classList.remove('live');
  };
  rec.onerror = () => {
    micLive = false;
    const b = $(micBtnId);
    if (b) b.classList.remove('live');
  };
  try {
    rec.start();
    micLive = true;
    const b = $(micBtnId);
    if (b) b.classList.add('live');
  } catch (e) {}
}
function stopMic() {
  if (rec) {
    try {
      rec.stop();
    } catch (e) {}
  }
  micLive = false;
  const b = $(micBtnId);
  if (b) b.classList.remove('live');
}
/* Drill: speak your answer. The recognized text fills the blank; you check it
   yourself, so a misheard word is never graded as a miss. */
function toggleDrillMic() {
  if (micLive) {
    stopMic();
    return;
  }
  const box = $('drillInput');
  if (box) box.value = '';
  startMic('drillInput', 'drillMicBtn'); /* fills the box only — you press Check */
}

/* ================= drill (due-today queue) ================= */
function drillNext() {
  const body = $('drillBody');
  const due = dueChunks();
  renderHW();
  if (chunks.length < 1) {
    $('drillEyebrow').textContent = 'Chunk drill';
    body.innerHTML =
      '<div class="empty">Save some chunks in Practice first — then they\'ll show up here on a schedule: 1 day later, then 3, 7, 14, 30...</div>';
    return;
  }
  if (due.length === 0) {
    $('drillEyebrow').textContent = 'Chunk drill · all clear';
    const next = [...chunks].sort((a, b) => a.due.localeCompare(b.due))[0];
    body.innerHTML =
      '<div class="empty">🎉 Nothing due today. Next review: <b>' +
      esc(next.chunk) +
      '</b> on ' +
      next.due +
      '.<br><br>Want extra credit anyway?</div>' +
      '<div class="row"><button class="btn ghost" onclick="drillAhead()">Practice ahead of schedule</button></div>';
    return;
  }
  $('drillEyebrow').textContent = 'Chunk drill · ' + due.length + ' due today';
  const c = due[Math.floor(Math.random() * due.length)];
  showDrillCard(chunks.indexOf(c), true);
}
function drillAhead() {
  if (!chunks.length) return;
  const i = Math.floor(Math.random() * chunks.length);
  $('drillEyebrow').textContent = "Chunk drill · extra credit (doesn't change the schedule)";
  showDrillCard(i, false);
}
/* Build the blanked example for a drill card. Handles recipe/pattern chunks
   ("should have + V3", "more of a ... person", "wrapped up / picking up") by
   blanking each anchor segment that actually appears, and tolerates punctuation
   differences ("I don't know, man..." vs "I don't know, man —"). */
const BLANK = '\u0000';
function drillBlank(chunkStr, exampleStr) {
  const segs = String(chunkStr).split(/\s*(?:\+|\/|\.{3}|…|_+|\[[^\]]*\])\s*/);
  let out = String(exampleStr),
    hits = 0;
  const answers = [];
  for (const seg of segs) {
    // Straight and curly apostrophes count as the same letter, so "isn't" blanks "isn’t".
    const toks = seg.match(/[A-Za-z0-9'‘’ʼ]+/g) || [];
    if (!toks.length) continue;
    const body = toks
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['‘’ʼ]/g, "['‘’ʼ]"))
      .join("[^A-Za-z0-9'‘’ʼ]+");
    const re = new RegExp("(?<![A-Za-z0-9'‘’ʼ])" + body + "(?![A-Za-z0-9'‘’ʼ])", 'gi');
    out = out.replace(re, (m) => {
      hits++;
      answers.push(m);
      return BLANK;
    });
  }
  return {
    html: esc(out).split(BLANK).join('<b>＿＿＿＿＿</b>'),
    hasBlank: hits > 0,
    answer: [...new Set(answers.map((a) => a.toLowerCase()))].join(' '),
  };
}
/* Every known example sentence for a chunk: the original you saved plus any
   the AI has since grown. Drilling rotates through these so you recall the
   chunk in fresh contexts instead of memorizing one fixed sentence. */
function examplePool(c) {
  return [c.example].concat(c.examples || []).filter(Boolean);
}
function pickExample(c, override) {
  if (override) return override;
  const pool = examplePool(c);
  if (pool.length <= 1) return pool[0] || c.chunk;
  let choices = pool.filter((s) => s !== lastShownEx);
  if (!choices.length) choices = pool;
  return choices[Math.floor(Math.random() * choices.length)];
}
/* Ask the AI for one new sentence using this chunk verbatim, in a fresh
   context. Validates it can actually be blanked, dedupes, caps the pool, and
   persists. Returns the sentence or null (offline / AI down / unusable). */
async function genFreshExample(c) {
  if (!loggedIn()) return null;
  const msg = `Write ONE short, natural everyday English sentence (max 18 words) for a Vietnamese software developer practicing spoken fluency.
It MUST contain this exact phrase verbatim: "${c.chunk}"
Use a fresh, concrete situation different from this earlier one: "${c.example || ''}"
Reply with ONLY JSON: {"example":"the sentence"}`;
  try {
    const obj = await aiObj({
      contents: [{ parts: [{ text: msg }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    const ex = obj && obj.example && String(obj.example).trim();
    if (!ex) return null;
    if (!drillBlank(c.chunk, ex).hasBlank)
      return null; /* must contain the chunk so we can blank it */
    if (examplePool(c).some((x) => x.toLowerCase() === ex.toLowerCase())) return null; /* dedupe */
    c.examples = (c.examples || [])
      .concat(ex)
      .slice(-3); /* keep the 3 most recent grown sentences */
    chunkSave(c);
    return ex;
  } catch (err) {
    console.error('fresh example failed:', err);
    return null;
  }
}
async function freshDrillEx() {
  if (!drillCurrent) return;
  const c = chunks[drillCurrent.idx];
  const b = $('freshExBtn');
  if (b) {
    b.disabled = true;
    b.textContent = '⏳';
  }
  const ex = await genFreshExample(c);
  showDrillCard(
    drillCurrent.idx,
    drillCurrent.scheduled,
    drillCurrent.mode,
    'drillBody',
    ex || undefined,
  );
  if (!ex) {
    const nb = $('freshExBtn');
    if (nb) {
      nb.textContent = '🔄';
    }
  }
}
function showDrillCard(idx, scheduled, mode, bodyId, exOverride) {
  mode = mode || 'drill';
  bodyId = bodyId || 'drillBody';
  const c = chunks[idx];
  const sentence = pickExample(c, exOverride);
  lastShownEx = sentence;
  const blanked = drillBlank(c.chunk, sentence);
  const hasBlank = blanked.hasBlank;
  const shown = blanked.html;
  drillCurrent = {
    idx,
    scheduled,
    mode,
    example: sentence,
    answer: hasBlank ? blanked.answer : c.chunk,
  };
  $(bodyId).innerHTML =
    (c.context ? '<div class="drillCtx">💬 ' + esc(c.context) + '</div>' : '') +
    '<div class="drillSentence">' +
    shown +
    '</div>' +
    '<button class="speak" onclick="speakDrillEx()" title="Hear it">🔊</button>' +
    (loggedIn()
      ? '<button class="speak" id="freshExBtn" onclick="freshDrillEx()" title="New example sentence">🔄</button>'
      : '') +
    (hasBlank ? '' : '<p class="hint">Type the chunk you saved for this sentence:</p>') +
    '<input class="drillIn" id="drillInput" autocomplete="off" placeholder="Fill the blank from memory...">' +
    '<div class="row"><button class="btn" onclick="drillCheck()">Check</button>' +
    (micOk()
      ? '<button class="btn mic" id="drillMicBtn" onclick="toggleDrillMic()" title="Say it out loud">🎤</button>'
      : '') +
    '<button class="btn ghost" onclick="drillReveal()">I forgot — show me</button></div>' +
    '<div id="drillVerdict"></div>' +
    (mode === 'drill'
      ? '<div class="drillStats">SM-2 schedule: Hard/Good/Easy stretch the interval (shown on each button) · missed → due again today</div>'
      : '<div class="drillStats">Free practice — this doesn\'t change your review schedule.</div>');
  $('drillInput').focus();
  $('drillInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') drillCheck();
  });
  /* quietly grow the example pool in the background for next time */
  if (mode === 'drill' && loggedIn() && examplePool(c).length < 3) genFreshExample(c);
}
function norm(s) {
  return s
    .toLowerCase()
    .replace(/['‘’ʼ′]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/* Word-level diff of a → b as a list of ops: {op:'same'|'del'|'ins', text, j}
   where j is the word's index in b (same/ins). Words are compared through
   norm(), so case and punctuation alone don't count as a change. */
function diffOps(a, b) {
  const A = String(a || '').split(/\s+/).filter(Boolean),
    B = String(b || '').split(/\s+/).filter(Boolean);
  const nA = A.map(norm),
    nB = B.map(norm);
  /* LCS table, filled from the end so the walk below goes front to back. */
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      L[i][j] = nA[i] === nB[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0,
    j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && nA[i] === nB[j]) ops.push({ op: 'same', text: B[j], j: j++, i: i++ });
    else if (j < B.length && (i === A.length || L[i][j + 1] >= L[i + 1][j]))
      ops.push({ op: 'ins', text: B[j], j: j++, i }); /* i: inserted before a[i] */
    else ops.push({ op: 'del', text: A[i], j, i: i++ });
  }
  return { ops, B };
}
/* The diff as HTML: words only in a are <del>, words only in b are <ins>,
   shown as b spells them. */
function wordDiff(a, b) {
  const out = [];
  let dels = [],
    ins = [];
  const flush = () => {
    if (dels.length) out.push('<del>' + esc(dels.join(' ')) + '</del>');
    if (ins.length) out.push('<ins>' + esc(ins.join(' ')) + '</ins>');
    dels = [];
    ins = [];
  };
  diffOps(a, b).ops.forEach((o) => {
    if (o.op === 'same') {
      flush();
      out.push(esc(o.text));
    } else (o.op === 'del' ? dels : ins).push(o.text);
  });
  flush();
  return out.join(' ');
}
/* The part of the fixed sentence around what changed: first to last changed
   word, plus one word either side, at most 6 words. A starting suggestion for
   a chunk; '' when nothing changed. */
function fixSpan(blurt, fix) {
  const { ops, B } = diffOps(blurt, fix);
  const js = ops.filter((o) => o.op !== 'same').map((o) => Math.min(o.j, B.length - 1));
  if (!js.length || !B.length) return '';
  let lo = Math.max(0, Math.min(...js) - 1),
    hi = Math.min(B.length - 1, Math.max(...js) + 1);
  if (hi - lo > 5) hi = lo + 5;
  return B.slice(lo, hi + 1)
    .join(' ')
    .replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '');
}
function drillCheck() {
  if (micLive) stopMic();
  const c = chunks[drillCurrent.idx];
  const guess = norm($('drillInput').value);
  const target = norm(drillCurrent.answer || c.chunk);
  const ok =
    guess &&
    (guess === target ||
      (target.includes(guess) && guess.length >= target.length * 0.6) ||
      guess.includes(target));
  /* A correct, scheduled rep gets self-graded (Good/Easy) below; a miss is
     automatically 'again' and stays due today, same honest rule as before. */
  if (ok && drillCurrent.scheduled && !drillCurrent.retry) {
    renderHeader();
    $('drillVerdict').innerHTML =
      '<p class="verdict good">✓ Nailed it: <b>' +
      esc(c.chunk) +
      '</b></p>' +
      '<p class="sched">How did that feel?</p>' +
      '<div class="row"><button class="btn ghost" onclick="gradeDrill(\'hard\')">Hard 😬 ' +
      fmtDays(previewInterval(c, 'hard')) +
      '</button>' +
      '<button class="btn pulse js-next" onclick="gradeDrill(\'good\')">Good 👍 ' +
      fmtDays(previewInterval(c, 'good')) +
      '</button>' +
      '<button class="btn ghost" onclick="gradeDrill(\'easy\')">Easy ⏩ ' +
      fmtDays(previewInterval(c, 'easy')) +
      '</button></div>';
    if ($('drillInput')) $('drillInput').blur();
    return;
  }
  if (drillCurrent.scheduled && !drillCurrent.retry) {
    scheduleAfter(c, 'again');
    hist().m++;
    saveState();
    chunkSave(c);
    creditStreakIfDone();
  }
  renderHeader();
  renderHW();
  $('drillVerdict').innerHTML =
    '<p class="verdict ' +
    (ok ? 'good' : 'badv') +
    '">' +
    (ok ? '✓ Nailed it' : '✗ It was:') +
    ' <b>' +
    esc(c.chunk) +
    '</b></p>' +
    (drillCurrent.scheduled && !drillCurrent.retry
      ? '<p class="sched">Coming back today until you get it.</p>'
      : '') +
    '<div class="row">' +
    (ok ? '' : '<button class="btn" onclick="practiceRetry()">Try again</button>') +
    '<button class="btn pulse js-next" id="drillNextBtn" onclick="practiceNext()">Next →</button></div>';
  if ($('drillInput')) $('drillInput').blur(); /* free up Space for "Next" (see drillKeyNav) */
}
/* The Good/Easy buttons shown after a correct scheduled rep. */
function gradeDrill(grade) {
  if (!drillCurrent) return;
  const c = chunks[drillCurrent.idx];
  scheduleAfter(c, grade);
  hist().h++;
  saveState();
  chunkSave(c);
  creditStreakIfDone();
  renderHeader();
  renderHW();
  practiceNext();
}
function drillReveal() {
  if (micLive) stopMic();
  const c = chunks[drillCurrent.idx];
  if (!drillCurrent.retry) {
    if (drillCurrent.scheduled) {
      scheduleAfter(c, 'again');
      hist().m++;
      saveState();
      chunkSave(c);
    }
  }
  renderHW();
  $('drillVerdict').innerHTML =
    '<p class="verdict badv">It was: <b>' +
    esc(c.chunk) +
    '</b>' +
    (drillCurrent.scheduled && !drillCurrent.retry
      ? ' — coming back today until you get it.'
      : '') +
    '</p>' +
    '<div class="row"><button class="btn" onclick="practiceRetry()">Try again</button><button class="btn pulse js-next" id="drillNextBtn" onclick="practiceNext()">Next →</button></div>';
  if ($('drillInput')) $('drillInput').blur(); /* free up Space for "Next" (see drillKeyNav) */
}
/* Space activates the visible "Next" button (Practice rep, Drill, Random),
   but only when one is on screen and you're not typing in a field. */
function drillKeyNav(e) {
  if (e.key !== ' ' && e.code !== 'Space') return;
  const t = document.activeElement,
    tag = (t && t.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
  for (const b of document.querySelectorAll('.js-next')) {
    if (b.offsetParent !== null) {
      e.preventDefault();
      b.click();
      return;
    }
  }
}
document.addEventListener('keydown', drillKeyNav);
/* "Next →" / "Try again" in the scheduled Drill tab. (Random has its own loop.) */
function practiceNext() {
  drillNext();
}
function practiceRetry() {
  if (!drillCurrent) return;
  const cur = drillCurrent;
  showDrillCard(cur.idx, cur.scheduled, cur.mode, 'drillBody');
  drillCurrent.retry = true;
}
/* ================= Random tab: self-contained "play" engine =================
   Five game modes, formats that rotate per card. Scores into the same rhits/
   rmisses + history.rr/rh counters as before, and never touches the SRS schedule. */
const RMODES = [
  { id: 'shuffle', label: '🔀 Shuffle', desc: 'weighted toward your weak + stale chunks' },
  { id: 'burst', label: '⚡ Burst', desc: '10 in a row, then a scorecard' },
  { id: 'boss', label: '👾 Boss', desc: 'clear your worst chunks one by one' },
  { id: 'wager', label: '🎲 Wager', desc: 'bet before each card, build a multiplier' },
  { id: 'capsule', label: '🕰️ Capsule', desc: 'resurface your oldest chunks' },
  {
    id: 'context',
    label: '📝 Full sentence',
    desc: 'see the context you saved it with, reply with a full sentence using the chunk',
  },
  {
    id: 'dictation',
    label: '🎧 Dictation',
    desc: 'hear a sentence read aloud, type or say what you heard',
  },
  {
    id: 'core',
    label: '⭐ Your 100',
    desc: 'your starred chunks, 10 seconds each — 3 exact in a row and it’s owned',
  },
  {
    id: 'sense',
    label: '👂 Sounds right?',
    desc: 'two sentences, tap the natural one — mostly your own old slips',
  },
];
const RX_FMTS = [
  'blank',
  'recall',
  'produce',
  'scramble',
  'persona',
]; /* client-side formats (Phase 2 adds AI ones) */
const RX_PERSONAS = [
  '😤 furious',
  '🤵 painfully formal',
  '😏 flirty',
  '👶 explaining to a 5-year-old',
  '🤫 whispering a secret',
  '🎭 over-the-top dramatic',
  '😴 half-asleep',
  '📢 announcing it to a stadium',
];
let rxSession = null,
  rxCur = null,
  randomDeck = [],
  randomRecent = [];

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rxDaysAgo(d) {
  if (!d) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000));
}
function rxRate(c) {
  const r = (c.rhits || 0) + (c.rmisses || 0);
  return r ? (c.rmisses || 0) / r : 0.5;
}

/* weight ↑ for chunks you miss and chunks you haven't seen in a while (#1, #8) */
function rxWeight(c) {
  const days = c.lastSeen ? (Date.now() - c.lastSeen) / 86400000 : 30;
  const stale = Math.min(days, 14) / 14;
  const fresh = (c.rhits || 0) + (c.rmisses || 0) === 0 ? 1 : 0;
  return 1 + rxRate(c) * 3 + stale * 2 + fresh;
}
/* weighted permutation (Efraimidis–Spirakis): every chunk appears once before any repeats (#2) */
function rxBuildDeck() {
  randomDeck = chunks
    .map((c, i) => ({ i, k: -Math.log(Math.random() || 1e-9) / rxWeight(c) }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.i);
}
function rxRemember(idx) {
  randomRecent.push(idx);
  while (randomRecent.length > Math.min(3, chunks.length - 1)) randomRecent.shift();
  chunks[idx].lastSeen = Date.now();
}
function rxDraw() {
  if (!randomDeck.length) rxBuildDeck();
  let idx = randomDeck.shift();
  if (chunks.length > 1 && randomRecent.includes(idx) && randomDeck.length) {
    randomDeck.push(idx);
    idx = randomDeck.shift();
  } /* avoid near-repeat across reshuffles (#3) */
  rxRemember(idx);
  return idx;
}
function rxDrawOldest() {
  /* capsule: oldest by the day you stole it */
  const cand = chunks
    .map((c, i) => i)
    .filter((i) => chunks.length <= 1 || !randomRecent.includes(i));
  cand.sort((a, b) => (chunks[a].date || '9999-99').localeCompare(chunks[b].date || '9999-99'));
  const idx = cand[0];
  rxRemember(idx);
  return idx;
}
function rxLeeches(k) {
  /* boss: your worst chunks by random miss-rate */
  return chunks
    .map((c, i) => ({ i, rate: rxRate(c), miss: c.rmisses || 0 }))
    .sort((a, b) => b.rate - a.rate || b.miss - a.miss)
    .slice(0, k)
    .map((o) => o.i);
}

/* ---- launcher ---- */
function randomLauncher() {
  rxSession = null;
  rxCur = null;
  $('randomEyebrow').textContent = "Random practice · doesn't change your schedule";
  if (chunks.length < 1) {
    $('randomModes').innerHTML = '';
    $('randomBody').innerHTML =
      '<div class="empty">Save some chunks in Practice first — then come back and play. Nothing here touches your review schedule.</div>';
    return;
  }
  $('randomModes').innerHTML = RMODES.map(
    (m) => '<button class="chip" onclick="randomBegin(\'' + m.id + '\')">' + m.label + '</button>',
  ).join('');
  $('randomBody').innerHTML =
    '<div class="empty">Pick a mode above 👆<br><br>' +
    RMODES.map(
      (m) => '<div style="margin:4px 0"><b>' + m.label + '</b> — ' + m.desc + '</div>',
    ).join('') +
    '</div>';
}
function randomBegin(mode) {
  if (chunks.length < 1) return;
  randomDeck = [];
  randomRecent = [];
  if (mode === 'burst')
    rxSession = {
      mode: 'burst',
      total: Math.min(10, Math.max(5, chunks.length)),
      done: 0,
      hits: 0,
    };
  else if (mode === 'boss') {
    const q = rxLeeches(Math.min(5, chunks.length));
    rxSession = { mode: 'boss', queue: q.slice(), total: q.length, cleared: 0 };
  } else if (mode === 'wager') rxSession = { mode: 'wager', mult: 1, best: 1 };
  else if (mode === 'capsule') rxSession = { mode: 'capsule', total: chunks.length, seen: 0 };
  else if (mode === 'context') rxSession = { mode: 'context' };
  else if (mode === 'dictation') rxSession = { mode: 'dictation' };
  else if (mode === 'sense') rxSession = { mode: 'sense', recent: [] };
  else if (mode === 'core') rxSession = { mode: 'core' };
  else rxSession = { mode: 'shuffle' };
  $('randomEyebrow').textContent = 'Random · ' + RMODES.find((m) => m.id === mode).label;
  $('randomModes').innerHTML = RMODES.map(
    (m) =>
      '<button class="chip' +
      (m.id === mode ? ' on' : '') +
      '" onclick="randomBegin(\'' +
      m.id +
      '\')">' +
      m.label +
      '</button>',
  ).join('');
  if (mode === 'dictation') dictationNext();
  else if (mode === 'sense') senseNext();
  else if (mode === 'core') coreNext();
  else rxNext();
}

/* ---- ⭐ your 100: the chunks you want automatic ---- */
const CORE_CAP = 100,
  CORE_SECONDS = 10,
  CORE_STREAK = 3;
let coreCur = null,
  coreTimer = null;
/* You used this chunk for real (a message, a meeting): counts in Stats and the recap. */
function usedChunk(i) {
  const c = chunks[i];
  if (!c) return;
  c.used = (c.used || 0) + 1;
  c.lastUsed = dayStr(0);
  chunkSave(c);
  renderChunks();
}
function usedThisWeek() {
  return chunks.filter((c) => c.lastUsed && c.lastUsed >= dayStr(-6));
}
function toggleCore(i) {
  const c = chunks[i];
  if (!c || c.coreDone) return;
  if (!c.core && chunks.filter((x) => x.core).length >= CORE_CAP) {
    alert('Your 100 is full. Un-star one first.');
    return;
  }
  c.core = !c.core;
  chunkSave(c);
  renderChunks();
}
function coreNext() {
  clearInterval(coreTimer);
  const pool = chunks
    .map((c, i) => i)
    .filter((i) => chunks[i].core && !chunks[i].coreDone && drillBlank(chunks[i].chunk, chunks[i].example || '').hasBlank);
  const owned = chunks.filter((c) => c.coreDone).length,
    starred = chunks.filter((c) => c.core).length;
  if (!pool.length) {
    $('randomBody').innerHTML =
      '<div class="empty">' +
      (starred ? '✓ Every starred chunk is owned (' + owned + '). Star more in My chunks.' : 'Star chunks in My chunks (☆ Your 100) to build your list.') +
      '</div>';
    return;
  }
  const idx = pool[Math.floor(Math.random() * pool.length)],
    c = chunks[idx];
  const bl = drillBlank(c.chunk, c.example);
  coreCur = { idx, answer: bl.answer, left: CORE_SECONDS, done: false };
  $('randomBody').innerHTML =
    '<div class="rxMeta">⭐ ' + owned + ' / ' + CORE_CAP + ' owned · streak on this one: ' + (c.coreStreak || 0) + '/' + CORE_STREAK + '</div>' +
    '<div class="drillSentence">' + bl.html + '</div>' +
    '<div class="clock" id="coreClock" style="text-align:right">' + CORE_SECONDS + '</div>' +
    '<input class="drillIn" id="coreInput" autocomplete="off" placeholder="Exact words, fast…">' +
    '<div id="coreVerdict"></div>';
  const inp = $('coreInput');
  inp.focus({ preventScroll: true });
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); /* or the same Enter also "clicks" the Next button focused below */
    coreCheck();
  });
  coreTimer = setInterval(() => {
    if (!coreCur || coreCur.done || !$('coreClock')) return clearInterval(coreTimer); /* left the mode */
    coreCur.left--;
    $('coreClock').textContent = Math.max(0, coreCur.left);
    if (coreCur.left <= 0) coreCheck();
  }, 1000);
}
/* Exact words only (punctuation and case aside): owning means no hesitation. */
function coreCheck() {
  if (!coreCur || coreCur.done) return;
  coreCur.done = true;
  clearInterval(coreTimer);
  const c = chunks[coreCur.idx],
    typed = $('coreInput').value;
  const ok = !!norm(typed) && norm(typed) === norm(coreCur.answer);
  c.coreStreak = ok ? (c.coreStreak || 0) + 1 : 0;
  if (c.coreStreak >= CORE_STREAK) c.coreDone = true;
  scoreRandom(c, ok); /* saves the chunk too */
  $('coreInput').disabled = true;
  $('coreVerdict').innerHTML =
    (ok
      ? '<p class="verdict good">✓ ' + (c.coreDone ? 'Owned! “' + esc(c.chunk) + '” is yours.' : c.coreStreak + ' in a row') + '</p>'
      : '<p class="verdict badv">✗ It was: <b>' + esc(coreCur.answer) + '</b> — streak back to 0</p>') +
    '<div class="row"><button class="btn pulse js-next" onclick="coreNext()">Next →</button></div>';
  const nb = $('coreVerdict').querySelector('.js-next');
  if (nb) nb.focus({ preventScroll: true });
}

/* ---- sounds right?: pick the natural sentence (self-contained, like dictation) ---- */
let senseCur = null;
/* Your own slips: a sentence you wrote and its fix, short enough to compare at a glance. */
function sensePairs() {
  return attempts.filter(
    (a) =>
      a.clean === false &&
      a.blurt &&
      a.fix &&
      norm(a.blurt) !== norm(a.fix) &&
      a.fix.split(/\s+/).length <= 25 &&
      !rxSession.recent.includes(a.id),
  );
}
async function senseNext() {
  const s = rxSession;
  const own = sensePairs();
  const chunkOk = loggedIn() && chunks.some((c) => c.example && drillBlank(c.chunk, c.example).hasBlank);
  let pair = null;
  /* your own history first; a chunk + AI-made slip when there's none (or 1 in 4 for variety) */
  if (own.length && (!chunkOk || Math.random() < 0.75)) {
    const a = own[Math.floor(Math.random() * own.length)];
    s.recent = s.recent.concat(a.id).slice(-20);
    pair = { right: a.fix, wrong: a.blurt, why: a.note || '', own: true, idx: null };
  } else if (chunkOk) {
    $('randomBody').innerHTML = '<div class="drillSentence"><span class="spin"></span> Finding a pair…</div>';
    const idxs = chunks.map((c, i) => i).filter((i) => chunks[i].example && drillBlank(chunks[i].chunk, chunks[i].example).hasBlank);
    const idx = idxs[Math.floor(Math.random() * idxs.length)],
      c = chunks[idx];
    /* same prompt the multiple-choice format uses: plausible wrong forms of the chunk */
    const obj = await rxAI(wrongFormsPrompt(c.chunk));
    const wrong = obj && Array.isArray(obj.wrong) ? obj.wrong.map(String).find((w) => w && norm(w) !== norm(c.chunk)) : null;
    if (!rxSession || rxSession.mode !== 'sense') return; /* left the mode while waiting */
    if (wrong) {
      const re = new RegExp(c.chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const bad = c.example.replace(re, wrong);
      if (bad !== c.example) pair = { right: c.example, wrong: bad, why: 'The phrase is “' + c.chunk + '”.', own: false, idx };
    }
  }
  if (!pair) {
    $('randomBody').innerHTML =
      '<div class="empty">Nothing to compare yet. Once some of your answers get a fix, they show up here as pairs.</div>';
    return;
  }
  senseCur = { ...pair, opts: shuffle([pair.right, pair.wrong]), answered: false };
  $('randomBody').innerHTML =
    '<div class="rxMeta">👂 Which one sounds natural?' + (pair.own ? ' · from your own writing' : '') + '</div>' +
    '<div class="rxBank" style="flex-direction:column;align-items:stretch">' +
    senseCur.opts
      .map((o, i) => '<button class="rxWord" style="text-align:left;line-height:1.45" onclick="sensePick(' + i + ')">' + esc(o) + '</button>')
      .join('') +
    '</div><div id="senseVerdict"></div>';
}
function sensePick(i) {
  if (!senseCur || senseCur.answered) return;
  senseCur.answered = true;
  const ok = senseCur.opts[i] === senseCur.right;
  scoreRandom(senseCur.idx == null ? null : chunks[senseCur.idx], ok);
  $('senseVerdict').innerHTML =
    '<p class="verdict ' + (ok ? 'good">✓ Right — that one sounds natural.' : 'badv">✗ The other one is the natural one.') + '</p>' +
    '<div class="natural diff">' + wordDiff(senseCur.wrong, senseCur.right) + '</div>' +
    (senseCur.why ? '<p class="note">' + esc(senseCur.why) + '</p>' : '') +
    '<div class="row"><button class="btn pulse js-next" onclick="senseNext()">Next →</button></div>';
  const nb = $('senseVerdict').querySelector('.js-next');
  if (nb) nb.focus({ preventScroll: true });
}

/* ---- dictation: listen and reconstruct (self-contained; bypasses the format loop) ---- */
let dictCur = null;
function dictationNext() {
  const idx = rxDraw(),
    c = chunks[idx],
    sentence = pickExample(c);
  dictCur = { idx, sentence };
  $('randomBody').innerHTML =
    '<div class="rxMeta">🎧 Listen, then write what you heard</div>' +
    '<div class="row" style="justify-content:center"><button class="btn" onclick="dictPlay()">🔊 Play</button>' +
    (micOk()
      ? '<button class="btn mic" id="dictMicBtn" onclick="toggleDictMic()" title="Say what you heard">🎤</button>'
      : '') +
    '</div>' +
    '<input class="drillIn" id="dictInput" autocomplete="off" placeholder="Type what you heard...">' +
    '<div class="row"><button class="btn" onclick="dictCheck()">Check</button>' +
    '<button class="btn ghost" onclick="dictPlay()">Replay</button></div>' +
    '<div id="dictVerdict"></div>';
  $('dictInput').focus();
  $('dictInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); /* or the same Enter also "clicks" the Next button dictCheck focuses */
    dictCheck();
  });
  dictPlay();
}
function dictPlay() {
  if (dictCur) speakText(dictCur.sentence);
}
function toggleDictMic() {
  if (micLive) {
    stopMic();
    return;
  }
  const box = $('dictInput');
  if (box) box.value = '';
  startMic('dictInput', 'dictMicBtn'); /* fills the box only — you press Check */
}
function dictCheck() {
  if (!dictCur) return;
  if (micLive) stopMic();
  const gw = norm($('dictInput').value).split(' ').filter(Boolean);
  const aw = norm(dictCur.sentence).split(' ').filter(Boolean);
  const pool = gw.slice();
  let hit = 0;
  aw.forEach((w) => {
    const k = pool.indexOf(w);
    if (k >= 0) {
      hit++;
      pool.splice(k, 1);
    }
  }); /* word-overlap accuracy */
  const pct = aw.length ? Math.round((100 * hit) / aw.length) : 0,
    ok = pct >= 80;
  const c = chunks[dictCur.idx];
  if (ok) {
    c.rhits = (c.rhits || 0) + 1;
  } else {
    c.rmisses = (c.rmisses || 0) + 1;
  }
  chunkSave(c);
  $('dictVerdict').innerHTML =
    '<p class="verdict ' +
    (ok ? 'good' : 'badv') +
    '">' +
    (ok ? '✓ ' : '') +
    pct +
    '% — it was:</p>' +
    '<div class="drillSentence">' +
    esc(dictCur.sentence) +
    '</div>' +
    '<div class="row"><button class="btn pulse js-next" onclick="dictationNext()">Next →</button></div>';
  /* move focus off the input onto Next so Enter/Space advance (no scroll jump) */
  if ($('dictInput')) $('dictInput').blur();
  const nb = $('dictVerdict').querySelector('.js-next');
  if (nb) nb.focus({ preventScroll: true });
}

/* ---- card loop ---- */
function rxModeBanner() {
  const s = rxSession;
  if (!s) return '';
  if (s.mode === 'burst')
    return (
      '<div class="rxBar"><div class="rxFill" style="width:' +
      Math.round((100 * (s.done || 0)) / s.total) +
      '%"></div></div><div class="rxMeta">⚡ Burst · ' +
      (s.done || 0) +
      '/' +
      s.total +
      '</div>'
    );
  if (s.mode === 'boss') {
    const left = s.total - (s.cleared || 0);
    return (
      '<div class="rxBar boss"><div class="rxFill" style="width:' +
      Math.round((100 * (s.cleared || 0)) / s.total) +
      '%"></div></div><div class="rxMeta">👾 Boss · ' +
      left +
      ' chunk' +
      (left !== 1 ? 's' : '') +
      ' still standing</div>'
    );
  }
  if (s.mode === 'wager')
    return (
      '<div class="rxMeta">🎲 Multiplier ×' + (s.mult || 1) + ' · best ×' + (s.best || 1) + '</div>'
    );
  return '';
}
function rxNext() {
  const s = rxSession;
  if (s) {
    if (s.mode === 'burst' && (s.done || 0) >= s.total) return rxBurstSummary();
    if (s.mode === 'boss' && s.queue.length === 0) return rxBossWin();
    if (s.mode === 'capsule' && s.seen >= s.total) return rxCapsuleDone();
    if (s.mode === 'wager') return rxWagerBet();
  }
  rxRenderNext();
}
function rxWagerBet() {
  rxCur = null;
  $('randomBody').innerHTML =
    rxModeBanner() +
    '<div class="drillSentence" style="text-align:center">Next card — how confident are you?</div>' +
    '<div class="row" style="justify-content:center"><button class="btn" onclick="rxSetBet(\'nail\')">💪 I\'ll nail it</button>' +
    '<button class="btn ghost" onclick="rxSetBet(\'shaky\')">😬 Shaky</button></div>' +
    '<div class="drillStats">Call it right → multiplier climbs. Call it wrong → back to ×1.</div>';
}
function rxSetBet(b) {
  rxSession.bet = b;
  rxRenderNext();
}
function rxRenderNext() {
  const s = rxSession;
  let idx;
  if (s && s.mode === 'boss') {
    idx = s.queue.shift();
  } else if (s && s.mode === 'capsule') {
    idx = rxDrawOldest();
    s.seen++;
  } else idx = rxDraw();
  rxRender(idx);
}
const RX_AI_FMTS = ['mc', 'emoji', 'scene', 'frankenstein']; /* need the Gemini worker */
function rxPickFormat() {
  let pool = RX_FMTS.slice();
  if (loggedIn()) {
    pool = pool.concat('mc', 'emoji', 'scene');
    if (chunks.length >= 2) pool.push('frankenstein');
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
function rxRender(idx) {
  const s = rxSession;
  const fmt =
    s && s.mode === 'capsule' ? 'blank' : s && s.mode === 'context' ? 'ctxFull' : rxPickFormat();
  rxRenderWith(idx, fmt);
}
function rxRenderWith(idx, fmt) {
  const c = chunks[idx],
    s = rxSession;
  const inExample = drillBlank(c.chunk, c.example).hasBlank;
  if (fmt === 'blank' && !inExample) fmt = 'recall';
  if (fmt === 'recall' && !c.context) fmt = inExample ? 'blank' : 'produce';
  if (fmt === 'ctxFull' && !c.context) fmt = 'produce';
  rxCur = {
    idx,
    fmt,
    answered: false,
    produce: fmt === 'produce' || fmt === 'scene' || fmt === 'frankenstein' || fmt === 'ctxFull',
  };
  let banner = rxModeBanner();
  if (s && s.mode === 'capsule') {
    const a = rxDaysAgo(c.date);
    banner =
      '<div class="drillCtx">🕰️ ' +
      (a <= 0 ? 'today' : a + ' day' + (a > 1 ? 's' : '') + ' ago') +
      ' you stole this' +
      (c.context ? ' — ' + esc(c.context) : '') +
      '</div>';
  }
  if (RX_AI_FMTS.includes(fmt)) {
    $('randomBody').innerHTML =
      banner + '<div class="drillSentence"><span class="spin"></span> Cooking up a surprise…</div>';
    rxRenderAI(fmt, idx, banner);
    return;
  }
  $('randomBody').innerHTML = banner + rxBodyHTML(fmt, c);
  rxBodyInit(fmt);
}
function rxBodyHTML(fmt, c) {
  const showMe = '<button class="btn ghost" onclick="rxReveal()">I forgot — show me</button>';
  if (fmt === 'scramble') {
    return (
      '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>' +
      '<p class="hint">Tap the words back into the right order:</p>' +
      '<div class="drillSentence" id="rxAns">&nbsp;</div><div class="rxBank" id="rxBank"></div>' +
      '<div class="row"><button class="btn" onclick="rxScrambleCheck()">Check</button>' +
      '<button class="btn ghost" onclick="rxScrambleClear()">Clear</button>' +
      showMe +
      '</div><div id="rxVerdict"></div>'
    );
  }
  if (fmt === 'persona') {
    rxCur.persona = RX_PERSONAS[Math.floor(Math.random() * RX_PERSONAS.length)];
    return (
      '<div class="drillSentence"><b style="letter-spacing:0">' +
      esc(c.chunk) +
      '</b></div>' +
      '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>' +
      '<p class="hint">Say it out loud — but ' +
      rxCur.persona +
      '.</p>' +
      '<div class="row"><button class="btn" onclick="rxSelfGrade(true)">🎙️ Nailed it</button>' +
      '<button class="btn ghost" onclick="rxSelfGrade(false)">😬 Fumbled</button></div>' +
      '<div id="rxVerdict"></div><div class="drillStats">Speaking drill — you grade yourself.</div>'
    );
  }
  let cue,
    ph,
    hint = '';
  if (fmt === 'ctxFull') {
    cue =
      '<div class="drillCtx">💬 ' +
      esc(c.context) +
      '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>' +
      '</div><div class="drillSentence" id="rxChunkHint" style="display:none"><b style="letter-spacing:0">' +
      esc(c.chunk) +
      '</b></div>';
    hint = 'Reply to that context with a full sentence using the chunk.';
    ph = 'Write your full sentence...';
  } else if (fmt === 'produce') {
    cue = '<div class="drillSentence"><b style="letter-spacing:0">' + esc(c.chunk) + '</b></div>';
    hint = 'Use it in a full sentence of your own.';
    ph = 'Write a sentence using it...';
  } else if (fmt === 'recall') {
    const bl = drillBlank(c.chunk, c.example);
    if (bl.hasBlank) rxCur.answer = bl.answer;
    cue = '<div class="drillCtx">💬 ' + esc(c.context) + '</div>';
    hint = 'What chunk did you save for this? (from memory)';
    ph = 'Type the chunk...';
  } else {
    const bl = drillBlank(c.chunk, c.example);
    rxCur.answer = bl.answer || c.chunk;
    cue = '<div class="drillSentence">' + bl.html + '</div>';
    ph = 'Fill the blank from memory...';
  }
  const hintBtn =
    fmt === 'ctxFull'
      ? '<button class="btn ghost" id="rxHintBtn" onclick="rxShowChunkHint()">💡 Hint</button>'
      : '';
  return (
    cue +
    (fmt === 'ctxFull'
      ? ''
      : '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>') +
    (hint ? '<p class="hint">' + hint + '</p>' : '') +
    '<input class="drillIn" id="rxInput" autocomplete="off" placeholder="' +
    ph +
    '">' +
    '<div class="row"><button class="btn" onclick="rxCheck()">Check</button>' +
    hintBtn +
    showMe +
    '</div><div id="rxVerdict"></div>'
  );
}
function rxBodyInit(fmt) {
  if (fmt === 'persona') return;
  if (fmt === 'scramble') {
    const c = chunks[rxCur.idx];
    rxCur.words = c.chunk.split(/\s+/);
    rxCur.shuf = shuffle(rxCur.words.map((w, i) => i));
    rxCur.order = [];
    rxRenderScramble();
    return;
  }
  const inp = $('rxInput');
  if (inp) {
    inp.focus({ preventScroll: true }); /* don't yank the page to the top on Next */
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rxCheck();
    });
  }
}

/* scramble interaction */
function rxRenderScramble() {
  const dw = rxCur.words,
    used = new Set(rxCur.order);
  $('rxAns').innerHTML = rxCur.order.length
    ? rxCur.order
        .map(
          (i, pos) =>
            '<button class="rxWord" onclick="rxScrUnpick(' + pos + ')">' + esc(dw[i]) + '</button>',
        )
        .join('')
    : '&nbsp;';
  $('rxBank').innerHTML = rxCur.shuf
    .map((i) =>
      used.has(i)
        ? ''
        : '<button class="rxWord" onclick="rxScrPick(' + i + ')">' + esc(dw[i]) + '</button>',
    )
    .join('');
}
function rxScrPick(i) {
  if (rxCur.answered) return;
  rxCur.order.push(i);
  rxRenderScramble();
}
function rxScrUnpick(pos) {
  if (rxCur.answered) return;
  rxCur.order.splice(pos, 1);
  rxRenderScramble();
}
function rxScrambleClear() {
  if (rxCur.answered) return;
  rxCur.order = [];
  rxRenderScramble();
}
function rxScrambleCheck() {
  const c = chunks[rxCur.idx];
  const guess = rxCur.order.map((i) => rxCur.words[i]).join(' ');
  rxResolve(rxMatch(guess, c.chunk), guess);
}

/* matching + verdict (#7 near-miss feedback) */
function rxMatch(guess, target) {
  const g = norm(guess),
    t = norm(target);
  if (!g) return { ok: false, exact: false };
  if (g === t) return { ok: true, exact: true };
  const ok = (t.includes(g) && g.length >= t.length * 0.6) || g.includes(t);
  return { ok, exact: false };
}
function rxContains(guess, chunk) {
  const g = norm(guess),
    t = norm(chunk);
  return !!g && (g.includes(t) || t.split(' ').every((w) => g.includes(w)));
}
function rxVerdictHTML(res, c, guess) {
  /* full-sentence / produce modes: goal is using the chunk in a sentence, not matching an exact form */
  if (rxCur && (rxCur.fmt === 'ctxFull' || rxCur.fmt === 'produce'))
    return res.ok
      ? '<p class="verdict good">✓ Nice — you worked in <b>' + esc(c.chunk) + '</b></p>'
      : '<p class="verdict badv">✗ Include the chunk: <b>' + esc(c.chunk) + '</b></p>';
  if (res.ok && res.exact)
    return '<p class="verdict good">✓ Nailed it — <b>' + esc(c.chunk) + '</b></p>';
  if (res.ok)
    return (
      '<p class="verdict good">✓ Close enough — exact form: <b>' +
      esc(c.chunk) +
      '</b>' +
      (guess ? '<br><span class="rxWrote">you wrote: ' + esc(guess) + '</span>' : '') +
      '</p>'
    );
  return (
    '<p class="verdict badv">✗ It was: <b>' +
    esc(c.chunk) +
    '</b>' +
    (guess ? '<br><span class="rxWrote">you wrote: ' + esc(guess) + '</span>' : '') +
    '</p>'
  );
}

/* scoring — same counters as before, schedule untouched. c is null for rounds
   not tied to a chunk (Sounds right? on your own old attempts). */
function scoreRandom(c, ok) {
  const hd = hist();
  hd.rr = (hd.rr || 0) + 1;
  if (ok) hd.rh = (hd.rh || 0) + 1;
  saveState();
  if (!c) return;
  ok ? (c.rhits = (c.rhits || 0) + 1) : (c.rmisses = (c.rmisses || 0) + 1);
  chunkSave(c);
}
function rxRecord(idx, ok) {
  scoreRandom(chunks[idx], ok);
  const s = rxSession;
  if (!s) return;
  s.done = (s.done || 0) + 1;
  if (ok) s.hits = (s.hits || 0) + 1;
  if (s.mode === 'wager') {
    const hit = (s.bet === 'nail') === ok;
    s.mult = hit ? (s.mult || 1) + 1 : 1;
    s.best = Math.max(s.best || 1, s.mult);
  }
  if (s.mode === 'boss') {
    if (ok) s.cleared = (s.cleared || 0) + 1;
    else s.queue.push(idx);
  }
}
function rxCheck() {
  const c = chunks[rxCur.idx],
    v = $('rxInput').value;
  let res;
  if (rxCur.fmt === 'frankenstein')
    res = { ok: rxContains(v, c.chunk) && rxContains(v, rxCur.chunk2), exact: false };
  else if (rxCur.produce) res = { ok: rxContains(v, c.chunk), exact: false };
  else res = rxMatch(v, rxCur.answer || c.chunk);
  rxResolve(res, v);
}
function rxReveal() {
  rxResolve({ ok: false, exact: false }, '');
}
function rxShowChunkHint() {
  const h = $('rxChunkHint');
  if (h) h.style.display = '';
  const b = $('rxHintBtn');
  if (b) b.style.display = 'none';
}
function rxSelfGrade(ok) {
  rxResolve({ ok, exact: ok, self: true }, '');
}
function rxResolve(res, guess) {
  if (!rxCur || rxCur.answered) return;
  rxCur.answered = true;
  const c = chunks[rxCur.idx];
  rxRecord(rxCur.idx, res.ok);
  renderHeader();
  renderHW();
  let v = res.self
    ? res.ok
      ? '<p class="verdict good">🎙️ Logged — nice.</p>'
      : '<p class="verdict badv">Marked as fumbled — it\'ll resurface.</p>'
    : rxVerdictHTML(res, c, guess);
  const s = rxSession;
  let extra = '';
  if (rxCur.fmt === 'ctxFull' && c.example)
    extra += '<p class="sched">Full sentence: <b>' + esc(c.example) + '</b></p>';
  if (rxCur.fmt === 'frankenstein')
    extra +=
      '<p class="sched">Both targets: <b>' +
      esc(c.chunk) +
      '</b> + <b>' +
      esc(rxCur.chunk2) +
      '</b></p>';
  if (s && s.mode === 'wager') {
    const hit = (s.bet === 'nail') === res.ok;
    extra +=
      '<p class="sched">' +
      (hit ? 'Bet paid off → ×' + s.mult : 'Bet missed → reset to ×1') +
      '</p>';
  }
  $('rxVerdict').innerHTML =
    v +
    extra +
    '<div class="row"><button class="btn pulse js-next" onclick="rxNext()">Next →</button>' +
    '<button class="btn ghost" onclick="randomLauncher()">Change mode</button></div>';
  /* drop the pre-answer action row (Check / I forgot…) so it doesn't linger under the verdict */
  const actionRow = $('rxVerdict').previousElementSibling;
  if (actionRow && actionRow.classList.contains('row')) actionRow.style.display = 'none';
  if ($('rxInput')) $('rxInput').blur(); /* free up Space for "Next" (see drillKeyNav) */
}

/* end-of-mode screens */
function rxBurstSummary() {
  const s = rxSession,
    pct = Math.round((100 * (s.hits || 0)) / s.total);
  $('randomBody').innerHTML =
    '<div class="drillSentence" style="text-align:center;margin-top:18px"><div style="font-size:2rem">' +
    (pct >= 80 ? '🏆' : pct >= 50 ? '👏' : '💪') +
    '</div><b>' +
    (s.hits || 0) +
    '/' +
    s.total +
    '</b> this burst · ' +
    pct +
    '%</div>' +
    '<div class="row" style="justify-content:center"><button class="btn pulse" onclick="randomBegin(\'burst\')">Another burst</button>' +
    '<button class="btn ghost" onclick="randomLauncher()">Change mode</button></div>';
  rxSession = null;
}
function rxBossWin() {
  $('randomBody').innerHTML =
    '<div class="drillSentence" style="text-align:center"><div style="font-size:2rem">👾💥</div>Boss cleared — every chunk down!</div>' +
    '<div class="row" style="justify-content:center"><button class="btn pulse" onclick="randomBegin(\'boss\')">Rematch</button>' +
    '<button class="btn ghost" onclick="randomLauncher()">Change mode</button></div>';
  rxSession = null;
}
function rxCapsuleDone() {
  const n = rxSession.total;
  $('randomBody').innerHTML =
    '<div class="drillSentence" style="text-align:center"><div style="font-size:2rem">🕰️✨</div>All ' +
    n +
    ' chunk' +
    (n !== 1 ? 's' : '') +
    ' resurfaced!</div>' +
    '<div class="row" style="justify-content:center"><button class="btn pulse" onclick="randomBegin(\'capsule\')">Again</button>' +
    '<button class="btn ghost" onclick="randomLauncher()">Change mode</button></div>';
  rxSession = null;
}

/* ---- AI-backed formats (Phase 2): generation runs through the Worker; grading stays client-side ---- */
/* Three near-miss forms of a phrase (multiple choice, Sounds right?). */
function wrongFormsPrompt(chunk) {
  return (
    'Target English phrase: "' +
    chunk +
    '". Give THREE plausible but WRONG variants a Vietnamese learner might say (wrong preposition/tense/article/word-order, or classic slips like "should of"). Keep each close to the target. Reply ONLY JSON: {"wrong":["..","..",".."]}'
  );
}
async function rxAI(prompt) {
  return aiObj({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
}
async function rxRenderAI(fmt, idx, banner) {
  const c = chunks[idx];
  let obj = null,
    c2 = null;
  if (fmt === 'frankenstein') {
    let j = idx;
    while (j === idx && chunks.length > 1) j = Math.floor(Math.random() * chunks.length);
    c2 = chunks[j];
    if (rxCur) rxCur.chunk2 = c2.chunk;
    obj = await rxAI(
      'Invent ONE short, absurd scenario (max 30 words) that forces someone to naturally use BOTH of these English phrases in a single spoken reply: "' +
        c.chunk +
        '" and "' +
        c2.chunk +
        '". Reply ONLY JSON: {"scenario":"..."}',
    );
  } else if (fmt === 'scene') {
    obj = await rxAI(
      'Write a 2-line dialogue (A then B) that sets up a moment where the natural next reply would use the English phrase "' +
        c.chunk +
        '"' +
        (c.context ? ' (situation: ' + c.context + ')' : '') +
        '. Stop right before the reply. Reply ONLY JSON: {"a":"first line","b":"second line"}',
    );
  } else if (fmt === 'emoji') {
    obj = await rxAI(
      'Represent the MEANING of the English phrase "' +
        c.chunk +
        '"' +
        (c.context ? ' (context: ' + c.context + ')' : '') +
        ' using ONLY 2 to 5 emoji and no words. Reply ONLY JSON: {"emoji":"..."}',
    );
  } else if (fmt === 'mc') {
    obj = await rxAI(wrongFormsPrompt(c.chunk));
  }
  if (!rxCur || rxCur.idx !== idx || rxCur.fmt !== fmt) return; /* user moved on while we waited */
  if (!obj || (fmt === 'mc' && !(obj.wrong && obj.wrong.length))) {
    rxRenderWith(idx, 'blank');
    return;
  } /* AI unavailable → client fallback */
  const showMe = '<button class="btn ghost" onclick="rxReveal()">I forgot — show me</button>';
  let html = banner;
  if (fmt === 'frankenstein') {
    html +=
      '<div class="drillCtx">🧪 Frankenstein — use BOTH phrases in one sentence</div>' +
      '<div class="drillSentence">' +
      esc(obj.scenario || 'Make one sentence using both phrases.') +
      '</div>' +
      '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>' +
      '<p class="hint">Must include: <b>' +
      esc(c.chunk) +
      '</b> + <b>' +
      esc(c2.chunk) +
      '</b></p>' +
      '<input class="drillIn" id="rxInput" autocomplete="off" placeholder="One sentence, both phrases...">' +
      '<div class="row"><button class="btn" onclick="rxCheck()">Check</button>' +
      showMe +
      '</div><div id="rxVerdict"></div>';
  } else if (fmt === 'scene') {
    html +=
      '<div class="drillCtx">🎬 You\'re in the scene — reply naturally</div>' +
      '<div class="drillSentence">' +
      (obj.a ? '<b>A:</b> ' + esc(obj.a) + '<br>' : '') +
      (obj.b ? '<b>B:</b> ' + esc(obj.b) : '') +
      '</div>' +
      '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>' +
      '<p class="hint">Reply using the chunk you saved.</p>' +
      '<input class="drillIn" id="rxInput" autocomplete="off" placeholder="Your reply...">' +
      '<div class="row"><button class="btn" onclick="rxCheck()">Check</button>' +
      showMe +
      '</div><div id="rxVerdict"></div>';
  } else if (fmt === 'emoji') {
    html +=
      '<div class="drillCtx">🔣 Emoji charades — name the chunk</div>' +
      '<div class="drillSentence" style="font-size:2rem;text-align:center;letter-spacing:.1em">' +
      esc(obj.emoji || '🤔') +
      '</div>' +
      '<input class="drillIn" id="rxInput" autocomplete="off" placeholder="What chunk is this?">' +
      '<div class="row"><button class="btn" onclick="rxCheck()">Check</button>' +
      showMe +
      '</div><div id="rxVerdict"></div>';
  } else if (fmt === 'mc') {
    const opts = shuffle([c.chunk].concat(obj.wrong.slice(0, 3)));
    rxCur.mcOptions = opts;
    const cue = c.context
      ? esc(c.context)
      : esc(c.example).replace(
          new RegExp(esc(c.chunk).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          '<b>＿＿＿</b>',
        );
    html +=
      '<div class="drillCtx">🎯 Which form is right?</div><div class="drillSentence">' +
      cue +
      '</div>' +
      '<button class="speak" onclick="speakRxEx()" title="Hear it">🔊</button>' +
      '<div class="rxBank" style="flex-direction:column;align-items:stretch">' +
      opts
        .map(
          (o, i) =>
            '<button class="rxWord" style="text-align:left" onclick="rxMcPick(' +
            i +
            ')">' +
            esc(o) +
            '</button>',
        )
        .join('') +
      '</div><div id="rxVerdict"></div>';
  }
  $('randomBody').innerHTML = html;
  const inp = $('rxInput');
  if (inp) {
    inp.focus({ preventScroll: true }); /* don't yank the page to the top on Next */
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rxCheck();
    });
  }
}
function rxMcPick(i) {
  if (!rxCur || rxCur.answered) return;
  const c = chunks[rxCur.idx],
    pick = rxCur.mcOptions[i],
    ok = norm(pick) === norm(c.chunk);
  rxResolve({ ok, exact: ok }, pick);
}

/* ================= conversation mode ================= */
/* Multi-turn English role-play. The AI invents a scenario + character (seeded by
   your due/nemesis chunks), trades short spoken lines with you, then grades the
   whole exchange. Transcript is sent as text each turn (no role plumbing needed). */
let conv = null;
function convLauncher() {
  if (conv && !conv.done) {
    convRender();
    return;
  }
  conv = null;
  if (!loggedIn()) {
    $('convBody').innerHTML =
      '<div class="empty">Log in (Settings below) to chat with the AI.</div>';
    return;
  }
  $('convBody').innerHTML =
    '<div class="empty">A live English conversation, seeded by the chunks you\'re reviewing. Short back-and-forth, then a grade.</div>' +
    '<div class="row"><button class="btn pulse" onclick="convStart()">Start a conversation →</button></div>';
}
function convTranscript() {
  return conv.turns
    .map((t) => (t.who === 'you' ? 'Learner' : conv.role) + ': ' + t.text)
    .join('\n');
}
async function convStart() {
  if (!loggedIn()) return;
  const due = dueChunks().map((c) => c.chunk);
  const targets = (
    due.length ? due : [...chunks].sort(() => Math.random() - 0.5).map((c) => c.chunk)
  ).slice(0, 3);
  conv = { targets, turns: [], userTurns: 0, role: '', scenario: '', done: false };
  $('convBody').innerHTML =
    '<div class="drillSentence"><span class="spin"></span> Setting the scene...</div>';
  const obj = await aiObj({
    contents: [
      {
        parts: [
          {
            text: `Role-play to help a Vietnamese software developer practice spoken English. Invent a short everyday scenario and a character for you to play.${targets.length ? ' Try to make a situation where these phrases could naturally come up: ' + targets.join(', ') + '.' : ''}
Keep your spoken lines short (1-2 sentences), natural and casual.
Reply ONLY JSON: {"scenario":"one-line setup shown to the learner","role":"who you are playing","opening":"your first spoken line"}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !obj.opening) {
    convLauncher();
    $('convBody').insertAdjacentHTML(
      'beforeend',
      '<div class="empty">Couldn\'t start — try again.</div>',
    );
    return;
  }
  conv.scenario = obj.scenario || '';
  conv.role = obj.role || 'Someone';
  conv.turns.push({ who: 'them', text: obj.opening });
  convRender();
}
async function convSend() {
  if (!conv || conv.done) return;
  const v = $('convInput').value.trim();
  if (!v) return;
  if (micLive) stopMic();
  conv.turns.push({ who: 'you', text: v });
  conv.userTurns++;
  convRender(true);
  const obj = await aiObj({
    contents: [
      {
        parts: [
          {
            text: `You are ${conv.role} in a role-play with an English learner.
Scenario: ${conv.scenario}
Conversation so far:
${convTranscript()}
Continue with your NEXT short spoken line (1-2 sentences). Stay in character, keep it easy to respond to.
Reply ONLY JSON: {"reply":"your next line"}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  });
  conv.turns.push({ who: 'them', text: (obj && obj.reply) || '(...)' });
  convRender();
}
function toggleConvMic() {
  if (micLive) {
    stopMic();
    return;
  }
  const box = $('convInput');
  if (box) box.value = '';
  startMic('convInput', 'convMicBtn');
}
async function convEnd() {
  if (!conv || conv.done) return;
  $('convBody').insertAdjacentHTML(
    'beforeend',
    '<div class="drillSentence"><span class="spin"></span> Grading the conversation...</div>',
  );
  const obj = await aiObj({
    contents: [
      {
        parts: [
          {
            text: `Here is a role-play conversation between a character (${conv.role}) and a Vietnamese English learner.
Scenario: ${conv.scenario}
Transcript:
${convTranscript()}
Target phrases the learner was practicing: ${conv.targets.join(', ') || '(none)'}
Assess the learner's spoken English across the conversation, then check each of the learner's lines (the "Learner:" turns, in order, one entry per line). Reply ONLY JSON:
{"grade":"a short verdict like 'Natural' / 'Getting there' / 'Keep practicing'","used":["which target phrases they actually used, if any"],"note":"2-3 sentences of specific, encouraging feedback with one concrete tip","lines":[{"you":"the learner's line, exactly as written","fixed":"THEIR line minimally corrected: keep their words, change only what is wrong or unnatural. Copy it exactly if nothing needs changing.","clean":true or false (true = no meaningful change needed, ignoring capitalization and punctuation),${TAGS_FIELD}}]}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  });
  conv.done = true;
  conv.result = obj || { grade: 'Done', used: [], note: '' };
  /* One verdict per learner line, paired by position with what they actually
     typed (never the AI's copy of it). Ungraded when the AI didn't answer. */
  const graded = obj && Array.isArray(obj.lines) ? obj.lines : [];
  conv.result.lines = conv.turns
    .filter((t) => t.who === 'you')
    .map((t, i) => {
      const g = graded[i] || null;
      const fixed = g && g.fixed ? String(g.fixed).trim() : '';
      return {
        you: t.text,
        fixed,
        tags: g ? cleanTags(g.tags) : [],
        clean: !g || !fixed ? null : truthy(g.clean) || norm(t.text) === norm(fixed),
      };
    });
  conv.result.lines.forEach((l) =>
    logAttempt({
      source: 'chat',
      kind: 'chat',
      prompt: conv.scenario,
      blurt: l.you,
      fix: l.fixed,
      tags: l.tags,
      clean: l.clean,
    }),
  );
  creditRep(); /* a finished conversation counts as one homework rep */
  convRender();
}
/* Each of your lines after grading: ✓ when it was already natural, else the diff. */
function convLinesHTML(lines) {
  if (!lines.length) return '';
  const n = lines.filter((l) => l.clean != null).length,
    c = lines.filter((l) => l.clean).length;
  return (
    '<div class="eyebrow" style="margin-top:18px">Your lines' +
    (n ? ' · ✓ ' + c + ' of ' + n + ' already natural' : '') +
    '</div>' +
    lines
      .map(
        (l) =>
          '<div class="writeSent">' +
          (l.clean === true
            ? '<div class="cleanSent">✓ ' + esc(l.you) + '</div>'
            : l.clean === false
              ? '<div class="natural diff">' + wordDiff(l.you, l.fixed) + '</div>'
              : '<div>' + esc(l.you) + '</div>') +
          (l.clean === false && l.tags.length
            ? '<div style="margin-top:4px;font-size:.78rem;color:var(--muted)">' + l.tags.map((t) => esc(TAG_LABELS[t] || t)).join(' · ') + '</div>'
            : '') +
          '</div>',
      )
      .join('')
  );
}
function convRender(thinking) {
  if (!conv) {
    convLauncher();
    return;
  }
  let html =
    '<div class="convScenario">🎬 ' +
    esc(conv.scenario) +
    " — you're talking to <b>" +
    esc(conv.role) +
    '</b></div>';
  html +=
    '<div class="convLog">' +
    conv.turns
      .map(
        (t) =>
          '<div class="convMsg ' +
          (t.who === 'you' ? 'convYou' : 'convThem') +
          '">' +
          esc(t.text) +
          '</div>',
      )
      .join('') +
    (thinking ? '<div class="convMsg convThem"><span class="spin"></span></div>' : '') +
    '</div>';
  if (conv.done) {
    const r = conv.result || {};
    html +=
      '<div class="chunkBox"><div><b>' +
      esc(r.grade || 'Done') +
      '</b>' +
      (r.used && r.used.length
        ? '<div class="meta">✓ used: ' + r.used.map(esc).join(', ') + '</div>'
        : '') +
      '</div></div>' +
      '<p class="note">' +
      esc(r.note || '') +
      '</p>' +
      convLinesHTML(r.lines || []) +
      '<div class="row"><button class="btn pulse" onclick="convStart()">New conversation →</button></div>';
  } else {
    html +=
      '<input class="drillIn" id="convInput" autocomplete="off" placeholder="Your reply...">' +
      '<div class="row"><button class="btn" onclick="convSend()">Send</button>' +
      (micOk()
        ? '<button class="btn mic" id="convMicBtn" onclick="toggleConvMic()" title="Speak your reply">🎤</button>'
        : '') +
      '<button class="btn ghost" onclick="convEnd()">End &amp; grade</button></div>' +
      (conv.userTurns >= 4
        ? '<div class="drillStats">Good run — wrap up whenever with “End &amp; grade”.</div>'
        : '');
  }
  $('convBody').innerHTML = html;
  const inp = $('convInput');
  if (inp && !thinking && !conv.done) {
    inp.focus();
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') convSend();
    });
  }
}

/* ================= chunks tab ================= */
/* Clear what a previous result left behind: save buttons, the clean banner,
   and any type-it-back attempt. */
function resetResultCard() {
  resetSaveBtn();
  $('cleanLead').style.display = 'none';
  $('predBox').style.display = 'none';
  $('predBox').innerHTML = '';
  if (predictResolve) predictReveal(); /* a gate left open by leaving mid-rep */
  $('typeBack').style.display = 'none';
  $('typeBackIn').value = '';
  $('typeBackOut').innerHTML = '';
  $('typeBackBtn').style.display = '';
  ['suggestText', 'naturalText'].forEach((id) => $(id).classList.remove('blurred'));
}
/* Type it back: hide the native version, retype it from memory, see the diff.
   Pure practice — no effect on homework, streak, or the schedule. */
function typeBackTarget() {
  return $('sitResult').style.display !== 'none' ? $('suggestText') : $('naturalText');
}
function startTypeBack() {
  if (!lastResult || !lastResult.natural) return;
  typeBackTarget().classList.add('blurred');
  $('typeBackBtn').style.display = 'none';
  $('typeBack').style.display = '';
  $('typeBackOut').innerHTML = '';
  const inp = $('typeBackIn');
  inp.value = '';
  inp.disabled = false;
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      checkTypeBack();
    }
  };
  inp.focus();
}
function checkTypeBack() {
  const inp = $('typeBackIn');
  const typed = inp.value.trim();
  if (!typed || !lastResult) return;
  const target = lastResult.natural;
  inp.disabled = true;
  typeBackTarget().classList.remove('blurred');
  const exact = norm(typed) === norm(target);
  $('typeBackOut').innerHTML =
    (exact
      ? '<div class="verdict good">✓ Word for word.</div>'
      : '<div class="verdict badv">Close. Here\'s what changed:</div>') +
    (exact ? '' : '<div class="natural diff">' + wordDiff(typed, target) + '</div>');
}
function resetSaveBtn() {
  [
    ['saveChunkBtn', 'Save'],
    ['saveFixedBtn', 'Save'],
    ['saveSuggestBtn', 'Save'],
  ].forEach(([id, label]) => {
    const b = $(id);
    if (b) {
      b.textContent = label;
      b.disabled = false;
    }
  });
}
async function saveChunk(which) {
  if (!lastResult) return;
  const btnId =
    which === 'fixed' ? 'saveFixedBtn' : which === 'suggested' ? 'saveSuggestBtn' : 'saveChunkBtn';
  const b = $(btnId);
  if (b && b.disabled) return; /* already saving/saved — ignore double taps */
  if (b) {
    b.textContent = 'Saving…';
    b.disabled = true;
  }
  const example =
    which === 'fixed' ? lastResult.fixedAnswer || lastResult.natural : lastResult.natural;
  const newChunk = {
    ...newChunkBase(),
    chunk: lastResult.chunk,
    example,
    context: (current && current.prompt && current.prompt.text) || '',
  };
  chunks.unshift(newChunk);
  await chunkAdd(newChunk);
  renderHeader();
  renderHW();
  if (b) {
    b.textContent = 'Saved ✓';
    b.disabled = true;
  }
}
let chunkSearchTimer = null;
function chunkSearchInput() {
  clearTimeout(chunkSearchTimer);
  chunkSearchTimer = setTimeout(renderChunks, 150);
}
function renderChunks() {
  const list = $('chunkList');
  if (!chunks.length) {
    list.innerHTML =
      '<div class="empty">Nothing stolen yet. Do a rep, steal a chunk — it enters the review schedule automatically.</div>';
    return;
  }
  const t = dayStr(0);
  const q = norm(($('chunkSearch') || {}).value || '');
  const shown = q
    ? chunks.filter((c) => norm([c.chunk, c.example, c.context].join(' ')).includes(q))
    : chunks;
  if (!shown.length) {
    list.innerHTML = '<div class="empty">No chunk matches that.</div>';
    return;
  }
  list.innerHTML = [...shown]
    .sort((a, b) => a.due.localeCompare(b.due))
    .map((c) => {
      const i = chunks.indexOf(c);
      const dueTxt = c.due <= t ? '<span class="dueNow">due now</span>' : 'next: ' + c.due;
      const leech = isLeech(c);
      return (
        '<div class="chunkItem"><div><b>' +
        esc(c.chunk) +
        '</b>' +
        (leech ? '<span class="leechBadge" title="You keep missing this">🩸 leech</span>' : '') +
        '<button class="speak" onclick="speakChunk(' +
        i +
        ')" title="Hear it">🔊</button><small>' +
        esc(c.example) +
        '</small>' +
        '<div class="meta">✓' +
        (c.hits || 0) +
        ' ✗' +
        (c.misses || 0) +
        (c.rhits || c.rmisses ? ' · 🎲 ✓' + (c.rhits || 0) + ' ✗' + (c.rmisses || 0) : '') +
        ' · ' +
        dueTxt +
        '</div>' +
        '<div class="row"><button class="btn ghost" onclick="expandChunk(' +
        i +
        ')">🌱 Related</button>' +
        '<button class="btn ghost" onclick="usedChunk(' +
        i +
        ')" title="You used this in real life">✔ used it' +
        (c.used ? ' · ' + c.used : '') +
        '</button>' +
        '<button class="btn ghost" onclick="toggleCore(' +
        i +
        ')" title="Your 100: the chunks you want to own">' +
        (c.coreDone ? '✓ owned' : c.core ? '⭐ in your 100' : '☆ Your 100') +
        '</button>' +
        (leech
          ? '<button class="btn ghost" onclick="reformulateChunk(' +
            i +
            ')">✨ Reformulate</button>'
          : '') +
        '</div>' +
        '<div id="expand' +
        i +
        '"></div>' +
        (leech ? '<div id="reform' + i + '"></div>' : '') +
        '</div>' +
        '<button class="del" onclick="delChunk(' +
        i +
        ')">remove</button></div>'
      );
    })
    .join('');
}
/* A leech is a chunk you keep failing: lapsed several times and still miss it about
   as often as you land it. (Pre-SM-2 chunks fall back to raw miss count.) */
function isLeech(c) {
  const lap = c.lapses != null ? c.lapses : c.misses || 0;
  return lap >= 4 && (c.hits || 0) <= lap;
}
const reformPending = {};
async function reformulateChunk(i) {
  const c = chunks[i],
    box = $('reform' + i);
  if (!box) return;
  if (!loggedIn()) {
    box.innerHTML = '<div class="empty">Log in to reformulate.</div>';
    return;
  }
  box.innerHTML = '<span class="spin"></span> Rethinking this one...';
  const msg = `A Vietnamese software developer keeps forgetting this English phrase: "${c.chunk}"${c.context ? ' (context: ' + c.context + ')' : ''}.
Help it stick. Reply with ONLY JSON:
{"example":"a SHORT, vivid, easy-to-picture everyday sentence (max 16 words) using the phrase verbatim","tip":"a one-line memory hook in Vietnamese"}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: msg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const ex = obj && obj.example && String(obj.example).trim();
  if (!ex || !drillBlank(c.chunk, ex).hasBlank) {
    box.innerHTML = '<div class="empty">Couldn\'t reformulate — try again.</div>';
    return;
  }
  reformPending[i] = ex;
  box.innerHTML =
    '<div class="chunkItem"><div><small>' +
    esc(ex) +
    '</small>' +
    (obj.tip ? '<div class="meta">💡 ' + esc(String(obj.tip).trim()) + '</div>' : '') +
    '</div>' +
    '<button class="btn ghost" onclick="applyReform(' +
    i +
    ')">Use this</button></div>';
}
async function applyReform(i) {
  const ex = reformPending[i];
  if (!ex) return;
  const c = chunks[i];
  c.example = ex;
  c.examples = (c.examples || []).concat(ex).slice(-3);
  c.lapses = 0; /* clean slate */
  c.interval = Math.max(
    1,
    Math.round((c.interval || 1) / 2),
  ); /* bring it back sooner to re-cement it */
  c.due = dayStr(c.interval);
  delete reformPending[i];
  await chunkSave(c);
  renderChunks();
}
async function delChunk(i) {
  const [removed] = chunks.splice(i, 1);
  if (removed) await chunkRemove(removed.id);
  renderAll();
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
function backupToast(msg) {
  $('backupToast').textContent = msg;
  setTimeout(() => ($('backupToast').textContent = ''), 4000);
}
/* A downloadable file: chunks, state, and every attempt. Clipboard only when
   the browser can't download. */
async function exportChunks(btn) {
  if (btn) btn.disabled = true;
  try {
    const all = await fetchAllAttempts();
    const data = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), chunks, state, attempts: all });
    try {
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blurt-backup-' + dayStr(0) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
      backupToast('Downloaded ✓ (' + n(chunks.length, 'chunk') + ', ' + n(all.length, 'attempt') + ')');
    } catch (e) {
      await navigator.clipboard.writeText(data);
      backupToast('Copied to clipboard — paste it somewhere safe.');
    }
  } catch (e) {
    backupToast("Couldn't build the backup: " + ((e && e.message) || e));
  } finally {
    if (btn) btn.disabled = false;
  }
}
/* Read a backup file (v1: {chunks, state}; v2 adds attempts). Chunks are
   deduped by text; attempts by id (the server upserts, so a repeat is harmless). */
async function importChunks(input) {
  const file = input && input.files && input.files[0];
  if (input) input.value = ''; /* picking the same file again still fires onchange */
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    alert("Couldn't read that file. Is it a Blurt backup?");
    return;
  }
  if (!data || !Array.isArray(data.chunks)) {
    alert("That doesn't look like a Blurt backup.");
    return;
  }
  const existing = new Set(chunks.map((c) => c.chunk.toLowerCase()));
  const added = [];
  data.chunks.forEach((c) => {
    if (c && c.chunk && !existing.has(c.chunk.toLowerCase())) {
      existing.add(c.chunk.toLowerCase());
      migrateChunk(c);
      delete c.id; /* imported backup ids aren't ours to reuse — assign fresh ones */
      chunks.push(c);
      added.push(c);
    }
  });
  if (data.state) {
    state.total = Math.max(state.total, data.state.total || 0);
    state.streak = Math.max(state.streak, data.state.streak || 0);
  }
  const have = new Set(attempts.map((a) => a.id));
  const since = dayStr(-ATTEMPT_DAYS);
  let queued = 0;
  (Array.isArray(data.attempts) ? data.attempts : []).forEach((a) => {
    if (!a || !a.id || !a.d || !a.source || !a.created_at || have.has(a.id)) return;
    have.add(a.id);
    queueAttempt(a);
    queued++;
    if (a.d >= since) attempts.push(a);
  });
  attempts.sort((x, y) => x.created_at.localeCompare(y.created_at));
  if (added.length) await chunkAddMany(added);
  await saveState();
  renderAll();
  /* attempts already on the server are just rewritten with the same values */
  backupToast(
    'Imported ✓ ' + added.length + ' new chunk' + (added.length === 1 ? '' : 's') + (queued ? '; attempts merged' : ''),
  );
}
function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m],
  );
}

/* ================= login gate (single shared secret) ================= */
/* The app is gated: nothing loads until the secret is entered and validated.
   Once stored, later visits skip the gate (and work offline from cache). */
function gateStatus(msg, isErr) {
  const el = $('gateStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--bad)' : 'var(--muted)';
}
function setAcctStatus() {
  const el = $('acctStatus');
  if (!el) return;
  el.textContent = loggedIn()
    ? 'Logged in ✓ Your reps sync to the server, and AI feedback + reminders are on.'
    : 'Logged out.';
  el.style.color = 'var(--mint)';
}
function saveBase() {
  API_BASE = apiBase();
  try {
    localStorage.setItem('blurt:apiBase', API_BASE);
  } catch (e) {}
}
function showGate() {
  $('loginGate').style.display = 'flex';
  if ($('gateBaseIn')) $('gateBaseIn').value = API_BASE;
  setTimeout(() => {
    const s = $('gateSecretIn');
    if (s) s.focus();
  }, 0);
}
function hideGate() {
  $('loginGate').style.display = 'none';
}
async function doLogin() {
  saveBase();
  const s = $('gateSecretIn').value.trim();
  if (!s) {
    gateStatus('Enter your secret first.', true);
    return;
  }
  gateStatus('Logging in…', false);
  const prev = secret;
  secret = s;
  try {
    await api('/api/login'); /* validates the secret */
    try {
      localStorage.setItem('blurt:secret', secret);
    } catch (e) {}
    $('gateSecretIn').value = '';
    hideGate();
    await loadAll(); /* pull your data, render the app */
    setAcctStatus();
  } catch (e) {
    secret = prev;
    const wrong = String(e.message).indexOf('401') >= 0;
    gateStatus(
      wrong ? 'Wrong secret — try again.' : "Couldn't reach the server (" + e.message + ').',
      true,
    );
  }
}
async function doLogout() {
  // Push anything still queued first — logging out drops the credential the
  // queue needs, so unsent reps would otherwise just evaporate.
  if (pendingCount()) {
    setSync('saving');
    await flush({ force: true });
    if (pendingCount() && !confirm('Some reps still haven’t saved. Log out anyway and lose them?')) {
      setSync('error');
      return;
    }
  }
  dataLoaded = false;
  pendingDocs.clear();
  pendingChunks.clear();
  pendingChunkDels.clear();
  pendingDocDels.clear();
  setSync('idle');
  secret = '';
  try {
    localStorage.removeItem('blurt:secret');
  } catch (e) {}
  if ($('settingsOverlay')) $('settingsOverlay').style.display = 'none';
  setAcctStatus();
  showGate();
}
/* Drop everything the old offline-first design left behind: cached banks, the
   mirrored state/chunk docs, and the '<key>:ts' merge baselines. Only the login
   secret and the API base stay — those are credentials, not practice data. */
function clearLegacyLocalData() {
  try {
    const keep = new Set(['blurt:secret', 'blurt:apiBase']);
    for (const k of Object.keys(localStorage))
      if (!keep.has(k) && (k.startsWith('blurt:') || k.startsWith('chunk:'))) localStorage.removeItem(k);
  } catch (e) {}
}

/* Startup: straight to the app if a secret is stored, otherwise show the gate. */
async function boot() {
  clearLegacyLocalData();
  loadPrompts(); /* fire-and-forget: static bank, fetched straight from /prompts.json */
  loadReflexes(); /* same for the curated /reflexes.json (Reflex ptype) */
  loadExpressions(); /* same for the curated /expressions.json (Expression ptype) */
  // body carries class="loading" from the markup, so the placeholders are in the
  // very first paint — app.js runs at the end of <body>, too late to beat it.
  if (loggedIn()) {
    hideGate();
    await loadAll();
    setAcctStatus();
  } else {
    setLoading(false); /* nothing to wait for; the gate owns the screen */
    showGate();
  }
}

/* ================= ntfy reminders ================= */
/* Micro-reps: state.ntfy.micro = {on, hours}; the server cron sends them. */
function microCfg() {
  const m = state.ntfy.micro || {};
  return { on: !!m.on, hours: Array.isArray(m.hours) && m.hours.length ? m.hours : [10, 15, 20] };
}
function renderMicro() {
  const m = microCfg();
  $('microChip').textContent = m.on ? '⚡ on' : 'off';
  $('microChip').classList.toggle('on', m.on);
  $('microHours').value = m.hours.join(', ');
}
function toggleMicro() {
  state.ntfy.micro = { ...microCfg(), on: !microCfg().on };
  saveMicro(); /* reads the hours box as typed, then re-renders */
}
function saveMicro() {
  const hours = [
    ...new Set(
      $('microHours')
        .value.split(/[^0-9]+/)
        .filter(Boolean)
        .map(Number)
        .filter((h) => h >= 0 && h <= 23),
    ),
  ].sort((a, b) => a - b);
  if (!hours.length) {
    $('microStatus').textContent = 'Enter hours like 10, 15, 20 (0–23).';
    return;
  }
  state.ntfy.micro = { on: microCfg().on, hours };
  state.ntfy.origin = location.origin; /* where the ping's tap should open */
  state.ntfy.tzOffset = new Date().getTimezoneOffset();
  saveState();
  renderMicro();
  $('microStatus').textContent = microCfg().on
    ? 'On — pings at ' + hours.map((h) => pad(h) + ':00').join(', ') + '.'
    : 'Off. Hours saved for when you switch it on.';
}
/* Opened from a micro ping (?quick=1): straight into one rep. */
function maybeQuickStart() {
  const q = new URLSearchParams(location.search);
  if (!q.has('quick')) return;
  history.replaceState(null, '', location.pathname);
  showTab('practice');
  startRep();
  $('promptKind').textContent = '⚡ quick blurt · ' + $('promptKind').textContent;
}
function initNtfy() {
  renderMicro();
  const sel = $('ntfyHour');
  sel.innerHTML = '';
  for (let h = 7; h <= 21; h++) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = (h < 10 ? '0' : '') + h + ':00';
    if (h === state.ntfy.hour) o.selected = true;
    sel.appendChild(o);
  }
  if (state.ntfy.on)
    ntfyStatus(
      'Reminders on → daily at ' + pad(state.ntfy.hour) + ':00, sent by the server.',
      false,
    );
}
function pad(h) {
  return (h < 10 ? '0' : '') + h;
}
function ntfyStatus(msg, isErr) {
  const el = $('ntfyStatus');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--bad)' : 'var(--mint)';
}
async function pingNtfy(title, msg) {
  if (!loggedIn()) throw new Error('not logged in');
  await api('/api/notify', { method: 'POST', body: JSON.stringify({ title, message: msg }) });
}
async function saveNtfy() {
  if (!loggedIn()) {
    ntfyStatus('Log in first (Settings) — reminders are sent through the server.', true);
    return;
  }
  const hour = parseInt($('ntfyHour').value, 10);
  // The server fires the daily ping (Worker cron / local twin), reading these values.
  // It only ever sends one ping at the chosen hour, so changing the time never duplicates.
  state.ntfy.on = true;
  state.ntfy.hour = hour;
  state.ntfy.tzOffset = new Date().getTimezoneOffset();
  await saveState();
  ntfyStatus('Sending test ping...', false);
  try {
    await pingNtfy(
      'Blurt connected',
      '✓ Test ping! Your homework reminder will arrive daily at ' + pad(hour) + ':00.',
    );
    ntfyStatus(
      'Test ping sent ✓ Check your phone. Daily reminder set for ' + pad(hour) + ':00.',
      false,
    );
  } catch (e) {
    // The reminder time is already saved (saveState above), so failures here only
    // mean the test ping didn't go out — reassure rather than alarm.
    if (/429/.test(e.message)) {
      ntfyStatus(
        'ntfy is rate-limiting test pings — wait a minute and try again. Your daily reminder at ' +
          pad(hour) +
          ':00 is already saved.',
        true,
      );
    } else {
      ntfyStatus(
        "Couldn't reach the server to send the ping (" + e.message + '). Check the server URL above.',
        true,
      );
    }
  }
}

/* ================= history ================= */
function hist() {
  const d = dayStr(0);
  if (!state.history) state.history = {};
  if (!state.history[d]) state.history[d] = { reps: 0, h: 0, m: 0 };
  return state.history[d];
}

/* ================= 1. text-to-speech ================= */
/* Score English voices so we pick the most natural one installed, not just
   the first match (which is often a low-quality default like "Albert"). */
function scoreVoice(v) {
  const n = v.name.toLowerCase();
  let s = 0;
  if (/premium|enhanced|neural|natural/.test(n)) s += 100; // Safari/macOS high-quality variants
  if (/google/.test(n)) s += 60; // Chrome's network voice — quite natural
  if (/\b(samantha|ava|zoe|aaron|allison|jenny|aria|nicky|evan|joelle)\b/.test(n)) s += 40;
  if (/\b(albert|fred|zarvox|trinoids|whisper|bells|bad news|cellos|compact|eloquence)\b/.test(n))
    s -= 80; // novelty/robotic
  if (v.lang === 'en-US') s += 10;
  else if (v.lang === 'en-GB') s += 5;
  if (v.localService) s += 2; // slight nudge for offline reliability
  return s;
}
function pickVoice() {
  const en = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  if (!en.length) return null;
  return en.sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}
/* getVoices() is often empty until the engine loads; warm it up. */
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
function speakText(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  let spoken = false;
  const speak = () => {
    if (spoken) return;
    spoken = true;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    u.pitch = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  };
  // If voices haven't loaded yet, wait for them once so we don't fall back to the default voice.
  if (!speechSynthesis.getVoices().length) {
    speechSynthesis.addEventListener('voiceschanged', speak, { once: true });
    setTimeout(speak, 250); // fallback in case the event never fires
  } else speak();
}
function speakNatural() {
  if (lastResult) speakText(lastResult.natural);
}
function speakDrillEx() {
  if (drillCurrent)
    speakText(
      drillCurrent.example || chunks[drillCurrent.idx].example || chunks[drillCurrent.idx].chunk,
    );
}
function speakRxEx() {
  if (rxCur) speakText(chunks[rxCur.idx].example || chunks[rxCur.idx].chunk);
}
function speakChunk(i) {
  speakText(chunks[i].example || chunks[i].chunk);
}

/* ================= 2. manual chunk ================= */
async function addManualChunk(btn) {
  const t = $('addChunkText').value.trim();
  if (!t) return;
  let ex = $('addChunkEx').value.trim();
  if (!ex) ex = t;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  const newChunk = { ...newChunkBase(), chunk: t, example: ex };
  chunks.unshift(newChunk);
  await chunkAdd(newChunk);
  $('addChunkText').value = '';
  $('addChunkEx').value = '';
  renderHeader();
  renderHW();
  renderChunks();
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Add to schedule';
  }
}

/* Describe a situation in Vietnamese → AI proposes a reusable chunk + example to save. */
let ctxPending = null;
async function genChunkFromContext() {
  if (!loggedIn()) {
    ntfyStatus('Log in (Settings below) to unlock AI chunk generation.', true);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    return;
  }
  const ctx = $('ctxChunkText').value.trim();
  if (!ctx) return;
  const btn = $('genCtxBtn'),
    prev = $('ctxChunkPreview');
  btn.disabled = true;
  btn.textContent = '✨ thinking...';
  const msg = `A Vietnamese software developer describes a situation they want to handle in spoken English:
"${ctx}"
Pick the SINGLE most useful, reusable multi-word English phrase (a "chunk") for that situation, and write ONE short, natural everyday English sentence (max 18 words) using it. The sentence MUST contain the phrase verbatim.
Reply with ONLY JSON: {"chunk":"the phrase","example":"the sentence","note":"a one-line gloss in Vietnamese of when to use it"}`;
  try {
    const obj = await aiObj({
      contents: [{ parts: [{ text: msg }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    const chunk = obj && obj.chunk && String(obj.chunk).trim();
    const example = obj && obj.example && String(obj.example).trim();
    if (!chunk || !example) throw new Error('bad chunk');
    ctxPending = { chunk, example, context: ctx };
    prev.innerHTML =
      '<div class="chunkItem"><div><b>' +
      esc(chunk) +
      '</b>' +
      '<button class="speak" onclick="speakText(' +
      JSON.stringify(chunk).replace(/"/g, '&quot;') +
      ')" title="Hear it">🔊</button>' +
      '<small>' +
      esc(example) +
      '</small>' +
      (obj.note ? '<div class="meta">💬 ' + esc(String(obj.note).trim()) + '</div>' : '') +
      '</div>' +
      '<button class="btn ghost" onclick="saveCtxChunk(this)">Save</button></div>';
  } catch (e) {
    ctxPending = null;
    prev.innerHTML =
      '<div class="empty">Couldn\'t generate one — try rephrasing, or add it manually above.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate chunk';
  }
}
async function saveCtxChunk(btn) {
  if (!ctxPending) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  const newChunk = {
    ...newChunkBase(),
    chunk: ctxPending.chunk,
    example: ctxPending.example,
    context: ctxPending.context,
  };
  chunks.unshift(newChunk);
  ctxPending = null;
  await chunkAdd(newChunk);
  $('ctxChunkText').value = '';
  $('ctxChunkPreview').innerHTML = '';
  renderHeader();
  renderHW();
  renderChunks();
}

/* Paste-to-chunks: pull the 2–3 most reusable phrases out of English you wrote. */
let pastePending = [];
/* ---- 📺 from a show: subtitles → your own reflex scenes + chunks ---- */
let showPending = { scenes: [], chunks: [] };
async function mineShow() {
  if (!loggedIn()) return;
  const text = $('showText').value.trim();
  if (!text) return;
  const btn = $('showBtn'),
    prev = $('showPreview');
  btn.disabled = true;
  btn.textContent = '✨ watching...';
  const msg = `A Vietnamese learner pasted lines from an English show they just watched:
"""${text}"""
1) Find up to 5 moments where a character fires back a short, reusable reply. For each, write a reflex scene:
- "text": the moment narrated in VIETNAMESE, present tense, 1-2 short sentences; what the OTHER character says stays in ENGLISH inside double quotes, e.g. Bạn cùng phòng mở cửa, mặt tái mét: "Dude, I think I just broke your laptop."
- "sample": the reply line (2-8 words, English), as in the show or close to it
- "chunk": the reusable phrase inside sample, copied exactly
- "note": ONE line in VIETNAMESE (max 20 words) on when this line fires
- "cat": one of ${CAT_IDS.join(', ')}
2) Pick up to 3 other reusable phrases from the lines, each with one short natural example sentence that contains it verbatim.
Reply ONLY JSON: {"scenes":[{"text":"","sample":"","chunk":"","note":"","cat":""}],"chunks":[{"chunk":"","example":""}]}`;
  try {
    const obj = await aiObj({
      contents: [{ parts: [{ text: msg }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    const str = (v) => (v == null ? '' : String(v).trim());
    const seen = new Set(REFLEXES.concat(myReflexes).map((p) => norm(p.text)));
    const haveChunk = new Set(chunks.map((c) => c.chunk.toLowerCase()));
    showPending.scenes = ((obj && obj.scenes) || [])
      .map((x) => ({
        cat: CAT_IDS.includes(str(x && x.cat)) ? str(x.cat) : 'daily',
        kind: 'reflex',
        text: str(x && x.text),
        sample: str(x && x.sample),
        chunk: str(x && x.chunk),
        note: str(x && x.note),
      }))
      .filter((x) => x.text && x.sample && x.chunk && drillBlank(x.chunk, x.sample).hasBlank && !seen.has(norm(x.text)));
    showPending.chunks = ((obj && obj.chunks) || [])
      .map((x) => ({ chunk: str(x && x.chunk), example: str(x && x.example) }))
      .filter((x) => x.chunk && x.example && drillBlank(x.chunk, x.example).hasBlank && !haveChunk.has(x.chunk.toLowerCase()));
    if (!showPending.scenes.length && !showPending.chunks.length) {
      prev.innerHTML = '<div class="empty">Nothing usable in there — try a longer bit of dialogue.</div>';
      return;
    }
    const item = (kind, j, head, sub) =>
      '<div class="chunkItem"><div><b>' +
      esc(head) +
      '</b><small>' +
      esc(sub) +
      '</small></div><button class="btn ghost" id="showSave' +
      kind +
      j +
      '" onclick="saveShow(\'' +
      kind +
      "', " +
      j +
      ')">Save</button></div>';
    prev.innerHTML =
      (showPending.scenes.length
        ? '<div class="eyebrow" style="margin-top:12px">Reflex scenes</div>' +
          showPending.scenes.map((x, j) => item('scene', j, x.sample, x.text)).join('')
        : '') +
      (showPending.chunks.length
        ? '<div class="eyebrow" style="margin-top:12px">Chunks</div>' +
          showPending.chunks.map((x, j) => item('chunk', j, x.chunk, x.example)).join('')
        : '') +
      '<div class="row"><button class="btn" id="showSaveAll" onclick="saveShow(\'all\')">Save all</button></div>';
  } catch (e) {
    prev.innerHTML = '<div class="empty">Couldn\'t read that — try again.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Make scenes';
  }
}
async function saveShow(kind, j) {
  const pick = (k, list) =>
    list
      .map((x, i) => [x, i])
      .filter(([x, i]) => x && (kind === 'all' || (kind === k && i === j)))
      .map(([x, i]) => {
        const b = $('showSave' + k + i);
        if (b) {
          b.textContent = 'Saved ✓';
          b.disabled = true;
        }
        list[i] = null;
        return x;
      });
  const scenes = pick('scene', showPending.scenes),
    newChunks = pick('chunk', showPending.chunks);
  if (scenes.length) {
    myReflexes = myReflexes.concat(scenes.map((x) => ({ ...x, mine: true }))).slice(-MY_REFLEX_CAP);
    store.set('blurt:myReflexes', JSON.stringify(myReflexes.map(({ mine, ...x }) => x)));
  }
  /* a scene's reply is a chunk too, with the reply as its example */
  const added = newChunks
    .map((x) => ({ ...newChunkBase(), chunk: x.chunk, example: x.example }))
    .concat(scenes.map((x) => ({ ...newChunkBase(), chunk: x.chunk, example: x.sample, context: x.text })));
  const have = new Set(chunks.map((c) => c.chunk.toLowerCase()));
  const fresh = added.filter((c) => !have.has(c.chunk.toLowerCase()) && have.add(c.chunk.toLowerCase()));
  fresh.forEach((c) => chunks.unshift(c));
  if (fresh.length) await chunkAddMany(fresh);
  renderHeader();
  renderHW();
  renderChunks();
  if (kind === 'all' || (!showPending.scenes.some(Boolean) && !showPending.chunks.some(Boolean))) {
    showPending = { scenes: [], chunks: [] };
    $('showText').value = '';
    $('showPreview').innerHTML =
      '<div class="empty">Saved ✓ ' + (scenes.length ? 'Your scenes show up in Practice → Reflex, marked 📺 yours.' : '') + '</div>';
  }
}
async function extractChunks() {
  if (!loggedIn()) {
    const p = $('pastePreview');
    if (p) p.innerHTML = '<div class="empty">Log in to extract chunks.</div>';
    return;
  }
  const text = $('pasteText').value.trim();
  if (!text) return;
  const btn = $('pasteBtn'),
    prev = $('pastePreview');
  btn.disabled = true;
  btn.textContent = '✨ reading...';
  const msg = `From this English written by a Vietnamese software developer, pick the 2–3 MOST reusable multi-word phrases (chunks) worth memorizing for spoken fluency. Skip anything trivial or overly specific.
Text: "${text}"
For each, give the phrase and ONE short natural example sentence using it verbatim. Reply with ONLY JSON: {"chunks":[{"chunk":"the phrase","example":"the sentence"}]}`;
  try {
    const obj = await aiObj({
      contents: [{ parts: [{ text: msg }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    const have = new Set(chunks.map((c) => c.chunk.toLowerCase()));
    pastePending = ((obj && obj.chunks) || [])
      .map((x) => ({
        chunk: x && x.chunk && String(x.chunk).trim(),
        example: x && x.example && String(x.example).trim(),
      }))
      .filter((x) => x.chunk && x.example && !have.has(x.chunk.toLowerCase()));
    if (!pastePending.length) {
      prev.innerHTML =
        '<div class="empty">No new chunks found — try a longer or different passage.</div>';
      return;
    }
    prev.innerHTML =
      pastePending
        .map(
          (x, j) =>
            '<div class="chunkItem"><div><b>' +
            esc(x.chunk) +
            '</b><small>' +
            esc(x.example) +
            '</small></div>' +
            '<button class="btn ghost" id="pasteSave' +
            j +
            '" onclick="savePasteChunk(' +
            j +
            ', this)">Save</button></div>',
        )
        .join('') +
      '<div class="row"><button class="btn" onclick="savePasteChunk(\'all\', this)">Save all</button></div>';
  } catch (e) {
    prev.innerHTML = '<div class="empty">Couldn\'t extract — try again.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extract chunks';
  }
}
async function savePasteChunk(which, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  const added = [];
  const add = (x) => {
    if (!x) return;
    const c = { ...newChunkBase(), chunk: x.chunk, example: x.example };
    chunks.unshift(c);
    added.push(c);
  };
  if (which === 'all') {
    pastePending.forEach(add);
    pastePending = [];
  } else {
    add(pastePending[which]);
    pastePending[which] = null;
  }
  await chunkAddMany(added);
  renderHeader();
  renderHW();
  renderChunks(); /* refresh the saved-chunk list so its onclick indices stay correct after unshift */
  if (which === 'all' || !pastePending.some(Boolean)) {
    pastePending = [];
    $('pasteText').value = '';
    $('pastePreview').innerHTML = '';
  } else {
    const b = $('pasteSave' + which);
    if (b) {
      b.textContent = 'Saved ✓';
      b.disabled = true;
    }
  }
}

/* Collocation expansion: grab related phrases / register variants for a saved chunk. */
const expandPending = {};
async function expandChunk(i) {
  const c = chunks[i],
    box = $('expand' + i);
  if (!box) return;
  if (!loggedIn()) {
    box.innerHTML = '<div class="empty">Log in to expand.</div>';
    return;
  }
  box.innerHTML = '<span class="spin"></span> Finding related phrases...';
  const msg = `For the English phrase "${c.chunk}", give 2–3 RELATED phrases a learner should also know: common collocations, or a more formal and a more casual variant. Each must differ from the original and from each other.
Reply with ONLY JSON: {"related":[{"chunk":"the phrase","example":"a short natural sentence using it verbatim"}]}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: msg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const have = new Set(chunks.map((x) => x.chunk.toLowerCase()));
  const list = ((obj && obj.related) || [])
    .map((x) => ({
      chunk: x && x.chunk && String(x.chunk).trim(),
      example: x && x.example && String(x.example).trim(),
    }))
    .filter((x) => x.chunk && x.example && !have.has(x.chunk.toLowerCase()));
  if (!list.length) {
    box.innerHTML = '<div class="empty">No new related phrases found.</div>';
    return;
  }
  expandPending[i] = { src: c.chunk, list };
  box.innerHTML =
    list
      .map(
        (x, j) =>
          '<div class="chunkItem"><div><b>' +
          esc(x.chunk) +
          '</b><small>' +
          esc(x.example) +
          '</small></div>' +
          '<button class="btn ghost" id="exp' +
          i +
          '_' +
          j +
          '" onclick="saveExpand(' +
          i +
          ',' +
          j +
          ')">Save</button></div>',
      )
      .join('') +
    '<div class="row"><button class="btn" onclick="saveExpand(' +
    i +
    ",'all')\">Save all</button></div>";
}
async function saveExpand(i, which) {
  const pend = expandPending[i];
  if (!pend) return;
  const added = [];
  const add = (x) => {
    if (!x) return;
    const c = {
      ...newChunkBase(),
      chunk: x.chunk,
      example: x.example,
      context: 'related to: ' + pend.src,
    };
    chunks.unshift(c);
    added.push(c);
  };
  if (which === 'all') {
    pend.list.forEach(add);
  } else {
    add(pend.list[which]);
  }
  delete expandPending[i];
  await chunkAddMany(added);
  renderHeader();
  renderHW();
  renderChunks(); /* collapses the box and refreshes indices */
}

/* ================= 4. AI-generated prompts ================= */
async function genPrompt() {
  if (!loggedIn()) {
    ntfyStatus('Log in (Settings below) to unlock AI prompts.', true);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    return;
  }
  repSource = 'ai'; /* AI button → stay on AI for following next/skip */
  endReplayRun();
  const btn = $('surpriseBtn');
  btn.disabled = true;
  btn.textContent = '✨ thinking...';
  const catNames = CATS.filter((c) => state.cats.includes(c.id))
    .map((c) => c.id + ' (' + c.label.slice(2).trim() + ')')
    .join(', ');
  /* Targeting priority: chunks due for review today (spaced repetition), else ones
     you've saved but never actually used in a rep (force them off the shelf), else
     the ones you miss most. */
  const due = dueChunks();
  const avoided = due.length ? [] : avoidedChunks();
  const forcing = !due.length && avoided.length > 0; // avoided chunks get a "must use" nudge
  const target = (
    due.length
      ? due
      : avoided.length
        ? avoided
        : [...chunks]
            .filter((c) => (c.misses || 0) > 0)
            .sort((a, b) => (b.misses || 0) - (a.misses || 0))
  )
    .slice(0, 3)
    .map((c) => c.chunk);
  /* Expression mode locks the pattern (chunk) to one already in the curated bank —
     the AI only invents a fresh scenario + sentence around it, so patterns stay
     hand-curated while the same pattern gets drilled across varied content. */
  const exprPattern =
    state.ptype === 'expr' && EXPRESSIONS.length
      ? EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)].chunk
      : null;
  /* Mix / 3 ways follow the Vietnamese share from Settings */
  const pt = (!KIND_PTYPES.includes(state.ptype) && mixDrawKind()) || state.ptype;
  const kindInstr =
    pt === 'vn'
      ? 'Use kind "vn": a natural everyday Vietnamese sentence for the learner to express in English.'
      : pt === 'sit'
        ? 'Use kind "sit": an English-described situation for the learner to react to.'
        : pt === 'reflex'
          ? 'Use kind "reflex": "text" narrates ONE moment in VIETNAMESE, present tense, 1-2 short sentences, set in native everyday life like a sitcom or movie (apartment, office, coffee shop, dating, family dinner, airport…; nothing Vietnam-specific). Anything another character SAYS stays in ENGLISH inside double quotes, e.g. Bạn cùng phòng mở cửa, mặt tái mét: "Dude, I think I just broke your laptop." "sample" is the ONE short line (2-8 words, English) a native fires back instantly: spoken, idiomatic, never textbook. "chunk" is the reusable phrase inside sample, copied exactly. "note" is ONE line in VIETNAMESE (max 20 words) on when/why this line fires.'
          : pt === 'expr'
            ? 'Use kind "expr": the learner is drilling this fixed expression pattern — "' +
              exprPattern +
              '". Invent a NEW everyday scenario ("text") — different from ones already practiced — and write "sample" as ONE full natural sentence that fills in the pattern to fit that scenario. Return "chunk" as exactly this pattern, unchanged: "' +
              exprPattern +
              '".'
            : 'Either kind "vn" (a natural everyday Vietnamese sentence to express in English) or kind "sit" (an English-described situation to react to).';
  const kindEnum =
    pt === 'reflex'
      ? 'reflex'
      : pt === 'expr'
        ? 'expr'
        : KIND_PTYPES.includes(pt)
          ? pt
          : 'vn|sit';
  const ctx = (state.settings.context || '').trim();
  const msg = `Generate ONE practice prompt for a Vietnamese software developer in Hanoi training spoken English fluency.
Pick a category from: ${catNames}.
${ctx ? "Weave in this learner's real life when it fits naturally (use the names/details): " + ctx : ''}
${target.length && state.ptype !== 'expr' ? (forcing ? 'Design the situation so a good answer MUST naturally use one of these phrases the learner keeps avoiding: ' : 'If it fits naturally, design the situation so a good answer could reuse one of these phrases the learner is reviewing: ') + target.join(' | ') + '.' : ''}
${kindInstr} Be creative and specific${state.ptype === 'reflex' ? '' : ' — local Hanoi flavor welcome'}, sometimes funny.
Reply ONLY JSON: {"cat":"${CAT_IDS.filter((id) => state.cats.includes(id)).join('|') || CAT_IDS.join('|')}","kind":"${kindEnum}","text":"the prompt itself","sample":"a natural native-speaker answer, 1-2 sentences","chunk":"the most reusable multi-word phrase from sample","note":"short coaching note, max 20 words"}`;
  try {
    const obj = await aiObj({
      contents: [{ parts: [{ text: msg }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    if (obj && obj.text && obj.sample && obj.chunk) {
      cacheAiPrompt(obj);
      rememberPrompt(obj.text); /* so a fresh AI prompt isn't echoed by the next pick */
      startRepWith(obj);
    } else throw new Error('bad prompt');
  } catch (err) {
    console.error('genPrompt failed:', err);
    startRepWith(
      pickPrompt(),
    ); /* graceful: fall back to the bank (no recursion into the AI roll) */
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AI prompt';
  }
}

/* ================= 6. stats ================= */
/* CSS height for a .statBar at pct% of its column, leaving room for the label. */
function barHeight(pct) {
  return 'calc((100% - 16px) * ' + (Math.max(0, Math.min(100, pct)) / 100).toFixed(3) + ')';
}
/* Clean rate: this week vs last, then 12 weekly bars (rolling 7-day windows). */
function cleanRateHTML() {
  const now = cleanStats(dayStr(-6)),
    prev = cleanStats(dayStr(-13), dayStr(-7));
  const pct = (x) => (x.pct == null ? '—' : x.pct + '%');
  const weeks = [];
  for (let w = 11; w >= 0; w--) {
    const to = dayStr(-7 * w),
      from = dayStr(-7 * w - 6);
    weeks.push({ from, ...cleanStats(from, to) });
  }
  const bars = weeks
    .map(
      (w) =>
        '<div class="statCol" title="' +
        w.from +
        ': ' +
        (w.pct == null ? 'nothing graded' : w.pct + '% of ' + w.n) +
        '"><div class="statBar" style="height:' +
        barHeight(w.pct || 0) +
        ';opacity:' +
        (w.n ? 1 : 0.15) +
        '"></div><div class="statLbl">' +
        w.from.slice(8) +
        '</div></div>',
    )
    .join('');
  return (
    '<div class="eyebrow">Clean rate</div>' +
    '<div class="statRow" style="margin-top:0">' +
    '<div class="statCell"><div class="statBig" style="color:var(--mint)">' +
    pct(now) +
    '</div><p class="hint">clean this week' +
    (now.n ? ' (' + now.clean + ' of ' + now.n + ')' : '') +
    '</p></div>' +
    '<div class="statCell"><div class="statBig">' +
    pct(prev) +
    '</div><p class="hint">last week</p></div>' +
    '</div>' +
    '<div class="statGrid clean">' +
    bars +
    '</div>' +
    '<p class="hint">Share of checked answers that needed no fix, per week (12 weeks; each bar starts on that day).</p>'
  );
}
/* Plain-words names for the internal error tags. */
const TAG_LABELS = {
  article: 'a / an / the',
  tense: 'time of the verb',
  preposition: 'in / on / at / for…',
  'word-order': 'word order',
  'word-choice': 'word choice',
  plural: 'one vs. many',
  'missing-word': 'missing word',
  calque: 'Vietnamese word-for-word',
};
/* What kind of fixes you got in the last 30 days, vs the 30 before. */
function errorTypesHTML() {
  const count = (from, to) => {
    const m = {};
    attempts
      .filter((a) => a.d >= from && (!to || a.d <= to))
      .forEach((a) => (a.tags || []).forEach((t) => (m[t] = (m[t] || 0) + 1)));
    return m;
  };
  const cur = count(dayStr(-29)),
    prev = count(dayStr(-59), dayStr(-30));
  const tags = Object.keys(cur).sort((a, b) => cur[b] - cur[a]);
  if (!tags.length) return '';
  const max = cur[tags[0]];
  return (
    '<div style="margin-top:22px"><div class="eyebrow">What your fixes were about · 30 days</div>' +
    tags
      .map((t) => {
        const d = cur[t] - (prev[t] || 0);
        const delta =
          d === 0 ? 'same as before' : d < 0 ? '▼ ' + -d + ' fewer' : '▲ ' + d + ' more';
        return (
          '<div class="tagRow"><div class="tagHead"><span>' +
          esc(TAG_LABELS[t] || t) +
          ' · <b>' +
          cur[t] +
          '</b></span><small>' +
          delta +
          '</small></div><div class="rxBar"><div class="rxFill" style="width:' +
          Math.round((100 * cur[t]) / max) +
          '%"></div></div></div>'
        );
      })
      .join('') +
    '</div>'
  );
}
/* Calibration (how sure you felt vs how it went) and Noticing (predict the fix),
   last 30 days. */
function selfTrustHTML() {
  const recent = attempts.filter((a) => a.d >= dayStr(-29));
  const rate = (list) => (list.length ? Math.round((100 * list.filter((a) => a.clean).length) / list.length) : null);
  const graded = recent.filter((a) => a.clean != null);
  const unsure = graded.filter((a) => a.conf === 'unsure'),
    sure = graded.filter((a) => a.conf === 'sure');
  const preds = recent.filter((a) => a.pred != null);
  let html = '';
  if (unsure.length || sure.length) {
    const u = rate(unsure),
      su = rate(sure);
    html +=
      '<div style="margin-top:22px"><div class="eyebrow">Calibration · 30 days</div>' +
      (unsure.length ? '<p>😐 Felt unsure ' + unsure.length + '× → <b>' + u + '%</b> were already clean</p>' : '') +
      (sure.length ? '<p>😎 Felt sure ' + sure.length + '× → <b>' + su + '%</b> were already clean</p>' : '') +
      (unsure.length >= 3 && u >= 60
        ? '<p class="note">Most of what you felt unsure about was already fine. Your English is better than your gut says.</p>'
        : '') +
      '</div>';
  }
  if (preds.length)
    html +=
      '<div style="margin-top:22px"><div class="eyebrow">Noticing · 30 days</div><div class="statRow" style="margin-top:0"><div class="statCell"><div class="statBig">' +
      rate(preds.map((a) => ({ clean: a.pred }))) +
      '%</div><p class="hint">of ' +
      preds.length +
      ' reps, you called the fix before seeing it</p></div></div></div>';
  return html;
}
function renderStats() {
  const h = state.history || {};
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayStr(-i));
  const max = Math.max(1, ...days.map((d) => (h[d] && h[d].reps) || 0));
  const bars = days
    .map((d) => {
      const r = (h[d] && h[d].reps) || 0;
      return (
        '<div class="statCol"><div class="statBar" style="height:' +
        barHeight((100 * r) / max) +
        ';opacity:' +
        (r ? 1 : 0.15) +
        '"></div><div class="statLbl">' +
        d.slice(8) +
        '</div></div>'
      );
    })
    .join('');
  const weekReps = days.slice(7).reduce((a, d) => a + ((h[d] || {}).reps || 0), 0);
  let H = 0,
    M = 0;
  chunks.forEach((c) => {
    H += c.hits || 0;
    M += c.misses || 0;
  });
  const ret = H + M ? Math.round((100 * H) / (H + M)) : null;
  let rrW = 0,
    rhW = 0;
  days.slice(7).forEach((d) => {
    const x = h[d] || {};
    rrW += x.rr || 0;
    rhW += x.rh || 0;
  });
  const racc = rrW ? Math.round((100 * rhW) / rrW) : null;
  const worst = [...chunks]
    .filter((c) => (c.misses || 0) > 0)
    .sort((a, b) => (b.misses || 0) - (a.misses || 0))
    .slice(0, 3);
  $('statsBody').innerHTML =
    cleanRateHTML() +
    '<div class="eyebrow" style="margin-top:22px">Reps, last 14 days</div>' +
    '<div class="statGrid">' +
    bars +
    '</div>' +
    '<div class="statRow">' +
    '<div class="statCell"><div class="statBig">' +
    weekReps +
    '</div><p class="hint">reps this week</p></div>' +
    '<div class="statCell"><div class="statBig">' +
    (ret === null ? '—' : ret + '%') +
    '</div><p class="hint">drill retention</p></div>' +
    '<div class="statCell"><div class="statBig">' +
    chunks.length +
    '</div><p class="hint">chunks learned</p></div>' +
    (usedThisWeek().length
      ? '<div class="statCell"><div class="statBig">' + usedThisWeek().length + '</div><p class="hint">chunks used for real this week</p></div>'
      : '') +
    (chunks.some((c) => c.core)
      ? '<div class="statCell"><div class="statBig">' +
        chunks.filter((c) => c.coreDone).length +
        ' / ' +
        CORE_CAP +
        '</div><p class="hint">⭐ owned of your 100</p></div>'
      : '') +
    '<div class="statCell"><div class="statBig">' +
    state.streak +
    '</div><p class="hint">day streak</p></div>' +
    '<div class="statCell"><div class="statBig">' +
    rrW +
    '</div><p class="hint">random rounds this week' +
    (racc !== null ? ' · ' + racc + '%' : '') +
    '</p></div>' +
    '</div>' +
    heatmapHTML() +
    errorTypesHTML() +
    selfTrustHTML() +
    lettersHTML() +
    (state.lastPattern && state.lastPattern.text
      ? '<div style="margin-top:18px"><div class="eyebrow">This week\'s pattern</div><div class="chunkItem"><div>' +
        esc(state.lastPattern.text) +
        '</div></div></div>'
      : '') +
    (worst.length
      ? '<div style="margin-top:18px"><div class="eyebrow">Your nemesis chunks</div>' +
        worst
          .map(
            (c) =>
              '<div class="chunkItem"><div><b>' +
              esc(c.chunk) +
              '</b><div class="meta">missed ' +
              c.misses +
              'x</div></div></div>',
          )
          .join('') +
        '</div>'
      : '') +
    archiveHTML();
  archReset();
}

/* GitHub-style activity heatmap: last 12 weeks of reps from state.history,
   columns = weeks, rows = weekdays (padded so the first column starts on Sunday). */
function heatmapHTML() {
  const h = state.history || {},
    total = 84;
  const cells = [];
  let max = 1;
  for (let i = total - 1; i >= 0; i--) {
    const ds = dayStr(-i);
    const r = (h[ds] && h[ds].reps) || 0;
    if (r > max) max = r;
    cells.push({ ds, r });
  }
  const firstDow = new Date(cells[0].ds + 'T00:00:00').getDay();
  const all = [];
  for (let i = 0; i < firstDow; i++) all.push(null);
  cells.forEach((c) => all.push(c));
  const level = (r) =>
    r === 0 ? 0 : r >= max * 0.75 ? 4 : r >= max * 0.5 ? 3 : r >= max * 0.25 ? 2 : 1;
  const sq = all
    .map((c) =>
      c
        ? '<div class="hmCell hm' +
          level(c.r) +
          '" title="' +
          c.ds +
          ': ' +
          c.r +
          ' rep' +
          (c.r === 1 ? '' : 's') +
          '"></div>'
        : '<div class="hmCell hmPad"></div>',
    )
    .join('');
  return (
    '<div style="margin-top:18px"><div class="eyebrow">Activity · last 12 weeks</div><div class="hmGrid">' +
    sq +
    '</div></div>'
  );
}

/* ================= 7. weekly recap ping ================= */
/* Look at the week's attempts vs corrections and name the recurring mistakes.
   Returns a short coaching line, or null (too few samples / offline / AI down). */
async function genWeeklyPattern() {
  if (!loggedIn()) return null;
  const log = attempts.filter((r) => r.d >= dayStr(-7) && r.blurt && r.fix && r.clean !== true);
  if (log.length < 3) return null; /* need a few samples before a pattern means anything */
  const samples = log
    .slice(-15)
    .map((r) => '- said: "' + r.blurt + '" → better: "' + r.fix + '"')
    .join('\n');
  const msg = `A Vietnamese software developer is practicing spoken English. Here are this week's fast attempts and the corrected versions:
${samples}
Identify the 1-2 most RECURRING mistake patterns (e.g. dropped articles, verb tense, word order, preposition choice). Be specific and encouraging, and end with one quick tip.
Reply with ONLY JSON: {"pattern":"one or two short sentences"}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: msg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  return (obj && obj.pattern && String(obj.pattern).trim()) || null;
}
/* Your clean sentences from the week, arranged (never rewritten) into a short
   letter. No AI: this is literally what you wrote. */
const LETTER_CAP = 12,
  LETTER_SENTENCES = 25;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function buildWeeklyLetter() {
  const from = dayStr(-6);
  const picked = attempts.filter((a) => a.clean === true && a.d >= from && a.source !== 'copy' && (a.fix || a.blurt));
  if (!picked.length) return null;
  const byDay = new Map();
  picked.slice(-LETTER_SENTENCES).forEach((a) => {
    const line = (a.fix || a.blurt).trim();
    byDay.set(a.d, (byDay.get(a.d) || []).concat(line));
  });
  const days = [...byDay.keys()].sort();
  const text =
    'This week I wrote:\n\n' +
    days
      .map((d) => DAY_NAMES[new Date(d + 'T12:00:00Z').getUTCDay()] + ' (' + d.slice(5) + ')\n' + byDay.get(d).map((l) => '· ' + l).join('\n'))
      .join('\n\n');
  return { date: dayStr(0), from, count: picked.length, text };
}
function lettersHTML() {
  const list = (state.letters || []).slice().reverse();
  if (!list.length) return '';
  return (
    '<div style="margin-top:22px"><div class="eyebrow">Weekly letters</div>' +
    list
      .map(
        (l, i) =>
          '<details class="chunkTools"' +
          (i === 0 ? ' open' : '') +
          '><summary>Week of ' +
          esc(l.from || l.date) +
          ' · ' +
          l.count +
          ' clean sentence' +
          (l.count === 1 ? '' : 's') +
          '</summary><div class="natural writeReady">' +
          esc(l.text) +
          '</div></details>',
      )
      .join('') +
    '</div>'
  );
}
async function maybeWeeklyRecap() {
  if (!loggedIn()) return;
  const today = dayStr(0);
  if (state.lastRecap && (new Date(today) - new Date(state.lastRecap)) / 86400000 < 7) return;
  const h = state.history || {};
  let reps = 0;
  for (let i = 0; i < 7; i++) reps += (h[dayStr(-i)] || {}).reps || 0;
  if (!reps) return;
  const fresh = chunks.filter((c) => c.date && c.date >= dayStr(-7)).length;
  const worst = [...chunks]
    .filter((c) => (c.misses || 0) > 0)
    .sort((a, b) => (b.misses || 0) - (a.misses || 0))[0];
  const pattern = await genWeeklyPattern(); /* graceful: null when offline / too few reps */
  if (pattern) state.lastPattern = { text: pattern, date: today };
  let msg =
    'This week: ' +
    reps +
    ' reps, ' +
    fresh +
    ' new chunks.' +
    (worst ? ' Nemesis: "' + worst.chunk + '" (missed ' + worst.misses + 'x).' : '') +
    (usedThisWeek().length ? ' Used for real: ' + usedThisWeek().map((c) => '"' + c.chunk + '"').join(', ') + '.' : '') +
    (pattern ? ' Pattern: ' + pattern : '') +
    ' Keep the chain alive.';
  const letter = buildWeeklyLetter();
  if (letter) state.letters = (state.letters || []).concat(letter).slice(-LETTER_CAP);
  state.lastRecap = today;
  saveState();
  if (state.ntfy && state.ntfy.on) {
    try {
      await pingNtfy('Blurt weekly recap 📊', msg);
      if (letter) await pingNtfy('Blurt weekly letter 💌', 'Your weekly letter is ready — ' + letter.count + ' sentences you got right, in Stats.');
    } catch (e) {}
  }
}

boot();
