# Blurt

60-second English fluency reps. Built for a Vietnamese software developer who wants to think in English without translating.

## What it does

Each rep gives you a prompt — either a Vietnamese sentence to express in English, or a real situation to react to — and a timer. You blurt it out fast. Editing is cheating.

After you submit, Gemini shows you how a native speaker would say it, picks the most reusable phrase (a **chunk**), and gives you a short coaching note. Chunks enter a spaced-repetition drill schedule (1 → 3 → 7 → 14 → 30 → 60 days).

**For situation prompts**, the target chunk is shown upfront so you practice producing it on demand. The AI then checks if you used it, fixes grammar and unnatural phrasing, and shows a sample answer built around that chunk.

**For Vietnamese prompts**, you blurt freely — the AI picks the best chunk from its rewrite.

### Tabs

| Tab | What it does |
|-----|-------------|
| **Practice** | One rep with a timer. Pick mood categories, or generate an AI prompt. |
| **Random** | Five game modes (Shuffle, Burst, Boss, Wager, Capsule) that drill your saved chunks without touching the SRS schedule. |
| **Drill** | Spaced-repetition queue — due chunks only. Fill-in-the-blank from memory; type **or speak** your answer. Each review rotates through fresh AI-written example sentences (🔄 for a new one on demand) so you recall the chunk, not a memorised sentence. Grade a correct rep **Good** (next rung) or **Easy** (skip a rung). |
| **My chunks** | Everything you've stolen. Add manually, export/import as JSON. |
| **Stats** | 14-day rep bar chart, drill retention %, streak, nemesis chunks, and a weekly AI "mistake pattern" digest. |

### Other features

- **Streak system** — homework = 3 practice reps + all due drill chunks. Miss a day, streak resets.
- **Phone reminders** — daily ntfy.sh ping at a configurable hour, sent by the server.
- **Weekly recap** — automatic ntfy ping summarising your week's reps and worst chunk, plus an AI-spotted recurring mistake pattern (also shown in Stats).
- **Voice input** — Web Speech API mic button on supported browsers, in both Practice and Drill.
- **Text-to-speech** — hear the natural version read aloud.
- **Cross-device sync** — state and chunks sync to the server via a shared secret. Works offline from localStorage cache.

## Stack

- **Frontend** — single HTML file ([worker/public/index.html](worker/public/index.html)), no framework, no build step for the UI
- **Backend** — Cloudflare Worker + KV ([worker/src/index.js](worker/src/index.js))
- **AI** — Gemini 2.5 Flash, proxied through the Worker so the key never touches the browser
- **Notifications** — [ntfy.sh](https://ntfy.sh), topic stored as a server secret
- **Auth** — one shared `APP_SECRET`; same secret = same data, no accounts

## Project layout

```
worker/
  src/index.js        # Cloudflare Worker: KV store, Gemini proxy, ntfy proxy, cron
  public/index.html   # The entire frontend
  wrangler.toml       # Worker config, KV binding, cron trigger, static assets
server/
  server.js           # Optional Node.js/SQLite alternative backend (self-hosted)
```

## Deploy (Cloudflare)

**Prerequisites:** Node.js, a Cloudflare account, `wrangler` authenticated (`wrangler login`).

```bash
cd worker
npm install

# First time only — creates the KV namespace and prints its ID.
# Paste the ID into wrangler.toml under [[kv_namespaces]].
npm run kv:create

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

`wrangler dev` simulates KV locally. To test the cron handler:

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

Open the app, enter your `APP_SECRET`, and optionally set the server URL. The secret is stored in `localStorage` so subsequent visits skip the gate. The same secret on any device gives you access to the same data.

## Prompt categories

| Category | Examples |
|----------|---------|
| 💼 Work | standups, code reviews, estimates, slack messages |
| ☀️ Daily life | errands, food, weather, weekend plans |
| 💬 Small talk | greetings, compliments, polite exits |
| 🧠 Opinions | hot takes, agreeing/disagreeing, recommendations |
| 📖 Storytelling | past events, funny moments, dramatic retelling |
