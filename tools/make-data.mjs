#!/usr/bin/env node
// puzzles_*.jsonl（探索済みの全データ、何度でも追記される）から、アプリに必要な最小の項目だけを
// 取り出して data/<op>/ を作り直す。
//
//   data/<op>/manifest.json  区分（虫食い=□ の数）ごとの id の並びと件数だけ（軽い。一覧画面が読む）
//   data/<op>/blanks-<n>.json  その区分の問題（[id, grid_problem, grid_solution] の配列。重い本体）
//
// id は演算と grid_problem から作る短いハッシュ。並び順が変わっても壊れない（mushikui.solved の印に使う）。
// 1 桁 × 何桁 のかけ算（九九レベルで簡単すぎる）と、1 桁で割るわり算は意味が薄いので外す。
//
// 使い方: node tools/make-data.mjs [探索データのフォルダ=~/GitHub/tof/drafts/mushikui/search]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] || path.join(os.homedir(), 'GitHub/tof/drafts/mushikui/search');
const OUT = path.join(APP_DIR, 'data');

function shortId(op, problem) {
  return crypto.createHash('sha1').update(`${op}\n${problem}`).digest('hex').slice(0, 10);
}

// 九九レベル（かけ算で片方が 1 桁、わり算で割る数が 1 桁）は簡単すぎるので外す
function isTrivial(op, r) {
  const len = (name) => r.shape.find((s) => s[0] === name)?.[1];
  if (op === 'mul') return len('A') === 1 || len('B') === 1;
  if (op === 'div') return len('B') === 1;
  return false;
}

for (const op of ['add', 'sub', 'mul', 'div']) {
  const file = path.join(SRC, `puzzles_${op}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const groups = new Map();   // n（□ の数） -> [id, problem, solution][]
  let skipped = 0;
  for (const line of lines) {
    const r = JSON.parse(line);
    if (isTrivial(op, r)) { skipped++; continue; }
    const n = (r.grid_problem.match(/□/g) || []).length;
    const id = shortId(op, r.grid_problem);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push([id, r.grid_problem, r.grid_solution]);
  }
  const ns = [...groups.keys()].sort((a, b) => a - b);

  const dir = path.join(OUT, op);
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ns) {
    fs.writeFileSync(path.join(dir, `blanks-${n}.json`), JSON.stringify(groups.get(n)));
  }
  const manifest = {
    total: ns.reduce((s, n) => s + groups.get(n).length, 0),
    groups: ns.map((n) => ({ n, ids: groups.get(n).map(([id]) => id) })),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  console.log(op, manifest.total, '問（', skipped, '問は 1 桁で単純すぎるため除外）');
}
