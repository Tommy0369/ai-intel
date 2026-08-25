# AI Intel（情報収集班）

ローカルで AI 関連情報を収集・分類し、NotebookLM 用の URL 束まで作る CLI です。  
設定の実体は `config/config.json`（非公開）。雛形は `config/config.example.json`。

## 役割分担

| 場所 | 役割 |
|------|------|
| このMac + 外付けHDD | ひたすら集める・分析する |
| iCloud `intel-bridge` | 理解パックを渡す宅配ボックス |
| SNS用Mac | 受け取って文章/画像/動画/音楽へ変換して発信 |

## ビジネス棚

運動 × NLP × AI × 心理 × 飲食 × 事業運営:

| 棚 | 意味 |
|----|------|
| `biz` | 経営・マーケ・集客・起業・個人事業 |
| `trends` | 先のトレンド・新商品・市場信号 |
| `mind` | 心理・行動経済・心・習慣 |
| `body` | 運動・睡眠・栄養・回復 |
| `dining` | 飲食ビジネス・外食・店舗 |

詳しくは [BUSINESS.md](BUSINESS.md)。ソース追加は `config/sources.json`。

画面UI: **情報収集班**ダッシュボード（`ready/DASHBOARD.html` / デスクトップ「とみーの今日」）

スマホ:
- iCloud `intel-bridge/mobile/DASHBOARD.html`（Filesアプリ）
- 同じWi-Fi配信: `npm run phone`

## とみー

デスクトップ **「とみーの今日」** → `TOMMY.md`

## コマンド

```bash
cd ai-intel
npm run ship     # いまの分析を iCloud へ渡す
npm run notebook # 似た話題を束ねて NotebookLM 用まとめフォルダを生成
npm run collect -- --keyword="AI agent" --from=2026-07-01 --to=2026-07-31
                 # キーワード＋期間で狙い撃ち収集
npm run auto     # daily→…→ship まで全部
npm run tommy
npm run desktop
```

## キーワード収集

ダッシュボードの「収集」画面、または CLI からキーワードと期間を指定して集められる。

```bash
npm run collect -- --keyword="Anthropic" --from=2026-07-20 --to=2026-07-24
npm run collect -- --keyword="睡眠,筋トレ" --from=2026-07-01 --json
```

- `--keyword` / `--q` … カンマ区切りで複数可
- `--from` / `--to` … `YYYY-MM-DD`（公開日で絞り込み）
- 既定はキーワード専用ソース（YouTube検索・GitHub・Google News・arXiv・Reddit）
- `--full` を付けると既存 `sources.json` にもキーワードを追加してフル収集

保存された項目には `keyword-hunt` / `kw:…` タグが付く。

## まとめ（NotebookLM / Geminiノートブック）

`npm run notebook` は、収集物を **内容（タイトル＋要約＋タグ）** からローカルで類似度判定し、
**カテゴリ内で細かく**話題を束ねて NotebookLM 用の **話題ごとフォルダ** を生成する（APIキー不要）。

- 出力先（常にここ）: `intel-bridge/notebook/`（HDD控え: `dataRoot/notebook/out/`）
- レイアウト: **フォルダ1つ = 話題1つ = NotebookLM ノートブック1つ** を想定
  ```
  notebook/
    00_INDEX.md
    00_MANIFEST.json
    01_industry_Claudeの料金・コスト/
      CONTEXT.md
      SOURCES.md
      PROMPT.md
      sources.txt
      manifest.json
  ```
- 各フォルダの `CONTEXT.md` 先頭は日本語タイトル見出し
- 共通ファイル:
  - `00_INDEX.md` … 日本語タイトル一覧と使い方
  - `00_MANIFEST.json` … 機械可読メタ
- 全件一括の再生成は `notebook/` を洗い替える。**選択1件**は他フォルダを残す

### 選択した話題だけ生成（推奨）

ダッシュボード「知識の書」で話題を選び → **notebook用のコンテキストを生成**。
このとき **URLの向こう側（記事本文・YouTube字幕）** を取ってから CONTEXT に埋め込む（設定でオフ可）。

CLI なら:

```bash
npm run notebook:one -- --index=2          # enrich付き（既定）
npm run notebook:one -- --index=2 --no-enrich
npm run enrich:cluster -- --index=2        # 本文/字幕だけ先に取る
npm run enrich -- --limit=20               # 直近N件を enrich
```

保存先: `dataRoot/enrich/{id}.json` と `{id}.md`  
`CONTEXT.md` / `SOURCES.md` には論点の細分化に加え、取れた本文・字幕が入る。

個人学習用のローカル保管＋NotebookLM投入を前提。動画ファイル自体は保存しない。

細分化の仕組み:
1. カテゴリ別にクラスタ（分野混在を防ぐ）
2. 類似度しきい値で近い記事だけ束ねる
3. 1話題が大きすぎる場合は類似度を上げて再分割（`clusterMaxSize`）

解析だけ（フォルダ書き出しなし・UI/JSON用）:

```bash
npm run notebook -- --json                 # 書き出し + JSON結果
tsx src/cli.ts notebook:analyze --json     # クラスタ + CONTEXTプレビューをJSONで返す（キャッシュ)
# 例: しきい値やグループ数を指定
tsx src/cli.ts notebook:analyze --json --similarity=0.45 --min=2 --max=60 --maxSize=10
```

`notebook:analyze` は `intel-dashboard`（RPG Dashboard）の「📚 知識の書」から利用されます。

調整は `config/config.json`（未設定なら既定値）:
- `clusterSimilarity`（既定 0.42）… 大きいほど厳しく（似すぎだけ束ねる＝話題が細かく分かれる）
- `clusterMinSize`（既定 2）… グループ採用の最小件数
- `clusterMaxGroups`（既定 60）… 出力フォルダ数の上限
- `clusterMaxSize`（既定 10）… 1話題の上限件数（超えたら再分割）

受け手AIの入口:

`iCloud Drive/99_システム/AI共有OS/AI活動OS/intel-bridge/LATEST/`
