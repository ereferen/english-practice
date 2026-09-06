import type { AppState, Action } from "../app/types";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

export default function DeckList({ state, dispatch }: Props) {
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
      {state.decks.map((deck) => (
        <div key={deck.deckId} className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h3>{deck.title}</h3>
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>
                {deck.level} · {deck.lessons.length} レッスン
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                dispatch({
                  type: "go",
                  screen: { name: "deckHome", deckId: deck.deckId },
                })
              }
            >
              開く
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
