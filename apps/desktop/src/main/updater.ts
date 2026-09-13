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
let getWindow: () => BrowserWindow | null = () => null;

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
  autoUpdater.on("update-available", (info) =>
    emit({ state: "downloading", version: info.version }),
  );
  autoUpdater.on("update-not-available", () => emit({ state: "idle" }));
  autoUpdater.on("download-progress", (p) =>
    emit({ state: "downloading", percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    emit({ state: "ready", version: info.version }),
  );
  autoUpdater.on("error", (err) =>
    emit({ state: "error", message: err?.message ?? String(err) }),
  );

  void checkForUpdates();
  // re-check every 6h while the app stays open
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000).unref?.();
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged && !forced) return { state: "unsupported" };
  try {
    const r = await autoUpdater.checkForUpdates();
    debug("checkForUpdates resolved", r?.updateInfo?.version ?? "(none)");
  } catch (err) {
    debug("check failed:", err instanceof Error ? err.stack : err);
    emit({ state: "error", message: err instanceof Error ? err.message : String(err) });
  }
  return last;
}

export function installUpdateNow(): void {
  if (last.state !== "ready") return;
  setImmediate(() => autoUpdater.quitAndInstall());
}
