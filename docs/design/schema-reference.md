# JSON Schema Reference — 単語データ・クイズ問題データ

- 作成タスク: `t_5b95016a` (親タスク `t_67a3a85c` の成果物から抽出)
- 作成日: 2026-09-06
- 出典:
  - `content/schema/deck.schema.json` — JSON Schema (draft 2020-12)
  - `src/content/schema.ts` — Zod schema (runtime)
  - `docs/design/content-design.md` — 設計文書

---

## 1. データ階層

```
deck (1ファイル=1デッキ)
 └─ lessons[] (1〜N)
      ├─ words[] (1語〜, 推奨5語/lesson)
      └─ quizzes[] (任意。空なら自動生成)
```

キー設計:
- 進捗キー: `deckId + "/" + wordId` (デッキ間で wordId は独立)
- SRS状態キー: `wordId`
- デッキ間は独立。同じ `wordId` でもデッキが違えば別語扱い

---

## 2. Word 単語データ

### 2.1 スキーマ定義 (Zod)

```typescript
const wordSchema = z.object({
  wordId: slugSchema,              // 必須。デッキ内一意・不変のID
  term: z.string().min(1),          // 必須。見出し語 (カード表側)
  reading: z.string().min(1),       // 必須。カタカナ読み
  meaning: z.string().min(1),       // 必須。日本語意味 (多義は;区切り)
  partOfSpeech: z.enum([...]).optional(), // 任意。品詞
  examples: z.array(exampleSchema).min(1).max(3), // 必須。例文1〜3件
  note: z.string().optional(),      // 任意。補足
  tags: z.array(z.string()).optional(), // 任意。タグ
  audio: z.string().optional(),     // 任意。音声相対パス
}).strict();
```

### 2.2 slug 定義

```typescript
const slugSchema = z.string()
  .min(1).max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
// 英小文字・数字・ハイフン。先頭は英数字
```

### 2.3 example (例文) 定義

```typescript
const exampleSchema = z.object({
  en: z.string().min(1),            // 必須。英文
  ja: z.string().optional(),        // 任意。日本語訳
}).strict();
```

### 2.4 フィールド一覧

| フィールド | 型 | 必須 | 説明 |
|-----------|----|------|------|
| `wordId` | slug | ✓ | デッキ内で一意・不変。SRS/進捗キー。term由来で決定論的生成 |
| `term` | string(min1) | ✓ | 見出し語。フラッシュ表側・choose-term/fill-blank選択肢語 |
| `reading` | string(min1) | ✓ | カタカナ読み (日本語話者向け発音補助) |
| `meaning` | string(min1) | ✓ | 日本語意味。多義は`;`区切り。裏側表示・choose-meaning選択肢文 |
| `partOfSpeech` | enum | - | `noun` `verb` `adjective` `adverb` `preposition` `conjunction` `pronoun` `determiner` `exclamation` `other` |
| `examples` | example[] 1..3 | ✓ | 1件目がfill-blank生成の元。`en`必須`ja`任意 |
| `note` | string | - | 語法・対義語・記憶ヒント |
| `tags` | string[] | - | フィルタ拡張フック (unique) |
| `audio` | string | - | 音声相対パス。省略時はWeb Speech APIでTTS |

### 2.5 実サンプル

```json
{
  "wordId": "breakfast",
  "term": "breakfast",
  "reading": "ブレックファスト",
  "meaning": "朝食",
  "partOfSpeech": "noun",
  "examples": [
    { "en": "I eat breakfast at seven every morning.", "ja": "毎朝7時に朝食を食べます。" }
  ]
}
```

---

## 3. Quiz クイズ問題データ

### 3.1 スキーマ定義 (Zod)

```typescript
const quizSchema = z.object({
  quizId: slugSchema,                    // 必須。クイズID
  type: z.enum(["choose-meaning",
                 "choose-term",
                 "fill-blank"]),         // 必須。問題タイプ
  wordId: slugSchema,                    // 必須。出題対象単語
  prompt: z.string().min(1),             // 必須。問題文
  choices: z.array(choiceSchema).length(4), // 必須。4肢固定
  answerChoiceId: slugSchema,            // 必須。正解choiceId
  explanation: z.string().optional(),    // 任意。解説
}).strict();
```

### 3.2 choice (選択肢) 定義

```typescript
const choiceSchema = z.object({
  choiceId: slugSchema,        // 必須。選択肢ID
  text: z.string().min(1),     // 必須。選択肢テキスト
}).strict();
```

### 3.3 3種類の type

| type | promptの内容 | choices.textの内容 | 用途 |
|------|-------------|-------------------|------|
| `choose-meaning` | 対象の `term` | 日本語 meaning | 英→日 (mikan準拠) |
| `choose-term` | 対象の `meaning` | 英語 term | 日→英 (産出方向) |
| `fill-blank` | 例文を空所化 (`___`) | 英語 term | 文脈内理解 |

- fill-blank の空所は **アンダースコア3つ** (`___`) で表記
- ダミー3肢は同一デッキ内の他語から選択 (重複排除)

### 3.4 フィールド一覧

