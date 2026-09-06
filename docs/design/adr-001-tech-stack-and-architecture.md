# ADR-001: 技術スタック選定とアーキテクチャ設計 (英語学習アプリ MVP)

- タスク: t_7e795ff6
- 作成日: 2026-09-06
- 作成者: researcher
- ステータス: Accepted (実装着手可能)
- 依存文書: `docs/research/mvp-requirements-and-competitors.md` (要件定義、t_25e9889b)
- 並行文書: コンテンツ JSON スキーマは sibling タスク t_67a3a85c が所管 (本ADR §6 に統合点)

---

## 0. 設計の前提と制約 (要件定義からのトレース)

| 制約 | 出典 | 本ADRへの影響 |
|------|------|---------------|
| A2: Webアプリ優先・モバイルファースト | 要件定義 §0 | クライアントSPA。ネイティブなし |
| A3: 個人利用・認証不要・課金なし | 要件定義 §0 | バックエンド不要と判断する根拠 |
| 非機能: LocalStorage/IndexedDB ベースの永続化 | 要件定義 §3 | ADR-3 で保存機構を選定 |
| 非機能: 初期ロード ≤3秒 (4G)、遷移 <100ms | 要件定義 §3 | ビルドツールとバンドルサイズ方針の根拠 |
| 非機能: データはスキーマ文書化済みJSON・移行可能に | 要件定義 §3 | エクスポート機能とストレージ抽象化を義務化 |
| F1〜F4 (P0): フラッシュ/4択/簡易SRS/進捗ダッシュボード | 要件定義 §2.1 | 画面フロー §4 とデータモデル §5 |
| F7 音声はブラウザ組み込みTTS (鍵管理回避) | 要件定義 §3 セキュリティ | Web Speech API。追加依存なし |
| 発注者確認事項 Q1〜Q3 は未回答のまま | 要件定義 §0 | §8 のリスクと再訪条件に明記 |

バージョン表記は 2026-09-06 に npm registry / 一次ソースで確認済み (付録A)。

---

## 1. ADR-1: フロントエンド = React 19 + TypeScript + Vite 8 (クライアントSPA)

### 決定
- **React 19.2.x** + **TypeScript** + **Vite 8.2.x** (`create-vite` の react-ts テンプレート) によるクライアントサイドSPA。
- SSR/メタフレームワーク (Next.js 等) は使わず、`vite build` の静的出力をそのままホスティングする。
- Node バージョン要件: Vite 8 は `^20.19.0 || >=22.12.0`。**開発環境は v22.23.1 で適合済み** (2026-09-06 実測)。

### 選定理由
1.要件の学習ロジック (採点・間隔反復・進捗計算) は純関数として単体テストしやすくしたい。React + Vitest の Testing Library 生態系がこの要求に最も厚い。
2. モバイルブラウザ第一のトランジションの多い画面遷移 (カードめくり→クイズ→結果) には宣言的UIが適する。
3. Vite は冷間ビルド・HMR とも速く、静的ホスティング (GitHub Pages 等、base パス設定) で個人利用をそのまま配信できる。要件の「認証不要・ローカル保存」と最も相性がよい。
4. TypeScript で §5 のデータモデルを型で固定し、コンテンツJSONの境界検証 (zod 等) を効かせる。

### 却下した代替案

| 代替案 | 却下理由 |
|--------|----------|
| Next.js / Remix (SSR/メタFW) | サーバー不要 (A3)。SSRはデプロイ先・コストを増やし「個人・静的ホスト可」を壊す |
| Vue 3 + Vite | 技術的に十分成立。差別化が薄く、テスト/状態管理の生态系と実装者の既知性を優先し React (採用基準は付録B) |
| Svelte 5 + Vite | バンドルは最小級だが、型体験 (TS サポート) とデバッグ情報で React に劣る判断。小規模でも学習データ資産を守る型付けを重視 |
| Qwik / Solid / HTMX+Alpine | 個人MVPで生态系リスクを取る動機なし。採用基準を満たさない |
| Redux / Zustand / TanStack Query | UI状態は画面数6程度なら useReducer+Context で足りる。Query は「API取得」が存在せず出番がない (§3で静的JSONロードに置換) |

### 再訪条件
- 複数デバイス同期・サーバー保存が必要になった → §3 のストレージ抽象レイヤーの上に API 層を追加。その時点で Next/Remix でなく「SPA + 軽量API」から再評価。

---

## 2. ADR-2: ルーティング = react-router 導入なし (ステートマシン駆動の画面切替)

