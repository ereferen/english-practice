import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ChatMessage, ConversationTopic } from "../domain/conversation";
import type {
  ConversationSessionMeta,
  ConversationSessionRecord,
  StorageProvider,
} from "../storage/types";
import { useConversationSession } from "./useConversationSession";

function message(id: string, role: ChatMessage["role"], content: string) {
  return { id, role, content, createdAt: "2026-11-28T00:00:00.000Z" };
}

function makeStorage(
  overrides: Partial<Record<keyof StorageProvider, unknown>>,
) {
  return {
    loadConversation: vi.fn(async () => undefined),
    loadSettings: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => undefined),
    saveConversationSession: vi.fn(async () => undefined),
    listConversationSessions: vi.fn(async () => []),
    loadConversationSession: vi.fn(async () => undefined),
    deleteConversationSession: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StorageProvider & {
    saveConversationSession: ReturnType<typeof vi.fn>;
    deleteConversationSession: ReturnType<typeof vi.fn>;
    listConversationSessions: ReturnType<typeof vi.fn>;
    loadConversationSession: ReturnType<typeof vi.fn>;
    deleteConversation: ReturnType<typeof vi.fn>;
  };
}

/** messages / input / topic は画面側が持つ前提なので、テストでも同じ形にする */
function useHarness(storage: StorageProvider, resetExtras = vi.fn()) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState<ConversationTopic | null>(null);
  const session = useConversationSession({
    storage,
    messages,
    input,
    topic,
    setMessages,
    setInput,
    setTopic,
    onResetExtras: resetExtras,
  });
  return {
    ...session,
    messages,
    input,
    topic,
    setMessages,
    setInput,
    setTopic,
  };
}

/** 復元 effect（非同期）を全部流してからアサートする */
async function settle(storage: {
  listConversationSessions: ReturnType<typeof vi.fn>;
}) {
  await waitFor(() =>
    expect(storage.listConversationSessions).toHaveBeenCalled(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useConversationSession (issue #287)", () => {
  it("マウント時に最新セッションを復元する（#138）", async () => {
    const meta: ConversationSessionMeta = {
      id: "s1",
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
      turns: 1,
      preview: "hello",
      topicId: null,
    };
    const record: ConversationSessionRecord = {
      id: "s1",
      messages: [message("m1", "user", "hello")],
      draft: "半端な下書き",
      topicId: null,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    const storage = makeStorage({
      listConversationSessions: vi.fn(async () => [meta]),
      loadConversationSession: vi.fn(async () => record),
    });

    const { result } = renderHook(() => useHarness(storage));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.sessionId).toBe("s1");
    expect(result.current.input).toBe("半端な下書き");
    expect(result.current.restoreNotice).toContain("前回の会話を復元しました");
    expect(result.current.sessions).toHaveLength(1);
  });

  it("1往復も話していないログは保存せず、空の器を消す（#274）", async () => {
    const storage = makeStorage({});
    const { result } = renderHook(() => useHarness(storage));

    // 復元が終わるまで保存しない = 空ログで上書きしない
    await settle(storage);
    const id = result.current.sessionId;

    let archived: boolean | undefined;
    await act(async () => {
      archived = result.current.archiveCurrentSession();
    });
    expect(archived).toBe(false);
    expect(storage.deleteConversationSession).toHaveBeenCalledWith(id);
    expect(storage.saveConversationSession).not.toHaveBeenCalled();
  });

  it("1往復以上あればセッションとして退避する（#248）", async () => {
    const storage = makeStorage({});
    const { result } = renderHook(() => useHarness(storage));
    await settle(storage);

    act(() => {
      result.current.setMessages([message("m1", "user", "loot dropped")]);
    });

    let archived = false;
    await act(async () => {
      archived = result.current.archiveCurrentSession();
    });

    expect(archived).toBe(true);
    const saved = storage.saveConversationSession.mock.calls.at(-1)?.[0] as
      ConversationSessionRecord | undefined;
    expect(saved?.messages).toHaveLength(1);
    // 退避した記録は「新しいセッション」として上書きされない
    expect(saved?.id).toBe(result.current.sessionId);
  });

  it("clear は表示中のセッションだけを消し、新しいセッション ID に切り替える", async () => {
    const resetExtras = vi.fn();
    const storage = makeStorage({});
    const { result } = renderHook(() => useHarness(storage, resetExtras));
    await settle(storage);

    act(() => {
      result.current.setMessages([message("m1", "user", "hi")]);
      result.current.setInput("draft");
    });
    const before = result.current.sessionId;

    await act(async () => {
      result.current.clearCurrentSession();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe("");
    expect(result.current.topic).toBeNull();
    expect(result.current.restoreNotice).toBeNull();
    expect(resetExtras).toHaveBeenCalled();
    expect(storage.deleteConversationSession).toHaveBeenCalledWith(before);
    expect(result.current.sessionId).not.toBe(before);
  });

  it("過去のセッションを選ぶと本文・話題・下書きを差し替える（#148）", async () => {
    const record: ConversationSessionRecord = {
      id: "s2",
      messages: [message("m9", "user", "older turn")],
      draft: "",
      topicId: null,
      createdAt: "2026-11-26T00:00:00.000Z",
      updatedAt: "2026-11-26T00:00:00.000Z",
    };
    const storage = makeStorage({
      loadConversationSession: vi.fn(async () => record),
    });
    const { result } = renderHook(() => useHarness(storage));
    await settle(storage);

    await act(async () => {
      await result.current.handleSelectSession("s2");
    });

    expect(result.current.sessionId).toBe("s2");
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.sessionPickerOpen).toBe(false);
  });
});
