---
version: alpha
name: Nightfall Ledger
description: Octopath Traveler HD-2D を Web UI に翻訳したデザインシステム。深い紺〜黒のナイトシーンに、金/アンバーのアクセントと装飾的な枠線、明朝セリフのタイポグラフィ。
colors:
  primary: "#e8c56b"
  bg-night: "#070b14"
  bg-scene: "#0b1120"
  surface-panel: "#131c30"
  surface-raised: "#1b2740"
  surface-inset: "#0e1626"
  border-gold: "#c9a227"
  border-gold-dim: "#8a7233"
  border-hairline: "#31415f"
  text-parchment: "#f5ead1"
  text-body: "#d7deeb"
  text-muted: "#9aa7bf"
  accent-gold: "#e8c56b"
  accent-amber: "#d9963f"
  caret-blue: "#7cc7ff"
  status-success: "#6fdd9a"
  status-danger: "#ff8f8f"
  scrim-vignette: "rgba(3, 6, 14, 0.72)"
typography:
  display-lv1:
    fontFamily: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif'
    fontSize: 2.5rem
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.04em"
  display-lv2:
    fontFamily: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif'
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.03em"
  menu-heading:
    fontFamily: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif'
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
  body-md:
    fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0.01em"
  rune-caption:
    fontFamily: '"DotGothic16", "MS PGothic", monospace'
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.12em"
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 20px
components:
  panel-frame:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  menu-item:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-body}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
  menu-item-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.accent-gold}"
  caret-menu-item:
    textColor: "{colors.accent-gold}"
    typography: "{typography.menu-heading}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg-scene}"
    typography: "{typography.menu-heading}"
    rounded: "{rounded.sm}"
    padding: 12px
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-parchment}"
    rounded: "{rounded.sm}"
    padding: 12px
  button-danger:
    backgroundColor: "{colors.status-danger}"
    textColor: "{colors.bg-night}"
    rounded: "{rounded.sm}"
    padding: 12px
  text-input:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-parchment}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  badge-gold:
    backgroundColor: "{colors.bg-night}"
    textColor: "{colors.accent-gold}"
    typography: "{typography.rune-caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  result-correct:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.status-success}"
  result-incorrect:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.status-danger}"
  progress-track:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.accent-amber}"
    rounded: "{rounded.none}"
    height: 6px
  menu-item-disabled:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-muted}"
  modal-overlay:
    backgroundColor: "{colors.scrim-vignette}"
  frame-edge-outer:
    backgroundColor: "{colors.border-gold}"
    rounded: "{rounded.none}"
    height: 1px
  frame-edge-inner:
    backgroundColor: "{colors.border-gold-dim}"
    height: 1px
  divider-hairline:
    backgroundColor: "{colors.border-hairline}"
    height: 1px
  link-info:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.caret-blue}"
---

## Overview

「ナイトシーンに開かれた冒険日誌（リドル・ブック）」が基本像。オクトパス トラベラーの HD-2D メニューが持つ、**暗い舞台・金の縁取り・光る文字・▸ キャレット**の四要素を Web UI に持ち込む。ゲームの偽りなき装飾を模倣するのではなく、装飾は「注目すべき場所を示す機能」として使う——金の枠はパネルの境界、キャレットは選択中項目、発光はホバー/フォーカスの合図。

画面は常に暗い地（`bg-night` → `bg-scene` のグラデーション + vignette）を先に置き、その上に浮くパネル（`surface-panel`）で情報を与える。テキストは和欧混植を前提に、見出しは明朝セリフ、本文はゴシック、ラベル/数値はドットフォントの 3 層。

## Colors

