#!/usr/bin/env node
// puzzles_*.jsonl（探索済みの全データ、何度でも追記される）から、アプリに必要な最小の項目だけを
// 取り出して data/<op>/ を作り直す。
//
//   data/<op>/manifest.json  区分（虫食い=□ の数）ごとの id の並びと件数だけ（軽い。一覧画面が読む）
//   data/<op>/blanks-<n>.json  その区分の問題（[id, grid_problem, grid_solution] の配列。重い本体）
//
// わり算は割り切れるものだけで唯一解を選んでいるが、余りを許すと別解ができる問題が多い
// （同じ割る数・商のまま余りと割られる数の一の位がずれる）。そういう問題は余りのマスに 0 を見せる。
//
// id は演算と grid_problem（余りの 0 を見せる前のもの）から作る短いハッシュ。並び順が変わっても壊れない（mushikui.solved の印に使う）。
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

// 割る数 b・商 q・余り r の筆算の行 [名前, 値, 右からのずれ]。search.py の gen_div と同じ書き方
function divRows(b, q, r) {
  const s = String(b * q + r), n = s.length, qs = String(q), k = n - qs.length + 1;
  const rows = [['Q', q, 0], ['B', b, 0], ['A', b * q + r, 0]];
  let w = Number(s.slice(0, k));
  for (let i = 0; i < qs.length; i++) {
    const qd = Number(qs[i]), off = n - (k + i);
    if (qd) {
      if (i) rows.push(['W', w, off]);
      rows.push(['P', b * qd, off]);
      w -= b * qd;
    }
    if (w < 0 || w >= b) return null;
    if (i < qs.length - 1) w = w * 10 + Number(s[k + i]);
  }
  rows.push(['R', w, 0]);
  return rows;
}

// 余り 1〜9 を許すと、形も見えている数字も同じ別解があるか
function remainderSplits(r) {
  const q = r.rows[0][1], b = r.rows[1][1], v = r.revealed;
  const shape = JSON.stringify(r.shape);
  const L = r.shape[v.row][1];
  const width = Math.max(...r.shape.filter((s) => s[0] !== 'B').map((s) => s[1] + s[2]));
  const i = v.row_name === 'B' ? v.col + L : v.col - (width - r.shape[v.row][2] - L);
  for (let rem = 1; rem < Math.min(b, 10); rem++) {
    const rows = divRows(b, q, rem);
    if (!rows || JSON.stringify(rows.map(([nm, x, o]) => [nm, String(x).length, o])) !== shape) continue;
    if (String(rows[v.row][1])[i] === String(v.digit)) return true;
  }
  return false;
}

// 余りは図の最後の行（1 マス）
function revealRemainder(problem) {
  const lines = problem.split('\n');
  lines[lines.length - 1] = lines[lines.length - 1].replace('□', '０');
  return lines.join('\n');
}

for (const op of ['add', 'sub', 'mul', 'div']) {
  const file = path.join(SRC, `puzzles_${op}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const groups = new Map();   // n（□ の数） -> [id, problem, solution][]
  let skipped = 0, revealed = 0;
  for (const line of lines) {
    const r = JSON.parse(line);
    if (isTrivial(op, r)) { skipped++; continue; }
    const id = shortId(op, r.grid_problem);
    let problem = r.grid_problem;
    if (op === 'div' && remainderSplits(r)) { problem = revealRemainder(problem); revealed++; }
    const n = (problem.match(/□/g) || []).length;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push([id, problem, r.grid_solution]);
  }
  const ns = [...groups.keys()].sort((a, b) => a - b);

  const dir = path.join(OUT, op);
  fs.rmSync(dir, { recursive: true, force: true });   // 区分が変わって使わなくなった blanks-<n>.json を残さない
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ns) {
    fs.writeFileSync(path.join(dir, `blanks-${n}.json`), JSON.stringify(groups.get(n)));
  }
  const manifest = {
    total: ns.reduce((s, n) => s + groups.get(n).length, 0),
    groups: ns.map((n) => ({ n, ids: groups.get(n).map(([id]) => id) })),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  console.log(op, manifest.total, '問（', skipped, '問は 1 桁で単純すぎるため除外）', revealed ? `余りの 0 を見せた ${revealed} 問` : '');
}
