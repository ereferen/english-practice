import type { ChatMessage, ConversationTopic } from "./conversation";
import type { LlmProviderConfig } from "./llm";
import { requestLlmChat } from "./llm";

/**
 * Issue #234: 会話中に詰まったときの逃げ道が無い（相手の1往復目以降は
 * 自分で英語を捻るしかない）。直近の相手の発言に対して「こう返せます」の
 * 候補を 2〜3 個だけ出す。出しっぱなしにすると答えを見てしまうので、
 * 明示的に「ヒント」を押したときだけ生成する。
 */

export const MAX_HINTS = 3;
export const MAX_HINT_LEN = 140;

export function buildHintPrompt(messages: ChatMessage[], topic?: ConversationTopic): string {
  // 直近 6 往復だけ渡す（長い会話でもトークンを食わない・文脈は十分）
  const recent = messages
    .filter((m) => m.kind !== "note" && m.content.trim())
    .slice(-6)
    .map((m) => `${m.role === "user" ? "LEARNER" : "PARTNER"}: ${m.content}`)
    .join("\n");

  return `You are helping a Japanese learner of English (CEFR B1-B2, TOEIC 730) who is stuck mid-conversation.
${topic ? `Topic: ${topic.label} (${topic.emoji})\n` : ""}Here is the recent exchange:
${recent}

Write ${MAX_HINTS} short replies the LEARNER could send next to the PARTNER's last message.
Rules:
- Natural, casual spoken English a B1-B2 learner could actually produce (no idioms that are too rare).
- Max ${MAX_HINT_LEN} characters each, one sentence, optionally ending in a short follow-up question.
- Give three DIFFERENT angles (e.g. answer + ask back / agree + add a detail / ask the partner a question).
- Do NOT correct the learner. Do NOT explain grammar. No Japanese.

Return ONLY a JSON array of ${MAX_HINTS} strings, e.g. ["...","...","..."]`;
}

/** LLM 応答（コードフェンス・前置き混じり）から候補文字列だけ取り出す。 */
export function parseHintResult(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.replace(/^["'\s]+|["'\s]+$/g, "").trim())
      .filter((v) => v.length > 0 && v.length <= MAX_HINT_LEN)
      .slice(0, MAX_HINTS);
  } catch {
    return [];
  }
}

export async function requestReplyHints(opts: {
  providers: LlmProviderConfig[];
  messages: ChatMessage[];
  topic?: ConversationTopic;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string[]> {
  const lastPartner = [...opts.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.kind !== "error");
  if (!lastPartner) return [];
  const result = await requestLlmChat({
    providers: opts.providers,
    messages: [{ role: "user", content: buildHintPrompt(opts.messages, opts.topic) }],
    maxTokens: 300,
    temperature: 0.8,
    timeoutMs: opts.timeoutMs ?? 20_000,
    signal: opts.signal,
  });
  return parseHintResult(result.content);
}

/**
 * 候補チップを押したときの入力欄の値。既に入力中なら後ろに足すだけ
 * （学習者が書きかけの文を消さない）。送信はあくまで本人の操作。
 */
export function applyHint(current: string, hint: string): string {
  const base = current.trim();
  if (!base) return hint;
  return `${base} ${hint}`;
}
