# メモリーセレクター

お使いのパソコンに増設できる I-O DATA 製メモリーを案内するツールです。
公開URL（予定）: https://ioplaza02.github.io/memory-selector/ （パスワード: `memory2026`、`app.js` の `SITE_PASSWORD`）

## しくみ

| 入口 | 内容 |
|---|---|
| ① 型番で探す | BTOブランド（GALLERIA・G-Tune など）を検知したら「スペックで探す」へ案内。それ以外は PIO の検索結果を新しいタブで開く。`data/pio-memory.json` にデータがあれば画面内で一致表示（パターン1） |
| ② スペックで探す | 形（DIMM／S.O.DIMM）・世代（DDR4／DDR5）・速度から、同等品 → 上位互換 → 下位互換の順に表示（パターン2）。注記・動作保証の注意文つき |

- 互換判定は `judge.js`。DDR4とDDR5、DIMMとS.O.DIMMは互換なし。速いメモリー → 遅いPC は「上位互換」、遅いメモリー → 速いPC は「下位互換」
- DDR3 以前は対象外（注釈表示）

## ファイル

```
index.html / style.css / app.js / judge.js
data/products.json      … 商品データ（自動更新）
data/pio-memory.json    … PIO対応データの受け口（現在は空）
scripts/scrape.mjs      … 商品データ取得（www.iodata.jp のメモリー一覧・シリーズページのみ）
scripts/health-check.mjs… 健全性チェック
scripts/test-parser.mjs … 解析部分のテスト
.github/workflows/scrape.yml … 毎日3:00（日本時間）に自動更新
```

## 自動更新

毎日 3:00 にデータを取得 → 健全性チェック（件数が1割以上減っていないか・4種類どれかが0件になっていないか）。
問題なければそのまま本番反映、異常時は PR と Issue を作ってジョブを失敗させます。

## PIO について

pio.iodata.jp は robots.txt で自動取得が拒否されているため、スクレイピングしていません。
社内からメモリー対応データ（CSV等）を提供してもらえた場合は、`data/pio-memory.json` を次の形で作れば画面内で「これが使える組み合わせです」と表示されます。

```json
{ "updatedAt": "2026-10-09", "entries": [
  { "maker": "Dynabook", "model": "MJ54/HU", "bodyType": "ノート", "release": 2024, "skus": ["SD5R5600-16G/GQ"] }
]}
```
