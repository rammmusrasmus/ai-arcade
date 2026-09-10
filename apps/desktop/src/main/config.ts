import { store } from "./store.js";

/** Baked in at build time from AI_ARCADE_API_URL (see electron.vite.config.ts). */
declare const __DEFAULT_API_URL__: string;
const BUILT_IN = typeof __DEFAULT_API_URL__ === "string" ? __DEFAULT_API_URL__ : "";

/**
 * Fallback API URL when the user hasn't set one in the app.
 *   1. runtime env (AI_ARCADE_API_URL / VITE_API_URL) — for local runs
 *   2. the URL baked into this build
 *   3. localhost, for dev
 */
const DEFAULT_API_URL =
  process.env.VITE_API_URL ||
  process.env.AI_ARCADE_API_URL ||
  BUILT_IN ||
  "http://127.0.0.1:4000";

export const GAME_PROTOCOL = "aa-game";

const stripSlash = (u: string) => u.replace(/\/+$/, "");
const toWs = (u: string) => stripSlash(u).replace(/^http(s?):\/\//, "ws$1://") + "/mp";

/**
 * Resolution order:
 *   1. user setting saved in the app  (store.serverUrl)
 *   2. runtime env / build-time default
 *   3. http://127.0.0.1:4000
 */
export function getApiUrl(): string {
  return stripSlash(store.getServerUrl() ?? DEFAULT_API_URL);
}

/** WebSocket relay URL: explicit env override, else derived from the API URL. */
export function getWsUrl(): string {
  if (process.env.AI_ARCADE_WS_URL) return process.env.AI_ARCADE_WS_URL;
  return toWs(getApiUrl());
}

export const isDefaultServer = () => store.getServerUrl() === null;
