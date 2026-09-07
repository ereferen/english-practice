# ADR-002: Self-Improve 機能アーキテクチャ設計 (LLM 自己改善サイクル)

- タスク: #14
- 作成日: 2026-09-07
- 作成者: agent
- ステータス: Accepted (Phase 1 実装着手可能)
- 依存文書:
  - `docs/design/adr-001-tech-stack-and-architecture.md` (基盤アーキテクチャ)
  - `docs/design/schema-reference.md` (コンテンツスキーマ)
- 関連Issue: #15, #16, #17, #18, #19, #20, #21
- 関連Issue (全体ロードマップ): #22

---

## 0. 設計の前提と制約

| 制約 | 出典 | 本ADRへの影響 |
|------|------|---------------|
| クライアントSPA・バックエンドなし | ADR-001 §0 (A3) | LLM呼び出しはブラウザから直接 (CORS許可必須) |
| データ保存は IndexedDB (Dexie.js) | ADR-001 §3 | 分析データ・生成コンテンツも IndexedDB に保存 |
| 既存の単一LLM設定 (Settings.llmApiEndpoint 等) | `src/storage/types.ts` | 後方互換を維持しつつマルチプロバイダへ拡張 |
| 認証なし・個人利用 | ADR-001 §0 (A3) | LLM APIキーは IndexedDB に保存、画面マスク表示継続 |
| プライマリ: OpenCode Go (ローカルLLM) / フォールバック: OpenRouter | #21 | オフラインファースト戦略の前提 |
| 既存の画面遷移: ステートマシン駆動 (useReducer) | ADR-001 §2 | Self-Improve画面も同パターンで追加 |
| React 19 + TypeScript + Vite 8 | ADR-001 §1 | 追加依存は最小限に |

### スコープ

