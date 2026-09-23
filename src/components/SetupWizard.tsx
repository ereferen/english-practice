import { useEffect, useState } from "react";
import type { StorageProvider, Settings } from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import { friendlyLlmError, providersFromSettings } from "../domain/llm";
import { runConnectionTest } from "../domain/connectionTest";
import {
  setupSelfCheckItems,
  shouldOfferSetupWizard,
  suggestedEndpoint,
} from "../app/setupWizard";
import { setShortcutsSuppressed } from "../app/useKeyboardShortcuts";
import styles from "./SetupWizard.module.css";

interface Props {
  storage: StorageProvider;
  /** 設定画面にいる間は出さない（既に導線の上にいるため） */
  screenName: string;
  onGoConversation: () => void;
  onGoSettings: () => void;
}

interface WizardResult {
  ok: boolean;
  message: string;
  check: string[];
}

/**
 * Issue #121: 初回セットアップウィザード。
 *
 * 新規ブラウザプロファイル（＝保存済み設定が無い/初期値のまま）で開いたとき、
 * 英会話タブに到達する前に「エンドポイント入力 → 接続テスト → 成功」までを
 * 1画面で完結させる。スキップ可能（以降はリボンが警告し続ける）。
 */
export default function SetupWizard({
  storage,
  screenName,
  onGoConversation,
  onGoSettings,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState(DEFAULT_SETTINGS.llmModel);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<WizardResult | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s: Settings = await storage.loadSettings();
        if (!mounted) return;
        if (!shouldOfferSetupWizard(s)) return;
        const stored = s.llmApiEndpoint.trim();
        setEndpoint(
          stored && stored !== DEFAULT_SETTINGS.llmApiEndpoint.trim()
            ? stored
            : suggestedEndpoint(window.location.hostname),
        );
        setModel(s.llmModel);
        setApiKey(s.llmApiKey);
        setVisible(true);
      } catch {
        // ストレージ未初期化などではウィザードを出さず、通常の画面に任せる
      }
    })();
    return () => {
      mounted = false;
    };
  }, [storage, screenName]);

  // モーダル表示中はグローバルショートカットを止める（'h' 等で画面が飛ぶのを防ぐ）。
  // Esc は「一時的に閉じる」だけにして、次回起動時の再提案を残す。
  useEffect(() => {
    if (!visible) return;
    setShortcutsSuppressed(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisible(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setShortcutsSuppressed(false);
      window.removeEventListener("keydown", onKey);
    };
  }, [visible]);

  const persist = async (patch: Partial<Settings>) => {
    try {
      await storage.saveSettings(patch);
    } catch {
      // 保存に失敗してもUIは進める（次回起動で再提案されるだけ）
    }
  };

  const skip = async () => {
    setVisible(false);
    await persist({ llmSetupDismissed: true });
  };

  const runTest = async () => {
    const ep = endpoint.trim();
    const md = model.trim();
    if (!ep) {
      setResult({
        ok: false,
        message: "❌ APIエンドポイントが空です",
        check: [],
      });
      return;
    }
    if (!/^https?:\/\//i.test(ep)) {
      setResult({
        ok: false,
        message: "❌ APIエンドポイントが http(s):// で始まりません",
        check: [],
      });
      return;
    }
    if (!md) {
      setResult({ ok: false, message: "❌ モデル名が空です", check: [] });
      return;
    }
    const provider = providersFromSettings({
      ...DEFAULT_SETTINGS,
      llmApiEndpoint: ep,
      llmModel: md,
      llmApiKey: apiKey,
    })[0];
    if (!provider) {
      setResult({
        ok: false,
        message: "❌ エンドポイントが未設定です",
        check: [],
      });
      return;
    }

    setTesting(true);
    setResult(null);
    const outcome = await runConnectionTest(provider);
    setTesting(false);
    const secs = (outcome.latencyMs / 1000).toFixed(1);
    if (outcome.ok) {
      await persist({
        llmApiEndpoint: ep,
        llmModel: md,
        llmApiKey: apiKey,
        llmVerifiedEndpoint: ep,
        llmSetupDismissed: true,
      });
      setResult({
        ok: true,
        message: `✅ 接続OK（model: ${provider.model}、往復 ${secs}s）`,
        check: [],
      });
    } else {
      setResult({
        ok: false,
        message: `❌ 接続テスト失敗: ${friendlyLlmError(outcome.error ?? "不明なエラー")}（${secs}s）`,
        check: setupSelfCheckItems(outcome.diagnosis),
      });
    }
  };

  if (!visible) return null;
  if (screenName === "settings") return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="英会話AIの初期セットアップ"
      className="modal-overlay"
      data-testid="setup-wizard"
    >
      <div className={`card ${styles.panel}`}>
        <div className={styles.header}>
          <h2 className={styles.title}>英会話AIの初期セットアップ</h2>
          <button className="ghost" onClick={skip} aria-label="閉じる">
            ✕
          </button>
        </div>

        <p className={styles.hint}>
          英会話（LLM連携）を使うには、OpenAI互換APIの接続先が必要です。
          ここで入力 → 接続テストまで済ませると、すぐに会話を始められます。
        </p>

        <label className={styles.field}>
          API エンドポイント
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://192.168.68.52:11434/v1"
            data-testid="setup-wizard-endpoint"
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          モデル名
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-v4-flash"
            data-testid="setup-wizard-model"
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          API キー（必要な場合）
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            data-testid="setup-wizard-key"
            className={styles.input}
          />
        </label>

        <p className={styles.note}>
          ヒント: 別PCのOllamaなら{" "}
          <code>OLLAMA_HOST=0.0.0.0:11434 ollama serve</code>{" "}
          でLAN待ち受けにし、上のURLにそのPCのLAN IPを入れてください。
        </p>

        <div className={styles.actions}>
          <button
            onClick={runTest}
            disabled={testing}
            className={styles.primary}
            data-testid="setup-wizard-test"
          >
            {testing ? "テスト中..." : "接続テストして保存"}
          </button>
          <button
            onClick={onGoSettings}
            className="ghost"
            data-testid="setup-wizard-advanced"
          >
            設定画面で詳しく設定
          </button>
          <button
            onClick={skip}
            className="ghost"
            data-testid="setup-wizard-skip"
          >
            あとで（スキップ）
          </button>
        </div>

        {result && (
          <div
            role="status"
            aria-live="polite"
            data-testid="setup-wizard-result"
            className={`${styles.result} ${
              result.ok ? styles.resultOk : styles.resultFail
            }`}
          >
            <p className={styles.resultMessage}>{result.message}</p>
            {result.check.length > 0 && (
              <>
                <p className={styles.checkTitle}>確認してみてください:</p>
                <ul className={styles.checkList}>
                  {result.check.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            {result.ok && (
              <button
                onClick={onGoConversation}
                className={styles.primary}
                data-testid="setup-wizard-start"
              >
                英会話を始める
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
