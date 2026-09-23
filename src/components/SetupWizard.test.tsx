import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupWizard from "./SetupWizard";
import { DEFAULT_SETTINGS } from "../storage/types";
import type { StorageProvider, Settings } from "../storage/types";

const runConnectionTest = vi.hoisted(() => vi.fn());
vi.mock("../domain/connectionTest", () => ({ runConnectionTest }));

function makeStorage(overrides: Partial<Settings> = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const saveSettings = vi.fn(async () => {});
  const storage = {
    loadSettings: vi.fn(async () => settings),
    saveSettings,
  } as unknown as StorageProvider;
  return { storage, saveSettings };
}

beforeEach(() => {
  runConnectionTest.mockReset();
});

describe("SetupWizard (issue #121)", () => {
  it("エンドポイントが初期値のままなら初回にウィザードを出す", async () => {
    const { storage } = makeStorage();
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={vi.fn()}
        onGoSettings={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
  });

  it("設定済み（接続テスト成功済み）なら出さない", async () => {
    const { storage } = makeStorage({
      llmApiEndpoint: "http://192.168.68.52:11434/v1",
      llmVerifiedEndpoint: "http://192.168.68.52:11434/v1",
    });
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={vi.fn()}
        onGoSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(storage.loadSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("setup-wizard")).toBeNull();
  });

  it("設定画面では出さない（既に導線の上にいるため）", async () => {
    const { storage } = makeStorage();
    render(
      <SetupWizard
        storage={storage}
        screenName="settings"
        onGoConversation={vi.fn()}
        onGoSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(storage.loadSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("setup-wizard")).toBeNull();
  });

  it("スキップすると llmSetupDismissed を保存して閉じる", async () => {
    const { storage, saveSettings } = makeStorage();
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={vi.fn()}
        onGoSettings={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByTestId("setup-wizard-skip"));
    expect(saveSettings).toHaveBeenCalledWith({ llmSetupDismissed: true });
    await waitFor(() => expect(screen.queryByTestId("setup-wizard")).toBeNull());
  });

  it("接続テスト成功で検証マーカーを保存し、英会話へ誘導する", async () => {
    const { storage, saveSettings } = makeStorage();
    runConnectionTest.mockResolvedValue({
      ok: true,
      latencyMs: 120,
      diagnosis: null,
    });
    const onGoConversation = vi.fn();
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={onGoConversation}
        onGoSettings={vi.fn()}
      />,
    );
    await userEvent.type(
      await screen.findByTestId("setup-wizard-endpoint"),
      "http://192.168.68.52:11434/v1",
    );
    await userEvent.click(screen.getByTestId("setup-wizard-test"));

    await waitFor(() =>
      expect(screen.getByTestId("setup-wizard-result").textContent).toContain(
        "接続OK",
      ),
    );
    expect(saveSettings).toHaveBeenCalledWith({
      llmApiEndpoint: "http://192.168.68.52:11434/v1",
      llmModel: DEFAULT_SETTINGS.llmModel,
      llmApiKey: "",
      llmVerifiedEndpoint: "http://192.168.68.52:11434/v1",
      llmSetupDismissed: true,
    });
    await userEvent.click(screen.getByTestId("setup-wizard-start"));
    expect(onGoConversation).toHaveBeenCalledTimes(1);
  });

  it("到達不可の失敗ではセルフチェック（LAN待ち受け/CORS）を出す", async () => {
    const { storage } = makeStorage();
    runConnectionTest.mockResolvedValue({
      ok: false,
      latencyMs: 80,
      error: "エンドポイントに到達できません",
      diagnosis: "unreachable",
    });
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={vi.fn()}
        onGoSettings={vi.fn()}
      />,
    );
    await userEvent.type(
      await screen.findByTestId("setup-wizard-endpoint"),
      "http://192.168.68.52:11434/v1",
    );
    await userEvent.click(screen.getByTestId("setup-wizard-test"));
    const result = await screen.findByTestId("setup-wizard-result");
    expect(result.textContent).toContain("接続テスト失敗");
    expect(result.textContent).toContain("OLLAMA_HOST");
  });

  it("URLが空のまま接続テストするとネットワークに投げずに注意する", async () => {
    const { storage } = makeStorage({ llmApiEndpoint: "" });
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={vi.fn()}
        onGoSettings={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByTestId("setup-wizard-test"));
    const result = await screen.findByTestId("setup-wizard-result");
    expect(result.textContent).toContain("APIエンドポイントが空です");
    expect(runConnectionTest).not.toHaveBeenCalled();
  });

  it("「設定画面で詳しく設定」は設定へ遷移する", async () => {
    const { storage } = makeStorage();
    const onGoSettings = vi.fn();
    render(
      <SetupWizard
        storage={storage}
        screenName="home"
        onGoConversation={vi.fn()}
        onGoSettings={onGoSettings}
      />,
    );
    await userEvent.click(await screen.findByTestId("setup-wizard-advanced"));
    expect(onGoSettings).toHaveBeenCalledTimes(1);
  });
});
