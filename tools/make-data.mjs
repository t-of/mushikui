#!/usr/bin/env node
// puzzles_*.jsonl（探索済みの全データ）から、アプリに必要な最小の項目だけを取り出して
// data/<op>.json を作る。各行は [problem, solution] の 2 要素配列（□ を埋める筆算の図）。
// 空いているマスの数（簡単さの目安）で昇順に並べる。
//
// 使い方: node tools/make-data.mjs [探索データのフォルダ=~/GitHub/tof/drafts/mushikui/search]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] || path.join(os.homedir(), 'GitHub/tof/drafts/mushikui/search');
const OUT = path.join(APP_DIR, 'data');

fs.mkdirSync(OUT, { recursive: true });

for (const op of ['add', 'sub', 'mul', 'div']) {
  const file = path.join(SRC, `puzzles_${op}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const puzzles = lines.map((line) => {
    const r = JSON.parse(line);
    return [r.grid_problem, r.grid_solution];
  });
  puzzles.sort((a, b) => (a[0].match(/□/g) || []).length - (b[0].match(/□/g) || []).length);
  fs.writeFileSync(path.join(OUT, `${op}.json`), JSON.stringify(puzzles));
  console.log(op, puzzles.length, '問');
}
