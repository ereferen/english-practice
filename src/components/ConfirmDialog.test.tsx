import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Issue #150: 削除確認だけ window.confirm でブラウザ標準ダイアログが出ており、
 * アプリ内モーダル（ShortcutHelp / SetupWizard）と見た目が切れていた。
 * ConfirmDialog はその共通化先なので、破壊的操作としての振る舞い
 * （キャンセル側が既定 / Esc・オーバーレイで閉じる）をここで固定する。
 */
describe("ConfirmDialog (#150)", () => {
  it("見出しと本文を表示する", () => {
    render(
      <ConfirmDialog
        title="会話履歴を削除しますか？"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <p>会話履歴（10往復）を削除します。</p>
      </ConfirmDialog>,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("会話履歴を削除しますか？")).toBeTruthy();
    expect(screen.getByText("会話履歴（10往復）を削除します。")).toBeTruthy();
  });

  it("初期フォーカスはキャンセル側（誤爆防止）", () => {
    render(
      <ConfirmDialog title="削除しますか？" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "キャンセル" }),
    );
  });

  it("キャンセルを押すと onCancel だけが呼ばれる", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="削除しますか？"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("確認ボタンは指定ラベルで表示され onConfirm を呼ぶ", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="削除しますか？"
        confirmLabel="すべて削除する"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "すべて削除する" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Escape でキャンセルされる", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog title="削除しますか？" onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("オーバーレイのクリックではキャンセル、パネル内クリックでは何もしない", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="削除しますか？"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        <p>本文</p>
      </ConfirmDialog>,
    );

    await user.click(screen.getByText("本文"));
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
