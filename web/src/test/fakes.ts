import { waitFor } from "@testing-library/preact";
import { vi } from "vitest";

type Handler = (request: {
  body: unknown;
  headers: Headers;
}) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

export type ApiCall = { method: string; path: string; body: unknown; headers: Headers };

/** A fake backend: routes are "METHOD /path" keys. Unrouted calls fail the test loudly. */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://linkdrop.test");
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body, headers });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`Unexpected request ${method} ${url.pathname}`);
    const result = await handler({ body, headers });
    return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    count: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length,
    set: (key: string, handler: Handler) => (routes[key] = handler),
  };
}

export const networkDown: Handler = () => Promise.reject(new TypeError("Failed to fetch"));

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: URL;

  constructor(
    url: string,
    readonly protocols: string[] = [],
  ) {
    this.url = new URL(url);
    FakeWebSocket.instances.push(this);
  }

  static latest() {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("no WebSocket was opened");
    return socket;
  }

  /** Waits for the next socket matching the query parameter (effects run after paint). */
  static async next(param: string, value: string) {
    return waitFor(() => {
      const socket = FakeWebSocket.latest();
      if (socket.url.searchParams.get(param) !== value) throw new Error(`latest socket is ${socket.url.search}`);
      return socket;
    });
  }

  static install() {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(message: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  /** The server or network closed the connection. */
  drop() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  close() {
    this.drop();
  }

  send() {}
}

export function setLanguage(language: string) {
  Object.defineProperty(window.navigator, "language", { value: language, configurable: true });
}

export function visit(path: string) {
  window.history.replaceState(null, "", path);
}
