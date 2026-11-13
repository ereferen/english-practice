import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import App from "./App";

/**
 * Issue #241: URL ハッシュと画面の同期。
 * - 起動時にハッシュの画面を復元する（リロードで同じ画面に戻る）
 * - 画面遷移で履歴が積まれる（戻るでアプリから抜けない）
 * - ブラウザの戻る（popstate）で 1 つ前の画面に戻る
 */

beforeEach(() => {
  window.history.replaceState(null, "", "/english/");
});

afterEach(() => {
  cleanup();
});

describe("App hash routing", () => {
  it("restores the screen named in the URL hash on boot", async () => {
    window.history.replaceState(null, "", "/english/#/progress");
    render(<App />);

    await waitFor(() => expect(screen.getByText("進捗確認")).toBeTruthy());
    // 起動時の復元では履歴を増やさない
    expect(window.location.hash).toBe("#/progress");
  });

  it("pushes a history entry on screen change", async () => {
    window.history.replaceState(null, "", "/english/");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toBeTruthy(),
    );

    // ホーム → 進捗（キーボードショートカット経由ではなくボタンで遷移できる
    // 画面として進捗の「戻る」を使う：まずハッシュで進捗に入る）
    window.history.replaceState(null, "", "/english/#/progress");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByText("進捗確認")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "戻る" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
  });

  it("follows the browser back button (popstate)", async () => {
    window.history.replaceState(null, "", "/english/#/progress");
    render(<App />);
    await waitFor(() => expect(screen.getByText("進捗確認")).toBeTruthy());

    // ブラウザの戻る相当：URL が 1 つ前の画面に変わり、popstate が飛ぶ
    // （jsdom の history.back() は非同期なので、ブラウザが行う順序
    //   「URL 更新 → popstate」をそのまま再現する）
    window.history.replaceState(null, "", "/english/#/");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() =>
      expect(screen.queryByText("進捗確認")).not.toBeTruthy(),
    );
  });

  // Issue #265: ショートカット一覧（ダイアログ＋暗幕）を開いたまま移動すると
  // 新しい画面の上に残り続けていた。ルート変更で閉じることを固定する。
  it("closes the shortcut help dialog when the screen changes", async () => {
    window.history.replaceState(null, "", "/english/");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toBeTruthy(),
    );

    await userEvent.click(screen.getByTestId("shortcut-help-open"));
    expect(
      screen.getByRole("dialog", { name: "キーボードショートカット一覧" }),
    ).toBeTruthy();

    // ダイアログを閉じずにデッキ一覧へ移動する
    await userEvent.click(screen.getByRole("button", { name: "デッキを選ぶ" }));
    await waitFor(() => expect(window.location.hash).toBe("#/decks"));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "キーボードショートカット一覧" }),
      ).not.toBeTruthy(),
    );
  });

  it("keeps the dialog open while staying on the same screen", async () => {
    window.history.replaceState(null, "", "/english/");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toBeTruthy(),
    );

    await userEvent.click(screen.getByTestId("shortcut-help-open"));
    // 画面遷移を伴わない再レンダーでは閉じない
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "キーボードショートカット一覧" }),
      ).toBeTruthy(),
    );
  });
});
