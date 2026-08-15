import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createDb, createListenClient } from "@hypertracker/db";
import Fastify from "fastify";
import { env } from "./env.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { coinsRoutes } from "./modules/coins/routes.js";
import { eventsRoutes } from "./modules/events/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { RealtimeHub } from "./modules/realtime/hub.js";
import { realtimeRoutes } from "./modules/realtime/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { subscriptionRoutes } from "./modules/subscription/routes.js";
import { watchedWalletsRoutes } from "./modules/watched-wallets/routes.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
  });

  const db = createDb(env.DATABASE_URL);
  const listenClient = createListenClient(env.DATABASE_URL);
  const hub = new RealtimeHub(db, listenClient, app.log);
  await hub.start();
  app.addHook("onClose", () => {
    hub.stop();
  });

  await app.register(cors);
  await app.register(websocket);
  await app.register(healthRoutes);
  await app.register((instance) => {
    authRoutes(instance, db);
  });
  await app.register((instance) => {
    watchedWalletsRoutes(instance, db);
  });
  await app.register((instance) => {
    settingsRoutes(instance, db);
  });
  await app.register((instance) => {
    coinsRoutes(instance, db);
  });
  await app.register((instance) => {
    eventsRoutes(instance, db);
  });
  await app.register((instance) => {
    subscriptionRoutes(instance, db);
  });
  await app.register((instance) => {
    realtimeRoutes(instance, hub);
  });
  // Own encapsulated context: admin auth is cookie-based, so its CORS must allow credentials
  // for one specific allowlisted origin — unlike the permissive reflect-any-origin default
  // `cors` above, which never sends credentials and would be unsafe to combine with them.
  await app.register(async (instance) => {
    await instance.register(cors, { origin: env.ADMIN_ORIGIN, credentials: true });
    await instance.register(cookie);
    adminRoutes(instance, db);
  });

  return app;
}
