# Blurt: confidence through writing — single execution plan

> **Status (2026-09-19): all phases done** on branch `improvements`, one commit
> per phase (Phase 9 in four commits, one per group). Deliberate differences:
> Phase 0 item 2 (local-midnight `dayStr`) was skipped on Jane's call — the day
> still flips at 07:00 Hanoi; Drill now treats straight and curly apostrophes
> as the same, so 71 prompts were dropped instead of 79, plus 6 expressions;
> Phase 5 produced 317 scenes; Phase 10 made twelve files, adding `ui.js` so
> `core.js` stayed helpers and state; `attempts` has 14 columns, so bulk writes
> pack 7 rows per statement and 175 per request.
>
> **Not done:** `npm run db:migrate` (remote) and `npm run deploy` — both wait
> for Jane. Every check so far was local: a throwaway D1 database, a headless
> browser, and faked Gemini replies.

> Self-contained. A fresh session can execute this without the conversation that produced it.
> Suggested first step for the executor: copy this file into the repo as `docs/PLAN.md` so progress can be ticked off and committed alongside the work.

## 1. Why

Blurt (`/Users/jane/practice/blurt`) is Jane's single-user English fluency app: Cloudflare Worker + D1 backend, single-file no-build frontend, Gemini for feedback. Jane has studied English for half her life and knows it well, but freezes when producing it: she over-monitors, goes word by word, and does not trust her own output. She does **not** want to practice speaking aloud. She wants to become comfortable thinking and writing in English, and Blurt's timed blurts already made her more flexible.

Goal of this work: **make her produce English faster than the monitor can interfere, show afterwards that it was mostly fine, and keep the proof.** Three daily activities (Freewrite, Blurt reps, Real writing) plus a proof layer (clean rate, her recurring error patterns, an archive of everything she wrote), then a native-path layer (Phase 8): input she reacts to, reflex scenes mined from shows she watches, a "sounds right?" intuition drill, and a gradual fade of Vietnamese seeds. The realistic target is *natural* (a native notices her idea, not her English), not *native*.

**Hard rules for the executor**
- Remove nothing that exists today (Random modes, streak freezes, chat, reminders, games all stay). Hiding the mic behind a setting is the one exception and is explicitly approved.
- Jane's global instructions: before writing code, outline which files you'll touch and the approach, and wait for her approval; when something is vague, ask instead of guessing. Do this once per phase.
- Keep `worker/src/index.js` (D1) and `server/server.js` (SQLite twin) in sync for every schema/route change.
- One phase per commit (or a few small commits per phase). Commit style from history: `Add …`, `Fix …`, `Update: …`. Do not deploy or run remote migrations without asking.
- No em dashes in UI copy is not required; match the existing playful tone ("steal this chunk", "no freebies").

## 2. Orientation for a cold start

```
worker/public/index.html      markup only; tabs are <div id="practice|drill|random|chat|chunks|stats">, nav buttons call showTab()
worker/public/app.js          ~3.8k lines, ~150 global functions, inline onclick handlers, no modules, no build step
worker/public/styles.css      CSS variables in :root, dark mode via [data-theme] and prefers-color-scheme
worker/public/prompts.json    1650 practice prompts {cat, kind:'vn'|'sit', text, sample, chunk, note}
worker/public/reflexes.json   525 reflex prompts (kind 'reflex'); to be replaced in Phase 5
worker/public/expressions.json 625 pattern prompts (kind 'expr')
worker/gen_prompts.py         Gemini script that grows prompts.json; CATS list must match app.js
worker/src/index.js           Worker: auth (Bearer APP_SECRET), /api/doc/:key, /api/chunks, /api/ai (Gemini proxy), /api/notify (ntfy), hourly cron reminder
worker/migrations/0001_init.sql  documents(key,value,updated_at) + chunks(id,data,due,ord,updated_at)
worker/wrangler.toml          D1 binding BLURT_DB, KV binding BLURT_KV (two TTL counters only), [assets] serves public/
server/server.js              Express + better-sqlite3 twin of the Worker, same routes and schema
README.md, worker/README.md, server/README.md   root README is mostly current; the other two are stale (still describe KV)
```

