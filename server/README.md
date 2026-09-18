# Blurt server (self-hosted Node)

A twin of the Cloudflare Worker in `../worker`: the same **single-user** backend
on Node + Express + SQLite (`better-sqlite3`), with the same routes and the same
two tables. Handy for running on your own machine or LAN. The Worker is the
easier choice for phone access (public HTTPS URL).

You set **one secret** (`APP_SECRET`). Typing it into the app logs you in and
loads the same data on any device. No accounts, no sign-up. It also proxies
Gemini and ntfy so those keys stay server-side, and serves the app itself from
`../worker/public`.

## Run it

```bash
cd server
npm install        # builds better-sqlite3 (native) — needs a C toolchain

APP_SECRET='pick-a-long-random-secret' \
GEMINI_KEY='AIza...' \
NTFY_TOPIC='your-topic' \
npm start          # http://localhost:8787, creates blurt.db
```

`GEMINI_KEY` (AI feedback) and `NTFY_TOPIC` (phone reminders) are optional.
Other env overrides: `PORT` (default 8787), `BLURT_DB` (SQLite path),
`GEMINI_MODEL` (default `gemini-2.5-flash`). If `APP_SECRET` is unset every
`/api` request returns 401.

The tables are created on startup; there is no migration step.

For your phone, open the laptop's LAN address (e.g. `http://192.168.1.5:8787`,
same Wi-Fi).

## Use it

Open the server URL, go to **Settings → 🔐 Log in & sync**, enter your secret and
click **Log in**. The app is online-only: all data lives in `blurt.db`, and
nothing is saved while the server is unreachable.

## Storage

| table | holds |
|---|---|
| `documents(key, value, updated_at)` | JSON blobs: `blurt:state`, `blurt:aiPrompts` |
| `chunks(id, data, due, ord, updated_at)` | one row per saved chunk |

Back up by copying `blurt.db` while the server is stopped.

## API

Every route requires `Authorization: Bearer <APP_SECRET>`. Same as the Worker.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/login` | — | Validate the secret → `{ ok: true }` |
| GET | `/api/doc/:key` | — | Read a document → `{ value, updated_at }` |
| PUT | `/api/doc/:key` | `{ value }` | Upsert a document (last-write-wins) |
| DELETE | `/api/doc/:key` | — | Delete a document |
| GET | `/api/chunks` | — | The whole chunk bank → `{ chunks }` |
| PUT | `/api/chunks` | `{ chunks: [...] }` | Batch upsert chunks by `id` |
| DELETE | `/api/chunks/:id` | — | Delete one chunk |
| POST | `/api/ai` | `{ model?, body }` | Proxy a Gemini `generateContent` call |
| POST | `/api/notify` | `{ title?, message, delay? }` | Proxy an ntfy notification |

## Reminders

Every 5 minutes the server checks whether it's your reminder hour (from the
ntfy settings in your state) and sends the daily ping once, naming a real due
chunk from the `chunks` table.
