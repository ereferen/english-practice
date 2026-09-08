import type { Deck } from "../content/schema";
import type { AnswerRecord } from "../domain/session";

export interface QuizResult {
  quizId: string;
  wordId: string;
  correct: boolean;
}

export interface SessionSummary {
  askedCount: number;
  correctCount: number;
  answeredAt: string;
}

export interface LearnedWordEntry {
  deckId: string;
  wordId: string;
  learnedAt: string;
}

export interface ProgressSnapshot {
  learnedWords: LearnedWordEntry[];
  sessions: SessionSummary[];
  version: number;
}

export type Screen =
  | { name: "home" }
  | { name: "deckList" }
  | { name: "deckHome"; deckId: string }
  | { name: "flash"; deckId: string; lessonId: string }
  | {
      name: "quiz";
      deckId: string;
      lessonId: string;
      /** LLM生成クイズモード (issue #15)。未指定なら静的クイズ */
      gen?: "llm-supplement" | "llm-wrong-focus";
    }
  | {
      name: "result";
      deckId: string;
      lessonId: string;
      answers: AnswerRecord[];
    }
  | { name: "progress" }
  | { name: "dashboard" }
  | { name: "settings" }
  | { name: "conversation" };

export interface AppState {
  screen: Screen;
  decks: Deck[];
  selectedDeckId: string | null;
}

export type Action =
  | { type: "go"; screen: Screen }
  | { type: "setDecks"; decks: Deck[] }
  | { type: "startLesson"; deckId: string; lessonId: string }
  | {
      type: "startGeneratedQuiz";
      deckId: string;
      lessonId: string;
      gen: "llm-supplement" | "llm-wrong-focus";
    }
  | {
      type: "finishQuiz";
      deckId: string;
      lessonId: string;
      answers: AnswerRecord[];
    };

export const initialState: AppState = {
  screen: { name: "home" },
  decks: [],
  selectedDeckId: null,
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "go":
      return { ...state, screen: action.screen };
    case "setDecks":
      return { ...state, decks: action.decks };
    case "startLesson":
      return {
        ...state,
        selectedDeckId: action.deckId,
        screen: {
          name: "flash",
          deckId: action.deckId,
          lessonId: action.lessonId,
        },
      };
    case "startGeneratedQuiz":
      return {
        ...state,
        selectedDeckId: action.deckId,
        screen: {
          name: "quiz",
          deckId: action.deckId,
          lessonId: action.lessonId,
          gen: action.gen,
        },
      };
    case "finishQuiz":
      return {
        ...state,
        screen: {
          name: "result",
          deckId: action.deckId,
          lessonId: action.lessonId,
          answers: action.answers,
        },
      };
    default:
      return state;
  }
}