Key app.js facts (grep by function name; line numbers drift):
- **State**: global `state` object (streak, hw, history, settings, ntfy, repLog…) saved as one JSON doc via `saveState()` → `store.set('blurt:state')`. `chunks` is a global array; each chunk `{id, chunk, example, examples[], context, due, ef, interval, reps, hits, misses, lapses, rhits, rmisses, date}`.
- **Sync**: online-only. Writes go to `pendingDocs`/`pendingChunks`/`pendingChunkDels`/`pendingDocDels` maps, `flush()` sends them after `FLUSH_MS` idle with backoff; `setSync()` shows "Saving…/Not saved". `loadAll()` pulls state + chunks + aiPrompts in one `Promise.all`; on failure it shows `showLoadError()` and locks writes (`dataLoaded=false`).
- **AI**: `aiObj(payload)` → POST `/api/ai` → parsed JSON object or null. Every prompt asks for `Reply ONLY JSON`. `askGemini(p, blurt)` builds the per-kind correction prompt; `askGeminiThreeWays`, `replayJudge`, `genPrompt`, `genFreshExample`, `reformulateChunk`, `expandChunk`, `extractChunks`, `genChunkFromContext`, `genWeeklyPattern`, and the chat functions `convStart/convSend/convEnd` each have their own prompt.
- **Practice flow**: `startRep()` → `pickPrompt()` from `pool()` (filters by `state.cats`, `state.ptype`, `state.disliked`, recent) → `startRepWith(p)` → timer (`repSeconds()` = 45 − streak, min 30) → `finishRep()` → result card ids `yourBlurt`, `fixedBlock/fixedText`, `suggestBlock/suggestText`, `naturalText`, `chunkText`, `noteText`; `saveChunk(which)` stores a chunk with `newChunkBase()`.
- **Prompt types** `PTYPES`: vn, sit, reflex, expr, mix, three. `isSit` in `finishRep` groups sit/reflex/expr into the "your answer, fixed + native version" layout; vn shows only a native rewrite.
- **Drill**: SM-2 in `previewInterval()/scheduleAfter()`; `drillBlank(chunk, example)` blanks the chunk in a sentence (handles `+`, `/`, `…`, `___` pattern segments); `showDrillCard()`, `drillCheck()`, `gradeDrill()`.
- **Random tab**: `RMODES` (shuffle, burst, boss, wager, capsule, context, dictation), formats in `rxRenderWith()`; keep all.
- **Chat**: `conv` object, `convEnd()` grades the whole transcript once.
- **Voice**: `SR` = webkitSpeechRecognition; `startMic(inputId, btnId, onFinal)`; `toggleDrillMic`/`toggleDictMic` pass an `onFinal` that auto-runs Check. TTS via `speakText()`.
- **Stats**: `renderStats()` + `heatmapHTML()`; weekly pattern sentence in `state.lastPattern`.
- **Helpers**: `$`, `esc`, `norm` (lowercase, strip punctuation), `dayStr(off)`, `daysBetween`, `hist()`, `newChunkId()`, `shuffle()`.
- **Backend limits that shape bulk writes**: D1 free plan → max 100 bound params per statement, max 50 statements per invocation. `upsertChunks()` packs rows accordingly (`ROWS_PER_STMT`, `MAX_STMTS`). Reuse that pattern.

Local dev: `cd worker && npm run db:migrate:local && npm run dev` (needs `worker/.dev.vars` with `APP_SECRET=…`, `GEMINI_KEY=…`). App at `http://localhost:8787`.

---

## 3. Phases (execute in order)

### Phase 0: Bug fixes + docs

1. `genPrompt()` reply schema hardcodes `"cat":"work|daily|social|opinion|story"` although 18 categories exist → use `CAT_IDS.join('|')`.
2. `dayStr()` uses `toISOString()` (UTC), so "today" flips at 07:00 Hanoi → build from `getFullYear/getMonth/getDate`. Due dates are plain `YYYY-MM-DD`; no data migration.
3. `server/server.js` `reminderBody()` reads the dead `blurt:chunks` doc → query the `chunks` table (`COUNT(*) WHERE due <= ?`, `ORDER BY RANDOM() LIMIT 1`) like the Worker's `reminderBody()`.
4. 79 of 1650 prompts have a `chunk` not found verbatim in `sample` (pattern chunks like "X beats Y"), so Drill can't blank them. Port `drillBlank()`'s segment/regex logic into `gen_prompts.py` as `blankable(chunk, sample)`, add it to `valid()`, and run a one-off script that drops the 79 from `prompts.json`.
5. Rewrite `worker/README.md` (still says KV, `/api/kv/:key`, localStorage cache, offline mode, ~100 prompts, 5 categories) and `server/README.md` (same route names). Root `README.md`: replace the 1→3→7→14→30→60 ladder with SM-2. Later phases append their own README sections.

