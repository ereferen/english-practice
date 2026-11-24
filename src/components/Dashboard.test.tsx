import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AppState } from "../app/types";
import type {
  ConversationSessionMeta,
  StorageProvider,
} from "../storage/types";
import Dashboard from "./Dashboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ローカルタイムゾーンでの「今日」（Dashboard の daysAgoDate と同じ作り方） */
function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function makeStorage(
  conversationSessions: ConversationSessionMeta[],
): StorageProvider {
  return {
    listSessions: vi.fn(async () => []),
    listAnswersSince: vi.fn(async () => []),
    loadSettings: vi.fn(async () => ({
      selfImproveEnabled: false,
      llmApiEndpoint: "",
      llmModel: "",
      llmApiKey: "",
    })),
    listConversationSessions: vi.fn(async () => conversationSessions),
    listImprovementActions: vi.fn(async () => []),
    listProposals: vi.fn(async () => []),
  } as unknown as StorageProvider;
}

function makeState(): AppState {
  return { decks: [], screen: { name: "dashboard" } } as unknown as AppState;
}

function renderDashboard(storage: StorageProvider) {
  return render(
    <Dashboard state={makeState()} dispatch={vi.fn()} storage={storage} />,
  );
}

// Issue #299: 会話は conversationSessions という別テーブルに保存されるため、
// クイズ／復習しか見ていないダッシュボードでは会話 2 往復しても 0 回 0 日だった。
describe("Dashboard (issue #299 会話を学習の記録に数える)", () => {
  const today = localToday();
  const convo: ConversationSessionMeta = {
    id: "convo-1",
    createdAt: `${today}T12:00:00.000Z`,
    updatedAt: `${today}T12:05:00.000Z`,
    turns: 2,
    preview: "Hey, how's the project going?",
    topicId: "work",
  };

  it("会話した日を学習日・連続学習日に数える", async () => {
    renderDashboard(makeStorage([convo]));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-conversation")).toBeTruthy(),
    );
    // 回答は 0 件でも、会話 1 セッションの日が学習日として塗られる
    const summary = screen.getByText(/直近30日（.*）の学習日:/);
    expect(summary.textContent).toContain("学習日: 1 日");
    expect(summary.textContent).toContain("連続学習日: 1 日");
  });

  it("直近7日の会話セッション数と往復数を出す", async () => {
    renderDashboard(makeStorage([convo]));

    const card = await screen.findByTestId("dashboard-conversation");
    expect(card.textContent).toContain("1 セッション / 2 往復");
  });

  it("最近のセッションに会話を話題つきで並べる", async () => {
    renderDashboard(makeStorage([convo]));

    await waitFor(() =>
      expect(screen.getByText(/会話（💼 仕事の雑談）/)).toBeTruthy(),
    );
    expect(screen.getAllByText(/2 往復/).length).toBeGreaterThan(0);
    expect(screen.queryByText("まだ学習履歴がありません")).toBeNull();
  });

  it("会話も回答も無いときは従来どおり空表示のまま", async () => {
    renderDashboard(makeStorage([]));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-conversation")).toBeTruthy(),
    );
    expect(screen.getByText("まだ学習履歴がありません")).toBeTruthy();
    expect(
      screen.getByTestId("dashboard-conversation").textContent,
    ).toContain("0 セッション / 0 往復");
  });
});
