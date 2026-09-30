export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  /** Issue #111: error cards render without the read-aloud button. */
  kind?: "error";
  /** Issue #122: raw diagnostics for error cards, shown behind 詳しく. */
  details?: string;
}

export interface ConversationConfig {
  apiEndpoint: string; // e.g. "http://192.168.1.100:11434/v1"
  model: string; // e.g. "deepseek-v4-flash"
  apiKey: string; // may be empty for local LLMs
}

export interface StreamChunk {
  done: boolean;
  content: string | null;
  error: string | null;
}

export const SYSTEM_PROMPT = `You are an English conversation partner for a Japanese learner. Follow these rules:

1. Always respond in English.
2. Keep replies natural and conversational, suitable for a CEFR B1-B2 learner.
3. After each response, optionally include ONE short follow-up question to keep the conversation going.
4. If the learner makes a grammar mistake, gently model the correct usage in your reply — do NOT explicitly correct them unless asked.
5. Keep responses concise (1-3 sentences).
6. Occasionally introduce new vocabulary naturally in context, and use parentheses to give the Japanese translation: (和訳).
7. Stay in character as a friendly conversation partner — not a tutor, not a dictionary.`;

/**
 * Issue #147: 会話の入口がフリーチャットしか無く、毎回ネタを自分で振る必要が
 * あった（ペルソナ aki の要望）。話題プリセットを選ぶと
 *   1. system プロンプトに「話題・相手役・進め方」を足す
 *   2. 相手から話を振ってもらう最初のひと言を送る
 * の 2 つで「丸投げ」を無くす。
 */
export interface ConversationTopic {
  /** 安定 ID（テスト・保存用） */
  id: string;
  /** UI のボタンに出る日本語ラベル */
  label: string;
  emoji: string;
  /** system プロンプトに足す相手役・進め方の指示（英語） */
  directive: string;
  /** 話題を選んだときに送る最初のひと言（学習者役・英語） */
  opener: string;
  /** 会話の途中でこの話題に切り替えるときのひと言（学習者役・英語） */
  switchLine: string;
}

export const CONVERSATION_TOPICS: ConversationTopic[] = [
  {
    id: "gaming",
    label: "ゲーム",
    emoji: "🎮",
    directive:
      "Play the role of a friendly teammate you would meet on a North American " +
      "online game server. The learner picked up English on those servers. Talk " +
      "about what you are both playing: favorite titles, loadouts, party roles, " +
      "recent patches, and why you log in. Use casual gamer vocabulary " +
      "(queue, loadout, nerf, GG) naturally, not as a glossary.",
    opener: "Hey, I've been playing a lot of co-op games lately. What are you playing?",
    switchLine: "Actually, let's talk about games for a bit.",
  },
  {
    id: "travel",
    label: "旅行",
    emoji: "✈️",
    directive:
      "Play the role of a well-travelled friend who loves hearing about trips. " +
      "Talk about places you have been, food you ate, and small things that went " +
      "wrong on the road. Keep it concrete (a city, a dish, a delay) instead of " +
      "asking for abstract opinions.",
    opener: "I'm thinking about my next trip. Where would you want to go?",
    switchLine: "Let's talk about travel for a while.",
  },
  {
    id: "work",
    label: "仕事の雑談",
    emoji: "💼",
    directive:
      "Play the role of a friendly coworker on a mixed international team. Start " +
      "from ordinary small talk (weekend, workload, remote work, coffee) and " +
      "gradually move toward work English the learner will actually need: standups, " +
      "deadlines, asking for clarification in a meeting, politely disagreeing. " +
      "One step at a time — never jump straight into interview-style questions.",
    opener: "How's your week going so far — busy or pretty calm?",
    switchLine: "Can we switch to work small talk for a while?",
  },
  {
    id: "selfintro",
    label: "自己紹介",
    emoji: "🙋",
    directive:
      "Play the role of someone you have just met at a meetup. Ask about name, " +
      "hometown, hobbies, and what they do, in that order. This is practice for " +
      "first-meeting English, so react naturally to each answer before asking the " +
      "next thing.",
    opener: "Hi, I don't think we've met. I'm Alex — what's your name?",
    switchLine: "Let's go back to introductions for a minute.",
  },
];

/**
 * Issue #147: 話題が未選択なら従来どおりの `SYSTEM_PROMPT`。
 * 選択されていれば「相手がリードする」ルールを足す（アドリブが弱い learner が
 * 話題を振り続けなくて済むようにする）。
 */
export function buildSystemPrompt(topic: ConversationTopic | null): string {
  if (!topic) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}

--- Topic mode: ${topic.label} ---
${topic.directive}

How to lead this conversation:
- You keep it moving. The learner is weak at improvising, so never wait for them
  to invent a topic.
- Ask exactly ONE open question per reply, then stop and let them answer.
- If their answer is short, ask one easy follow-up (why / how / what happened
  next) before moving on.
- Every 3-4 replies, work in one idiom or collocation you would really use in
  this situation, with a short Japanese gloss in parentheses.`;
}

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

export function createAssistantMessage(
  content: string,
  kind?: "error",
): ChatMessage {
  return {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    ...(kind ? { kind } : {}),
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
