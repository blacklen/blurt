/* voice.js — Speech in and out, plus the light/dark toggle.

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

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
