# AI Arcade

A **Steam-like desktop app for free games made with AI.** People install the app, sign in,
upload a game they built with Claude (or any other AI tool), and — once a moderator
approves it — it goes live in the store for everyone to install and play.

AI Arcade is an **installed app, not a website.** The server is only its backend: accounts,
the catalog, stored game bundles, login emails and the multiplayer relay — plus a one-page
download page at `/` (`docker/site/index.html`) so people can get the app. The platform
**hosts and distributes** games; it does not create them.

```
   ┌──────────────────────────┐   REST + bundle downloads   ┌─────────────────────┐
   │  Desktop app (Electron)  │ ──────────────────────────▶ │  API server         │
   │  store · library · play  │                             │  Fastify + SQLite   │
   │  upload · review · chat  │ ◀───── wss:// /mp relay ─── │  + local file store │
   └──────────────────────────┘                             └─────────────────────┘
```

## What's here

| Package | What it is |
| --- | --- |
| `apps/desktop` | The app — store, library, one-click install, each game in an isolated window, upload, moderation review (play a build before approving), friends and chat. |
| `apps/api` | The backend — accounts, submissions, moderation queue, bundle validation, file storage, catalog, multiplayer relay. SQLite via `@libsql/client` + Drizzle. |
| `packages/shared` | Zod schemas + a typed `ApiClient` used by the app. |

## Requirements

- **Node 20+** (developed on Node 24). That's it — no Docker, no database server, no Rust.
- The desktop app pulls Electron on first `npm install` (~200 MB download).

## Quick start

```bash
npm install
npm run build:shared
npm run db:migrate      # create the SQLite schema
npm run db:seed         # create the admin account (from ADMIN_EMAILS in .env)
npm run dev             # API on :4000 + the desktop app
```

Sign in from the app's account button. Locally, **dev login** is enabled — enter any email
and you're in. The email listed in `ADMIN_EMAILS` (`.env`) becomes an admin automatically,
so the app shows it the **Review** tab.

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
npm run pack:desktop            # bump patch version, build
npm run pack:desktop -- --keep-version
npm run pack:desktop -- --set-version 0.3.0
```

It runs `electron-vite build` → `electron-builder --win` (NSIS installer) → a portable
`.zip` fallback, and mirrors your own installed copy. It does **not** ship anything to other
people — they get installers and updates from GitHub Releases (below).

**Auto-update:** installed apps check the newest GitHub Release of this repo on launch and
every 6h (`apps/desktop/src/main/updater.ts`, via `electron-updater`). To ship an update,
push a version tag — the `desktop-release` workflow builds every platform and publishes the
release with its `latest*.yml` metadata:

```bash
git tag v0.2.0 && git push --tags
```

Friends then see an "Update N downloaded — Restart & update" bar on their next launch. Only
installed builds auto-update (Windows NSIS, Linux AppImage); the portable zip does not, and
macOS needs a signed build.

Building the NSIS installer on Windows needs **Developer Mode** on
(Settings → Privacy & security → For developers) or an elevated shell — electron-builder
unpacks a symlinked archive. Without it, `pack:desktop` still produces the portable zip.
macOS/Linux are unaffected.

The packaged app talks to `http://127.0.0.1:4000` by default. In-app, **🌐 Server** sets it
(persisted); or launch with `AI_ARCADE_API_URL` / `AI_ARCADE_WS_URL`.

## Configuration

Everything is in `.env` at the repo root (copied from `.env.example`). Key settings:

The full list is read in `apps/api/src/env.ts`. The API exits at boot if `AUTH_SECRET` is
missing or shorter than 32 chars, or a value has the wrong type. Everything else has a
default — including `PUBLIC_API_URL`, which silently falls back to localhost.

