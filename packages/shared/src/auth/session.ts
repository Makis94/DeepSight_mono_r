import { z } from "zod";

// Canonical identity across the whole system: telegram_id. Both verification paths
// (Login Widget on the standalone site, initData in the Mini App) produce this same
// shape — apps/api, apps/bot and the realtime gateway consume only this, never knowing
// which path the user arrived through.
export const sessionSchema = z.object({
  telegramId: z.number().int().positive(),
  username: z.string().optional(),
  firstName: z.string().optional(),
  photoUrl: z.string().optional(),
  authMethod: z.enum(["login_widget", "mini_app"]),
});

export type Session = z.infer<typeof sessionSchema>;
