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
  // reflects the requesting origin instead of a fixed one — also credentialed now that the
  // standalone site authenticates via an httpOnly cookie (see auth/routes.ts), which browsers
  // only attach to a credentialed (fetch credentials:"include") cross-origin request.
  // `origin: true` reflects the actual Origin header rather than emitting a literal "*", so
  // combining it with credentials:true stays spec-compliant — this is the same pattern
  // /admin/* already uses with a fixed origin instead of a reflected one.
  await app.register(cors, {
    // Wrapped in { delegator } rather than passed as a bare function — avvio treats a
    // bare function `options` argument as an (server) => options factory evaluated once
    // at registration time, not a per-request resolver (see @fastify/cors's own
    // `opts.delegator` branch, which is how it distinguishes the two).
    delegator: (req, callback) => {
      const corsOptions = req.url.startsWith("/admin")
        ? { origin: env.ADMIN_ORIGIN, credentials: true }
        : { origin: true, credentials: true };
      callback(null, corsOptions);
    },
  });
  // Registered once, globally: both the user-facing session cookie (auth/guard.ts,
  // realtime/routes.ts) and the admin session cookie (admin/guard.ts) read via
  // request.cookies, which this plugin populates on every request regardless of route.
  await app.register(cookie);
  await app.register(websocket);
  await app.register(healthRoutes);
  await app.register((instance) => {
    authRoutes(instance, db, hub);
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
    realtimeRoutes(instance, hub, db);
  });
  // Own encapsulated context: admin auth is cookie-based (CORS handled by the delegator
  // above, keyed on the /admin path prefix; @fastify/cookie is registered globally above).
  await app.register((instance) => {
    adminRoutes(instance, db);
  });

  return app;
}
