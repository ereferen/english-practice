import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_CONVERSATION_SESSIONS,
  type ConversationSessionMeta,
  type StorageProvider,
} from "../storage/types";
import {
  type ChatMessage,
  type ConversationTopic,
  CONVERSATION_TOPICS,
} from "../domain/conversation";

/**
 * Issue #287: 会話画面から「セッションの復元・保存・切替」を切り出す。
 *
 * ConversationScreen は 1800 行超で、進行の state（復元・保存・送信・抽出・
 * 辞書・読み上げ）が1か所に集まっていた。この hook はそのうち
 * 「どのセッションに書くか」だけを持つ。会話そのもの（messages / input / topic）
 * は引き続き画面側が所有し、値と setter を渡してもらう。こうしておくと
 * #2（抽出）・#3（辞書）を後から切り出すときに、セッションの知識が要らない。
 *
 * 挙動は切り出し前と同じ:
 * - マウント時に最新セッションを復元し、無ければ旧テーブル（固定キー）から
 *   一度だけ引き継ぐ（#138 / #156）
 * - 保存は 300ms デバウンス。エラーカードは残さず、1往復も話していない
 *   セッションは作らない（#274）
 * - 復元が終わるまで保存しない（空ログで上書きしない / #138）
 * - 選んだ話題は設定にも残す（0往復で離れたときの復元 / #274）
 */

/** Issue #148: jsdom 等 crypto.randomUUID が無い環境でも動く ID 生成 */
function newSessionId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Issue #148: topicId から話題オブジェクトを引く（未知の ID はフリー扱い） */
function topicFromId(id: string | null | undefined): ConversationTopic | null {
  if (!id) return null;
  return CONVERSATION_TOPICS.find((t) => t.id === id) ?? null;
}

/** Issue #148: 復元トーストの文言（何が残っているかを正直に出す #138 の延長） */
function restoreNoticeText(topic: ConversationTopic | null): string {
  const tail = `直近${MAX_CONVERSATION_SESSIONS}セッションまでこの端末に保存しています。上の「🕘 過去のセッション」から切り替えられます`;
  return topic
    ? `💾 前回の会話を復元しました（話題: ${topic.emoji} ${topic.label}／${tail}）`
    : `💾 前回の会話を復元しました（${tail}）`;
}

/**
 * Issue #274: セッションとして残す価値があるのは「学習者が1往復以上話した」
 * 会話だけ。話題チップを押した直後は system の注記行と相手の一発目しか無く、
 * これを保存すると一覧に「0往復 / (無題)」が並んで直近3枠を食っていた。
 */
function hasUserTurn(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === "user");
}

interface UseConversationSessionOptions {
  storage: StorageProvider;
  messages: ChatMessage[];
  input: string;
  topic: ConversationTopic | null;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setTopic: React.Dispatch<React.SetStateAction<ConversationTopic | null>>;
  /**
   * セッションを切り替える前に消したい一時表示（抽出パネル・保存メッセージ・
   * ストリーミング中の文など）。セッションの知識を持たせないため、
   * 画面側の責務として渡してもらう。
   */
  onResetExtras?: () => void;
}

