import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { FakeWebSocket, fakeApi, setLanguage, visit } from "./test/fakes";

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.install();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("language", () => {
  it("speaks English to browsers that are not set to Portuguese", async () => {
    setLanguage("en-US");
    visit("/pair/tok1");
    fakeApi({
      "POST /api/pair/tok1": () => ({ status: 409, body: { code: "qr_used", error: "Este QR Code já foi usado." } }),
    });
    render(<App />);

    expect(await screen.findByText("This QR code was already used.")).toBeTruthy();
    expect(screen.getByText("Go back to the screen showing the QR code and scan it again.")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("speaks Brazilian Portuguese to any Portuguese browser", async () => {
    setLanguage("pt-PT");
    visit("/pair");
    fakeApi({});
    render(<App />);
    expect(await screen.findByText("Este celular não está conectado a nenhuma sessão.")).toBeTruthy();
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("falls back to a generic message for unknown error codes", async () => {
    setLanguage("en-GB");
    visit("/pair/tok1");
    fakeApi({ "POST /api/pair/tok1": () => ({ status: 500, body: { code: "something_new" } }) });
    render(<App />);
    expect(await screen.findByText("Could not complete the action.")).toBeTruthy();
  });
});
