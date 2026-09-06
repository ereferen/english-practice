# MVP向け学習コンテンツ構成とデータ形式設計

- タスク: t_67a3a85c
- 作成日: 2026-09-06
- 作成者: researcher
- 上位成果物: `docs/research/mvp-requirements-and-competitors.md` (t_25e9889b)
- ステータス: implementer 着手可能 (サンプルデータはスキーマ適合検証済み)

---

## 1. 設計の根拠 (要件レポートとの対応)

| 要件 | 本設計での反映 |
|------|----------------|
| F1 フラッシュカード (P0) | `word` の `term`(表) / `meaning` + `examples`(裏)。1 lesson を1セッションの単位とする (§3) |
| F2 4択クイズ (P0) | `quiz.choices` を **minItems=4, maxItems=4** でスキーマ強制。`quizzes` 省略時は自動生成 (§6) |
| F3 簡易間隔反復 (P0) | 出題単位を `quiz` → 採点キーを `wordId` に固定。SRS状態はコンテンツ外部に置き、`wordId` で紐づく (§7) |
| F4 進捗記録 (P0) | 進捗は `deckId` + `wordId` + 日付で表現できる形を確保 (§7) |
| F6 CSV取り込み (P1) | CSV→`word` の写像規則を定義 (§8)。`wordId` は term 由来で決定論的に生成 |
| F7 音声 (P1) | `audio` 省略時 fallback = Web Speech API で `term` を読み上げ (§5.2) |
| F8 誤答ノート (P1) | 誤答履歴のキーも `wordId`。`tags` はフィルタ拡張のフック |
| 非機能「データ形式=スキーマ文書化済みJSON」 | `content/schema/deck.schema.json` (draft 2020-12) + 検証スクリプト (§9) |
| mikanへの教訓 (英日一対一訳の曖昧さ) | `meaning` に多義を `;` 併記可、例文に文レベル訳 `ja` を持たせる |
| 前提A4 (独自コンテンツ制作なし) | サンプルは**プレースホルダ**と明記。本番は公開リスト→CSV→§8写像で生成 |

## 2. レベル分け

要件レポートのターゲット (A1: 中学生〜社会人初級〜中級) に合わせ、**3レベル**。レベルは「出典単語リストの帯」で定義し、アプリ側で恣意な難易度判定を行わない (MVPで適応難易度はスコープ外)。

| level | 名称 | 基準 (公開リストの帯域) | 例 |
|-------|------|------------------------|-----|
| `beginner` | 初級 | 中学基礎 ~ 英検5級–4級帯 (中学基本850語相当) | breakfast, library |
| `intermediate` | 中級 | 英検3級帯 ~ 中学終了後・日常会話頻出のやや抽象語 | deadline, colleague |
| `advanced` | 上級 | 英検準2級–2級 / TOEIC中級帯以上の論説・学術語 | hypothesis, feasible |

- `deck.level` は enum。デッキは1レベルにのみ属する (進捗フィルタとレベル間移行を単純化)。
- Q1 (試験対策か日常語彙か) が未確定のため、レベルは「試験級」ではなく「語彙帯域」で定義した。級ベースにしたければ `deckId` の付け替えで対応可能 (スキーマ変更不要)。

## 3. 階層構造とセッション単位

```
deck (レベル単位の教材・インポート単位)
 └─ lesson (フラッシュ→クイズの1セッション単位)
      ├─ words[]  (フラッシュカード教材, F1)
      └─ quizzes[] (任意。空なら words から自動生成, F2)
```

- **1 lesson = 5語前後** を推奨 (「1セッション1分以内」の受け入れ基準 F1 に対応: 5語めくり+5問なら体感40–60秒)。
- lesson は連続学習の最小単位。UIの「今日やる」は lesson 1つ、または F3 キューから構成する。
- デッキ間は独立。同じ `wordId` でもデッキが違えば別語扱い (進捗キーは `deckId + "/" + wordId`)。

## 4. スキーマファイル一覧

| パス | 内容 |
|------|------|
| `content/schema/deck.schema.json` | JSON Schema draft 2020-12。1ファイル=1デッキ |
| `content/samples/beginner-core.json` | 初級: 3 lesson / 15語 / 手作りクイズ4問 (全type網羅) |
| `content/samples/intermediate-workplace.json` | 中級: 2 lesson / 10語 / クイズ3問 (1 lesson のみ手作り=混在ケース) |
| `content/samples/advanced-academic.json` | 上級: 1 lesson / 10語 / クイズなし (完全自動生成ケース) |
| `scripts/validate_content.py` | スキーマ+整合性の検証器 (§9) |

