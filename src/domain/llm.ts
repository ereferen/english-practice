/**
 * 共通LLM呼び出しレイヤー (issue #18)
 *
 * - マルチプロバイダ対応: providers は優先度順（先頭がプライマリ、以降はフォールバック）
 * - ストリーミング非対応API向けに非ストリーミングへフォールバック
 * - プロバイダごとのタイムアウト（#21: ローカル30s / 外部15s を想定し呼び出し側で指定）
 * - 全プロバイダ失敗時はまとめてエラー化、ユーザー側AbortSignalは即伝播
 */

export interface LlmProviderConfig {
  id: string;
  label: string;
  apiEndpoint: string;
  model: string;
  apiKey: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  providers: LlmProviderConfig[];
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface LlmChatResult {
  content: string;
  providerId: string;
  providerLabel: string;
}

export const DEFAULT_LLM_TIMEOUT_MS = 30_000;

/**
 * Settings（単一＋フォールバック）から優先度順のプロバイダチェーンを構築。
 * 既存の単一設定との互換移行パス（issue #18）。
 */
export function providersFromSettings(settings: {
  llmApiEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmFallbackApiEndpoint?: string;
  llmFallbackModel?: string;
  llmFallbackApiKey?: string;
}): LlmProviderConfig[] {
  const providers: LlmProviderConfig[] = [];
  if (settings.llmApiEndpoint.trim()) {
    providers.push({
      id: "primary",
      label: "プライマリ",
      apiEndpoint: settings.llmApiEndpoint.trim(),
      model: settings.llmModel.trim(),
      apiKey: settings.llmApiKey,
    });
  }
  if (settings.llmFallbackApiEndpoint?.trim()) {
    providers.push({
      id: "fallback",
      label: "フォールバック",
      apiEndpoint: settings.llmFallbackApiEndpoint.trim(),
      model: settings.llmFallbackModel?.trim() ?? "",
      apiKey: settings.llmFallbackApiKey ?? "",
    });
  }
  return providers;
}

export class LlmUserAbortError extends Error {
  constructor() {
    super("Aborted by user");
    this.name = "AbortError";
  }
}

/** Streaming was accepted by the API but produced nothing usable. */
class StreamingUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamingUnsupportedError";
  }
}

function chatUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/chat/completions`;
}

function headersFor(provider: LlmProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

function payloadFor(
  provider: LlmProviderConfig,
  messages: LlmMessage[],
  opts: Pick<LlmChatOptions, "maxTokens" | "temperature">,
  stream: boolean,
) {
  return {
    model: provider.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 512,
  };
}

/**
 * Combine a user-provided abort signal with a timeout.
 * Returns a fetch-level signal plus a timer for whether the timeout fired.
 */
function withTimeout(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timeoutFired = false;
  const timer = setTimeout(() => {
    timeoutFired = true;
    controller.abort();
  }, timeoutMs);
  const onUserAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) onUserAbort();
    else userSignal.addEventListener("abort", onUserAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    cleanup: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    },
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function assertOk(response: Response): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `LLM API error (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

/** Non-streaming completion. */
async function completeOnce(
  provider: LlmProviderConfig,
  opts: LlmChatOptions,
): Promise<string> {
  const { signal, timedOut, cleanup } = withTimeout(
    opts.signal,
    opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
  );
  try {
    const response = await fetch(chatUrl(provider.apiEndpoint), {
      method: "POST",
      headers: headersFor(provider),
      body: JSON.stringify(payloadFor(provider, opts.messages, opts, false)),
      signal,
    });
    await assertOk(response);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("LLM API returned unexpected response format");
    }
    return content;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      if (timedOut()) throw new Error("timeout");
      throw new LlmUserAbortError();
    }
    throw e;
  } finally {
    cleanup();
  }
}

/** SSE streaming completion. Calls onChunk per delta. */
async function streamOnce(
  provider: LlmProviderConfig,
  opts: LlmChatOptions,
): Promise<string> {
  const { signal, timedOut, cleanup } = withTimeout(
    opts.signal,
    opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
  );
  try {
    const response = await fetch(chatUrl(provider.apiEndpoint), {
      method: "POST",
      headers: headersFor(provider),
      body: JSON.stringify(payloadFor(provider, opts.messages, opts, true)),
      signal,
    });
    await assertOk(response);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new StreamingUnsupportedError("response body is not readable");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullContent += delta;
            opts.onChunk?.(delta);
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    if (!fullContent) {
      throw new StreamingUnsupportedError("stream produced no content");
    }
    return fullContent;
  } catch (e) {
    if (e instanceof StreamingUnsupportedError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      if (timedOut()) throw new Error("timeout");
      throw new LlmUserAbortError();
    }
    throw e;
  } finally {
    cleanup();
  }
}

/**
 * Try providers in order. Within one provider: if onChunk is given, attempt
 * streaming first and fall back to a single non-streaming chunk when the API
 * does not support streaming. Errors (except user abort) move to the next
 * provider.
 */
export async function requestLlmChat(
  opts: LlmChatOptions,
): Promise<LlmChatResult> {
  const failures: string[] = [];

  for (const provider of opts.providers) {
    if (opts.signal?.aborted) throw new LlmUserAbortError();
    try {
      if (opts.onChunk) {
        try {
          const content = await streamOnce(provider, opts);
          return {
            content,
            providerId: provider.id,
            providerLabel: provider.label,
          };
        } catch (e) {
          if (e instanceof LlmUserAbortError) throw e;
          if (
            e instanceof StreamingUnsupportedError ||
            (e instanceof Error &&
              e.message.includes("unexpected response format"))
          ) {
            // Streaming not usable on this provider: non-streaming fallback.
            const content = await completeOnce(provider, opts);
            opts.onChunk(content);
            return {
              content,
              providerId: provider.id,
              providerLabel: provider.label,
            };
          }
          throw e;
        }
      }
      const content = await completeOnce(provider, opts);
      return {
        content,
        providerId: provider.id,
        providerLabel: provider.label,
      };
    } catch (e) {
      if (e instanceof LlmUserAbortError) throw e;
      failures.push(`${provider.label}: ${errorMessage(e)}`);
    }
  }

  throw new Error(
    `LLM応答がありません（${failures.length}件のプロバイダに失敗）。設定を確認してください。` +
      (failures.length ? `\n${failures.join("\n")}` : ""),
  );
}

export interface LlmConnectionTestResult {
  ok: boolean;
  error?: string;
  latencyMs: number;
}

/** 接続テスト (issue #21): 最小リクエストで疎通確認する。 */
export async function testLlmConnection(
  provider: LlmProviderConfig,
  timeoutMs = 15_000,
): Promise<LlmConnectionTestResult> {
  const startedAt = Date.now();
  try {
    const content = await completeOnce(provider, {
      providers: [provider],
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      temperature: 0,
      timeoutMs,
    });
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      error: content ? undefined : "empty response",
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: errorMessage(e),
    };
  }
}
