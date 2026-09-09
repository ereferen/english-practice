import { afterEach, describe, expect, it } from "vitest";
import { uuid } from "./uuid";

// Issue #71: on plain-HTTP LAN origins crypto.randomUUID is undefined
// (secure-context-only) and the result screen crashed. uuid() must
// work with and without it.

const realCrypto = globalThis.crypto;

function withoutRandomUUID() {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: realCrypto,
  });
});

describe("uuid (issue #71)", () => {
  it("returns a v4-shaped uuid via native randomUUID when available", () => {
    const id = uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("falls back to getRandomValues when randomUUID is absent (http origin)", () => {
    withoutRandomUUID();
    const id = uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(new Set([uuid(), uuid(), uuid()]).size).toBe(3);
  });

  it("first 8 chars are hex, usable for batch ids", () => {
    withoutRandomUUID();
    expect(uuid().slice(0, 8)).toMatch(/^[0-9a-f]{8}$/);
  });
});
