import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type {
  StorageProvider,
  Settings as SettingsType,
} from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import {
  diagnoseFetchFailure,
  friendlyLlmError,
  providersFromSettings,
  testLlmConnection,
} from "../domain/llm";
import styles from "./Settings.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function Settings({ dispatch, storage }: Props) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [exported, setExported] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState<"primary" | "fallback" | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = await storage.loadSettings();
      if (!mounted) return;
      setSettings(s);
    })();
    return () => {
      mounted = false;
    };
  }, [storage]);

  const save = async (patch: Partial<SettingsType>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await storage.saveSettings(patch);
    setMessage("保存しました");
    setTimeout(() => setMessage(null), 2000);
  };

  const handleExport = async () => {
    const data = await storage.exportAll();
    const json = JSON.stringify(data, null, 2);
    setExported(json);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `english-practice-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!exported) return;
    try {
      const data = JSON.parse(exported);
      await storage.importAll(data);
      setMessage("インポートしました");
    } catch (e) {
      setMessage(
        `インポート失敗: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const handleClear = async () => {
    if (!confirm("すべてのデータを削除しますか？この操作は元に戻せません。"))
      return;
    await storage.clearAll();
    setSettings(DEFAULT_SETTINGS);
    setMessage("データを削除しました");
  };

  // Issue #74: client-side validation before hitting the network, so the
  // user sees "エンドポイントが空です" instead of a bare "Failed to fetch".
  const validateProvider = (which: "primary" | "fallback"): string | null => {
    const endpoint =
      which === "primary"
        ? settings.llmApiEndpoint
        : settings.llmFallbackApiEndpoint;
    const model =
      which === "primary" ? settings.llmModel : settings.llmFallbackModel;
    if (!endpoint.trim()) return "APIエンドポイントが空です";
    if (!/^https?:\/\//i.test(endpoint.trim()))
      return "APIエンドポイントが http(s):// で始まりません";
    if (!model.trim()) return "モデル名が空です";
    return null;
  };

  // Issue #110: the test result used to go through the shared auto-clearing
  // `message` (8s), which erased itself while a slow test was still running —
  // the user saw "テスト中..." silently revert. Results now live in a
  // per-provider, never-auto-cleared status region inside the provider card.
  const [testResult, setTestResult] = useState<
    Record<"primary" | "fallback", string | null>
  >({ primary: null, fallback: null });

  const handleTest = async (which: "primary" | "fallback") => {
    const validationError = validateProvider(which);
    if (validationError) {
      setTestResult((prev) => ({
        ...prev,
        [which]: `❌ ${validationError}`,
      }));
      return;
    }
    const chain = providersFromSettings(settings);
    const provider = which === "primary" ? chain[0] : chain[1];
    if (!provider) {
      setTestResult((prev) => ({
        ...prev,
        [which]: "❌ エンドポイントが未設定です",
      }));
      return;
    }
    setTesting(which);
    setTestResult((prev) => ({ ...prev, [which]: null }));
    const result = await testLlmConnection(provider);
    if (!result.ok && (result.error ?? "").includes("Failed to fetch")) {
      let origin = "";
      try {
        origin = new URL(provider.apiEndpoint).origin;
      } catch {
        origin = "";
      }
      if (origin) {
        const diag = await diagnoseFetchFailure(origin);
        if (diag === "cors-blocked") {
          result.error =
            "CORS拒否: サーバーには到達しましたが、このエンドポイントはブラウザ直接接続（fetch）を許可していません。同一オリジンのリレー/リバースプロキシ経由か、CORS対応プロバイダ（OpenRouter等）を使ってください";
        } else {
          result.error =
            "エンドポイントに到達できません（URLミス or サーバーダウン）。http://192.168.x.x:PORT/v1 の形式・ポート開放を確認してください";
        }
      }
    }
    setTesting(null);
    const secs = (result.latencyMs / 1000).toFixed(1);
    if (result.ok) {
      setTestResult((prev) => ({
        ...prev,
        [which]: `✅ 接続OK（model: ${provider.model}、往復 ${secs}s）`,
      }));
    } else {
      setTestResult((prev) => ({
        ...prev,
        [which]: `❌ 接続テスト失敗: ${friendlyLlmError(result.error ?? "不明なエラー")}（${secs}s）`,
      }));
    }
  };

  return (
    <div className="container">
      <div className="nav-header">
        <h2>設定</h2>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
        >
          戻る
        </button>
      </div>

      {message && (
        <div
          className={`card ${message.includes("失敗") ? styles.messageFail : styles.messageOk}`}
        >
          {message}
        </div>
      )}

      <div className="card-grid settings-grid">
        <div className="card">
          <label>
            1日の目標語数
            <input
              type="number"
              min={1}
              max={100}
              value={settings.dailyGoalWords}
              onChange={(e) => save({ dailyGoalWords: Number(e.target.value) })}
              className={`${styles.field} ${styles.goalNumber}`}
            />
          </label>
        </div>

        <div className="card">
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(e) => save({ soundEnabled: e.target.checked })}
            />
            音声フィードバックを有効にする
          </label>
        </div>

        <div className="card">
          <h3>データのバックアップ / 復元</h3>
          <button onClick={handleExport} className={styles.blockButton}>
            バックアップをダウンロード
          </button>
          <textarea
            value={exported}
            onChange={(e) => setExported(e.target.value)}
            placeholder="JSONをここに貼り付けてインポート"
            rows={5}
            className={styles.exportArea}
          />
          <button onClick={handleImport} className={styles.blockButton}>
            インポート
          </button>
          <button
            className={`danger ${styles.fullWidth}`}
            onClick={handleClear}
          >
            すべてのデータを削除
          </button>
        </div>

        <div className="card">
          <h3>Self-Improve（自己改善）</h3>
          <p className={styles.hint}>
            LLMによる復習間隔の調整案などを生成する機能です。デフォルトはオフ。
            提案は「承認」を押すまで適用されません。
          </p>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={settings.selfImproveEnabled}
              onChange={(e) => save({ selfImproveEnabled: e.target.checked })}
            />
            Self-Improveを有効にする
          </label>
          <fieldset disabled={!settings.selfImproveEnabled}>
            <legend>自動適用レベル</legend>
            {(
              [
                ["none", "すべて提案のみ（承認必須）"],
                ["quiz", "問題生成のみ自動適用"],
                ["all", "安全範囲の提案は自動適用"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={styles.checkboxLabel}>
                <input
                  type="radio"
                  name="autoApplyLevel"
                  checked={settings.autoApplyLevel === value}
                  onChange={() => save({ autoApplyLevel: value })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className={styles.hintFooter}>
            提案のレビュー・履歴・ロールバックは進捗ダッシュボードから行えます。
          </p>
        </div>

        <div className="card">
          <h3>英会話 AI 設定</h3>
          <label>
            API エンドポイント
            <input
              type="text"
              value={settings.llmApiEndpoint}
              onChange={(e) => save({ llmApiEndpoint: e.target.value })}
              placeholder="http://192.168.1.100:11434/v1"
              className={styles.fieldSpaced}
            />
          </label>
          <label>
            モデル名
            <input
              type="text"
              value={settings.llmModel}
              onChange={(e) => save({ llmModel: e.target.value })}
              placeholder="deepseek-v4-flash"
              className={styles.fieldSpaced}
            />
          </label>
          <label>
            API キー（必要な場合）
            <input
              type="password"
              value={settings.llmApiKey}
              onChange={(e) => save({ llmApiKey: e.target.value })}
              placeholder="sk-..."
              className={styles.field}
            />
          </label>
          <button
            onClick={() => handleTest("primary")}
            disabled={testing !== null}
            className={styles.testButton}
          >
            {testing === "primary" ? "テスト中..." : "接続テスト（プライマリ）"}
          </button>
          {/* Issue #110: persistent, never auto-cleared test result */}
          {testResult.primary && (
            <p
              className={`${styles.testStatus} ${
                testResult.primary.startsWith("✅")
                  ? styles.testStatusOk
                  : styles.testStatusFail
              }`}
              role="status"
            >
              {testResult.primary}
            </p>
          )}
        </div>

        <div className="card">
          <h3>フォールバックプロバイダ（任意）</h3>
          <p className={styles.hint}>
            プライマリが失敗したときのみ使用します。未設定なら無効。 （例:
            プライマリ=OpenCode Go / フォールバック=OpenRouter）
          </p>
          <label>
            API エンドポイント
            <input
              type="text"
              value={settings.llmFallbackApiEndpoint}
              onChange={(e) => save({ llmFallbackApiEndpoint: e.target.value })}
              placeholder="https://opencode.ai/zen/go/v1"
              className={styles.fieldSpaced}
            />
          </label>
          <label>
            モデル名
            <input
              type="text"
              value={settings.llmFallbackModel}
              onChange={(e) => save({ llmFallbackModel: e.target.value })}
              placeholder="deepseek-v4-flash"
              className={styles.fieldSpaced}
            />
          </label>
          <label>
            API キー（必要な場合）
            <input
              type="password"
              value={settings.llmFallbackApiKey}
              onChange={(e) => save({ llmFallbackApiKey: e.target.value })}
              placeholder="sk-..."
              className={styles.field}
            />
          </label>
          <button
            onClick={() => handleTest("fallback")}
            disabled={
              testing !== null || !settings.llmFallbackApiEndpoint.trim()
            }
            className={styles.testButton}
          >
            {testing === "fallback"
              ? "テスト中..."
              : "接続テスト（フォールバック）"}
          </button>
          {/* Issue #110: persistent, never auto-cleared test result */}
          {testResult.fallback && (
            <p
              className={`${styles.testStatus} ${
                testResult.fallback.startsWith("✅")
                  ? styles.testStatusOk
                  : styles.testStatusFail
              }`}
              role="status"
            >
              {testResult.fallback}
            </p>
          )}
          <p className={styles.hintFooter}>
            OpenAI互換APIに対応。別PCのローカルLLM（Ollama / vLLM / llama.cpp
            など）を指定できます。
          </p>
        </div>
      </div>
    </div>
  );
}
