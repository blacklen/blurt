/* stats.js — The Stats tab: clean rate, error types, calibration, voice, archive, letters.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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

/* Calibration: how sure you felt vs how it went, last 30 days. */
function selfTrustHTML() {
  const recent = attempts.filter((a) => a.d >= dayStr(-29));
  const rate = (list) => (list.length ? Math.round((100 * list.filter((a) => a.clean).length) / list.length) : null);
  const graded = recent.filter((a) => a.clean != null);
  const unsure = graded.filter((a) => a.conf === 'unsure'),
    sure = graded.filter((a) => a.conf === 'sure');
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
  return html;
}

/* Phrases you actually reuse: 2-4 word runs from your clean sentences (90 days).
   No AI — just counting. Grams that are only filler words don't count. */
const VOICE_STOP = new Set('a an the i you he she it we they me my your our is am are was were be been do does did to of in on at for with and or but so if that this these those not no yes just very really some any there here as by from up out about'.split(' '));

function voicePhrases() {
  const counts = new Map();
  attempts
    .filter((a) => a.clean === true && a.d >= dayStr(-89) && a.source !== 'copy')
    .forEach((a) => {
      const w = norm(a.fix || a.blurt).split(' ').filter(Boolean);
      for (let n = 2; n <= 4; n++)
        for (let i = 0; i + n <= w.length; i++) {
          const g = w.slice(i, i + n);
          if (g.every((x) => VOICE_STOP.has(x))) continue;
          const k = g.join(' ');
          counts.set(k, (counts.get(k) || 0) + 1);
        }
    });
  const all = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out = [];
  for (const [g, n] of all) {
    /* skip a short run already covered by a longer one you use just as often */
    if (out.some(([g2, n2]) => g2.includes(g) && n2 >= n)) continue;
    out.push([g, n]);
    if (out.length === 10) break;
  }
  return out;
}

function voiceHTML() {
  const phrases = voicePhrases();
  const used = chunks.filter((c) => c.used).sort((a, b) => (b.used || 0) - (a.used || 0));
  if (!phrases.length && !used.length) return '';
  return (
    '<div style="margin-top:22px"><div class="eyebrow">Your voice · phrases you reuse</div>' +
    (phrases.length
      ? '<div class="rxBank">' + phrases.map(([g, n]) => '<span class="rxWord" style="cursor:default">' + esc(g) + ' <small>×' + n + '</small></span>').join('') + '</div>'
      : '') +
    (used.length
      ? '<p class="hint" style="margin-top:12px">✔ Used for real: ' + used.map((c) => esc(c.chunk) + (c.used > 1 ? ' ×' + c.used : '')).join(', ') + '</p>'
      : '') +
    '</div>'
  );
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
    voiceHTML() +
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
