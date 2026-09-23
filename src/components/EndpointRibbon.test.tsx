import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EndpointRibbon from "./EndpointRibbon";
import { DEFAULT_SETTINGS /* types */ } from "../storage/types";
import type { StorageProvider, Settings } from "../storage/types";

function makeStorage(overrides: Partial<Settings> = {}): StorageProvider {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  return {
    loadSettings: vi.fn(async () => settings),
  } as unknown as StorageProvider;
}

describe("EndpointRibbon (issue #121)", () => {
  it("初期値のままならリボンを出し、クリックで設定へ誘導する", async () => {
    const onOpenSettings = vi.fn();
    render(
      <EndpointRibbon
        storage={makeStorage()}
        screenName="home"
        onOpenSettings={onOpenSettings}
      />,
    );
    const action = await screen.findByTestId("endpoint-ribbon-action");
    await userEvent.click(action);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("接続テスト成功済みならリボンを出さない", async () => {
    const storage = makeStorage({
      llmApiEndpoint: "http://192.168.68.52:11434/v1",
      llmVerifiedEndpoint: "http://192.168.68.52:11434/v1",
    });
    render(
      <EndpointRibbon
        storage={storage}
        screenName="home"
        onOpenSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(storage.loadSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("endpoint-ribbon-action")).toBeNull();
  });

  it("設定画面では出さない（既に導線の上にいるため）", async () => {
    const storage = makeStorage();
    render(
      <EndpointRibbon
        storage={storage}
        screenName="settings"
        onOpenSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(storage.loadSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("endpoint-ribbon-action")).toBeNull();
  });
});
