import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { getApiUrl, getWsUrl } from "./config.js";
import { readGameZip, zipGameFolder, type GameBundle } from "./bundle.js";
import {
  installGame,
  listLibrary,
  uninstallGame,
  type InstalledGame,
} from "./library.js";
import {
  GAME_PROTOCOL_SCHEME,
  launchGame,
  previewBuild,
  registerGameProtocol,
} from "./gameWindow.js";
import { store } from "./store.js";
import {
  checkForUpdates,
  currentUpdateState,
  initAutoUpdater,
  installUpdateNow,
} from "./updater.js";

protocol.registerSchemesAsPrivileged([GAME_PROTOCOL_SCHEME]);

let mainWindow: BrowserWindow | null = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0b12",
    autoHideMenuBar: true,
    title: "AI Arcade",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function notifyLibraryChanged() {
  mainWindow?.webContents.send("library:changed", listLibrary());
}

/* ---------------- IPC ---------------- */

ipcMain.handle("config:get", () => ({
  apiUrl: getApiUrl(),
  wsUrl: getWsUrl(),
  appVersion: app.getVersion(),
}));

ipcMain.handle("auth:getToken", () => store.getToken());
ipcMain.handle("auth:setToken", (_e, token: string | null) => {
  store.setToken(token && token.length > 0 ? token : null);
  return true;
});

ipcMain.handle("library:list", (): InstalledGame[] => listLibrary());

ipcMain.handle("library:install", async (_e, gameId: string) => {
  const entry = await installGame(gameId);
  notifyLibraryChanged();
  return entry;
});

ipcMain.handle("library:uninstall", (_e, gameId: string) => {
  uninstallGame(gameId);
  notifyLibraryChanged();
  return true;
});

ipcMain.handle("library:launch", (_e, gameId: string) => launchGame(gameId));
ipcMain.handle("library:preview", (_e, gameId: string, versionId: string, title: string) =>
  previewBuild(gameId, versionId, title),
);

ipcMain.handle("shell:openExternal", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
});

ipcMain.handle("update:get", () => currentUpdateState());
ipcMain.handle("update:check", () => checkForUpdates());
ipcMain.handle("update:install", () => installUpdateNow());

/* ---- picking a game bundle to upload ---- */

function serializeBundle(b: GameBundle) {
  return {
    zipBase64: b.buffer.toString("base64"),
    sizeBytes: b.buffer.length,
    files: b.files,
    externalRefs: b.externalRefs,
    hasEntry: b.hasEntry,
  };
}

function openDialog(options: Electron.OpenDialogOptions) {
  return mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

ipcMain.handle("upload:pickFolder", async () => {
  const r = await openDialog({
    title: "Choose your game folder",
    properties: ["openDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    return { source: r.filePaths[0], ...serializeBundle(zipGameFolder(r.filePaths[0])) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read that folder" };
  }
});

ipcMain.handle("upload:pickZip", async () => {
  const r = await openDialog({
    title: "Choose your game .zip",
    properties: ["openFile"],
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    return { source: r.filePaths[0], ...serializeBundle(readGameZip(r.filePaths[0])) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read that zip" };
  }
});

/* ---------------- lifecycle ---------------- */

app.whenReady().then(() => {
  registerGameProtocol();
  createMainWindow();
  initAutoUpdater(() => mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
