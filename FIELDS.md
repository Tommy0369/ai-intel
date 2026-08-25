# いま集めている分野（正本メモ）

更新: 2026-08-07

## 大きな地図（14棚）

| 棚 | 分野 |
|----|------|
| `llms` | 大規模言語モデル |
| `agents` | AIエージェント・自律実行 |
| `tools` | RAG / SDK / 開発ツール |
| `research` | 論文・研究（arXiv 含む） |
| `industry` | AI企業・製品ニュース |
| `opensource` | GitHub 実装 |
| `multimodal` | 画像・音声・動画AI |
| `safety` | 安全・ガバナンス |
| `biz` | **経営・マーケ・集客・起業・個人事業** |
| `trends` | **先のトレンド・新商品・市場信号** |
| `mind` | **心理・行動経済・心・習慣** |
| `body` | **運動・睡眠・栄養・回復** |
| `dining` | **飲食ビジネス・外食・店舗運営** |
| `reviews` | **システマティックレビュー / メタアナリシス / レビュー論文** |
| `other` | 上記以外 |

事業の核は **biz × trends × mind × body × dining × reviews × AI棚**。

### レビュー棚の見分け

| 種別 | 意味 |
|------|------|
| システマティックレビュー | 決められた基準で論文を網羅収集し、整理・評価する |
| メタアナリシス | 複数研究の結果を統計的に統合し効果量を数値化する |
| レビュー論文 | 先行研究の広い解説（検索・統計が厳密とは限らない） |

まとめ: `npm run reviews` → HDD `reviews/DIGEST.md`

## 収集船隊

収集は均等直列ではなく **Fleet（論理船＋予算枠）** で並列化する。詳細は [`FLEET.md`](./FLEET.md)。

- 常駐: `npm run fleet` / `collect -- --profile=patrol`
- キーワード集中: `npm run collect -- --keyword="…"`（バースト）
- リンク一覧: `npm run links` → `ready/LINKS.html`（動画 / Web / 論文）
- 知識の書 HTML: `npm run notebook:html` → `ready/NOTEBOOK.html`
- 重複監視: `npm run dup:watch` → ウォッチ期間 → `dup:apply`（詳細 [`DUP.md`](./DUP.md)）

アプリ（情報収集班）の基本ルート: **任務 → 収集 → リンク → ノート → 重複**

## 取りに行っているソース種別

- arXiv（AI系 + 神経科学 q-bio.NC + レビュー系キーワード）
- Europe PMC（PubMed系の SR / メタ / レビュー、分野横断）
- RSS（公式ブログ、TechCrunch/Verge、HBR/Entrepreneur、心理・睡眠・筋トレ・飲食・マーケ系など）
- GitHub 検索
- YouTube（タイトル+URLのみ）
- Reddit（しばしばレート制限）
- 開発者 docs ブログ
- X via Nitter（主要アカウント）

詳細URLは `config/sources.json`。
