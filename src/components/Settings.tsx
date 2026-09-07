import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type {
  StorageProvider,
  Settings as SettingsType,
} from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function Settings({ dispatch, storage }: Props) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [exported, setExported] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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
          className="card"
          style={{
            color: message.includes("失敗")
              ? "var(--color-danger)"
              : "var(--color-success)",
          }}
        >
          {message}
        </div>
      )}

      <div className="card">
        <label>
          1日の目標語数
          <input
            type="number"
            min={1}
            max={100}
            value={settings.dailyGoalWords}
            onChange={(e) => save({ dailyGoalWords: Number(e.target.value) })}
            style={{ width: "100%", marginTop: "0.5rem", padding: "0.5rem" }}
          />
        </label>
      </div>

      <div className="card">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
        <button
          onClick={handleExport}
          style={{ width: "100%", marginBottom: "0.75rem" }}
        >
          バックアップをダウンロード
        </button>
        <textarea
          value={exported}
          onChange={(e) => setExported(e.target.value)}
          placeholder="JSONをここに貼り付けてインポート"
          rows={5}
          style={{ width: "100%", marginBottom: "0.75rem", padding: "0.5rem" }}
        />
        <button
          onClick={handleImport}
          style={{ width: "100%", marginBottom: "0.75rem" }}
        >
          インポート
        </button>
        <button
          className="danger"
          onClick={handleClear}
          style={{ width: "100%" }}
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
            style={{ width: "100%", marginTop: "0.5rem", marginBottom: "0.75rem", padding: "0.5rem" }}
          />
        </label>
        <label>
          モデル名
          <input
            type="text"
            value={settings.llmModel}
            onChange={(e) => save({ llmModel: e.target.value })}
            placeholder="deepseek-v4-flash"
            style={{ width: "100%", marginTop: "0.5rem", marginBottom: "0.75rem", padding: "0.5rem" }}
          />
        </label>
        <label>
          API キー（必要な場合）
          <input
            type="password"
            value={settings.llmApiKey}
            onChange={(e) => save({ llmApiKey: e.target.value })}
            placeholder="sk-..."
            style={{ width: "100%", marginTop: "0.5rem", padding: "0.5rem" }}
          />
        </label>
        <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginTop: "0.75rem" }}>
          OpenAI互換APIに対応。別PCのローカルLLM（Ollama / vLLM / llama.cpp など）を指定できます。
        </p>
      </div>
    </div>
  );
}
