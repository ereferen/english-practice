# English Practice

ローカルに学習・復習・進捗を保存する英語学習アプリ MVP です。
ブラウザ上で動作し、IndexedDB にデータを永続化します。

## 技術スタック

- React 19 + TypeScript + Vite 8
- IndexedDB (Dexie.js) で永続化
- ルーティングライブラリは使用せず、useReducer によるステートマシンで画面遷移
- クイズのスキーマ検証・整合性検証には Zod を使用

## 動作環境

- Node.js v22.12 以上
- 推奨ブラウザ: Chrome / Firefox / Safari / Edge（最新版）
- 本番配信は `base: '/english/'`（`vite.config.ts`）で固定ビルド

## 依存インストール

```bash
npm install
```

## 起動

### 開発サーバー

```bash
npm run dev
```

既定で `http://localhost:5173/english/` が開きます。

### 本番ビルド

```bash
npm run build
```

`dist/` に成果物が出力されます。本番配信はこのディレクトリを `/english/` 配下に静的配信してください。

### 本番プレビュー

```bash
npm run build
npm run preview
```

既定で `http://localhost:4173/english/` で確認できます。

## 検証

```bash
npm run test      # ユニットテスト（vitest）
npm run lint      # ESLint
npm run format    # Prettier による自動整形
```

CI / 受け入れ基準は以下をすべて満たすことです：

- `npm run test` が pass すること
- `npm run lint` がエラーゼロであること
- `npm run build` が成功し `dist/` が再生成されていること

## 学習フロー

1. ホーム画面で「デッキを選ぶ」を選択
2. デッキ一覧から対象デッキを選び「開く」
3. レッスンを選択して「学習・クイズ」
4. フラッシュカードで語を確認後、クイズに回答
5. 結果画面で正答率と誤答語を確認
6. 進捗ダッシュボードやホーム画面で学習状況を確認

### ショートカット

- `h` / `H` : ホーム画面へ戻る
- `?` : ショートカット一覧の表示・非表示

## サンプルコンテンツの配置

学習コンテンツは `src/content/data/` に JSON ファイルとして静的に配置されています。
ビルド時に Vite がバンドルするため、追加・変更時は `npm run build` を再実行してください。

| ファイル | 内容 |
|---|---|
| `src/content/data/beginner-core.json` | 中学基本語彙（初級） |
| `src/content/data/intermediate-workplace.json` | 中級ビジネス英語 |
| `src/content/data/advanced-academic.json` | 上級アカデミック英語 |

新しいデッキを追加する場合は、上記ファイルと同じ構造で作成し、`src/content/loader.ts` の `BUNDLED_DECK_FILES` に import を追加してください。スキーマ定義は `src/content/schema.ts` を参照してください。

## コンテンツの検証

`samples/` ディレクトリやファイルパスを直接指定して、Zod 検証と整合性検証を実行できます。

```bash
# ファイルを直接指定する例
node --experimental-vm-modules node_modules/.bin/vitest run tests/verify-loader-samples.test.ts
```

## データのエクスポート / インポート

設定画面から IndexedDB のデータを JSON でダウンロード・復元できます。
ブラウザをまたいで学習記録を移行する場合に利用してください。

## LLM 連携（オプション）

英会話練習・クイズ補充生成には OpenAI 互換 API を使用します。
設定画面で以下を入力してください：

- API Endpoint
- Model
- API Key

フォールバック API も設定できます。プライマリ失敗時にのみ使用されます。
