// Subpath import, not the package root — the root barrel also re-exports the auth module,
// which uses node:crypto (server-only) and would break browser typecheck/bundling.
import { eventRecordSchema, type EventRecord } from "@hypertracker/shared/schemas/events";
import { getMiniAppToken } from "./mini-app-session.js";
import { isMiniApp } from "../telegram/context.js";

// Same wire shape the REST backfill endpoint (GET /events, see lib/api.ts) returns — both
// paths feed the same event lists in FeedPage, so they share one schema/type rather than
// two hand-rolled ones that could drift.
export type RealtimeEvent = EventRecord;

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;
// apps/api's realtime/routes.ts closes with this code for a missing/invalid session
// token — retrying won't help since the token doesn't change without a fresh login, so
// this is the one close reason that should stop the reconnect loop instead of backing off.
const AUTH_FAILURE_CLOSE_CODE = 4001;

export function connectRealtime(
  onEvent: (event: RealtimeEvent) => void,
  // Fired on every reconnect (not the initial connect, which the caller's own mount-time
  // backfill already covers) — hub.ts broadcasts are one-shot (pg_notify, no replay), so a
  // socket that drops and reconnects can land in the gap between the old connection leaving
  // the server's client set and the new one being registered and permanently miss whatever
  // was broadcast during that window. Re-running the REST backfill closes that gap instead
  // of leaving the feed silently stale until a full page reload.
  onReconnect?: () => void,
): () => void {
  const base = import.meta.env.VITE_API_URL.replace(/^http/, "ws");
  let closedByCaller = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let socket: WebSocket | null = null;
  let hasConnectedOnce = false;

  function connect(): void {
    // Mini App: token rides as a query param (the native WebSocket API can't set a custom
    // Authorization header). Standalone site: the browser attaches the session cookie to the
    // handshake automatically, same as any other same-site request — no query param needed.
    const miniAppToken = isMiniApp() ? getMiniAppToken() : null;
    const url = miniAppToken
      ? `${base}/realtime?token=${encodeURIComponent(miniAppToken)}`
      : `${base}/realtime`;
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      if (hasConnectedOnce) onReconnect?.();
      hasConnectedOnce = true;
    });

    socket.addEventListener("message", (messageEvent: MessageEvent<unknown>) => {
      try {
        const json: unknown = JSON.parse(String(messageEvent.data));
        onEvent(eventRecordSchema.parse(json));
      } catch (err) {
        console.error("failed to parse realtime message", err);
      }
    });

    // The API process restarting (deploys, crashes, or just local dev) silently drops this
    // connection — without reconnecting here, the feed would just go quiet until the user
    // manually reloads the page, with no indication anything went wrong.
    socket.addEventListener("close", (event) => {
      if (closedByCaller || event.code === AUTH_FAILURE_CLOSE_CODE) return;
      const delay = Math.min(
        MIN_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
  }

  connect();

  return () => {
    closedByCaller = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
