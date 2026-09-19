/* random.js — The Random tab: every game mode, including Your 100 and Sounds right?.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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
];

 /* client-side formats (Phase 2 adds AI ones) */
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

const RX_AI_FMTS = ['mc', 'emoji', 'scene', 'frankenstein'];

 /* need the Gemini worker */
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
