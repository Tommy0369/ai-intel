# ビジネス棚（biz / trends / mind / body / dining）

とみーの軸: **運動 × NLP（心の技法）× AI × 心理 × 飲食 × 事業運営** を掛け合わせた事業。

ビジネス棚は、既存のAI棚（agents / llms / …）と**同じシステム**で集めて、同じように因数分解 → iCloud `intel-bridge` へ渡す。

| 棚 | 集めるもの | SNSでの使い方 |
|----|------------|----------------|
| `biz` | 経営・マーケ・集客・起業・個人事業 | 事業の型・打ち手として流す |
| `trends` | これから来る商品・ガジェット・市場信号 | 「いま早い話」として流す |
| `mind` | 心理学・行動経済・習慣・説得・NLP的知見 | 行動が変わる理由を噛み砕く |
| `body` | 運動・トレーニング・栄養・睡眠・回復 | 今日試せるプロトコルにする |
| `dining` | 飲食ビジネス・外食・店舗運営・フードサービス | 店舗・メニュー・運営のネタにする |

## 掛け合わせの読み方

受け手AI / とみーは、単棚だけでなく横断で見てよい:

- `biz` × `dining` → 店舗の集客・価格・ブランド設計
- `biz` × `mind` → 行動科学を使ったマーケ
- `biz` × AI棚 → 事業オペレーション×AI
- `body` × `mind` → 続くトレーニング設計
- `mind` × `agents`/`llms` → 心の変化を助けるAI体験
- `trends` × `body` → ヘルスケア新製品の先読み発信
- `dining` × `mind` → 来店・リピートの行動設計
- `dining` × `trends` → メニュー／業態の先読み発信
- `dining` × AI棚 → 店舗オペレーション×AI
- ビジネス棚 × AI棚 → 事業のネタ帳

## コマンド

```bash
cd ~/Projects/comic-shelf/ai-intel
npm run collect   # 新ソース込みで収集
npm run ship      # 理解パックを iCloud へ
npm run auto      # 全日次
```

設定の追加・削除は `config/sources.json`。
