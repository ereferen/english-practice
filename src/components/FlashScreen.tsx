import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import { pickLesson } from "../content/loader";
import { speak } from "../domain/speech";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  deckId: string;
  lessonId: string;
}

export default function FlashScreen({
  state,
  dispatch,
  deckId,
  lessonId,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const lessonWithDeck = deck ? pickLesson(deck, lessonId) : undefined;
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [deckId, lessonId]);

  if (!deck || !lessonWithDeck) {
    return (
      <div className="container">
        <p>レッスンが見つかりません</p>
        <button
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          戻る
        </button>
      </div>
    );
  }

  const { lesson } = lessonWithDeck;
  const word = lesson.words[index];
  const isLast = index === lesson.words.length - 1;

  const handleNext = () => {
    if (isLast) {
      dispatch({ type: "go", screen: { name: "quiz", deckId, lessonId } });
    } else {
      setIndex((i) => i + 1);
      setFlipped(false);
    }
  };

  return (
    <div className="container">
      <div className="nav-header">
        <h2>
          フラッシュカード ({index + 1}/{lesson.words.length})
        </h2>
        <button
          className="ghost"
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          中断
        </button>
      </div>

      <div
        className="card"
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setFlipped((f) => !f);
        }}
        aria-label="カードをめくる"
        style={{
          minHeight: "240px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        {!flipped ? (
          <>
            <div
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                marginBottom: "0.5rem",
              }}
            >
              {word.term}
            </div>
            <div style={{ color: "var(--color-muted)" }}>{word.reading}</div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                marginBottom: "0.5rem",
              }}
            >
              {word.meaning}
            </div>
            {word.partOfSpeech && (
              <div className="badge" style={{ marginBottom: "0.75rem" }}>
                {word.partOfSpeech}
              </div>
            )}
            <div style={{ width: "100%", textAlign: "left" }}>
              {word.examples.map((ex, i) => (
                <div key={i} style={{ marginBottom: "0.5rem" }}>
                  <div>{ex.en}</div>
                  {ex.ja && (
                    <div
                      style={{
                        color: "var(--color-muted)",
                        fontSize: "0.875rem",
                      }}
                    >
                      {ex.ja}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {word.note && (
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>
                ノート: {word.note}
              </p>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button onClick={() => speak(word.term)} style={{ flex: 1 }}>
          音声再生
        </button>
        <button className="primary" onClick={handleNext} style={{ flex: 2 }}>
          {isLast ? "クイズへ" : "次の語"}
        </button>
      </div>
    </div>
  );
}