### Phase 1: See what changed, hear when it was already fine, mic off

1. **`wordDiff(a, b)`** helper in app.js: whitespace tokens, LCS over `norm()`-ed tokens, returns HTML with `<del>`/`<ins>` (original casing kept). Styles `.diff del` (strike, `--bad`) / `.diff ins` (underline, `--mint`). No library.
2. **Minimal correction for "Say it in English" (kind vn)**: in `askGemini()` add `fixedAnswer` to the vn instruction with the same wording Situation already uses ("THEIR sentence, corrected. Keep their own words and structure; change only what is wrong… NOT a rewrite"). In `finishRep()` drop the `isSit` layout switch: always render `fixedBlock` (diff vs blurt) + `suggestBlock` (native) + chunk boxes; hide `fixedBlock` only for blank reps and `expr`. `saveChunk('fixed')` already stores `fixedAnswer` as the example, so her own sentence becomes the drill sentence.
3. **"Already natural" lead**: add `"clean": true|false` to every correction prompt (true when no meaningful change was needed; also treat `norm(blurt)===norm(fixedAnswer)` as clean client-side). When clean: result card leads with a big green `✓ That was already natural`, the fixed block is hidden, and the note says what was good. Make it visually louder than a correction.
4. **Diff everywhere a correction shows**: result card, `finishReplay()` ("last time" vs now), and later Chat and Write.
5. **Type it back**: `⌨️ Type it back` ghost button in the result row → blur the natural/suggest box (CSS `filter: blur(6px)`), an input appears; on Enter show `wordDiff(typed, natural)` + verdict. No schedule/homework effect. Put `speakNatural()`'s 🔊 next to it.
6. **Mic off by default, never auto-grades**: browser speech recognition misreads Jane's accent (unreleased final consonants) and today a misheard word is graded as a miss. Add `state.settings.voice` (default `false`) + a "Voice input" toggle card in the Settings sheet. Gate `micBtn`, `drillMicBtn`, `dictMicBtn`, `convMicBtn` on `SR && state.settings.voice` (move the `DOMContentLoaded` show-mic hook into `renderAll()`). In `toggleDrillMic()`/`toggleDictMic()` drop the `onFinal` auto-check: the transcript only fills the box, the user presses Check. TTS untouched.

### Phase 2: Persistent attempt log, error tags, clean rate

**Schema** `worker/migrations/0002_attempts.sql` (+ `0003_drop_attempt_pred.sql`), mirrored in `server.js` `db.exec`:
```sql
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, d TEXT NOT NULL, source TEXT NOT NULL, kind TEXT,
  prompt TEXT, blurt TEXT, fix TEXT, natural TEXT, note TEXT, tags TEXT,
  clean INTEGER, conf TEXT, created_at TEXT NOT NULL
);
-- conf: 'sure' | 'unsure' | NULL (Phase 9e).  (`pred`, Phase 9f, was dropped in 0003 — see below.)
CREATE INDEX IF NOT EXISTS idx_attempts_d ON attempts(d);
CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts(created_at);
```
`source` ∈ practice | replay | three | chat | write | free. `clean` NULL = ungraded (a freewrite that was never reviewed). `tags` comma-joined.

**Routes** (auth like everything else), in both backends:
- `POST /api/attempts` `{attempts:[…]}` → batched **upsert** (`ON CONFLICT(id) DO UPDATE SET fix, natural, note, tags, clean`) so a freewrite can be graded later. 12 columns → `Math.floor(100/12) = 8` rows per statement; reuse the packing from `upsertChunks()`. Refuse > `8 * MAX_STMTS` rows with 413 like `putChunks` does.
- `GET /api/attempts?since=YYYY-MM-DD` (recent window) and `GET /api/attempts?before=<created_at>&limit=50&q=<text>&clean=1&source=<s>` (archive paging + search; `q` → `LIKE '%…%'` over blurt/fix/prompt). Order by `created_at DESC`.

