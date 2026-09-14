# Deploying the AI Arcade server (always-on)

AI Arcade is a desktop app; the server is only its backend. One container runs the API, the
multiplayer relay (`/mp`) and the stored game bundles — there is no website. All state lives
in `./data` (SQLite DB + uploaded bundles + images). Point a domain at a Linux server with
Docker and you're done. The domain is for HTTPS between the app and the server; nobody visits
it in a browser.

```
                   ┌──────────────── your server ────────────────┐
  desktop app ───────►  Caddy (HTTPS)  ──►  api :4000  ──►  ./data  (db + bundles + images)
  (REST + wss://…/mp) └─────────────────────────────────────────────┘
```

---

## 1. One-time server setup

Requirements: a Linux box with **Docker + the compose plugin**, ports **80 and 443** open,
and a **domain name** with an `A` record pointing at the server's IP. (No domain? A free
subdomain from [DuckDNS](https://www.duckdns.org) works — you just need a real hostname so
Caddy can get a TLS certificate.)

```bash
# on the server
git clone <your-repo> ai-arcade && cd ai-arcade      # or: scp the folder over
cp .env.production.example .env
nano .env                                            # fill in DOMAIN, AUTH_SECRET, ADMIN_EMAILS, SIGNUP_ALLOWED_EMAILS, PUBLIC_*, SMTP_*

# generate AUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d --build
```

**Email is required for anyone to sign in with a password.** Every register/login emails a
6-digit code as a second factor; without `SMTP_HOST` set, that code only reaches the API's
server console log, which real users never see. Fill in `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
`SMTP_PASS`/`SMTP_FROM` in `.env` with a real provider (Amazon SES, Postmark, SendGrid,
Mailgun, or your own mail server) before inviting anyone else.

Caddy fetches a Let's Encrypt certificate on first request (give it ~30s). Then:

> **No domain yet?** Smoke-test over plain HTTP first:
> `docker compose -f docker-compose.local.yml up -d --build` → `curl http://SERVER_IP:4000/health`.
> Don't leave that exposed publicly — password auth needs HTTPS.


- `https://games.example.com/health` — should return `{"ok":true}`
- In the desktop app, set **🌐 Server** to `https://games.example.com` and **Register** with
  the email from `ADMIN_EMAILS`. After confirming the emailed code, that account is an admin
  and sees the **Review** tab.

### Updating the server later

```bash
git pull && docker compose up -d --build
```

Or host it on Coolify (below), which redeploys on every push.

### Backups

Everything is in `./data`. `tar czf backup.tgz data` (stop the stack first, or use
`sqlite3 data/ai-arcade.db ".backup ..."` for a hot copy).

---

## 2. Point the desktop app at your server

The desktop app has a **🌐 Server** field where anyone can paste the URL. To ship builds
that connect with **no setup**, bake the URL in:

```bash
AI_ARCADE_API_URL=https://games.example.com npm run pack:desktop
```

New installs then default to your server; users can still override in-app.

---

## 3. Hosting on Coolify

Coolify builds from GitHub on the server and handles the proxy, HTTPS and redeploys on push,
so the Caddy compose stack above isn't needed.

- **Build pack:** Dockerfile (repo root). Don't use `docker-compose.yml` — its Caddy clashes
  with Coolify's proxy.
- **Port:** `4000` (healthcheck: `GET /health`).
- **Branch:** `main`.
- **Persistent volume:** mount one at `/data` (SQLite DB + uploads). Run **one** replica.
- **Env vars:** `AUTH_SECRET` (32+ chars) and `PUBLIC_API_URL` (the public `https://` URL)
  are required; set `ADMIN_EMAILS`, `CORS_ORIGINS=*` and `SMTP_*` too. Set
  `SIGNUP_ALLOWED_EMAILS` to limit who can create an account (empty = open signup). Don't set
  `DATABASE_URL` / `STORAGE_DIR` — the image already points them at `/data`.
- **WebSockets:** `/mp` holds long-lived connections — no short idle timeouts on it.
- **Uploads:** allow request bodies of ~80 MB (game bundles are up to 50 MB).

---

## 4. Desktop releases (GitHub Actions)

`.github/workflows/desktop-release.yml` runs when you push a `v*` tag: it builds Windows /
macOS / Linux installers and attaches them to a GitHub Release. Set the repository variable
`PUBLIC_API_URL` (Settings → Secrets and variables → Actions → Variables) to your public URL
so it's baked into the installers.

### Cutting a desktop release

```bash
git tag v0.2.0
git push --tags
```

The workflow builds all three platforms and publishes one release with the installers and
each platform's `latest*.yml`. Installed apps pick up the newest non-prerelease release on
their next launch and prompt "Update N downloaded — Restart & update" (Windows and Linux;
macOS auto-update needs a signed build). Tag versions must be higher than what's installed.

---

## Notes / limits

- **The multiplayer relay keeps lobbies in memory**, so run exactly **one** `app` instance.
  Horizontal scaling would need a Redis-backed relay (not built).
- **Storage is local disk.** Fine for one server; for lots of traffic move `apps/api/src/storage`
  to an S3-compatible driver.
- **Games must bundle all assets** — the desktop client blocks outside network access. The
  upload flow and moderation queue flag any external URLs.
- Unsigned desktop builds trigger SmartScreen / Gatekeeper. Code-sign for a smoother install.
