/* write.js — The Write tab: freewrite, journal, draft, react, copy, explain, dialogue, long, rewrite — and the "do natives say this?" popover.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

/* ================= write tab: freewrite, journal, draft ================= */
const WRITE_MODES = [
  { id: 'free', label: '⏱ Freewrite' },
  { id: 'journal', label: '📓 Journal' },
  { id: 'draft', label: '✉️ Draft a message' },
  { id: 'react', label: '💬 React' },
  { id: 'copy', label: '📄 Copy' },
  { id: 'explain', label: '🧑‍🏫 Explain' },
  { id: 'dialogue', label: '🗣 Two voices' },
  { id: 'long', label: '📜 Long' },
];

const LONG_TOPICS = ['a sprint retro: what went well, what didn\'t', 'what you would change about the codebase', 'a bug you fixed, start to finish', 'how you decide what to work on first', 'the best code review you ever got', 'what you would tell yourself a year ago', 'a tool you love and why', 'the last thing that surprised you at work', 'how your team could ship faster', 'what makes a good teammate'];

function longTopic() {
  return LONG_TOPICS[Math.floor(Math.random() * LONG_TOPICS.length)];
}

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

let REACTS = null;

 /* backup texts (reacts.json) for when the AI is down */
const STALL_MS = 5000;

 /* no keystroke this long → nudge */
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
  if (m === 'explain' || m === 'long') write.topic = null;
  if (m === 'dialogue') write.scene = null;
  if (m === 'explain' || m === 'dialogue') $('writeInput').value = '';
  if (m === 'rewrite' || m === 'then') {
    write.rewrite = m === 'then' ? thenEntry() : yesterdayEntry();
    $('writeInput').value = '';
  }
  writeRender();
}

function writeRender() {
  const m = write.mode,
    inp = $('writeInput');
  let modes = yesterdayEntry() ? WRITE_MODES.concat({ id: 'rewrite', label: '↻ Rewrite yesterday' }) : WRITE_MODES;
  if (thenEntry()) modes = modes.concat({ id: 'then', label: '⏳ Then vs now' });
  if ((m === 'rewrite' || m === 'then') && !write.rewrite) write.rewrite = m === 'then' ? thenEntry() : yesterdayEntry();
  if ((m === 'rewrite' || m === 'then') && !write.rewrite) return setWriteMode('journal'); /* nothing to redo anymore */
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
  } else if ((m === 'rewrite' || m === 'then') && write.rewrite) {
    const y = write.rewrite;
    $('writeEyebrow').textContent =
      m === 'then' ? '⏳ Then vs now · you wrote this on ' + y.d : '↻ Rewrite yesterday · fresh, from memory';
    $('writeSeed').style.fontSize = '1.02rem';
    $('writeSeed').innerHTML =
      '<span class="reactMeta">' + (m === 'then' ? 'Back then you wrote about' : 'Yesterday you wrote about') + '</span><span class="reactText">' + esc(y.prompt || '(no prompt)') + '</span>';
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
  } else if (m === 'long') {
    if (!write.topic) write.topic = longTopic();
    $('writeEyebrow').textContent = 'Long · around 200 words, no timer';
    $('writeSeed').style.fontSize = '1.1rem';
    $('writeSeed').textContent = write.topic;
    inp.disabled = false;
    inp.placeholder = 'Take your time. Paragraphs are fine…';
    if (write.phase === 'idle') {
      $('writeResult').innerHTML =
        '<input class="drillIn" id="longOwn" autocomplete="off" placeholder="…or type your own title, then Enter" style="margin-top:14px">';
      const own = $('longOwn');
      own.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !own.value.trim()) return;
        e.preventDefault();
        write.topic = own.value.trim();
        writeRender();
      });
    }
    const n = inp.value.split(/\s+/).filter(Boolean).length;
    $('writeHint').textContent = n ? n + ' words so far — aim for about 200.' : 'About 200 words. The check starts with how it flows, then the sentences.';
    $('writeActions').innerHTML =
      (write.phase === 'checked' ? '' : '<button class="btn pulse" id="writeCheckBtn" onclick="writeCheckNow()">Check it</button>') +
      '<button class="btn ghost" onclick="writeNewSeed()">Another title</button>';
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
  if (write.mode === 'long') write.topic = longTopic();
  if (write.mode === 'dialogue') write.scene = dialogueSeed();
  write.phase = 'idle';
  $('writeInput').value = '';
  writeRender();
}

/* ---- rewrite yesterday: the latest Write / Freewrite / React entry from yesterday ---- */
const REWRITE_SOURCES = ['write', 'free', 'react'];

const THEN_DAYS = 60;

