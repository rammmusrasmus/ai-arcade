#!/usr/bin/env node
/**
 * Run the AI Arcade API + relay locally and expose it on a public URL so a
 * friend on another network can reach it.
 *
 *   node scripts/share.mjs                 # auto: cloudflared if installed, else localtunnel
 *   node scripts/share.mjs --lt            # force npx localtunnel
 *   node scripts/share.mjs --url <URL>     # you already have a public URL / deployed server
 *
 * Whatever URL ends up public is fed to the API as PUBLIC_API_URL / PUBLIC_WS_URL
 * so the games it serves point their multiplayer at the right place.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const forcedUrl = valueOf("--url");
const forceLt = args.includes("--lt");
const PORT = Number(process.env.API_PORT || 4000);

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function log(...m) {
  console.log("[share]", ...m);
}

function hasBinary(bin) {
  const probe = spawn(process.platform === "win32" ? "where" : "which", [bin], {
    stdio: "ignore",
    shell: false,
  });
  return once(probe, "close").then(([code]) => code === 0).catch(() => false);
}

/** Start a tunnel child process and resolve with { url, child }. */
function startTunnel(kind) {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    let cmd, cmdArgs, re, useShell;
    if (kind === "cloudflared") {
      cmd = "cloudflared";
      cmdArgs = ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"];
      re = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
      useShell = win; // resolve cloudflared / cloudflared.exe on PATH
    } else {
      cmd = "npx";
      cmdArgs = ["--yes", "localtunnel", "--port", String(PORT)];
      re = /https:\/\/[a-z0-9-]+\.loca\.lt/i;
      useShell = win; // spawning npx.cmd directly throws EINVAL on Windows
    }
    log(`starting tunnel: ${cmd} ${cmdArgs.join(" ")}`);
    const child = spawn(cmd, cmdArgs, { shell: useShell });
    let settled = false;
    const scan = (buf) => {
      const s = buf.toString();
      process.stdout.write(s.replace(/^/gm, `  ${kind}| `));
      const m = s.match(re);
      if (m && !settled) {
        settled = true;
        resolve({ url: m[0], child });
      }
    };
    child.stdout.on("data", scan);
    child.stderr.on("data", scan);
    child.on("close", (code) => {
      if (!settled) reject(new Error(`${kind} exited (code ${code}) before giving a URL`));
    });
    setTimeout(() => {
      if (!settled) reject(new Error(`${kind} did not produce a URL within 40s`));
    }, 40_000);
  });
}

async function main() {
  let publicUrl = forcedUrl;
  let tunnel = null;

  if (!publicUrl) {
    const kind = !forceLt && (await hasBinary("cloudflared")) ? "cloudflared" : "localtunnel";
    if (kind === "localtunnel") {
      log("cloudflared not found — using localtunnel (npx). For a nicer URL & no");
      log("interstitial page: winget install --id Cloudflare.cloudflared");
    }
    tunnel = await startTunnel(kind);
    publicUrl = tunnel.url;
  }

  publicUrl = publicUrl.replace(/\/+$/, "");
  const wsUrl = publicUrl.replace(/^http(s?):\/\//, "ws$1://") + "/mp";

  const apiEnv = {
    ...process.env,
    API_HOST: "0.0.0.0",
    API_PORT: String(PORT),
    PUBLIC_API_URL: publicUrl,
    PUBLIC_WS_URL: wsUrl,
    CORS_ORIGINS: "*",
  };

  log("building shared package…");
  await run("npm", ["run", "build:shared"], {});

  log("starting API bound to 0.0.0.0 with public URL", publicUrl);
  // Run the server directly (not `tsx watch`) — the watcher is unnecessary for
  // sharing and has been flaky on Windows after heavy process churn.
  const api = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: fileURLToPath(new URL("../apps/api", import.meta.url)),
    env: apiEnv,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  const banner = `
============================================================
  AI Arcade is live for friends.

  Send your friend this URL:

      ${publicUrl}

  They paste it into the desktop app:  Server → Save & reconnect
  (or launch with  AI_ARCADE_API_URL=${publicUrl} )

  Multiplayer relay:  ${wsUrl}   (same URL, handled automatically)

  Keep this window open. Ctrl+C stops the server and the tunnel.
============================================================
`;
  setTimeout(() => process.stdout.write(banner), 2500);

  const shutdown = () => {
    api.kill();
    tunnel?.child.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  api.on("close", shutdown);
}

function run(cmd, cmdArgs, opts) {
  const c = spawn(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  return once(c, "close").then(([code]) => {
    if (code !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} failed (${code})`);
  });
}

main().catch((err) => {
  console.error("[share] " + err.message);
  process.exit(1);
});
