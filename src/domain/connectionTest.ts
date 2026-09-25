import {
  diagnoseFetchFailure,
  testLlmConnection,
  type EndpointDiagnosis,
  type LlmConnectionTestResult,
  type LlmProviderConfig,
} from "./llm";

/**
 * Issue #121: 「接続テスト → 失敗理由の切り分け」を1箇所にまとめた薄いラッパ。
 *
 * Settings 画面と初回セットアップウィザードの両方が同じ文言・同じ判定を使う
 * ようにするための抽出（挙動は issue #110/#111 時点と同じ）。
 */
export interface ConnectionTestOutcome extends LlmConnectionTestResult {
  /** 失敗がネットワーク層のときだけ入る切り分け結果 */
  diagnosis: EndpointDiagnosis | null;
}

export const CORS_BLOCKED_MESSAGE =
  "CORS拒否: サーバーには到達しましたが、このエンドポイントはブラウザ直接接続（fetch）を許可していません。同一オリジンのリレー/リバースプロキシ経由か、CORS対応プロバイダ（OpenRouter等）を使ってください";

export const UNREACHABLE_MESSAGE =
  "エンドポイントに到達できません（URLミス or サーバーダウン）。http://192.168.x.x:PORT/v1 の形式・ポート開放を確認してください";

export async function runConnectionTest(
  provider: LlmProviderConfig,
): Promise<ConnectionTestOutcome> {
  const result = await testLlmConnection(provider);
  if (result.ok || !(result.error ?? "").includes("Failed to fetch")) {
    return { ...result, diagnosis: null };
  }
  let origin = "";
  try {
    origin = new URL(provider.apiEndpoint).origin;
  } catch {
    origin = "";
  }
  if (!origin) return { ...result, diagnosis: null };

  const diagnosis = await diagnoseFetchFailure(origin);
  return {
    ...result,
    diagnosis,
    error:
      diagnosis === "cors-blocked" ? CORS_BLOCKED_MESSAGE : UNREACHABLE_MESSAGE,
  };
}
