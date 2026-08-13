import { createServer, type Server } from "node:http";

export interface HeartbeatState {
  workerId: string;
  lastEventAt: number;
  /** Whether the thing this worker depends on (a WS connection, a sync loop, ...) is currently working. */
  isHealthy: boolean;
}

const DEFAULT_STALE_AFTER_MS = 60_000;

/**
 * @param staleAfterMs how long since `lastEventAt` before the worker is considered stale
 * even if `isHealthy` is true. Continuous WS workers want this short (default 60s);
 * a periodic job with a multi-hour interval must pass its own, much larger value.
 */
export function startHeartbeatServer(
  state: HeartbeatState,
  port: number,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): Server {
  const server = createServer((req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404);
      res.end();
      return;
    }

    const isAlive = state.isHealthy && Date.now() - state.lastEventAt < staleAfterMs;
    res.writeHead(isAlive ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state));
  });

  server.listen(port);
  return server;
}
