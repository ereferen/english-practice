import { useEffect, useState } from "react";
import type { StorageProvider } from "../storage/types";
import { endpointWarning, type EndpointWarning } from "../app/endpointStatus";
import styles from "./EndpointRibbon.module.css";

/**
 * Issue #171: LLM を使わない純粋な学習画面。警告帯を隠す対象。
 */
const LEARNING_SCREENS = new Set(["flash", "quiz", "result", "review"]);
/**
 * Issue #175: 英会話画面は独自の設定警告カード（理由＋設定を開く導線）を持って
 * いる。同じ内容の警告が「全画面リボン」と「画面内カード」で二重に出て、
 * 警告だらけの画面になっていた。会話画面ではリボンを隠し、カードに一本化する。
 */
const SELF_WARNING_SCREENS = new Set(["conversation"]);

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
  // Issue #171: フラッシュカード / クイズ / 結果 / 復習は LLM と無関係の純粋な
  // 学習画面。sticky な 47px の警告帯が上に張り付いたままだと集中を邪魔する
  // ので、これらの画面では出さない（ホーム等に戻れば再び出る）。
  if (LEARNING_SCREENS.has(screenName)) return null;
  // Issue #175: 会話画面は自前の警告カードがあるのでリボンは出さない
  if (SELF_WARNING_SCREENS.has(screenName)) return null;

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
