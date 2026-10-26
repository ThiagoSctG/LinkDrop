export type Role = "screen" | "phone";
export type Item = { id: string; title?: string; content: string; type: "link" | "text"; createdAt: string };
export type Connection = { sessionId: string; endpointKey: string; role: Role };
export type Pairing = { token: string; screenKey: string; pairingUrl: string; expiresAt: string };

/** Why a session ended: the server's reasons, or "gone" when the API no longer knows it. */
export type EndReason = "ended" | "expired" | "server_restart" | "gone" | "replaced";

/** Either the decoded body of a successful response, or the API error code ("network" when offline). */
export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string };

export async function request<T = undefined>(
  path: string,
  init: { method?: string; key?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  if (init.key) headers["x-endpoint-key"] = init.key;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Lets a request that starts as the page goes away still reach the server.
      keepalive: init.keepalive,
    });
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) return { ok: false, status: response.status, code: data?.code ?? "generic" };
  return { ok: true, status: response.status, data: data as T };
}

export const sessionPath = (connection: Connection, suffix = "") => `/api/sessions/${connection.sessionId}${suffix}`;

/** True when the server says the session or its key no longer exists. */
export const isGone = (result: Result<unknown>) =>
  !result.ok && (result.code === "not_found" || result.code === "forbidden");
