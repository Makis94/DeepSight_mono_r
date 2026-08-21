import { z } from "zod";

// Invoice-creation-only client — the bot talks to the database directly for everything else
// in this project (see notifiers), so subscription commands follow the same pattern rather
// than introducing a new "bot calls apps/api over HTTP" architecture. The webhook itself
// still lives in apps/api (see PUBLIC_API_URL usage below) since that's the one publicly
// reachable HTTP surface NowPayments can call back into.
// source: NowPayments HelpCenter "API and endpoint description" (POST /v1/invoice),
// verified 2026-08-12; success_url/cancel_url confirmed via NowPayments' own
// nowpayments-api-js reference client, verified 2026-08-21.

const createInvoiceResponseApiSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  invoice_url: z.string(),
});

export interface CreateInvoiceParams {
  baseUrl: string;
  apiKey: string;
  priceAmountUsd: string;
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl: string;
  // Where NowPayments' hosted invoice page redirects the customer after payment
  // succeeds/is cancelled — without these it stays on NowPayments' own generic result page.
  successUrl: string;
  cancelUrl: string;
}

export async function createInvoice(
  params: CreateInvoiceParams,
): Promise<{ invoiceId: string; invoiceUrl: string }> {
  const response = await fetch(`${params.baseUrl}/v1/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: params.priceAmountUsd,
      price_currency: "usd",
      order_id: params.orderId,
      order_description: params.orderDescription,
      ipn_callback_url: params.ipnCallbackUrl,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NowPayments create invoice failed: ${response.status} ${text}`);
  }

  const json: unknown = await response.json();
  const parsed = createInvoiceResponseApiSchema.parse(json);
  return { invoiceId: parsed.id, invoiceUrl: parsed.invoice_url };
}
