export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface ConversationConfig {
  apiEndpoint: string; // e.g. "http://192.168.1.100:11434/v1"
  model: string;       // e.g. "deepseek-v4-flash"
  apiKey: string;      // may be empty for local LLMs
}

export interface StreamChunk {
  done: boolean;
  content: string | null;
  error: string | null;
}

const SYSTEM_PROMPT = `You are an English conversation partner for a Japanese learner. Follow these rules:

1. Always respond in English.
2. Keep replies natural and conversational, suitable for a CEFR B1-B2 learner.
3. After each response, optionally include ONE short follow-up question to keep the conversation going.
4. If the learner makes a grammar mistake, gently model the correct usage in your reply — do NOT explicitly correct them unless asked.
5. Keep responses concise (1-3 sentences).
6. Occasionally introduce new vocabulary naturally in context, and use parentheses to give the Japanese translation: (和訳).
7. Stay in character as a friendly conversation partner — not a tutor, not a dictionary.`;

let messageIdCounter = 0;
export function createMessageId(): string {
  messageIdCounter += 1;
  return `msg_${Date.now()}_${messageIdCounter}`;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: createMessageId(),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

export function createAssistantMessage(content: string): ChatMessage {
  return {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

function buildPayload(messages: ChatMessage[], config: ConversationConfig) {
  return {
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    stream: false,
    temperature: 0.7,
    max_tokens: 512,
  };
}

/**
 * Send a chat completion request (non-streaming).
 * Returns the full assistant reply.
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  config: ConversationConfig,
  abortSignal?: AbortSignal,
): Promise<string> {
  const url = `${config.apiEndpoint.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildPayload(messages, config)),
    signal: abortSignal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `LLM API error (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM API returned unexpected response format");
  }
  return content;
}

/**
 * Send a chat completion request with SSE streaming.
 * Calls `onChunk` for each content token as it arrives.
 * Returns the full assembled message.
 */
export async function sendChatMessageStream(
  messages: ChatMessage[],
  config: ConversationConfig,
  onChunk: (chunk: string) => void,
  abortSignal?: AbortSignal,
): Promise<string> {
  const url = `${config.apiEndpoint.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const payload = buildPayload(messages, config);
  payload.stream = true;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: abortSignal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `LLM API error (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LLM API response body is not readable");
  }

  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  try {
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
            onChunk(delta);
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return fullContent;
}