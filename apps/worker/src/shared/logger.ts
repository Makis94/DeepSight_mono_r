import pino from "pino";

export function createLogger(nodeEnv: string, level: string) {
  return pino({
    level,
    ...(nodeEnv === "development" ? { transport: { target: "pino-pretty" } } : {}),
  });
}
