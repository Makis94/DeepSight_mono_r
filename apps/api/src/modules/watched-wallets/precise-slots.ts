import { preciseSlotQueue, preciseSlots, watchedWallets, type Database } from "@hypertracker/db";
import { and, asc, eq, isNull, ne } from "drizzle-orm";

export type PreciseSlotRequestResult =
  { status: "assigned" } | { status: "queued"; queuePosition: number } | { status: "not_found" };

/**
 * Implements the product rule: 1 precise slot per user. If the user already holds a
 * precise slot on a different wallet, that slot is freed and immediately reclaimed by
 * `watchedWalletId` in the same transaction — no queue detour, since freeing your own slot
 * always creates an opening for yourself. Only reaches the shared FIFO queue
 * (precise_slot_queue) when the user holds no precise slot AND all 10 precise_slots rows
 * are occupied by other users' wallets.
 */
export async function requestPreciseSlot(
  db: Database,
  watchedWalletId: number,
  userId: number,
): Promise<PreciseSlotRequestResult> {
  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select({ id: watchedWallets.id, trackingMode: watchedWallets.trackingMode })
      .from(watchedWallets)
      .where(eq(watchedWallets.id, watchedWalletId))
      .limit(1);
    if (!wallet) return { status: "not_found" };
    if (wallet.trackingMode === "precise") return { status: "assigned" };

    // Auto-swap: free this user's other precise wallet (if any) before looking for a slot,
    // so the just-freed slot is the one this request claims.
    const [ownPreciseWallet] = await tx
      .select({ id: watchedWallets.id })
      .from(watchedWallets)
      .where(
        and(
          eq(watchedWallets.userId, userId),
          eq(watchedWallets.trackingMode, "precise"),
          ne(watchedWallets.id, watchedWalletId),
        ),
      )
      .limit(1);
    if (ownPreciseWallet) {
      await tx
        .update(preciseSlots)
        .set({ watchedWalletId: null })
        .where(eq(preciseSlots.watchedWalletId, ownPreciseWallet.id));
      await tx
        .update(watchedWallets)
        .set({ trackingMode: "common" })
        .where(eq(watchedWallets.id, ownPreciseWallet.id));
      // Also drop any stale queue entry the swapped-out wallet might hold, mirroring the
      // "at most one pending precise thing per user" invariant.
      await tx
        .delete(preciseSlotQueue)
        .where(eq(preciseSlotQueue.watchedWalletId, ownPreciseWallet.id));
    }

    // A user can only have one outstanding request (occupied slot XOR queue entry) — clear
    // any previous queue entry for a different wallet of this user before adding a new one.
    const usersOtherQueueRows = await tx
      .select({ id: preciseSlotQueue.id, watchedWalletId: preciseSlotQueue.watchedWalletId })
      .from(preciseSlotQueue)
      .innerJoin(watchedWallets, eq(preciseSlotQueue.watchedWalletId, watchedWallets.id))
      .where(eq(watchedWallets.userId, userId));
    for (const row of usersOtherQueueRows) {
      if (row.watchedWalletId !== watchedWalletId) {
        await tx.delete(preciseSlotQueue).where(eq(preciseSlotQueue.id, row.id));
      }
    }

    // FOR UPDATE SKIP LOCKED: if another concurrent request is already claiming a
    // different free row, this one doesn't block on it — it just looks at the next free row.
    const [freeSlot] = await tx
      .select({ slotId: preciseSlots.slotId })
      .from(preciseSlots)
      .where(isNull(preciseSlots.watchedWalletId))
      .orderBy(asc(preciseSlots.slotId))
      .limit(1)
      .for("update", { skipLocked: true });

    if (freeSlot) {
      await tx
        .update(preciseSlots)
        .set({ watchedWalletId })
        .where(eq(preciseSlots.slotId, freeSlot.slotId));
      await tx
        .update(watchedWallets)
        .set({ trackingMode: "precise" })
        .where(eq(watchedWallets.id, watchedWalletId));
      return { status: "assigned" };
    }

    await tx
      .insert(preciseSlotQueue)
      .values({ watchedWalletId })
      .onConflictDoNothing({ target: preciseSlotQueue.watchedWalletId });

    const queueRows = await tx
      .select({ watchedWalletId: preciseSlotQueue.watchedWalletId })
      .from(preciseSlotQueue)
      .orderBy(asc(preciseSlotQueue.requestedAt));
    const index = queueRows.findIndex((row) => row.watchedWalletId === watchedWalletId);
    const queuePosition = index === -1 ? queueRows.length : index + 1;
    return { status: "queued", queuePosition };
  });
}

/**
 * Releases `watchedWalletId`'s precise slot (if it holds one) or removes its queue entry
 * (if it's waiting), then auto-promotes the front of precise_slot_queue into any slot this
 * freed — used both by the explicit "demote to common" route and by watched-wallet
 * deletion, so a deleted precise wallet never leaves its slot capacity stranded.
 */
export async function releasePreciseSlot(db: Database, watchedWalletId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(preciseSlotQueue).where(eq(preciseSlotQueue.watchedWalletId, watchedWalletId));

    const [freedSlot] = await tx
      .update(preciseSlots)
      .set({ watchedWalletId: null })
      .where(eq(preciseSlots.watchedWalletId, watchedWalletId))
      .returning({ slotId: preciseSlots.slotId });

    await tx
      .update(watchedWallets)
      .set({ trackingMode: "common" })
      .where(eq(watchedWallets.id, watchedWalletId));

    if (!freedSlot) return; // wasn't holding a slot — nothing to promote

    const [next] = await tx
      .select({ id: preciseSlotQueue.id, watchedWalletId: preciseSlotQueue.watchedWalletId })
      .from(preciseSlotQueue)
      .orderBy(asc(preciseSlotQueue.requestedAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return;

    await tx.delete(preciseSlotQueue).where(eq(preciseSlotQueue.id, next.id));
    await tx
      .update(preciseSlots)
      .set({ watchedWalletId: next.watchedWalletId })
      .where(eq(preciseSlots.slotId, freedSlot.slotId));
    await tx
      .update(watchedWallets)
      .set({ trackingMode: "precise" })
      .where(eq(watchedWallets.id, next.watchedWalletId));
  });
}

/** 1-indexed queue position per watchedWalletId, for surfacing on GET /watched-wallets. */
export async function getQueuePositions(db: Database): Promise<Map<number, number>> {
  const rows = await db
    .select({ watchedWalletId: preciseSlotQueue.watchedWalletId })
    .from(preciseSlotQueue)
    .orderBy(asc(preciseSlotQueue.requestedAt));
  const positions = new Map<number, number>();
  rows.forEach((row, index) => positions.set(row.watchedWalletId, index + 1));
  return positions;
}
