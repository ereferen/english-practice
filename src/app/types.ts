import type { Deck } from "../content/schema";
import type { AnswerRecord } from "../domain/session";

export type Screen =
  | { name: "home" }
  | { name: "deckList" }
  | { name: "deckHome"; deckId: string }
  | { name: "flash"; deckId: string; lessonId: string }
  | { name: "quiz"; deckId: string; lessonId: string }
  | {
      name: "result";
      deckId: string;
      lessonId: string;
      answers: AnswerRecord[];
    }
  | { name: "dashboard" }
  | { name: "settings" };

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
