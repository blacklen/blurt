/* chat.js — The Chat tab: role-play conversation and its per-line grading.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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
{"grade":"a short verdict like 'Natural' / 'Getting there' / 'Keep practicing'","used":["which target phrases they actually used, if any"],"note":"2-3 sentences of specific, encouraging feedback with one concrete tip","lines":[{"you":"the learner's line, exactly as written","fixed":"THEIR line minimally corrected: keep their words, change only what is wrong or unnatural. Copy it exactly if nothing needs changing.","clean":true or false (true = no meaningful change needed, ignoring capitalization and punctuation),${TAGS_FIELD}}]}${COACH_RULES}`,
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
