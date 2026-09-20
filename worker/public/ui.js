/* ui.js — The shell: header, homework card, tabs, settings sheet, 15-minute session.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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
  html += sessionHTML();
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
  if (!session && !sessionRecap)
    html += '<div class="row"><button class="btn ghost" onclick="startSession()">▶ 15-minute session</button></div>';
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
/* A 15-minute session: one freewrite, three blurts, one piece of writing.
   Steps advance as you finish each thing; the recap is what you did. */
const SESSION_STEPS = [
  { id: 'free', label: '✍️ Freewrite' },
  { id: 'reps', label: '🎯 3 blurts', total: 3 },
  { id: 'write', label: '📓 One piece of writing' },
];

let session = null,
  sessionRecap = null;

function startSession() {
  session = { step: 0, reps: 0, from: attempts.length, started: Date.now() };
  sessionRecap = null;
  renderHW();
  sessionGo();
}

function sessionGo() {
  if (!session) return;
  const step = SESSION_STEPS[session.step];
  if (!step) return endSession();
  if (step.id === 'free') {
    showTab('write');
    setWriteMode('free');
  } else if (step.id === 'reps') {
    showTab('practice');
    loggedIn() ? genPrompt() : startRep();
  } else {
    showTab('write');
    setWriteMode('journal');
  }
  renderHW();
}

/* Called when a step's work finishes. */
function sessionDone(kind) {
  if (!session) return;
  const step = SESSION_STEPS[session.step];
  if (!step || step.id !== kind) return;
  if (kind === 'reps' && ++session.reps < step.total) {
    renderHW();
    return;
  }
  session.step++;
  if (session.step >= SESSION_STEPS.length) endSession();
  else sessionGo();
}

function endSession() {
  const s = session;
  session = null;
  if (!s) return;
  const mine = attempts.slice(s.from);
  const words = mine.reduce((n, a) => n + (a.blurt || '').split(/\s+/).filter(Boolean).length, 0);
  const graded = mine.filter((a) => a.clean != null && a.source !== 'copy');
  const cleanPct = graded.length ? Math.round((100 * graded.filter((a) => a.clean).length) / graded.length) : null;
  const wins = mine.filter((a) => a.clean === true && (a.fix || a.blurt));
  const win = wins.length ? wins[Math.floor(Math.random() * wins.length)] : null;
  const h = hist();
  h.sessions = (h.sessions || 0) + 1;
  saveState();
  sessionRecap = {
    mins: Math.max(1, Math.round((Date.now() - s.started) / 60000)),
    words,
    cleanPct,
    win: win ? win.fix || win.blurt : '',
  };
  renderHW(); /* the recap lives on the homework card, which every tab shows */
}

function dismissSessionRecap() {
  sessionRecap = null;
  renderHW();
}

function sessionHTML() {
  if (sessionRecap) {
    const r = sessionRecap;
    return (
      '<div class="hwDone">✦ Session done — ' + r.mins + ' min, ' + r.words + ' words' + (r.cleanPct == null ? '' : ', ' + r.cleanPct + '% clean') + '</div>' +
      (r.win ? '<div class="hwClean">✓ you nailed this: “' + esc(r.win) + '”</div>' : '') +
      '<div class="hwWarn">🔥 ' + state.streak + ' day streak</div>' +
      '<div class="row"><button class="btn ghost" onclick="dismissSessionRecap()">Nice</button></div>'
    );
  }
  if (!session) return '';
  const step = SESSION_STEPS[session.step];
  return (
    '<div class="hwClean">▶ Session · step ' + (session.step + 1) + ' of ' + SESSION_STEPS.length + ': ' + step.label +
    (step.id === 'reps' ? ' (' + session.reps + '/' + step.total + ')' : '') + '</div>' +
    '<div class="row"><button class="btn ghost" onclick="endSession()">End session</button></div>'
  );
}

function smartNext() {
  if (loggedIn() && warmupPick())
    return { fn: 'warmup', label: "🔥 Warm up — beat yesterday's miss" };
  const due = dueChunks().length;
  if (due) return { fn: 'drill', label: '▶ Drill ' + due + ' due chunk' + (due > 1 ? 's' : '') };
  if (state.hw.reps < hwReps())
    return { fn: 'practice', label: '▶ Blurt a prompt (' + state.hw.reps + '/' + hwReps() + ')' };
  /* a long piece is a treat, not homework: once a week, and only on a good week */
  const w = cleanStats(dayStr(-6));
  if (loggedIn() && w.pct !== null && w.pct >= 70 && w.n >= 5 && (!state.lastLong || state.lastLong <= dayStr(-7)))
    return { fn: 'long', label: '📜 Write something longer' };
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
  } else if (n.fn === 'long') {
    state.lastLong = dayStr(0);
    saveState();
    showTab('write');
    setWriteMode('long');
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
