import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  canGenerateToday,
  extractJsonObject,
  generateQuizzesWithLlm,
  toQuizzes,
} from "./quizGeneration";
import type { Deck, Word } from "../content/schema";
import type { GeneratedQuizSet } from "../storage/types";

function word(id: string): Word {
  return {
    wordId: id,
    term: id,
    reading: `${id}読`,
    meaning: `${id}の意味`,
    examples: [{ en: `This is ${id}.` }],
  };
}

const deck: Deck = {
  schemaVersion: "1.0",
  deckId: "d1",
  level: "beginner",
  title: "t",
  lessons: [
    {
      lessonId: "l1",
      title: "L1",
      words: [word("apple"), word("banana")],
      quizzes: [],
    },
  ],
};

const providers = [
  {
    id: "primary",
    label: "プライマリ",
    apiEndpoint: "http://llm.test/v1",
    model: "m1",
    apiKey: "",
  },
];

function llmResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { role: "assistant", content: JSON.stringify(content) } },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("extractJsonObject", () => {
  it("プレーンJSONをそのまま返す", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });
  it("前後の説明文付きからJSON部分を抽出", () => {
    const text = 'Here you go:\n{"questions": []}\nHope this helps!';
    expect(extractJsonObject(text)).toBe('{"questions": []}');
  });
  it("markdownフェンス付きも抽出", () => {
    const text = '```json\n{"q": 1}\n```';
    expect(extractJsonObject(text)).toContain('"q"');
  });
  it("JSONが無ければundefined", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
  });
});

describe("toQuizzes", () => {
  const parsed = {
    questions: [
      {
        wordId: "apple",
        prompt: "「りんご」はどれ？",
        choices: ["りんご", "バナナ", "みかん", "りんご"], // 答えが重複 → 不正
        answerIndex: 0,
      },
      {
        wordId: "nonexistent",
        prompt: "ghost",
        choices: ["a", "b", "c", "d"],
        answerIndex: 1,
      },
      {
        wordId: "banana",
        prompt: "banana?",
        choices: ["x", "y", "z", "w"],
        answerIndex: 2,
        explanation: "解説",
      },
    ],
  };
  const { quizzes, rejected } = toQuizzes(parsed as never, deck, "batch1");

  it("不正語彙・重複選択肢をすてる", () => {
    expect(quizzes).toHaveLength(1);
    expect(rejected).toBe(2);
  });
  it("採用分はquizSchema互換の4択Quiz", () => {
    const q = quizzes[0];
    expect(q.quizId).toBe("batch1-q2");
    expect(q.choices).toHaveLength(4);
    expect(q.answerChoiceId).toBe("c2");
    expect(q.choices.find((c) => c.choiceId === "c2")?.text).toBe("z");
    expect(q.explanation).toBe("解説");
  });
});

describe("canGenerateToday", () => {
  const today = "2026-09-08";
  const mk = (n: number, deckId = "d1", lessonId = "l1"): GeneratedQuizSet[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      deckId,
      lessonId,
      source: "llm-supplement",
      words: [],
      quizzes: [],
      rejected: 0,
      generatedAt: `${today}T0${i}:00:00.000Z`,
      model: "m1",
    }));

  it("上限未満なら生成可", () => {
    expect(canGenerateToday(mk(2), "d1", "l1", today)).toBe(true);
  });
  it("上限到達なら生成不可", () => {
    expect(canGenerateToday(mk(3), "d1", "l1", today)).toBe(false);
  });
  it("別レッスンはカウントしない", () => {
    expect(canGenerateToday(mk(3), "d1", "l1", today)).toBe(false);
    expect(canGenerateToday(mk(3), "d1", "l2", today)).toBe(true);
  });
  it("前日の生成はカウントしない", () => {
    const old = mk(3).map((s) => ({
      ...s,
      generatedAt: "2026-09-07T01:00:00Z",
    }));
    expect(canGenerateToday(old, "d1", "l1", today)).toBe(true);
  });
});

describe("generateQuizzesWithLlm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常生成: 保存可能なGeneratedQuizSetを返す", async () => {
    const body = {
      questions: [
        {
          wordId: "apple",
          prompt: "りんごは？",
          choices: ["りんご", "バナナ", "みかん", "ぶどう"],
          answerIndex: 0,
          explanation: "appleはりんご",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(llmResponse(body));
    const set = await generateQuizzesWithLlm({
      providers,
      deck,
      lessonId: "l1",
      source: "llm-supplement",
      count: 1,
    });
    expect(set.deckId).toBe("d1");
    expect(set.lessonId).toBe("l1");
    expect(set.source).toBe("llm-supplement");
    expect(set.words).toEqual(["apple"]);
    expect(set.quizzes).toHaveLength(1);
    expect(set.model).toBe("m1");
    // プロンプトにwordId一覧と語彙が含まれている
    const call = vi.mocked(fetch).mock.calls[0];
    const payload = JSON.parse(String((call[1] as RequestInit).body));
    expect(payload.messages[0].content).toContain("wordId=apple");
  });

  it("不正wordIdのみならエラー", async () => {
    const body = {
      questions: [
        {
          wordId: "ghost",
          prompt: "x",
          choices: ["a", "b", "c", "d"],
          answerIndex: 0,
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(llmResponse(body));
    await expect(
      generateQuizzesWithLlm({
        providers,
        deck,
        lessonId: "l1",
        source: "llm-supplement",
      }),
    ).rejects.toThrow(/検証に不合格/);
  });

  it("JSON解析不能な応答はエラー", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: "sorry, no json" } },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      generateQuizzesWithLlm({
        providers,
        deck,
        lessonId: "l1",
        source: "llm-supplement",
      }),
    ).rejects.toThrow(/JSONを解析できません/);
  });

  it("苦手語集中モードはfocusWordIdsをプロンプトに反映", async () => {
    const body = {
      questions: [
        {
          wordId: "banana",
          prompt: "banana?",
          choices: ["a", "b", "c", "d"],
          answerIndex: 0,
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(llmResponse(body));
    await generateQuizzesWithLlm({
      providers,
      deck,
      lessonId: "l1",
      source: "llm-wrong-focus",
      focusWordIds: ["banana"],
    });
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(payload.messages[0].content).toContain(
      "repeatedly gets these words wrong",
    );
    // 対象は banana のみ（apple の語彙行は含めない）
    expect(payload.messages[0].content).toContain("wordId=banana");
    expect(payload.messages[0].content).not.toContain("wordId=apple ");
  });
});
