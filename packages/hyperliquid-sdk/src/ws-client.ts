import { WebSocket, type RawData } from "ws";
import type { Logger } from "pino";
import { HYPERLIQUID_WS_HEARTBEAT } from "./config/limits.js";
import { wsEnvelopeSchema, type HyperliquidSubscription } from "./types.js";

type MessageListener = (data: unknown) => void;

export interface HyperliquidWsClientOptions {
  url: string;
  logger: Logger;
  pingIntervalMs?: number;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onOpen?: () => void;
  onClose?: () => void;
  /**
   * Fired on every `pong` reply to our keepalive ping (see startPing/HYPERLIQUID_WS_HEARTBEAT).
   * Proves the connection is alive end-to-end independent of business-channel traffic —
   * consumers with sparse/no subscriptions (e.g. wallet-watcher with zero watched wallets)
   * would otherwise never see a message to refresh their own liveness tracking.
   */
  onPong?: () => void;
}

function subscriptionKey(subscription: HyperliquidSubscription): string {
  return JSON.stringify(subscription, Object.keys(subscription).sort());
}

// Thin typed transport over the Hyperliquid WS API: connect/reconnect, ping keepalive,
// subscribe/unsubscribe, and channel-based message dispatch. Deliberately has no
// business logic (classification, dedup) — that lives in the consumer (wallet-watcher).
export class HyperliquidWsClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<MessageListener>>();
  private readonly activeSubscriptions = new Map<string, HyperliquidSubscription>();
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;

  constructor(private readonly options: HyperliquidWsClientOptions) {}

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(channel: string, listener: MessageListener): void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
  }

  subscribe(subscription: HyperliquidSubscription): void {
    this.activeSubscriptions.set(subscriptionKey(subscription), subscription);
    this.send({ method: "subscribe", subscription });
  }

  unsubscribe(subscription: HyperliquidSubscription): void {
    this.activeSubscriptions.delete(subscriptionKey(subscription));
    this.send({ method: "unsubscribe", subscription });
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private openSocket(): void {
    const ws = new WebSocket(this.options.url);
    this.ws = ws;

    ws.on("open", () => {
      this.options.logger.info({ url: this.options.url }, "hyperliquid ws connected");
      this.reconnectAttempt = 0;
      for (const subscription of this.activeSubscriptions.values()) {
        this.send({ method: "subscribe", subscription });
      }
      this.startPing();
      this.options.onOpen?.();
    });

    ws.on("message", (raw: RawData) => {
      this.handleMessage(raw);
    });

    ws.on("close", () => {
      this.stopPing();
      this.options.onClose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      this.options.logger.error({ err }, "hyperliquid ws error");
    });
  }

  private handleMessage(raw: RawData): void {
    const text = Array.isArray(raw)
      ? Buffer.concat(raw).toString("utf8")
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Buffer.from(raw).toString("utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.options.logger.warn("received non-JSON hyperliquid ws message");
      return;
    }

    const envelope = wsEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      this.options.logger.warn({ parsed }, "received hyperliquid ws message with unexpected shape");
      return;
    }

    const { channel, data } = envelope.data;
    if (channel === "pong") {
      this.options.onPong?.();
      return;
    }
    if (channel === "subscriptionResponse") {
      return;
    }

    const listeners = this.listeners.get(channel);
    if (!listeners) return;
    for (const listener of listeners) listener(data);
  }

  private startPing(): void {
    const interval =
      this.options.pingIntervalMs ?? HYPERLIQUID_WS_HEARTBEAT.recommendedPingIntervalMs;
    this.pingTimer = setInterval(() => this.send({ method: "ping" }), interval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const min = this.options.minReconnectDelayMs ?? 2_000;
    const max = this.options.maxReconnectDelayMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.options.logger.warn({ delayMs: delay }, "hyperliquid ws disconnected, reconnecting");
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }
}
