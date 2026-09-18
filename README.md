# Blurt

60-second English fluency reps. Built for a Vietnamese software developer who wants to think in English without translating.

## What it does

Each rep gives you a prompt — either a Vietnamese sentence to express in English, or a real situation to react to — and a timer. You blurt it out fast. Editing is cheating.

After you submit, Gemini shows you how a native speaker would say it, picks the most reusable phrase (a **chunk**), and gives you a short coaching note. Chunks enter a spaced-repetition drill schedule (SM-2): each chunk keeps its own ease factor, the gap grows by that factor every time you recall it, and a miss sends it back to today.

**For situation prompts**, the target chunk is shown upfront so you practice producing it on demand. The AI then checks if you used it, fixes grammar and unnatural phrasing, and shows a sample answer built around that chunk.

**For Vietnamese prompts**, you blurt freely — the AI picks the best chunk from its rewrite.

### Tabs

| Tab | What it does |
|-----|-------------|
| **Practice** | One rep with a timer. Pick mood categories, or generate an AI prompt. |
| **Random** | Seven game modes (Shuffle, Burst, Boss, Wager, Capsule, Full sentence, Dictation) that drill your saved chunks without touching the SRS schedule. |
| **Drill** | Spaced-repetition queue — due chunks only. Fill-in-the-blank from memory; type **or speak** your answer. Each review rotates through fresh AI-written example sentences (🔄 for a new one on demand) so you recall the chunk, not a memorised sentence. Grade a correct rep **Hard**, **Good** or **Easy**; each button shows the next interval SM-2 will give it. A miss brings the chunk back today. |
| **My chunks** | Everything you've stolen. Add manually, export/import as JSON. |
| **Stats** | 14-day rep bar chart, drill retention %, streak, nemesis chunks, and a weekly AI "mistake pattern" digest. |

### Other features

- **Streak system** — homework = 3 practice reps + all due drill chunks. Miss a day, streak resets.
- **Phone reminders** — daily ntfy.sh ping at a configurable hour, sent by the server.
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
  migrations/         # D1 schema (documents + chunks)
  public/             # The frontend (index.html, app.js, styles.css) + prompt banks (*.json)
  gen_prompts.py      # Grows public/prompts.json with Gemini
  wrangler.toml       # Worker config, D1 + KV bindings, cron trigger, static assets
server/
  server.js           # Optional Node.js/SQLite alternative backend (self-hosted)
```

## Storage

Two tables, same shape in D1 and in the self-hosted SQLite twin:

| table | holds |
|---|---|
| `documents(key, value, updated_at)` | `blurt:state`, `blurt:aiPrompts` |
| `chunks(id, data, due, ord, updated_at)` | one row per chunk |

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
