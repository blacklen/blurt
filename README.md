# Blurt

60-second English fluency reps. Built for a Vietnamese software developer who wants to think in English without translating.

## What it does

Each rep gives you a prompt — either a Vietnamese sentence to express in English, or a real situation to react to — and a timer. You blurt it out fast. Editing is cheating.

After you submit, Gemini shows you how a native speaker would say it, picks the most reusable phrase (a **chunk**), and gives you a short coaching note. Chunks enter a spaced-repetition drill schedule (SM-2): each chunk keeps its own ease factor, the gap grows by that factor every time you recall it, and a miss sends it back to today.

**For situation prompts**, the target chunk is shown upfront so you practice producing it on demand. The AI then checks if you used it, fixes grammar and unnatural phrasing, and shows a sample answer built around that chunk.

**For Vietnamese prompts**, you blurt freely — the AI picks the best chunk from its rewrite.

**For Reflex prompts**, a moment is narrated in Vietnamese (what someone says stays in English, in quotes) and you have 8 seconds to type the line a native would fire back. Any natural reply counts as clean, not just the example.

### Tabs

| Tab | What it does |
|-----|-------------|
| **Practice** | One rep with a timer. Pick mood categories, or generate an AI prompt. **🪜 Ladder** runs one prompt three times with 30 s, 20 s, then 12 s, and checks round 3. |
| **Random** | Nine game modes (Shuffle, Burst, Boss, Wager, Capsule, Full sentence, Dictation, Your 100, Sounds right?) that drill your saved chunks without touching the SRS schedule. **Sounds right?** shows two sentences and you tap the natural one; pairs come from your own old answers and their fixes first, then from a chunk with an AI-made slip. **⭐ Your 100**: star up to 100 chunks in My chunks; each card gives 10 seconds, and three exact answers in a row mark it owned (Stats shows owned / 100). |
| **Chat** | Live role-play with an AI character. **End & grade** gives an overall verdict, then checks each of your lines: ✓ when it was already natural, otherwise a word diff with what it was about. Every line goes into your archive and clean rate; the conversation counts as one rep. |
| **Write** | Nine modes. **Freewrite**: a Vietnamese idea, a timer (3 min by default, set in Settings), and a box you can only add to (no backspace, delete, paste or cut; a pause of 5 s makes it pulse "keep typing…"). It's logged ungraded and counts as a rep; "What would a native tweak?" grades it afterwards. **Journal**: a few casual sentences. **Draft a message**: a real Slack message or email, fixed only where a native colleague would notice, with a copyable clean version. **React**: a short native text (Reddit comment, Slack thread, text from a friend, email) to reply to; the check adds a line on whether your tone fits theirs (40 backup texts in `reacts.json` when the AI is down). Freewrite ideas come in four stages (Vietnamese idea → English situation → one word → blank page); after 5 freewrites at a stage with ≥70% clean, it offers the next one. **↻ Rewrite yesterday** (shown when you wrote something yesterday): yesterday's prompt and a short cue, you write it fresh, then yesterday's fixes and today's sit side by side. **Explain**: explain a dev topic (from a built-in list, your own context, or one you type) — the check adds a line on whether a new teammate would get it. **Two voices**: write both sides of a short dialogue; the check adds a line on how your questions sound. **Long**: about 200 words on a title of your own or from a list; the check starts with how it flows, paragraph by paragraph, then the sentences (offered at most once a week, and only after a week at 70%+ clean). **⏳ Then vs now**: redo something you wrote over 60 days ago and haven't touched since. **Copy**: type a short native text out word for word (paste blocked); shows accuracy and words per minute, no AI, and stays out of the clean rate. Journal, Draft and React check each sentence (✓ already natural, or a word diff), offer chunks to save, count as one rep, and keep the unfinished text until the day ends. |
| **Drill** | Spaced-repetition queue — due chunks only. Fill-in-the-blank from memory; type **or speak** your answer. Each review rotates through fresh AI-written example sentences (🔄 for a new one on demand) so you recall the chunk, not a memorised sentence. Grade a correct rep **Hard**, **Good** or **Easy**; each button shows the next interval SM-2 will give it. A miss brings the chunk back today. |
| **My chunks** | Everything you've stolen, with a live search box. **📺 From a show**: paste subtitle lines and the AI turns them into your own Reflex scenes (marked 📺 yours in Practice, stored in `blurt:myReflexes`) plus chunks. Add manually, or download a backup file (chunks, settings, every attempt) and import it back. |
| **Stats** | Clean rate (this week vs last, 12 weekly bars), 14-day rep chart, drill retention %, streak, what your fixes were about (last 30 days vs the 30 before), nemesis chunks, a weekly AI "mistake pattern" digest, and **Your English**: every answer you've written, newest first, searchable, filterable (clean only, or by source), with Save as chunk and Retry on each. |

