import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type {
  StorageProvider,
  Settings as SettingsType,
} from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import {
  friendlyLlmError,
  isTransportFailure,
  providersFromSettings,
} from "../domain/llm";
import { runConnectionTest } from "../domain/connectionTest";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./Settings.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  /** Issue #170: 設定に入る直前の画面へ戻る（未指定ならホームへ） */
  onBack?: () => void;
  /** Issue #170: 「戻る」ボタンの文言（会話から来たときは「会話に戻る」） */
  backLabel?: string;
}

/**
 * Issue #183: 壊れたJSONを貼ると英語の生エラー（`Expected property name...`）
 * がそのまま学習アプリの画面に出ていた。技術者以外には意味不明なので、
 * 日本語1行に言い換える（位置が分かる時は行・文字目も添える）。
 */
export function describeImportError(e: unknown): string {
  if (e instanceof SyntaxError) {
    const at = /line (\d+) column (\d+)/.exec(e.message);
    const where = at ? `（${at[1]}行目${at[2]}文字目あたり）` : "";
    return `インポート失敗: JSONの形式が正しくありません${where}。バックアップファイルの中身を確認してください`;
  }
  return `インポート失敗: ${e instanceof Error ? e.message : String(e)}`;
}

export default function Settings({
  dispatch,
  storage,
  onBack,
  backLabel = "戻る",
}: Props) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [exported, setExported] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState<"primary" | "fallback" | null>(null);
  /* Issue #309: number input を直接保存値に繋ぐと、入力を消した瞬間に
     Number("") = 0 が保存され、続けて打った数字が「015」になる。
     入力中は文字列の下書きを持ち、確定（blur / Enter）で丸めて保存する。 */
  const [goalDraft, setGoalDraft] = useState("10");

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

  // 保存値が変わったら下書きも合わせる（読み込み直後・インポート後）。
  useEffect(() => {
    setGoalDraft(String(settings.dailyGoalWords));
  }, [settings.dailyGoalWords]);

  /**
   * Issue #309: 空欄・0・小数・範囲外は保存しない。1〜100 に丸めて確定する。
   * 「015」のように先頭 0 が付いた入力も、確定時に "15" へ正規化する。
   */
  const commitGoal = () => {
    const trimmed = goalDraft.trim();
    const parsed = Number(trimmed);
    if (trimmed === "" || !Number.isInteger(parsed) || parsed < 1) {
      setGoalDraft(String(settings.dailyGoalWords));
      return;
    }
    const clamped = Math.min(100, parsed);
    setGoalDraft(String(clamped));
    if (clamped !== settings.dailyGoalWords) void save({ dailyGoalWords: clamped });
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
      setMessage(describeImportError(e));
    }
  };

  // Issue #150: 破壊的操作もアプリ内モーダルで確認する。
  const [confirmingClear, setConfirmingClear] = useState(false);

  const handleClear = () => {
    setConfirmingClear(true);
  };

  const handleClearConfirmed = async () => {
    setConfirmingClear(false);
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
    // Issue #121: 失敗理由の切り分け（CORS拒否 / 到達不可）は共通モジュールに
    // 抽出し、初回セットアップウィザードと同じ文言・判定を使う。
    const result = await runConnectionTest(provider);
    setTesting(null);
    const secs = (result.latencyMs / 1000).toFixed(1);
    if (result.ok) {
      setTestResult((prev) => ({
        ...prev,
        [which]: `✅ 接続OK（model: ${provider.model}、往復 ${secs}s）`,
      }));
      // Issue #123: remember that THIS primary endpoint passed a live
      // test — the conversation tab gates sending on this marker.
      if (which === "primary") {
        const verified = settings.llmApiEndpoint;
        await storage.saveSettings({
          llmVerifiedEndpoint: verified,
        });
        // Issue #130: reflect the success in the SAME screen immediately —
        // the ⚠ 未検証 badge used to survive until the user left settings,
        // contradicting the ✅ 接続OK a few pixels below it.
        setSettings((prev) => ({ ...prev, llmVerifiedEndpoint: verified }));
      }
    } else {
      setTestResult((prev) => ({
        ...prev,
        [which]: `❌ 接続テスト失敗: ${friendlyLlmError(result.error ?? "不明なエラー")}（${secs}s）`,
      }));
      // Issue #123: a transport-level failure invalidates the previous
      // verification — clear the marker so stale "verified" state never
      // survives a proven-dead endpoint.
      if (
        which === "primary" &&
        isTransportFailure(result.error ?? "") &&
        settings.llmVerifiedEndpoint.trim() === settings.llmApiEndpoint.trim()
      ) {
        await storage.saveSettings({ llmVerifiedEndpoint: "" });
        setSettings((prev) => ({ ...prev, llmVerifiedEndpoint: "" }));
      }
    }
  };

  // Issue #213: 「保存済み」「未検証」「初期値のまま」が3行並んで現在地が
  // 読めなかった。設定の実状態を 未設定 / 保存済み（未検証）/ 検証済み の
  // 3状態に畳み、1行のステータスだけを出す。
  const endpointValue = settings.llmApiEndpoint.trim();
  const isDefaultEndpoint =
    endpointValue === DEFAULT_SETTINGS.llmApiEndpoint.trim();
  const isVerified =
    endpointValue !== "" && settings.llmVerifiedEndpoint.trim() === endpointValue;
  const llmStatus: {
    kind: "unset" | "saved" | "verified";
    label: string;
    detail: string;
    tone: string;
  } = isVerified
    ? {
        kind: "verified",
        label: "✓ 検証済み",
        detail: "このエンドポイントで接続テストに成功しています。",
        tone: styles.testStatusOk,
      }
    : isDefaultEndpoint
      ? {
          kind: "unset",
          label: "未設定",
          detail:
            "エンドポイントは初期値（localhost）のままです。このPC上のローカルサーバを指すプレースホルダのため、このアプリを開いている端末からは接続できません。LAN IP（例: http://192.168.68.52:11434/v1）や外部エンドポイントを指定してください。",
          tone: styles.testStatusNeutral,
        }
      : {
          kind: "saved",
          label: "保存済み（未検証）",
          detail:
            "入力内容はこの端末のブラウザ内DBに自動保存されています。まだ接続テストに成功していないので、下の「接続テスト（プライマリ）」を実行してください。",
          tone: styles.testStatusFail,
        };

  return (
    <div className="container">
      <div className="nav-header">
        <h2>設定</h2>
        <button
          className="ghost"
          onClick={
            onBack ?? (() => dispatch({ type: "go", screen: { name: "home" } }))
          }
        >
          {backLabel}
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
              value={goalDraft}
              onChange={(e) => {
                // 数字以外（number input が許す "e" "-" "."）は捨てる。
                const v = e.target.value;
                if (v === "" || /^[0-9]+$/.test(v)) setGoalDraft(v);
              }}
              onBlur={commitGoal}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className={`${styles.field} ${styles.goalNumber}`}
            />
          </label>
        </div>

        <div className="card">
          <h3>音声フィードバック</h3>
          <p className={styles.hint}>
            英単語を自動で読み上げます。フラッシュカード・クイズの出題時に発音を再生し、結果画面の誤答語や会話の読み上げでも使われます。オフにすると自動再生しません（各画面の🔊ボタンは使えます）。
          </p>
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
          {/* Issue #180: APIキーが平文でバックアップに載っていた。
              書き出す側から除外し、その旨をここで明示する。 */}
          <p className={styles.backupNote}>
            ※
            APIキーは安全のためバックアップに含まれません（復元後に入れ直してください）
          </p>
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
          {/* Issue #213: 状態表示は1行に統合（未設定 / 保存済み（未検証）/
              検証済み）。入力の自動保存は下の detail で説明する。 */}
          <p
            className={`${styles.testStatus} ${llmStatus.tone}`}
            role="status"
            data-testid="llm-config-status"
            data-state={llmStatus.kind}
          >
            <strong>{llmStatus.label}</strong>
            <span className={styles.statusDetail}>{llmStatus.detail}</span>
          </p>
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
            プライマリ=ローカルLLM や 社内API / フォールバック=OpenRouter）
          </p>
          {/* Issue #174: 以前ここに「例: プライマリ=OpenCode Go / フォールバック=OpenRouter」
              と出していた。しかし OpenCode Go は x-opencode-session ヘッダが必須で、
              このアプリはカスタムヘッダを送れないため、例のまま入力すると 400
              （MissingSessionID）で弾かれる罠だった。ヘッダ不要なプロバイダへ例を
              差し替え、注意書きを添える。 */}
          <p className={styles.hint}>
            ⚠ OpenCode Go（opencode.ai/zen/go/v1）は{" "}
            <code>x-opencode-session</code> ヘッダが必須のため、このアプリからは
            接続できません（カスタムヘッダの指定は未対応）。OpenRouter など
            ヘッダ不要のプロバイダを指定してください。
          </p>
          <label>
            API エンドポイント
            <input
              type="text"
              value={settings.llmFallbackApiEndpoint}
              onChange={(e) => save({ llmFallbackApiEndpoint: e.target.value })}
              placeholder="https://openrouter.ai/api/v1"
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

      {/* Issue #150: 何が消えるかを示してから実行する */}
      {confirmingClear && (
        <ConfirmDialog
          title="すべてのデータを削除しますか？"
          confirmLabel="すべて削除する"
          onConfirm={() => void handleClearConfirmed()}
          onCancel={() => setConfirmingClear(false)}
        >
          <p>この端末に保存されている以下がすべて消えます:</p>
          <ul>
            <li>語彙（登録した単語・SRSの復習間隔）</li>
            <li>学習セッションの履歴</li>
            <li>会話から抽出したデッキ（抽出元の会話ログを含む）</li>
            <li>設定（APIエンドポイント・目標語数など）</li>
          </ul>
          <p>この操作は元に戻せません。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
