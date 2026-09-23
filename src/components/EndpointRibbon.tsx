import { useEffect, useState } from "react";
import type { StorageProvider } from "../storage/types";
import { endpointWarning, type EndpointWarning } from "../app/endpointStatus";
import styles from "./EndpointRibbon.module.css";

interface Props {
  storage: StorageProvider;
  /**
   * 画面名。Settings で接続テストに成功した直後に再評価できるよう、
   * 画面が切り替わるたびに設定を読み直す（issue #121）。
   */
  screenName: string;
  onOpenSettings: () => void;
}

/**
 * Issue #121: 保存済みエンドポイントが初期値 localhost のまま／未検証の間、
 * タブに関係なく全画面のヘッダー位置に常設される警告リボン。
 */
export default function EndpointRibbon({
  storage,
  screenName,
  onOpenSettings,
}: Props) {
  const [warning, setWarning] = useState<EndpointWarning | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const settings = await storage.loadSettings();
        if (!mounted) return;
        setWarning(endpointWarning(settings));
      } catch {
        if (mounted) setWarning(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [storage, screenName]);

  if (!warning) return null;
  // 設定画面にいる間は導線としての意味が無いので出さない
  if (screenName === "settings") return null;

  return (
    <div
      id="endpoint-ribbon"
      className={`${styles.ribbon} ${styles[warning.kind]}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.message}>{warning.message}</span>
      <button
        type="button"
        className={styles.action}
        onClick={onOpenSettings}
        data-testid="endpoint-ribbon-action"
      >
        {warning.actionLabel}
      </button>
    </div>
  );
}
