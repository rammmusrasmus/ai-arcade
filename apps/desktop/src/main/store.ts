import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

interface Persisted {
  token?: string | null;
  /** Server URL override set by the user in the app's settings. */
  serverUrl?: string | null;
}

const dir = () => {
  const d = app.getPath("userData");
  mkdirSync(d, { recursive: true });
  return d;
};

const file = () => join(dir(), "arcade-store.json");

function read(): Persisted {
  try {
    if (!existsSync(file())) return {};
    return JSON.parse(readFileSync(file(), "utf8")) as Persisted;
  } catch {
    return {};
  }
}

function write(data: Persisted) {
  writeFileSync(file(), JSON.stringify(data, null, 2), "utf8");
}

export const store = {
  getToken(): string | null {
    return read().token ?? null;
  },
  setToken(token: string | null) {
    const data = read();
    data.token = token;
    write(data);
  },
  getServerUrl(): string | null {
    const v = read().serverUrl;
    return v && v.trim() ? v.trim().replace(/\/+$/, "") : null;
  },
  setServerUrl(url: string | null) {
    const data = read();
    data.serverUrl = url && url.trim() ? url.trim().replace(/\/+$/, "") : null;
    // Switching servers invalidates the session token.
    data.token = null;
    write(data);
  },
};
