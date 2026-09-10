import type { Server as HttpServer } from "node:http";
import { resolveUserByToken } from "../auth/index.js";
import { env } from "../env.js";
import { MultiplayerRelay } from "./relay.js";

let relay: MultiplayerRelay | null = null;

/** Attach the lockstep relay to the running HTTP server. Call after listen(). */
export function attachMultiplayer(server: HttpServer): MultiplayerRelay | null {
  if (!env.MULTIPLAYER_ENABLED) return null;
  relay = new MultiplayerRelay(server, {
    path: env.mpPath,
    maxLobbies: env.MP_MAX_LOBBIES,
    resolveUser: async (token) => {
      const user = await resolveUserByToken(token);
      return user ? { displayName: user.displayName } : null;
    },
  });
  return relay;
}

export function getRelay(): MultiplayerRelay | null {
  return relay;
}
