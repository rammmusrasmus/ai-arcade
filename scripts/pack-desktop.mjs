#!/usr/bin/env node
/**
 * Rebuild the desktop app and publish it for auto-update.
 *
 *   node scripts/pack-desktop.mjs               # bump patch version, build, publish
 *   node scripts/pack-desktop.mjs --keep-version
 *   node scripts/pack-desktop.mjs --set-version 0.3.0
 *
 * Produces (in apps/desktop/release):
 *   - AI-Arcade-Setup-<ver>.exe            NSIS installer (what friends install)
 *   - latest.yml + *.blockmap              electron-updater feed metadata
 *   - AI-Arcade-<ver>-win-x64.zip          portable fallback (no auto-update)
 *
 * and copies:
 *   - latest.yml / Setup .exe / .blockmap  -> apps/api/data/storage/public/updates/
 *   - the portable zip                     -> apps/api/data/storage/public/downloads/
 *   - win-unpacked                         -> %LOCALAPPDATA%\Programs\AI Arcade
 *
 * The running app fetches <its Server URL>/files/updates/latest.yml on launch, so
 * once your friend has installed AI-Arcade-Setup-*.exe once, every `pack:desktop`
 * you run reaches them on their next relaunch.
 *
 * NOTE: building the NSIS installer on Windows needs **Developer Mode ON**
 * (Settings -> Privacy & security -> For developers) or an elevated terminal —
 * electron-builder unpacks a symlinked archive. Without it, this script still
 * produces the portable zip but cannot publish an update feed.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(repo, "apps", "desktop");
const pkgPath = join(desktop, "package.json");
const release = join(desktop, "release");
const unpacked = join(release, "win-unpacked");

const updatesDir = join(repo, "apps", "api", "data", "storage", "public", "updates");
const downloadsDir = join(repo, "apps", "api", "data", "storage", "public", "downloads");
const installedDir = join(process.env.LOCALAPPDATA ?? "", "Programs", "AI Arcade");

const args = process.argv.slice(2);
const setVersion = args.includes("--set-version") ? args[args.indexOf("--set-version") + 1] : null;
const keepVersion = args.includes("--keep-version");

/* ---------- 0. version ---------- */
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (setVersion) {
  pkg.version = setVersion;
} else if (!keepVersion) {
  const [a, b, c] = pkg.version.split(".").map(Number);
  pkg.version = `${a}.${b}.${(c ?? 0) + 1}`;
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
const version = pkg.version;
console.log(`\nBuilding AI Arcade desktop v${version}\n`);

function step(label, cmd, cmdArgs, opts = {}) {
  console.log(`=== ${label} ===`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: true, cwd: desktop, ...opts });
  return r.status ?? 0;
}

/**
 * electron-builder needs the winCodeSign toolset, whose archive contains macOS
 * symlinks that 7-Zip can't create on Windows without SeCreateSymbolicLinkPrivilege
 * (Developer Mode). Pre-extract it once with `-snl` (store links as plain files) —
 * the darwin/* entries it skips are irrelevant to a Windows build.
 */