**Client**:
- Sync queue: `pendingAttempts` map by id beside `pendingChunks`; `queueAttempt(a)`; `flush()` POSTs it after chunks; failure path re-queues like the others; include in `pendingCount()`.
- `logAttempt({source, kind, prompt, blurt, fix, natural, note, tags, clean})` → sets `id = newChunkId()`, `d = dayStr(0)`, `created_at`, pushes into in-memory `attempts` and `queueAttempt`. Replaces both `state.repLog.push` sites (`finishRep()`, `finishThreeWays()`).
- `loadAll()` also fetches `GET /api/attempts?since=<90 days ago>` into module-level `attempts` (add to the `Promise.all`). One-time migration: if `state.repLog` has entries, POST them (source `practice`) then `delete state.repLog` and save.
- Rewire readers of `state.repLog` → `attempts`: `replayPool()`, `warmupPick()`, `avoidedChunks()`, `genWeeklyPattern()`.
- **Error tags**: add `"tags":[…]` to `askGemini` (both kinds), `askGeminiThreeWays`, `replayJudge`, and later chat/write prompts. `ERROR_TAGS = ['article','tense','preposition','word-order','word-choice','plural','missing-word','calque','none']`; validate against the list before storing.
- **AI quota notice** (small): in `geminiJSON()`, when the proxy returns 429 or a Google `RESOURCE_EXHAUSTED` body, show `AI quota reached for today — bank feedback only` in the sync-state slot instead of silently falling back to the bank.
- **Clean rate**: header shows `✓ 71% clean this week` beside the streak, and the homework card shows the same line under "No homework, no streak" so one thing that went well always sits next to the thing owed. Stats: clean rate this week vs last week as the first big number, plus 12 weekly bars (reuse `.statGrid`). Only rows with `clean IS NOT NULL` count.
- **Error types** in Stats: horizontal bars per tag for the last 30 days with delta vs the prior 30 days (reuse `.rxBar`/`.rxFill`). Keep the weekly-pattern sentence; feed `genWeeklyPattern()` from `attempts`.
- Extract `creditRep()` from the duplicated `state.total++; hist().reps++; state.hw…; saveState(); creditStreakIfDone(); renderHeader(); renderHW()` block in `finishRep()` and `convEnd()`.

### Phase 3: "Write" tab — Freewrite, Journal, Draft a real message

`index.html`: nav button `tabWrite` ("Write") + `<div id="write">` card with mode chips `Freewrite · Journal · Draft a message`, `#writeSeed`, `textarea#writeInput` (min-height ~160px), `#writeTimer`, action row, `#writeResult`. Add `'write'` to the tab list in `showTab()`.

**Freewrite (the anti-monitor drill)**
- Seed: a random vn-kind prompt from `pool()` (or a reflex scene), shown above the box in Vietnamese. Timer default 3 min (`state.settings.freeMin`, editable in Settings next to homework reps).
- `keydown` on the textarea blocks `Backspace`, `Delete`, `cut` and `paste` events; on `input` force the caret to the end so typing always appends. Eyebrow: `no backspace · keep going`.
- Stall warning: no keystroke for 5 s → textarea gets class `.stalling` (opacity pulse) + hint `keep typing…`; never deletes text.
- On timer end: box locks, show word count and words/min; `logAttempt({source:'free', kind:'free', prompt:seed, blurt:text, clean:null})`; `creditRep()` once.
- Optional button `What would a native tweak?` → runs the Journal pipeline below on the same text, then re-logs the **same attempt id** with `fix`/`tags`/`clean` (upsert). She chooses whether to be judged.

**Journal / Draft**
- `writeCheck()`: one Gemini call → `{"sentences":[{"original","fixed","natural","chunk","tags","clean"}],"note","ready"}`. Include `state.settings.context` the way `genPrompt()` does. Journal = casual register. Draft = keep her tone and intent, fix only what a native colleague would notice, `ready` = the full cleaned message.
- Render per sentence: `✓ already natural` or `wordDiff(original, fixed)`; native alternative collapsed behind "show a native version"; `chunkBox` with Save (reuse `newChunkBase()` + `chunkAdd()`, `example = fixed`, `context = original`); Save-all like `savePasteChunk('all')`.
- Draft adds `Copy the clean version` (copies `ready`) so the next step is actually sending it.
- Each sentence → `logAttempt({source:'write'})`; whole check → `creditRep()` once.
- Draft persistence: `state.write = {date, mode, text}`; cleared on a new day.
- `smartNext()`: when reps are short, offer `✍️ Freewrite 3 min` before the existing options.
- README: new "Write" section.

### Phase 4: "Your English" archive (in Stats)

- New section at the bottom of `renderStats()`: search input, filter chips `All · ✓ Clean only · Practice · Write · Free · Chat`, list newest first: date, source badge, prompt (small, muted), then `✓ <sentence>` when clean or the diff. `Load more` fetches older rows via `before=`.
- First page from the in-memory `attempts`; paging/search via the Phase 2 GET route.
- Each row: `Save as chunk` (when a `fix` exists; reuse `newChunkBase()`), `Retry` (starts a replay rep via `startReplay({prompt, blurt, fix})`).

