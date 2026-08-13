import { createHmac, timingSafeEqual } from "node:crypto";
import { NowPaymentsIpnVerificationError } from "./errors.js";

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = sortDeep(val);
      return acc;
    }, {});
  }
  return value;
}

// NowPayments IPN signature verification.
// source: NowPayments HelpCenter "IPN and how to setup", verified 2026-08-12.
// The callback body is recursively sorted by key, JSON-serialized, and HMAC-SHA512'd with
// the IPN Secret (a credential distinct from the API key). The resulting hex digest must
// match the `x-nowpayments-sig` header exactly. Throws NowPaymentsIpnVerificationError on any
// mismatch or missing header — callers must treat that as a hard reject (401), never proceed
// as if the callback were trusted.
export function verifyNowPaymentsIpnSignature(
  rawBody: unknown,
  signatureHeader: string | undefined,
  ipnSecret: string,
): void {
  if (!signatureHeader) {
    throw new NowPaymentsIpnVerificationError("missing x-nowpayments-sig header");
  }

  const sorted = sortDeep(rawBody);
  const expectedHex = createHmac("sha512", ipnSecret).update(JSON.stringify(sorted)).digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const receivedBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new NowPaymentsIpnVerificationError("signature mismatch");
  }
}