### 決定
- 画面は **アプリ状態マシン (union 型 screens) + useReducer** で切り替える。 react-router-dom (v7.18.3) は導入しない。
- 共有・復旧的な深層リンクが要る画面が生まれた時点で react-router を追加する (diff 小: 画面関数→ルートの機械的変換で対応可能に、画面コンポーネントは URL 非依存で書く)。

### 選定理由
- 画面フロー (§4) は一方向の線形フローで、URL で共有したい永続的ランドマークページがない (認証なし・個人利用)。
- バンドル削減 (要件 perf: 初期ロード ≤3s) と依存増回避。
- モバイルブラウザでのスワイプ戻る誤爆を、状態マシンの「戻る」で明示制御できる (フロー中断時は確認ダイアログ)。

### 却下した代替案
- react-router: 上記。将来の追加コストが低いので先行導入しない (YAGNI)。
- History API 自作: バグの温床。ステートマシンで代替。

---

## 3. ADR-3: データ保存 = IndexedDB (Dexie.js) + ストレージ抽象レイヤー

### 決定
- 永続ストアは **IndexedDB を Dexie.js 4.4.x** で操作。
- 適用範囲:
  - **Dexie (ユーザーデータ)**: 進捗・復習状態・セッション履歴・設定・インポートしたユーザーデッキ (削除されては困るもの全部)。
  - **静的JSON (配布コンテンツ)**: サンプルデッキは `public/content/*.json` を `fetch` で遅延ロード (キャッシュはブラウザ任せで可)。localStorage には **設定のスナップショットしか置かない**。
- 全永続化は `src/storage/` のプロバイダインターフェース (`loadProgress/saveProgress/exportAll/...`) 経由で行い、コンポーネントが Dexie を直接触らないようにする。

### 選定理由
- localStorage 単独は却下: 同期APIでUIスレッドを止め得る (perf <100ms要求)、5MB上限、JSON全文読書が構造的、何より**日付クエリ (今日のセッション・翌日キュー) とインデックス走査が進捗計算の本質要求**であり、KVでは全件読載しになる。
- IndexedDB は非同期・構造化クローン・インデックス検索可。要件 §3「LocalStorage/IndexedDB ベース」の後者。
- Dexie は Promise API +スキーマ版数管理 (`version(n).stores(...)`) を内蔵し、将来のスキーマ移行 (要件「移行可能な形」) のレールになる。`idb` ライブラリでも可決だが、トランザクションと複合インデックスの宣言的定義が書きやすい Dexie を採用。
- ストレージ抽象レイヤーにより、将来「認証つきサーバー保存」への差し替え時に UI/ロジックを無傷で残せる (要件 §3 データ形式の移行可能性)。

### 却下した代替案

| 代替案 | 却下理由 |
|--------|----------|
| localStorage のみ | 上記。セマンティックな復習キュー日付検索に不適 |
| OPFS + SQLite (wasm) | 能力は過剰。バンドル・複雑度・Safari互認の検討コストがMVPで正当化不能。PWAオフライン本格化時に再評価 |
| idb (raw) | Dexie と功能ほぼ同等で記述量多い。採用基準「移行管理とクエリ宣言性」で Dexie 優 |
| Firebase/Supabase 等 BaaS | 認証なしで使うと公開データ化・鍵管理発生。要件 §3「外部APIキー埋め込み回避」に反する。Q2 (認証) が YES になったら再評価 |

### 再訪条件
- Q3 が「オフライン必須」に確定 → Service Worker プリキャッシュ追加 (`vite-plugin-pwa`)。ストレージ設計は変更不要 (IndexedDB はオフラインで動く)。
- デバイス同期が必要 → サーバー追加。`src/storage/` に API プロバイダ実装を追加し、Dexie をオフラインキャッシュに降格。

---

## 4. 画面構成と遷移 (簡条書き)

```
[Home ダッシュボード]
 ├─ 今日復習する [F3キュー件数バッジ] ──→ [復習セッション]
 ├─ デッキを選ぶ ──→ [DeckList] ──→ [DeckHome(概要・進捗%)]
 │                                      ├─ フラッシュ開始 ──→ [Flash] ⟲めくる ⟲次語
 │                                      │        └─ 全語表示後 → [Quiz(誤答語+ランダム)]
 │                                      │              └─ 採点 → [SessionResult] → Home
 │                                      └─ (P1) CSVインポート [Import] → DeckList
 ├─ 苦手語 [F8] ──→ [WeakWords] → 選択して [復習セッション]
 ├─ ダッシュボード詳細 ──→ [Dashboard(週間・累計)]
 └─ 設定 ──→ [Settings(日課目標・データエクスポート/削除)]
```

