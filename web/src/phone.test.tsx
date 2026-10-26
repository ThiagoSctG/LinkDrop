import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { FakeWebSocket, fakeApi, networkDown, setLanguage, visit } from "./test/fakes";

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.install();
  setLanguage("pt-BR");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("phone", () => {
  it("pairs from the scanned link and removes the token from the address bar", async () => {
    visit("/pair/tok1");
    fakeApi({
      "POST /api/pair/tok1": () => ({
        status: 201,
        body: { sessionId: "s1", endpointKey: "phone-key", role: "phone" },
      }),
    });
    render(<App />);

    expect(await screen.findByText("Celular conectado")).toBeTruthy();
    expect(window.location.pathname).toBe("/pair");
    const socket = await FakeWebSocket.next("sessionId", "s1");
    expect(socket.protocols).toEqual(["linkdrop.v2", "phone-key"]);
    expect(JSON.parse(localStorage.getItem("linkdrop:phone")!)).toEqual({
      sessionId: "s1",
      endpointKey: "phone-key",
      role: "phone",
    });
  });

  it.each([
    [409, "qr_used", "Este QR Code já foi usado."],
    [410, "qr_expired", "Este QR Code expirou ou não está disponível."],
    [429, "rate_limited", "Muitas solicitações. Aguarde um minuto e tente novamente."],
  ])("explains a %i (%s) and how to get back", async (status, code, message) => {
    visit("/pair/tok1");
    fakeApi({ "POST /api/pair/tok1": () => ({ status, body: { code, error: "server text" } }) });
    render(<App />);

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText("Não foi possível conectar.")).toBeTruthy();
    expect(screen.getByText("Volte para a tela que exibe o QR Code e faça uma nova leitura.")).toBeTruthy();
    // "/" is the screen's page, so the phone gets no link there.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("explains a network failure", async () => {
    visit("/pair/tok1");
    fakeApi({ "POST /api/pair/tok1": networkDown });
    render(<App />);
    expect(await screen.findByText("Falha de conexão. Verifique sua internet e tente novamente.")).toBeTruthy();
  });

  it("prefers a freshly scanned code over a saved session", async () => {
    localStorage.setItem("linkdrop:phone", JSON.stringify({ sessionId: "old", endpointKey: "old-key", role: "phone" }));
    visit("/pair/tok2");
    fakeApi({
      "POST /api/pair/tok2": () => ({ status: 201, body: { sessionId: "s2", endpointKey: "new-key", role: "phone" } }),
    });
    render(<App />);
    await FakeWebSocket.next("sessionId", "s2");
    expect(FakeWebSocket.instances.map((socket) => socket.url.searchParams.get("sessionId"))).not.toContain("old");
  });

  it("resumes the saved session when reloaded without a token", async () => {
    localStorage.setItem(
      "linkdrop:phone",
      JSON.stringify({ sessionId: "s1", endpointKey: "phone-key", role: "phone" }),
    );
    visit("/pair");
    fakeApi({});
    render(<App />);
    expect(await screen.findByText("Celular conectado")).toBeTruthy();
    await FakeWebSocket.next("sessionId", "s1");
  });

  it("asks for a new scan when there is neither token nor saved session", async () => {
    visit("/pair");
    fakeApi({});
    render(<App />);
    expect(await screen.findByText("Este celular não está conectado a nenhuma sessão.")).toBeTruthy();
  });

  it("explains when another phone replaced this one", async () => {
    localStorage.setItem(
      "linkdrop:phone",
      JSON.stringify({ sessionId: "s1", endpointKey: "phone-key", role: "phone" }),
    );
    visit("/pair");
    fakeApi({});
    render(<App />);
    const socket = await FakeWebSocket.next("sessionId", "s1");
    socket.open();
    socket.receive({ type: "session_ended", reason: "replaced" });

    expect(await screen.findByText("Outro celular entrou nesta sessão.")).toBeTruthy();
  });
});
