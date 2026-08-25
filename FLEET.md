# 収集船隊（Fleet）

更新: 2026-08-10

OS プロセスを増やすのではなく、**論理船（Mission）= アダプタ＋予算枠** で並列収集する。

## コマンド

| コマンド | 内容 |
|----------|------|
| `npm run fleet` / `collect -- --profile=patrol` | 常駐パトロール船隊 |
| `npm run collect -- --keyword="…"` | バースト船隊（既定）＋ `LINKS.html` 更新 |
| `npm run collect -- --keyword="…" --burst` | 明示バースト（キーワード時は既定 ON） |
| `npm run collect -- --max-missions=40 --concurrency=8` | 任務数・同時実行の上限 |
| `npm run fleet:status` | HDD `fleet/state.json` と直近任務 |
| `npm run links` | カタログから `ready/LINKS.html` だけ再生成 |

## 配分（相対枠）

### 常駐（patrol）

| 船 | 割合 |
|----|------|
| youtube | 22% |
| rss | 20% |
| europepmc | 14% |
| arxiv | 12% |
| github | 8% |
| reddit | 6% |
| docs / x | 各 3% |

既定: 最大 200 任務 · 同時 8。

### キーワード・バースト

総枠は常駐の約 2.5〜3 倍（最大 **1000** 任務 · 同時 24）。

| 船 | 割合 |
|----|------|
| youtube | 30% |
| rss（Google News 等） | 25% |
| arxiv + europepmc | 各 10% |
| reddit / github | 各 10% |
| docs / x | 各 2.5% |

同一キーワードを変種クエリに展開し、船を増やして細部まで取る。

## 成果物

- `{dataRoot}/fleet/` … 任務台帳（`state.json` / `missions.jsonl`）
- `{dataRoot}/ready/LINKS.html` … 動画 / Web / 論文 分け一覧
- `{dataRoot}/ready/links/burst-*.html` … バースト時スナップショット
- iCloud `intel-bridge/mobile/LINKS.html`

収集アイテムには `fleet:<ship>` / `fleet-profile:<patrol|burst>` / `link:video|web|paper` タグが付く。
