import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { getRelay } from "../multiplayer/index.js";

export async function multiplayerRoutes(app: FastifyInstance) {
  app.get("/mp/status", async () => {
    const relay = getRelay();
    return {
      enabled: env.MULTIPLAYER_ENABLED,
      path: env.mpPath,
      url: env.publicWsUrl,
      ...(relay ? relay.stats : { peers: 0, lobbies: 0, matches: 0 }),
    };
  });
}
