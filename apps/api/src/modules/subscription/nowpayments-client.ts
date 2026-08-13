import { paymentStatusSchema } from "@hypertracker/shared";
import { z } from "zod";

// NowPayments API (not Hyperliquid's) — not subject to the hyperliquid-docs MCP verification
// rule, which only covers Hyperliquid endpoints. Verified instead against NowPayments'
// HelpCenter/Postman docs directly, see comments below and packages/shared's
// verify-nowpayments-ipn.ts / schemas/subscription.ts for the same sourcing.

export interface NowPaymentsClientConfig {
  baseUrl: string;
  apiKey: string;
}

// source: NowPayments HelpCenter "API and endpoint description" (POST /v1/invoice),
// verified 2026-08-12. price_amount/price_currency are required; the rest are optional.
// Using the Invoice API (not the Payment API's /v1/payment) deliberately — it returns a
// single hosted invoice_url where the customer picks their own crypto, rather than us having
// to pre-select a pay_currency and hand back a raw pay_address/QR.
export interface CreateInvoiceParams {
  priceAmountUsd: string;
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl: string;
}

const createInvoiceResponseApiSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  invoice_url: z.string(),
});

const paymentStatusResponseApiSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform(String),
  payment_status: paymentStatusSchema,
  order_id: z.string(),
});
export type NowPaymentsPaymentStatusResponse = z.infer<typeof paymentStatusResponseApiSchema>;

export class NowPaymentsClient {
  constructor(private readonly config: NowPaymentsClientConfig) {}

  async createInvoice(
    params: CreateInvoiceParams,
  ): Promise<{ invoiceId: string; invoiceUrl: string }> {
    const response = await fetch(`${this.config.baseUrl}/v1/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: params.priceAmountUsd,
        price_currency: "usd",
        order_id: params.orderId,
        order_description: params.orderDescription,
        ipn_callback_url: params.ipnCallbackUrl,
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

  // source: NowPayments HelpCenter "API and endpoint description" (GET /v1/payment/{id}),
  // verified 2026-08-12. Used only as a reconciliation fallback (apps/worker
  // subscription-watcher) for payments whose IPN callback may have been missed — never the
  // primary path.
  async getPaymentStatus(paymentId: string): Promise<NowPaymentsPaymentStatusResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/payment/${paymentId}`, {
      headers: { "x-api-key": this.config.apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NowPayments get payment status failed: ${response.status} ${text}`);
    }

    const json: unknown = await response.json();
    return paymentStatusResponseApiSchema.parse(json);
  }
}
