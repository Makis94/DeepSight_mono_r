import { env } from "./env.js";
import { buildServer } from "./server.js";

const app = await buildServer();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
