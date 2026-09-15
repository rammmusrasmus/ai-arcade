/** Baked in at build time from AI_ARCADE_API_URL (see electron.vite.config.ts). */
declare const __DEFAULT_API_URL__: string;
const BUILT_IN = typeof __DEFAULT_API_URL__ === "string" ? __DEFAULT_API_URL__ : "";

/**
 * API URL. Not user-configurable in the app (a stale saved override from older builds is ignored).
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

export function getApiUrl(): string {
  return stripSlash(DEFAULT_API_URL);
}

/** WebSocket relay URL: explicit env override, else derived from the API URL. */
export function getWsUrl(): string {
  if (process.env.AI_ARCADE_WS_URL) return process.env.AI_ARCADE_WS_URL;
  return toWs(getApiUrl());
}