/* Something you wrote over 60 days ago and haven't redone since. */
function thenEntry() {
  const cutoff = dayStr(-THEN_DAYS);
  const later = new Set(attempts.filter((a) => a.d > cutoff).map((a) => a.prompt));
  const old = attempts.filter((a) => a.d <= cutoff && a.prompt && a.blurt && a.fix && !later.has(a.prompt));
  if (!old.length) return null;
  const a = old[Math.floor(Math.random() * old.length)];
  const items = attempts.filter((x) => x.prompt === a.prompt && x.d === a.d && x.source === a.source);
  return { source: a.source, prompt: a.prompt, items, text: items.map((x) => x.blurt).join(' '), then: true, d: a.d, id: a.id };
}

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
    col(y.then ? y.d : 'Yesterday', y.items.map((a) => row(a.blurt, a.fix, a.clean)), y.items.flatMap((a) => a.tags || [])) +
    col(y.then ? 'Today (' + dayStr(0) + ')' : 'Today', sents.map((x) => row(x.original, x.fixed, x.clean)), sents.flatMap((x) => x.tags)) +
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
  sessionDone('free');
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
    mode === 'long'
      ? 'This is a longer piece (aim was ~200 words) titled "' + (write.topic || '') + '". Judge it as written English: first how it holds together, then the sentences.'
      : mode === 'explain'
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
{"original":"the sentence exactly as written","fixed":"THEIR sentence minimally corrected: keep their words and structure, change only what is wrong or unnatural. Copy it exactly if nothing needs changing.","natural":"how a native would phrase it, or empty if fixed already is","chunk":"one reusable multi-word phrase from fixed or natural worth saving, or empty","clean":true or false (true = no meaningful change needed, ignoring capitalization and punctuation),${TAGS_FIELD},${SIMPLER_FIELD}}
Reply with ONLY JSON: {"sentences":[...],"note":"one encouraging line (max 25 words) about the whole text: what worked, and the one thing to watch","ready":"${mode === 'draft' ? 'the full message, cleaned up, in their tone, ready to send' : ''}"${mode === 'react' ? ',"fit":"one line: does the reply match the tone and register of the original (too formal, too blunt, just right)?"' : ''}${mode === 'explain' ? ',"clarity":"one line: would a new teammate get it? What to add or cut."' : ''}${mode === 'dialogue' ? ',"questions":"one line on whether the questions in it sound natural"' : ''}${mode === 'long' ? ',"flow":["one short note per paragraph, in order: order, transitions, what to cut"]' : ''}}${COACH_RULES}`;
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
        simpler: String(x.simpler || '').trim(),
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
    flow: Array.isArray(obj.flow) ? obj.flow.map(String).filter(Boolean) : [],
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
        source: mode === 'react' ? 'react' : mode === 'rewrite' || mode === 'then' ? 'rewrite' : 'write',
        kind: mode === 'react' && write.react ? write.react.kind : mode === 'rewrite' || mode === 'then' ? write.rewrite.source : mode,
        note: mode === 'then' ? 'then:' + write.rewrite.id : '',
        prompt:
          mode === 'react' && write.react
            ? write.react.text
            : mode === 'rewrite' || mode === 'then'
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
  if (mode === 'rewrite' || mode === 'then') $('writeResult').insertAdjacentHTML('afterbegin', rewriteCompareHTML(write.rewrite, res.sents));
  if (mode === 'free') {
    if (btn) btn.remove();
  } else {
    writeRender(); /* swaps Check for Start over */
    sessionDone('write');
  }
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
    /* for a long piece, how it holds together comes before the sentences */
    (res.flow && res.flow.length
      ? '<div class="eyebrow" style="margin-top:18px">How it flows</div>' +
        res.flow.map((f, i) => '<p class="note">¶' + (i + 1) + ' · ' + esc(f) + '</p>').join('') +
        '<div class="eyebrow" style="margin-top:18px">Sentence by sentence</div>'
      : '') +
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
      (x.simpler && norm(x.simpler) !== norm(x.fixed) ? '<details><summary>↓ simpler</summary>' + esc(x.simpler) + '</details>' : '') +
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
    if (write.mode === 'long' && write.phase === 'idle') {
      const n = inp.value.split(/\s+/).filter(Boolean).length;
      $('writeHint').textContent = n + ' words so far — aim for about 200.';
    }
    if (write.mode === 'free' && write.phase === 'running') {
      inp.classList.remove('stalling');
      $('writeHint').textContent = '';
      caretToEnd();
    } else persistWriteText();
  });
});

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
Reply with ONLY JSON: {"common":"yes|rare|no","why":"one short line in plain words — no grammar terms","alts":["a natural alternative","another one"]}${COACH_RULES}`,
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
