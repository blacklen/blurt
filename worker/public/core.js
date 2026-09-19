/* core.js — Shared state and the small helpers everything else uses.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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

const REP_BASE = 45,
  REP_MIN = 30;

 /* timer shrinks 1s per streak day */
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
}

 /* daily blurt quota (user setting) */
const LADDER = [1, 3, 7, 14, 30, 60];

 /* days between successful reviews */

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

let aiPrompts = [];

 /* generated prompts, kept server-side so they follow you across devices */
let myReflexes = [];

 /* reflex scenes mined from shows you watched (doc blurt:myReflexes) */
const MY_REFLEX_CAP = 500;

function dayStr(off) {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

/* ================= UI ================= */
const $ = (id) => document.getElementById(id);

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

const CAT_IDS = CATS.map((c) => c.id);

/* Internal labels for what went wrong, used only for stats (never shown as
   grammar jargon in the notes). */
const ERROR_TAGS = ['article', 'tense', 'preposition', 'word-order', 'word-choice', 'plural', 'missing-word', 'calque', 'none'];

/* Notes are for a person who freezes, not a grammar class. Appended to every
   correction prompt; the tags above stay internal, for stats only. */
const COACH_RULES =
  '\nIn every note: explain in plain words a friend would use. NEVER use grammar terminology (no "article", "adverbial", "present perfect", "preposition"). Say what to do instead, e.g. "in English the time usually goes at the end".';

/* Optional plainer version of the same idea, offered under the fix. */
const SIMPLER_FIELD =
  '"simpler":"the same idea in the smallest, most common words, or empty if it was already simple"';

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

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m],
  );
}

function pad(h) {
  return (h < 10 ? '0' : '') + h;
}

/* ================= history ================= */
function hist() {
  const d = dayStr(0);
  if (!state.history) state.history = {};
  if (!state.history[d]) state.history[d] = { reps: 0, h: 0, m: 0 };
  return state.history[d];
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
