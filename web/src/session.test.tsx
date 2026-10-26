import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { CONNECTED_MS } from "./pairing-display";
import { UNDO_MS } from "./session";
import { FakeWebSocket, fakeApi, setLanguage, visit } from "./test/fakes";

const link = { id: "i1", content: "https://example.com", type: "link", createdAt: "2026-07-09T10:00:00Z" };
const note = {
  id: "i2",
  title: "Wi-Fi",
  content: "Senha: 123\nRede: sala",
  type: "text",
  createdAt: "2026-07-09T10:01:00Z",
};

function resumeAs(role: "screen" | "phone") {
  const key = `${role}-key`;
  localStorage.setItem(`linkdrop:${role}`, JSON.stringify({ sessionId: "s1", endpointKey: key, role }));
  visit(role === "screen" ? "/" : "/pair");
  return key;
}

async function confirmInDialog(name: string) {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name }));
}

async function connected() {
  const socket = await FakeWebSocket.next("sessionId", "s1");
  socket.open();
  return socket;
}

beforeEach(() => {
  localStorage.clear();
  FakeWebSocket.install();
  setLanguage("pt-BR");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared session", () => {
  it("renders whatever snapshot the realtime channel sends, newest first", async () => {
    resumeAs("phone");
    const api = fakeApi({});
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [note, link] });

    const [first, second] = await screen.findAllByRole("article");
    expect(within(first).getByRole("heading").textContent).toBe("Wi-Fi");
    expect(within(first).getByText(/Senha: 123/).textContent).toBe(note.content);
    expect(within(second).getByRole("link", { name: "Abrir link" }).getAttribute("href")).toBe("https://example.com");
    expect(api.calls).toHaveLength(0);
  });

  it("never renders a note as a clickable link", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const socket = await connected();
    const sneaky = { id: "x", content: "javascript:alert(1)", type: "text", createdAt: "2026-07-09T10:00:00Z" };
    socket.receive({ type: "session", id: "s1", role: "phone", items: [sneaky] });

    expect(await screen.findByText("javascript:alert(1)")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Abrir link" })).toBeNull();
  });

  it("sends a new item and relies on the next snapshot instead of refetching", async () => {
    const key = resumeAs("phone");
    const api = fakeApi({ "POST /api/sessions/s1/items": () => ({ status: 201, body: link }) });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [] });

    fireEvent.input(await screen.findByLabelText("Link ou texto"), { target: { value: "https://example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: "Enviar" }).closest("form")!);

    await waitFor(() => expect((screen.getByLabelText("Link ou texto") as HTMLTextAreaElement).value).toBe(""));
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].body).toEqual({ title: "", content: "https://example.com" });
    expect(api.calls[0].headers.get("x-endpoint-key")).toBe(key);
  });

  it("shows the server's validation error in the user's language", async () => {
    resumeAs("phone");
    fakeApi({ "POST /api/sessions/s1/items": () => ({ status: 422, body: { code: "session_full", error: "pt" } }) });
    render(<App />);
    await connected();
    fireEvent.input(await screen.findByLabelText("Link ou texto"), { target: { value: "one more" } });
    fireEvent.submit(screen.getByRole("button", { name: "Enviar" }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "A lista atingiu o limite de itens. Remova itens ou limpe a lista.",
    );
  });

  it("empties the list as soon as clearing is confirmed, and restores it if the server refuses", async () => {
    resumeAs("screen");
    let answer: { status: number; body?: unknown } = { status: 500, body: { code: "generic" } };
    const api = fakeApi({ "POST /api/sessions/s1/clear": () => answer });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [link, note] });

    fireEvent.click(await screen.findByRole("button", { name: "Limpar lista" }));
    await confirmInDialog("Limpar lista");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));

    answer = { status: 204 };
    fireEvent.click(screen.getByRole("button", { name: "Limpar lista" }));
    await confirmInDialog("Limpar lista");
    await waitFor(() => expect(api.count("POST", "/api/sessions/s1/clear")).toBe(2));
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("lets an item removed elsewhere leave with an animation, out of reach", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resumeAs("phone");
    fakeApi({});
    const view = render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link, note] });
    await screen.findAllByRole("article");

    socket.receive({ type: "session", id: "s1", role: "phone", items: [note] });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    const leaving = view.container.querySelector(".item-exit");
    expect(leaving?.textContent).toContain("example.com");
    expect(leaving?.getAttribute("aria-hidden")).toBe("true");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(view.container.querySelector(".item-exit")).toBeNull();
  });

  it("removes an item from either device once the undo window closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resumeAs("phone");
    const api = fakeApi({ "DELETE /api/sessions/s1/items/i1": () => ({ status: 204 }) });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [link] });
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }));

    expect(screen.queryByRole("article")).toBeNull();
    expect(api.count("DELETE", "/api/sessions/s1/items/i1")).toBe(0);
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await waitFor(() => expect(api.count("DELETE", "/api/sessions/s1/items/i1")).toBe(1));
  });

  it("brings a removed item back on undo without telling the server", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resumeAs("phone");
    const api = fakeApi({ "DELETE /api/sessions/s1/items/i1": () => ({ status: 204 }) });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [link] });
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));

    expect(await screen.findByRole("article")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(api.count("DELETE", "/api/sessions/s1/items/i1")).toBe(0);
  });

  it("sends a pending removal right away when another item is removed", async () => {
    resumeAs("phone");
    const second = { ...link, id: "i3", content: "https://example.org" };
    const api = fakeApi({
      "DELETE /api/sessions/s1/items/i1": () => ({ status: 204 }),
      "DELETE /api/sessions/s1/items/i3": () => ({ status: 204 }),
    });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [link, second] });
    const [first] = await screen.findAllByRole("button", { name: "Remover" });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(api.count("DELETE", "/api/sessions/s1/items/i1")).toBe(1));
    expect(api.count("DELETE", "/api/sessions/s1/items/i3")).toBe(0);
  });

  it("lets only the screen clear the whole list", async () => {
    resumeAs("phone");
    fakeApi({});
    const view = render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [link] });
    await screen.findByRole("article");
    expect(screen.queryByRole("button", { name: "Limpar lista" })).toBeNull();
    view.unmount();

    localStorage.clear();
    FakeWebSocket.install();
    resumeAs("screen");
    const api = fakeApi({ "POST /api/sessions/s1/clear": () => ({ status: 204 }) });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [link] });
    fireEvent.click(await screen.findByRole("button", { name: "Limpar lista" }));
    await confirmInDialog("Limpar lista");
    await waitFor(() => expect(api.count("POST", "/api/sessions/s1/clear")).toBe(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does nothing when a confirmation is canceled with its button or with Escape", async () => {
    resumeAs("screen");
    const api = fakeApi({});
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [link] });

    fireEvent.click(await screen.findByRole("button", { name: "Limpar lista" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Encerrar sessão" }));
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it("keeps focus inside the dialog and returns it to the button that opened it", async () => {
    resumeAs("screen");
    fakeApi({});
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [link] });

    const opener = await screen.findByRole("button", { name: "Limpar lista" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancelar" });
    const confirm = within(dialog).getByRole("button", { name: "Limpar lista" });

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    fireEvent.click(cancel);
    expect(document.activeElement).toBe(opener);
  });

  it("shows how long ago an item arrived and the host of a link", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const fresh = { ...link, createdAt: new Date().toISOString() };
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [fresh] });

    expect(await screen.findByText("agora")).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
  });

  it("copying counts as activity", async () => {
    resumeAs("phone");
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, language: "pt-BR", clipboard: { writeText } });
    const api = fakeApi({ "POST /api/sessions/s1/activity": () => ({ status: 204 }) });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [note] });
    fireEvent.click(await screen.findByRole("button", { name: "Copiar" }));

    expect(await screen.findByRole("button", { name: "Copiado" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(note.content);
    expect(await screen.findByRole("button", { name: "Copiar" }, { timeout: 3_000 })).toBeTruthy();
    await waitFor(() => expect(api.count("POST", "/api/sessions/s1/activity")).toBe(1));
  });

  it.each([
    ["ended", "Sessão encerrada."],
    ["expired", "Sessão encerrada por inatividade."],
    ["server_restart", "O servidor foi reiniciado e a sessão foi encerrada."],
  ])("tells the phone why its session ended (%s)", async (reason, notice) => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    (await connected()).receive({ type: "session_ended", reason });
    expect(await screen.findByText(notice)).toBeTruthy();
  });

  it("returns the screen to a fresh QR code when the session ends remotely", async () => {
    resumeAs("screen");
    fakeApi({
      "POST /api/screens": () => ({
        status: 201,
        body: { token: "tok9", screenKey: "k9", expiresAt: "2099-01-01T00:00:00Z", pairingUrl: "http://x/pair/tok9" },
      }),
    });
    render(<App />);
    (await connected()).receive({ type: "session_ended", reason: "expired" });

    await FakeWebSocket.next("pairingToken", "tok9");
    expect(localStorage.getItem("linkdrop:screen")).toBeNull();
    expect((await screen.findByRole("status", { name: "" })).textContent).toBe("Sessão encerrada por inatividade.");
  });

  it("tells the phone its session ended", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    (await connected()).receive({ type: "session_ended", reason: "ended" });

    expect(await screen.findByText("Sessão encerrada.")).toBeTruthy();
    expect(localStorage.getItem("linkdrop:phone")).toBeNull();
  });

  it("treats the close that follows session_ended as final, not as a dropped connection", async () => {
    resumeAs("phone");
    const api = fakeApi({});
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session_ended", reason: "ended" });
    socket.drop();

    expect(await screen.findByText("Sessão encerrada.")).toBeTruthy();
    expect(api.calls).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ends the session from this device after confirmation", async () => {
    resumeAs("phone");
    const api = fakeApi({ "POST /api/sessions/s1/end": () => ({ status: 204 }) });
    render(<App />);
    await connected();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar sessão" }));
    await confirmInDialog("Encerrar sessão");

    expect(await screen.findByText("Sessão encerrada.")).toBeTruthy();
    expect(api.count("POST", "/api/sessions/s1/end")).toBe(1);
  });

  it.each([
    [404, "not_found"],
    [403, "forbidden"],
  ])("forgets a saved session the server rejects with %i", async (status, code) => {
    resumeAs("phone");
    fakeApi({ "GET /api/sessions/s1": () => ({ status, body: { code } }) });
    render(<App />);
    (await FakeWebSocket.next("sessionId", "s1")).drop(); // handshake rejected

    expect(await screen.findByText("A sessão não está mais disponível.")).toBeTruthy();
    expect(localStorage.getItem("linkdrop:phone")).toBeNull();
  });

  it("reconnects with growing delays and resets them after a successful connection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.spyOn(Math, "random").mockReturnValue(1); // no jitter: delays are exactly 1s, 2s, 4s…
    resumeAs("phone");
    fakeApi({ "GET /api/sessions/s1": () => ({ status: 200, body: { id: "s1", role: "phone", items: [] } }) });
    render(<App />);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    const reconnectsAfter = async (ms: number) => {
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.latest().drop();
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
    };
    await reconnectsAfter(1_000);
    await reconnectsAfter(2_000);
    await reconnectsAfter(4_000);
    expect(screen.getByText("A conexão está instável. Tentaremos novamente automaticamente.")).toBeTruthy();

    await reconnectsAfter(8_000);
    await reconnectsAfter(16_000);
    await reconnectsAfter(30_000);
    await reconnectsAfter(30_000);

    FakeWebSocket.latest().open();
    await reconnectsAfter(1_000);
  });

  it("never retries sooner than one second, even with jitter", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.spyOn(Math, "random").mockReturnValue(0);
    resumeAs("phone");
    fakeApi({ "GET /api/sessions/s1": () => ({ status: 200, body: { id: "s1", role: "phone", items: [] } }) });
    render(<App />);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.latest().drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe("composer shortcuts", () => {
  function stubClipboard(clipboard: object) {
    vi.stubGlobal("navigator", { ...navigator, language: "pt-BR", clipboard });
  }

  it("pastes the clipboard into the content field with one tap", async () => {
    resumeAs("phone");
    fakeApi({});
    stubClipboard({ readText: vi.fn(async () => "https://example.com/pasted") });
    render(<App />);
    await connected();

    fireEvent.click(await screen.findByRole("button", { name: "Colar" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Link ou texto") as HTMLTextAreaElement).value).toBe("https://example.com/pasted"),
    );
  });

  it("shows the character count only when the text nears the limit", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    await connected();
    const field = await screen.findByLabelText("Link ou texto");

    fireEvent.input(field, { target: { value: "a".repeat(7_999) } });
    expect(screen.queryByText(/\/ 10\.000/)).toBeNull();

    fireEvent.input(field, { target: { value: "a".repeat(8_000) } });
    expect(screen.getByText("8.000 / 10.000")).toBeTruthy();
  });

  it("explains when the clipboard cannot be read", async () => {
    resumeAs("phone");
    fakeApi({});
    stubClipboard({
      readText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    render(<App />);
    await connected();

    fireEvent.click(await screen.findByRole("button", { name: "Colar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("área de transferência");
  });

  it("hides the paste button where the browser cannot read the clipboard", async () => {
    resumeAs("phone");
    fakeApi({});
    stubClipboard({ writeText: vi.fn() });
    render(<App />);
    await connected();

    await screen.findByLabelText("Link ou texto");
    expect(screen.queryByRole("button", { name: "Colar" })).toBeNull();
  });

  it("sends with Ctrl+Enter or Cmd+Enter, but not with a plain Enter", async () => {
    resumeAs("phone");
    const api = fakeApi({ "POST /api/sessions/s1/items": () => ({ status: 201, body: link }) });
    render(<App />);
    await connected();
    const field = await screen.findByLabelText("Link ou texto");

    fireEvent.input(field, { target: { value: "first line" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(api.calls).toHaveLength(0);

    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0].body).toEqual({ title: "", content: "first line" });

    fireEvent.input(field, { target: { value: "second" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => expect(api.calls).toHaveLength(2));
  });
});

describe("new item alert", () => {
  let hidden = false;
  const vibrate = vi.fn();

  beforeEach(() => {
    hidden = false;
    vibrate.mockClear();
    document.title = "LinkDrop";
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    vi.stubGlobal("navigator", { ...navigator, language: "pt-BR", vibrate });
  });

  afterEach(() => {
    delete (document as { hidden?: boolean }).hidden;
  });

  const second = { ...link, id: "i9", content: "https://example.org" };

  it("flags the tab title and vibrates when an item arrives while the page is hidden", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link] });
    await screen.findByRole("article");
    expect(document.title).toBe("LinkDrop");

    hidden = true;
    socket.receive({ type: "session", id: "s1", role: "phone", items: [second, link] });
    await waitFor(() => expect(document.title).toBe("(1) LinkDrop"));
    expect(vibrate).toHaveBeenCalledTimes(1);

    socket.receive({ type: "session", id: "s1", role: "phone", items: [{ ...second, id: "i10" }, second, link] });
    await waitFor(() => expect(document.title).toBe("(2) LinkDrop"));

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("LinkDrop");
  });

  it("stays quiet for the first snapshot, a visible page, reconnect replays and removals", async () => {
    resumeAs("phone");
    fakeApi({});
    hidden = true;
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link, second] });
    await screen.findAllByRole("article");
    expect(document.title).toBe("LinkDrop");

    socket.receive({ type: "session", id: "s1", role: "phone", items: [second] });
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link, second] });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(document.title).toBe("LinkDrop");
    expect(vibrate).not.toHaveBeenCalled();

    hidden = false;
    socket.receive({ type: "session", id: "s1", role: "phone", items: [{ ...link, id: "new" }, link, second] });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(document.title).toBe("LinkDrop");
  });
});

