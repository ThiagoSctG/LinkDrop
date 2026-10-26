import { gcm } from "@noble/ciphers/aes.js";
import type { Connection, EncryptedItem, Item, Pairing } from "./api";
import { isLinkText } from "./time";

const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CIPHERTEXT_BYTES = 65_536;

export class ContentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function cryptoAvailable(): boolean {
  return typeof globalThis.crypto?.getRandomValues === "function";
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ContentError("encryption");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new ContentError("encryption");
  return bytes;
}

export function validEncryptionKey(value: unknown): value is string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) return false;
  try {
    return decode(value).length === 32;
  } catch {
    return false;
  }
}

export function createEncryptionKey(): string {
  if (!cryptoAvailable()) throw new ContentError("crypto_unavailable");
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

/** Only the fragment carries the encryption key; it never belongs in an HTTP request. */
export function pairingWithKey(pairing: Omit<Pairing, "encryptionKey">, encryptionKey: string): Pairing {
  if (!validEncryptionKey(encryptionKey)) throw new ContentError("encryption");
  // Build locally rather than trusting a server-supplied origin with a client secret.
  const url = new URL(`/pair/${encodeURIComponent(pairing.token)}`, window.location.origin);
  url.hash = `key=${encryptionKey}`;
  return { ...pairing, encryptionKey, pairingUrl: url.href };
}

export function readPairingKey(): string | null {
  const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
  return validEncryptionKey(key) ? key : null;
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!validEncryptionKey(secret)) throw new ContentError("encryption");
  return crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function randomItemID(): string {
  // randomUUID is restricted to secure contexts; getRandomValues is available on HTTP too.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function payload(title: unknown, content: unknown): Pick<Item, "title" | "content" | "type"> {
  if (typeof title !== "string" || typeof content !== "string") throw new ContentError("encryption");
  if (!content.trim()) throw new ContentError("content_empty");
  if (Array.from(content).length > 10_000) throw new ContentError("content_too_long");
  const normalizedTitle = title.trim();
  if (Array.from(normalizedTitle).length > 200) throw new ContentError("title_too_long");
  const link = isLinkText(content);
  return { title: normalizedTitle, content: link ? content.trim() : content, type: link ? "link" : "text" };
}

function associatedData(sessionId: string, id: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(["linkdrop.item.v1", sessionId, id]));
}

export async function encryptItem(
  connection: Connection,
  title: string,
  content: string,
): Promise<Omit<EncryptedItem, "createdAt">> {
  const normalized = payload(title, content);
  if (!cryptoAvailable() || !validEncryptionKey(connection.encryptionKey)) throw new ContentError("encryption");
  const id = randomItemID();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = associatedData(connection.sessionId, id);
  const plaintext = new TextEncoder().encode(JSON.stringify({ title: normalized.title, content: normalized.content }));
  const data = crypto.subtle
    ? await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        await importKey(connection.encryptionKey),
        plaintext,
      )
    : gcm(decode(connection.encryptionKey), iv, aad).encrypt(plaintext);
  return { id, encrypted: { v: 1, iv: encode(iv), data: encode(new Uint8Array(data)) } };
}

export async function decryptItem(connection: Connection, item: EncryptedItem): Promise<Item> {
  const envelope = item.encrypted;
  if (
    !envelope ||
    envelope.v !== 1 ||
    typeof envelope.iv !== "string" ||
    envelope.iv.length !== 16 ||
    typeof envelope.data !== "string" ||
    envelope.data.length > Math.ceil((MAX_CIPHERTEXT_BYTES * 4) / 3)
  ) {
    throw new ContentError("encryption");
  }
  if (!validEncryptionKey(connection.encryptionKey)) throw new ContentError("encryption");
  const iv = decode(envelope.iv);
  const aad = associatedData(connection.sessionId, item.id);
  const ciphertext = decode(envelope.data);
  const plaintext = globalThis.crypto?.subtle
    ? await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: aad,
          tagLength: 128,
        },
        await importKey(connection.encryptionKey),
        ciphertext,
      )
    : gcm(decode(connection.encryptionKey), iv, aad).decrypt(ciphertext);
  const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  // Never trust a supplied item type, even after decryption: classify safe links locally.
  return { id: item.id, createdAt: item.createdAt, ...payload(decoded.title, decoded.content) };
}
