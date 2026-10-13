# 根拠となる発言・文書（引用はここにある言葉だけを使う）

確度の表記：
- **原文**＝GitHub 上の本人・Receptron の文書を直接確認したもの。
- **要約経由**＝調査環境の制限で原文ページを開けず、検索エンジンの要約で内容を確認したもの。言い回しは原文と異なる可能性がある。引用するときは「趣旨」として扱う。

調査基準日：2026-10-08。詳しい経歴と全出典は `reports/nakajima-satoshi.html` を参照。

## 1. ロケットスタート
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 「スピードは最強の武器である」（書名の副題） | 書誌は要約経由 | 『なぜ、あなたの仕事は終わらないのか』文響社 2016 |
| 期間の最初の2割で8割を終える。2割時点で届かなければスケジュールを引き直す | 要約経由 | 同書の目次・紹介文、https://toyokeizai.net/articles/-/122677 |
| 締め切りを守れていたエンジニアは百人に一人もいなかった。ラストスパートでは帳尻が合わない | 要約経由 | https://toyokeizai.net/articles/-/122677 |
| 「一度も納期に遅れたことがない男」（出版社の著者紹介） | 要約経由 | 同書 文庫版（2026） |

## 2. プロトタイプ・ファースト
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| プロトタイプ＝バグを多少見逃してでも大枠を先に形にしたもの。最初から細部を磨き込まない | 要約経由 | https://toyokeizai.net/articles/-/122089 |
| 英語の議論に入れなかった時期に作った「なんちゃって次世代OS」の試作が評判になり、Windows 95 の土台になった | 要約経由 | https://www.sbbit.jp/article/cont1/35551 |
| 「移籍後、僕がカイロチームで育んできたアイデアを Windows 3.1 に盛り込もうという話になり、それが後に Windows 95 になったわけです。」 | 要約経由 | 同上 |

## 3. 自分で作る／AI 時代の役割
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 日米 IT 業界の差を分けたのは、技術者が自らコードを書くかどうか | 要約経由 | https://www.sbbit.jp/article/cont1/104480 |
| 「なぜ日本政府が作るソフトウェアは使えないモノばかりなのか?」「IT調達制度そのものが問題」（記事タイトル） | 要約経由 | https://atmarkit.itmedia.co.jp/ait/articles/2010/13/news002.html |
| プログラミングの9割以上を AI に任せるようになった。仕事は「書くこと」から「AI に何を作るか指示すること」へ | 要約経由 | https://www.sbbit.jp/article/sp/184864 |
| 反論：多重下請けの原因は文化ではなく、正社員を解雇できない雇用慣行だ（アゴラ） | 要約経由 | https://agora-web.jp/archives/260819024825.html |

## 4. 小さなチーム
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| マイクロソフト退社の理由：自ら立ち上げた構想が社内政治で変質したこと、『イノベーションのジレンマ』、「小さなチームでイノベーションを」という提案が通らなかったこと | 要約経由 | https://note.com/lifeisbeautiful/n/n97a1035a9f32 |
| トップが現場の細部に口を出しすぎると、上の意向をうかがう人が評価される組織になる | 要約経由 | https://news.livedoor.com/article/detail/29436915/ |

## 5. ハーネス思考（AI 設計）
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 「買うことはできない — 育てることしかできないのです。」 | 原文 | https://github.com/receptron/mulmoclaude/blob/main/README.ja.md |
| 「アシスタントの実体は AI モデルではありません — モデルはエンジンにすぎません。」 | 原文 | 同上 |
| 「the workspace is the database; files are the source of truth; Claude is the intelligent interface」「the workspace is the agent」 | 原文 | https://github.com/receptron/mulmoclaude/blob/main/docs/papers/workspace-is-the-agent.md |
| ハーネスがモデルより重要。DSL は力を手放すからこそ最強のハーネス | 原文（要旨） | https://github.com/receptron/mulmoclaude/blob/main/docs/papers/dsl-as-harness.md |
| 「Excel に Copilot が付く形は主従が逆で、LLM が前面にある形が良い」 | 原文 | https://github.com/ystknsh/zenn-content/blob/main/articles/2026-06-14-bootcamp-4th-nakajima-mulmoclaude.md |
| async/await では複雑で動的な AI アプリはスケールしない。データフロー・プログラミングが代替になる | 原文（要旨） | GraphAI 論文「Leveraging Data Flow Programming for Scalable and Efficient AI Systems in Distributed Environments」（receptron/graphai） |

## 6. メタトレンド・未来の読み方
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 「正解なき社会」。AI の影響は「桁違い」。制度や価値観が時代に追いつかないことの方が深刻 | 要約経由 | https://realsound.jp/book/2026/03/post-2342567.html |
| 「価値観はテクノロジーによって容易に変化させられる」（記事見出し） | 要約経由 | 同上 |
| AI 時代の最も深刻な社会問題は、若手を育てられなくなること | 要約経由 | https://toyokeizai.net/articles/-/934839 |
| メタトレンド投資：10倍株・100倍株の見つけ方。「経営者の熱量」を見る | 要約経由 | 『メタトレンド投資』徳間書店 2025、https://president.jp/articles/print/92282 |

## 7. おもてなし
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 『おもてなしの経営学 アップルがソニーを超えた理由』。おもてなしの精神を具体化できる会社づくり | 要約経由 | アスキー新書 2008、https://ascii.jp/elem/000/000/108/108279/ |

## 8. アウトプット駆動学習
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 「アウトプットこそ一番の勉強法」 | 要約経由 | https://logmi.jp/main/technology/320286 |
| エンジニア向きの資質は、未知の開発言語の勉強を楽しめるかどうか | 要約経由 | https://type.jp/et/feature/26867/ |
| 『結局、人生はアウトプットで決まる』（実務教育出版 2018） | 要約経由 | 書誌 |

## 9. なんちゃって検出
| 言葉・趣旨 | 確度 | 出典 |
|---|---|---|
| 詐欺まがいの「なんちゃって Web3」。特定事業者に頼らず動き続けることが Web3 の強みで、運営会社が倒れると価値が消える設計は名ばかり | 要約経由 | https://diamond.jp/articles/-/319408 |
| 「『ねずみ講以外の何ものでもない』と警告も。いま注目の『NFT』とは？」（記事見出し） | 要約経由 | まぐまぐニュース 491896 |

## 使わないもの
- 「界王拳」「朝4時起床」「好きなものを作れ」「ファーストペンギン」「AI に仕事を奪われるのではなく AI を使う人に奪われる」は、本人の発言として確認できなかった。引用しない。