- **Phase 1 (本ADR 対象)**: アーキテクチャ定義、共通LLM呼び出しレイヤー (`domain/llm.ts`)、Settings スキーマ拡張、基本データ収集
- **Phase 2-5**: 各機能の個別実装 (#15-#20)

---

## 1. 全体アーキテクチャ

### レイヤー構成

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer                          │
│  (Settings拡張 / SelfImprovePanel / 提案レビュー画面) │
├─────────────────────────────────────────────────────┤
│              Recommendation Layer                    │
│  (提案の検証・フィルタリング・ユーザー承認管理)        │
├─────────────────────────────────────────────────────┤
│                Analysis Layer                        │
│  (学習データ集計・LLM分析・改善提案生成)              │
├─────────────────────────────────────────────────────┤
│             LLM Provider Layer                       │
│  (共通LLM呼び出し・フォールバック・タイムアウト)       │
├─────────────────────────────────────────────────────┤
│          Data Collection Layer                       │
│  (AnswerEvent集計・Session集計・会話ログ収集)         │
└─────────────────────────────────────────────────────┘
         ↕                                ↕
   IndexedDB (Dexie)                 Browser Fetch API
```

### データフロー

```
[学習イベント] → DataCollectionLayer → IndexedDB
                                              ↓ (定期トリガー)
                                     AnalysisLayer → LLM API
                                              ↓
                                  RecommendationLayer (検証)
                                              ↓
                                     UI (提案表示)
                                        ↓ 承認/却下
                                  ApplyLayer → DB/設定更新
```

---

## 2. LLM Provider Layer (`src/domain/llm.ts`)

### 責務
- 全LLM呼び出しの統一インターフェース
- マルチプロバイダ設定の管理
- フォールバックチェーンとタイムアウト制御
- エラーハンドリングの共通化

### インターフェース

```typescript
// src/domain/llm.ts — 新設ファイル

/** 用途別LLMプロファイル */
export type LlmPurpose = "chat" | "analysis" | "generation";

/** プロバイダ設定 (IndexedDB に保存) */
export interface LlmProviderConfig {
  id: string;                    // 一意識別子
  label: string;                 // 表示名
  apiEndpoint: string;           // OpenAI互換エンドポイント
  model: string;                 // モデル名
  apiKey: string;                // 空文字可 (ローカルLLM)
  purpose: LlmPurpose;           // 用途
  maxTokens: number;             // デフォルト 1024
  temperature: number;           // デフォルト 0.7
  timeoutMs: number;             // 用途別タイムアウト
}

/** 呼び出しオプション */
export interface LlmCallOptions {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  abortSignal?: AbortSignal;
  onChunk?: (chunk: string) => void;  // ストリーミング用
}

/** 呼び出し結果 */
export interface LlmResult {
  content: string;
  model: string;
  providerId: string;
}

/** マルチプロバイダ設定 */
export interface MultiLlmSettings {
  providers: LlmProviderConfig[];
  assignment: Record<LlmPurpose, string>;  // purpose → providerId
}
```

### フォールバック戦略

```typescript
/** フォールバックチェーンでLLMを呼び出す */
export async function callLlm(
  purpose: LlmPurpose,
  options: LlmCallOptions,
): Promise<LlmResult> {
  const assignment = await getProviderAssignment();
  const primaryId = assignment[purpose];
  const primary = await getProviderConfig(primaryId);

  try {
    return await callProvider(primary, options);
  } catch (err) {
    // フォールバック探索: 同じpurposeを持つ他プロバイダ
    const fallbacks = await getFallbackProviders(purpose, primaryId);
    for (const fb of fallbacks) {
      try {
        return await callProvider(fb, options);
      } catch {
        continue;
      }
    }
    throw new LlmChainError(`All providers failed for ${purpose}`, { cause: err });
  }
}
```

### タイムアウト設定

| 用途 | タイムアウト | 理由 |
|------|-------------|------|
| chat | 30s (ローカル) / 15s (外部) | 対話のレスポンシブ保証 |
| analysis | 60s | バッチ処理、品質優先 |
| generation | 120s | 大量トークン生成 |

### 既存コードとの関係

現状の `src/domain/conversation.ts` の `sendChatMessage` / `sendChatMessageStream` はこのレイヤーの上に構築し直す。`conversation.ts` は「会話プロンプトの組み立て」に専念し、LLM呼び出し自体は `llm.ts` に委譲する。

**移行パス:**
1. Phase 1 で `domain/llm.ts` を実装 (既存 `conversation.ts` は当面そのまま)
2. Phase 1 で Settings にマルチプロバイダ設定を追加 (後方互換)
3. Phase 2 以降で `conversation.ts` をリファクタリング (呼び出しを `llm.ts` に委譲)

---

## 3. Data Collection Layer

### 責務
- 学習イベントの収集と構造化保存
- 集計クエリの提供 (分析レイヤー向け)
- 会話ログの保存と取得

### 既存のデータモデル

アプリは既に以下のデータ構造を持つ (`src/storage/types.ts`):

```typescript
interface AnswerEvent {
  id: string;
  sessionId: string;
  wordId: string;
  askedAt: string;
  correct: boolean;
  latencyMs: number;
}

interface SessionRecord {
  id: string;
  deckId: string;
  startedAt: string;
  endedAt: string | null;
  kind: "learn" | "quiz" | "review";
  scoreRate: number | null;
}

interface ReviewState {
  wordId: string;
  deckId: string;
  level: 0 | 1 | 2 | 3;
  lastResult: "correct" | "wrong" | null;
  lastSeenAt: string | null;
  dueAt: string | null;
  correctStreak: number;
  wrongTotal: number;
}
```

### 追加するテーブル (Dexie)

```typescript
// db.version(2).stores({ ... }) で追加

interface ConversationLog {
  id: string;
  startedAt: string;
  endedAt: string | null;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
  extractedContent: ExtractedContent[] | null;  // #19 で活用
}

interface SelfImproveAction {
  id: string;
  createdAt: string;
  category: "srs-optimization" | "weakness-report" | "question-generation"
            | "conversation-extract" | "settings-change";
  status: "pending" | "approved" | "rejected" | "applied" | "rolled-back";
  title: string;
  description: string;
  rationale: string;           // LLMによる根拠説明
  proposedChanges: unknown;    // 変更内容 (用途別に型定義)
  appliedAt: string | null;
  rolledBackAt: string | null;
  effectivenessScore: number | null;  // 適用後の効果測定
}
```

Dexie スキーマ拡張:

```typescript
db.version(2).stores({
  // 既存テーブルは維持
  review: 'wordId, deckId, dueAt, level',
  sessions: 'id, deckId, startedAt',
  answers: 'id, sessionId, wordId, askedAt, [sessionId+wordId]',
  decks: 'id, source',

  // 新規テーブル
  conversationLogs: 'id, startedAt',
  selfImproveActions: 'id, category, status, createdAt',
  generatedQuizzes: 'id, source, generatedAt',  // #15
});
```

### AnalyticsCollector インターフェース

```typescript
// src/domain/analytics.ts — 新設ファイル

export interface AnalyticsCollector {
  /** 弱点分析のためのデータを集計 */
  collectWeaknessData(): Promise<WeaknessAnalysisInput>;

  /** SRS最適化のためのデータを集計 */
  collectSrsData(): Promise<SrsOptimizationInput>;

  /** 会話ログ抽出データ */
  collectConversationData(since: string): Promise<ConversationLog[]>;

  /** 全体的な学習統計 */
  collectSummary(): Promise<LearningSummary>;
}

export interface LearningSummary {
  totalSessions: number;
  totalAnswers: number;
  overallCorrectRate: number;
  streakDays: number;
  dailyGoalWords: number;
  averageSessionDuration: number;
}
```

---

## 4. Analysis Layer (`src/domain/analysis.ts`)

### 責務
- 学習データをLLMに送信して分析・改善提案を取得
- プロンプトテンプレートの管理
- 分析結果のパースと検証

### プロンプトテンプレート

#### 弱点分析プロンプト

```
You are an English learning analytics expert. Analyze the learner's performance data:

## Current Performance
- Total answers: {totalAnswers}
- Overall correct rate: {correctRate}%
- Current streak: {currentStreak} days

## Performance by Part of Speech
{byPartOfSpeech}

## Weak Words (worst performers)
{weakWords}

## Time-based Performance
- Morning (6-12): {morningRate}%
- Afternoon (12-18): {afternoonRate}%
- Evening (18-24): {eveningRate}%

## Instructions
Analyze this data and produce a JSON report following this exact structure:
{
  "summary": "1-2 sentence summary in Japanese",
  "categories": [
    {
      "category": "noun"|"verb"|"adjective"|"adverb"|"phrase",
      "strength": "weak"|"average"|"strong",
      "advice": "specific advice in Japanese, 1 sentence"
    }
  ],
  "recommendedFocus": ["wordId1", "wordId2"],
  "nextReviewStrategy": {
    "increaseFrequency": ["wordId"],
    "decreaseFrequency": ["wordId"]
  }
}

Only output valid JSON. No markdown formatting.
```

#### SRS最適化プロンプト

```
You are an SRS (Spaced Repetition System) optimization expert. Analyze this learner's review data:

{reviewData}

Current SRS parameters:
- Levels: 0-3 (4 levels)
- Intervals: level0=immediate, level1=same day, level2=next day, level3=4 days
- Error penalty: level3 wrong → level1

Based on the data, suggest parameter optimizations as JSON:
{
  "levelCap": 3|4|5,
  "intervalMultiplier": 1.0-2.0,
  "errorPenaltyAdjustment": "current"|"gentler"|"harsher",
  "maxNewWordsPerSession": 5-20,
  "rationale": "explanation in Japanese"
}
```

#### 問題生成プロンプト

```
Generate English learning quiz questions for a Japanese learner.

Target words: {wordList}

For each word, generate a quiz question. Use various types:
- fill-blank: sentence with ___ for the target word
- choose-meaning: 4 choices (1 correct meaning, 3 distractors)
- translation: Japanese word, ask for English

Output as JSON array:
[
  {
    "type": "fill-blank"|"choose-meaning"|"translation",
    "wordId": "wordId",
    "prompt": "question text",
    "choices": ["A","B","C","D"],  // only for choose-meaning
    "correctAnswer": "answer",
    "explanation": "brief explanation in Japanese"
  }
]

Generate exactly {count} questions.
```

### LLMAnalyzer インターフェース

```typescript
// src/domain/analysis.ts

export interface LLMAnalyzer {
  analyzeWeaknesses(input: WeaknessAnalysisInput): Promise<WeaknessReport>;
  optimizeSrs(input: SrsOptimizationInput): Promise<SrsOptimizationResult>;
  generateQuestions(input: QuizGenerationInput): Promise<GeneratedQuestion[]>;
  extractFromConversation(log: ConversationLog): Promise<ExtractedContent[]>;
}
```

---

## 5. Recommendation Layer (`src/domain/recommendation.ts`)

### 責務
- LLM提案の検証 (安全チェック・範囲確認)
- 重複排除 (同じ内容の提案が既に存在しないか)
- ユーザー承認ワークフローの状態管理
- 提案の優先順位付け

### RecommendationEngine インターフェース

```typescript
export interface RecommendationEngine {
  /** LLM分析結果を受け取り、検証済み提案を生成 */
  processAnalysis<T>(raw: T): Promise<ValidatedRecommendation>;

  /** 保留中の提案一覧 */
  listPending(): Promise<SelfImproveAction[]>;

  /** 提案の承認 */
  approve(actionId: string): Promise<void>;

  /** 提案の却下 */
  reject(actionId: string, reason?: string): Promise<void>;

  /** 提案のロールバック */
  rollback(actionId: string): Promise<void>;
}

export interface ValidatedRecommendation {
  action: SelfImproveAction;
  safetyScore: number;        // 0-1
  duplicateOf: string | null; // 重複する既存提案のID
  warnings: string[];         // 安全上の注意
}
```

### 検証ルール

1. **範囲チェック**: 提案されたパラメータが許容範囲内か
   - 例: `levelCap` は 3-7 の範囲、`intervalMultiplier` は 0.5-3.0
2. **重複チェック**: 過去24時間以内に同じ内容の提案がないか
3. **安全チェック**: ユーザーデータの破壊的操作が含まれていないか
4. **頻度制限**: 同一カテゴリの提案は24時間に1回まで

---

## 6. Apply Layer (`src/domain/applier.ts`)

### 責務
- 承認された提案の適用
- 設定の更新
- データベースの更新
- ロールバックの実装

### ConfigApplier インターフェース

```typescript
export interface ConfigApplier {
  /** SRSパラメータの適用 */
  applySrsOptimization(params: SrsOptimizationResult): Promise<void>;

  /** 生成されたクイズの保存 */
  applyGeneratedQuizzes(quizzes: GeneratedQuiz): Promise<void>;

  /** 会話抽出コンテンツのデッキ追加 */
  applyExtractedContent(content: ExtractedContent[]): Promise<string>; // returns deckId

  /** 設定変更の適用 */
  applySettingsChange(changes: Partial<Settings>): Promise<void>;

  /** アクションのロールバック */
  rollbackAction(actionId: string): Promise<void>;
}
```

### ロールバック戦略

各アクションは適用時にスナップショットを保存:
- SRS最適化: 変更前のパラメータを `SelfImproveAction` に保存
- クイズ生成: 生成クイズのIDリストを保存 (削除でロールバック)
- 会話抽出: 追加したデッキのIDを保存 (削除でロールバック)
- 設定変更: 変更前の設定スナップショットを保存

---

## 7. UI 設計方針

### 設定画面の拡張

Settings 画面の Self-Improve セクション (#20 で本格実装):

```
┌─────────────────────────────────────────┐
│ Self-Improve                            │
│ ┌─────────────────────────────────────┐ │
│ │ [Toggle] 自己改善を有効にする       │ │
│ │                                      │ │
│ │ 自動適用レベル:                      │ │
│ │ ○ すべて提案のみ (承認必須)         │ │
│ │ ○ 問題生成のみ自動適用              │ │
│ │ ○ 全部自動適用                      │ │
│ │                                      │ │
│ │ LLMプロバイダ割り当て:               │ │
│ │ 会話:  [OpenCode Go ▼]              │ │
│ │ 分析:  [OpenRouter ▼]               │ │
│ │ 生成:  [OpenCode Go ▼]              │ │
│ │                                      │ │
│ │ [履歴を見る]  [今すぐ分析]           │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 提案通知バッジ

Home画面に表示:

```typescript
// Home.tsx に追加
{hasPendingSuggestions && (
  <div className="suggestion-badge">
    🔔 新しい改善提案があります ({pendingCount})
  </div>
)}
```

### 追加する画面 (AppState 拡張)

```typescript
// src/app/types.ts に追加
| { name: "selfImprove" }
| { name: "selfImproveHistory" }
| { name: "reviewSuggestion"; actionId: string }
```

---

## 8. Settings スキーマ拡張

```typescript
// src/storage/types.ts に追加

export interface SelfImproveSettings {
  enabled: boolean;                    // デフォルト: false
  autoApplyLevel: "none" | "quizzes" | "all";  // デフォルト: "none"
  providers: LlmProviderConfig[];      // マルチプロバイダ設定
  assignment: Record<LlmPurpose, string>;  // 用途→プロバイダマッピング
}

export interface Settings {
  // 既存フィールド
  dailyGoalWords: number;
  soundEnabled: boolean;
  dataVersion: number;

  // 既存LLM設定 (後方互換のため維持)
  llmApiEndpoint: string;
  llmModel: string;
  llmApiKey: string;

  // 新規 Self-Improve 設定
  selfImprove?: SelfImproveSettings;
}
```

### 後方互換戦略

- 既存の `llmApiEndpoint` / `llmModel` / `llmApiKey` は維持
- Self-Improve 未設定の場合、既存LLM設定を `providers[0]` として自動移行
- `providers` が空の場合: `llmApiEndpoint` + `llmModel` + `llmApiKey` から自動生成
- マイグレーション関数: `migrateSettingsV1toV2()`

---

## 9. ディレクトリ構成への影響

```
src/
├── domain/
│   ├── llm.ts            ← NEW: 共通LLM呼び出しレイヤー
│   ├── analytics.ts      ← NEW: データ収集・集計
│   ├── analysis.ts       ← NEW: LLM分析・提案生成
│   ├── recommendation.ts ← NEW: 提案検証・承認管理
│   ├── applier.ts        ← NEW: 設定適用・ロールバック
│   ├── conversation.ts   ← MODIFIED: llm.ts を利用するようリファクタ
│   └── ... (既存)
├── storage/
│   ├── types.ts          ← MODIFIED: Settings 拡張, 新規型
│   ├── db.ts             ← MODIFIED: Dexie v2 テーブル追加
│   └── ... (既存)
├── components/
│   ├── Settings.tsx       ← MODIFIED: Self-Improve設定セクション
│   ├── Home.tsx           ← MODIFIED: 提案通知バッジ
│   ├── SelfImprovePanel.tsx   ← NEW: 提案レビュー画面
│   ├── SelfImproveHistory.tsx ← NEW: 分析履歴画面
│   └── ... (既存)
├── app/
│   ├── types.ts          ← MODIFIED: Screen union 拡張
│   └── ... (既存)
└── styles/
    └── global.css        ← MODIFIED: 新規画面用CSS変数
```

---

## 10. 実装優先順位 (Phase 1)

### Phase 1-a: 基盤整備 (本Issue #14 の実装に相当)

| # | タスク | ファイル | 備考 |
|---|--------|---------|------|
| 1 | 共通LLM呼び出しレイヤー | `src/domain/llm.ts` | フォールバック・タイムアウト |
| 2 | Settingsスキーマ拡張 | `src/storage/types.ts` | MultiLlmSettings + SelfImproveSettings |
| 3 | Dexie v2 マイグレーション | `src/storage/db.ts` | 新規テーブル追加 |
| 4 | 設定画面UI拡張 (LLMプロバイダ) | `src/components/Settings.tsx` | マルチプロバイダ設定フォーム |

### Phase 1-b: データ収集

| # | タスク | ファイル | 備考 |
|---|--------|---------|------|
| 5 | AnalyticsCollector | `src/domain/analytics.ts` | 既存データの集計クエリ |
| 6 | AnswerEventの完全収集確認 | — | 既存実装のレビュー |

### 以降のPhase (#15-21 で個別実施)

- Phase 2: 問題生成機能 (#15)
- Phase 3: 弱点分析 (#16) + SRS最適化 (#17)
- Phase 4: 会話ログ抽出 (#18, #19)
- Phase 5: UX完成 (#20, #21)

---

## 11. リスクと注記

| リスク | 影響 | 対策 |
|--------|------|------|
| CORS制約 (ブラウザ→外部LLM API) | 全LLM呼び出し | 使用するAPIが CORS を許可していることを前提。ローカルLLM (OpenCode Go) は同一オリジン制約なし |
| IndexedDB ストレージ制限 | 会話ログ・生成コンテンツの増加 | 古い会話ログの自動削除 (30日保持)。手動削除UI |
| LLM API キーの漏洩 | クライアントサイド保存のリスク | 現状と同じ方針 (IndexedDB + 画面マスク)。センシティブデータはLLMに送らない |
| ローカルLLMの応答速度 | 会話UXへの影響 | タイムアウト30s + フォールバック。ユーザーへのフィードバック表示 |
| 既存テストとの互換性 | リファクタリング時のリグレッション | `domain/` の純関数は Clock 注入でテスト可能。UI変更は visual regression 注意 |

### 再訪条件

- ユーザーが「完全自動」を求めた場合 → 自動適用レベルの段階的引き上げ (#20)
- デバイス間同期が必要になった場合 → IndexedDB をローカルキャッシュに降格、StorageProvider に API 実装追加
- 外部LLM APIの利用規約変更 → OpenCode Go (ローカル) を安全基盤とした設計は維持

---

## 12. 付録: 既存コードとのインタフェースマッピング

| 既存コード | 変更 | 代替・新設コード |
|-----------|------|-----------------|
| `conversation.ts:sendChatMessage()` | 内部で `llm.ts:callProvider()` を呼ぶよう変更 | `llm.ts:callLlm('chat', ...)` |
| `conversation.ts:sendChatMessageStream()` | 同上 | `llm.ts:callLlm('chat', { onChunk })` |
| `storage/types.ts:Settings` | `selfImprove` フィールド追加 | `SelfImproveSettings` |
| `storage/db.ts:db.version(1)` | version(2) 追加 | 新テーブル |
| `app/types.ts:Screen` | 3種の画面追加 | selfImprove / selfImproveHistory / reviewSuggestion |
| `components/Settings.tsx` | Self-Improveセクション追加 | `SelfImproveSettings` UI |
| `domain/srs.ts:nextReviewState()` | 変更なし (既存SRSロジックは維持) | SRS最適化は分析レイヤーの責務 |