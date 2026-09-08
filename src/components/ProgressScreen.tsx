import { useState } from "react";
import type { Action, ProgressSnapshot } from "../app/types";
import type { LocalProgressStore } from "../storage/localProgress";
import styles from "./ProgressScreen.module.css";

interface Props {
  dispatch: React.Dispatch<Action>;
  localProgress: LocalProgressStore;
}

export default function ProgressScreen({ dispatch, localProgress }: Props) {
  const [snapshot] = useState<ProgressSnapshot>(() => localProgress.load());

  const isEmpty =
    snapshot.learnedWords.length === 0 && snapshot.sessions.length === 0;

  const learnedWordCount = snapshot.learnedWords.length;

  return (
    <div className="container">
      <div className="nav-header">
        <h2>進捗確認</h2>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
        >
          戻る
        </button>
      </div>

      {isEmpty ? (
        <div className="card">
          <p>まだ学習データがありません。デッキから学習を始めてください。</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="badge">学習済み単語数</div>
            <div className={styles.statValue}>{learnedWordCount} 語</div>
          </div>

          {snapshot.sessions.length > 0 && (
            <>
              <h3>クイズ履歴</h3>
              {snapshot.sessions.map((s, i) => {
                const dateStr = s.answeredAt.slice(0, 10);
                const score =
                  s.askedCount > 0
                    ? Math.round((s.correctCount / s.askedCount) * 100)
                    : 0;
                return (
                  <div key={i} className="card">
                    <div className={styles.sessionRow}>
                      <span>{dateStr}</span>
                      <span>
                        {s.correctCount}/{s.askedCount} 問 ({score}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {!isEmpty && (
        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          >
            ホームへ
          </button>
        </div>
      )}
    </div>
  );
}