describe("session experience", () => {
  it("counts down the time left from what the server reports and offers renewal when low", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 30 * 60_000 });
    const timer = await screen.findByRole("button", { name: /Manter sessão ativa/ });
    expect(timer.textContent).toContain("30 min restantes");
    expect(timer.textContent).not.toContain("Renovar");

    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 4 * 60_000 });
    expect(await screen.findByText("4 min restantes")).toBeTruthy();
    expect(timer.textContent).toContain("Renovar");

    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 30_000 });
    expect(await screen.findByText("Menos de 1 min restante")).toBeTruthy();
    expect(timer.textContent).toContain("Renovar");
  });

  it("tapping the timer sends activity, disables the button during request, and shows a toast", async () => {
    resumeAs("phone");
    let resolveActivity: () => void = () => {};
    const pendingActivity = new Promise<void>((resolve) => {
      resolveActivity = resolve;
    });
    const api = fakeApi({
      "POST /api/sessions/s1/activity": async () => {
        await pendingActivity;
        return { status: 204 };
      },
    });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 4 * 60_000 });

    const timer = await screen.findByRole("button", { name: /Manter sessão ativa/ });
    fireEvent.click(timer);

    expect(timer.hasAttribute("disabled")).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].method).toBe("POST");
    expect(api.calls[0].path).toBe("/api/sessions/s1/activity");
    expect(api.calls[0].headers.get("x-endpoint-key")).toBe("phone-key");

    resolveActivity();
    expect(await screen.findByText("Sessão renovada")).toBeTruthy();
    await waitFor(() => expect(timer.hasAttribute("disabled")).toBe(false));

    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 30 * 60_000 });
    expect(await screen.findByText("30 min restantes")).toBeTruthy();
    expect(timer.textContent).not.toContain("Renovar");
  });

  it("handles activity failure on timer tap, including session not found", async () => {
    resumeAs("phone");
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 404, body: { code: "not_found", message: "Gone" } }),
    });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 4 * 60_000 });

    const timer = await screen.findByRole("button", { name: /Manter sessão ativa/ });
    fireEvent.click(timer);

    expect(await screen.findByText("A sessão não está mais disponível.")).toBeTruthy();
  });

  it("shows error toast when renewing fails due to network error", async () => {
    resumeAs("phone");
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 500, body: { code: "generic", message: "Error" } }),
    });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [], expiresInMs: 4 * 60_000 });

    const timer = await screen.findByRole("button", { name: /Manter sessão ativa/ });
    fireEvent.click(timer);

    expect(await screen.findByText("Não foi possível concluir a ação.")).toBeTruthy();
  });

  it("shows no countdown until the server has reported a deadline", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    await connected();
    await screen.findByLabelText("Link ou texto");
    expect(screen.queryByText(/restantes|restante$/)).toBeNull();
  });

  it("confirms a copy with a toast", async () => {
    resumeAs("phone");
    vi.stubGlobal("navigator", { ...navigator, language: "pt-BR", clipboard: { writeText: vi.fn(async () => {}) } });
    fakeApi({ "POST /api/sessions/s1/activity": () => ({ status: 204 }) });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [note] });
    fireEvent.click(await screen.findByRole("button", { name: "Copiar" }));

    expect((await screen.findByRole("status")).textContent).toBe("Copiado para a área de transferência");
  });

  it("keeps the optional title out of the way until asked for", async () => {
    resumeAs("phone");
    const api = fakeApi({ "POST /api/sessions/s1/items": () => ({ status: 201, body: link }) });
    render(<App />);
    await connected();

    await screen.findByLabelText("Link ou texto");
    expect(screen.queryByLabelText("Título (opcional)")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Adicionar título" }));
    fireEvent.input(screen.getByLabelText("Título (opcional)"), { target: { value: "Doc" } });
    fireEvent.input(screen.getByLabelText("Link ou texto"), { target: { value: "https://example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: "Enviar" }).closest("form")!);

    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0].body).toEqual({ title: "Doc", content: "https://example.com" });
    await waitFor(() => expect(screen.queryByLabelText("Título (opcional)")).toBeNull());
  });

  it("headlines an untitled link with its host and a titled one with its title", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const titled = { ...link, id: "i7", title: "Docs", content: "https://example.org/docs" };
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [link, titled] });

    expect(await screen.findByRole("heading", { name: "example.com" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Docs" })).toBeTruthy();
  });

  it("marks each link with its site's initial, in the same color wherever the site repeats", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const items = [
      { ...link, id: "a", content: "https://www.github.com/one" },
      { ...link, id: "b", title: "Two", content: "https://github.com/two" },
      note,
    ];
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items });

    const [first, second, third] = await screen.findAllByRole("article");
    const avatar = (article: HTMLElement) => article.querySelector(".item-avatar");
    expect(avatar(first)?.textContent).toBe("G");
    expect(avatar(second)?.textContent).toBe("G");
    expect(avatar(second)?.className).toBe(avatar(first)?.className);
    expect(avatar(third)).toBeNull();
  });

  it("shows a link without its scheme and www, but opens the full address", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const video = { ...link, id: "i8", content: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [video] });

    expect(await screen.findByRole("heading", { name: "youtube.com" })).toBeTruthy();
    expect(screen.getByText("/watch?v=dQw4w9WgXcQ")).toBeTruthy();
    expect(screen.queryByText(video.content)).toBeNull();
    expect(screen.getByRole("link", { name: "Abrir link" }).getAttribute("href")).toBe(video.content);
  });

  it("shows accented paths as typed, not percent-encoded", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    const accented = { ...link, id: "i9", content: "https://example.com/a%C3%A7%C3%A3o?q=s%C3%A3o" };
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [accented] });

    expect(await screen.findByText("/ação?q=são")).toBeTruthy();
  });
});