export function useConversationSession({
  storage,
  messages,
  input,
  topic,
  setMessages,
  setInput,
  setTopic,
  onResetExtras,
}: UseConversationSessionOptions) {
  // Issue #148: 今この画面が書き込んでいるセッションの ID。
  // マウント時に発番し、以降は同じ ID に追記する（＝1マウント = 1セッション）。
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  // セッションの作成時刻は保存のたびに上書きしない（一覧の日付が動かないように）
  const sessionCreatedAtRef = useRef<string>(new Date().toISOString());
  // Issue #138: 復元が終わるまで保存を止める（空ログで上書きしないため）
  const hydratedRef = useRef(false);
  // Issue #158: 復元したことを黙ってやらない。話題まで戻ったならその名前も出す。
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  // 保存済みセッションのメタ一覧（古い→新しいではなく新しい順で保持）
  const [sessions, setSessions] = useState<ConversationSessionMeta[]>([]);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);

  // Issue #148: セッション一覧を取り直す（ピッカーを開いたとき・削除したとき）
  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await storage.listConversationSessions());
    } catch {
      // 一覧が取れなくても会話は続けられる
    }
  }, [storage]);

  /** 次の会話を新しいセッションとして残す */
  const startNewSession = useCallback(() => {
    setSessionId(newSessionId());
    sessionCreatedAtRef.current = new Date().toISOString();
  }, []);

  // Issue #138: タブ離脱・リロードで会話ログが丸ごと消えていた（messages が
  // このコンポーネントのローカル state だけだった）。直近1セッションを
  // IndexedDB から戻し、続きから話せるようにする。
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const metas = await storage.listConversationSessions();
        if (!mounted) return;
        setSessions(metas);
        const latestMeta = metas[0];
        const latestRecord = latestMeta
          ? await storage.loadConversationSession(latestMeta.id)
          : undefined;
        if (!mounted) return;
        if (latestRecord && latestRecord.messages.length > 0) {
          // 新テーブルの最新セッションを復元（従来の「続きから」を維持）
          setSessionId(latestRecord.id);
          sessionCreatedAtRef.current = latestRecord.createdAt;
          setMessages(latestRecord.messages);
          const restoredTopic = topicFromId(latestRecord.topicId);
          setTopic(restoredTopic);
          if (latestRecord.draft) setInput(latestRecord.draft);
          setRestoreNotice(restoreNoticeText(restoredTopic));
        } else {
          // 旧テーブル（固定キー "latest"）からの一回限りの移行。#156 で
          // 保存層だけ先に入っているので、UI 接続後は旧レコードを新しい
          // セッションとして引き継ぐ（旧テーブルは消さずに読み取り専用で残す）。
          const legacy = await storage.loadConversation();
          if (!mounted) return;
          if (legacy && legacy.messages.length > 0) {
            setMessages(legacy.messages);
            const restoredTopic = topicFromId(legacy.topicId);
            setTopic(restoredTopic);
            if (legacy.draft) setInput(legacy.draft);
            setRestoreNotice(restoreNoticeText(restoredTopic));
          } else if (legacy?.draft) {
            setInput(legacy.draft);
          }
        }
        // Issue #274: セッションは「1往復以上話した会話」しか残さないので、
        // 話題を選んだだけで離れた場合の復元は設定側（最後に選んだ話題）で担保する。
        if (mounted && !(latestRecord && latestRecord.messages.length > 0)) {
          const settings = await storage.loadSettings();
          if (!mounted) return;
          const settingsTopic = topicFromId(settings.conversationTopicId);
          if (settingsTopic) setTopic(settingsTopic);
        }
      } catch {
        // 復元できなくても会話自体は続けられる（致命ではない）
      } finally {
        if (mounted) hydratedRef.current = true;
      }
    })();
    return () => {
      mounted = false;
    };
  }, [storage, setMessages, setInput, setTopic]);

  // Issue #148: 会話ログと下書きを「セッション」として退避する。入力の
  // キーストロークごとに書かないよう軽くデバウンスする。空のセッションは
  // 残さない（クリア直後の空レコードで一覧を汚さない）。
  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      // エラーカードは会話ではないので残さない（issue #111 と同じ扱い）
      const kept = messages.filter((m) => m.kind !== "error");
      // Issue #274: 学習者の発言が無いログはセッションとして残さない。話題チップを
      // 押した直後（注記行＋相手の一発目だけ）を保存すると、一覧に「0往復 /
      // (無題)」が並んで直近3枠を実のある会話から奪う。下書きだけは従来どおり
      // 残す（打ちかけの文がタブ離脱で消えないように）。
      if (!hasUserTurn(kept) && input.trim() === "") {
        void storage.deleteConversationSession(sessionId);
        void storage.deleteConversation();
        return;
      }
      void storage.saveConversationSession({
        id: sessionId,
        messages: kept,
        draft: input,
        // Issue #158: 話題は画面を離れると消えるローカル state だった。
        // 会話ログと一緒に退避し、戻ったときに同じ話題から続けられるようにする。
        topicId: topic?.id ?? null,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: new Date().toISOString(),
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [messages, input, topic, storage, sessionId]);

  // Issue #274: 選んだ話題は設定にも残す。0往復ではセッションを作らない仕様に
  // したため、「話題だけ選んでタブを離れた」の復元はこちらで担保する。
  useEffect(() => {
    if (!hydratedRef.current) return;
    void storage.saveSettings({ conversationTopicId: topic?.id ?? null });
  }, [storage, topic]);

  /**
   * Issue #248: 話題を切り替えるときは、今の会話を「過去のセッション」として
   * 退避してから新しいセッションを始める。
   * 戻り値は「実際に保存したか」（0往復で捨てたときは false）。
   */
  const archiveCurrentSession = useCallback((): boolean => {
    const kept = messages.filter((m) => m.kind !== "error");
    // Issue #274: 学習者が1往復も話していない会話は退避しない（0往復の「(無題)」
    // セッションで直近3枠を食わない）。代わりに空の器を消して枠を空ける。
    if (!hasUserTurn(kept)) {
      void storage.deleteConversationSession(sessionId);
      void refreshSessions();
      return false;
    }
    void storage.saveConversationSession({
      id: sessionId,
      messages: kept,
      draft: "",
      topicId: topic?.id ?? null,
      createdAt: sessionCreatedAtRef.current,
      updatedAt: new Date().toISOString(),
    });
    void refreshSessions();
    return true;
  }, [messages, topic, storage, sessionId, refreshSessions]);

  /** 表示中のセッションだけを消す（他のセッションは残す / #148） */
  const clearCurrentSession = useCallback(() => {
    setMessages([]);
    setInput("");
    onResetExtras?.();
    setRestoreNotice(null);
    setSessionPickerOpen(false);
    // Issue #158: ログを消したのに話題だけ残ると中途半端なので、フリーに戻す
    setTopic(null);
    // 旧テーブルの固定キーも消して、次に開いたときに復活させない。
    void storage.deleteConversationSession(sessionId);
    void storage.deleteConversation();
    startNewSession();
    void refreshSessions();
  }, [
    setMessages,
    setInput,
    setTopic,
    onResetExtras,
    storage,
    sessionId,
    startNewSession,
    refreshSessions,
  ]);

  // Issue #148: 過去のセッションを開く（日付つきの一覧を出し、選ぶと読み込む）
  const toggleSessionPicker = useCallback(() => {
    void refreshSessions();
    setSessionPickerOpen((open) => !open);
  }, [refreshSessions]);

  const closeSessionPicker = useCallback(() => setSessionPickerOpen(false), []);

  const handleSelectSession = useCallback(
    async (id: string) => {
      try {
        const record = await storage.loadConversationSession(id);
        if (!record) {
          void refreshSessions();
          return;
        }
        setSessionId(record.id);
        sessionCreatedAtRef.current = record.createdAt;
        setMessages(record.messages);
        setTopic(topicFromId(record.topicId));
        setInput(record.draft ?? "");
        onResetExtras?.();
        setRestoreNotice(null);
        setSessionPickerOpen(false);
      } catch {
        // 読み込みに失敗しても今の会話は消さない
      }
    },
    [storage, refreshSessions, setMessages, setTopic, setInput, onResetExtras],
  );

  return {
    /** 今書き込んでいるセッション ID（一覧の aria-current に使う） */
    sessionId,
    sessions,
    sessionPickerOpen,
    restoreNotice,
    setRestoreNotice,
    refreshSessions,
    toggleSessionPicker,
    closeSessionPicker,
    handleSelectSession,
    clearCurrentSession,
    archiveCurrentSession,
    startNewSession,
  };
}
