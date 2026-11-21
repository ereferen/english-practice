import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSpeechFeedback } from "./useSpeechFeedback";

const speakMock = vi.fn<(text: string, onEnd?: () => void) => boolean>();

vi.mock("../domain/speech", () => ({
  speak: (text: string, onEnd?: () => void) => speakMock(text, onEnd),
}));

describe("useSpeechFeedback (issue #287)", () => {
  beforeEach(() => {
    speakMock.mockReset();
  });

  it("押した語の id を speakingId に立て、再生終了で戻す", () => {
    speakMock.mockReturnValue(true);
    const { result } = renderHook(() =>
      useSpeechFeedback({ available: true }),
    );

    act(() => {
      result.current.speakById("m1", "loot dropped");
    });
    expect(speakMock).toHaveBeenCalledWith("loot dropped", expect.any(Function));
    expect(result.current.speakingId).toBe("m1");

    // speak() が呼ぶ終了コールバックを再現する
    act(() => {
      speakMock.mock.calls[0][1]?.();
    });
    expect(result.current.speakingId).toBeNull();
  });

  it("音声が使えない環境では再生せず onUnavailable を1回呼ぶ（#83）", () => {
    const onUnavailable = vi.fn();
    const { result } = renderHook(() =>
      useSpeechFeedback({ available: false, onUnavailable }),
    );

    act(() => {
      result.current.speakById("m1", "hello");
    });
    expect(speakMock).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(result.current.speakingId).toBeNull();
  });

  it("autoSpeak は実際にキューされた時だけバッジを点ける（#47）", () => {
    const { result } = renderHook(() =>
      useSpeechFeedback({ available: true }),
    );

    speakMock.mockReturnValue(false);
    act(() => {
      result.current.autoSpeak("slow", "no engine");
    });
    expect(result.current.speakingId).toBeNull();

    speakMock.mockReturnValue(true);
    act(() => {
      result.current.autoSpeak("m2", "gg");
    });
    expect(result.current.speakingId).toBe("m2");
  });
});
