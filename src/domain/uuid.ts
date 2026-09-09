/**
 * Issue #71: crypto.randomUUID is only exposed on secure contexts
 * (https / localhost). The app is served over plain HTTP on the LAN
 * (http://192.168.68.52/english/), where the API is undefined and the
 * result screen crashed with "crypto.randomUUID is not a function".
 * Fall back to a getRandomValues-based v4 UUID; Math.random only when
 * WebCrypto itself is missing (legacy embedders).
 */
function randomBytes16(): Uint8Array {
  const bytes = new Uint8Array(16);
  const c: Crypto | undefined =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function uuid(): string {
  const c: Crypto | undefined =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = randomBytes16();
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10x
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
