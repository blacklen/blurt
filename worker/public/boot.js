/* boot.js — Login gate, reminder settings, and the boot sequence (loads last).

   Part of the app split into plain <script> files loaded in order by
   index.html (no modules, no build step), so inline onclick handlers keep
   working. Everything here is global on purpose. */

let vnShareTimer = null;

function setVnShare(v) {
  state.settings.vnShare = Math.max(0, Math.min(100, Math.round(Number(v) / 10) * 10));
  $('vnShareLbl').textContent = state.settings.vnShare + '%';
  clearTimeout(vnShareTimer);
  vnShareTimer = setTimeout(saveState, 400);
}

function saveFreeMin() {
  const n = Math.floor(Number($('freeMinIn').value));
  if (!(n >= 1 && n <= 30)) {
    $('freeMinStatus').textContent = 'Enter a whole number from 1 to 30.';
    return;
  }
  state.settings.freeMin = n;
  $('freeMinIn').value = n;
  saveState();
  if (write.phase !== 'running') writeRender();
  $('freeMinStatus').textContent = 'Saved — ' + n + ' minute' + (n === 1 ? '' : 's') + '.';
}

/* ================= login gate (single shared secret) ================= */
/* The app is gated: nothing loads until the secret is entered and validated.
   Once stored, later visits skip the gate (and work offline from cache). */
function gateStatus(msg, isErr) {
  const el = $('gateStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--bad)' : 'var(--muted)';
}

function setAcctStatus() {
  const el = $('acctStatus');
  if (!el) return;
  el.textContent = loggedIn()
    ? 'Logged in ✓ Your reps sync to the server, and AI feedback + reminders are on.'
    : 'Logged out.';
  el.style.color = 'var(--mint)';
}

function saveBase() {
  API_BASE = apiBase();
  try {
    localStorage.setItem('blurt:apiBase', API_BASE);
  } catch (e) {}
}

function showGate() {
  $('loginGate').style.display = 'flex';
  if ($('gateBaseIn')) $('gateBaseIn').value = API_BASE;
  setTimeout(() => {
    const s = $('gateSecretIn');
    if (s) s.focus();
  }, 0);
}

function hideGate() {
  $('loginGate').style.display = 'none';
}

async function doLogin() {
  saveBase();
  const s = $('gateSecretIn').value.trim();
  if (!s) {
    gateStatus('Enter your secret first.', true);
    return;
  }
  gateStatus('Logging in…', false);
  const prev = secret;
  secret = s;
  try {
    await api('/api/login'); /* validates the secret */
    try {
      localStorage.setItem('blurt:secret', secret);
    } catch (e) {}
    $('gateSecretIn').value = '';
    hideGate();
    await loadAll(); /* pull your data, render the app */
    setAcctStatus();
  } catch (e) {
    secret = prev;
    const wrong = String(e.message).indexOf('401') >= 0;
    gateStatus(
      wrong ? 'Wrong secret — try again.' : "Couldn't reach the server (" + e.message + ').',
      true,
    );
  }
}

async function doLogout() {
  // Push anything still queued first — logging out drops the credential the
  // queue needs, so unsent reps would otherwise just evaporate.
  if (pendingCount()) {
    setSync('saving');
    await flush({ force: true });
    if (pendingCount() && !confirm('Some reps still haven’t saved. Log out anyway and lose them?')) {
      setSync('error');
      return;
    }
  }
  dataLoaded = false;
  pendingDocs.clear();
  pendingChunks.clear();
  pendingChunkDels.clear();
  pendingDocDels.clear();
  setSync('idle');
  secret = '';
  try {
    localStorage.removeItem('blurt:secret');
  } catch (e) {}
  if ($('settingsOverlay')) $('settingsOverlay').style.display = 'none';
  setAcctStatus();
  showGate();
}

/* Drop everything the old offline-first design left behind: cached banks, the
   mirrored state/chunk docs, and the '<key>:ts' merge baselines. Only the login
   secret and the API base stay — those are credentials, not practice data. */
function clearLegacyLocalData() {
  try {
    const keep = new Set(['blurt:secret', 'blurt:apiBase']);
    for (const k of Object.keys(localStorage))
      if (!keep.has(k) && (k.startsWith('blurt:') || k.startsWith('chunk:'))) localStorage.removeItem(k);
  } catch (e) {}
}

/* Startup: straight to the app if a secret is stored, otherwise show the gate. */
async function boot() {
  clearLegacyLocalData();
  loadPrompts(); /* fire-and-forget: static bank, fetched straight from /prompts.json */
  loadReflexes(); /* same for the curated /reflexes.json (Reflex ptype) */
  loadExpressions(); /* same for the curated /expressions.json (Expression ptype) */
  // body carries class="loading" from the markup, so the placeholders are in the
  // very first paint — app.js runs at the end of <body>, too late to beat it.
  if (loggedIn()) {
    hideGate();
    await loadAll();
    setAcctStatus();
  } else {
    setLoading(false); /* nothing to wait for; the gate owns the screen */
    showGate();
  }
}

/* ================= ntfy reminders ================= */
/* Micro-reps: state.ntfy.micro = {on, hours}; the server cron sends them. */
function microCfg() {
  const m = state.ntfy.micro || {};
  return { on: !!m.on, hours: Array.isArray(m.hours) && m.hours.length ? m.hours : [10, 15, 20] };
}

function renderMicro() {
  const m = microCfg();
  $('microChip').textContent = m.on ? '⚡ on' : 'off';
  $('microChip').classList.toggle('on', m.on);
  $('microHours').value = m.hours.join(', ');
}

function toggleMicro() {
  state.ntfy.micro = { ...microCfg(), on: !microCfg().on };
  saveMicro(); /* reads the hours box as typed, then re-renders */
}

function saveMicro() {
  const hours = [
    ...new Set(
      $('microHours')
        .value.split(/[^0-9]+/)
        .filter(Boolean)
        .map(Number)
        .filter((h) => h >= 0 && h <= 23),
    ),
  ].sort((a, b) => a - b);
  if (!hours.length) {
    $('microStatus').textContent = 'Enter hours like 10, 15, 20 (0–23).';
    return;
  }
  state.ntfy.micro = { on: microCfg().on, hours };
  state.ntfy.origin = location.origin; /* where the ping's tap should open */
  state.ntfy.tzOffset = new Date().getTimezoneOffset();
  saveState();
  renderMicro();
  $('microStatus').textContent = microCfg().on
    ? 'On — pings at ' + hours.map((h) => pad(h) + ':00').join(', ') + '.'
    : 'Off. Hours saved for when you switch it on.';
}

function initNtfy() {
  renderMicro();
  const sel = $('ntfyHour');
  sel.innerHTML = '';
  for (let h = 7; h <= 21; h++) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = (h < 10 ? '0' : '') + h + ':00';
    if (h === state.ntfy.hour) o.selected = true;
    sel.appendChild(o);
  }
  if (state.ntfy.on)
    ntfyStatus(
      'Reminders on → daily at ' + pad(state.ntfy.hour) + ':00, sent by the server.',
      false,
    );
}

