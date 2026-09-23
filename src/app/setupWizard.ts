import { DEFAULT_SETTINGS } from "../storage/types";
import type { EndpointDiagnosis } from "../domain/llm";

/**
 * Issue #121: 初回セットアップウィザードの表示条件と、失敗時のセルフチェック。
 *
 * 「新規ブラウザプロファイルで開くと、英会話タブに到達する前にエンドポイントを
 * 入力・接続テストする導線が無い」というペルソナ指摘に対する実装。
 * 表示条件は純関数にしておき、UI（SetupWizard）から独立してテストできるようにする。
 */

export interface SetupWizardSettingsShape {
  llmApiEndpoint: string;
  llmSetupDismissed?: boolean;
}

/**
 * ウィザードを出すか。
 *
 * - 明示的にスキップ/完了済み（llmSetupDismissed）なら出さない
 * - エンドポイントが空 or 初期値（localhost プレースホルダ）のときだけ出す
 *   ※「保存済みだが未検証」は全画面リボン（endpointStatus.ts）が担当するので
 *     ここでは扱わない（毎回モーダルで塞ぐと鬱陶しいため）
 */
export function shouldOfferSetupWizard(
  settings: SetupWizardSettingsShape,
): boolean {
  if (settings.llmSetupDismissed) return false;
  const endpoint = settings.llmApiEndpoint.trim();
  if (!endpoint) return true;
  return endpoint === DEFAULT_SETTINGS.llmApiEndpoint.trim();
}

/**
 * 初期値として提示するエンドポイント。
 *
 * 「新規デバイスだと接続先を全部手打ち」という指摘（issue #121）に対して、
 * アプリを配信しているホスト名から Ollama の標準ポートを推定する。
 * localhost / 127.0.0.1 で開いている場合は推定できないので空を返す。
 */
export function suggestedEndpoint(hostname: string): string {
  const host = (hostname ?? "").trim();
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "";
  }
  return `http://${host}:11434/v1`;
}

/**
 * 接続テスト失敗時のおすすめ確認項目。サーバー側の設定（LAN待ち受け/CORS）まで
 * ユーザーが自力で疑えるようにする。diagnosis が分かる場合は先頭に出す。
 */
export function setupSelfCheckItems(
  diagnosis: EndpointDiagnosis | null = null,
): string[] {
  const base = [
    "URLの末尾が /v1 になっているか（例: http://192.168.68.52:11434/v1）",
    "localhost / 127.0.0.1 はこのアプリを開いている端末自身を指す。別PCのLLMなら LAN IP を指定する",
    "サーバーがLANから待ち受けているか（Ollama なら OLLAMA_HOST=0.0.0.0:11434 で再起動）",
    "サーバー側でブラウザからの直接接続（CORS）が許可されているか。未対応なら同一オリジンのリバースプロキシ経由にする",
    "PCのファイアウォールで該当ポート（11434 等）が開いているか",
  ];
  if (diagnosis === "cors-blocked") {
    return [
      "サーバー自体には到達しています。次は CORS 許可（または同一オリジンのリレー経由）を確認してください",
      ...base.slice(3),
    ];
  }
  if (diagnosis === "unreachable") {
    return [
      "エンドポイントに到達できていません。まず URL・ポート・サーバー起動状態を確認してください",
      ...base,
    ];
  }
  return base;
}
