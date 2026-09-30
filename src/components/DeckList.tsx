import type { AppState, Action } from "../app/types";
import type { Deck } from "../content/schema";
import { CONVERSATION_DECK_ID } from "../domain/conversationExtract";
import styles from "./DeckList.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

/** Issue #151: 自分の会話から出た語が一番復習価値が高いのに、一覧の末尾に沈んでいた。 */
function isOwnDeck(deck: Deck): boolean {
  return deck.source === "conversation" || deck.deckId === CONVERSATION_DECK_ID;
}

export default function DeckList({ state, dispatch }: Props) {
  // Issue #151: 「会話から抽出」デッキをサンプルより上に出す。並び替えのみで
  // 元の相対順は保つ（安定ソート）ので、サンプル同士の順序は変わらない。
  const ownDecks = state.decks.filter(isOwnDeck);
  const sampleDecks = state.decks.filter((d) => !isOwnDeck(d));

  const renderDeck = (deck: Deck) => (
    <button
      key={deck.deckId}
      className="menu-item"
      onClick={() =>
        dispatch({
          type: "go",
          screen: { name: "deckHome", deckId: deck.deckId },
        })
      }
    >
      <span className={styles.deckTitle}>{deck.title}</span>
      <span className={styles.deckMeta}>
        {deck.level} · {deck.lessons.length} レッスン
      </span>
    </button>
  );

  return (
    <div className="container">
      <div className="nav-header">
        <h2>デッキ一覧</h2>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
        >
          戻る
        </button>
      </div>

      {ownDecks.length > 0 && (
        <>
          <h3 className={styles.groupTitle}>自分の会話から</h3>
          <div className="card-grid">{ownDecks.map(renderDeck)}</div>
        </>
      )}

      <h3 className={styles.groupTitle}>
        {ownDecks.length > 0 ? "サンプル" : "デッキ"}
      </h3>
      <div className="card-grid">{sampleDecks.map(renderDeck)}</div>
    </div>
  );
}
