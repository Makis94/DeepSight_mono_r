import { Bot } from "grammy";
import { env } from "./env.js";
import { logger } from "./logger.js";

export function createBot(): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  bot.command("ping", async (ctx) => {
    await ctx.reply("pong");
  });

  bot.catch((err) => {
    logger.error({ err: err.error }, "unhandled bot error");
  });

  return bot;
}
