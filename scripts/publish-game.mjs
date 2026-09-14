#!/usr/bin/env node
/**
 * Zip a local game folder and publish it as a new version on AI Arcade.
 *
 *   node scripts/publish-game.mjs <slug> <folder> [options]
 *   node scripts/publish-game.mjs castle-fight ../castlefight -m "unit balance pass"
 *
 * Options
 *   -m, --message <text>   changelog for this version
 *   --files a b c          only include these files (relative to <folder>, flat)
 *   --entry <file>         HTML entry file inside the bundle (default: index.html)
 *   --api <url>            API base URL (default $AI_ARCADE_API_URL or http://127.0.0.1:4000)
 *   --as <email>           dev-login as this email (default: first ADMIN_EMAILS, else
 *                          rasmusbrethvadd@gmail.com) — local servers only
 *   --token <bearer>       use a bearer token instead of dev-login (for a deployed server)
 *   --no-approve           upload + submit but leave it pending for review
 *   --dry                  build the zip and print what would happen, upload nothing
 *
 * Files skipped by default (dev-only): lobby.js, serve.js, *.zip, *.md, dotfiles,
 * node_modules. The desktop client blocks all outside network access, so make sure
 * every script / font / image the game needs is in the folder — the script prints
 * any external URLs it finds.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AdmZip = require(join(repo, "node_modules", "adm-zip"));

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const positional = [];
const opt = { approve: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-m" || a === "--message") opt.message = argv[++i];
  else if (a === "--entry") opt.entry = argv[++i];
  else if (a === "--api") opt.api = argv[++i];
  else if (a === "--as") opt.as = argv[++i];
  else if (a === "--token") opt.token = argv[++i];
  else if (a === "--no-approve") opt.approve = false;
  else if (a === "--dry") opt.dry = true;
  else if (a === "--files") {
    opt.files = [];
    while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) opt.files.push(argv[++i]);
  } else positional.push(a);
}
const [slug, folderArg] = positional;
if (!slug || !folderArg) {
  console.error("usage: node scripts/publish-game.mjs <slug> <folder> [-m msg] [--no-approve]");
  process.exit(1);
}
const folder = resolve(process.cwd(), folderArg);
const api = (opt.api || process.env.AI_ARCADE_API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");

/* ---------- read admin email from .env if needed ---------- */
function adminEmail() {
  if (opt.as) return opt.as;
  try {
    const env = readFileSync(join(repo, ".env"), "utf8");
    const m = env.match(/^ADMIN_EMAILS=(.+)$/m);
    if (m && m[1].trim()) return m[1].split(",")[0].trim();
  } catch {
    /* ignore */
  }
  return "rasmusbrethvadd@gmail.com";
}

/* ---------- build the zip (flat) ---------- */
const SKIP = [/^\./, /^node_modules$/i, /\.zip$/i, /\.md$/i, /^lobby\.js$/i, /^serve\.(js|mjs|cjs)$/i, /^thumbs\.db$/i];
function pickFiles() {
  if (opt.files) return opt.files;
  return readdirSync(folder).filter((name) => {
    if (!statSync(join(folder, name)).isFile()) return false;
    return !SKIP.some((re) => re.test(name));
  });
}

const files = pickFiles();
const entry = opt.entry || "index.html";
if (!files.includes(entry)) {
  console.error(`entry "${entry}" is not in the file list: ${files.join(", ")}`);
  process.exit(1);
}

const zip = new AdmZip();
let external = [];
for (const name of files) {
  const buf = readFileSync(join(folder, name));
  zip.addFile(basename(name), buf); // basename => flat, no directories
  if (/\.(html?|css)$/i.test(name)) {
    external.push(...(buf.toString("utf8").match(/https?:\/\/[^\s"'<>)]+/g) || []));
  }
}
external = [...new Set(external)];
const buffer = zip.toBuffer();

console.log(`\nBundle for "${slug}" from ${folder}`);
console.log(`  ${files.length} file(s): ${files.join(", ")}`);
console.log(`  ${(buffer.length / 1024).toFixed(0)} KB zipped · entry ${entry}`);
if (external.length) {
  console.log(`\n  ⚠ ${external.length} external URL(s) referenced in HTML/CSS — these will NOT`);
  console.log(`    load in the desktop client (it blocks outside network access):`);
  for (const u of external) console.log(`      ${u}`);
  console.log("");
}

if (opt.dry) {
  console.log("--dry: nothing uploaded.");
  process.exit(0);
}

/* ---------- publish ---------- */
const j = async (res) => {
  const t = await res.text();
  const b = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(b?.error ?? b)}`);
  return b;
};

async function getToken() {
  if (opt.token) return opt.token;
  const email = adminEmail();
  console.log(`signing in (dev-login) as ${email} …`);
  const r = await j(
    await fetch(`${api}/auth/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  return r.token;
}

const token = await getToken();
const auth = { authorization: `Bearer ${token}`, "x-client": "cli" };

const form = new FormData();
form.set("meta", JSON.stringify({ changelog: opt.message || "", entryPath: entry }));
form.set("bundle", new Blob([buffer], { type: "application/zip" }), `${slug}.zip`);

console.log("uploading new version …");
const version = await j(await fetch(`${api}/games/${slug}/versions`, { method: "POST", headers: auth, body: form }));
console.log(`  v${version.version} uploaded (status: ${version.status}) · ${version.fileCount} files · sha ${version.sha256.slice(0, 12)}`);
if (version.externalRefs?.length) {
  console.log(`  ⚠ server also flagged ${version.externalRefs.length} external URL(s)`);
}

await j(
  await fetch(`${api}/games/${slug}/submit`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ note: opt.message || "" }),
  }),
).catch((e) => console.log(`  (submit: ${e.message})`));

if (opt.approve) {
  const g = await j(
    await fetch(`${api}/moderation/games/${slug}/decide`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", note: opt.message || "published via cli" }),
    }),
  );
  console.log(`\n✓ live: ${g.title} v${g.currentVersion.version}`);
  console.log(`  players: Library → Update to v${g.currentVersion.version}`);
} else {
  console.log(`\n✓ submitted for review (pending). Approve it in the desktop app's Review tab.`);
}
