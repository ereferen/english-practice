import type { Screen } from "./types";

/**
 * Issue #241: hash-based routing.
 *
 * 画面遷移が `useReducer` の state だけで、URL も履歴も変わっていなかった。
 * そのため (1) ブラウザの戻るでアプリごと抜ける (2) リロードで必ずホームに
 * 戻る、という2つの困りごとがあった。ここでは Screen ⇄ ハッシュの純関数だけを
 * 持ち、DOM 操作は App.tsx 側に閉じ込める（テストしやすさのため）。
 *
 * ハッシュは nginx 配信の `/english/` 配下でもサーバーに送られないので、
 * 追加の rewrite 設定なしで動く。
 */

const HASH_PREFIX = "#";

function seg(value: string): string {
  return encodeURIComponent(value);
}

function decode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : null;
  } catch {
    // 壊れた % エスケープはルート不一致として扱う（アプリを落とさない）
    return null;
  }
}

/**
 * Screen → ハッシュ。`null` は「URL に載せない画面」。
 * result は answers / startedAt を持ち、URL から復元できないため対象外
 * （クイズのハッシュを保ったままにする）。
 */
export function screenToHash(screen: Screen): string | null {
  switch (screen.name) {
    case "home":
      return `${HASH_PREFIX}/`;
    case "deckList":
      return `${HASH_PREFIX}/decks`;
    case "deckHome":
      return `${HASH_PREFIX}/deck/${seg(screen.deckId)}`;
    case "flash":
      return `${HASH_PREFIX}/deck/${seg(screen.deckId)}/lesson/${seg(
        screen.lessonId,
      )}`;
    case "quiz":
      return `${HASH_PREFIX}/deck/${seg(screen.deckId)}/lesson/${seg(
        screen.lessonId,
      )}/quiz`;
    case "result":
      return null;
    case "progress":
      return `${HASH_PREFIX}/progress`;
    case "review":
      return screen.deckId
        ? `${HASH_PREFIX}/deck/${seg(screen.deckId)}/review`
        : `${HASH_PREFIX}/review`;
    case "dashboard":
      return `${HASH_PREFIX}/dashboard`;
    case "settings":
      return `${HASH_PREFIX}/settings`;
    case "conversation":
      return `${HASH_PREFIX}/conversation`;
  }
}

/**
 * ハッシュ → Screen。未知・壊れたハッシュはホームにフォールバックする
 * （共有 URL が古い／手で書き換えられても白画面にしない）。
 */
export function hashToScreen(hash: string): Screen {
  const raw = hash.startsWith(HASH_PREFIX) ? hash.slice(1) : hash;
  const path = raw.split("?")[0];
  const parts = path.split("/").filter((p) => p.length > 0);

  if (parts.length === 0) return { name: "home" };

  const [head, second, third, fourth, fifth] = parts;

  // /decks, /progress, ...
  if (parts.length === 1) {
    switch (head) {
      case "decks":
        return { name: "deckList" };
      case "progress":
        return { name: "progress" };
      case "review":
        return { name: "review" };
      case "dashboard":
        return { name: "dashboard" };
      case "settings":
        return { name: "settings" };
      case "conversation":
        return { name: "conversation" };
      default:
        return { name: "home" };
    }
  }

  if (head !== "deck" || parts.length < 2) return { name: "home" };
  const deckId = decode(second);
  if (!deckId) return { name: "home" };

  // /deck/:deckId
  if (parts.length === 2) return { name: "deckHome", deckId };

  // /deck/:deckId/review
  if (parts.length === 3) {
    return third === "review" ? { name: "review", deckId } : { name: "home" };
  }

  // /deck/:deckId/lesson/:lessonId[/quiz]
  if (third !== "lesson" || parts.length > 5) return { name: "home" };
  const lessonId = decode(fourth);
  if (!lessonId) return { name: "home" };

  if (parts.length === 4) return { name: "flash", deckId, lessonId };
  if (fifth === "quiz") return { name: "quiz", deckId, lessonId };
  return { name: "home" };
}

/** Screen が指す deckId（デッキ一覧に存在するかの検証用）。 */
export function screenDeckId(screen: Screen): string | undefined {
  return "deckId" in screen ? screen.deckId : undefined;
}
