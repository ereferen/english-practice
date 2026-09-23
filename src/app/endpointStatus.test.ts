import { describe, expect, it } from "vitest";
import { endpointWarning } from "./endpointStatus";
import { DEFAULT_SETTINGS } from "../storage/types";

function settings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("endpointWarning (issue #121)", () => {
  it("初期値 localhost のままなら default 警告", () => {
    const w = endpointWarning(settings());
    expect(w?.kind).toBe("default");
    expect(w?.message).toContain("localhost:11434");
  });

  it("エンドポイントが空なら missing 警告", () => {
    const w = endpointWarning(settings({ llmApiEndpoint: "   " }));
    expect(w?.kind).toBe("missing");
  });

  it("LAN エンドポイントでも未検証なら unverified 警告", () => {
    const w = endpointWarning(
      settings({ llmApiEndpoint: "http://192.168.68.52:11434/v1" }),
    );
    expect(w?.kind).toBe("unverified");
  });

  it("接続テスト成功済みなら警告なし", () => {
    const w = endpointWarning(
      settings({
        llmApiEndpoint: "http://192.168.68.52:11434/v1",
        llmVerifiedEndpoint: "http://192.168.68.52:11434/v1",
      }),
    );
    expect(w).toBeNull();
  });

  it("検証済みエンドポイントを書き換えたら unverified に戻る", () => {
    const w = endpointWarning(
      settings({
        llmApiEndpoint: "http://192.168.68.52:11434/v1",
        llmVerifiedEndpoint: "http://other-host:11434/v1",
      }),
    );
    expect(w?.kind).toBe("unverified");
  });

  it("空白差は同一エンドポイントとして扱う", () => {
    const w = endpointWarning(
      settings({
        llmApiEndpoint: " http://192.168.68.52:11434/v1 ",
        llmVerifiedEndpoint: "http://192.168.68.52:11434/v1",
      }),
    );
    expect(w).toBeNull();
  });
});