### Phase 5: Rebuild Reflex as a typed, Vietnamese-narrated drill

The executor writes the new `worker/public/reflexes.json` directly (no Gemini script). Schema unchanged: `{cat, kind:'reflex', text, sample, chunk, note}`.
- `text`: the scene narrated in **Vietnamese**, present tense, 1–2 short sentences; any spoken line from another character stays in **English** inside quotes (that is what she'd hear). Example: `Bạn cùng phòng mở cửa, mặt tái mét: "Dude, I think I just broke your laptop."`
- Setting: native everyday life in sitcom/movie style (Friends, The Office, Modern Family, rom-coms): apartment/roommates, coffee shop, office, dating, family dinner, bar, street/subway, airport, shop/restaurant, phone calls, parties, good news, bad news, awkward moments. No Vietnam-specific content.
- `sample`: the ONE short line a native fires back instantly (2–8 words, spoken, idiomatic). Several scenes share a chunk on purpose ("no way", "you're kidding", "my bad", "no worries", "same here", "say no more", "tell me about it", "you okay?", "what are the odds", "hang in there", "I'll get it", "bless you", "after you", "my treat") so lines get overlearned.
- `chunk`: inside `sample` verbatim (must pass `drillBlank()`). `note`: one Vietnamese line on when/why the line fires (≤ 20 words). `cat`: spread across the `CATS` ids.
- Target ~300 entries, written in batches of ~50 and appended; dedupe by `norm(text)`; validate schema + blankability with a short Python check before committing. Old 525 dropped.

**Code**: `REFLEXES` cold-start fallback in app.js → 3 entries from the new bank. `repSeconds()` returns `REFLEX_SECONDS = 8` when `current.prompt.kind === 'reflex'` (typed reflex, no speaking). `genPrompt()` reflex `kindInstr`: Vietnamese `text` with English quoted speech, English `sample`/`chunk`, Vietnamese `note`. `askGemini()` for reflex: note in Vietnamese; judge "did this land as an instant native reaction"; set `clean` generously for any idiomatic acceptable line; list up to 2 other acceptable lines in `natural`. README: document Vietnamese-narrated reflexes.

### Phase 6: Chat per-line corrections

- `convEnd()` prompt adds `"lines":[{"you","fixed","tags","clean"}]`, one per learner turn, in order.
- `convRender()` done-state: under the grade, each learner line with `✓` when clean or `wordDiff(you, fixed)`; tags.
- `logAttempt()` per line, `source:'chat'`, `prompt: conv.scenario`.

### Phase 7: Backup file + chunk search

- `exportChunks()` → `{version:2, exportedAt, chunks, state, attempts}` as a Blob download `blurt-backup-YYYY-MM-DD.json`; clipboard only as fallback.
- `importChunks()` → hidden `<input type="file" accept=".json">` + `FileReader`; existing dedupe/migrate logic; `queueAttempt` any attempts not already present by id.
- `input#chunkSearch` above `#chunkList`; `renderChunks()` filters by `norm()` over chunk/example/context; debounced on `input`.
- README: `wrangler d1 export blurt --remote --output backup.sql` as the server-side backup.

### Phase 8: Native-path additions (input + intuition)

Four features that add the input strand and the "does this sound right" intuition natives have. Nothing here removes anything.

**8a. Sentence mining from shows** (Chunks tab, add tools)
- New sub-form next to the existing paste-to-chunks: `📺 From a show — paste subtitle lines or a scene you just watched`. One Gemini call → `{"scenes":[{"text","sample","chunk","note"}],"chunks":[{"chunk","example"}]}` where `text` is the moment narrated in Vietnamese with the English line quoted (same spec as Phase 5), `sample` the native reply line, `note` in Vietnamese.
- Preview like `extractChunks()`; Save writes scenes to a new per-user doc `blurt:myReflexes` (array, cap 500, via `store.set`) and chunks via `chunkAddMany()`.
- `loadAll()` loads `blurt:myReflexes`; `pool()` merges it with `REFLEXES` for the reflex ptype. Reflex cards from it show a small `📺 yours` badge. `dislikePrompt()` works on them too.

**8b. "Sounds right?" mode** (Random tab, new `RMODES` entry `sense`)
- Card: two sentences, pick the natural one; verdict names which was off and why in one line.
- Pair sources, in priority: (1) her own `attempts` where `norm(blurt)!==norm(fix)` → show `blurt` vs `fix` (zero AI cost, and it is her own history); (2) a chunk's example vs one AI "wrong variant" using the existing `mc` prompt in `rxRenderAI()`. Shuffle order each card.
- Scores into `rhits/rmisses` + `history.rr/rh` via `scoreRandom()` like every other mode; never touches SM-2.

**8c. Fade the Vietnamese**
- `state.settings.vnShare` (0–100, default 100): in `pool()` for `mix`/`three`, weight the draw between `vn` and `sit` kinds by this share. Settings card: slider `Vietnamese prompts: 100%` with hint "lower it as translating fades".
- Freewrite seed stages `state.settings.freeSeed` ∈ `vi` (Vietnamese sentence, default) | `en` (English situation from the `sit` bank) | `topic` (one English topic word, e.g. "deadlines") | `none` (blank page). Chips on the Freewrite card. Nudge, never force: after 5 freewrites at a stage with `clean` ≥ 70% (when graded), show `Ready for the next stage?` with a one-tap switch.

**8d. Read then react** (Write tab, new mode chip `React`)
- Gemini generates a short native text (2–5 lines): a Reddit comment, a Slack thread, a text from a friend, or a short email, seeded by selected `state.cats`, `state.settings.context`, and up to 2 due chunks (so a good reply can reuse one). Prompt returns `{"kind":"reddit|slack|text|email","from":"who","text":"…"}`. Fallback when AI is down: a small static `worker/public/reacts.json` (~40 hand-written texts, executor writes them).
- She replies in `#writeInput`; on Check, run the Journal pipeline (per-sentence diff, `✓ already natural`, chunks) plus one extra field `"fit":"one line on whether the reply matches the register of the original"`.
- Log each sentence with `source:'react'`; add `react` to the `source` list, the archive filters, and `creditRep()` once per reply.

### Phase 9: Experiments (Jane will try them all and keep what works)

Eighteen small, self-contained features. Each is one chip, one button, one Random mode, or one prompt rule, and each logs through `logAttempt()` so the archive and clean rate see it. Build them in any order; none blocks another.

**Quiet the monitor**
- **9a Speed ladder** — new `PTYPES` chip `Ladder`. Same prompt three rounds with timers `LADDER_SECONDS = [30, 20, 12]`; each round's text is kept (like `three`). Result: the three attempts, diff of round 3 vs fix, one AI call (reuse `askGeminiThreeWays` framing, ask for `fixedAnswer` of the last round). Log `kind:'ladder'`.
- **9b Your 100** — chunk flag `c.core` toggled by a ⭐ in `renderChunks()` (cap 100). New `RMODES` entry `core`: draws only core chunks, shows the blanked example with a 10 s timer; an exact typed answer bumps `c.coreStreak`, a miss resets it; at 3 in a row `c.coreDone = true` and it retires from the draw (✓ in the list). Stats: `37 / 100 owned`.
- **9c Micro-reps via pings** — `state.ntfy.micro = {on:false, hours:[10,15,20]}` in Settings. The hourly cron in `fireDueReminder()` (both backends) also sends a micro ping at those hours: a random vn prompt text as the body, with ntfy `Click` header → `<origin>/?quick=1`. App: on boot with `?quick=1`, after `loadAll()` open Practice and `startRep()` immediately; eyebrow `⚡ quick blurt`.
- **9d Copywork** — Write-tab chip `Copy`. Shows a native paragraph (from the React generator or `reacts.json`); timer starts on first keystroke; paragraph stays visible; on Done show accuracy % (from `wordDiff` token matches) and words/min. No AI. Log `source:'copy'`, `clean = accuracy ≥ 95`.

**Self-trust and noticing**
- **9e Sure or unsure** — two small toggles under the Practice textarea, `😐 unsure · 😎 sure` (optional, default none); stored as `conf` on the attempt. Stats block **Calibration**: "felt unsure N times → clean M% of those / felt sure N → clean M%", last 30 days. If unsure-but-clean is high, say so in words.
- **9f Predict the fix** — *removed 2026-09-20: it added nothing to a rep, and with no AI fix to diff against it marked every word a miss. Feature, `pred` column and the Noticing stat are all gone.* ~~after Check, while the AI call is in flight, the result card shows the blurt as tappable words (`.predWord`, toggle class `.picked`) and a `Reveal` button. On reveal (or when the AI result lands and she taps Reveal), compare picked words with the `<del>` set from `wordDiff`; `pred = 1` if every changed word was picked and no more than one extra, else 0; clean reps with no picks count as 1. Stats: **Noticing** accuracy %.~~
- **9g Rewrite tomorrow** — Write-tab launcher offers `↻ Rewrite yesterday's entry` when an attempt with `source ∈ write|free|react` exists for `dayStr(-1)`. Shows only that entry's seed/prompt and its first 8 words as a cue, never the fix. She writes fresh; check via the Journal pipeline; then show yesterday's diff and today's diff side by side with the tag counts. Log `source:'rewrite'`.
- **9h "I used it for real"** — `✔ used it` button on each chunk row: `c.used = (c.used||0)+1`, `c.lastUsed = dayStr(0)`, `chunkSave(c)`. Stats: `chunks used for real this week: N`; the weekly recap names them.

**Move English into real work**
- **9i Explain it** — Write-tab chip `Explain`. Seed: a topic typed by her, or one from `EXPLAIN_TOPICS` (~40 static dev topics: "what a race condition is", "why we use feature flags", "how our deploy works"…) mixed with nouns from `state.settings.context`. Check via the Journal pipeline plus one extra field `"clarity":"one line: would a new teammate get it?"`.
- **9j Two voices** — Write-tab chip `Dialogue`. Seed a scenario from the `sit` bank; textarea prefilled with `You:` / `PM:` line starters (role name from context if present). Check treats each line as a sentence; extra field `"questions":"one line on whether the questions sound natural"`.
- **9k "Do natives say this?"** — in any result/diff area and the Write result, selecting text shows a floating `Do natives say this?` button (`selectionchange` within those containers). One AI call → `{"common":"yes|rare|no","why":"one line","alts":["…","…"]}` rendered as a popover; each alt has `Save as chunk`.
- **9l Weekly letter** — extend `maybeWeeklyRecap()`: collect up to 25 `clean=1` sentences from the last 7 days across all sources and arrange them, unchanged, into a short first-person letter ("This week I wrote…", grouped by day); no AI needed. Store in `state.letters` (cap 12) and show in Stats under **Weekly letters** (expandable); ntfy ping `Your weekly letter is ready`.

**Feel and progress**
- **9m No grammar jargon** — a shared constant `COACH_RULES` appended to every correction prompt (`askGemini`, `askGeminiThreeWays`, `replayJudge`, `writeCheck`, chat grading, natives popover): "Explain in plain words a friend would use. Never use grammar terminology (no 'article', 'adverbial', 'present perfect'); say what to do, e.g. 'in English the time usually goes at the end'." Tags in `ERROR_TAGS` stay internal for stats; only the `note` text changes.
- **9n Say it simpler** — optional field `"simpler":"the same idea in the smallest common words, or empty if it was already simple"` in every correction prompt. Rendered as a collapsed line `↓ simpler` under the fix; `Save as chunk` on it.
- **9o Then vs now** — generalise 9g: the Write launcher also offers `⏳ Then vs now` when an attempt older than 60 days exists for a prompt she hasn't redone. Same flow as Rewrite tomorrow, but the comparison shows the old attempt, its old diff, and today's, with the dates. Log `source:'rewrite'` with `prompt` linking the old id in `note`.
- **9p Signature phrases** — Stats block **Your voice**: from `attempts` with `clean=1` over 90 days, count 2–4-word n-grams (after `norm()`, drop stopword-only grams) and list the top 10 she reuses, plus the chunks she has marked `✔ used`. No AI.
- **9q Session recap** — `▶ 15-minute session` button on the homework card: queues Freewrite → 3 blurts → one Write (mode of choice), tracked in a module-level `session` object. Ending it (or the last step) shows a card: words written, clean rate this session, one sentence that was clean picked at random with `✓ you nailed this`, and the streak. Logged into `state.history[d].sessions`.
- **9r Long piece** — Write-tab chip `Long`. Target ~200 words, no timer, prompt from a small `LONG_TOPICS` list (a sprint retro, what you'd change about the codebase, a post about a bug you fixed) or her own title. Check: one AI call returning per-paragraph `flow` notes (order, transitions, what to cut) and the usual per-sentence diffs, but the flow notes render first. Offered by `smartNext()` at most once a week, and only when the last 7 days' clean rate is ≥ 70%.

### Phase 10: Split app.js into files (no build step)

Plain `<script>` tags in dependency order so inline `onclick` globals keep working (do **not** switch to ES modules). Cache-bust each with `?v=`:
```
core.js      $, esc, norm, dayStr, daysBetween, state, chunks, attempts, CATS, PTYPES, ERROR_TAGS, wordDiff
sync.js      api, aiObj, queue*, flush, store, loadAll, loadChunks, loadAttempts, logAttempt
practice.js  pool/pickPrompt, startRep…finishRep, askGemini*, replay, three-ways, ladder, genPrompt, type-it-back, sure/unsure, quick blurt
drill.js     SM-2, drillBlank, drillNext…gradeDrill
random.js    RMODES, rx*, dictation, sounds-right, core (Your 100)
chat.js      conv*
write.js     freewrite, writeCheck, react, copy, explain, dialogue, rewrite-yesterday, natives popover
chunks.js    renderChunks, save/add/expand/reformulate, export/import, search, show mining, ⭐ core, ✔ used
stats.js     renderStats, heatmapHTML, clean rate, error bars, calibration, noticing, archive, weekly recap + letter
voice.js     SR mic, speakText/pickVoice, theme
boot.js      gate/login, ntfy settings, boot()
```
Move functions verbatim, no behavior change; full manual pass afterwards.

---

## 4. Verification per phase

- **Local stack**: `cd worker && npm run db:migrate:local && npm run dev`. Open `http://localhost:8787`, log in with the `.dev.vars` secret.
- **Phase 0**: blankability script → 0 offenders; an AI prompt lands in a non-original category; homework date flips at local midnight (temporarily override `Date` in the console); `server/` reminder names a due chunk.
- **Phase 1**: a vn rep with one deliberate article error → diff marks exactly that word; a correct rep shows `✓ That was already natural` and no fixed block; type-it-back with one wrong word diffs it and leaves `state.hw` unchanged; no mic buttons until Voice input is on, and with it on a transcript never triggers Check by itself.
- **Phase 2**: `curl -H "Authorization: Bearer <secret>" "http://localhost:8787/api/attempts?since=2026-01-01"` returns rows after a rep; Replay still works after reload; header and Stats show the clean rate; error bars render; `state.repLog` migrated then gone.
- **Phase 3**: Freewrite: Backspace does nothing, paste is blocked, stall hint after 5 s, timer end logs an attempt with `clean=null` and counts one homework rep; "What would a native tweak?" upgrades the same row. Journal with 4 sentences → 4 blocks; Draft returns a copyable clean message.
- **Phase 4**: archive lists newest first, search finds a word from an old blurt, Clean-only filter works, Load more pages, Retry launches a replay rep.
- **Phase 5**: Python check → 0 schema/blankability failures, 0 duplicate texts; 10 Reflex reps: Vietnamese scene, English quotes, 8-second timer, Vietnamese note; a saved reflex chunk blanks correctly in Drill.
- **Phase 6/7**: chat end shows per-line diffs; export downloads a file; delete a chunk → import restores it with no duplicate attempts; chunk search filters live.
- **Phase 8**: paste 5 subtitle lines → scenes appear as reflex cards with the `📺 yours` badge after save; Sounds right? shows an old blurt/fix pair from the archive and scores into random stats; lowering the Vietnamese slider to 0 makes Mix serve only `sit` prompts; Freewrite chips switch seed stage and the nudge appears after 5 graded clean freewrites; React shows a native text, the reply gets per-sentence diffs and a register note, and `reacts.json` is served when `GEMINI_KEY` is unset.
- **Phase 9**: Ladder runs three shrinking timers on one prompt; a ⭐ chunk retires after three exact answers in Core mode; a `?quick=1` URL opens straight into a rep and the cron sends a micro ping at a configured hour; Copy shows accuracy and WPM; a sure/unsure tap appears in Stats calibration; Predict scores picked words against the diff; Rewrite yesterday shows both diffs; `✔ used it` increments and shows in Stats; Explain/Dialogue check with their extra line; selecting text in a result shows the natives popover; after a week with clean sentences a letter appears under Stats; no correction note contains grammar terms; `↓ simpler` shows when applicable; Then vs now appears once an attempt is older than 60 days (fake `created_at` locally to test); Your voice lists repeated n-grams; a 15-minute session ends on a recap card; Long returns flow notes before sentence diffs.
- **Phase 10**: every tab and every button once; no `ReferenceError` in the console.
- **Deploy** (ask Jane first): `npm run db:migrate` (remote) before `npm run deploy` once Phase 2 lands. Bump the `?v=` cache-busters in `index.html` on every deploy.
