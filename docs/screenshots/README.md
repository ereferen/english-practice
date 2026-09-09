# スクリーンショット撮影手順 (issue #61)

README に掲載するスクリーンショットは **デプロイ先最新版**（`http://192.168.68.52/english/`）
から撮る。開発中画面やビルド前 dist を撮らないこと。

## 共通

- ビューポート: **1280 × 800**（PC 標準。モバイル版は不要）
- 保存形式: PNG 撮り → **WebP quality 82** に変換してコミット（合計 2MB 以内を維持）
- 撮影前に `npm run build` 済みで、配信アセット名（`dist/index.html` の hash）が
  デプロイ先と一致していることを `curl` で確認する

```bash
python3 -c "
from PIL import Image
im = Image.open('shot.png').convert('RGB')
im.save('docs/screenshots/<name>.webp', 'WEBP', quality=82)"
```

## 各画面の作り方（UI 遷移）

| ファイル | 手順 |
|---|---|
| `home.webp` | アプリ起動直後（ホーム）。▸ キャレットが出ないよう **どのボタンにもフォーカスを置かない**（撮る前に `document.activeElement.blur()`） |
| `deck-home.webp` | デッキを選ぶ → 最初のデッキ行（menu-item）でDeckHome。学習率 progress-track（amber）と badge-gold が見える |
| `flash-front.webp` | DeckHome → 「学習・クイズ」→ フラッシュカード表（term 面）。金二重枠+実影+明朝 large term |
| `flash-back.webp` | 同上でカードをクリックして反転（meaning 面・badge-gold 品詞・例文） |
| `quiz-feedback.webp` | フラッシュ 10 枚を「次の語」→「クイズへ」→ 選択肢を 1 つクリック。✓ 緑リング+▸gold / ✗ 赤リングの採点直後状態 |
| `conversation.webp` | 設定に OpenAI 互換エンドポイントを指定（デモ用モック: `/tmp/mock-llm.py` を localhost:8899 で起動）→ 英会話 → メッセージ送信、応答完了を待つ（約 6 秒）。読み上げバッジが消えてから撮影 |
| `settings.webp` | ホーム → 設定。API エンドポイント入力欄に **フォーカスした状態**で撮ると gold フォーカスリングが写る |
| `shortcut-modal.webp` | どの画面でも `?` キーでショートカットヘルプモーダル（modal-overlay の scrim-vignette が見える） |

## モック LLM（会話スクショ用）

```bash
python3 /tmp/mock-llm.py &   # 127.0.0.1:8899/v1、SSE ストリーミング対応
```

設定画面で `http://127.0.0.1:8899/v1` / `mock-gpt` を指定。保存は debounce されているので
エンドポイントとモデル名は **1 つずつ入力して 1 秒以上間隔を空ける**こと
（連続 set だと最後の 1 件しか保存されない）。
