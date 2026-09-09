import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type {
  StorageProvider,
  Settings as SettingsType,
} from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import {
  diagnoseFetchFailure,
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

  const friendlyTestError = (raw: string): string => {
    if (raw === "Failed to fetch" || raw === "timeout") {
      return `${raw === "timeout" ? "タイムアウト（15秒応答なし）" : "接続できませんでした（URL誤り・CORS・ネット切れのいずれか）"}`;
    }
    return raw;
  };

  const handleTest = async (which: "primary" | "fallback") => {
    const validationError = validateProvider(which);
    if (validationError) {
      setMessage(
        `接続テスト失敗（${which === "primary" ? "プライマリ" : "フォールバック"}）: ${validationError}`,
      );
      return;
    }
    const chain = providersFromSettings(settings);
    const provider = which === "primary" ? chain[0] : chain[1];
    if (!provider) {
      setMessage("接続テスト失敗: エンドポイントが未設定です");
      return;
    }
    setTesting(which);
    setMessage(null);
    const result = await testLlmConnection(provider);
    if (!result.ok) {
      // Issue #80: separate CORS-blocked from unreachable so the user knows
      // whether they need a relay/proxy or a URL fix.
      const raw = result.error ?? "";
      if (raw.includes("Failed to fetch")) {
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
          }
        }
      }
    }
    setTesting(null);
    if (result.ok) {
      setMessage(
        `接続OK（${provider.label} / ${provider.model}）: ${result.latencyMs}ms`,
      );
    } else {
      setMessage(
        `接続テスト失敗（${provider.label}）: ${friendlyTestError(result.error ?? "不明なエラー")}（${result.latencyMs}ms）`,
      );
    }
    setTimeout(() => setMessage(null), 8000);
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
          <p className={styles.hintFooter}>
            OpenAI互換APIに対応。別PCのローカルLLM（Ollama / vLLM / llama.cpp
            など）を指定できます。
          </p>
        </div>
      </div>
    </div>
  );
}
