import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./app";
import { decryptItem, encryptItem } from "./crypto";
import { TEST_KEY, FakeWebSocket, fakeApi, setLanguage, visit } from "./test/fakes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("creates a pairing on HTTP without subtle or randomUUID and explains the transport limitation", async () => {
  setLanguage("en");
  visit("/");
  vi.stubGlobal("isSecureContext", false);
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  FakeWebSocket.install();
  const api = fakeApi({
    "POST /api/screens": () => ({
      status: 201,
      body: {
        token: "http-token",
        screenKey: "screen-key",
        pairingUrl: "http://localhost/pair/http-token",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      },
    }),
  });
  render(<App />);
  expect(await screen.findByRole("note")).toHaveProperty("textContent", expect.stringContaining("HTTP connection"));
  expect(await screen.findByRole("img", { name: /QR code/i })).toBeTruthy();
  await FakeWebSocket.next("pairingToken", "http-token");
  expect(api.calls).toHaveLength(1);
});

it("blocks browsers without secure randomness instead of using weak keys or plaintext", async () => {
  setLanguage("en");
  visit("/");
  vi.stubGlobal("crypto", undefined);
  const api = fakeApi({});
  render(<App />);
  expect(await screen.findByText("Encryption unavailable")).toBeTruthy();
  expect(api.calls).toHaveLength(0);
});

it("sends and receives encrypted items over HTTP when native encryption APIs are absent", async () => {
  setLanguage("en");
  visit("/pair");
  FakeWebSocket.install();
  const connection = { sessionId: "s1", endpointKey: "phone", role: "phone" as const, encryptionKey: TEST_KEY };
  const incoming = {
    ...(await encryptItem(connection, "", "received privately")),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem("linkdrop:phone", JSON.stringify(connection));
  vi.stubGlobal("isSecureContext", false);
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const api = fakeApi({ "POST /api/sessions/s1/items": () => ({ status: 201 }) });
  render(<App />);
  const socket = await FakeWebSocket.next("sessionId", "s1");
  socket.receiveRaw({ type: "session", id: "s1", role: "phone", items: [incoming] });
  expect(await screen.findByText("received privately")).toBeTruthy();
  fireEvent.input(screen.getByLabelText("Link or text"), { target: { value: "sent privately" } });
  fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!);
  await waitFor(() => expect(api.calls).toHaveLength(1));
  expect(JSON.stringify(api.calls[0].body)).not.toContain("sent privately");
  expect(JSON.stringify(api.calls[0].body)).not.toContain(TEST_KEY);
  expect(await decryptItem(connection, api.calls[0].body as Parameters<typeof decryptItem>[1])).toMatchObject({
    content: "sent privately",
  });
});

it("refuses plaintext snapshots and shows a decryption error", async () => {
  setLanguage("en");
  visit("/pair");
  FakeWebSocket.install();
  localStorage.setItem(
    "linkdrop:phone",
    JSON.stringify({ sessionId: "s1", endpointKey: "phone", role: "phone", encryptionKey: TEST_KEY }),
  );
  fakeApi({});
  render(<App />);
  const socket = await FakeWebSocket.next("sessionId", "s1");
  socket.receiveRaw({
    type: "session",
    id: "s1",
    role: "phone",
    items: [{ id: "legacy", title: "Private", content: "plaintext secret", type: "text" }],
  });
  expect(await screen.findByText(/Could not verify or decrypt/)).toBeTruthy();
  expect(screen.queryByText("plaintext secret")).toBeNull();
  expect(screen.queryByRole("article")).toBeNull();
});

it.each(["new snapshot", "session ended"])("discards an older decryption after %s", async (event) => {
  setLanguage("en");
  visit("/pair");
  FakeWebSocket.install();
  const connection = { sessionId: "s1", endpointKey: "phone", role: "phone" as const, encryptionKey: TEST_KEY };
  localStorage.setItem("linkdrop:phone", JSON.stringify(connection));
  const oldItem = { ...(await encryptItem(connection, "", "old item")), createdAt: "2026-10-26T00:00:00Z" };
  const newItem = { ...(await encryptItem(connection, "", "new item")), createdAt: "2026-10-26T00:00:01Z" };
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(async (...args) => {
    const plaintext = await decrypt(...args);
    await delayed;
    return plaintext;
  });
  fakeApi({});
  render(<App />);
  const socket = await FakeWebSocket.next("sessionId", "s1");
  socket.receiveRaw({ type: "session", id: "s1", role: "phone", items: [oldItem] });
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  if (event === "new snapshot") {
    socket.receiveRaw({ type: "session", id: "s1", role: "phone", items: [newItem] });
    expect(await screen.findByText("new item")).toBeTruthy();
  } else {
    socket.receiveRaw({ type: "session_ended", reason: "ended" });
    expect(await screen.findByText("Session ended.")).toBeTruthy();
  }
  release();
  await delayed;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText("old item")).toBeNull();
});
