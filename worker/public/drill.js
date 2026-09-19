/* drill.js — Spaced repetition: SM-2, blanking a chunk in a sentence, the due queue.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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
