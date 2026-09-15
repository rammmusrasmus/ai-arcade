import { app, shell, type BrowserWindow } from "electron";
import { getApiUrl } from "./config.js";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

const debug = (...m: unknown[]) => console.error("[updater]", ...m);
debug("module loaded; autoUpdater is", typeof autoUpdater, "isPackaged", app.isPackaged);

/**
 * Run the updater even from an unpackaged build when AA_UPDATER_FORCE=1 (testing only;
 * needs a dev-app-update.yml next to the app). Packaged builds read the GitHub Releases
 * feed from the app-update.yml electron-builder embeds from package.json "publish".
 */
const forced = process.env.AA_UPDATER_FORCE === "1";

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; version?: string; percent?: number }
  | { state: "ready"; version: string }
  /** macOS: the app isn't code-signed, so it can't replace itself — the user downloads the new build. */
  | { state: "manual"; version: string }
  | { state: "error"; message: string }
  | { state: "unsupported" };

let last: UpdateState = { state: "idle" };
let downloadingVersion: string | undefined;
let getWindow: () => BrowserWindow | null = () => null;

/** Shown to users instead of electron-updater's raw HTTP/stack text (that goes to the log). */
/** Unsigned macOS apps can't self-install updates (Squirrel.Mac requires a signature). */
const manualUpdates = process.platform === "darwin";

const FRIENDLY_ERROR = "Couldn't check for updates right now. AI Arcade will try again later.";

function emit(next: UpdateState) {
  last = next;
  getWindow()?.webContents.send("update:status", next);
}

export function currentUpdateState(): UpdateState {
  return last;
}

export function initAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;

  // Auto-update only works for an installed (NSIS) build.
  if (!app.isPackaged && !forced) {
    debug("skipping: not packaged");
    emit({ state: "unsupported" });
    return;
  }

  autoUpdater.autoDownload = !manualUpdates;
  autoUpdater.forceDevUpdateConfig = forced;
  autoUpdater.autoInstallOnAppQuit = !manualUpdates;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    downloadingVersion = info.version;
    if (manualUpdates) emit({ state: "manual", version: info.version });
    else emit({ state: "downloading", version: info.version });
  });
  autoUpdater.on("update-not-available", () => emit({ state: "idle" }));
  autoUpdater.on("download-progress", (p) =>
    emit({ state: "downloading", version: downloadingVersion, percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    emit({ state: "ready", version: info.version }),
  );
  autoUpdater.on("error", (err) => {
    debug("updater error:", err instanceof Error ? err.stack : err);
    if (last.state !== "ready" && last.state !== "manual") emit({ state: "error", message: FRIENDLY_ERROR });
  });

  void checkForUpdates();
  // re-check every 6h while the app stays open
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000).unref?.();
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged && !forced) return { state: "unsupported" };
  // An update is already downloaded and waiting — a re-check would only hide the prompt.
  if (last.state === "ready" || last.state === "manual") return last;
  try {
    const r = await autoUpdater.checkForUpdates();
    debug("checkForUpdates resolved", r?.updateInfo?.version ?? "(none)");
  } catch (err) {
    debug("check failed:", err instanceof Error ? err.stack : err);
    emit({ state: "error", message: FRIENDLY_ERROR });
  }
  return last;
}

export function installUpdateNow(): void {
  if (last.state === "manual") {
    // the download page at the server root links the newest installer for this OS
    void shell.openExternal(getApiUrl() + "/");
    return;
  }
  if (last.state !== "ready") return;
  // Silent install (no installer wizard), then relaunch the updated app — one click, like Steam.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
