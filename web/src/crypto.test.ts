import { describe, expect, it, vi } from "vitest";
import type { Connection, EncryptedItem } from "./api";
import { createEncryptionKey, decryptItem, encryptItem, pairingWithKey, validEncryptionKey } from "./crypto";
import { loadConnection, saveConnection } from "./storage";

const connection = (): Connection => ({
  sessionId: "s1",
  endpointKey: "device",
  role: "screen",
  encryptionKey: createEncryptionKey(),
});
const timestamp = "2026-10-26T00:00:00Z";
const wire = async (c: Connection, title: string, content: string): Promise<EncryptedItem> => ({
  ...(await encryptItem(c, title, content)),
  createdAt: timestamp,
});

describe("end-to-end encryption", () => {
  it("interoperates between native AES-GCM and the HTTP implementation without subtle or randomUUID", async () => {
    const c = connection();
    const nativeItem = await wire(c, "Native", "HTTPS to HTTP");
    let httpItem: EncryptedItem;
    try {
      vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
      vi.stubGlobal("isSecureContext", false);
      expect(await decryptItem(c, nativeItem)).toMatchObject({ content: "HTTPS to HTTP" });
      httpItem = await wire(c, "HTTP", "HTTP to HTTPS");
      expect(httpItem.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      await expect(decryptItem({ ...c, encryptionKey: createEncryptionKey() }, httpItem)).rejects.toBeDefined();
      await expect(decryptItem({ ...c, sessionId: "wrong" }, httpItem)).rejects.toBeDefined();
      await expect(decryptItem(c, { ...httpItem, id: "wrong" })).rejects.toBeDefined();
      const data = httpItem.encrypted.data;
      await expect(
        decryptItem(c, {
          ...httpItem,
          encrypted: { ...httpItem.encrypted, data: (data[0] === "A" ? "B" : "A") + data.slice(1) },
        }),
      ).rejects.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await decryptItem(c, httpItem!)).toMatchObject({ title: "HTTP", content: "HTTP to HTTPS" });
  });

  it("round-trips title and content on a second device without exposing them on the wire", async () => {
    const screen = connection();
    const item = await wire(screen, "Private title", "Private text with Unicode: 🔒 ç");
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("Private");
    expect(serialized).not.toContain(screen.encryptionKey);
    expect(Object.keys(item).sort()).toEqual(["createdAt", "encrypted", "id"]);
    expect(await decryptItem({ ...screen, role: "phone", endpointKey: "phone" }, item)).toMatchObject({
      title: "Private title",
      content: "Private text with Unicode: 🔒 ç",
      type: "text",
    });
    const again = await wire(screen, "Private title", "Private text with Unicode: 🔒 ç");
    expect(again.encrypted.iv).not.toBe(item.encrypted.iv);
    expect(again.encrypted.data).not.toBe(item.encrypted.data);
  });

  it("authenticates ciphertext, nonce, key, session and item identity", async () => {
    const c = connection();
    const item = await wire(c, "", "secret");
    await expect(decryptItem({ ...c, encryptionKey: createEncryptionKey() }, item)).rejects.toBeDefined();
    await expect(decryptItem({ ...c, sessionId: "other" }, item)).rejects.toBeDefined();
    await expect(decryptItem(c, { ...item, id: crypto.randomUUID() })).rejects.toBeDefined();
    for (const field of ["iv", "data"] as const) {
      const value = item.encrypted[field];
      const corrupted = (value[0] === "A" ? "B" : "A") + value.slice(1);
      await expect(
        decryptItem(c, { ...item, encrypted: { ...item.encrypted, [field]: corrupted } }),
      ).rejects.toBeDefined();
    }
    await expect(
      decryptItem(c, { ...item, encrypted: { ...item.encrypted, v: 2 } } as unknown as EncryptedItem),
    ).rejects.toBeDefined();
    await expect(
      decryptItem(c, { id: item.id, content: "legacy plaintext" } as unknown as EncryptedItem),
    ).rejects.toBeDefined();
  });

  it.each([
    ["https://example.com/path", "link"],
    ["  HTTP://EXAMPLE.COM  ", "link"],
    ["javascript:alert(1)", "text"],
    ["data:text/html,<script>alert(1)</script>", "text"],
    ["<img src=x onerror=alert(1)>", "text"],
    ["https://example.com and words", "text"],
    ["https://", "text"],
  ])("classifies decrypted content safely: %s", async (content, type) => {
    const c = connection();
    expect(await decryptItem(c, await wire(c, "", content))).toMatchObject({ type });
  });

  it("enforces content limits locally, including Unicode and JSON escaping", async () => {
    const c = connection();
    for (const content of ["🔒".repeat(10_000), "\u0000".repeat(10_000)]) {
      const item = await wire(c, "\u0000".repeat(200), content);
      expect(item.encrypted.data.length).toBeLessThanOrEqual(Math.ceil((65_536 * 4) / 3));
      expect((await decryptItem(c, item)).content).toBe(content);
    }
    await expect(encryptItem(c, "", " ")).rejects.toMatchObject({ code: "content_empty" });
    await expect(encryptItem(c, "", "🔒".repeat(10_001))).rejects.toMatchObject({ code: "content_too_long" });
    await expect(encryptItem(c, "t".repeat(201), "ok")).rejects.toMatchObject({ code: "title_too_long" });
  });

  it("keeps the key in the local-origin URL fragment, including replacement QR codes", () => {
    const c = connection();
    const secured = pairingWithKey(
      { token: "token", screenKey: "screen", expiresAt: timestamp, pairingUrl: "https://untrusted.example/pair/token" },
      c.encryptionKey,
    );
    const url = new URL(secured.pairingUrl);
    expect(url.origin).toBe(window.location.origin);
    expect(url.hash).toBe(`#key=${c.encryptionKey}`);
    expect(url.pathname + url.search).not.toContain(c.encryptionKey);
    expect(secured.encryptionKey).toBe(c.encryptionKey);
    expect(validEncryptionKey(c.encryptionKey)).toBe(true);
    expect(validEncryptionKey("invalid")).toBe(false);
  });

  it("resumes with the device's key and discards old plaintext-era credentials", () => {
    localStorage.clear();
    const c = connection();
    saveConnection(c);
    expect(loadConnection("screen")).toEqual(c);
    const { encryptionKey: _, ...legacy } = c;
    localStorage.setItem("linkdrop:screen", JSON.stringify(legacy));
    expect(loadConnection("screen")).toBeNull();
    expect(localStorage.getItem("linkdrop:screen")).toBeNull();
  });
});