describe("item spotlight", () => {
  it("opens a link as a QR code spotlight and records activity", async () => {
    resumeAs("phone");
    const api = fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 204 }),
    });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link] });

    const qrButton = await screen.findByRole("button", { name: "Mostrar QR" });
    fireEvent.click(qrButton);

    expect(api.calls.some((c) => c.path === "/api/sessions/s1/activity")).toBe(true);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "example.com" })).toBeTruthy();
    expect(within(dialog).getByText("example.com", { selector: ".spotlight-url" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copiar" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Abrir link" }).getAttribute("href")).toBe("https://example.com");

    const img = within(dialog).getByRole("img");
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);

    const main = document.querySelector("main.shell");
    expect(main?.hasAttribute("inert")).toBe(true);
  });

  it("copies a link from its spotlight", async () => {
    resumeAs("phone");
    vi.stubGlobal("navigator", { ...navigator, language: "pt-BR", clipboard: { writeText: vi.fn(async () => {}) } });
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 204 }),
    });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [link] });

    fireEvent.click(await screen.findByRole("button", { name: "Mostrar QR" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Copiar" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.content);
    expect(await within(dialog).findByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("handles URLs too long to generate a QR code with a fallback message", async () => {
    resumeAs("phone");
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 204 }),
    });
    render(<App />);
    const socket = await connected();
    const longUrl = "https://example.com/" + "a".repeat(4000);
    const longLink = { id: "long", content: longUrl, type: "link", createdAt: "2026-07-09T10:00:00Z" };
    socket.receive({ type: "session", id: "s1", role: "phone", items: [longLink] });

    const qrButton = await screen.findByRole("button", { name: "Mostrar QR" });
    fireEvent.click(qrButton);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Este link é longo demais para virar QR.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copiar" })).toBeTruthy();
  });

  it("closes spotlight with close button, backdrop click, or Escape and restores focus", async () => {
    resumeAs("phone");
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 204 }),
    });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link] });

    const qrButton = await screen.findByRole("button", { name: "Mostrar QR" });
    qrButton.focus();
    fireEvent.click(qrButton);

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(qrButton);

    fireEvent.click(qrButton);
    const dialog2 = await screen.findByRole("dialog");
    const closeBtn = within(dialog2).getByRole("button", { name: "Fechar destaque" });
    fireEvent.click(closeBtn);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes spotlight automatically if the item is removed or list is cleared", async () => {
    resumeAs("phone");
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 204 }),
    });
    render(<App />);
    const socket = await connected();
    socket.receive({ type: "session", id: "s1", role: "phone", items: [link] });

    const qrButton = await screen.findByRole("button", { name: "Mostrar QR" });
    fireEvent.click(qrButton);

    expect(await screen.findByRole("dialog")).toBeTruthy();

    socket.receive({ type: "session", id: "s1", role: "phone", items: [] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens a note in full-screen spotlight with formatted text, length-based tier class, and copy", async () => {
    resumeAs("phone");
    vi.stubGlobal("navigator", { ...navigator, language: "pt-BR", clipboard: { writeText: vi.fn(async () => {}) } });
    fakeApi({
      "POST /api/sessions/s1/activity": () => ({ status: 204 }),
    });
    render(<App />);
    const socket = await connected();
    const shortNote = {
      id: "n1",
      title: "Wi-Fi",
      content: "Senha: 123\nRede: sala",
      type: "text",
      createdAt: "2026-07-09T10:00:00Z",
    };
    socket.receive({ type: "session", id: "s1", role: "phone", items: [shortNote, link] });

    const articles = await screen.findAllByRole("article");
    expect(within(articles[0]).queryByRole("button", { name: "Mostrar QR" })).toBeNull();
    const enlargeBtn = within(articles[0]).getByRole("button", { name: "Ampliar" });
    expect(within(articles[1]).queryByRole("button", { name: "Ampliar" })).toBeNull();

    fireEvent.click(enlargeBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Wi-Fi" })).toBeTruthy();
    const contentEl = within(dialog).getByText(/Senha: 123/);
    expect(contentEl.textContent).toBe(shortNote.content);
    expect(contentEl.className).toContain("spotlight-note-short");

    const copyBtn = within(dialog).getByRole("button", { name: "Copiar" });
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shortNote.content);
  });
});

