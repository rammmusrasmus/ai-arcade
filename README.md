# AI Arcade

A **Steam-like platform for free games made with AI.** People sign in, upload a game
they built with Claude (or any other AI tool), and — once a moderator approves it — it
goes live in a store that anyone can browse, play in the browser, or install through a
desktop client.

The platform **hosts and distributes** games. It does not create them. All content comes
from user submissions.

```
                 ┌──────────────┐        ┌──────────────┐
   submit  ─────▶│   Web app    │        │   Desktop    │────▶ install / launch
   & review      │ (React+Vite) │        │  (Electron)  │      games locally
                 └──────┬───────┘        └──────┬───────┘
                        │        REST + files   │
                        └───────────┬───────────┘
                              ┌─────▼─────┐
                              │    API    │  Fastify + SQLite + local file storage
                              └───────────┘
```

## What's here

| Package | What it is |
| --- | --- |
| `apps/api` | Fastify API — accounts, submissions, moderation queue, bundle validation, file storage, catalog. SQLite via `@libsql/client` + Drizzle. |
| `apps/web` | The website — browse/search the store, play in a sandboxed iframe, submit & manage your games, moderator review panel. |
| `apps/desktop` | Electron "launcher" — store, library, one-click install (downloads + unpacks the bundle), launches each game in an isolated window. |
| `packages/shared` | Zod schemas + a typed `ApiClient` shared by web and desktop. |

## Requirements

- **Node 20+** (developed on Node 24). That's it — no Docker, no database server, no Rust.
- The desktop app pulls Electron on first `npm install` (~200 MB download).

## Quick start

```bash
npm install
npm run build:shared
npm run db:migrate      # create the SQLite schema
npm run db:seed         # create the admin account (from ADMIN_EMAILS in .env)
npm run dev             # API on :4000, web on :5173
```

Open http://127.0.0.1:5173 and sign in. Locally, **dev login** is enabled — enter any
email and you're in. The email listed in `ADMIN_EMAILS` (`.env`) becomes a moderator/admin
automatically, so it can see the review queue at `/moderation`.

The store starts **empty**. To populate it with a few placeholder listings while you work:

```bash
npm run db:seed:demo    # adds sample listings incl. one pending review + one external
```

`npm run db:reset` deletes the SQLite file so you can start over.

### Desktop client

```bash
npm run dev:desktop     # needs the API running (npm run dev:api)
```

**Package a downloadable build** — one command from the repo root:

```bash
npm run pack:desktop            # bump patch version, build, publish the update feed
npm run pack:desktop -- --keep-version
npm run pack:desktop -- --set-version 0.3.0
```

It runs `electron-vite build` → `electron-builder --win` (NSIS installer + `latest.yml`) →
a portable `.zip` fallback, then copies everything into the API's served folders
(`/files/downloads/…` and `/files/updates/…`) and mirrors your own installed copy.

**Auto-update:** the app checks `<its configured Server URL>/files/updates/latest.yml` on
launch and every 6h (`apps/desktop/src/main/updater.ts`, via `electron-updater`). Once a
friend has installed `AI-Arcade-Setup-*.exe` once, every `pack:desktop` you run reaches
them on their next relaunch — they see an "Update N downloaded — Restart & update" bar.
Only installed (NSIS) builds auto-update; the portable zip does not.

Building the NSIS installer on Windows needs **Developer Mode** on
(Settings → Privacy & security → For developers) or an elevated shell — electron-builder
unpacks a symlinked archive. Without it, `pack:desktop` still produces the portable zip but
skips the update feed. macOS/Linux are unaffected.

The packaged app talks to `http://127.0.0.1:4000` by default. In-app, **🌐 Server** sets it
(persisted); or launch with `AI_ARCADE_API_URL` / `AI_ARCADE_WS_URL`.

## Configuration

Everything is in `.env` at the repo root (copied from `.env.example`). Key settings:

| Var | Meaning |
| --- | --- |
| `ADMIN_EMAILS` | Comma-separated emails that get the `admin` role on login. |
| `DEV_LOGIN_ENABLED` | Passwordless email login. **Local only — never enable in production.** |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Enables "Continue with GitHub". Callback URL: `<PUBLIC_API_URL>/auth/github/callback`. |
| `MAX_BUNDLE_BYTES` / `MAX_UNZIPPED_BYTES` / `MAX_BUNDLE_FILES` | Upload limits (default 50 MB / 200 MB / 2000 files). |
| `DATABASE_URL` | `file:./data/ai-arcade.db` by default. A libSQL/Turso URL works too. |
| `STORAGE_DIR` | Where uploaded bundles + extracted games + images live. |

## How a submission works

1. **Create a listing** (`/submit`) — title, summary, tags, which AI tools were used, and
   whether it's an uploaded HTML build or a link to a game hosted elsewhere.
2. **Upload a build** — a `.zip` with `index.html` at its root plus assets. The API
   rejects path traversal, executables, oversized/zip-bomb archives, and archives with no
   HTML entry point, then extracts it. It also scans the HTML/CSS for absolute `http(s)://`
   references and reports them (see below).
