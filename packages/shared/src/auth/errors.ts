export class AuthVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthVerificationError";
  }
}
