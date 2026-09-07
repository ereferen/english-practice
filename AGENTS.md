# AGENTS.md

このリポジトリで作業するエージェント（AI作業者）向けのルールです。人間・エージェント問わず、issue 対応はここに従ってください。

## 基本情報

- 技術スタック: React 19 + TypeScript + Vite 8 + Dexie.js + Zod（vitest / ESLint / Prettier）
- ベースブランチ: `scaffold/adr-based`（デフォルトブランチ）。作業ブランチはここから `feat/issue-<N>-<slug>` 等の名前で切る
- Issue 管理: GitHub (`ereferen/english-practice`)。`gh` CLI を使うこと（curl で API を直接叩かない）
- 設計文書: `docs/design/` の ADR を参照。アーキテクチャの方針変更は ADR を追加する

## 完了ルール（必須）

対応完了と申告する前に、以下を**すべて**確認すること:

1. `npm run test` がパスする
2. `npm run lint` がパスする（エラーゼロ。フォーマットは `npm run format`）
3. `npm run build` が成功し、`dist/` が再生成されている
4. **デプロイ先が壊れていない**: アプリは nginx がリポジトリ直下の `dist/` を `/english/` 配下に配信している（`http://192.168.68.52/english/`）。ビルド後の最新版が実際にアクセスできることを HTTP レスポンスで確認してから完了とする

**壊れた状態で「完了」と報告するのは NG。** ビルド失敗・テスト失敗・デプロイ先が古い/500 の状態でのクローズ、マージ、報告は一切認めません。検証で何かを直したら、検証を最初からやり直すこと。

## マージ方針

上記の完了ルール（test + lint + build + デプロイ確認）をすべて満たした場合、**ユーザーの承認を待たずに PR を自動マージしてよい**。マージ後はベースブランチで再度ビルド・デプロイ確認を行い、Issue に対応コメント（何をやったか、検証結果）を残してクローズする。

ただし以下は自動マージしないこと:

- 依存関係の大幅な追加・削除、`vite.config.ts` やデプロイ設定の変更を伴う変更
- 破壊的なデータスキーマ変更（IndexedDB のマイグレーションを伴うもの）
- 完了ルールのいずれかを満たせない変更

これらは PR を作成してユーザーに判断を仰ぐ。

## 作業フロー（標準）

1. Issue を読む → 作業ブランチを `scaffold/adr-based` から作成
2. 実装
3. `npm run test` → `npm run lint` → `npm run build` の順で検証
4. PR を作成（`Closes #<N>` を body に記載）→ 検証パス済みなら自動マージ
5. マージ後、デプロイ先の最新版を確認 → Issue に進捗/完了コメント → クローズ

## 備考

- コンテンツデッキ JSON は `src/content/data/` にあり静的 import（`loadBundledDecks()`）。HTTP fetch 経由に逆戻りしないこと
- LLM 連携（英会話・Self-Improve 系）は OpenAI 互換 API の streaming。設定は Settings 画面経由
- `.env` や認証情報ファイルは読み書き・コミットしない
