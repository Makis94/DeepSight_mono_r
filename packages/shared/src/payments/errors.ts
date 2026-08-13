export class NowPaymentsIpnVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NowPaymentsIpnVerificationError";
  }
}
