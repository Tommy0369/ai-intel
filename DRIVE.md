# NotebookLM × Google Drive 出口

収集の正本は外付けHDD、共有OSは iCloud、**NotebookLM の口だけ Google Drive**。

## 初回セットアップ

```bash
cd ai-intel
npm run notebook:drive:setup
```

1. Google Drive for desktop を入れる（スクリプトが brew 提案）
2. Google アカウントでログインして My Drive が見えるまで待つ
3. `config.json` に `googleDriveNotebookRoot` が書き込まれる

### rclone 代替

```bash
brew install rclone   # 済なら不要
rclone config         # Google Drive を gdrive など名前で作成
```

`config/config.json` に:

```json
"googleDriveRcloneRemote": "gdrive:NotebookLM"
```

## 使い方

```bash
npm run notebook              # 本文付きフォルダ生成（iCloud + HDD）
npm run notebook:drive        # Drive / staging へ公開
npm run notebook -- --drive   # 生成と同時に公開
```

公開レイアウト:

```
NotebookLM/
  inbox/2026-08-09_113000/
    00_README.md
    01_…/CONTEXT.md + PROMPT.md + bodies/
    _skip/…          ← 本文なし
  LATEST/            ← 常に最新
```

## NotebookLM 側

1. Drive の `NotebookLM/LATEST/` を開く
2. 話題フォルダを1つ選ぶ
3. `CONTEXT.md` と `bodies/` をソース追加
4. `PROMPT.md` を貼る