3サンプルで「手作りクイズあり/なし」「lesson数1〜3」の組み合わせを網羅し、スキーマの妥当性を実検証した。

## 5. フィールド定義 (要点)

### 5.1 word (必須: wordId, term, reading, meaning, examples)

| フィールド | 型 | 説明 |
|-----------|----|------|
| `wordId` | slug | デッキ内で一意・**不変**。F3/F4/F8 のキー (§7) |
| `term` | string | 見出し語。フラッシュ表側・choose-term/fill-blank の選択肢語 |
| `reading` | string | カタカナ読み (日本語話者向け発音補助) |
| `meaning` | string | 日本語意味。多義は `;` 区切り。裏側表示・choose-meaning 選択肢文 |
| `partOfSpeech` | enum | 任意。品詞 (noun/verb/adjective/adverb/…) |
| `examples` | example[] | 1〜3件。`en` 必須, `ja` 任意 (例1件目が fill-blank 生成の元) |
| `note` | string | 任意。語法・対義語などの補足 |
| `tags` | string[] | 任意。F8 フィルタ拡張フック |
| `audio` | string | 任意。音声相対パス。省略時 TTS fallback (§1 F7行) |

### 5.2 quiz (必須: quizId, type, wordId, prompt, choices[4], answerChoiceId)

`type` は3種:

| type | prompt | choices.text | 用途 |
|------|--------|--------------|------|
| `choose-meaning` | 対象の `term` | 日本語 meaning | 英→日 (mikan準拠の王道) |
| `choose-term` | 対象の `meaning` | 英語 term | 日→英 (産出方向の強化) |
| `fill-blank` | 例文を空所化 (`___`) | 英語 term | 文脈内理解。空所は **3アンダースコア** で表記 |

`explanation` は任意 (不正解時のみ表示推奨)。
**アクセシビリティ要求 (色以外での正誤判別) はUI側の責務**: データは `correct` フラグを持たず、`answerChoiceId` 比較のみ。音・アイコン・テキストの出し分けはコンテンツに持ち込まない。

### 5.3 制約の設計判断

- `additionalProperties: false` を全レベルで有効: 誤ったキー名 (typo: `meanig` 等) を取り込み時点で検出するため。宽松な将来互換より、CSV→JSON変換ツール側のバグを早期に出す方を選ぶ。拡張時はスキーマ版数 (`schemaVersion`) を上げる。
- 選択肢は常時4肢: F2 受け入れ基準の直写し。3肢・5肢を許すと自動生成規則 (§6) とUIが分岐するため。

## 6. クイズ自動生成規則 (implementer 向け)

`lesson.quizzes` が空・省略のとき、アプリは以下で `quiz` を合成する (advanced サンプルがこのケース)。

1. 各 word に対し `choose-meaning` を1問生成。prompt=`term`, 正解text=`meaning`。
2. ダミー3肢は**同一deck内の他語**からランダム選択 (lesson 外から引けるのがポイント: 語彙が偏らず難易度調整が効く)。meaning 重複がある語は除外して選ぶ (§9整合性チェックが重複を弾くので通常は発生しない)。
3. `examples[0].en` に `term` を含む語は `fill-blank` を併せて生成: 該当語を `___` に置換。語形変化 ( exercises 等) で部分一致しない場合は skip。
4. デッキ語数<4 の場合のみ自動生成不可 → 手作りを要求する (検証器もエラー)。
5. 合成quizのIDは実行時採番 (`gen:<lessonId>:<wordId>:<n>`)。SRS状態は `wordId` キーなので採番方式を変えても履歴は失われない。

F3「誤答語+ランダム語で4択出題」は、セッション後の出題選択ロジックであり、本スキーマの責務外 (コンテンツは出題材料だけ提供する)。

## 7. ID安定性と進捗・SRSデータの関係

進捗/復習キューの推奨キー体系 (ADR側のデータモデルに接続):

```
progress:  { "deckId/wordId": { box: 0|1|2, nextReview: date, lastWrong: date, ... } }
session:   { date, deckId, lessonIds[], answered: [{wordId, correct}] }
```