| フィールド | 型 | 必須 | 説明 |
|-----------|----|------|------|
| `quizId` | slug | ✓ | クイズID。手作り時は任意、自動生成時は `gen:<lessonId>:<wordId>:<n>` |
| `type` | enum | ✓ | `choose-meaning` `choose-term` `fill-blank` |
| `wordId` | slug | ✓ | 出題対象単語。採点結果のSRSキー |
| `prompt` | string(min1) | ✓ | 問題文。fill-blankでは`___`で空所 |
| `choices` | choice[4] | ✓ | 必ず4肢。choice:{choiceId, text} |
| `answerChoiceId` | slug | ✓ | 正解choiceId。choices内に存在必須 |
| `explanation` | string | - | 正誤フィードバック時の解説 |

### 3.5 実サンプル (3種)

**choose-meaning** — termを見て意味を選ぶ:
```json
{
  "quizId": "q-b01",
  "type": "choose-meaning",
  "wordId": "breakfast",
  "prompt": "breakfast",
  "choices": [
    { "choiceId": "c1", "text": "図書館" },
    { "choiceId": "c2", "text": "朝食" },
    { "choiceId": "c3", "text": "天気" },
    { "choiceId": "c4", "text": "医者" }
  ],
  "answerChoiceId": "c2"
}
```

**choose-term** — 意味を見てtermを選ぶ:
```json
{
  "quizId": "q-b02",
  "type": "choose-term",
  "wordId": "library",
  "prompt": "図書館",
  "choices": [
    { "choiceId": "c1", "text": "weather" },
    { "choiceId": "c2", "text": "travel" },
    { "choiceId": "c3", "text": "library" },
    { "choiceId": "c4", "text": "water" }
  ],
  "answerChoiceId": "c3",
  "explanation": "library は「図書館」。water (水) と綴りが似ていて混同しやすい。"
}
```

**fill-blank** — 例文の空所補充:
```json
{
  "quizId": "q-b03",
  "type": "fill-blank",
  "wordId": "weather",
  "prompt": "The ___ is nice today.",
  "choices": [
    { "choiceId": "c1", "text": "bridge" },
    { "choiceId": "c2", "text": "weather" },
    { "choiceId": "c3", "text": "water" },
    { "choiceId": "c4", "text": "exercise" }
  ],
  "answerChoiceId": "c2"
}
```

---

## 4. Deck トップレベル

```typescript
const deckSchema = z.object({
  $schema: z.string().optional(),                    // エディタ補完用 (任意)
  schemaVersion: z.string().regex(/^\d+\.\d+$/),   // 必須。例: "1.0"
  deckId: slugSchema,                                // 必須。永続識別子
  level: z.enum(["beginner", "intermediate", "advanced"]), // 必須
  title: z.string().min(1),                          // 必須
  description: z.string().optional(),                // 任意
  source: z.string().optional(),                     // 任意。出典
  lessons: z.array(lessonSchema).min(1),             // 必須。1lesson以上
}).strict();
```

### 4.1 Lesson 定義

```typescript
const lessonSchema = z.object({
  lessonId: slugSchema,                   // 必須
  title: z.string().min(1),               // 必須
  theme: z.string().optional(),           // 任意。主題
  words: z.array(wordSchema).min(1),      // 必須。1語以上
  quizzes: z.array(quizSchema).default([]), // 任意。空なら自動生成
}).strict();
```

---

## 5. 整合性制約 (JSON Schema で表現できないもの)

以下の制約はランタイム (Zod safeParse + `validateDeckConsistency`) で検証する:

| # | 制約 | 説明 |
|---|------|------|
| 1 | ID一意性 | lessons内で wordId / quizId / lessonId が重複しない |
| 2 | 参照解決 | `quiz.wordId` が同一デッキ内の `word.wordId` を指している |
| 3 | answerChoiceId存在 | `quiz.answerChoiceId` が `quiz.choices[].choiceId` 中に存在する |
| 4 | 選択肢重複 | 同一quiz内で choices.text に重複がない |
| 5 | 正解一致 | choose-meaning: 正解text == word.meaning / choose-term: 正解text == word.term |
| 6 | fill-blank空所 | `___` が prompt 内にちょうど1箇所 (答えのtermが空所以外に出現しない) |
| 7 | meaning重複 | デッキ内で同じ meaning の語がない (自動生成の曖昧化防止) |
| 8 | term重複 | デッキ内で同じ term の語がない |
| 9 | デッキ語数≥4 | 自動生成に必要な最低語数 |

---

## 6. クイズ自動生成規則 (quizzes 省略時)

1. 各 word → `choose-meaning` 1問 (prompt=term, 正解text=meaning)
2. ダミー3肢: 同一デッキ内の他語からランダム選択 (meaning重複除外)
3. `examples[0].en` に term 含む → `fill-blank` 併せて生成 (term→`___`変換)
4. デッキ語数<4 → 自動生成不可 (手作り要求)
5. 自動生成quizId: `gen:<lessonId>:<wordId>:<n>`

---

## 7. 検証手段

- JSON Schema 適合: `python3 scripts/validate_content.py`
- Zod parse: `parseDeck(json)` / `parseDeckSafe(json)` (src/content/schema.ts)
- 整合性: `validateDeckConsistency(deck)` (src/content/loader.ts)
- 単体テスト: `npm run test` (72 tests, 8 files)

### サンプルデータファイル

| パス | 内容 |
|------|------|
| `content/samples/beginner-core.json` | 初級 3lesson / 15語 / 手作りクイズ4問 (全type網羅) |
| `content/samples/intermediate-workplace.json` | 中級 2lesson / 10語 / クイズ3問 (混在ケース) |
| `content/samples/advanced-academic.json` | 上級 1lesson / 10語 / クイズなし (完全自動生成ケース) |