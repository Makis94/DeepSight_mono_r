import { paymentStatusSchema } from "@hypertracker/shared";
import { z } from "zod";

// Reconciliation-only client — mirrors apps/api's nowpayments-client.ts but only needs
// GET /v1/payment/{id} (apps/api owns invoice creation). Kept as a separate small copy
// rather than a shared package, matching how apps/worker's cmc-client.ts is local to
// coin-registry-sync rather than factored into packages/shared.
// source: NowPayments HelpCenter "API and endpoint description", verified 2026-08-12.

const paymentStatusResponseApiSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform(String),
  payment_status: paymentStatusSchema,
  order_id: z.string(),
});
export type NowPaymentsPaymentStatusResponse = z.infer<typeof paymentStatusResponseApiSchema>;

export async function getPaymentStatus(
  baseUrl: string,
  apiKey: string,
  paymentId: string,
): Promise<NowPaymentsPaymentStatusResponse> {
  const response = await fetch(`${baseUrl}/v1/payment/${paymentId}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NowPayments get payment status failed: ${response.status} ${text}`);
  }

  const json: unknown = await response.json();
  return paymentStatusResponseApiSchema.parse(json);
}
