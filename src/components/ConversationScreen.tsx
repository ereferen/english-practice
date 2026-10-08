import { useEffect, useRef, useState, useCallback } from "react";
import type { AppState, Action } from "../app/types";
import {
  MAX_CONVERSATION_SESSIONS,
  type ConversationSessionMeta,
  type StorageProvider,
} from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import {
  type ChatMessage,
  type ConversationTopic,
  CONVERSATION_TOPICS,
  buildSystemPrompt,
  createUserMessage,
  createAssistantMessage,
  createNoteMessage,
  topicNoteContent,
  topicNoteInstruction,
} from "../domain/conversation";
import {
  type LlmProviderConfig,
  friendlyLlmError,
  providersFromSettings,
  requestLlmChat,
  splitSendError,
} from "../domain/llm";
import {
  type ExtractedContent,
  CONVERSATION_DECK_ID,
  buildConversationDeck,
  dedupeExtracted,
  extractContentWithLlm,
  mergeIntoConversationDeck,
} from "../domain/conversationExtract";
import { deckSchema } from "../content/schema";
import type { Deck } from "../content/schema";
import { speak } from "../domain/speech";
import { useSpeechSupport } from "../domain/useSpeechSupport";
import TalkSprite from "./TalkSprite";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./ConversationScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

const TYPE_LABELS: Record<ExtractedContent["type"], string> = {
  vocabulary: "語彙",
  expression: "表現",
  "grammar-correction": "文法訂正",
};

// Issue #151: 抽出デッキのレベルを追加時に選べるようにした
const LEVEL_OPTIONS: { value: Deck["level"]; label: string }[] = [
  { value: "beginner", label: "初級" },
  { value: "intermediate", label: "中級" },
  { value: "advanced", label: "上級" },
];

/**
 * Issue #148: 会話セッションをセッション ID で管理するための小道具。
 * jsdom 等 crypto.randomUUID が無い環境でも動くようにフォールバックを持つ。
 */
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

/** Issue #148: セッション一覧に出す日付（日付で選べれば十分、というペルソナ要望） */
function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Issue #148: 復元トーストの文言（何が残っているかを正直に出す #138 の延長） */
function restoreNoticeText(topic: ConversationTopic | null): string {
  const tail = `直近${MAX_CONVERSATION_SESSIONS}セッションまでこの端末に保存しています。上の「🕘 過去のセッション」から切り替えられます`;
  return topic
    ? `💾 前回の会話を復元しました（話題: ${topic.emoji} ${topic.label}／${tail}）`
    : `💾 前回の会話を復元しました（${tail}）`;
}

