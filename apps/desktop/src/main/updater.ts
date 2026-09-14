import { app, type BrowserWindow } from "electron";
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
  | { state: "error"; message: string }
  | { state: "unsupported" };

let last: UpdateState = { state: "idle" };
let downloadingVersion: string | undefined;
let getWindow: () => BrowserWindow | null = () => null;

/** Shown to users instead of electron-updater's raw HTTP/stack text (that goes to the log). */
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

  autoUpdater.autoDownload = true;
  autoUpdater.forceDevUpdateConfig = forced;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    downloadingVersion = info.version;
    emit({ state: "downloading", version: info.version });
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
    if (last.state !== "ready") emit({ state: "error", message: FRIENDLY_ERROR });
  });

  void checkForUpdates();
  // re-check every 6h while the app stays open
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000).unref?.();
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged && !forced) return { state: "unsupported" };
  // An update is already downloaded and waiting — a re-check would only hide the prompt.
  if (last.state === "ready") return last;
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
  if (last.state !== "ready") return;
  // Silent install (no installer wizard), then relaunch the updated app — one click, like Steam.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
