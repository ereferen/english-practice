# Sprite Production Pipeline (issue #85)

オクトラのリスペクトとして、夜景に「歩いて暮らす住人」を置くレイヤー。
本番素材はユーザー側の画像生成AIで作り、こちら側は **受け取り検証スクリプト**
(`scripts/validate-sprite.py`) で合否を判定する。

## 生成プロンプト（固定）

> Octopath Traveler style traveler sprite, wide-brim hat, navy coat, gold
> lantern, 24x24px, limited palette (#0b1120 #131c30 #1b2740 #31415f
> #8a7233 #e8c56b #f5ead1), transparent background, 4-frame walk cycle
> sprite sheet, no anti-aliasing

- 出力は **横並び4帧の sprite sheet**（1 frame 24x24 → 合計 96x24 px RGBA PNG）
- 反転・スケールで済むよう、進行方向は右向きで統一

## 実パレット（traveler v2 / PIL手描きPoCで確定した許容色）

生成AIの出力が厳密に7色へ収まらない実績があるため、検証スクリプトの
許容パレットは PoC で採用した10色（+ 完全透過）を基準にする。
生成素材がこのパレットに収まらない場合は **許容色を拡張するのではなく**
プロンプト側で再生成させること（夜景のトーンが崩れるため）。

| HEX       | 用途 |
|-----------|------|
| #050810   | アウトライン（最暗部） |
| #141d31   | コート中間影 |
| #1b2740   | コート本体 |
| #2a3b5c   | コート受光面 |
| #31415f   | リムライト（青） |
| #5b5148   | ブーツ・革物 |
| #8a7233   | ランタン金具・縁 |
| #e8c56b   | ランタンの灯り |
| #f5ead1   | 肌・ハイライト |
| #fff2c4   | 灯りのコア |

## 検証ルール（scripts/validate-sprite.py）

1. サイズ = `--width * --frames` x `--height`（既定 24x24 x 4 = 96x24）
2. 非透過画素の色は許容パレットの **完全一致**（アンチエイリアス禁止）
3. alpha 値は 0 または 255 のみ（半透明＝エッジのぼけは弾く）
4. 各フレームに描画画素が一定数以上存在（空フレームの混入防止）

FAIL 例（違反PNGで確認済み）:
- 1ドットでもパレット外色 → `palette violation`
- 96x25 などサイズ違い → `size mismatch`
- alpha=128 の混在 → `anti-aliased alpha`

## 実装（CSS側・済み）

- `src/components/StageDressing.tsx` / `.module.css`
- `steps(4)` 0.64s ループ（160ms/帧）、`image-rendering: pixelated`
- `prefers-reduced-motion: reduce` では帧0で静止
- ≥1024px の gutters のみ表示、`aria-hidden` / `pointer-events: none`

## 会話画面 NPC 口パタパタ（2帧 bust / PoC素材で実装済み）

- シート: `src/assets/npc-talk-sheet.png`（2帧 @ 24x24 = 48x24、口閉じ/口開けの差分のみ）
- PoC素材は `scripts/make-npc-talk-sprite.py` で生成（同じ10色パレット契約、
  `validate-sprite.py --frames 2` PASS 確認済み）。生成AI本番素材が届いたら
  同検証を通してから差し替え。
- 生成プロンプト案: 「Octopath Traveler style NPC bust sprite, kind face,
  shoulder-up only, eyes open, 2-frame talking cycle differing ONLY in the
  mouth (closed line / open 4x2 cavity), 24x24px, limited palette as above,
  transparent background, no anti-aliasing」
- 実装: `src/components/TalkSprite.tsx` / `.module.css` — 読み上げ中
  （`speakingId` 一致）の assistant 气泡の左に `steps(2)` 0.32s で配置、
  reduced-motion では口閉じ帧で静止。

## 残作業（このIssueを開いたままにする理由）

- [x] 会話画面 NPC 気泡横の2帧「口パタパタ」スプライト（PoC素材で実装）
- [ ] 生成素材の受け取り → validate-sprite.py 通し → `src/assets/traveler-sheet.png` / `npc-talk-sheet.png` 差し替え
  - 受け取りは `scripts/import-sprite.py` で行う（グリッド崩れのリサイズ→NEAREST、
    alpha二値化、パレット最近隣量子化→同スクリプト内の validate で PASS 時のみ書き込み、
    FAIL 時はバックアップへロールバック。坏素材でデプロイ先が壊れることはない）。
    例: `python3 scripts/import-sprite.py incoming.png src/assets/traveler-sheet.png`
    / `... src/assets/npc-talk-sheet.png --frames 2`