export default function ConversationScreen({
  state,
  dispatch,
  storage,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Issue #147: 選択中の話題（null = 従来のフリーチャット）
  const [topic, setTopic] = useState<ConversationTopic | null>(null);
  const [providers, setProviders] = useState<LlmProviderConfig[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  // Issue #111: banner shown ⇒ sending is pointless; gate the composer on it
  // so the user goes to Settings *before* wasting a round-trip.
  const [needsConfig, setNeedsConfig] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  // Issue #73: last failed user text + flag so the error card can offer 再送/設定へ
  const [failedSendText, setFailedSendText] = useState<string | null>(null);
  // Issue #166: 失敗時に入れた「自分の発言」と「エラーカード」の id。再送時に
  // これらをログから取り除いてから送り直す（二重化・エラーカード残留の防止）。
  const [failedSendIds, setFailedSendIds] = useState<string[]>([]);
  // Issue #47: which message is currently being read aloud (Web Speech)
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Issue #83: TTS availability (no-voices env gets explicit feedback)
  const speechAvail = useSpeechSupport();
  // Issue #19: conversation content extraction (LLM提案 → ユーザー承認でデッキ保存)
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedContent[] | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // Issue #141: 追加直後にそのまま学習へ入れるようにする（デッキを探し直す4タップを無くす）
  const [savedDeck, setSavedDeck] = useState<{
    deckId: string;
    lessonId: string;
    count: number;
  } | null>(null);
  const extractControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Issue #138: 復元が終わるまで保存を止める（空ログで上書きしないため）
  const hydratedRef = useRef(false);
  // Issue #158: 復元したことを黙ってやらない。話題まで戻ったならその名前も出す。
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  // Issue #148: 今この画面が書き込んでいるセッションの ID。
  // マウント時に発番し、以降は同じ ID に追記する（＝1マウント = 1セッション）。
  const sessionIdRef = useRef<string>(newSessionId());
  // セッションの作成時刻は保存のたびに上書きしない（一覧の日付が動かないように）
  const sessionCreatedAtRef = useRef<string>(new Date().toISOString());
  // 保存済みセッションのメタ一覧（古い→新しいではなく新しい順で保持）
  const [sessions, setSessions] = useState<ConversationSessionMeta[]>([]);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);

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
          sessionIdRef.current = latestRecord.id;
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
      } catch {
        // 復元できなくても会話自体は続けられる（致命ではない）
      } finally {
        if (mounted) hydratedRef.current = true;
      }
    })();
    return () => {
      mounted = false;
    };
  }, [storage]);

  // Issue #148: 会話ログと下書きを「セッション」として退避する。入力の
  // キーストロークごとに書かないよう軽くデバウンスする。空のセッションは
  // 残さない（クリア直後の空レコードで一覧を汚さない）。
  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      // エラーカードは会話ではないので残さない（issue #111 と同じ扱い）
      const kept = messages.filter((m) => m.kind !== "error");
      if (kept.length === 0 && input.trim() === "") {
        void storage.deleteConversationSession(sessionIdRef.current);
        void storage.deleteConversation();
        return;
      }
      void storage.saveConversationSession({
        id: sessionIdRef.current,
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
  }, [messages, input, topic, storage]);

  // Issue #148: セッション一覧を取り直す（ピッカーを開いたとき・削除したとき）
  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await storage.listConversationSessions());
    } catch {
      // 一覧が取れなくても会話は続けられる
    }
  }, [storage]);

  // Load config on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const settings = await storage.loadSettings();
      if (!mounted) return;
      const chain = providersFromSettings(settings);
      if (chain.length === 0) {
        setConfigError(
          "⚠ APIエンドポイントが未設定です。設定画面からLLMのエンドポイントを指定してください。",
        );
        // Issue #111: while this banner is up, sending can only fail.
        setNeedsConfig(true);
      } else if (
        // Issue #130: gate on "did this endpoint actually answer a test?",
        // not on matching the placeholder string. A local LLM behind
        // http://localhost:11434/v1 is a valid setup — once a live test
        // passed, sending must be unlocked.
        settings.llmVerifiedEndpoint.trim() === chain[0].apiEndpoint.trim()
      ) {
        setConfigError(null);
        setNeedsConfig(false);
      } else if (
        // Issue #113: the saved value equals the placeholder default
        // (localhost:11434) — the user "saved" without actually configuring.
        // Say so honestly instead of the generic 未設定 message.
        chain[0].apiEndpoint.trim() === DEFAULT_SETTINGS.llmApiEndpoint.trim()
      ) {
        setConfigError(
          "⚠ 保存されているエンドポイントが初期値（http://localhost:11434/v1）のままです。このPC上のローカルサーバを指すプレースホルダで、デプロイ先からは使えません。設定画面で実際に接続できるエンドポイント（例: http://192.168.x.x:11434/v1 や OpenRouter 等）を入力するか、この端末のローカルサーバ相手に「接続テスト（プライマリ）」を成功させてください。",
        );
        setNeedsConfig(true);
      } else {
        // Issue #123: banner keyed on the last connection-test result, not
        // just "is it the default" — an endpoint that was saved but never
        // tested (or failed a test) must keep warning the user.
        setConfigError(
          "⚠ このエンドポイントはまだ接続確認が済んでいません。設定画面の「接続テスト（プライマリ）」に成功すると、この警告は消えます。",
        );
        setNeedsConfig(true);
      }
      setProviders(chain);
    })();
    return () => {
      mounted = false;
    };
  }, [storage]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Cancel on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      extractControllerRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    // Issue #147: topicOverride を渡せるようにした理由 — 話題ボタンの押下で
    // setTopic と送信を同じ tick で行うと、この useCallback が掴んでいる
    // topic はまだ古い値。system プロンプトに新しい話題を確実に載せるため、
    // 押した話題をそのまま渡す。
    // Issue #159: note を渡したときは学習者の発言ではなく system の注記行を
    // 積む（話題の開始・切替）。user バブルとして積むと、打っていない英語が
    // 保存ログ・抽出・往復数に混ざる。
    async (
      overrideText?: string,
      topicOverride?: ConversationTopic | null,
      note?: { content: string; instruction: string },
      pruneIds?: string[],
    ) => {
      const text = (overrideText ?? input).trim();
      if (!note && !text) return;
      if (providers.length === 0 || needsConfig) return;

      const activeTopic = topicOverride ?? topic;

      const nextMsg = note
        ? createNoteMessage(note.content, note.instruction)
        : createUserMessage(text);
      // Issue #166: 再送時は失敗した user バブルとエラーカードを履歴から除いてから
      // 積み直す。そうしないと自分の発言が二重に残り、エラーカードも居座る。
      const base =
        pruneIds && pruneIds.length
          ? messages.filter((m) => !pruneIds.includes(m.id))
          : messages;
      const updated = [...base, nextMsg];
      setMessages(updated);
      if (!note) setInput("");
      setFailedSendText(null);
      setFailedSendIds([]);
      setLoading(true);
      setStreamingContent("");

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const result = await requestLlmChat({
          providers,
          messages: [
            { role: "system", content: buildSystemPrompt(activeTopic) },
            ...updated.map((m) =>
              // Issue #159: 注記行は表示用の日本語ではなく、LLM への英語指示を送る
              m.kind === "note" && m.details
                ? { role: "system" as const, content: m.details }
                : { role: m.role, content: m.content },
            ),
          ],
          onChunk: (chunk) => {
            setStreamingContent((prev) => prev + chunk);
          },
          signal: controller.signal,
        });
        const assistantMsg = createAssistantMessage(result.content);
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");

        // Auto-speak the response (issue #47: track it for the gold badge)
        // Issue #83: only show the badge if an utterance actually queued.
        if (speak(result.content, () => setSpeakingId(null))) {
          setSpeakingId(assistantMsg.id);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        const rawMsg = e instanceof Error ? e.message : String(e);
        // Issue #111: requestLlmChat failures are already mapped to
        // action-linked wording in domain/llm (friendlyLlmError); keep the
        // local Failed-to-fetch mapping for errors thrown elsewhere.
        // Issue #122: the raw combined string was engineer-facing; show a
        // short summary card and tuck the diagnostics behind 詳しく.
        const mapped = rawMsg.includes("Failed to fetch")
          ? `LLM応答がありません（1件のプロバイダに失敗）。設定を確認してください。\n${friendlyLlmError(rawMsg)}`
          : rawMsg;
        const { summary, details } = splitSendError(mapped);
        setStreamingContent("");
        // Issue #73: remember the failed text so 再送 works without retyping.
        setFailedSendText(text);
        // Issue #111: kind="error" renders the card without read-aloud.
        // Issue #122: details go on the message for the 詳しく disclosure.
        const errorMsg = { ...createAssistantMessage(summary, "error"), details };
        // Issue #166: 再送で置き換える対象（自分の発言 + エラーカード）を覚える。
        setFailedSendIds(note ? [errorMsg.id] : [nextMsg.id, errorMsg.id]);
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
        controllerRef.current = null;
        // Issue #157: 入力欄は loading 中も disabled にしないので、ここでの
        // フォーカスは基本そのまま残る。念のため（モバイルのキーボードなどで
        // 外れた場合の）復帰として残しておく。
        inputRef.current?.focus();
      }
    },
    [input, providers, messages, needsConfig, topic],
  );

  /**
   * Issue #147: 話題ボタン。空ログなら相手に振ってもらう最初のひと言を送り、
   * 会話中なら「話題を変えたい」と伝える。設定未完了のときは送らずに話題だけ
   * 選択状態にする（設定後にその話題で始められる）。
   * Issue #167: 設定未完了のときはチップを押しても何も起きないのに「話題:」見出し
   * だけ切り替わって「選べた」と誤解させていた。未設定ならチップを disabled にし、
   * 理由を出す（見出しを切り替えない）。
   */
  const topicsDisabled = providers.length === 0 || needsConfig;

  const startTopic = (t: ConversationTopic) => {
    setTopic(t);
    if (providers.length === 0 || needsConfig || loading) return;
    // Issue #159: 開始も切替も「学習者が打った発言」ではないので、user バブルでは
    // なく system の注記行を積み、LLM には英語の指示として渡す。
    const starting = !messages.some((m) => m.kind !== "note");
    void sendMessage(undefined, t, {
      content: topicNoteContent(t, starting),
      instruction: topicNoteInstruction(t, starting),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Issue #157: 送信中は Enter を無視する。入力欄を disabled にすると
      // ブラウザがフォーカスを外してしまい、毎回クリックし直す羽目になる。
      // 入力欄は有効のまま残し、送信の多重実行だけをここで止める。
      if (loading) return;
      sendMessage();
    } else if (e.key === "Escape") {
      setInput("");
    }
  };

  const handleStop = () => {
    controllerRef.current?.abort();
    setLoading(false);
    setStreamingContent("");
  };

  // Issue #150: 「何が消えるか」を往復数で示す（user の発話数 = 往復数）
  const userTurns = messages.filter((m) => m.role === "user").length;

  // Issue #150: 削除確認はブラウザ標準 confirm ではなくアプリ内モーダルで行う。
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Issue #151: 抽出デッキのレベルを追加時に選ぶ。null の間は既存デッキの
  // レベル（無ければ intermediate）を選択中として扱う。
  const [selectedLevel, setSelectedLevel] = useState<Deck["level"] | null>(
    null,
  );
  const existingConversationDeck = state.decks.find(
    (d) => d.deckId === CONVERSATION_DECK_ID,
  );
  const deckLevel =
    selectedLevel ?? existingConversationDeck?.level ?? "intermediate";

  const handleClear = () => {
    setConfirmingClear(true);
  };

  const handleClearConfirmed = () => {
    setConfirmingClear(false);
    setMessages([]);
    setInput("");
    setStreamingContent("");
    setExtracted(null);
    setExtractError(null);
    setSavedMessage(null);
    setSavedDeck(null);
    setRestoreNotice(null);
    setSessionPickerOpen(false);
    // Issue #158: ログを消したのに話題だけ残ると中途半端なので、フリーに戻す
    setTopic(null);
    // Issue #148: 消すのは「表示中のセッション」だけ（他のセッションは残す）。
    // 旧テーブルの固定キーも消して、次に開いたときに復活させない。
    void storage.deleteConversationSession(sessionIdRef.current);
    void storage.deleteConversation();
    // 次に話し始めたら新しいセッションとして残す
    sessionIdRef.current = newSessionId();
    sessionCreatedAtRef.current = new Date().toISOString();
    void refreshSessions();
  };

  // Issue #148: 過去のセッションを開く（日付つきの一覧を出し、選ぶと読み込む）
  const handleOpenSessionPicker = () => {
    void refreshSessions();
    setSessionPickerOpen((open) => !open);
  };

  const handleSelectSession = async (id: string) => {
    try {
      const record = await storage.loadConversationSession(id);
      if (!record) {
        void refreshSessions();
        return;
      }
      sessionIdRef.current = record.id;
      sessionCreatedAtRef.current = record.createdAt;
      setMessages(record.messages);
      setTopic(topicFromId(record.topicId));
      setInput(record.draft ?? "");
      setStreamingContent("");
      setExtracted(null);
      setExtractError(null);
      setSavedMessage(null);
      setSavedDeck(null);
      setRestoreNotice(null);
      setSessionPickerOpen(false);
    } catch {
      // 読み込みに失敗しても今の会話は消さない
    }
  };

  // --- Issue #19: 会話ログから学習コンテンツを抽出（提案→承認でデッキ保存） ---

  const handleExtract = useCallback(async () => {
    if (providers.length === 0 || extracting) return;
    setExtracting(true);
    setExtractError(null);
    setSavedMessage(null);
    setSavedDeck(null);
    const controller = new AbortController();
    extractControllerRef.current = controller;
    try {
      const items = await extractContentWithLlm({
        providers,
        messages,
        signal: controller.signal,
      });
      // 既存デッキ（bundled + 会話抽出）の全termと重複チェック
      const existingTerms = state.decks.flatMap((d) =>
        d.lessons.flatMap((l) => l.words.map((w) => w.term)),
      );
      const fresh = dedupeExtracted(items, existingTerms);
      if (fresh.length === 0) {
        setExtracted(null);
        setExtractError(
          items.length > 0
            ? "見つけた語彙はすべて既存デッキにありました。"
            : "この会話から抽出できる項目はありませんでした。",
        );
      } else {
        setExtracted(fresh);
        setChecked(new Set(fresh.map((_, i) => i)));
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
      extractControllerRef.current = null;
    }
  }, [providers, messages, extracting, state.decks]);

  const toggleItem = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleSaveExtracted = useCallback(async () => {
    if (!extracted) return;
    const approved = extracted.filter((_, i) => checked.has(i));
    if (approved.length === 0) return;
    try {
      const now = new Date().toISOString();
      const existingRecord = existingConversationDeck;
      // Issue #151: 追加時に選んだレベル（未選択なら既存デッキのレベル）
      const level = deckLevel;
      let deck;
      if (existingRecord) {
        const merged = mergeIntoConversationDeck(existingRecord, approved, {
          now,
          level,
        });
        deck = merged.deck;
      } else {
        deck = buildConversationDeck(approved, { now, level });
      }
      // 保存前にスキーマ再検証（LLM由来データを決して素で入れない）
      const parsed = deckSchema.safeParse(deck);
      if (!parsed.success) {
        setExtractError(
          `デッキ検証に失敗しました: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .slice(0, 2)
            .join(" / ")}`,
        );
        return;
      }
      const updatedDecks = existingRecord
        ? state.decks.map((d) =>
            d.deckId === parsed.data.deckId ? parsed.data : d,
          )
        : [...state.decks, parsed.data];
      await storage.saveUserDeck({
        deckId: parsed.data.deckId,
        deck: parsed.data,
        sourceTurns: messages.length,
        createdAt: now,
        updatedAt: now,
      });
      dispatch({ type: "setDecks", decks: updatedDecks });
      setSavedMessage(
        `✓ ${approved.length} 件を「${parsed.data.title}」に追加しました。`,
      );
      // Issue #141: 追加した語にその場で入れるよう、遷移先（デッキ/レッスン）を覚えておく
      const firstLessonId = parsed.data.lessons[0]?.lessonId;
      setSavedDeck(
        firstLessonId
          ? {
              deckId: parsed.data.deckId,
              lessonId: firstLessonId,
              count: approved.length,
            }
          : null,
      );
      setExtracted(null);
      setExtractError(null);
      setSelectedLevel(null);
    } catch (e: unknown) {
      setExtractError(e instanceof Error ? e.message : String(e));
    }
  }, [
    extracted,
    checked,
    existingConversationDeck,
    deckLevel,
    messages,
    storage,
    dispatch,
  ]);

  const handleSpeak = (id: string, text: string) => {
    // Issue #47: gold rune-caption indicator while the utterance plays
    // Issue #83: give feedback when the env has no TTS voices
    if (speechAvail !== "ready") {
      setMessages((prev) => [
        ...prev,
        createAssistantMessage(
          "⚠ このブラウザは音声未対応です（TTSボイスがありません）",
          "error",
        ),
      ]);
      return;
    }
    setSpeakingId(id);
    speak(text, () => setSpeakingId(null));
  };

  return (
    <div className={`container ${styles.root}`}>
      {/* Header */}
      <div className={`nav-header ${styles.navHeader}`}>
        <h2 className={styles.title}>英会話</h2>
        <div className={styles.headerActions}>
          {/* Issue #148: 直近3セッションを日付で選べる（一覧 UI は最小限） */}
          <button
            className={`ghost ${styles.clearButton}`}
            onClick={handleOpenSessionPicker}
            data-testid="open-session-picker"
            aria-expanded={sessionPickerOpen}
          >
            🕘 過去のセッション
          </button>
          <button
            className={`ghost ${styles.clearButton}`}
            onClick={handleClear}
            disabled={messages.length === 0}
          >
            クリア
          </button>
          <button
            className="ghost"
            onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          >
            戻る
          </button>
        </div>
      </div>

      {/* Config warning (issue #73: direct link to settings) */}
      {configError && (
        <div className={`card ${styles.configWarning}`}>
          <span>{configError}</span>
          <button
            className={`ghost ${styles.settingsLink}`}
            onClick={() =>
              dispatch({ type: "go", screen: { name: "settings" } })
            }
          >
            設定を開く
          </button>
        </div>
      )}

      {/* Issue #138: 復元したことを黙ってやらない（何が残っているか分かるように） */}
      {restoreNotice && (
        <div className={`card ${styles.restoreNotice}`} role="status">
          <span>{restoreNotice}</span>
          <button className="ghost" onClick={() => setRestoreNotice(null)}>
            閉じる
          </button>
        </div>
      )}

      {/* Issue #148: 過去のセッション（日付つきで選ぶと読み込む） */}
      {sessionPickerOpen && (
        <div className={`card ${styles.sessionPicker}`} data-testid="session-picker">
          <div className={styles.sessionPickerHeader}>
            <strong>過去のセッション</strong>
            <button
              className="ghost"
              onClick={() => setSessionPickerOpen(false)}
            >
              閉じる
            </button>
          </div>
          <p className={styles.sessionPickerNote}>
            直近{MAX_CONVERSATION_SESSIONS}
            セッションまで、この端末に保存しています。選ぶとその会話から続けられます。
          </p>
          {sessions.length === 0 ? (
            <p className={styles.sessionPickerEmpty}>
              保存されたセッションはまだありません。
            </p>
          ) : (
            <ul className={styles.sessionList}>
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`ghost ${styles.sessionItem} ${
                      s.id === sessionIdRef.current ? styles.sessionItemCurrent : ""
                    }`}
                    data-testid={`session-item-${s.id}`}
                    aria-current={s.id === sessionIdRef.current}
                    onClick={() => void handleSelectSession(s.id)}
                  >
                    <span className={styles.sessionDate}>
                      {formatSessionDate(s.updatedAt)}
                    </span>
                    <span className={styles.sessionTurns}>{s.turns}往復</span>
                    <span className={styles.sessionPreview}>
                      {s.preview || "(無題)"}
                    </span>
                    {s.id === sessionIdRef.current && (
                      <span className={styles.sessionCurrentBadge}>表示中</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <div className={styles.messagesArea}>
        {messages.length === 0 && !streamingContent && (
          <div className={`card ${styles.emptyState}`}>
            {/* Issue #175: 未設定なのに「英語でメッセージを送って会話を始めましょう！」と
                誘い、操作要素は全部止まっていた。設定が済むまでは誘い文句を出さず、
                「まず設定」を主役にする（設定完了後の案内は従来どおり）。 */}
            {needsConfig ? (
              <p className={styles.emptyHint}>
                会話を始めるには、まず上の警告の「設定を開く」からエンドポイントを設定してください。設定が済むと、ここから会話を始められます。
              </p>
            ) : (
              <>
                <p>英語でメッセージを送って会話を始めましょう！</p>
                <p className={styles.emptyHint}>
                  例: "Hi! How are you?", "What did you do today?"
                </p>
              </>
            )}
            {/* Issue #147: 話題の入口が無いと毎回ネタを自分で振ることになる。
                押すと相手役＋進め方を決めた状態で相手から話を振ってもらう。 */}
            <div className={styles.topicPicker}>
              {/* Issue #175: 未設定ではチップが disabled で使えないので、話題の
                  問いかけは出さない（警告の重複を避ける）。設定後は従来どおり。 */}
              {!needsConfig && <p className={styles.topicIntro}>今日は何を話す？</p>}
              <div className={styles.topicButtons}>
                {CONVERSATION_TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`topic-preset-${t.id}`}
                    aria-pressed={topic?.id === t.id}
                    className={`ghost ${styles.topicButton} ${
                      topic?.id === t.id ? styles.topicButtonActive : ""
                    }`}
                    // Issue #173: 未設定のときはチップが有効に見えるのに押しても
                    // 何も起きなかった（入力欄・送信は disabled で理由も出ている）。
                    // 同じ画面で「無効なもの」と「有効に見えて無反応なもの」が
                    // 混在しないよう、未設定ならチップも disabled にする。
                    disabled={topicsDisabled}
                    title={
                      topicsDisabled
                        ? "先に設定（APIエンドポイント）が必要です"
                        : undefined
                    }
                    onClick={() => startTopic(t)}
                  >
                    <span className={styles.topicEmoji}>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              {/* Issue #175: 警告文の重複を解消。未設定時の理由は上の警告カードに
                  一本化し、ここでは通常時の使い方だけを示す。 */}
              {!needsConfig && (
                <p className={styles.topicNote}>
                  選ぶと相手から話を振ります。自分で始めたいときは下の入力欄へどうぞ。
                </p>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              "chat-bubble-wrap" +
              (msg.kind === "note" ? ` ${styles.noteRow}` : "") +
              (msg.role === "user" ? " user" : "") +
              (speakingId === msg.id ? ` ${styles.speakingRow}` : "")
            }
          >
            {/* Issue #85: NPC mouth flaps while the bubble is read aloud */}
            {msg.role === "assistant" && speakingId === msg.id && (
              <TalkSprite />
            )}
            <div className={styles.bubbleColumn}>
              <div
                className={`card ${styles.bubble} ${
                  msg.role === "assistant" ? styles.bubbleNpc : ""
                } ${msg.role === "user" ? styles.bubbleUser : ""} ${
                  speakingId === msg.id ? styles.speaking : ""
                } ${msg.kind === "error" ? styles.bubbleError : ""} ${
                  msg.kind === "note" ? styles.bubbleNote : ""
                }`}
              >
                {msg.content}
                {/* Issue #122: raw diagnostics tucked behind a disclosure */}
                {msg.kind === "error" && msg.details && (
                  <details className={styles.errorDetails}>
                    <summary>詳しく（技術情報）</summary>
                    <pre className={styles.errorDetailsText}>{msg.details}</pre>
                  </details>
                )}
              </div>
              {/* Issue #111: error cards are not conversation — no TTS. */}
              {msg.role === "assistant" && msg.kind !== "error" && (
                <button
                  className={`ghost ${styles.speakButton}`}
                  onClick={() => handleSpeak(msg.id, msg.content)}
                  title={
                    speechAvail === "ready"
                      ? "音声再生"
                      : "このブラウザは音声未対応（TTSボイス0個）"
                  }
                >
                  {speechAvail === "ready" ? "🔊" : "🔇"} 読み上げ
                </button>
              )}
              {msg.role === "assistant" && speakingId === msg.id && (
                <span className={styles.speakingBadge} aria-live="polite">
                  ♪ 読み上げ中
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {streamingContent && (
          <div className="chat-bubble-wrap">
            <div className={`card ${styles.bubble}`}>
              {streamingContent}
              <span className={`cursor-blink ${styles.cursorBlink}`}>▍</span>
            </div>
          </div>
        )}

        {/* Loading dots when no streaming content yet */}
        {loading && !streamingContent && (
          <div className="chat-bubble-wrap">
            <div className={`card ${styles.loadingBubble}`}>
              <span className="loading-dots">考え中...</span>
              {/* Issue #122: users could not tell how long to wait */}
              <span className={styles.loadingHint} role="status">
                応答に数秒かかることがあります（30秒前後でタイムアウト）
              </span>
            </div>
          </div>
        )}

        {/* Issue #73: after a send failure, offer 再送 without retyping */}
        {failedSendText && !loading && (
          <div className={styles.retryBar}>
            <button
              className={`primary ${styles.retryButton}`}
              onClick={() => sendMessage(failedSendText, undefined, undefined, failedSendIds)}
            >
              再送
            </button>
            <span className={styles.retryHint}>
              「{failedSendText}」を再送信
            </span>
            <button
              className={`ghost ${styles.retrySettingsButton}`}
              onClick={() =>
                dispatch({ type: "go", screen: { name: "settings" } })
              }
            >
              設定を確認
            </button>
          </div>
        )}

        {/* Issue #19: 会話終了後に抽出 → 承認した項目だけユーザーデッキへ */}
        {!loading && messages.filter((m) => m.role === "user").length >= 2 && (
          <div className={styles.extractBar}>
            <button
              className={`ghost ${styles.extractButton}`}
              onClick={handleExtract}
              disabled={extracting || providers.length === 0}
            >
              {extracting ? "抽出中..." : "🔍 この会話から学ぶ"}
            </button>
            {savedMessage && (
              <span className={styles.savedHint}>{savedMessage}</span>
            )}
            {/* Issue #141: 追加した直後にそのまま学習へ。以前はここから
                デッキ一覧を探し直す4タップが必要だった。 */}
            {savedDeck && (
              <button
                className="primary"
                data-testid="conversation-study-now"
                onClick={() =>
                  dispatch({
                    type: "go",
                    screen: {
                      name: "quiz",
                      deckId: savedDeck.deckId,
                      lessonId: savedDeck.lessonId,
                    },
                  })
                }
              >
                この {savedDeck.count} 語を今すぐ学習
              </button>
            )}
          </div>
        )}

        {extractError && (
          <div className={`card ${styles.configWarning}`}>
            <span>⚠ {extractError}</span>
            {/* Issue #133: 失敗の文言が「もう一度試行してください」なのに
                戻るしか無かった。その場で再試行できるようにする。 */}
            <button
              className="primary"
              onClick={() => void handleExtract()}
              disabled={extracting}
            >
              {extracting ? "抽出中..." : "再試行"}
            </button>
          </div>
        )}

        {extracted && !extracting && (
          <div className={`card ${styles.extractPanel}`} aria-live="polite">
            <h3 className={styles.extractTitle}>
              {extracted.length} 件の学習項目を見つけました —
              追加する項目にチェックしてください
            </h3>
            <ul className={styles.extractList}>
              {extracted.map((item, i) => (
                <li key={`${item.term}-${i}`} className={styles.extractItem}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked.has(i)}
                      onChange={() => toggleItem(i)}
                    />
                    <span className={styles.extractType}>
                      {TYPE_LABELS[item.type]}
                    </span>
                    <span className={styles.extractTerm}>{item.term}</span>
                    <span className={styles.extractMeaning}>
                      {item.meaning}
                    </span>
                  </label>
                  {item.example && (
                    <p className={styles.extractExample}>
                      {item.type === "grammar-correction" &&
                      item.correctedVersion
                        ? `✓ ${item.correctedVersion}`
                        : item.example}
                    </p>
                  )}
                  {item.explanation && (
                    <p className={styles.extractNote}>{item.explanation}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className={styles.extractActions}>
              {/* Issue #151: レベルは intermediate 固定だった。追加時に選ばせる。 */}
              <label className={styles.levelPicker}>
                デッキのレベル
                <select
                  value={deckLevel}
                  onChange={(e) =>
                    setSelectedLevel(e.target.value as Deck["level"])
                  }
                >
                  {LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={`primary ${styles.saveAllButton}`}
                onClick={handleSaveExtracted}
                disabled={checked.size === 0}
              >
                チェックした {checked.size} 件をデッキに追加
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setExtracted(null);
                  setExtractError(null);
                  setSelectedLevel(null);
                }}
              >
                却下
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Issue #147: 会話中の話題スイッチ。「海外雑談 → 仕事英語」のように
          進めたい方向を自分で選べるようにする（ペルソナのゴール）。 */}
      {messages.length > 0 && (
        <div className={styles.topicBar}>
          <span className={styles.topicBarLabel}>
            {topic ? `話題: ${topic.emoji} ${topic.label}` : "話題: フリー"}
          </span>
          <div className={styles.topicButtons}>
            {CONVERSATION_TOPICS.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`topic-switch-${t.id}`}
                aria-pressed={topic?.id === t.id}
                className={`ghost ${styles.topicChip} ${
                  topic?.id === t.id ? styles.topicChipActive : ""
                }`}
                disabled={loading || topicsDisabled}
                title={
                  topicsDisabled
                    ? "先に設定（APIエンドポイント）が必要です"
                    : undefined
                }
                onClick={() => startTopic(t)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          {topicsDisabled && (
            <span className={styles.topicDisabledHint} role="status">
              ⚠ 先に設定（APIエンドポイント）が必要です。選んだ話題は設定後から使えます。
            </span>
          )}
        </div>
      )}

      {/* Input */}
      <div className={styles.inputBar}>
        {/* Issue #169: Shift+Enter 改行がショートカット一覧に載っていたのに
            1行 <input> で効かなかった。複数行入力できる textarea にする。
            Enter 単体は送信、Shift+Enter は改行（handleKeyDown 側で分岐）。 */}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            needsConfig
              ? "（設定を済ませると英語で入力できます）"
              : "英語でメッセージを入力..."
          }
          disabled={providers.length === 0 || needsConfig}
          className={styles.chatInput}
        />
        {loading ? (
          <button className={styles.sendButton} onClick={handleStop}>
            停止
          </button>
        ) : (
          <button
            className={`primary ${styles.sendButton}`}
            onClick={() => sendMessage()}
            disabled={!input.trim() || providers.length === 0 || needsConfig}
            title={
              needsConfig
                ? "設定画面でAPIエンドポイントを指定してください"
                : undefined
            }
          >
            送信
          </button>
        )}
      </div>

      {/* Issue #150: 削除確認はアプリ内モーダル（標準 confirm をやめた） */}
      {confirmingClear && (
        <ConfirmDialog
          title="会話履歴を削除しますか？"
          confirmLabel="削除する"
          onConfirm={handleClearConfirmed}
          onCancel={() => setConfirmingClear(false)}
        >
          <p>
            表示中の会話履歴（{userTurns}
            往復）を削除します。他のセッションと、抽出済みの語はデッキに残ります。
          </p>
          <p>この操作は元に戻せません。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
