# Blurt sync server (local Node)

The local-dev twin of the Cloudflare Worker in `../worker`: a **single-user**
backend on Node + Express + SQLite. Handy for running on your own machine/LAN;
the Worker is the easier choice for phone access (public HTTPS URL).

You set **one secret** (`APP_SECRET`). Typing it into the app logs you in and
loads the same data on any device. No accounts, no sign-up. It also proxies
Gemini and ntfy so those keys stay server-side.

## Run it

```bash
cd server
npm install        # builds better-sqlite3 (native) — needs a C toolchain

APP_SECRET='pick-a-long-random-secret' \
GEMINI_KEY='AIza...'        \  # optional -> AI feedback
NTFY_TOPIC='your-topic'     \  # optional -> phone reminders
npm start                      # http://localhost:8787, creates blurt.db
```

Other env overrides: `PORT` (default 8787), `BLURT_DB` (SQLite path),
`GEMINI_MODEL` (default `gemini-2.5-flash`). If `APP_SECRET` is unset every
`/api` request returns 401.

For your phone, use the laptop's LAN address (e.g. `http://192.168.1.5:8787`,
same Wi-Fi) in the app's server-URL field.

## Use it

In the app → **Settings → 🔐 Log in & sync**: enter the server URL and your
secret, click **Log in**. With no secret the app still works fully offline.

## API

Every route requires `Authorization: Bearer <APP_SECRET>`.

| Method | Path           | Body                          | Purpose                             |
|--------|----------------|-------------------------------|-------------------------------------|
| GET    | `/api/login`   | —                             | Validate the secret → `{ ok: true }`|
| GET    | `/api/kv/:key` | —                             | Read a document → `{ value }`       |
| PUT    | `/api/kv/:key` | `{ value }`                   | Upsert a document (last-write-wins) |
| POST   | `/api/ai`      | `{ model?, body }`            | Proxy a Gemini generateContent call |
| POST   | `/api/notify`  | `{ title?, message, delay? }` | Proxy an ntfy notification          |

Sync is last-write-wins per document, pulled on login.
