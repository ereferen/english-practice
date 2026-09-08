import { useEffect, useReducer, useState } from "react";
import { reducer, initialState } from "./app/types";
import { loadBundledDecks } from "./content/loader";
import { storage } from "./storage/dexieProvider";
import { localProgress } from "./storage/localProgress";
import Home from "./components/Home";
import DeckList from "./components/DeckList";
import DeckHome from "./components/DeckHome";
import FlashScreen from "./components/FlashScreen";
import QuizScreen from "./components/QuizScreen";
import ResultScreen from "./components/ResultScreen";
import ProgressScreen from "./components/ProgressScreen";
import Dashboard from "./components/Dashboard";
import ConversationScreen from "./components/ConversationScreen";
import Settings from "./components/Settings";
import ShortcutHelp from "./components/ShortcutHelp";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Global shortcuts (issue #9): h = home, ? = shortcut help.
  useKeyboardShortcuts({
    h: () => dispatch({ type: "go", screen: { name: "home" } }),
    H: () => dispatch({ type: "go", screen: { name: "home" } }),
    "?": () => setShowHelp((v) => !v),
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { decks, errors } = await loadBundledDecks();
        if (!mounted) return;
        if (errors.length > 0) {
          setError(errors.map((e) => `${e.url}: ${e.reason}`).join("\n"));
        }
        dispatch({ type: "setDecks", decks: decks.map((d) => d.deck) });
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="container">
        <p>読み込み中...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="container">
        <div className="card" style={{ color: "var(--color-danger)" }}>
          <h2>エラー</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      </div>
    );
  }

  const screen = (() => {
    switch (state.screen.name) {
      case "home":
        return <Home state={state} dispatch={dispatch} storage={storage} />;
      case "deckList":
        return <DeckList state={state} dispatch={dispatch} />;
      case "deckHome":
        return (
          <DeckHome
            state={state}
            dispatch={dispatch}
            storage={storage}
            deckId={state.screen.deckId}
          />
        );
      case "flash":
        return (
          <FlashScreen
            state={state}
            dispatch={dispatch}
            localProgress={localProgress}
            deckId={state.screen.deckId}
            lessonId={state.screen.lessonId}
          />
        );
      case "quiz":
        return (
          <QuizScreen
            state={state}
            dispatch={dispatch}
            storage={storage}
            deckId={state.screen.deckId}
            lessonId={state.screen.lessonId}
          />
        );
      case "result":
        return (
          <ResultScreen
            state={state}
            dispatch={dispatch}
            storage={storage}
            deckId={state.screen.deckId}
            lessonId={state.screen.lessonId}
            answers={state.screen.answers}
          />
        );
      case "progress":
        return (
          <ProgressScreen dispatch={dispatch} localProgress={localProgress} />
        );
      case "dashboard":
        return (
          <Dashboard state={state} dispatch={dispatch} storage={storage} />
        );
      case "settings":
        return <Settings state={state} dispatch={dispatch} storage={storage} />;
      case "conversation":
        return (
          <ConversationScreen
            state={state}
            dispatch={dispatch}
            storage={storage}
          />
        );
      default:
        return <Home state={state} dispatch={dispatch} storage={storage} />;
    }
  })();

  return (
    <>
      <a className="skip-link" href="#main-content">
        メインコンテンツへスキップ
      </a>
      <main id="main-content">{screen}</main>
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
    </>
  );
}