- **bg-night (#070b14):** 最外周。vignette の端色。コンテンツには使わない。
- **bg-scene (#0b1120):** 画面全体の地。既存 `--color-bg` の後継（より深い紺へ）。
- **surface-panel (#131c30) / surface-raised (#1b2740) / surface-inset (#0e1626):** パネル地、ホバー/選択の浮上り、入力欄の凹み。3 段の明度が「額縁の厚み」を作る。
- **border-gold (#c9a227):** 二重枠の外側・見出し下線・アクティブ境界。UI で唯一「装飾を許される」色。
- **border-gold-dim (#8a7233):** 二重枠の内側。外枠より一段落として「金だけど主役ではない」強さ。
- **border-hairline (#31415f):** 通常時の細区切り。金を使わない場所の境界はこれ。
- **text-parchment (#f5ead1):** 羊皮紙の文字色。見出し・強調文。
- **text-body (#d7deeb):** 本文の既定色。
- **text-muted (#9aa7bf):** 補足・無効・セカンダリ情報。
- **accent-gold (#e8c56b):** インタラクションの駆動色（キャレット、ホバー文字、主要数値）。`border-gold` より明るく、地に対して発光して見える。
- **accent-amber (#d9963f):** gold の補助。プログレス・ハイスコア系のみ。
- **caret-blue (#7cc7ff):** 情報的アクセント（リンク、読み上げ操作など「金ではない選択」）。既存 sky 系からの移行先。
- **status-success (#6fdd9a) / status-danger (#ff8f8f):** 正誤・成否。暗地でも沈まない彩度に調整済み。#10 の「色に依存しない正誤表現」方針は維持（記号 ✓ / ✕ と併記）。
- **scrim-vignette:** モーダルオーバーレイと vignette 用の半透明。

コントラストは WCAG AA（本文 4.5:1、見出し 3:1）を lint で検証する。見出し・キャレットの gold は `text-parchment` と差し替えて小さく使わない。

## Typography

- 見出し 2 階層 + `menu-heading` は明朝セリフ（Shippori Mincho、フォールバックに Hiragino Mincho / Yu Mincho / Georgia）。字送り+0.03〜0.06em で「刻まれた碑文」感を出す。
- 本文はゴシック（Noto Sans JP 系）。行間は 1.7、学習テキストの英文も同じ流れで読ませる。
- `rune-caption`（DotGothic16 等のドットフォント）はラベル、数値、キーヒント（`?` ヘルプ、ショートカット表示）の専用。本文に混ぜない。
- 英会話の相手役セリフなど「ゲームの NPC 話しかけ」を模す場面では `menu-heading` + キャレットを許容するが、乱用禁止。
- フォントは Google Fonts から遅延ロード（`display=swap`）。ロード失敗時のフォールバックを上記チェーンで保証する。

## Layout

- 1 カラム中央寄せの `--max-width` 構造は維持し、ブレークポイントは #1/#6/#7 で導入済みの 768 / 1024 / 1440px に準拠。
- 余白は spacing スケール（4 / 8 / 16 / 24 / 32）から取り、パネル内側は `lg`（24px）、パネル間は `md`。
- パネルは「額縁」: 外枠 `border-gold` 1px + 4px 離して内枠 `border-gold-dim` 1px の二重線。通常時の区切りは `border-hairline`。
- ダッシュボードのカードグリッドは 3 段構成のまま、カードを mini panel-frame として扱う。

## Elevation & Depth

影は「黒のぼかし」ではなく**光で表現**する。

- 静止パネル: インナーグロー `inset 0 0 24px rgba(201, 162, 39, 0.06)` のみ。
- ホバー/選択: `0 0 12px rgba(232, 197, 107, 0.25)` の外発光 + 地が `surface-raised` に浮く。
- モーダル/オーバーレイ: `scrim-vignette` + vignette（radial-gradient で四隅を `bg-night` へ落とす）。
- 最前面のフラッシュカードだけ実影（`0 16px 48px rgba(0,0,0,0.5)`）を許す。

## Shapes

- 角丸は `sm`(4px) 基準。ゲーム UI の「角の通った枠」を保つため lg(12px) 以上は使わない。
- 角のオーナメント（隅金具）は CSS 疑似要素で表現できる範囲留め、SVG 装飾の追加は #8 移行後に検討。
- 区切り線は 1px ハairline または gold の細線。実線 2px 以上の太い線は使わない。

## Components

- `panel-frame` は全セクションの器。見出しは `menu-heading` + 下辺に `border-gold-dim` の 1px。
- `menu-item` はリスト選択項目。キーボードフォーカス/ホバーで `menu-item-hover` になり、選択中は先頭に ▸（`caret-menu-item`）が入る。キャレットは gold、移動は transform で 100ms 以内。
- `button-primary` は 1 画面に 1 つまで（「学習を開始する」等）。金の地に `bg-scene` の黒文字で最大コントラスト。
- `button-secondary` は通常の操作、`button-danger` は削除系のみ。
- `text-input` は `surface-inset` の凹み + `border-hairline`。フォーカス時のみ `border-gold`。
- `badge-gold` はバッジ・件数・タグ（Self-Improve 提案数など）。`rune-caption` を使う。
- 正誤表示は `status-success`/`status-danger` + ✓/✕ の併記（色覚依存を避ける既存方針を維持）。

## Do's and Don'ts

Do:

- 金（`border-gold` / `accent-gold`)は「注目のしるし」として節約する。1 画面の金の比率は枠線+見出し+主操作に収める。
- テクスチャ（紙・布・星屑）は opacity ≤ 0.05 のオーバーレイで、テキストの対比を下げないこと。
- アニメーションは発光の淡いフェード（100–200ms）中心。`prefers-reduced-motion` で粒子・発光演出を停止する。
- 新規スタイルは #8 の CSS Modules + `global.css` のデザイントークン（`--color-*`）経由で参照し、hex をコンポーネント直書きしない。

Don't:

- 本文色に `text-muted` を使わない（補足専用）。
- 二重枠・隅金具・発光を全部同時に一つの箱に盛らない（装飾は 2 つまで）。
- `accent-gold` を本文テキストにしない（小さい文字で滲む）。
- 角丸 lg 以上の「スマホアプリ風」カード、白背景のテーブル、Material 風の影を持ち込まない。
- インライン style props に新規スタイルを書かない（#8 で CSS Modules へ移行する。ここでは仕様側の話が正しい）。
