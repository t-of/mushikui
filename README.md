# mushikui — 虫食い算

筆算の空いているマスを埋める虫食い算。かけ算・わり算が中心。

## 🔗 リンク

- 遊ぶ: https://t-of.github.io/mushikui/
- 制作: [T.OF...](https://t-of.github.io/)

## 遊び方

- 「かけ算」「わり算」（おまけで「たし算」「ひき算」）を選び、問題の一覧から 1 つ選ぶ。
- 筆算の空いているマスをタップし、下の数字パッドで数字を入れる（キーボードの数字・矢印・Backspace でも操作できる）。
- 全部埋めたら「答え合わせ」。合っていれば「せいかい！」、違うマスは赤くなる。「答えを見る」で答えを表示できる。
- 「次の問題 →」で次の問題（番号は簡単な順＝空きマスが少ない順）に進む。解いた問題は一覧で色が付く。

## アプリとして入れる（PWA）

- iPhone / iPad: Safari で開き、共有 → 「ホーム画面に追加」
- Android / PC の Chrome・Edge: 画面の「アプリにする」ボタン、またはアドレスバーのインストールボタン

## 開発

ビルド不要。フォルダをそのまま静的サーバで開く。

```sh
python3 -m http.server 8000   # → http://localhost:8000/
```

問題データ（`data/*.json`）は、全探索済みの `puzzles_*.jsonl`（見えている数字が 1 つだけで解が唯一のもの）
から `[grid_problem, grid_solution]` だけを取り出して作ってある。作り直すとき:

```sh
node tools/make-data.mjs [探索データのフォルダ]   # 既定: ~/GitHub/tof/drafts/mushikui/search
```