- セッション内順序は要件推奨どおり **ホーム→デッキ→フラッシュ→クイズ→結果** を固定。
- [Flash] の語出し順: 新規語 → F3 復習キュー語 の順で混在させ、セッション1分以内に収まる語数上限 (デフォルト 15語、設定可)。
- 正誤フィードバックは色 + アイコン + テキスト + 音の4通道 (mikan 教訓・要件 §3 アクセシビリティ)。

---

## 5. データモデル / スキーマ草案 (アプリ側状態)

※ 見出し語・例文など**コンテンツの外部スキーマは t_67a3a85c の定義に合わせる** (§6)。以下はアプリが所有する進捗・状態側のモデル。TypeScript 定義案:

```ts
// 復習状態 — 語ごと1行。F3 簡易SRS (3段階) の実体
interface ReviewState {
  wordId: string;          // コンテンツスキーマの語ID (t_67a3a85c 由来)
  deckId: string;
  level: 0 | 1 | 2 | 3;    // 0=未修得 1=同日再出 2=翌日 3=4日後
  lastResult: 'correct' | 'wrong' | null;
  lastSeenAt: string;      // ISO 8601
  dueAt: string;           // 次回出題予定日 (YYYY-MM-DD)。Home のバッジはこれを today で引く
  correctStreak: number;
  wrongTotal: number;      // F8 苦手語一覧は wrongTotal>=2 で導出 (別テーブル持たない)
}

// セッション — 学習履歴。ダッシュボードはここを集計
interface Session {
  id: string;              // crypto.randomUUID()
  deckId: string;
  startedAt: string;
  endedAt: string | null;
  kind: 'learn' | 'quiz' | 'review';
  scoreRate: number | null; // 0..1。endedAt まで来た語の正答率
}

// クイズ採点イベント — 将来のSRS升级 (SM-2/FSRS) にも耐える粒度
interface AnswerEvent {
  id: string;
  sessionId: string;
  wordId: string;
  askedAt: string;
  correct: boolean;
  latencyMs: number;       // 表示から回答まで
}

interface Settings {
  dailyGoalWords: number;  // F5 デフォルト 10
  soundEnabled: boolean;
  dataVersion: 3;          // スキーマ変更時に上げる。移行関数を src/storage/migrations.ts に置く
}
```

Dexie スキーマ (テーブルキー + 索引):

```ts
db.version(1).stores({
  review:  'wordId, deckId, dueAt, level',       // dueAt で今日キュー索引検索
  sessions:'id, deckId, startedAt',
  answers: 'id, sessionId, wordId, [sessionId+wordId]',
  decks:   'id, source',                          // source: 'bundled' | 'import'
});
```

F3 の簡易SRS規則 (ロジック仕様の唯一の定義箇所。実装は純関数 `nextReviewLevel(state, correct)` に分離しテスト対象):
- 誤答 → level 0 に戻し、同一セッション末尾で再出題 (再出ても誤答なら据え置き)。
- 正答 → level+1 (cap 3)。next interval: level1=同日セッション内 / level2=翌日 / level3=4日後。
- level3 で再度誤答 → level 1 へ降格 (2に飛ばさない)。

---

## 6. コンテンツ (t_67a3a85c との統合点)

- 本ADRは**コンテンツスキーマを定義しない**。親タスク成果物の JSON スキーマを正とし、`src/content/schema.ts` に zod による実行時検証関数 (`parseDeck(json): Deck`) を実装する。
- 本ADR側の要求事項 (sibling への制約):
  1. 語に**安定ID**を含めること (配列indexや英単語そのものでない。CSV再インポートで進捗が消えないため)。`ReviewState.wordId` が紐先。
  2. デッキ単位で分割された JSON ファイルにすること (perf: デッキ遅延ロード)。
  3. CSVインポート (F6) の変換結果も同じスキーマに正規化して格納する。Anki TSV/CSV 出力の取り込みは将来のインポーティングアダプタ問題とし、コアスキーマは汚さない。
- サンプルデッキの初期搭載 (中学基本850語相当) は要件 F6/P1。MVP スケルトンは sibling のサンプルJSON (各レベル10-20語) で駆動する。

---

## 7. ディレクトリ構成とビルド/テスト方針

```
english-practice/
├── docs/
│   ├── research/        # 要件定義 (既存)
│   └── design/          # 本ADR・コンテンツ設計・ADR-002以降
├── public/content/      # サンプルデッキJSON (t_67a3a85c の成果物を配置)
├── src/
│   ├── main.tsx         # エントリ (画面ステートマウント)
│   ├── app/             # 状態マシン (reducer/screens) — F3 SRS規則もここ
│   ├── components/      # 画面コンポーネント (Home/DeckList/Flash/Quiz/Result/Dashboard/Settings)
│   ├── domain/          # 純ロジック: grading.ts / srs.ts / streak.ts (DOM非依存・テスト主戦場)
│   ├── storage/         # Dexie 定義 + プロバイダ抽象 + migrations.ts
│   ├── content/         # スキーマ検証 (zod) + JSON loader
│   └── styles/          # CSS Modules + デザイントークン (custom properties)
├── index.html
├── vite.config.ts
└── package.json
```

