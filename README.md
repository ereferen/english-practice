# English Practice

ローカルに学習・復習・進捗を保存する英語学習アプリ MVP です。

## 技術スタック

- React 19 + TypeScript + Vite 8
- IndexedDB (Dexie.js) で永続化
- ルーティングライブラリは使用せず、useReducer によるステートマシンで画面遷移

## セットアップ

Node.js v22.12 以上が必要です。

```bash
npm install
```

## 起動

### 開発サーバー

```bash
npm run dev
```

### ビルド

```bash
npm run build
```

### 本番プレビュー

```bash
npm run build
npm run preview
```

## 検証

```bash
npm run test      # ユニットテスト
npm run lint      # ESLint
npm run format    # Prettier
```

## 学習フロー

1. ホーム画面で「デッキを選ぶ」を選択
2. デッキを選択して「開く」
3. レッスンを選択して「学習・クイズ」
4. フラッシュカードで語を確認後、クイズに回答
5. 結果画面で正答率と誤答語を確認

## コンテンツ検証

サンプルデッキ JSON の検証は以下のコマンドで実行できます。

```bash
python3 scripts/validate_content.py
```

## データのエクスポート / インポート

設定画面から IndexedDB のデータを JSON でダウンロード・復元できます。
