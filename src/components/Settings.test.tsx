import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings from "./Settings";
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
