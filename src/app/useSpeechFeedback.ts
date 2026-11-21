import { useCallback, useState } from "react";
import { speak } from "../domain/speech";

/**
 * Issue #287: 会話画面の「読み上げの進行状態」をコンポーネントから切り出す。
 *
 * 会話画面（ConversationScreen）は 1700 行超で、進行の state が1か所に
 * 集まりすぎている。読み上げは他の状態（送信・抽出・辞書引き）と依存が
 * 無いので、最初に切り出せる単位。
 *
 * - 押したとき（speakById）: 音声が使えない環境では再生せず通知だけ出す（#83）
 * - 応答到着時（autoSpeak）: 実際にキューされた時だけバッジを点ける（#47）
 */
export function useSpeechFeedback(opts: {
  /** 音声合成が使えるか（useSpeechSupport() === "ready"） */
  available: boolean;
  /** 使えない環境で押されたときの通知（#83） */
  onUnavailable?: () => void;
}) {
  const { available, onUnavailable } = opts;
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const clearSpeaking = useCallback(() => setSpeakingId(null), []);

  const speakById = useCallback(
    (id: string, text: string) => {
      if (!available) {
        onUnavailable?.();
        return;
      }
      setSpeakingId(id);
      speak(text, clearSpeaking);
    },
    [available, onUnavailable, clearSpeaking],
  );

  const autoSpeak = useCallback(
    (id: string, text: string) => {
      if (speak(text, clearSpeaking)) setSpeakingId(id);
    },
    [clearSpeaking],
  );

  return { speakingId, speakById, autoSpeak, clearSpeaking };
}
