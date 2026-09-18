# Blurt Worker (Cloudflare)

The main backend: a **single-user** Cloudflare Worker backed by **D1**, deployed
to a public `https://…workers.dev` URL your phone can reach. It also hosts the
app itself.

You set **one secret** (`APP_SECRET`). Typing it into the app logs you in on any
device and loads the same data. No accounts, no sign-up. The Worker also
**proxies Gemini and ntfy**, so those keys live as Worker secrets and never reach
the browser.

## Deploy

```bash
cd worker
npm install
npx wrangler login                   # one-time, free Cloudflare account

npm run db:create                    # paste the printed database_id into wrangler.toml
npm run db:migrate                   # apply migrations/ to the remote D1 database
npx wrangler secret put APP_SECRET   # your login secret (pick a long random one)

# optional — enable the proxied features:
npx wrangler secret put GEMINI_KEY   # Google AI Studio key -> AI feedback
npx wrangler secret put NTFY_TOPIC   # your ntfy topic      -> phone reminders

npm run deploy                       # prints https://blurt.<subdomain>.workers.dev
```

A `GEMINI_MODEL` var overrides the default `gemini-2.5-flash`.

KV (`BLURT_KV`) is still bound for two small TTL counters: the login throttle and
the "already reminded today" marker. `npm run kv:create` is only needed on a
fresh Cloudflare account.

## Local dev

```bash
echo 'APP_SECRET=dev-secret' > .dev.vars   # plus GEMINI_KEY / NTFY_TOPIC if you want
npm run db:migrate:local                   # once: create the tables in local D1
npm run dev                                # http://localhost:8787
```

To fire the hourly reminder cron by hand:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

## How the app is served

Everything in `public/` is a static asset served by `[assets]` in
`wrangler.toml`: `index.html` (markup), `app.js` (all app logic), `styles.css`,
and the three prompt banks. There is no build step; edit the files directly.
Static assets are matched first and only `/api/*` runs the Worker, so the app and
its API share one origin (no CORS, one URL to bookmark).

In **Settings → 🔐 Log in & sync** the server field is pre-filled with the
current origin, so you only type your secret.

The app is **online-only**. There is no local copy of your data: state and chunks
load from D1 on boot, writes are queued and flushed in batches with retry, and
the header shows "Saving…" / "Not saved" until the server confirms. If the first
load fails, the app shows an error and refuses to write rather than overwrite
your data with an empty state.

## Storage

Schema lives in `migrations/`. Three tables:

| table | holds |
|---|---|
| `documents(key, value, updated_at)` | JSON blobs: `blurt:state`, `blurt:aiPrompts` |
| `chunks(id, data, due, ord, updated_at)` | one row per saved chunk |
| `attempts(id, d, source, kind, prompt, blurt, fix, natural, note, tags, clean, conf, pred, created_at)` | everything you've written, kept for good |

`ord` is the chunk's creation position, so the bank loads in the same order on
every device. Editing a chunk never changes it.