| Var | Meaning |
| --- | --- |
| `AUTH_SECRET` | **Required**, 32+ chars. Signs session cookies and OAuth state. |
| `PUBLIC_API_URL` | Public URL of the server. Used for image URLs, the advertised multiplayer URL and the GitHub callback. Default `http://127.0.0.1:4000`. |
| `CORS_ORIGINS` | Extra allowed origins, or `*`. Set `*` when deployed — the installed app loads its pages from local files, so its requests carry no normal origin. |
| `WEB_ORIGIN` | Not needed for the app. Only feeds the CORS allow-list and the (unused) GitHub OAuth redirect. |
| `PASSWORD_AUTH_ENABLED` | Email + password sign-in (default on). Every register and login needs a 6-digit code sent by email; password reset works the same way. This is the only sign-in the app supports. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Sends those codes. Without `SMTP_HOST` the code is only printed to the server log, so nobody else can sign in. |
| `SIGNUP_ALLOWED_EMAILS` | Comma-separated emails allowed to **create** an account; everyone else gets "Registration is closed." Empty = open signup. `ADMIN_EMAILS` are always allowed; existing accounts are unaffected. |
| `ADMIN_EMAILS` | Comma-separated emails that get the `admin` role on login. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub sign-in. It's a browser redirect flow the app doesn't use — leave unset. |
| `DEV_LOGIN_ENABLED` | Passwordless login for local testing. **Never enable in production** (it also returns 404 when `NODE_ENV=production`). |
| `MAX_BUNDLE_BYTES` / `MAX_UNZIPPED_BYTES` / `MAX_BUNDLE_FILES` | Per-upload limits (default 50 MB / 200 MB / 2000 files). There is no total storage cap. |
| `DATABASE_URL` | `file:./data/ai-arcade.db` by default. The Docker image sets `file:/data/ai-arcade.db`. |
| `STORAGE_DIR` | Uploaded bundles, extracted games and images. The Docker image sets `/data/storage`. |

## How a submission works

1. **Create a listing** (**＋ Upload game** in the app) — title, summary, tags, which AI tools
   were used, and the game folder or `.zip`.
2. **Upload a build** — a `.zip` with `index.html` at its root plus assets. The API
   rejects path traversal, executables, oversized/zip-bomb archives, and archives with no
   HTML entry point, then extracts it to validate it (extracted files are never served). It
   also scans the HTML/CSS for absolute `http(s)://` references and reports them (see below).
3. **Submit for review** — the game enters the moderation queue (`status: pending`).
4. **A moderator** opens the app's **Review** tab, can **▶ Play this build** (downloaded
   into a separate preview folder, never added to their Library), then approves / requests
   changes / rejects with a note to the author. Approving publishes it and sets the live
   version.
5. Uploading a **new build** to an already-live game creates a new pending version; the
   old one keeps serving until the new one is approved.

> **Bundle everything — no external requests.** The app blocks all network egress from games
> except the multiplayer relay, so a CDN `<script src>`, a Google Font `<link>`, or a remote
> `<img>` will fail even if it loads when you open the file yourself.
> Ship every script, stylesheet, font and image inside the zip. The upload response and the
> moderation queue list any external URLs a build references so this doesn't slip through.

## Playing / sandboxing

Games are only ever played inside the app, from a downloaded bundle — the server never serves
game files over HTTP. Each game runs in its own `BrowserWindow` with a private session,
`sandbox: true`, `contextIsolation: true`, no Node, no preload, and **all network egress
blocked** except the internal `aa-game://` file protocol and the multiplayer relay origin.
A blocked request is logged to the main process console **and** shown as a banner inside the
game window ("N external requests blocked …") — so a missing CDN asset is obvious, not a
silent half-broken render.

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
`docker-compose.yml` run the whole backend (API + relay + stored games) behind Caddy with
automatic HTTPS, state in `./data`. On a Coolify server, deploy the
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

What's in place:

- Passwords are scrypt-hashed; session tokens and login/reset codes are stored only as
  SHA-256 hashes. Every password sign-in and password reset needs an emailed code, and the
  reset endpoints answer identically for unknown emails.
- Uploaded games are never served over HTTP, so an unapproved build can't be loaded from the
  server's domain. Moderators and authors download a specific build into the app to test it.
- In-memory rate limits (per account, else per IP) on auth, game creation (30/h), bundle
  uploads (40/h), image uploads (80/h), friend requests and messages. They reset on restart,
  and in production the API trusts `X-Forwarded-For` — only expose it behind your proxy.
- Moderators/admins can unpublish a live game.
- `SIGNUP_ALLOWED_EMAILS` limits who can create an account.

Still open — know these before letting strangers sign up:

- **Anyone who can sign up can upload.** Uploads are stored on the server before review (they
  just aren't served or listed). Use `SIGNUP_ALLOWED_EMAILS` unless signup is meant to be open.
- **No aggregate storage cap and no cleanup.** Original zips, rejected/superseded versions and
  images are never deleted. Cap the volume at the infrastructure layer.
- No virus scanning of uploads, and no user report flow.
- Local-filesystem storage and SQLite are single-instance only; run one replica. Move to
  S3-compatible storage / Postgres for scale (`apps/api/src/storage` is the seam).

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | API + desktop app together |
| `npm run dev:api` / `dev:desktop` | one at a time |
| `npm run db:migrate` / `db:seed` / `db:seed:demo` / `db:reset` | database |
| `npm run build` | build every package |
| `npm run typecheck` | type-check every package |
| `npm run db:generate` (in `apps/api`) | regenerate SQL migrations after editing `schema.ts` |
