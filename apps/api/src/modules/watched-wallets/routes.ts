import { type Database, watchedWallets } from "@hypertracker/db";
import {
  addWatchedWalletBodySchema,
  MAX_WATCHED_WALLETS,
  walletAddressSchema,
} from "@hypertracker/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveSubscription } from "../subscription/guard.js";
import { getQueuePositions, releasePreciseSlot, requestPreciseSlot } from "./precise-slots.js";

const walletColumns = {
  id: watchedWallets.id,
  address: watchedWallets.address,
  label: watchedWallets.label,
  trackingMode: watchedWallets.trackingMode,
  createdAt: watchedWallets.createdAt,
};

export function watchedWalletsRoutes(app: FastifyInstance, db: Database): void {
  // Ordered by id so a wallet's position in this list — and therefore anything the client
  // derives from that position (e.g. assigning each wallet a stable display color) — doesn't
  // shuffle between requests.
  app.get("/watched-wallets", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const wallets = await db
      .select(walletColumns)
      .from(watchedWallets)
      .where(eq(watchedWallets.userId, session.telegramId))
      .orderBy(asc(watchedWallets.id));

    // Queue positions are a platform-wide FIFO, not scoped to this user — fetch once and
    // look up per row rather than a query per wallet.
    const queuePositions = await getQueuePositions(db);
    return {
      wallets: wallets.map((wallet) => ({
        ...wallet,
        queuePosition: queuePositions.get(wallet.id),
      })),
    };
  });

  // Adds a wallet to this user's list (up to MAX_WATCHED_WALLETS) rather than replacing a
  // single slot — see packages/db migration for the (userId, address) unique constraint that
  // backs this.
  app.post("/watched-wallets", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const body = addWatchedWalletBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid wallet address" });
      return;
    }

    // Per-user slot cap — independent from the global Hyperliquid capacity check below (see
    // MAX_WATCHED_WALLETS doc comment in packages/shared). Known gap: this count-then-insert
    // isn't atomic, so two concurrent requests near the limit could both pass; acceptable at
    // current traffic, revisit if that becomes real.
    const existingRows = await db
      .select({ address: watchedWallets.address })
      .from(watchedWallets)
      .where(eq(watchedWallets.userId, session.telegramId));
    const alreadyTrackedByUser = existingRows.some((row) => row.address === body.data.address);
    if (!alreadyTrackedByUser && existingRows.length >= MAX_WATCHED_WALLETS) {
      await reply.status(409).send({
        error: `wallet slot limit reached (${MAX_WATCHED_WALLETS}) — untrack one to add another`,
        code: "SLOT_LIMIT",
      });
      return;
    }

    // Note: no global Hyperliquid-subscription-capacity check here anymore. A newly added
    // wallet always starts tracking_mode="common" (matched against the public trades feed,
    // unlimited — see apps/worker/src/common-wallet-tracker), which doesn't touch
    // Hyperliquid's 10-unique-user WS cap at all. That cap only applies once a wallet
    // requests "precise" tracking — see precise-slots.ts / POST .../:id/precise, which is
    // where scarcity (and the shared queue) actually lives now.
    const [wallet] = await db
      .insert(watchedWallets)
      .values({ userId: session.telegramId, address: body.data.address })
      .onConflictDoNothing({ target: [watchedWallets.userId, watchedWallets.address] })
      .returning(walletColumns);

    if (!wallet) {
      // onConflictDoNothing hit — this exact address was already tracked by this user
      // (alreadyTrackedByUser above raced with a concurrent identical request).
      const [existing] = await db
        .select(walletColumns)
        .from(watchedWallets)
        .where(
          and(
            eq(watchedWallets.userId, session.telegramId),
            eq(watchedWallets.address, body.data.address),
          ),
        )
        .limit(1);
      await reply.status(200).send({ wallet: existing });
      return;
    }

    await reply.status(200).send({ wallet });
  });

  app.delete("/watched-wallets", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const query = request.query as Record<string, unknown>;
    const address = walletAddressSchema.safeParse(query["address"]);
    if (!address.success) {
      await reply.status(400).send({ error: "invalid wallet address" });
      return;
    }

    const [wallet] = await db
      .select({ id: watchedWallets.id })
      .from(watchedWallets)
      .where(
        and(
          eq(watchedWallets.userId, session.telegramId),
          eq(watchedWallets.address, address.data),
        ),
      )
      .limit(1);

    // If this wallet held a precise slot or a queue spot, release it and auto-promote the
    // next queued wallet before the row disappears — the FK's ON DELETE SET
    // NULL/CASCADE alone would clean up the columns but never trigger that promotion,
    // leaving the freed slot stranded until something else happens to touch it.
    if (wallet) {
      await releasePreciseSlot(db, wallet.id);
    }

    await db
      .delete(watchedWallets)
      .where(
        and(
          eq(watchedWallets.userId, session.telegramId),
          eq(watchedWallets.address, address.data),
        ),
      );
    await reply.status(204).send();
  });

  // Promote a watched wallet to precise (full-fidelity, Hyperliquid-native) tracking — see
  // precise-slots.ts for the 1-slot-per-user / auto-swap / shared-FIFO-queue rules.
  app.post("/watched-wallets/:id/precise", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const params = request.params as Record<string, unknown>;
    const id = Number(params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      await reply.status(400).send({ error: "invalid wallet id" });
      return;
    }

    const [wallet] = await db
      .select({ id: watchedWallets.id, userId: watchedWallets.userId })
      .from(watchedWallets)
      .where(eq(watchedWallets.id, id))
      .limit(1);
    if (!wallet || wallet.userId !== session.telegramId) {
      await reply.status(404).send({ error: "wallet not found" });
      return;
    }

    const result = await requestPreciseSlot(db, id, session.telegramId);
    if (result.status === "not_found") {
      await reply.status(404).send({ error: "wallet not found" });
      return;
    }
    await reply.status(200).send(result);
  });

  // Demote a watched wallet back to common tracking, freeing its precise slot (if any) for
  // the next wallet in the shared queue.
  app.delete("/watched-wallets/:id/precise", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const params = request.params as Record<string, unknown>;
    const id = Number(params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      await reply.status(400).send({ error: "invalid wallet id" });
      return;
    }

    const [wallet] = await db
      .select({ id: watchedWallets.id, userId: watchedWallets.userId })
      .from(watchedWallets)
      .where(eq(watchedWallets.id, id))
      .limit(1);
    if (!wallet || wallet.userId !== session.telegramId) {
      await reply.status(404).send({ error: "wallet not found" });
      return;
    }

    await releasePreciseSlot(db, id);
    await reply.status(204).send();
  });
}
