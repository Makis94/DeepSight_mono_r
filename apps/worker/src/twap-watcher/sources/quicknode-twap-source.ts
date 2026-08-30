import type { Logger } from "pino";
import { WebSocket, type RawData } from "ws";
import { extractTwapEvents, type QuicknodeTwapEvent } from "../quicknode-schemas.js";

export interface QuicknodeTwapSourceOptions {
  url: string;
  logger: Logger;
  onEvent: (event: QuicknodeTwapEvent) => void;
  // Fired for every WS frame received, before parsing — including the near-constant stream of
  // empty blocks. Lets the caller keep a liveness timestamp fresh so "socket open but not a
  // single frame in N seconds" (a silently dead subscription) is distinguishable from "socket
  // open, feed healthy, just no TWAP transitions right now".
  onFrame?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

// The `id` we send on the initial hl_subscribe request — QuickNode's docs show `"id": 1` in
// their example, so a reply carrying this same id back is treated as the subscribe ack
// (logged at debug, not warned about as an unrecognized frame). See quicknode-schemas.ts's
// doc comment for why the exact ack shape isn't otherwise confirmed.
const SUBSCRIBE_REQUEST_ID = 1;

/**
 * Thin WS transport for QuickNode's HyperCore "TWAP" data stream — same reconnect discipline
 * (exponential backoff, resubscribe on reconnect) as packages/hyperliquid-sdk's
 * HyperliquidWsClient, but a separate implementation since the wire protocol is QuickNode's
 * own `hl_subscribe` JSON-RPC shape, not Hyperliquid's native `{method,subscription}` one.
 * Deliberately has no business logic (thresholding, price lookup, publishing) — that lives in
 * twap-watcher/index.ts.
 */
export class QuicknodeTwapSource {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;

  constructor(private readonly options: QuicknodeTwapSourceOptions) {}

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private openSocket(): void {
    const ws = new WebSocket(this.options.url);
    this.ws = ws;

    ws.on("open", () => {
      this.options.logger.info("quicknode twap ws connected");
      this.reconnectAttempt = 0;
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "hl_subscribe",
          params: { streamType: "twap" },
          id: SUBSCRIBE_REQUEST_ID,
        }),
      );
      this.options.onOpen?.();
    });

    ws.on("message", (raw: RawData) => {
      this.handleMessage(raw);
    });

    ws.on("close", () => {
      this.options.onClose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      this.options.logger.error({ err }, "quicknode twap ws error");
    });
  }

  private handleMessage(raw: RawData): void {
    this.options.onFrame?.();

    const text = Array.isArray(raw)
      ? Buffer.concat(raw).toString("utf8")
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Buffer.from(raw).toString("utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.options.logger.warn("received non-JSON quicknode twap ws message");
      return;
    }

    const extracted = extractTwapEvents(parsed);
    if (extracted) {
      if (extracted.unparsed.length > 0) {
        this.options.logger.warn(
          { unparsed: extracted.unparsed },
          "quicknode twap block contained events that didn't match the expected inner shape — see quicknode-schemas.ts doc comment",
        );
      }
      for (const event of extracted.events) this.options.onEvent(event);
      return;
    }

    // Not an events frame — most likely the subscribe ack. Only warn if it doesn't look like
    // one, since the ack's own shape isn't confirmed either (see quicknode-schemas.ts).
    const looksLikeAck =
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      (parsed as { id?: unknown }).id === SUBSCRIBE_REQUEST_ID;
    if (looksLikeAck) {
      this.options.logger.debug({ parsed }, "quicknode twap subscribe ack");
    } else {
      this.options.logger.warn(
        { parsed },
        "quicknode twap ws message matched no known envelope shape",
      );
    }
  }

  private scheduleReconnect(): void {
    const min = this.options.minReconnectDelayMs ?? 2_000;
    const max = this.options.maxReconnectDelayMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.options.logger.warn({ delayMs: delay }, "quicknode twap ws disconnected, reconnecting");
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }
}
