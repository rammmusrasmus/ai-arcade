import { buildApp } from "./app.js";
import { env } from "./env.js";
import { attachMultiplayer } from "./multiplayer/index.js";
import type { MultiplayerRelay } from "./multiplayer/relay.js";

const app = await buildApp();
let relay: MultiplayerRelay | null = null;

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`AI Arcade API listening on http://${env.API_HOST}:${env.API_PORT}`);
  app.log.info(
    `auth: github=${env.githubEnabled ? "on" : "off"} devLogin=${
      env.DEV_LOGIN_ENABLED && !env.isProd ? "on" : "off"
    }`,
  );

  relay = attachMultiplayer(app.server);
  app.log.info(
    relay
      ? `multiplayer relay: ws ${env.mpPath} (advertised as ${env.publicWsUrl})`
      : "multiplayer relay: disabled",
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    Promise.allSettled([relay?.close(), app.close()]).then(() => process.exit(0));
  });
}
