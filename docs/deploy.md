# Deploying AI Arcade (always-on)

One container runs everything: the API, the multiplayer relay (`/mp`), the web app,
game files, and the desktop auto-update feed. All state lives in `./data` (SQLite DB +
uploaded bundles + images). Point a domain at a Linux server with Docker and you're done.

```
                        ┌──────────── your server ────────────┐
  players / uploaders ──►  Caddy (HTTPS)  ──►  app :4000  ──►  ./data  (db + game files)
  desktop app ──────────►  wss://…/mp (same box, same port)
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
nano .env                                            # fill in DOMAIN, AUTH_SECRET, ADMIN_EMAILS, PUBLIC_*

# generate AUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d --build
```

Caddy fetches a Let's Encrypt certificate on first request (give it ~30s). Then:

> **No domain yet?** Smoke-test over plain HTTP first:
> `docker compose -f docker-compose.local.yml up -d --build` → `curl http://SERVER_IP:4000/health`.
> Don't leave that exposed publicly — password auth needs HTTPS.


- `https://games.example.com` — the web app (browse, register, upload, play)
- `https://games.example.com/health` — should return `{"ok":true}`
- The account whose email is in `ADMIN_EMAILS` is an admin — it gets the **Review** tab and
  `/moderation` to approve submissions.

**Set a password on your admin account:** register/sign in at `/login`, then `/profile` →
"Set a password" (dev-login is off in production).

### Updating the server later

```bash
git pull && docker compose up -d --build
```

Or wire up CI (below) and it redeploys on every push.

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

## 3. GitHub Actions (auto deploy + auto builds)

Two workflows are included:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | push to `main` touching the server | builds the Docker image → `ghcr.io/OWNER/REPO` → SSHes in and `docker compose pull && up -d` |
| `.github/workflows/desktop-release.yml` | push a `v*` tag | builds Windows / macOS / Linux installers, attaches them to a GitHub Release, and uploads each platform's update feed to `./data/storage/public/updates/` so installed apps auto-update |

### Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `DEPLOY_SSH_HOST` | server IP / hostname |
| `DEPLOY_SSH_USER` | ssh user (must be able to run `docker`) |
| `DEPLOY_SSH_KEY` | that user's **private** SSH key |
| `DEPLOY_SSH_PORT` | ssh port (omit for 22) |
| `DEPLOY_PATH` | absolute path to the `ai-arcade` folder on the server, e.g. `/opt/ai-arcade` |

### Repository variable

| Variable | Value |
| --- | --- |
| `PUBLIC_API_URL` | `https://games.example.com` — baked into the desktop installers |

### First-time server prep for CI image pulls

The compose file builds locally by default. To pull the CI-built image instead, edit
`docker-compose.yml` on the server:

```yaml
  app:
    # build: .
    image: ghcr.io/OWNER/REPO:latest
```

and make sure the server can pull it (public package, or `docker login ghcr.io` once with a
PAT). The deploy workflow logs in for you each run.

### Cutting a desktop release

```bash
git tag v0.2.0
git push --tags
```

The workflow builds all three platforms. Windows/macOS/Linux each publish their own
`latest*.yml` — electron-updater on each user's machine picks the right one and prompts
"Update N downloaded — Restart & update".

---

## Notes / limits

- **The multiplayer relay keeps lobbies in memory**, so run exactly **one** `app` instance.
  Horizontal scaling would need a Redis-backed relay (not built).
- **Storage is local disk.** Fine for one server; for lots of traffic move `apps/api/src/storage`
  to an S3-compatible driver.
- **Games must bundle all assets** — the desktop client blocks outside network access. The
  upload flow and moderation queue flag any external URLs.
- Unsigned desktop builds trigger SmartScreen / Gatekeeper. Code-sign for a smoother install.