### Other features

- **Fade the Vietnamese** — Settings → "Vietnamese prompts" sets how many Mix / 3-ways prompts are Vietnamese sentences vs English situations.

- **Streak system** — homework = 3 practice reps + all due drill chunks. Miss a day, streak resets.
- **Phone reminders** — daily ntfy.sh ping at a configurable hour, sent by the server.
- **Sure / unsure** — optional tap under the answer box; Stats → Calibration shows how often "unsure" answers were already clean.
- **Predict the fix** — after Check, tap the words you think will change before the answer shows (switch off in Settings); Stats → Noticing tracks it.
- **✔ used it** — mark a chunk you used for real; Stats and the weekly recap count them.
- **Micro-rep pings** — optional pings at hours you choose (Settings), each with one Vietnamese sentence; tapping opens the app straight into a rep (`/?quick=1`).
- **↓ simpler** — every correction can offer the same idea in smaller words, collapsed under the fix, savable as a chunk.
- **No grammar jargon** — every coaching note is told to explain in plain words ("in English the time usually goes at the end"), never terms like "article" or "present perfect". The tags behind Stats stay internal.
- **▶ 15-minute session** — homework card button: one freewrite, three blurts, one piece of writing, then a recap (minutes, words, clean rate, one sentence you nailed, streak).
- **Your voice** — Stats lists the 2-4 word phrases you reuse most across your clean sentences (90 days), plus the chunks you marked ✔ used.
- **Do natives say this?** — select any phrase in a result, write-up, drill or the archive and ask; you get yes / rare / no, why, and alternatives you can save as chunks.
- **Weekly letter** — every Sunday-ish recap also gathers up to 25 of your clean sentences from the week, unchanged, into a short letter (Stats → Weekly letters, plus an ntfy ping). No AI: it's literally what you wrote.
- **Weekly recap** — automatic ntfy ping summarising your week's reps and worst chunk, plus an AI-spotted recurring mistake pattern (also shown in Stats).
- **Voice input** — Web Speech API mic button on supported browsers, in both Practice and Drill.
- **Text-to-speech** — hear the natural version read aloud.
- **Cross-device sync** — state and chunks live in the server database, reached with a shared secret. The app is online-only: there is no local copy, writes are batched and retried, and the header says when something is still unsaved.

## Stack

