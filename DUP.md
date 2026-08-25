# 重複監視（Dup Watch）

更新: 2026-08-10

集めすぎたあとに **かぶりを見つける期間** を置く。鮮度精査（`vet`）とは別レーン。

## 流れ

```text
収集 → 重複スキャン（dup:watch）→ ウォッチ期間 → 隔離（dup:apply）→ LINKS再生成
```

ウォッチ中は削除せず `vet/dup/HOLDING.md` に待機。期間は `config.dupWatchHours`（既定24h）。

## 検出レイヤ

| 種別 | 内容 |
|------|------|
| same-url | 正規化URL完全一致 |
| near-url | www / 追跡パラメータ差を潰した指紋一致 |
| youtube-id | 同一動画の別URL |
| same-title | 正規化タイトル一致 |
| similar-title | カテゴリ内 Jaccard ≥ 0.9 |

残す側は出典信頼・直リンク・新しさでスコア。

## コマンド

```bash
npm run dup:watch              # 検出のみ（ウォッチ開始）
npm run dup:watch -- --apply   # 検出して即隔離
npm run dup:apply              # 期間明けを隔離
npm run dup:apply -- --now     # 期間無視で隔離
npm run dup:status
```

## 成果物

- `vet/dup/REPORT.md` … 人間向けレポート
- `vet/dup/HOLDING.md` … ウォッチ中一覧
- `vet/dup/ledger.jsonl` … 機械台帳
- `vet/dup/quarantine/<group>/` … 隔離された md
