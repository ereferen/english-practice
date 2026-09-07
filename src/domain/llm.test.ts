import { describe, expect, it, vi } from "vitest";
import {
  providersFromSettings,
  requestLlmChat,
  testLlmConnection,
  type LlmProviderConfig,
} from "./llm";

function jsonRpc(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function sseResponse(deltas: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const d of deltas) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const primary: LlmProviderConfig = {
  id: "primary",
  label: "プライマリ",
  apiEndpoint: "http://local.test/v1",
  model: "m1",
  apiKey: "",
};

const fallback: LlmProviderConfig = {
  id: "fallback",
  label: "フォールバック",
  apiEndpoint: "http://remote.test/v1",
  model: "m2",
  apiKey: "k",
};

describe("providersFromSettings", () => {
  it("フォールバック未設定ならプライマリ1件", () => {
    const chain = providersFromSettings({
      llmApiEndpoint: "http://a/v1",
      llmModel: "m",
      llmApiKey: "",
      llmFallbackApiEndpoint: "",
    });
    expect(chain).toHaveLength(1);
    expect(chain[0].apiEndpoint).toBe("http://a/v1");
  });

  it("フォールバック設定なら2件・優先度順", () => {
    const chain = providersFromSettings({
      llmApiEndpoint: "http://a/v1",
      llmModel: "m",
      llmApiKey: "",
      llmFallbackApiEndpoint: "http://b/v1",
      llmFallbackModel: "fb",
      llmFallbackApiKey: "key",
    });
    expect(chain.map((p) => p.id)).toEqual(["primary", "fallback"]);
    expect(chain[1].model).toBe("fb");
  });

  it("空エンドポイントなら0件", () => {
    expect(
      providersFromSettings({
        llmApiEndpoint: "  ",
        llmModel: "m",
        llmApiKey: "",
      }),
    ).toHaveLength(0);
  });
});

describe("requestLlmChat", () => {
  it("非ストリーミングでプライマリ成功", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRpc("hello"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestLlmChat({
      providers: [primary],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("hello");
    expect(result.providerId).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("プライマリ失敗時はフォールバックが呼ばれる", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonRpc("from fallback"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestLlmChat({
      providers: [primary, fallback],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("from fallback");
    expect(result.providerId).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("全失敗時はまとめてエラー、AbortErrorではない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    await expect(
      requestLlmChat({
        providers: [primary, fallback],
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/LLM応答がありません/);
    vi.unstubAllGlobals();
  });

  it("ストリーミング成功: onChunk が呼ばれ全文が返る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse(["Ab", "cd"])),
    );
    const chunks: string[] = [];
    const result = await requestLlmChat({
      providers: [primary],
      messages: [{ role: "user", content: "hi" }],
      onChunk: (c) => chunks.push(c),
    });
    expect(result.content).toBe("Abcd");
    expect(chunks).toEqual(["Ab", "cd"]);
    vi.unstubAllGlobals();
  });

  it("ストリーミング非対応APIは非ストリーミングにフォールバック", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // stream: body null
      .mockResolvedValueOnce(jsonRpc("non-stream ok"));
    vi.stubGlobal("fetch", fetchMock);
    const chunks: string[] = [];
    const result = await requestLlmChat({
      providers: [primary],
      messages: [{ role: "user", content: "hi" }],
      onChunk: (c) => chunks.push(c),
    });
    expect(result.content).toBe("non-stream ok");
    expect(chunks).toEqual(["non-stream ok"]);
    vi.unstubAllGlobals();
  });

  it("ユーザーAbortはプロバイダ遷移せず即伝播", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        const signal: AbortSignal = init.signal;
        return new Promise((_res, rej) => {
          const err = new Error("aborted");
          err.name = "AbortError";
          signal.addEventListener("abort", () => rej(err));
        });
      }),
    );
    const controller = new AbortController();
    const promise = requestLlmChat({
      providers: [primary, fallback],
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow(/Aborted by user/);
    vi.unstubAllGlobals();
  });
});

describe("testLlmConnection", () => {
  it("成功時に ok=true とレイテンシ", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRpc("pong")));
    const result = await testLlmConnection(primary);
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe("number");
    vi.unstubAllGlobals();
  });

  it("失敗時に ok=false とエラー理由", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("refused"), { name: "TypeError" }),
        ),
    );
    const result = await testLlmConnection(primary);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("refused");
    vi.unstubAllGlobals();
  });
});
