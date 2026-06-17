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

The Worker also **hosts the app itself**: `npm run build` copies
`../blurt-standalone.html` into `public/index.html` (this runs automatically
before `dev`/`deploy`), and `[assets]` in `wrangler.toml` serves it at `/`.
Static assets are served first; only `/api/*` invokes the Worker — so the app
and its API share one origin (no CORS, one URL to bookmark).

Just open your Worker URL on any device:

```
https://blurt.<subdomain>.workers.dev/
```

In **Settings → 🔐 Log in & sync** the server field is pre-filled with the
current origin, so you only type your secret and click **Log in**. With no
secret entered the app still works fully offline (built-in sample answers, no
reminders).

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
