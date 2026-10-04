import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationScreen from "./ConversationScreen";
import type { AppState } from "../app/types";
import {
  CONVERSATION_RECORD_ID,
  DEFAULT_SETTINGS,
  type ConversationRecord,
  type ConversationSessionRecord,
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
function makeStorage(
  saved?: ConversationRecord,
  verified = false,
  sessionRecords: ConversationSessionRecord[] = [],
) {
  const saveConversation = vi.fn(async (_record: ConversationRecord) => {});
  const deleteConversation = vi.fn(async () => {});
  // Issue #148: セッション単位の保存（in-memory のストアで読み書きを模す）
  const sessionStore = [...sessionRecords];
  const saveConversationSession = vi.fn(
    async (record: ConversationSessionRecord) => {
      const i = sessionStore.findIndex((r) => r.id === record.id);
      if (i >= 0) sessionStore[i] = record;
      else sessionStore.push(record);
    },
  );
  const deleteConversationSession = vi.fn(async (id: string) => {
    const i = sessionStore.findIndex((r) => r.id === id);
    if (i >= 0) sessionStore.splice(i, 1);
  });
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
    listConversationSessions: vi.fn(async () =>
      [...sessionStore]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          turns: r.messages.filter((m) => m.role === "user").length,
          preview: r.messages.find((m) => m.role === "user")?.content ?? "",
        })),
    ),
    loadConversationSession: vi.fn(async (id: string) =>
      sessionStore.find((r) => r.id === id),
    ),
    saveConversationSession,
    deleteConversationSession,
  } as unknown as StorageProvider;
  return {
    storage,
    saveConversation,
    deleteConversation,
    saveConversationSession,
    deleteConversationSession,
    sessionStore,
  };
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
    const { storage, saveConversationSession } = makeStorage(undefined, true);
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
      expect(saveConversationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          draft: "Hello there",
        }),
      ),
    );
    // 復元前の空ログで保存を上書きしていないこと（呼び出しは入力ぶんだけ）
    expect(storage.loadConversation).toHaveBeenCalled();
  });

  it("クリアしたときは退避ログも消す（次に開いても復活しない）", async () => {
    const { storage, deleteConversation, deleteConversationSession } =
      makeStorage(undefined, false, [
        {
          id: "sess-1",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Hi!",
              createdAt: "2026-09-27T12:00:00.000Z",
            },
          ],
          draft: "",
          createdAt: "2026-09-27T12:00:00.000Z",
          updatedAt: "2026-09-27T12:00:00.000Z",
        },
      ]);
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
    expect(deleteConversationSession).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "削除する" }));

    // 消えるのは表示中のセッションだけ（issue #148）
    expect(deleteConversationSession).toHaveBeenCalledWith("sess-1");
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

  // Issue #167: 未設定時の話題チップが「無反応なのに見出しだけ変わる」のを、
  // 押せない理由の明示で解消する。
  it("設定未完了のときは話題チップの近くに理由を出す（#167）", async () => {
    const { storage } = makeStorage(savedLog, false);
    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    const gamingChip = await screen.findByTestId("topic-switch-gaming");
    expect(gamingChip.getAttribute("title")).toBe(
      "先に設定（APIエンドポイント）が必要です",
    );
    expect(
      screen.getByText(/先に設定（APIエンドポイント）が必要です/),
    ).toBeTruthy();
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

/**
 * Issue #166: 失敗した送信を「再送」すると、自分の発言がログに二重に残り、
 * エラーカードも居座っていた。再送は「失敗した1件を置き換える」であってほしい。
 */
describe("ConversationScreen (issue #166 再送の置き換え)", () => {
  it("再送で自分の発言が二重にならず、エラーカードも残らない", async () => {
    requestLlmChatMock
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ content: "Nice!" });
    const { storage } = makeStorage(undefined, true);
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
    await user.type(input, "RETRY-REPRO-1{Enter}");

    // 1回目は失敗 → エラーカードと再送ボタンが出る
    const retry = await screen.findByText("再送");
    expect(screen.getAllByText("RETRY-REPRO-1")).toHaveLength(1);

    // 再送（今回は成功）
    await user.click(retry);
    await waitFor(() => expect(requestLlmChatMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Nice!")).toBeTruthy());

    // 自分の発言は1つだけ・エラーカードは消えている
    expect(screen.getAllByText("RETRY-REPRO-1")).toHaveLength(1);
    expect(screen.queryByText(/LLM応答がありません/)).toBeNull();
  });
});

/**
 * Issue #169: ショートカット一覧に「Shift+Enter 改行」とあるのに、入力欄が
 * 1行の <input> で改行できなかった。複数行 textarea にして Enter=送信 /
 * Shift+Enter=改行 を成立させる。
 */
describe("ConversationScreen (issue #169 改行)", () => {
  it("入力欄は複数行 textarea で、Shift+Enter は改行・Enter は送信", async () => {
    requestLlmChatMock.mockResolvedValue({ content: "ok" });
    const { storage } = makeStorage(undefined, true);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    const input = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");

    // Shift+Enter で改行が入り、送信はされない
    expect(input.value).toBe("line one\nline two");
    expect(requestLlmChatMock).not.toHaveBeenCalled();
  });
});

/**
 * Issue #158: 話題は ConversationScreen のローカル state だけだったため、
 * 会話タブを離れて戻る（アンマウント→再マウント）たびに「フリー」へ戻り、
 * また自分でネタを振る羽目になっていた。会話ログと一緒に話題も退避・復元する。
 */
describe("ConversationScreen (issue #158 話題の保持)", () => {
  const savedWithTopic: ConversationRecord = {
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
    topicId: "gaming",
    updatedAt: "2026-09-27T12:00:02.000Z",
  };

  it("退避された話題を復元し、復元通知に話題名を出す", async () => {
    const { storage } = makeStorage(savedWithTopic, true);

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Hi!")).toBeTruthy();
    // 会話中の話題バーが復元した話題で選択状態になっている
    const gamingChip = await screen.findByTestId("topic-switch-gaming");
    await waitFor(() =>
      expect(gamingChip.getAttribute("aria-pressed")).toBe("true"),
    );
    // 黙って復元しない（どの話題で戻ったかも分かる）
    expect(screen.getByText(/前回の会話を復元しました（話題:/)).toBeTruthy();
  });

  it("話題を選ぶと topicId つきで退避する（次に開いても戻る）", async () => {
    const { storage, saveConversationSession } = makeStorage(
      { ...savedWithTopic, topicId: null },
      false,
    );
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
      expect(saveConversationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: "gaming",
        }),
      ),
    );
  });

  it("タブを離れて戻っても選んだ話題が残る（アンマウント→再マウント）", async () => {
    // 1回目のマウントで話題を選び、その保存内容を次回の復元データとして渡す
    const savedRef: { current?: ConversationSessionRecord } = {};
    const first = makeStorage({ ...savedWithTopic, topicId: null }, false);
    first.saveConversationSession.mockImplementation(
      async (record: ConversationSessionRecord) => {
        savedRef.current = record;
      },
    );
    const user = userEvent.setup();

    const view = render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={first.storage}
      />,
    );
    const gamingChip = await screen.findByTestId("topic-switch-gaming");
    await user.click(gamingChip);
    await waitFor(() =>
      expect(gamingChip.getAttribute("aria-pressed")).toBe("true"),
    );
    await waitFor(() => expect(savedRef.current?.topicId).toBe("gaming"));
    view.unmount();

    // 2回目はタブに戻ってきた想定（保存済みのセッションを復元する）
    const second = makeStorage(undefined, true, [
      savedRef.current as ConversationSessionRecord,
    ]);
    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={second.storage}
      />,
    );

    const restoredChip = await screen.findByTestId("topic-switch-gaming");
    await waitFor(() =>
      expect(restoredChip.getAttribute("aria-pressed")).toBe("true"),
    );
    // 「フリー」に戻っていない
    expect(screen.queryByText("話題: フリー")).toBeNull();
  });
});

