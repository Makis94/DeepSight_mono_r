import { users, type Database } from "@hypertracker/db";
import {
  updateCoinExclusionBodySchema,
  updateDepositThresholdBodySchema,
  updateTradeThresholdBodySchema,
  updateTwapThresholdBodySchema,
  type SettingsResponse,
} from "@hypertracker/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveSubscription } from "../subscription/guard.js";

const SETTINGS_COLUMNS = {
  minTradeAmount: users.minTradeAmount,
  notifyTrades: users.notifyTrades,
  minTwapAmount: users.minTwapAmount,
  notifyTwaps: users.notifyTwaps,
  minDepositAmount: users.minDepositAmount,
  notifyDeposits: users.notifyDeposits,
  excludeBtc: users.excludeBtc,
  excludeEth: users.excludeEth,
};

// ensureUserRow (see apps/api auth/routes.ts) guarantees a row exists once a session token
// has been issued — these defaults only matter for the theoretical gap between issuing a
// token and that row landing, not the common case. Mirror the users table's own column
// defaults (packages/db/src/schema/users.ts) — highest preset per threshold, not "0".
function toResponse(row: Partial<SettingsResponse> | undefined): SettingsResponse {
  return {
    minTradeAmount: row?.minTradeAmount ?? "1000000",
    notifyTrades: row?.notifyTrades ?? true,
    minTwapAmount: row?.minTwapAmount ?? "1000000",
    notifyTwaps: row?.notifyTwaps ?? true,
    minDepositAmount: row?.minDepositAmount ?? "2000000",
    notifyDeposits: row?.notifyDeposits ?? true,
    excludeBtc: row?.excludeBtc ?? false,
    excludeEth: row?.excludeEth ?? false,
  };
}

export function settingsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/settings", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const [row] = await db
      .select(SETTINGS_COLUMNS)
      .from(users)
      .where(eq(users.telegramId, session.telegramId))
      .limit(1);

    return toResponse(row);
  });

  app.patch("/settings/trade-threshold", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const body = updateTradeThresholdBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid trade threshold" });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(body.data.minTradeAmount !== undefined && { minTradeAmount: body.data.minTradeAmount }),
        ...(body.data.notifyTrades !== undefined && { notifyTrades: body.data.notifyTrades }),
      })
      .where(eq(users.telegramId, session.telegramId))
      .returning(SETTINGS_COLUMNS);

    return toResponse(updated);
  });

  app.patch("/settings/twap-threshold", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const body = updateTwapThresholdBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid twap threshold" });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(body.data.minTwapAmount !== undefined && { minTwapAmount: body.data.minTwapAmount }),
        ...(body.data.notifyTwaps !== undefined && { notifyTwaps: body.data.notifyTwaps }),
      })
      .where(eq(users.telegramId, session.telegramId))
      .returning(SETTINGS_COLUMNS);

    return toResponse(updated);
  });

  app.patch("/settings/deposit-threshold", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const body = updateDepositThresholdBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid deposit threshold" });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(body.data.minDepositAmount !== undefined && {
          minDepositAmount: body.data.minDepositAmount,
        }),
        ...(body.data.notifyDeposits !== undefined && { notifyDeposits: body.data.notifyDeposits }),
      })
      .where(eq(users.telegramId, session.telegramId))
      .returning(SETTINGS_COLUMNS);

    return toResponse(updated);
  });

  app.patch("/settings/coin-exclusions", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const body = updateCoinExclusionBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid coin exclusion settings" });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(body.data.excludeBtc !== undefined && { excludeBtc: body.data.excludeBtc }),
        ...(body.data.excludeEth !== undefined && { excludeEth: body.data.excludeEth }),
      })
      .where(eq(users.telegramId, session.telegramId))
      .returning(SETTINGS_COLUMNS);

    return toResponse(updated);
  });
}
