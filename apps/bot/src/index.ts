import { createDb, createListenClient } from "@hypertracker/db";
import { createBot } from "./bot.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { startDepositNotifier } from "./modules/notifier/deposit-notifier.js";
import { startTradeNotifier } from "./modules/notifier/trade-notifier.js";
import { startTwapNotifier } from "./modules/notifier/twap-notifier.js";
import { registerSubscriptionCommands } from "./modules/subscription/commands.js";

const bot = createBot();
const db = createDb(env.DATABASE_URL);
const listenClient = createListenClient(env.DATABASE_URL);

async function main(): Promise<void> {
  registerSubscriptionCommands(bot, db, logger);
  await startDepositNotifier(bot, db, listenClient, logger);
  await startTradeNotifier(bot, db, listenClient, logger);
  await startTwapNotifier(bot, db, listenClient, logger);
  await bot.start({
    onStart: (info) => {
      logger.info({ username: info.username }, "bot started");
    },
  });
}

void main().catch((err: unknown) => {
  logger.error({ err }, "bot crashed");
  process.exit(1);
});