function rejoinPairing(token = "rejoin-tok") {
  return {
    status: 201,
    body: {
      token,
      screenKey: "screen-key",
      expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      pairingUrl: `http://linkdrop.test/pair/${token}`,
    },
  };
}

describe("phone rejoin from screen", () => {
  it("shows reconnect phone button only for screen role", async () => {
    resumeAs("phone");
    fakeApi({});
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "phone", items: [] });
    expect(screen.queryByRole("button", { name: "Reconectar celular" })).toBeNull();

    cleanup();
    resumeAs("screen");
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [] });
    expect(await screen.findByRole("button", { name: "Reconectar celular" })).toBeTruthy();
  });

  it("opens reconnect dialog, shows warning, QR, and closes upon pairing", async () => {
    resumeAs("screen");
    const rejoinResponse = {
      status: 201,
      body: {
        token: "rejoin-tok",
        screenKey: "screen-key",
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        pairingUrl: "http://linkdrop.test/pair/rejoin-tok",
      },
    };
    fakeApi({
      "POST /api/sessions/s1/pairing": () => rejoinResponse,
    });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [] });

    const btn = await screen.findByRole("button", { name: "Reconectar celular" });
    fireEvent.click(btn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Reconectar celular" })).toBeTruthy();
    expect(within(dialog).getByText("O celular conectado agora será desconectado.")).toBeTruthy();
    expect(await within(dialog).findByRole("img")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copiar link de acesso" })).toBeTruthy();

    const pairingSocket = await FakeWebSocket.next("pairingToken", "rejoin-tok");
    pairingSocket.open();
    pairingSocket.receive({ type: "paired", sessionId: "s1", endpointKey: "screen-key", role: "screen" });

    expect(await within(dialog).findByText("Celular conectado!")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows generate new code button when pairing expires and does not auto-renew", async () => {
    resumeAs("screen");
    let count = 0;
    fakeApi({
      "POST /api/sessions/s1/pairing": () => {
        count++;
        return {
          status: 201,
          body: {
            token: `rejoin-tok-${count}`,
            screenKey: "screen-key",
            expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
            pairingUrl: `http://linkdrop.test/pair/rejoin-tok-${count}`,
          },
        };
      },
    });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [] });

    const btn = await screen.findByRole("button", { name: "Reconectar celular" });
    fireEvent.click(btn);

    const dialog = await screen.findByRole("dialog");
    const pairingSocket = await FakeWebSocket.next("pairingToken", "rejoin-tok-1");
    pairingSocket.open();
    pairingSocket.receive({ type: "pairing_expired" });

    const renewBtn = await within(dialog).findByRole("button", { name: "Gerar novo código" });
    expect(renewBtn).toBeTruthy();
    expect(count).toBe(1); // did not renew automatically!

    fireEvent.click(renewBtn);
    await waitFor(() => expect(count).toBe(2));
  });

  it("counts down to expiry without promising a renewal", async () => {
    resumeAs("screen");
    fakeApi({ "POST /api/sessions/s1/pairing": () => rejoinPairing() });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [] });

    fireEvent.click(await screen.findByRole("button", { name: "Reconectar celular" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText(/^Expira em /)).toBeTruthy();
    expect(within(dialog).queryByText(/Renova em/)).toBeNull();
    expect(within(dialog).queryByText("O código é renovado automaticamente.")).toBeNull();
  });

  it("ends the session when it is gone before a code can be issued", async () => {
    resumeAs("screen");
    fakeApi({
      "POST /api/sessions/s1/pairing": () => ({ status: 404, body: { code: "not_found" } }),
      "POST /api/screens": () => ({ status: 503, body: { code: "shutting_down" } }),
    });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [] });

    fireEvent.click(await screen.findByRole("button", { name: "Reconectar celular" }));

    expect(await screen.findByText("A sessão não está mais disponível.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("linkdrop:screen")).toBeNull();
  });

  it("does not close a reopened dialog when an earlier pairing confirmation runs out", async () => {
    resumeAs("screen");
    let count = 0;
    fakeApi({ "POST /api/sessions/s1/pairing": () => rejoinPairing(`rejoin-tok-${++count}`) });
    render(<App />);
    (await connected()).receive({ type: "session", id: "s1", role: "screen", items: [] });

    const open = await screen.findByRole("button", { name: "Reconectar celular" });
    fireEvent.click(open);
    const pairingSocket = await FakeWebSocket.next("pairingToken", "rejoin-tok-1");
    pairingSocket.open();
    pairingSocket.receive({ type: "paired", sessionId: "s1", endpointKey: "screen-key", role: "screen" });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Celular conectado!")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar reconexão" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(open);
    await FakeWebSocket.next("pairingToken", "rejoin-tok-2");

    await new Promise((resolve) => setTimeout(resolve, CONNECTED_MS + 100));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