/**
 * Issue #148: 保存が「直近1セッション」の1スロットだけで、新しい会話を始めると
 * 前のログが残らなかった（昨日の続きができない）。直近3セッションを残し、
 * 日付つきの一覧から選んで読み込めることをここで固定する。
 */
describe("ConversationScreen (issue #148 複数セッション)", () => {
  const olderSession: ConversationSessionRecord = {
    id: "sess-old",
    messages: [
      {
        id: "o1",
        role: "user",
        content: "What did you do last weekend?",
        createdAt: "2026-09-25T10:00:00.000Z",
      },
      {
        id: "o2",
        role: "assistant",
        content: "I played some games!",
        createdAt: "2026-09-25T10:00:01.000Z",
      },
    ],
    draft: "",
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:05:00.000Z",
  };

  const latestSession: ConversationSessionRecord = {
    id: "sess-new",
    messages: [
      {
        id: "n1",
        role: "user",
        content: "Hi, I'm back!",
        createdAt: "2026-09-27T09:00:00.000Z",
      },
    ],
    draft: "typing again",
    createdAt: "2026-09-27T09:00:00.000Z",
    updatedAt: "2026-09-27T09:10:00.000Z",
  };

  it("最新セッションを復元し、トーストは『直近3セッション』を正直に出す", async () => {
    const { storage } = makeStorage(undefined, false, [
      olderSession,
      latestSession,
    ]);

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Hi, I'm back!")).toBeTruthy();
    // 古いセッションは（まだ）表示されない
    expect(screen.queryByText("What did you do last weekend?")).toBeNull();
    // 文言が「直近1セッション分」のままになっていない
    expect(screen.getByText(/直近3セッションまで/)).toBeTruthy();
    expect(screen.queryByText(/直近1セッション分/)).toBeNull();
  });

  it("過去のセッションを開いて古いログに切り替えられる（日付つき）", async () => {
    const { storage } = makeStorage(undefined, false, [
      olderSession,
      latestSession,
    ]);
    const user = userEvent.setup();

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Hi, I'm back!")).toBeTruthy();
    await user.click(screen.getByTestId("open-session-picker"));

    // 一覧に両方のセッションが出る（往復数つき）
    expect(screen.getByTestId("session-item-sess-old")).toBeTruthy();
    expect(screen.getByTestId("session-item-sess-new")).toBeTruthy();
    // 一覧には往復数も出る（両方とも 1 往復）
    expect(screen.getAllByText("1往復")).toHaveLength(2);

    await user.click(screen.getByTestId("session-item-sess-old"));

    expect(
      await screen.findByText("What did you do last weekend?"),
    ).toBeTruthy();
    // 切り替え後は一覧が閉じる
    expect(screen.queryByTestId("session-picker")).toBeNull();
  });

  it("旧テーブル（固定キー latest）のログをセッションとして引き継ぐ", async () => {
    // sessions は空、旧テーブルだけにログがある状態（#156 の保存層だけ入った状態）
    const { storage, saveConversationSession } = makeStorage(
      {
        id: CONVERSATION_RECORD_ID,
        messages: [
          {
            id: "l1",
            role: "user",
            content: "Legacy log here",
            createdAt: "2026-09-24T10:00:00.000Z",
          },
        ],
        draft: "",
        updatedAt: "2026-09-24T10:00:00.000Z",
      },
      true,
    );

    render(
      <ConversationScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    expect(await screen.findByText("Legacy log here")).toBeTruthy();
    expect(screen.getByText(/前回の会話を復元しました/)).toBeTruthy();
    // 復元後に新しいセッションとして退避され直す（旧→新の移行）
    await waitFor(() =>
      expect(saveConversationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: "Legacy log here" }),
          ]),
        }),
      ),
    );
  });
});
