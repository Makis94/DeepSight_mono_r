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

  // Single registration for the whole app — @fastify/cors decorates the shared
  // Request/Reply prototypes, so registering it a second time (even in an encapsulated
  // child context) throws FST_ERR_DEC_ALREADY_PRESENT. A per-request delegator lets
  // /admin/* get its own credentialed, single-origin CORS policy while every other route
  // keeps the permissive reflect-any-origin, no-credentials default.
  await app.register(cors, {
    // Wrapped in { delegator } rather than passed as a bare function — avvio treats a
    // bare function `options` argument as an (server) => options factory evaluated once
    // at registration time, not a per-request resolver (see @fastify/cors's own
    // `opts.delegator` branch, which is how it distinguishes the two).
    delegator: (req, callback) => {
      const corsOptions = req.url.startsWith("/admin")
        ? { origin: env.ADMIN_ORIGIN, credentials: true }
        : { origin: true };
      callback(null, corsOptions);
    },
  });
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
  // Own encapsulated context: admin auth is cookie-based (CORS handled by the delegator
  // above, keyed on the /admin path prefix).
  await app.register(async (instance) => {
    await instance.register(cookie);
    adminRoutes(instance, db);
  });

  return app;
}
