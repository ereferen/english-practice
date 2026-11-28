# ADR-003: zod 4.x 移行の影響調査（実測ベース）

- タスク: #288
- 作成日: 2026-11-29
- 作成者: agent
- ステータス: **Proposed**（オーナー判断待ち。実装PRはこの判断後に作る）
- 関連Issue: #288（zod 3.25.76 の GHSA-mrhx-c7xc-m3w5）, PR #318（依存を変えない緩和策）
- 関連文書: `docs/design/adr-001-tech-stack-and-architecture.md`

---

## 1. なぜこの文書があるか

#288 は「zod を 4.x に上げるべきか」をオーナー判断事項として残している。判断には「上げたら実際に何が壊れるか」の実測が必要なので、**依存を変えずに**一時的に `zod@4.6.7` を入れて全テストと型検査を回し、結果を記録した。作業ツリーは元の `zod@3.25.76` に戻してある（`git status` クリーン、`node_modules` の zod も 3.25.76 に復元済み）。

再現手順:

```bash
# 既存ツリーは peer 依存の ERESOLVE で素の npm install が通らないため --legacy-peer-deps を使う
npm install zod@4.6.7 --no-save --no-audit --no-fund --legacy-peer-deps
npx tsc --noEmit
npx vitest run
# 復元
npm install zod@3.25.76 --no-save --no-audit --no-fund --legacy-peer-deps
git checkout -- package.json package-lock.json
```

## 2. 実測結果（zod 4.6.7 / 2026-11-29）

| 検証 | 結果 |
|------|------|
| `npx tsc --noEmit` | **エラー2件**（いずれも `src/content/loader.ts` の `formatZodIssue`、同じ原因） |
| `npx vitest run` | **686テスト中5件失敗 / 2ファイル**（`tests/verify-loader-samples.test.ts` 4件、`src/content/loader.test.ts` 1件） |
| 検証ロジック自体の挙動 | **変化なし**（不正データは同じフィールド・同じパスで検出され続ける） |

失敗5件の原因は**すべてエラーメッセージ文言のアサーション**であり、バリデーションの挙動差ではない。壊れた `invalid-sample.json` に対して、v4 は同じ4件のissueを同じパスで返している:

```
[1] level: Invalid option: expected one of "beginner"|"intermediate"|"advanced"
[1] lessons.0.words.0.term: Too small: expected string to have >=1 characters
[1] lessons.0.words.1.examples: Invalid input: expected array, received undefined
[1] lessons.0.quizzes.0.choices: Too small: expected array to have exactly 4 items
```

### 2.1 メッセージ文言の対応（実測）

| 箇所 | zod 3 の文言（テストが期待） | zod 4 の文言（実測） |
|------|------------------------------|----------------------|
| `z.enum` | `Invalid enum value` | `Invalid option: expected one of ...` |
| `z.string().min(1)` | `at least 1 character` | `Too small: expected string to have >=1 characters` |
| 必須フィールド欠落 | `Required` | `Invalid input: expected array, received undefined`（型名が入る） |
| `z.array(...).length(4)` | `exactly 4 element(s)` | `Too small: expected array to have exactly 4 items` |

### 2.2 型エラー（2件・同一原因）

```
src/content/loader.ts(50,42): error TS2345: Argument of type
  '(issue: { message: string; path: (string | number)[] }) => string'
  is not assignable to parameter of type '(value: $ZodIssue, ...) => string'.
src/content/loader.ts(433,35): 同上
```

`formatZodIssue` が「構造的部分型」でissueを受けており、v4 の `$ZodIssue`（`path` が `PropertyKey[]`）と合わない。zod 側のexport型（`z.ZodIssue` / `z.core.$ZodIssue`）を使うか、`path: (string | number | symbol)[]` に広げれば解消する見込み。

## 3. 使っているAPIの棚卸し（`grep` 実測）

`src/` で zod を使うのは8ファイル・14行（import ベース）。使用APIは以下に限られ、**v4 で廃止・意味変更になる主要APIは使っていない**:

- 使っている: `z.object` / `z.array` / `z.string` / `z.number` / `z.enum` / `z.literal` / `z.union` / `z.set` / `.optional()` / `.default()` / `.catch()` / `.transform()` / `.refine()` / `.strict()`
- 使っていない: `z.record`（引数仕様変更の影響なし） / `z.nativeEnum` / `.merge()` / `z.function` / `z.promise` / `z.lazy` / `z.discriminatedUnion`
- 文字列フォーマット系は `.regex()` のみ（`z.string().email()` 等の移行対象なし）

つまり**コード側の移行コストは小さい**。実際に手を入れるのは `loader.ts` の1関数（型）と、文言に依存したテスト5件。

## 4. 提案

1. **移行する（推奨）**: 変更は「①`formatZodIssue` の型を zod のexport型に合わせる ②テスト5件のアサーションを文言ではなく `path` と `error.issues[].code` に寄せる」の2点。テストを文言非依存にしておけば、今後 zod 側のメッセージ変更でテストが壊れなくなる。`review:high`（依存メジャー更新）としてオーナー承認後に1本のPRで実施。
2. **据え置く**: PR #318 の入力サイズ上限（256 KiB）で、実害の引き金（巨大な制約付きコレクションの検証）には既に到達しない。ただし `npm audit` の high は残り続けるので、毎月の依存点検で同じ判断を繰り返すことになる。

## 5. 副次的に見つかった別問題（#288 とは独立）

現行ツリーは `@vitejs/plugin-react-swc@3.11.0` の peer が `vite@^4||^5||^6||^7` なのに本体が `vite@8.2.2` のため、**素の `npm install` が ERESOLVE で失敗する**（`--legacy-peer-deps` が必要）。新規クローンや「node_modules が無ければ npm install」という手順が失敗するので、別Issueで扱う。
