/* chunks.js — The My chunks tab: the list, adding, mining, backup files.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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
