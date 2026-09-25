import { DEFAULT_SETTINGS } from "../storage/types";
import { providersFromSettings } from "../domain/llm";

/**
 * Issue #121: エンドポイント設定の状態を「常設警告リボン」の表示情報に変換する。
 *
 * 会話タブ内の警告バナー（ConversationScreen）と判定条件を揃えることで、
 * 「タブを開くまで気づかない」問題を解消する。純関数なので UI から独立。
 */
export interface EndpointWarning {
  /** missing: 未設定 / default: 初期値のまま / unverified: 接続確認前 */
  kind: "missing" | "default" | "unverified";
  /** リボンに出す短いメッセージ */
  message: string;
  /** クリック時の遷移先ラベル */
  actionLabel: string;
}

interface EndpointSettingsShape {
  llmApiEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmFallbackApiEndpoint?: string;
  llmFallbackModel?: string;
  llmFallbackApiKey?: string;
  /** 直近の接続テストに成功したエンドポイント（issue #123） */
  llmVerifiedEndpoint?: string;
}

export function endpointWarning(
  settings: EndpointSettingsShape,
): EndpointWarning | null {
  const chain = providersFromSettings(settings);
  if (chain.length === 0) {
    return {
      kind: "missing",
      message:
        "⚠ LLMエンドポイントが未設定です。英会話を始めるには接続先の設定が必要です。",
      actionLabel: "設定を開く",
    };
  }
  const primary = chain[0].apiEndpoint.trim();
  // Issue #130: a live connection test is the strongest possible evidence.
  // When this exact endpoint passed one, stop warning — even if the URL is
  // still the localhost placeholder (a local-LLM setup on this PC is a
  // legitimate configuration and the default value is simply correct).
  if ((settings.llmVerifiedEndpoint ?? "").trim() === primary) {
    return null;
  }
  if (primary === DEFAULT_SETTINGS.llmApiEndpoint.trim()) {
    return {
      kind: "default",
      message:
        "⚠ LLMエンドポイントが初期値（http://localhost:11434/v1）のままです。このPC上のローカルサーバを指すプレースホルダで、デプロイ先からは使えません。",
      actionLabel: "設定を開く",
    };
  }
  return {
    kind: "unverified",
    message:
      "⚠ LLMエンドポイントの接続確認がまだ成功していません。設定画面で「接続テスト」を実行してください。",
    actionLabel: "設定を開く",
  };
}
