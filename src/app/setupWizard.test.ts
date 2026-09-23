import { describe, expect, it } from "vitest";
import {
  setupSelfCheckItems,
  shouldOfferSetupWizard,
  suggestedEndpoint,
} from "./setupWizard";
import { DEFAULT_SETTINGS } from "../storage/types";

describe("shouldOfferSetupWizard (issue #121)", () => {
  it("エンドポイントが初期値のままなら提案する", () => {
    expect(
      shouldOfferSetupWizard({
        llmApiEndpoint: DEFAULT_SETTINGS.llmApiEndpoint,
      }),
    ).toBe(true);
  });

  it("エンドポイントが空でも提案する", () => {
    expect(shouldOfferSetupWizard({ llmApiEndpoint: "   " })).toBe(true);
  });

  it("設定済み（LAN IP など）なら提案しない", () => {
    expect(
      shouldOfferSetupWizard({
        llmApiEndpoint: "http://192.168.68.52:11434/v1",
      }),
    ).toBe(false);
  });

  it("スキップ済みなら初期値のままでも提案しない", () => {
    expect(
      shouldOfferSetupWizard({
        llmApiEndpoint: DEFAULT_SETTINGS.llmApiEndpoint,
        llmSetupDismissed: true,
      }),
    ).toBe(false);
  });
});

describe("suggestedEndpoint (issue #121)", () => {
  it("配信ホスト名から Ollama の標準URLを推定する", () => {
    expect(suggestedEndpoint("192.168.68.52")).toBe(
      "http://192.168.68.52:11434/v1",
    );
  });

  it("localhost では推定せず空を返す（自分自身を指してしまうため）", () => {
    expect(suggestedEndpoint("localhost")).toBe("");
    expect(suggestedEndpoint("127.0.0.1")).toBe("");
    expect(suggestedEndpoint("")).toBe("");
  });
});

describe("setupSelfCheckItems (issue #121)", () => {
  it("既定ではサーバー側の待ち受け/CORS/ポートを確認させる", () => {
    const items = setupSelfCheckItems(null);
    expect(items.join("\n")).toContain("OLLAMA_HOST");
    expect(items.join("\n")).toContain("CORS");
    expect(items.join("\n")).toContain("/v1");
  });

  it("CORS拒否のときは CORS を先頭で案内する", () => {
    const items = setupSelfCheckItems("cors-blocked");
    expect(items[0]).toContain("CORS");
  });

  it("到達不可のときは URL/ポートを先頭で案内する", () => {
    const items = setupSelfCheckItems("unreachable");
    expect(items[0]).toContain("到達できていません");
  });
});