function ntfyStatus(msg, isErr) {
  const el = $('ntfyStatus');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--bad)' : 'var(--mint)';
}

async function pingNtfy(title, msg) {
  if (!loggedIn()) throw new Error('not logged in');
  await api('/api/notify', { method: 'POST', body: JSON.stringify({ title, message: msg }) });
}

async function saveNtfy() {
  if (!loggedIn()) {
    ntfyStatus('Log in first (Settings) — reminders are sent through the server.', true);
    return;
  }
  const hour = parseInt($('ntfyHour').value, 10);
  // The server fires the daily ping (Worker cron / local twin), reading these values.
  // It only ever sends one ping at the chosen hour, so changing the time never duplicates.
  state.ntfy.on = true;
  state.ntfy.hour = hour;
  state.ntfy.tzOffset = new Date().getTimezoneOffset();
  await saveState();
  ntfyStatus('Sending test ping...', false);
  try {
    await pingNtfy(
      'Blurt connected',
      '✓ Test ping! Your homework reminder will arrive daily at ' + pad(hour) + ':00.',
    );
    ntfyStatus(
      'Test ping sent ✓ Check your phone. Daily reminder set for ' + pad(hour) + ':00.',
      false,
    );
  } catch (e) {
    // The reminder time is already saved (saveState above), so failures here only
    // mean the test ping didn't go out — reassure rather than alarm.
    if (/429/.test(e.message)) {
      ntfyStatus(
        'ntfy is rate-limiting test pings — wait a minute and try again. Your daily reminder at ' +
          pad(hour) +
          ':00 is already saved.',
        true,
      );
    } else {
      ntfyStatus(
        "Couldn't reach the server to send the ping (" + e.message + '). Check the server URL above.',
        true,
      );
    }
  }
}

boot();
