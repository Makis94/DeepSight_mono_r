import { z } from "zod";

// Fixed presets instead of a free-form amount input — Module 4 (full settings UI) isn't
// built yet, this is the minimal "user picks a threshold" surface for large-trade alerts.
// Stored verbatim into users.min_trade_amount (numeric column, decimal string).
export const TRADE_THRESHOLD_PRESETS = ["100000", "500000", "1000000"] as const;
export type TradeThresholdPreset = (typeof TRADE_THRESHOLD_PRESETS)[number];

// Both fields are optional but at least one must be present — selecting a preset amount
// sends { minTradeAmount }, and the standalone "Off" toggle sends { notifyTrades: false }
// without touching the stored amount (see ThresholdPicker/FeedPage).
export const updateTradeThresholdBodySchema = z
  .object({
    minTradeAmount: z.enum(TRADE_THRESHOLD_PRESETS).optional(),
    notifyTrades: z.boolean().optional(),
  })
  .refine((data) => data.minTradeAmount !== undefined || data.notifyTrades !== undefined, {
    message: "minTradeAmount or notifyTrades is required",
  });
export type UpdateTradeThresholdBody = z.infer<typeof updateTradeThresholdBodySchema>;

export const settingsResponseSchema = z.object({
  minTradeAmount: z.string(),
  notifyTrades: z.boolean(),
  minTwapAmount: z.string(),
  notifyTwaps: z.boolean(),
  minDepositAmount: z.string(),
  notifyDeposits: z.boolean(),
  excludeBtc: z.boolean(),
  excludeEth: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

// Applies only to the large-trade and likely-TWAP market-wide feeds (see users.excludeBtc/
// excludeEth doc comment) — both fields optional but at least one required, same
// optional-fields/refine shape as updateTradeThresholdBodySchema above.
export const updateCoinExclusionBodySchema = z
  .object({
    excludeBtc: z.boolean().optional(),
    excludeEth: z.boolean().optional(),
  })
  .refine((data) => data.excludeBtc !== undefined || data.excludeEth !== undefined, {
    message: "excludeBtc or excludeEth is required",
  });
export type UpdateCoinExclusionBody = z.infer<typeof updateCoinExclusionBodySchema>;

// Same fixed-preset shape as trade/TWAP thresholds. Stored verbatim into
// users.min_deposit_amount (numeric column, decimal string). Must stay >= deposit-watcher's
// own DEPOSIT_MIN_NOTIONAL_USD floor (apps/worker/.env, currently $5k) — that floor decides
// whether an event is written at all, these decide what a user sees on top of that.
export const DEPOSIT_THRESHOLD_PRESETS = ["500000", "1000000", "2000000"] as const;
export type DepositThresholdPreset = (typeof DEPOSIT_THRESHOLD_PRESETS)[number];

// Same optional-fields/refine shape as updateTradeThresholdBodySchema above.
export const updateDepositThresholdBodySchema = z
  .object({
    minDepositAmount: z.enum(DEPOSIT_THRESHOLD_PRESETS).optional(),
    notifyDeposits: z.boolean().optional(),
  })
  .refine((data) => data.minDepositAmount !== undefined || data.notifyDeposits !== undefined, {
    message: "minDepositAmount or notifyDeposits is required",
  });
export type UpdateDepositThresholdBody = z.infer<typeof updateDepositThresholdBodySchema>;

// Same preset shape as trade thresholds — reused for the heuristic "likely TWAP" alert
// (see marketTwapSuspectedPayloadSchema), not a confirmed-TWAP feed.
export const TWAP_THRESHOLD_PRESETS = ["100000", "500000", "1000000"] as const;
export type TwapThresholdPreset = (typeof TWAP_THRESHOLD_PRESETS)[number];

// Same optional-fields/refine shape as updateTradeThresholdBodySchema above.
export const updateTwapThresholdBodySchema = z
  .object({
    minTwapAmount: z.enum(TWAP_THRESHOLD_PRESETS).optional(),
    notifyTwaps: z.boolean().optional(),
  })
  .refine((data) => data.minTwapAmount !== undefined || data.notifyTwaps !== undefined, {
    message: "minTwapAmount or notifyTwaps is required",
  });
export type UpdateTwapThresholdBody = z.infer<typeof updateTwapThresholdBodySchema>;
