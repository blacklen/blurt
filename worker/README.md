# Blurt sync Worker (Cloudflare)

A **single-user** sync backend as a Cloudflare Worker backed by Workers KV, so it
deploys to a public `https://…workers.dev` URL your phone can reach.

You set **one secret** (`APP_SECRET`). Typing it into the app logs you in on any
device and loads the same data. No accounts, no sign-up. The Worker also
**proxies Gemini and ntfy**, so those keys live as Worker secrets and never reach
the browser.

## Deploy

```bash
cd worker
npm install
npx wrangler login                  # one-time, free Cloudflare account

npm run kv:create                   # paste the printed id into wrangler.toml
npx wrangler secret put APP_SECRET   # your login secret (pick a long random one)

# optional — enable the proxied features:
npx wrangler secret put GEMINI_KEY   # Google AI Studio key -> AI feedback
npx wrangler secret put NTFY_TOPIC   # your ntfy topic      -> phone reminders

npm run deploy                       # prints https://blurt.<subdomain>.workers.dev
```

(Optional: a `GEMINI_MODEL` var overrides the default `gemini-2.5-flash`.)

## Local dev (no Cloudflare account)

```bash
echo 'APP_SECRET=dev-secret' > .dev.vars   # plus GEMINI_KEY / NTFY_TOPIC if you want
npm run dev                                # http://localhost:8787, simulated local KV
```

## Use it

The Worker also **hosts the app itself**: everything in `public/` is a static
asset — `index.html` (the whole app) and `prompts.json` (the practice bank) — and
`[assets]` in `wrangler.toml` serves it at `/`. There is no build step; you edit
`public/index.html` directly. Static assets are served first; only `/api/*`
invokes the Worker — so the app and its API share one origin (no CORS, one URL to
bookmark).

Just open your Worker URL on any device:

```
https://blurt.<subdomain>.workers.dev/
```

In **Settings → 🔐 Log in & sync** the server field is pre-filled with the
current origin, so you only type your secret and click **Log in**. With no
secret entered the app still works fully offline (built-in sample answers, no
reminders).

## Prompt bank

Practice prompts come from a **hybrid bank**: a curated static core plus fresh
AI-generated prompts, so you get reliable quality *and* enough novelty that you
never just memorize the answers.

**1. Static core — `public/prompts.json`**
The ~100 curated prompts live in a static JSON asset (served from the same origin
as the app, like `index.html`). It is *not* in KV: the bank is identical for
everyone and never changes per user, so it belongs in a static file, not the
per-user store. To grow the bank, edit `prompts.json` — no redeploy of code, no
DB write. Each entry:

```json
{ "cat": "work", "kind": "vn", "text": "...", "sample": "...", "chunk": "...", "note": "..." }
```

- `cat` — one of `work | daily | social | opinion | story` (the category chips).
- `kind` — `vn` (a Vietnamese sentence to say in English) or `sit` (an English
  situation to react to).
- `sample` / `chunk` / `note` — the native phrasing, the one reusable phrase to
  steal, and a short coaching line.

**2. Loading & offline** (`loadPrompts()` in `index.html`)
On boot the app hydrates `PROMPTS` from `localStorage['blurt:prompts']`
instantly (so it works offline), then refreshes from `/prompts.json` in the
background and re-caches. If both miss (cold first visit, no network), a small
inline fallback array baked into `index.html` keeps every category playable.

**3. AI top-up** (`genPrompt()`)
When logged in, ~1 in 3 reps (`AI_MIX = 0.33`) is generated live via the Gemini
proxy (`POST /api/ai`) instead of drawn from the bank; the ✨ button forces one on
demand. Any failure or offline state falls straight back to the bank, so a rep
never stalls. Generation is **chunk-aware**: it biases the prompt toward a chunk
that is *due for review today* (falling back to your most-missed chunks), so a
practice rep doubles as spaced-repetition review of phrases you've saved.

**4. Caching generated prompts**
Successful AI prompts are appended to `localStorage['blurt:aiPrompts']` (capped at
200) and folded back into the practice pool, so they add lasting variety and keep
working offline after the first generation.

Selection avoids recently-shown prompts (a short rolling history) so you cycle
through your chosen categories before any prompt repeats.

## API

Every route requires `Authorization: Bearer <APP_SECRET>`.

| Method | Path           | Body                          | Purpose                             |
|--------|----------------|-------------------------------|-------------------------------------|
| GET    | `/api/login`   | —                             | Validate the secret → `{ ok: true }`|
| GET    | `/api/kv/:key` | —                             | Read a document → `{ value }`       |
| PUT    | `/api/kv/:key` | `{ value }`                   | Upsert a document (last-write-wins) |
| POST   | `/api/ai`      | `{ model?, body }`            | Proxy a Gemini generateContent call |
| POST   | `/api/notify`  | `{ title?, message, delay? }` | Proxy an ntfy notification          |

## Notes & limits

- **KV is eventually consistent**: a save on one device can take a few seconds to
  appear on another. Fine for personal use.
- Sync is last-write-wins per document, pulled on login.
- The secret is compared directly; pick a long, high-entropy value and serve only
  over HTTPS (the `workers.dev` URL is HTTPS by default).
