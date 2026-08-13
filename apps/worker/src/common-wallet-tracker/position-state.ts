import { walletPositionState, type Database } from "@hypertracker/db";
import { and, eq } from "drizzle-orm";

export interface PositionUpdate {
  previousSignedSize: number;
  newSignedSize: number;
}

/**
 * Atomically reads the current signed position size for (address, coin), adds `delta`, and
 * persists the result. `SELECT ... FOR UPDATE` inside a transaction so two trades on the
 * same wallet+coin arriving close together can't race and silently drop one delta —
 * position tracking is the whole basis for common-wallet-tracker's open/close/increase/
 * decrease classification (see classify.ts), so a lost update here would misclassify.
 */
export async function applyPositionDelta(
  db: Database,
  address: string,
  coin: string,
  delta: number,
): Promise<PositionUpdate> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ signedSize: walletPositionState.signedSize })
      .from(walletPositionState)
      .where(and(eq(walletPositionState.address, address), eq(walletPositionState.coin, coin)))
      .for("update");

    const previousSignedSize = existing ? Number(existing.signedSize) : 0;
    const newSignedSize = previousSignedSize + delta;

    await tx
      .insert(walletPositionState)
      .values({ address, coin, signedSize: newSignedSize.toString() })
      .onConflictDoUpdate({
        target: [walletPositionState.address, walletPositionState.coin],
        set: { signedSize: newSignedSize.toString(), updatedAt: new Date() },
      });

    return { previousSignedSize, newSignedSize };
  });
}
