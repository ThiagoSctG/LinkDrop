import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { CONNECTED_MS } from "./pairing-display";
import { FakeWebSocket, fakeApi, setLanguage, visit } from "./test/fakes";

const pairingResponse = {
  status: 201,
  body: {
    token: "tok1",
    screenKey: "screen-key",
    expiresAt: "2026-07-09T10:02:00Z",
    pairingUrl: "http://linkdrop.test/pair/tok1",
  },
};

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.install();
  setLanguage("pt-BR");
  visit("/");
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-07-09T10:00:00Z") });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("screen", () => {
  it("shows a QR code and waits for a phone on its pairing channel", async () => {
    fakeApi({ "POST /api/screens": () => pairingResponse });
    render(<App />);

    expect(await screen.findByAltText("QR Code para conectar o celular ao LinkDrop")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar link de acesso" })).toBeTruthy();
    expect(screen.getByText("O código é renovado automaticamente.")).toBeTruthy();
    const socket = await FakeWebSocket.next("pairingToken", "tok1");
    expect(socket.url.pathname).toBe("/api/realtime");
    expect(socket.protocols).toEqual(["linkdrop.v2", "screen-key"]);
  });

  it.each([
    ["pt-BR", "Compartilhe sem intermediários.", "sem intermediários."],
    ["en-US", "Share without middlemen.", "without middlemen."],
  ])("headlines the page in %s with its key phrase marked", async (language, title, marked) => {
    setLanguage(language);
    fakeApi({ "POST /api/screens": () => pairingResponse });
    render(<App />);

    const heading = await screen.findByRole("heading", { level: 1, name: title });
    expect(heading.querySelector("mark")?.textContent).toBe(marked);
  });

  it("enters the session as soon as the phone pairs", async () => {
    fakeApi({ "POST /api/screens": () => pairingResponse });
    render(<App />);
    const pairingSocket = await FakeWebSocket.next("pairingToken", "tok1");
    pairingSocket.open();
    pairingSocket.receive({ type: "paired", sessionId: "s1", endpointKey: "screen-key", role: "screen" });

    expect((await screen.findByRole("status")).textContent).toBe("Celular conectado!");
    await vi.advanceTimersByTimeAsync(CONNECTED_MS);
    expect(await screen.findByText("Tela conectada")).toBeTruthy();
    const sessionSocket = await FakeWebSocket.next("sessionId", "s1");
    expect(sessionSocket.protocols).toEqual(["linkdrop.v2", "screen-key"]);
    expect(JSON.parse(localStorage.getItem("linkdrop:screen")!)).toEqual({
      sessionId: "s1",
      endpointKey: "screen-key",
      role: "screen",
    });
  });

  it("replaces the QR code when the server says it expired", async () => {
    let n = 0;
    fakeApi({
      "POST /api/screens": () => ({ ...pairingResponse, body: { ...pairingResponse.body, token: `tok${++n}` } }),
    });
    render(<App />);
    (await FakeWebSocket.next("pairingToken", "tok1")).receive({ type: "pairing_expired" });

    await FakeWebSocket.next("pairingToken", "tok2");
  });

  it("replaces the QR code when its expiry time arrives", async () => {
    let n = 0;
    fakeApi({
      "POST /api/screens": () => ({ ...pairingResponse, body: { ...pairingResponse.body, token: `tok${++n}` } }),
    });
    render(<App />);
    await FakeWebSocket.next("pairingToken", "tok1");
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    await FakeWebSocket.next("pairingToken", "tok2");
  });

  it("counts down to the next QR code", async () => {
    fakeApi({ "POST /api/screens": () => pairingResponse });
    render(<App />);

    expect(await screen.findByText("Renova em 2:00")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await screen.findByText("Renova em 1:59")).toBeTruthy();
  });

  it("offers a retry when the pairing cannot be created", async () => {
    const api = fakeApi({ "POST /api/screens": () => ({ status: 500, body: { code: "internal" } }) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(api.count("POST", "/api/screens")).toBe(2));
  });

  it("resumes a saved session after a reload", async () => {
    localStorage.setItem(
      "linkdrop:screen",
      JSON.stringify({ sessionId: "s1", endpointKey: "screen-key", role: "screen" }),
    );
    const api = fakeApi({});
    render(<App />);

    expect(await screen.findByText("Tela conectada")).toBeTruthy();
    await FakeWebSocket.next("sessionId", "s1");
    expect(api.count("POST", "/api/screens")).toBe(0);
  });
});