- コンテンツ側が保証すべきは **`wordId` の安定のみ**。F3 の3段階ボックスは `wordId` に紐づくため、例文や意味の編集でIDが変わると履歴が孤児化する。
- 編集規約: `term` を変えたらそれは別語 (`wordId` 新設)。綴みの修正だけなら `wordId` 据え置きでよい。
- デッキ削除時は進捗の cascade 削除をUIで確認する (孤児データは無視して読める形で保持する方が安全)。

## 8. CSV取り込み (F6) → スキーマ写像

ヘッダ行付きUTF-8 CSV。列は固定順:

```csv
term,meaning,example_en,example_ja,note,reading
breakfast,朝食,I eat breakfast at seven.,毎朝7時に朝食を食べます。,,ブレックファスト
```

- 必須は `term` と `meaning` のみ。`reading` 空なら term をそのまま入れる (TTS併用で耐性あり)。`example_*` 空なら `examples:[{"en": term}]` のプレースホルダ1件を自動補完 (例文は1件必須のため。UIでは「例文なし」表示可)。
- `wordId` = term を slug 化 (小文字化・`[^a-z0-9-]` を `-` に・連続`-`圧縮)。衝突時は `-2` … を付番。
- 1ファイル=1デッキとして取り込み、`lesson` は語数で自動分割 (既定5語/lesson)。`level` はインポートUIで選択。
- この写像の逆 (デッキ→CSV エクスポート) も同じ規則なら自明。Anki CSV互換の将来拡張フックになる。

## 9. 検証結果 (受け入れ基準の証明)

`scripts/validate_content.py` (python3 + jsonschema 4.26) で2層検証。

**層1 — JSON Schema 適合**: 構造・型・必須・enum・4肢制約。
**層2 — 整合性** (Schemaで表現できない関係): wordId/quizId/lessonId の_deck内一意性、`quiz.wordId` 参照解決、`answerChoiceId` の choices 内存在、選択肢 text の重複なし、正解textと `wordId` の meaning/term 一致、fill-blank 空所の一意性 (答えが空所以外に出現しない)、meaning 重複検出 (自動生成の曖昧化防止)、deck 語数≥4。

実行結果 (2026-09-06):

```
OK   advanced-academic.json  lessons=1 words=10 quizzes=0
OK   beginner-core.json  lessons=3 words=15 quizzes=4
OK   intermediate-workplace.json  lessons=2 words=10 quizzes=3
```

ネガティブテスト 7/7 検出 (意図的に壊した副本): wordId重複 / answerChoiceId不正 / 3肢 / 参照切れwordId / meaning欠落 / fill-blank答え漏れ / meaning重複。

再実行: `cd /home/tenki/project/english-practice && python3 scripts/validate_content.py`
CI化の足場: 終了コード 0=合格 / 1=失敗。implementer はビルド or pre-commit から呼ぶだけ。

## 10. サンプルcontent の位置づけと出典

- 3デッキ計35語は**スキーマ検証用の自作プレースホルダ** (`source` フィールドに明記済み)。例文は基本的な作例で、ネイティブ監修はしていない → **要検証**: 本番投入前に、前提A4どおり公開単語リスト (パス単級語彙リスト等、出典が明示され再配布条項を確認できるもの) を §8 のCSV経由で差し替えること。
- 上級デッキの `significant`「(統計的に)有意な」など、語義併記が要件レポートの「英日一対一訳の弱点」対策になっている。

## 11. 下流 (implementer / t_0b93e8cd) への申し送り

1. ロード順序: `deck.schema.json` 自体はランタイム不要。アプリはデッキJSONのみ読み、`schemaVersion` 文字列で互換分岐する。
2. §6 の自動生成は「quizzes が空のときだけ」実装すればよく、まずは beginner サンプルの手作りクイズ3typeで画面を作れる (検収は §9 コマンド)。
3. 進捗スキーマ (box/nextReview) は本レポート §7 がデータキーの契約。ADR (t_7e795ff6) の保存モデルと突合すること。
4. CSVインポータは §8 準拠。インポート直後に §9 と同じ整合性チェックを走らせると UX が良い (Anki型の「入れてから壊れに気づく」を回避)。

## 12. 未決事項

- 要件レポート §0 の Q1〜Q3 (試験対策/認証/PWA) は本設計をブロックしないが、Q1 が「試験対策」に振れた場合、レベル定義を級ベースに読み替える (§2)。
- lesson 推奨語数 (5) は体感値。セッション1分基準での実測調整は implementer の受け入れテスト後の検討。
