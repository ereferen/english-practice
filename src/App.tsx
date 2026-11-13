import { useEffect, useReducer, useRef, useState } from "react";
import { reducer, initialState } from "./app/types";
import type { Action, AppState, Screen } from "./app/types";
import { hashToScreen, screenDeckId, screenToHash } from "./app/route";
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
import ReviewSession from "./components/ReviewSession";
import Dashboard from "./components/Dashboard";
import ConversationScreen from "./components/ConversationScreen";
import Settings from "./components/Settings";
import ShortcutHelp from "./components/ShortcutHelp";
import StageDressing from "./components/StageDressing";
import EndpointRibbon from "./components/EndpointRibbon";
import SetupWizard from "./components/SetupWizard";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import {
  actionScreenName,
  directionFor,
  runScreenTransition,
} from "./app/viewTransition";
import { createSkyTintController } from "./app/skyTint";
import styles from "./App.module.css";

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => {
    // Issue #241: 起動時はハッシュから初期画面を決める（リロードで同じ画面に戻る）。
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    return { ...initialState, screen: hashToScreen(hash) };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // Issue #170: 設定画面に入る直前の画面を覚えておく。「設定を開く」→「戻る」で
  // ホームに落ちてしまい、会話を再開するのに「英会話」をもう一度押す3タップが
  // 必要だった。直前にいた画面へ1タップで戻せるようにする。
  const [settingsReturn, setSettingsReturn] = useState<Screen>({
    name: "home",
  });

  // Issue #95: wrap every screen-changing dispatch in a View Transition
  // (graceful instant fallback on unsupported browsers / reduced motion).
  const dispatchTransitioned = (action: Action) => {
    // 設定以外へ移動したら「設定からの戻り先」を更新する（設定へ入るときは
    // 直前の値を保つので、設定 → 設定 の移動では壊れない）。
    if (action.type === "go" && action.screen.name !== "settings") {
      setSettingsReturn(action.screen);
    }
    const to = actionScreenName(action);
    if (!to || to === state.screen.name) {
      dispatch(action);
      return;
    }
    runScreenTransition(
      () => dispatch(action),
      directionFor(state.screen.name, to),
    );
  };

  // Issue #241: screen → URL ハッシュの同期。pushState で履歴を積むので、
  // ブラウザの戻る／戻るジェスチャーが「1つ前の画面」になる。
  // popstate 経由の変更では location.hash が既に一致しているため、二重 push は
  // 起きない（一致したら何もしない）。
  const hashReady = useRef(false);
  useEffect(() => {
    const hash = screenToHash(state.screen);
    // result など URL に載せない画面は、直前のハッシュを保持する
    if (!hash || typeof window === "undefined") return;
    if (window.location.hash === hash) {
      hashReady.current = true;
      return;
    }
    // 初回だけは履歴を増やさない（戻るで空ページに飛ばないように）
    if (hashReady.current) {
      window.history.pushState(null, "", hash);
    } else {
      window.history.replaceState(null, "", hash);
    }
    hashReady.current = true;
  }, [state.screen]);

  // Issue #265: ショートカット一覧を開いたまま画面遷移すると、ダイアログと
  // 背景の暗幕が新しい画面の上に残り続ける（Esc を押すまで視界が塞がる）。
  // ルートが変わったら閉じる。開いただけでは state.screen は変わらないので
  // 開いた直後に閉じてしまうことはない。
  useEffect(() => {
    setShowHelp(false);
  }, [state.screen]);

  // Issue #241: ブラウザの戻る／進む／URL 直編集に追随する。
  const popHandler = useRef<() => void>(() => {});
  popHandler.current = () => {
    if (typeof window === "undefined") return;
    dispatchTransitioned({ type: "go", screen: hashToScreen(window.location.hash) });
  };
  useEffect(() => {
    const onPop = () => popHandler.current();
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  // Issue #241: 共有 URL のデッキが消えている／間違っている場合は一覧へ落とす
  // （存在しない deckId でデッキ画面を開くと空の画面になってしまう）。
  useEffect(() => {
    if (state.decks.length === 0) return;
    const deckId = screenDeckId(state.screen);
    if (!deckId) return;
    if (state.decks.some((d) => d.deckId === deckId)) return;
    dispatchTransitioned({ type: "go", screen: { name: "deckList" } });
    // dispatchTransitioned は毎レンダー作り直されるため、依存は
    // 画面とデッキ一覧の変化だけに絞る（無限ループ防止）。
  }, [state.decks, state.screen]);

  // Global shortcuts (issue #9): h = home, ? = shortcut help.
  useKeyboardShortcuts({
    h: () => dispatchTransitioned({ type: "go", screen: { name: "home" } }),
    H: () => dispatchTransitioned({ type: "go", screen: { name: "home" } }),
    "?": () => setShowHelp((v) => !v),
  });

  // Issue #97: time-of-day ambient tint — apply now, then re-lerp every
  // minute (colour only; harmless under prefers-reduced-motion).
  useEffect(() => {
    const sky = createSkyTintController();
    sky.start();
    return () => sky.stop();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { decks, errors } = await loadBundledDecks();
        if (!mounted) return;
        if (errors.length > 0) {
          setError(errors.map((e) => `${e.url}: ${e.reason}`).join("\n"));
        }
        // issue #19: 会話抽出で承認保存されたユーザーデッキも一覧に載せる
        const userDecks = await storage.listUserDecks().catch(() => []);
        if (!mounted) return;
        dispatch({
          type: "setDecks",
          decks: [...decks.map((d) => d.deck), ...userDecks.map((u) => u.deck)],
        });
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
        <div className={`card ${styles.errorCard}`}>
          <h2>エラー</h2>
          <pre className={styles.errorPre}>{error}</pre>
        </div>
      </div>
    );
  }

  const screen = (() => {
    switch (state.screen.name) {
      case "home":
        return (
          <Home
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
          />
        );
      case "deckList":
        return <DeckList state={state} dispatch={dispatchTransitioned} />;
      case "deckHome":
        return (
          <DeckHome
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
            deckId={state.screen.deckId}
          />
        );
      case "flash":
        return (
          <FlashScreen
            state={state}
            dispatch={dispatchTransitioned}
            localProgress={localProgress}
            deckId={state.screen.deckId}
            lessonId={state.screen.lessonId}
            focusWordIds={state.screen.focusWordIds}
          />
        );
      case "quiz":
        return (
          <QuizScreen
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
            deckId={state.screen.deckId}
            lessonId={state.screen.lessonId}
            gen={state.screen.gen}
            focusWordIds={state.screen.focusWordIds}
          />
        );
      case "result":
        return (
          <ResultScreen
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
            deckId={state.screen.deckId}
            lessonId={state.screen.lessonId}
            answers={state.screen.answers}
            startedAt={state.screen.startedAt}
          />
        );
      case "progress":
        return (
          <ProgressScreen
            dispatch={dispatchTransitioned}
            localProgress={localProgress}
          />
        );
      case "review":
        return (
          <ReviewSession
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
            deckId={state.screen.deckId}
          />
        );
      case "dashboard":
        return (
          <Dashboard
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
          />
        );
      case "settings":
        return (
          <Settings
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
            // Issue #170: 設定に入る前の画面へ戻す（会話から来たなら会話へ）。
            onBack={() =>
              dispatchTransitioned({ type: "go", screen: settingsReturn })
            }
            backLabel={
              settingsReturn.name === "conversation" ? "会話に戻る" : "戻る"
            }
          />
        );
      case "conversation":
        return (
          <ConversationScreen
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
          />
        );
      default:
        return (
          <Home
            state={state}
            dispatch={dispatchTransitioned}
            storage={storage}
          />
        );
    }
  })();

  return (
    <>
      <a className="skip-link" href="#main-content">
        メインコンテンツへスキップ
      </a>
      {/* Issue #84: gutter life (mountains + walking traveler) */}
      <StageDressing />
      {/* Issue #121: エンドポイント未設定/未検証の間は全画面に常設警告リボン */}
      <EndpointRibbon
        storage={storage}
        screenName={state.screen.name}
        onOpenSettings={() =>
          dispatchTransitioned({ type: "go", screen: { name: "settings" } })
        }
      />
      {/* Issue #84: scene-change dip — remount animation on screen switch */}
      <main id="main-content" key={state.screen.name} className={styles.scene}>
        {screen}
      </main>
      {/* Issue #160: 固定の「? ショートカット」ぶんの余白。ページ末尾まで
          スクロールすれば、最後の行がボタンの下に潜らず読める。
          Issue #227: 英会話画面は 100dvh で画面に収める設計なので、この余白が
          あると必ず 52px はみ出して開いた瞬間に自動スクロールし、ナビが画面外
          へ隠れる。スクロールしない画面では余白を出さない。 */}
      {state.screen.name !== "conversation" && (
        <div className={styles.shortcutSpacer} aria-hidden="true" />
      )}
      {/* Issue #121: 初回（エンドポイントが初期値のまま）は入力→接続テストを
          ホーム表示前に挟む。スキップ可。 */}
      <SetupWizard
        storage={storage}
        screenName={state.screen.name}
        onGoConversation={() =>
          dispatchTransitioned({ type: "go", screen: { name: "conversation" } })
        }
        onGoSettings={() =>
          dispatchTransitioned({ type: "go", screen: { name: "settings" } })
        }
      />
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {/* Issue #142: ショートカット一覧の存在と開き方を画面に常設で示す。
          一覧自体は良いのに、開き方が分からないと存在しないのと同じ。 */}
      <button
        type="button"
        className={`ghost ${styles.shortcutButton}`}
        onClick={() => setShowHelp(true)}
        aria-label="キーボードショートカット一覧を開く"
        data-testid="shortcut-help-open"
      >
        ? ショートカット
      </button>
    </>
  );
}