`attempts` is the proof layer: one row per answer you write (`source` is
`practice`, `three`, `replay`, and later `chat`, `write`, `free`…). `clean` is 1
when the answer needed no meaningful fix, 0 when it had one, and NULL when it was
never graded (AI down, or a freewrite you didn't send for review). `tags` holds
comma-joined error types for the stats (`article`, `tense`, `preposition`,
`word-order`, `word-choice`, `plural`, `missing-word`, `calque`). The app loads
the last 90 days on boot for the clean rate, error bars and replays.

**Adding a table means a migration.** After pulling a new file in `migrations/`,
run `npm run db:migrate` (remote) before `npm run deploy`, and
`npm run db:migrate:local` for local dev.

D1 free-plan limits shape bulk writes: at most 100 bound parameters per
statement and 50 statements per invocation. `upsertChunks()` packs 20 rows per
statement and caps a request at 500 rows; attempts have 14 columns, so 7 rows per
statement and 175 per request. Larger requests get `413`.

The Worker imports any pre-D1 KV data on the first `GET /api/chunks`, in pages,
then marks itself done. No manual migration step.

## Prompt banks

Three static JSON files in `public/`, loaded on boot. They're the same for
everyone, so they're plain assets, not rows in D1. To change a bank, edit the
file and redeploy.

| file | entries | kind |
|---|---|---|
| `prompts.json` | 1579 | `vn` (Vietnamese sentence to say in English) and `sit` (English situation to react to) |
| `reflexes.json` | 525 | `reflex` (a movie-style moment; reply with one snappy line) |
| `expressions.json` | 619 | `expr` (a fixed pattern to fill for a new scenario) |

Each entry:

```json
{ "cat": "work", "kind": "vn", "text": "...", "sample": "...", "chunk": "...", "note": "..." }
```

- `cat`: one of the 18 category ids in `CATS` in `app.js` (`work`, `daily`,
  `social`, `opinion`, `story`, `travel`, `health`, `money`, `career`,
  `conflict`, `feelings`, `meeting`, `admin`, `food`, `family`, `learning`,
  `tech`, `plans`).
- `sample` / `chunk` / `note`: the native phrasing, the reusable phrase to
  steal, and a short coaching line.
- `chunk` must appear in `sample` so Drill can blank it. Pattern gaps (`___`,
  `+`, `/`, `…`) split it into segments, and straight and curly apostrophes
  count as the same.

If a bank fails to load, a small inline fallback in `app.js` keeps practice
working.

**Growing `prompts.json`**: `gen_prompts.py` asks Gemini for new prompts in
batches, validates the schema (including that the chunk can be blanked), dedupes
and appends:

```bash
GEMINI_KEY=... python3 worker/gen_prompts.py 2000 20   # target count, batch size
```

Its `CATS` list must match `app.js`.

**AI prompts**: the ✨ button in Practice generates a fresh prompt through
`/api/ai`, biased toward chunks due for review (or ones you keep avoiding).
Generated prompts are saved to the `blurt:aiPrompts` document (last 200) and
join the practice pool on every device.

## API

Every route requires `Authorization: Bearer <APP_SECRET>`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/login` | — | Validate the secret → `{ ok: true }` (10 failures / 10 min per IP → `429`) |
| GET | `/api/doc/:key` | — | Read a document → `{ value, updated_at }` |
| PUT | `/api/doc/:key` | `{ value }` | Upsert a document (last-write-wins) |
| DELETE | `/api/doc/:key` | — | Delete a document |
| GET | `/api/chunks` | — | The whole chunk bank → `{ chunks }` |
| PUT | `/api/chunks` | `{ chunks: [...] }` | Batch upsert chunks by `id` (≤ 500) |
| DELETE | `/api/chunks/:id` | — | Delete one chunk |
| POST | `/api/attempts` | `{ attempts: [...] }` | Batch upsert attempts by `id` (≤ 175). A repeat `id` updates only the grading fields (`fix`, `natural`, `note`, `tags`, `clean`, `conf`, `pred`) |
| GET | `/api/attempts` | — | Newest first → `{ attempts }`. Filters: `since=YYYY-MM-DD`, `before=<created_at>`, `q=<text>` (searches blurt/fix/prompt), `clean=1`, `source=<s>`, `limit` (default 50, or 5000 with `since`) |
| POST | `/api/ai` | `{ model?, body }` | Proxy a Gemini `generateContent` call |
| POST | `/api/notify` | `{ title?, message, delay? }` | Proxy an ntfy notification |

Keys starting with `_` are reserved for internal markers and rejected.

## Reminders

A cron trigger runs at the top of every hour. It sends the daily ntfy ping only
when the hour matches the reminder time saved in your state, and only once a
day. The ping names a real due chunk (`WHERE due <= today`).

## Notes

- The secret is compared in constant time. Pick a long, random value; the
  `workers.dev` URL is HTTPS by default.
- Backup: `npx wrangler d1 export blurt --remote --output backup.sql`.
