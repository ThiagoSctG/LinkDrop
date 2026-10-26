import { webcrypto } from "node:crypto";
// Exercise the real AES-GCM implementation, not a crypto mock.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
