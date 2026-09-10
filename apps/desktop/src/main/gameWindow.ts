import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { BrowserWindow, protocol, session, type Session } from "electron";
import { GAME_PROTOCOL, getWsUrl } from "./config.js";
import { gameDir, getInstalled, markPlayed } from "./library.js";

function relayOriginOf(wsUrl: string): string {
  try {
    return new URL(wsUrl).origin;
  } catch {
    return "";
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
};

/** Serves `aa-game://<gameId>/<path>` from that game's install directory. */
async function gameProtocolHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const gameId = url.hostname;
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";

  const root = normalize(gameDir(gameId));
  const filePath = normalize(join(root, rel));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const wiredSessions = new WeakSet<Session>();

/** Register the protocol handler on a session (idempotent per session). */
function wireGameProtocol(sess: Session): void {
  if (wiredSessions.has(sess)) return;
  try {
    sess.protocol.handle(GAME_PROTOCOL, gameProtocolHandler);
  } catch {
    // already registered on this session (e.g. relaunching the same game)
  }
  wiredSessions.add(sess);
}

/**
 * Register `aa-game://` on the default session. Call after `app.whenReady()`.
 * Each game window uses its own isolated session, which is wired lazily in
 * `launchGame` — a custom protocol on the default session is NOT visible to
 * other partitions.
 */
export function registerGameProtocol(): void {
  wireGameProtocol(session.defaultSession);
}

export const GAME_PROTOCOL_SCHEME = {
  scheme: GAME_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
};

/** Drop a dismissible banner into the game window listing blocked external URLs. */
function showBlockedNotice(win: BrowserWindow, urls: string[]): void {
  if (win.isDestroyed()) return;
  const payload = JSON.stringify(urls.slice(0, 12));
  const js = `(() => {
    const urls = ${payload};
    for (const u of urls) console.warn("AI Arcade blocked an external request:", u);
    let el = document.getElementById("__aa_blocked__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__aa_blocked__";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#2a1410;color:#ffb3a0;font:13px/1.4 system-ui,sans-serif;padding:10px 14px;border-top:1px solid #7a2a1f;box-shadow:0 -4px 16px rgba(0,0,0,.4)";
      (document.body || document.documentElement).appendChild(el);
    }
    el.innerHTML =
      "<b>" + urls.length + " external request" + (urls.length === 1 ? "" : "s") + " blocked.</b> " +
      "The desktop client allows no outside network access — bundle these files with the game. " +
      "<span style='opacity:.8'>" + urls.map(u => u.replace(/^https?:\\/\\//, "")).join(", ") + "</span> " +
      "<button onclick='this.parentNode.remove()' style='margin-left:8px;background:#7a2a1f;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer'>dismiss</button>";
  })();`;
  win.webContents.executeJavaScript(js).catch(() => undefined);
}

/** Open an installed game in an isolated, sandboxed window. */
export function launchGame(gameId: string): { ok: boolean; error?: string } {
  const installed = getInstalled(gameId);
  if (!installed) return { ok: false, error: "Game is not installed" };

  const wsUrl = getWsUrl();
  const relayOrigin = relayOriginOf(wsUrl);

  // A dedicated in-memory session with no shared cookies/storage.
  const gameSession = session.fromPartition(`game:${gameId}`);
  wireGameProtocol(gameSession);

  // Requests blocked by the egress filter — surfaced in the game window so a
  // silently-broken CDN/font load is not a mystery.
  const blocked = new Set<string>();
  let noticeTimer: NodeJS.Timeout | null = null;

  // Block all network egress except our own protocol and the multiplayer relay.
  gameSession.webRequest.onBeforeRequest((details, cb) => {
    let relayOk = false;
    if (relayOrigin && /^wss?:/.test(details.url)) {
      try {
        relayOk = new URL(details.url).origin === relayOrigin;
      } catch {
        relayOk = false;
      }
    }
    const allowed =
      relayOk ||
      details.url.startsWith(`${GAME_PROTOCOL}://`) ||
      details.url.startsWith("devtools://") ||
      details.url.startsWith("blob:") ||
      details.url.startsWith("data:");

    if (!allowed && /^https?:/i.test(details.url) && !blocked.has(details.url)) {
      blocked.add(details.url);
      console.warn(
        `[game:${installed.slug}] blocked external request (egress filter): ${details.url}`,
      );
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => showBlockedNotice(win, [...blocked]), 400);
    }
    cb({ cancel: !allowed });
  });

  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    title: installed.title,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      session: gameSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: true,
      preload: undefined,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  markPlayed(gameId);

  const qs = new URLSearchParams({ arcade_mp: wsUrl, arcade_game: installed.slug });
  const entry = installed.entryPath.replace(/^\/+/, "");
  void win.loadURL(`${GAME_PROTOCOL}://${gameId}/${entry}?${qs.toString()}`);
  return { ok: true };
}
