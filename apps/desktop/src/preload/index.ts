import { contextBridge, ipcRenderer } from "electron";

export interface InstalledGame {
  gameId: string;
  slug: string;
  title: string;
  version: number;
  entryPath: string;
  sha256: string;
  sizeBytes: number;
  installedAt: string;
  lastPlayedAt: string | null;
}

interface ServerConfig {
  apiUrl: string;
  wsUrl: string;
  appVersion: string;
}

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; version?: string; percent?: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }
  | { state: "unsupported" };

export interface PickedBundle {
  source?: string;
  zipBase64?: string;
  sizeBytes?: number;
  files?: string[];
  externalRefs?: string[];
  hasEntry?: boolean;
  error?: string;
}

const arcade = {
  getConfig: (): Promise<ServerConfig> => ipcRenderer.invoke("config:get"),

  getToken: (): Promise<string | null> => ipcRenderer.invoke("auth:getToken"),
  setToken: (token: string | null): Promise<boolean> =>
    ipcRenderer.invoke("auth:setToken", token),

  listLibrary: (): Promise<InstalledGame[]> => ipcRenderer.invoke("library:list"),
  install: (gameId: string): Promise<InstalledGame> =>
    ipcRenderer.invoke("library:install", gameId),
  uninstall: (gameId: string): Promise<boolean> =>
    ipcRenderer.invoke("library:uninstall", gameId),
  launch: (gameId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("library:launch", gameId),
  /** Play an unreleased version (moderators / the author) without adding it to the Library. */
  previewBuild: (gameId: string, versionId: string, title: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("library:preview", gameId, versionId, title),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),

  onLibraryChanged: (cb: (games: InstalledGame[]) => void): (() => void) => {
    const listener = (_e: unknown, games: InstalledGame[]) => cb(games);
    ipcRenderer.on("library:changed", listener);
    return () => ipcRenderer.removeListener("library:changed", listener);
  },

  /* ---- upload a game ---- */
  pickGameFolder: (): Promise<PickedBundle | null> => ipcRenderer.invoke("upload:pickFolder"),
  pickGameZip: (): Promise<PickedBundle | null> => ipcRenderer.invoke("upload:pickZip"),

  /* ---- auto-update ---- */
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke("update:get"),
  checkForUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("update:check"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (cb: (s: UpdateState) => void): (() => void) => {
    const listener = (_e: unknown, s: UpdateState) => cb(s);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
};

contextBridge.exposeInMainWorld("arcade", arcade);

export type ArcadeApi = typeof arcade;
