import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings, { describeImportError } from "./Settings";
import { DEFAULT_SETTINGS } from "../storage/types";
import type { StorageProvider } from "../storage/types";
import { initialState } from "../app/types";

function makeStorage(): StorageProvider {
  return {
    loadSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async () => {}),
  } as unknown as StorageProvider;
}

/**
 * Issue #170: 「設定を開く」→「戻る」で常にホームへ落ちていた。設定に入る直前の
 * 画面（会話など）へ戻れるようにする App 側の配線を、Settings の props で固定する。
 */
describe("Settings (issue #170 戻り先)", () => {
  it("onBack / backLabel を渡すと、その画面へ戻るボタンになる", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <Settings
        state={initialState}
        dispatch={vi.fn()}
        storage={makeStorage()}
        onBack={onBack}
        backLabel="会話に戻る"
      />,
    );

    const back = await screen.findByRole("button", { name: "会話に戻る" });
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("onBack 未指定なら従来どおりホームへ戻る", async () => {
    const dispatch = vi.fn();
    const user = userEvent.setup();
    render(
      <Settings
        state={initialState}
        dispatch={dispatch}
        storage={makeStorage()}
      />,
    );

    const back = await screen.findByRole("button", { name: "戻る" });
    await user.click(back);
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "home" },
    });
  });
});

// Issue #213: 「保存済み: ✓ エンドポイント記録」「⚠ 未検証」「⚠ 初期値のまま」が
// 3行並び、現在地が読めなかった。実状態を1行のステータスに畳む。
describe("Settings LLM 設定ステータス (issue #213)", () => {
  async function renderWith(overrides: Partial<typeof DEFAULT_SETTINGS>) {
    const storage = {
      loadSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, ...overrides })),
      saveSettings: vi.fn(async () => {}),
    } as unknown as StorageProvider;
    render(
      <Settings state={initialState} dispatch={vi.fn()} storage={storage} />,
    );
    return screen.findByTestId("llm-config-status");
  }

  it("初期値のままなら「未設定」だけを出す", async () => {
    const status = await renderWith({});
    expect(status).toHaveAttribute("data-state", "unset");
    expect(status).toHaveTextContent("未設定");
    expect(status).toHaveTextContent("初期値（localhost）のまま");
    // 「保存済み」「未検証」を別行で並べない
    expect(status).not.toHaveTextContent("エンドポイント記録");
    expect(screen.queryByText(/⚠ 未検証/)).toBeNull();
    expect(screen.getAllByTestId("llm-config-status")).toHaveLength(1);
  });

  it("自前のエンドポイントで未検証なら「保存済み（未検証）」", async () => {
    const status = await renderWith({
      llmApiEndpoint: "http://example.test:11434/v1",
    });
    expect(status).toHaveAttribute("data-state", "saved");
    expect(status).toHaveTextContent("保存済み（未検証）");
    expect(status).toHaveTextContent("接続テスト");
  });

  it("接続テスト済みのエンドポイントなら「検証済み」", async () => {
    const status = await renderWith({
      llmApiEndpoint: "http://example.test:11434/v1",
      llmVerifiedEndpoint: "http://example.test:11434/v1",
    });
    expect(status).toHaveAttribute("data-state", "verified");
    expect(status).toHaveTextContent("検証済み");
  });
});

// Issue #183: 壊れた JSON を貼ると英語の生エラー（Expected property name...）が
// そのまま学習アプリの画面に出ていた。日本語1行に言い換える。
describe("describeImportError (issue #183)", () => {
  it("JSONの構文エラーを日本語（位置つき）に言い換える", () => {
    let err: unknown;
    try {
      JSON.parse("{not valid json");
    } catch (e) {
      err = e;
    }
    const message = describeImportError(err);
    expect(message).toContain("JSONの形式が正しくありません");
    expect(message).toMatch(/\d+行目\d+文字目/);
    expect(message).not.toContain("Expected property name");
  });

  it("構文エラー以外は従来どおりのメッセージを出す", () => {
    expect(describeImportError(new Error("storage refused"))).toBe(
      "インポート失敗: storage refused",
    );
  });
});
