/* practice.js — The Practice tab: prompts, the rep loop, AI judging, replays, ladder.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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

const MAX_RECENT = 40;

 /* how many recent prompts to avoid re-serving */
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

/* The countdown starts two frames late (so the bar animates from full), which
   means two quick starts could leave the first interval running forever —
   ticking past zero and re-finishing the rep every second. Only the newest
   start gets to run. */
let timerToken = 0;
function startTimer() {
  stopTimer();
  const mine = ++timerToken;
  repTotal = repSeconds();
  secondsLeft = repTotal;
  $('clock').textContent = secondsLeft;
  const bar = $('timebar');
  bar.classList.remove('running');
  bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (mine !== timerToken) return;
      bar.classList.add('running');
      tick();
    }),
  );
}

function tick() {
  stopTimer();
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
  timerToken++; /* any pending start is stale now */
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
  if (!current || current.finished) return; /* a rep is only ever checked once */
  current.finished = true;
  stopTimer();
  stopMic();
  $('blurtInput').disabled = true;
  $('checkBtn').disabled = true;
  const blurt = $('blurtInput').value.trim();
  const p = current.prompt;

  creditRep();
  sessionDone('reps');

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
  /* the same idea in smaller words, when the AI offered one that's really simpler */
  const simpler = !fallback && result.simpler && norm(result.simpler) !== norm(fixed) && norm(result.simpler) !== norm(native) ? result.simpler : '';
  $('simplerBox').style.display = simpler ? '' : 'none';
  $('simplerBox').open = false;
  if (simpler) {
    $('simplerText').textContent = simpler;
    const b = $('simplerSave');
    b.style.display = drillBlank(result.chunk, simpler).hasBlank ? '' : 'none';
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

async function askGemini(p, blurt) {
  let task, instr;
  if (p.kind === 'vn') {
    task = 'The prompt was a Vietnamese sentence to express in English: "' + p.text + '"';
    instr =
      '{"fixedAnswer":"THEIR sentence, corrected. Keep their own words and structure; change only what is grammatically wrong, unclear, or unnatural. This is their answer cleaned up — NOT a rewrite. If nothing needs changing, copy it exactly.","clean":"true if their sentence needed no meaningful change (a native would say it that way, ignoring capitalization and punctuation), else false","natural":"how a native speaker would naturally say it (casual register, 1-2 sentences, keep their intended meaning)","chunk":"the single most reusable multi-word phrase from your natural version worth memorizing","calque":"ONLY if their attempt is a word-for-word translation from Vietnamese that a native would never say (e.g. wrong word order, literal idiom): one short line naming the calque and the natural shape instead. Otherwise empty string.",' +
      TAGS_FIELD +
      ',' +
      SIMPLER_FIELD +
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
      ',' +
      SIMPLER_FIELD +
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
      ',' +
      SIMPLER_FIELD +
      ',"note":"one short tip (max 20 words). If clean, say specifically what they did well. Otherwise: did they use the chunk well, and the key fix."}';
  }
  const userMsg = `You are a friendly English fluency coach for a Vietnamese software developer practicing fast speech-like production.
${task}
Their fast, unedited attempt: "${blurt}"

Reply with ONLY a JSON object:
${instr}${COACH_RULES}`;
  const obj = await aiObj({
    contents: [{ parts: [{ text: userMsg }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!obj || !obj.chunk) return null;
  obj.clean = truthy(obj.clean);
  obj.tags = cleanTags(obj.tags);
  obj.simpler = String(obj.simpler || '').trim();
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
{"best":1,"clean":"true if the best attempt needed no meaningful change (ignore capitalization and punctuation), else false",${TAGS_FIELD.replace('their mistakes', 'the mistakes in the best attempt')},"natural":"one natural native version (1-2 sentences)","chunk":"the single most reusable phrase from your native version","note":"max 22 words: which attempt was most natural and one quick tip"}${COACH_RULES}`;
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
{"fixedAnswer":"their ROUND 3 attempt, minimally corrected: keep their words, change only what is wrong or unnatural; copy exactly if fine","clean":"true if round 3 needed no meaningful change, else false",${TAGS_FIELD.replace('their mistakes', 'the mistakes in round 3')},"natural":"one natural native version (1-2 sentences)","chunk":"the single most reusable phrase from your native version","note":"max 22 words: what got looser or better under time pressure, and one tip"}${COACH_RULES}`,
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
let replayRun = null;

 /* { queue: [...pending], total, done } */
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
{"improved":true or false,"clean":"true if the NEW attempt needed no meaningful change (ignore capitalization and punctuation), else false",${TAGS_FIELD.replace('their mistakes', 'the mistakes in the NEW attempt')},"natural":"the most natural way to say it (1-2 sentences)","chunk":"the single most reusable phrase from the natural version","note":"one short coaching note, max 22 words"}${COACH_RULES}`;
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

/* ================= chunks tab ================= */
/* Clear what a previous result left behind: save buttons, the clean banner,
   and any type-it-back attempt. */
function resetResultCard() {
  resetSaveBtn();
  $('cleanLead').style.display = 'none';
  $('simplerBox').style.display = 'none';
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
    ['simplerSave', 'Save as chunk'],
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
    which === 'fixed'
      ? 'saveFixedBtn'
      : which === 'suggested'
        ? 'saveSuggestBtn'
        : which === 'simpler'
          ? 'simplerSave'
          : 'saveChunkBtn';
  const b = $(btnId);
  if (b && b.disabled) return; /* already saving/saved — ignore double taps */
  if (b) {
    b.textContent = 'Saving…';
    b.disabled = true;
  }
  if (which === 'simpler' && !drillBlank(lastResult.chunk, lastResult.simpler || '').hasBlank) return;
  const example =
    which === 'fixed'
      ? lastResult.fixedAnswer || lastResult.natural
      : which === 'simpler'
        ? lastResult.simpler
        : lastResult.natural;
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

/* Opened from a micro ping (?quick=1): straight into one rep. */
function maybeQuickStart() {
  const q = new URLSearchParams(location.search);
  if (!q.has('quick')) return;
  history.replaceState(null, '', location.pathname);
  showTab('practice');
  startRep();
  $('promptKind').textContent = '⚡ quick blurt · ' + $('promptKind').textContent;
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