3. **Submit for review** — the game enters the moderation queue (`status: pending`).
4. **A moderator** approves / requests changes / rejects at `/moderation`, with a note to
   the author. Approving publishes it and sets the live version.
5. Uploading a **new build** to an already-live game creates a new pending version; the
   old one keeps serving until the new one is approved.

> **Bundle everything — no external requests.** The desktop client blocks all network
> egress except the multiplayer relay, so a CDN `<script src>`, a Google Font `<link>`, or a
> remote `<img>` will silently fail there even though it loads fine in the browser player.
> Ship every script, stylesheet, font and image inside the zip. The upload response and the
> moderation queue list any external URLs a build references so this doesn't slip through.

## Playing / sandboxing

- **Web:** the game loads in `<iframe sandbox="allow-scripts …">` (no `allow-same-origin`),
  and the API serves every game document with `Content-Security-Policy: sandbox`. Both give
  the game an **opaque origin**, so it can't read the site's cookies or call the API as you.
  In dev, game files are proxied through Vite so the frame is same-origin-clean.
- **Desktop:** each game runs in its own `BrowserWindow` with a private session,
  `sandbox: true`, `contextIsolation: true`, no Node, no preload, and **all network egress
  blocked** except the internal `aa-game://` file protocol and the multiplayer relay origin.
  A blocked request is logged to the main process console **and** shown as a banner inside
  the game window ("N external requests blocked …") — so a missing CDN asset is obvious, not
  a silent half-broken render.

## Playing with a friend on another network

Everything defaults to `127.0.0.1`, which only your machine can reach. To let a friend
connect, the API+relay needs a public address and both apps need to point at it.

**Quickest (your PC stays the host):**

```bash
npm run share            # exposes the API on a public URL via a tunnel
```

It starts the API bound to `0.0.0.0` with `CORS_ORIGINS=*`, spins up a tunnel
(`cloudflared` if installed — `winget install --id Cloudflare.cloudflared` — otherwise
`npx localtunnel`), wires the tunnel URL into `PUBLIC_API_URL` / `PUBLIC_WS_URL`, and prints
the URL to send your friend. Keep the window open; Ctrl+C tears it all down.

Your friend then, in the **desktop app**, clicks **🌐 Server → Save & reconnect** and pastes
that URL. One field — the multiplayer relay is the same URL (`/mp` path), handled
automatically. The app persists it, so they only do this once.

Already have a public URL or a deployed server? `npm run share --url https://your-host`
just runs the API against it, or skip the script and set `PUBLIC_API_URL` / `PUBLIC_WS_URL` /
`CORS_ORIGINS` / `API_HOST=0.0.0.0` in `.env` yourself.

**Always-on (a real hosted service):** see **[docs/deploy.md](docs/deploy.md)**. One
`docker compose up -d` on any Linux box with a domain — the included `Dockerfile` +
`docker-compose.yml` run the whole thing (API + relay + web + game files + update feed)
behind Caddy with automatic HTTPS, state in `./data`. On a Coolify server, deploy the
`Dockerfile` directly instead (see the doc). A GitHub Actions workflow builds the desktop
installers on tags.

Once your friend's app points at your server, the flow is the same as local: they sign in,
**Store → Install** your game, **Library → Play**, and **Play online** connects them to
lobbies on your relay.

## Multiplayer (lockstep relay)

For deterministic games (same seed + same ordered inputs → identical match), the API runs a
**dumb WebSocket relay + lobby** at `ws://<host>/mp`. It never simulates or validates the
game — it runs the lobby, deals the match (`seed`, `races`, `humans`, `slot`), and forwards
`ord` / `hash` frames verbatim to the *other* players. Accepts `Origin: null` (sandboxed
frames), sets `TCP_NODELAY`, and `peerLeft` always carries the dropped `slot`.

Games are handed the relay URL as `?arcade_mp=<wsUrl>` on their URL and via a `postMessage`
(`{type:'arcade:mp', url}`). Full wire protocol + the ~10-line client change in
[docs/multiplayer.md](docs/multiplayer.md). `GET /mp/status` for a health check.

## Security notes (before you deploy this for real)

- Serve game bundles from a **separate origin/subdomain** (e.g. `games.example.com`) in
  production for defense-in-depth, in addition to the sandbox headers.
- Swap `DEV_LOGIN_ENABLED` off and configure GitHub OAuth (or another real provider).
- The local-filesystem storage driver is fine for one box; move to S3-compatible object
  storage + a CDN for scale (the `Storage` interface in `apps/api/src/storage` is the seam).
- Add virus/lint scanning of uploads, rate limiting, and a report/takedown flow.
- Consider Postgres instead of SQLite once you have real traffic.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | API + web together |
| `npm run dev:api` / `dev:web` / `dev:desktop` | one at a time |
| `npm run db:migrate` / `db:seed` / `db:seed:demo` / `db:reset` | database |
| `npm run build` | build every package |
| `npm run typecheck` | type-check every package |
| `npm run db:generate` (in `apps/api`) | regenerate SQL migrations after editing `schema.ts` |