function ensureWinCodeSign() {
  const cache = join(process.env.LOCALAPPDATA ?? "", "electron-builder", "Cache", "winCodeSign");
  const stable = join(cache, "winCodeSign-2.6.0");
  if (existsSync(join(stable, "windows-10", "x64", "signtool.exe"))) return;

  console.log("=== pre-seeding winCodeSign cache (Developer Mode workaround) ===");
  const sevenZip = join(repo, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  const archive = join(cache, "winCodeSign-2.6.0.7z");
  mkdirSync(cache, { recursive: true });
  if (!existsSync(archive)) {
    step(
      "download winCodeSign",
      "curl",
      [
        "-sL",
        "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z",
        "-o",
        `"${archive}"`,
      ],
      { cwd: repo },
    );
  }
  mkdirSync(stable, { recursive: true });
  // exit code 2 is expected (2 skipped darwin symlinks); ignore it.
  spawnSync(sevenZip, ["x", "-y", "-bd", "-snl", `"${archive}"`, `-o"${stable}"`], {
    stdio: "ignore",
    shell: true,
    cwd: repo,
  });
  if (!existsSync(join(stable, "windows-10", "x64", "signtool.exe"))) {
    console.error("winCodeSign pre-seed failed — NSIS build will not work.");
  }
}

/* ---------- 1. bundle ---------- */
if (step("electron-vite build", "npx", ["electron-vite", "build"]) !== 0) {
  console.error("bundle failed — aborting.");
  process.exit(1);
}

/* ---------- 2. NSIS installer + update feed ---------- */
ensureWinCodeSign();

const setupExe = join(release, `AI-Arcade-Setup-${version}.exe`);
const latestYml = join(release, "latest.yml");
rmSync(setupExe, { force: true });
rmSync(latestYml, { force: true });

step("electron-builder --win (nsis)", "npx", ["electron-builder", "--win", "--config.win.target=nsis"], {
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});

const haveInstaller = existsSync(setupExe) && existsSync(latestYml);

/* ---------- 3. portable --dir + zip (fallback / dev's own copy) ---------- */
if (!existsSync(join(unpacked, "AI Arcade.exe"))) {
  step("electron-builder --dir (portable)", "npx", ["electron-builder", "--win", "--dir", "-c.win.sign=null"], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
}
if (!existsSync(join(unpacked, "AI Arcade.exe"))) {
  console.error("win-unpacked/AI Arcade.exe missing — build produced nothing usable.");
  process.exit(1);
}

const zipPath = join(release, `AI-Arcade-${version}-win-x64.zip`);
rmSync(zipPath, { force: true });
step("zip win-unpacked", "powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -Path '${join(unpacked, "*")}' -DestinationPath '${zipPath}' -Force`,
], { cwd: repo });

/* ---------- 4. publish into the API's served folders ---------- */
mkdirSync(downloadsDir, { recursive: true });
copyFileSync(zipPath, join(downloadsDir, "AI-Arcade-win-x64.zip"));

if (haveInstaller) {
  mkdirSync(updatesDir, { recursive: true });
  for (const f of ["latest.yml", `AI-Arcade-Setup-${version}.exe`, `AI-Arcade-Setup-${version}.exe.blockmap`]) {
    const src = join(release, f);
    if (existsSync(src)) copyFileSync(src, join(updatesDir, f));
  }
  copyFileSync(setupExe, join(downloadsDir, "AI-Arcade-Setup.exe"));
  console.log(`\n✓ update feed published -> ${updatesDir}`);
  console.log(`  friends on an older version auto-update on next launch.`);
} else {
  console.log(`\n⚠ NSIS installer was NOT produced (likely Windows symlink privilege).`);
  console.log(`  Auto-update feed NOT published. Portable zip is still updated.`);
  console.log(`  Fix: enable Developer Mode (Settings > Privacy & security > For developers)`);
  console.log(`  or run this from an elevated terminal, then re-run.`);
}

/* ---------- 5. refresh the dev's installed copy ---------- */
if (process.env.LOCALAPPDATA) {
  // The installed app locks its own files; close it (and its helpers) first.
  spawnSync("taskkill", ["/F", "/IM", "AI Arcade.exe", "/T"], { stdio: "ignore", shell: true });
  spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Seconds 2"], { stdio: "ignore", shell: true });

  mkdirSync(installedDir, { recursive: true });
  // /R:1 /W:1 so a stray lock can't turn into a multi-minute retry storm.
  step("robocopy -> installed app", "robocopy", [
    `"${unpacked}"`, `"${installedDir}"`, "/MIR", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
  ], { cwd: repo, allowFail: true });
}

console.log(`\nDone. v${version}`);
console.log(`  portable zip : ${zipPath}`);
console.log(`               : /files/downloads/AI-Arcade-win-x64.zip`);
if (haveInstaller) {
  console.log(`  installer    : ${setupExe}`);
  console.log(`               : /files/downloads/AI-Arcade-Setup.exe`);
  console.log(`  update feed  : /files/updates/latest.yml`);
}
