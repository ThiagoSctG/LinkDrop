import type { EndReason, EncryptedItem, Role } from "./api";

export const REALTIME_PROTOCOL = "linkdrop.v3";

export type ServerMessage =
  | { type: "session"; id: string; role: Role; items: EncryptedItem[]; expiresInMs?: number }
  | { type: "session_ended"; reason: Exclude<EndReason, "gone"> }
  | { type: "paired"; sessionId: string; endpointKey: string; role: "screen" }
  | { type: "pairing_expired" };

export type RealtimeOptions = {
  query: Record<string, string>;
  key: string;
  onMessage: (message: ServerMessage) => void;
  /** The connection opened (first time or after a reconnect). */
  onOpen?: () => void;
  /** The connection closed unexpectedly; a reconnect is already scheduled. */
  onDrop?: () => void;
};

/** The server closes the connection right after these, so that close is not a drop. */
const FINAL_MESSAGES = new Set<ServerMessage["type"]>(["session_ended", "paired", "pairing_expired"]);

const HANDSHAKE_TIMEOUT_MS = 5_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/** Exponential backoff with jitter: the attempt-th delay lies in [cap/2, cap], never under 1 s. */
function backoffDelay(attempt: number) {
  const cap = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** attempt);
  return Math.max(MIN_BACKOFF_MS, cap / 2 + (Math.random() * cap) / 2);
}

/**
 * Keeps a realtime connection open until the returned function is called. Reconnects
 * with backoff; the server sends the full state on every (re)connect, so nothing is lost.
 */
export function connectRealtime(options: RealtimeOptions): () => void {
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/realtime?${new URLSearchParams(options.query)}`;
    const current = new WebSocket(url, [REALTIME_PROTOCOL, options.key]);
    socket = current;
    handshakeTimer = setTimeout(() => current.close(), HANDSHAKE_TIMEOUT_MS);
    current.onopen = () => {
      clearTimeout(handshakeTimer);
      attempt = 0;
      options.onOpen?.();
    };
    current.onmessage = (event) => {
      if (stopped) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // Ignore malformed frames; the next snapshot resynchronizes.
      }
      if (FINAL_MESSAGES.has(message.type)) stopped = true;
      options.onMessage(message);
    };
    current.onclose = () => {
      clearTimeout(handshakeTimer);
      if (stopped) return;
      reconnectTimer = setTimeout(connect, backoffDelay(attempt++));
      options.onDrop?.();
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(handshakeTimer);
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
