import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildWeaknessInput,
  parseWeaknessReport,
  sanitizeWordIds,
  streakFromDates,
  timeBucketOf,
  analyzeWeaknessWithLlm,
} from "./weaknessAnalysis";
import type { WeaknessAnalysisInput } from "./weaknessAnalysis";
import type { AnswerEvent } from "../storage/types";
import type { Deck, Word } from "../content/schema";

function answer(
  wordId: string,
  correct: boolean,
  askedAt: string,
  latencyMs = 1000,
): AnswerEvent {
  return {
    id: `${wordId}-${askedAt}-${correct ? "c" : "w"}`,
    sessionId: "s1",
    wordId,
    askedAt,
    correct,
    latencyMs,
  };
}

function word(id: string, pos: Word["partOfSpeech"]): Word {
  return {
    wordId: id,
    term: id,
    reading: `${id}読`,
    meaning: `${id}の意味`,
    partOfSpeech: pos,
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
      words: [
        word("run", "verb"),
        word("happy", "adjective"),
        word("cat", "noun"),
      ],
      quizzes: [],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("timeBucketOf", () => {
  it("buckets local hours into morning/afternoon/evening/night", () => {
    expect(timeBucketOf("2026-09-01T07:00:00")).toBe("morning");
    expect(timeBucketOf("2026-09-01T13:00:00")).toBe("afternoon");
    expect(timeBucketOf("2026-09-01T19:00:00")).toBe("evening");
    expect(timeBucketOf("2026-09-01T23:30:00")).toBe("night");
    expect(timeBucketOf("2026-09-01T03:00:00")).toBe("night");
  });
});

describe("streakFromDates", () => {
  it("counts consecutive days ending today", () => {
    const dates = [
      "2026-09-08T10:00:00Z",
      "2026-09-09T10:00:00Z",
      "2026-09-10T10:00:00Z",
      "2026-09-05T10:00:00Z",
    ];
    expect(streakFromDates(dates, "2026-09-10")).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it("current is 0 when today has no answers", () => {
    const dates = ["2026-09-08T10:00:00Z", "2026-09-09T10:00:00Z"];
    const s = streakFromDates(dates, "2026-09-10");
    expect(s.current).toBe(0);
    expect(s.longest).toBe(2);
  });
});

describe("buildWeaknessInput", () => {
  it("aggregates by part of speech, time bucket, and weak words", () => {
    const answers: AnswerEvent[] = [
      answer("run", false, "2026-09-09T08:00:00", 900),
      answer("run", false, "2026-09-09T08:10:00", 1100),
      answer("run", true, "2026-09-10T08:20:00", 500),
      answer("cat", true, "2026-09-10T20:00:00", 400),
      answer("happy", true, "2026-09-10T20:30:00", 300),
    ];
    const input = buildWeaknessInput({
      answers,
      decks: [deck],
      today: "2026-09-10",
    });
    expect(input.totalAnswers).toBe(5);
    expect(input.correctRate).toBeCloseTo(3 / 5);
    expect(input.byPartOfSpeech.verb).toEqual({ correct: 1, wrong: 2 });
    expect(input.byPartOfSpeech.noun).toEqual({ correct: 1, wrong: 0 });
    expect(input.byTimeBucket.morning).toEqual({ correct: 1, wrong: 2 });
    expect(input.byTimeBucket.evening).toEqual({ correct: 2, wrong: 0 });
    expect(input.weakWords[0]).toMatchObject({
      wordId: "run",
      term: "run",
      wrongCount: 2,
    });
    expect(input.latency.medianWrongMs).toBe(1000);
  });

  it("unknown wordIds fall into the 'other' bucket", () => {
    const input = buildWeaknessInput({
      answers: [answer("ghost", false, "2026-09-10T09:00:00")],
      decks: [deck],
      today: "2026-09-10",
    });
    expect(input.byPartOfSpeech.other).toEqual({ correct: 0, wrong: 1 });
    expect(input.weakWords[0].term).toBe("ghost");
  });

  it("empty answers produce a zeroed input", () => {
    const input = buildWeaknessInput({
      answers: [],
      decks: [deck],
      today: "2026-09-10",
    });
    expect(input.totalAnswers).toBe(0);
    expect(input.correctRate).toBe(0);
    expect(input.weakWords).toEqual([]);
    expect(input.latency.medianCorrectMs).toBeNull();
  });
});

const sampleInput: WeaknessAnalysisInput = {
  totalAnswers: 20,
  correctRate: 0.6,
  byPartOfSpeech: { verb: { correct: 4, wrong: 6 } },
  byTimeBucket: {
    morning: { correct: 5, wrong: 1 },
    afternoon: { correct: 2, wrong: 2 },
    evening: { correct: 3, wrong: 0 },
    night: { correct: 0, wrong: 4 },
  },
  weakWords: [
    {
      wordId: "run",
      term: "run",
      meaning: "走る",
      wrongCount: 6,
      lastSeenDays: 0,
    },
  ],
  latency: { medianWrongMs: 1200, medianCorrectMs: 500 },
  streakData: { current: 3, longest: 5 },
};

describe("parseWeaknessReport", () => {
  it("parses a clean JSON report", () => {
    const report = parseWeaknessReport(
      JSON.stringify({
        summary: "動詞の誤答が多いです",
        categories: [
          { category: "動詞", strength: "weak", advice: "活用形を集中練習" },
        ],
        recommendedFocus: ["run"],
        nextReviewStrategy: {
          increaseFrequency: ["run"],
          decreaseFrequency: [],
        },
      }),
    );
    expect(report.summary).toBe("動詞の誤答が多いです");
    expect(report.categories[0].strength).toBe("weak");
  });

  it("tolerates prose around the JSON object", () => {
    const report = parseWeaknessReport(
      'Here you go:\n{"summary":"ok","categories":[{"category":"x","strength":"strong","advice":"y"}],"recommendedFocus":[],"nextReviewStrategy":{"increaseFrequency":[],"decreaseFrequency":[]}}\nDone!',
    );
    expect(report.summary).toBe("ok");
  });

  it("rejects invalid strength values", () => {
    expect(() =>
      parseWeaknessReport(
        '{"summary":"s","categories":[{"category":"x","strength":"meh","advice":"y"}]}',
      ),
    ).toThrow(/スキーマ検証に失敗/);
  });

  it("throws when no JSON is present", () => {
    expect(() => parseWeaknessReport("no json here")).toThrow(/JSONを解析/);
  });
});

describe("sanitizeWordIds", () => {
  it("drops wordIds not present in the analysis input", () => {
    const sanitized = sanitizeWordIds(
      {
        summary: "s",
        categories: [],
        recommendedFocus: ["run", "made-up"],
        nextReviewStrategy: {
          increaseFrequency: ["run", "fake"],
          decreaseFrequency: ["cat"],
        },
      },
      sampleInput,
    );
    expect(sanitized.recommendedFocus).toEqual(["run"]);
    expect(sanitized.nextReviewStrategy.increaseFrequency).toEqual(["run"]);
    expect(sanitized.nextReviewStrategy.decreaseFrequency).toEqual([]);
  });
});

describe("analyzeWeaknessWithLlm", () => {
  it("calls the LLM and returns a sanitized report", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    summary: "動詞が苦手です",
                    categories: [
                      {
                        category: "動詞",
                        strength: "weak",
                        advice: "過去形を練習",
                      },
                    ],
                    recommendedFocus: ["run", "nonexistent"],
                    nextReviewStrategy: {
                      increaseFrequency: ["run"],
                      decreaseFrequency: [],
                    },
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const report = await analyzeWeaknessWithLlm({
      providers: [
        {
          id: "primary",
          label: "プライマリ",
          apiEndpoint: "http://llm.test/v1",
          model: "m",
          apiKey: "",
        },
      ],
      input: sampleInput,
    });
    expect(report.summary).toBe("動詞が苦手です");
    expect(report.recommendedFocus).toEqual(["run"]);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.messages[0].content).toContain("part-of-speech");
  });
});