ビルド/テスト方針:
- `npm run dev` (Vite) / `npm run build` / `npm run preview`。静的成果物は任意のホスティング可 (`base` 設定で GitHub Pages 対応)。
- **テスト = Vitest 5 + @testing-library/react 16 + jsdom**。E2E (Playwright) は初期スコープ外とし、受け入れ基準「1分完走・7日連続・CSV取込5分」は人間による手動検証で兼ねる (要件 §4)。CIは任意 (個人利用)。
- テスト戦略の重点: `domain/` の純関数 (採点・SRS遷移・streak計算) を**日付注入可能 (`Clock` 引数) に実装**し、日跨ぎロジックをユニットで再現する。ここがバグるとF3/F4/F5が全部壊れるため。
- スタイリングは Tailwind 不使用: CSS Modules + tokens で十分小規模。コンポーネントFWも導入しない (画面6・要件は標準フォーム要素で足りる)。
- Lint: ESLint flat config + typescript-eslint + prettier (create-vite テンプレートに乗る分だけ)。

### TypeScriptバージョン注記 (要検証事項の実務判断)
- 2026-09-06 時点の npm latest は **TypeScript 7.0.2**。ただし7系はメジャー出たてでツールの追従が浅い可能性がある。
- 決定: **create-vite テンプレートが推奨するTSメジャー (5.9.x / 7.x のいずれか) に従う**。実装スキャフォールド時に `tsc --noEmit` と `vite build` が通ることを以て「適合」と判定し、壊れるなら1メジャー下げる (ADR改訂不要、package.json のパッチ範囲)。

---

## 8. リスクと発注者確認事項 Q1-Q3 の扱い

| 未確認事項 | 本ADR暫定判断 | 回答が変わった場合の手当て |
|-----------|---------------|---------------------------|
| Q1 試験対策 vs 日常語彙 | デッキ/レベルメタに `tags` 余地をコンテンツスキーマ要求 (§6) として確保。進捗は語単位なので両立 | 集計ビューの追加のみ。コア不変 |
| Q2 認証省略 | 認証なしで確定と仮置 (A3 と整合)。データ消失リスクは設定画面に常時明記 | BaaS導入は §3 再訪条件。ストレージ抽象が吸収 |
| Q3 オフラインPWA | 未対応。IndexedDB なので閲覧・学習自体はネット切断でも機能する (初回ロード済みな条件)。SWキャッシュは P2 フックのみ | `vite-plugin-pwa` 追加の1タスクに収まる |
| リスク: TS7 生态系追従 | §7 注記 のフォールバック手順 | — |
| リスク: Safari/IOS で IndexedDB | Dexie は対応済みだが、iOS Safari のストレージ退避 (数週間不使用で消え得る) はローカル保存方式共通の制約。エクスポート機能を P1→**MVP必須 (P0扱い)** に格上げして退避手段を担保する | — |

---

## 付録A: バージョン実測 (2026-09-06, npm registry / 各一次ソース)

| パッケージ | latest | 備考 |
|-----------|--------|------|
| vite | 8.2.2 | engines: node ^20.19.0 \|\| >=22.12.0 |
| react | 19.2.8 | 19系が安定ベースライン (react.dev 2024-12-05 React v19 published) |
| vitest | 5.0.0 | Vite ベース。Vite 8 との組合せはスキャフォールド時検証 |
| typescript | 7.0.2 | §7 注記 参照 |
| dexie | 4.4.5 | idb 8.0.3 は比較検討の上却下 |
| react-router-dom | 7.18.3 | 不使用 (§2)。将来候補 |
| @testing-library/react | 16.3.3 | — |
| ローカルNode | v22.23.1 | Vite 8 要件を満たす (実測) |

## 付録B: 技術選定の評価基準 (採点の主観を排除するため明示)

1. 要件制約適合 (ローカル保存・認証不要・モバイル第一・静的ホスト可) — 最優先、落ちたら即失格
2. ロジックの単体テスト容易性 (採点・SRS)
3. 2026年時点の生态系成熟度・長寿性 (要件調査で採用した競合知見を1年で陳腐化させない)
4. バンドル/ロード性能予算 (≤3s) を満たせること
5. 実装者引き継ぎのしやすさ (採用事例の多さ)

— 以上を §1-§3 の各「却下した代替案」表で根拠と紐付けた。実装者はこのメモだけからスキャフォールドを開始してよい。
