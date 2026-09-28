import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationScreen from "./ConversationScreen";
import type { AppState } from "../app/types";
import {
  CONVERSATION_RECORD_ID,
  DEFAULT_SETTINGS,
  type ConversationRecord,
  type StorageProvider,
} from "../storage/types";

/**
 * issue #138: 会話ログが ConversationScreen のローカル state だけだったため、
 * タブ離脱（アンマウント）やリロードで丸ごと消えていた。直近1セッションを
 * IndexedDB に退避して戻ってきたら復元する、という挙動をここで固定する。
 */
function makeStorage(saved?: ConversationRecord, verified = false) {
  const saveConversation = vi.fn(async () => {});
  const deleteConversation = vi.fn(async () => {});
  // 接続テスト成功済みの設定にすると入力欄がアンロックされる（issue #130）
  const settings = verified
    ? {
        ...DEFAULT_SETTINGS,
        llmVerifiedEndpoint: DEFAULT_SETTINGS.llmApiEndpoint,
      }
    : DEFAULT_SETTINGS;
  const storage = {
    loadSettings: vi.fn(async () => settings),
    loadConversation: vi.fn(async () => saved),
    saveConversation,
    deleteConversation,
  } as unknown as StorageProvider;
  return { storage, saveConversation, deleteConversation };
}

function makeState(): AppState {
  return { decks: [], screen: { name: "conversation" } } as unknown as AppState;
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom には scrollIntoView が無い（ConversationScreen が自動スクロールする）
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ConversationScreen (issue #138)", () => {
  it("退避された会話ログを復元し、復元したことを知らせる", async () => {
    const { storage } = makeStorage({
      id: CONVERSATION_RECORD_ID,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Hi! How are you?",
          createdAt: "2026-09-27T12:00:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "I'm good, thanks!",
          createdAt: "2026-09-27T12:00:01.000Z",
        },
      ],
      draft: "typed but not sent",
      updatedAt: "2026-09-27T12:00:02.000Z",
    });

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Hi! How are you?")).toBeTruthy();
    expect(screen.getByText("I'm good, thanks!")).toBeTruthy();
    // 空状態の案内は出ない（復元できているので）
    expect(
      screen.queryByText("英語でメッセージを送って会話を始めましょう！"),
    ).toBeNull();
    // 下書きも戻る
    expect(screen.getByRole("textbox")).toHaveValue("typed but not sent");
    // 黙って復元しない
    expect(screen.getByText(/前回の会話を復元しました/)).toBeTruthy();
  });

  it("会話ログを退避する（タブを離れても消えない）", async () => {
    const { storage, saveConversation } = makeStorage(undefined, true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    // 設定の読み込みは非同期。入力欄のアンロックを待ってから打つ
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, "Hello there");

    await waitFor(() =>
      expect(saveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: CONVERSATION_RECORD_ID,
          draft: "Hello there",
        }),
      ),
    );
    // 復元前の空ログで保存を上書きしていないこと（呼び出しは入力ぶんだけ）
    expect(storage.loadConversation).toHaveBeenCalled();
  });

  it("クリアしたときは退避ログも消す（次に開いても復活しない）", async () => {
    const { storage, deleteConversation } = makeStorage({
      id: CONVERSATION_RECORD_ID,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Hi!",
          createdAt: "2026-09-27T12:00:00.000Z",
        },
      ],
      draft: "",
      updatedAt: "2026-09-27T12:00:00.000Z",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Hi!")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "クリア" }));

    expect(deleteConversation).toHaveBeenCalledWith();
    expect(
      await screen.findByText("英語でメッセージを送って会話を始めましょう！"),
    ).toBeTruthy();
  });
});