- **Frontend** — plain HTML/CSS/JS ([index.html](worker/public/index.html), [app.js](worker/public/app.js), [styles.css](worker/public/styles.css)), no framework, no build step
- **Backend** — Cloudflare Worker + D1 ([worker/src/index.js](worker/src/index.js))
- **AI** — Gemini 2.5 Flash, proxied through the Worker so the key never touches the browser
- **Notifications** — [ntfy.sh](https://ntfy.sh), topic stored as a server secret
- **Auth** — one shared `APP_SECRET`; same secret = same data, no accounts

## Project layout

```
worker/
  src/index.js        # Cloudflare Worker: D1 store, Gemini proxy, ntfy proxy, cron
  migrations/         # D1 schema (documents, chunks, attempts)
  public/             # The frontend (index.html, app.js, styles.css) + prompt banks (*.json)
  gen_prompts.py      # Grows public/prompts.json with Gemini
  wrangler.toml       # Worker config, D1 + KV bindings, cron trigger, static assets
server/
  server.js           # Optional Node.js/SQLite alternative backend (self-hosted)
```

## Storage

Three tables, same shape in D1 and in the self-hosted SQLite twin:

| table | holds |
|---|---|
| `documents(key, value, updated_at)` | `blurt:state`, `blurt:aiPrompts` |
| `chunks(id, data, due, ord, updated_at)` | one row per chunk |
| `attempts(id, d, source, …, clean, tags, …)` | every answer you write, graded or not |

`ord` is the chunk's creation position. The practice engine addresses chunks by
array index, so the bank has to rebuild in the same order on every device;
editing a chunk deliberately leaves `ord` alone so it never jumps around.

This started on Workers KV and moved off it. KV bills per operation — 1,000
writes/day on the free plan, with no multi-get — so a key-per-chunk layout cost
one HTTP request per chunk just to open the app, and one write per graded rep;
a single drill session could exhaust the daily quota. D1 allows 100,000 row
writes/day, loads the whole bank in one query, and lets the reminder cron ask
`WHERE due <= ?` instead of downloading and parsing the entire bank. KV is still
bound, for two counters that genuinely want a TTL: the login throttle and the
"already reminded today" marker.

The Worker imports any pre-D1 KV data on first read, in pages, and marks itself
done — no manual migration step.

## Deploy (Cloudflare)

**Prerequisites:** Node.js, a Cloudflare account, `wrangler` authenticated (`wrangler login`).

```bash
cd worker
npm install

# First time only — creates the D1 database and prints its ID.
# Paste the ID into wrangler.toml under [[d1_databases]] as database_id.
npm run db:create

# Apply the schema (documents + chunks tables).
npm run db:migrate

# KV is still used for two TTL counters (login throttle, daily-reminder marker).
# The existing namespace already covers it; only run this on a fresh account:
# npm run kv:create

# Deploy to Cloudflare
npm run deploy
```

Then set secrets in the Cloudflare dashboard (or via CLI):

```bash
wrangler secret put APP_SECRET     # your login password
wrangler secret put GEMINI_KEY     # Google AI Studio key
wrangler secret put NTFY_TOPIC     # your ntfy.sh topic name (optional)
```

### Local dev

```bash
cd worker
npm run dev   # starts wrangler dev at http://localhost:8787
```

`wrangler dev --local` simulates D1 and KV on disk; run `npm run db:migrate:local` once to create the tables there. To test the cron handler:

```bash
wrangler dev --test-scheduled
# then in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

## Self-hosted alternative (Node.js)

If you'd rather not use Cloudflare, the `server/` directory contains a minimal Express + SQLite backend with the same API surface.

```bash
cd server
npm install
APP_SECRET=yourpassword GEMINI_KEY=yourkey NTFY_TOPIC=yourtopic node server.js
```

Point the app at `http://your-server:8787` via the Server URL field in Settings.

## Login

Open the app, enter your `APP_SECRET`, and optionally set the server URL. The secret is the only thing kept in `localStorage`, so subsequent visits skip the gate; all practice data lives in the database. The same secret on any device gives you access to the same data.

## Prompt categories

| Category | Examples |
|----------|---------|
| 💼 Work | standups, code reviews, estimates, slack messages |
| ☀️ Daily life | errands, food, weather, weekend plans |
| 💬 Small talk | greetings, compliments, polite exits |
| 🧠 Opinions | hot takes, agreeing/disagreeing, recommendations |
| 📖 Storytelling | past events, funny moments, dramatic retelling |
| 🧳 Travel | airports, hotels, directions, passport control, getting lost |
| 🩺 Health & body | symptoms, doctors, the gym, sleep, feeling run down |
| 💸 Money & shopping | prices, haggling, refunds, subscriptions, splitting bills |
| 🎯 Interviews & career | interviews, self-intros, salary talk, resigning, networking |
| 💥 Conflict & pushback | disagreeing, saying no, complaints, boundaries, hard feedback |
| 🫂 Feelings & venting | naming a mood, venting, comforting someone, asking for support |
| 🎤 Meetings & presenting | demos, interrupting politely, clarifying, wrapping up, Q&A |
| ☎️ Calls & admin | phone calls, customer service, banks, landlords, paperwork |
| 🍜 Food & eating out | ordering, allergies, complaints, recommending a place, home cooking |
| ❤️ Family & relationships | family news, partners, old friends, invitations, apologies |
| 🎓 Learning & self-study | courses, asking questions, explaining what you don’t get |
| 📱 Tech & gadgets | devices, apps, "it’s not working", bug reports, setup help |
| 📅 Plans & scheduling | proposing times, rescheduling, cancelling, running late, confirming |
