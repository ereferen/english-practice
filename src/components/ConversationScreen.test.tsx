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

// Issue #147: 話題プリセットを押したときに「LLM へ何を送ったか」を検証したいので
// requestLlmChat だけ差し替える（providersFromSettings 等は本物を使う）。
const { requestLlmChatMock } = vi.hoisted(() => ({
  requestLlmChatMock: vi.fn(),
}));
vi.mock("../domain/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domain/llm")>();
  return { ...actual, requestLlmChat: requestLlmChatMock };
});

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
  requestLlmChatMock.mockReset();
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

    // Issue #150: 標準 confirm をやめてアプリ内モーダルで確認するようになった。
    // モーダルが出るまでは何も消えない。
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(deleteConversation).toHaveBeenCalledWith();
    expect(
      await screen.findByText("英語でメッセージを送って会話を始めましょう！"),
    ).toBeTruthy();
  });

  it("クリアの確認をキャンセルしたらログは消えない（#150）", async () => {
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
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByText("Hi!")).toBeTruthy();
  });
});

/**
 * Issue #147: 会話の入口がフリーチャットだけだと毎回ネタを自分で振ることになる
 * （ペルソナ aki）。話題プリセットから「相手がリードする」会話を始められること、
 * 会話中でも話題を切り替えられることをここで固定する。
 */
describe("ConversationScreen (issue #147 話題の入口)", () => {
  const savedLog: ConversationRecord = {
    id: CONVERSATION_RECORD_ID,
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Hi!",
        createdAt: "2026-09-27T12:00:00.000Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "Hello!",
        createdAt: "2026-09-27T12:00:01.000Z",
      },
    ],
    draft: "",
    updatedAt: "2026-09-27T12:00:02.000Z",
  };

  it("空状態に話題プリセットが出て、押すと相手役つきで会話が始まる", async () => {
    requestLlmChatMock.mockResolvedValue({
      content: "Nice! What places have you been to?",
      providerId: "primary",
      providerLabel: "プライマリ",
    });
    const { storage } = makeStorage(undefined, true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("今日は何を話す？")).toBeTruthy();
    // ペルソナが名指しした 4 つの入口
    for (const id of ["gaming", "travel", "work", "selfintro"]) {
      expect(screen.getByTestId(`topic-preset-${id}`)).toBeTruthy();
    }

    await user.click(screen.getByTestId("topic-preset-travel"));

    // Issue #159: 話題の選択は「学習者が打った発言」ではない。中央の注記行として
    // 残り、打っていない英語が自分のバブルには入らない。
    expect(
      await screen.findByText("— 話題「✈️ 旅行」で会話を開始 —"),
    ).toBeTruthy();
    expect(screen.queryByText(/I'm thinking about my next trip/)).toBeNull();
    // 相手の返事は来る
    expect(
      await screen.findByText("Nice! What places have you been to?"),
    ).toBeTruthy();

    // system プロンプトに選んだ話題（相手役・進め方）が載っている
    const call = requestLlmChatMock.mock.calls[0][0];
    const system = call.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(system.content).toContain("Topic mode: 旅行");
    expect(system.content).toContain("well-travelled friend");
    // 注記行は表示用の日本語ではなく、LLM への英語指示として送られる
    expect(
      call.messages.some(
        (m: { role: string; content: string }) =>
          m.role === "system" && m.content.includes("[Topic start]"),
      ),
    ).toBe(true);
  });

  it("会話中でも話題を切り替えられる（切替はシステム行・発言にはしない）", async () => {
    requestLlmChatMock.mockResolvedValue({
      content: "Sure, how's your week going?",
      providerId: "primary",
      providerLabel: "プライマリ",
    });
    const { storage } = makeStorage(savedLog, true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Hi!")).toBeTruthy();
    const workChip = await screen.findByTestId("topic-switch-work");
    expect(workChip.getAttribute("aria-pressed")).toBe("false");

    await user.click(workChip);

    await waitFor(() =>
      expect(workChip.getAttribute("aria-pressed")).toBe("true"),
    );
    // Issue #159: 切替の一言は「自分の発言」ではなく中央の注記行
    expect(
      await screen.findByText("— 話題を「💼 仕事の雑談」に切り替え —"),
    ).toBeTruthy();
    expect(screen.queryByText(/switch to work small talk/)).toBeNull();
    expect(screen.queryByText(/Can we switch to work small talk/)).toBeNull();
    expect(
      screen.getByText(/話題: 💼 仕事の雑談/),
    ).toBeTruthy();
    const call = requestLlmChatMock.mock.calls[0][0];
    const system = call.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(system.content).toContain("Topic mode: 仕事の雑談");
    // 切替も LLM には system 指示として渡る（user 発言にはならない）
    expect(
      call.messages.some(
        (m: { role: string; content: string }) =>
          m.role === "system" && m.content.includes("[Topic switch]"),
      ),
    ).toBe(true);
    expect(
      call.messages.every(
        (m: { content: string }) =>
          !m.content.includes("Can we switch to work small talk"),
      ),
    ).toBe(true);
  });

  it("設定が未完了なら話題を選んでも送信はしない（話題だけ選択状態になる）", async () => {
    const { storage } = makeStorage(savedLog, false);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    const gamingChip = await screen.findByTestId("topic-switch-gaming");
    await user.click(gamingChip);

    await waitFor(() =>
      expect(gamingChip.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(requestLlmChatMock).not.toHaveBeenCalled();
  });
});

describe("ConversationScreen (issue #157)", () => {
  const savedLog: ConversationRecord = {
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
        content: "Doing great — you?",
        createdAt: "2026-09-27T12:00:01.000Z",
      },
    ],
    draft: "",
    updatedAt: "2026-09-27T12:00:02.000Z",
  };

  it("Enter送信の後も入力欄は有効でフォーカスが残る（クリックし直し不要）", async () => {
    requestLlmChatMock.mockResolvedValue({ content: "Nice!" });
    const { storage } = makeStorage(savedLog, true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.type(input, "Let's talk about games{Enter}");

    await waitFor(() => expect(requestLlmChatMock).toHaveBeenCalledTimes(1));
    // 返事が返った後も入力欄は有効のまま（disabled になるとフォーカスが外れる）
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(document.activeElement).toBe(input);
  });

  it("送信中に Enter を連打しても二重送信しない", async () => {
    let resolveChat: ((v: { content: string }) => void) | undefined;
    requestLlmChatMock.mockImplementation(
      () =>
        new Promise<{ content: string }>((resolve) => {
          resolveChat = resolve;
        }),
    );
    const { storage } = makeStorage(savedLog, true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.type(input, "Hello{Enter}");
    await waitFor(() => expect(requestLlmChatMock).toHaveBeenCalledTimes(1));

    // 送信中の Enter は無視される（入力欄は有効なままだが多重送信しない）
    await user.type(input, "second{Enter}");
    expect(requestLlmChatMock).toHaveBeenCalledTimes(1);

    resolveChat?.({ content: "ok" });
    await waitFor(() => expect(input).not.toBeDisabled());
  });
});
