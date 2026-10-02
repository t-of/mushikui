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
// かけ算・わり算は厳選して載せる（下の dullness）。虫食いの数・見えている数字の数ごとに最低限は足す。
//
// 使い方: node tools/make-data.mjs [探索データのフォルダ=~/GitHub/tof/drafts/mushikui/search]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] || path.join(os.homedir(), 'GitHub/tof/drafts/mushikui/search');
const OUT = path.join(APP_DIR, 'data');

function shortId(op, problem) {
  return crypto.createHash('sha1').update(`${op}\n${problem}`).digest('hex').slice(0, 10);
}

// 厳選: 単純すぎる・同じ形の繰り返しになる問題を外す（かけ算・わり算だけ）
//   - かけられる数・かける数（わり算は割る数・商）の末尾が 0、または 11・999 のように同じ数字だけ
//   - 部分積に同じ数が 2 回以上出る（95×1101 のように同じ行が並ぶ）
//   - 答えの図に出てくる数字が 6 種類未満
// dullness はその当てはまった数（0 なら厳選に入る）。区分を埋めるときは score の高い順に足す。
function dullness(op, r) {
  if (op !== 'mul' && op !== 'div') return 0;
  const val = (name) => r.rows.find((s) => s[0] === name)[1];
  const [x, y] = op === 'mul' ? [val('A'), val('B')] : [val('B'), val('Q')];
  let d = 0;
  if (x % 10 === 0 || y % 10 === 0) d++;
  if (new Set(String(x)).size === 1 || new Set(String(y)).size === 1) d++;
  const ps = r.rows.filter((s) => s[0] === 'P').map((s) => s[1]);
  if (new Set(ps).size < ps.length) d++;
  if (distinctDigits(r) < 6) d++;
  return d;
}
const distinctDigits = (r) => new Set(r.grid_solution.replace(/[^０-９]/g, '')).size;
const score = (op, r) => distinctDigits(r) - 3 * dullness(op, r);

// 九九レベル（かけ算で片方が 1 桁、わり算で割る数が 1 桁）は簡単すぎるので、どこにも入れない
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

// 余り 1〜9 を許すと、形も見えている数字も同じ別解があるか（revealed は 1 つ＝物、2 つ＝配列）。
// 割る数・商も変えて探す（116)11598724 に 113)…+7 などの別解がある）。商の各桁は、引く数 P の行の桁数に合う数字だけ試す
function remainderSplits(r) {
  const shape = JSON.stringify(r.shape);
  const len = (nm) => r.shape.find((s) => s[0] === nm)[1];
  const lq = len('Q'), lb = len('B'), n = len('A'), k = n - lq + 1;
  const pLen = Array(lq).fill(0);   // 商の i 桁目の P の桁数（0 の桁は P がない）
  r.shape.forEach(([nm, L, off]) => { if (nm === 'P') pLen[n - k - off] = L; });
  const width = Math.max(...r.shape.filter((s) => s[0] !== 'B').map((s) => s[1] + s[2]));
  const vs = [r.revealed].flat().map((v) => {
    const L = r.shape[v.row][1];
    return { row: v.row, digit: String(v.digit), i: v.row_name === 'B' ? v.col + L : v.col - (width - r.shape[v.row][2] - L) };
  });
  const vq = vs.filter((v) => v.row === 0), vb = vs.filter((v) => v.row === 1);
  for (let b = 10 ** (lb - 1); b < 10 ** lb; b++) {
    if (!vb.every((v) => String(b)[v.i] === v.digit)) continue;
    const opts = pLen.map((L, i) => (L ? [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => String(b * d).length === L) : [0])
      .filter((d) => vq.every((v) => v.i !== i || String(d) === v.digit)));
    if (opts.some((o) => !o.length)) continue;
    const idx = Array(lq).fill(0);
    for (;;) {
      const q = Number(idx.map((j, i) => opts[i][j]).join(''));
      for (let rem = 1; rem < Math.min(b, 10); rem++) {
        const rows = divRows(b, q, rem);
        if (!rows || JSON.stringify(rows.map(([nm, x, o]) => [nm, String(x).length, o])) !== shape) continue;
        if (vs.every((v) => String(rows[v.row][1])[v.i] === v.digit)) return true;
      }
      let i = lq - 1;
      while (i >= 0 && ++idx[i] === opts[i].length) idx[i--] = 0;
      if (i < 0) break;
    }
  }
  return false;
}

// 余りは図の最後の行（1 マス）
function revealRemainder(problem) {
  const lines = problem.split('\n');
  lines[lines.length - 1] = lines[lines.length - 1].replace('□', '０');
  return lines.join('\n');
}

// 探索データ: 見えている数字 1 つ（puzzles_<op>.jsonl）と 2 つ（out2/<op>_*.jsonl、大きいので 1 行ずつ読む）
async function* records(op) {
  const files = [path.join(SRC, `puzzles_${op}.jsonl`)];
  const dir2 = path.join(SRC, 'out2');
  if (fs.existsSync(dir2)) files.push(...fs.readdirSync(dir2).filter((f) => f.startsWith(`${op}_`) && f.endsWith('.jsonl')).sort().map((f) => path.join(dir2, f)));
  for (const f of files) {
    for await (const line of readline.createInterface({ input: fs.createReadStream(f) })) if (line) yield JSON.parse(line);
  }
}

// 載せる問題: 見えている数字 1 つで厳選に入るもの（同じ答えは最初の 1 問）。そのうえで
// 虫食い（□）の数ごとに PER_BLANKS 問、見えている数字の数ごとに PER_SHOWN 問はあるように、score の高い順に足す。
const PER_BLANKS = 2, PER_SHOWN = 1;
const count = (s, re) => (s.match(re) || []).length;

for (const op of ['add', 'sub', 'mul', 'div']) {
  const picked = new Map();   // grid_solution -> 載せる問題
  const best = { n: new Map(), v: new Map() };   // 区分 -> score の高い順の候補（上位だけ）
  let skipped = 0, revealed = 0;
  const keep = (list, cand, max) => {
    if (list.some((c) => c.solution === cand.solution)) return;
    list.push(cand);
    list.sort((a, b) => b.score - a.score);
    list.length = Math.min(list.length, max + PER_BLANKS + PER_SHOWN);   // 厳選と重なる分の余裕
  };
  for await (const r of records(op)) {
    if (isTrivial(op, r)) { skipped++; continue; }
    const problem = r.grid_problem;
    const cand = {
      id: shortId(op, problem), problem, solution: r.grid_solution, split: false, rec: op === 'div' ? r : null,
      n: count(problem, /□/g), v: count(problem, /[０-９]/g), score: score(op, r),
    };
    if (!Array.isArray(r.revealed) && dullness(op, r) === 0 && !picked.has(cand.solution)) { picked.set(cand.solution, cand); continue; }
    for (const [k, max] of [['n', PER_BLANKS], ['v', PER_SHOWN]]) {
      if (!best[k].has(cand[k])) best[k].set(cand[k], []);
      keep(best[k].get(cand[k]), cand, max);
    }
  }
  for (const [k, max] of [['n', PER_BLANKS], ['v', PER_SHOWN]]) {
    for (const [key, list] of best[k]) {
      let have = [...picked.values()].filter((c) => c[k] === key).length;
      for (const c of list) {
        if (have >= max) break;
        if (picked.has(c.solution)) continue;
        picked.set(c.solution, c);
        have++;
      }
    }
  }

  // 別解の判定は重いので、載せるものだけ。余りの 0 を見せると □ が 1 つ減る
  for (const c of picked.values()) {
    if (!c.rec || !remainderSplits(c.rec)) continue;
    c.split = true;
    c.problem = revealRemainder(c.problem);
    c.n = count(c.problem, /□/g);
    c.v = count(c.problem, /[０-９]/g);
  }

  const groups = new Map();   // n（□ の数） -> [id, problem, solution][]（見えている数字が多い＝やさしい順）
  for (const c of [...picked.values()].sort((a, b) => a.n - b.n || b.v - a.v)) {
    if (c.split) revealed++;
    if (!groups.has(c.n)) groups.set(c.n, []);
    groups.get(c.n).push([c.id, c.problem, c.solution]);
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
  const shown = [...new Set([...picked.values()].map((c) => c.v))].sort((a, b) => a - b);
  console.log(op, manifest.total, '問（', skipped, '問は 1 桁で単純すぎるため除外）', `見えている数字 ${shown.join('・')} 個`, revealed ? `余りの 0 を見せた ${revealed} 問` : '');
}

// ---- n 進数（nbase）: drafts/mushikui/nbase/problems.json（~/GitHub/tof/drafts/mushikui/nbase/gen.py が作った）から変換 ----
// 区分はほかの演算と違い「虫食いの数」ではなく「何進数か」（n）。n 進数は進数ごとに難しさが変わり、
// 虫食いの数で揃えても進数がばらばらで比べにくいため。manifest の形は同じ {total, groups:[{n, ids}]} を流用する。
//
// 数字は 0〜F（半角 ASCII）で表す。筆算の行は A（1つ目の数）・B（2つ目の数、かけ算は常に 1 桁）・C（答え）だけ
// （この問題集はかけ算の部分積を表示しない形だけを使っている）。
const NBASE_SRC = path.join(os.homedir(), 'GitHub/tof/drafts/mushikui/nbase/problems.json');
const ALPHA = '0123456789ABCDEF';

function nbaseRows(shape) {
  if (shape[0] === '+') return [['A', shape[1], 0], ['B', shape[2], 0], ['C', shape[3], 0]];
  const rows = [['A', shape[1], 0], ['B', shape[2], 0]];
  shape[3].forEach((l, j) => rows.push([`P${j}`, l, j]));
  rows.push(['C', shape[4], 0]);
  return rows;
}
function nbaseLines(shape, answer, hintKeys) {
  const rows = nbaseRows(shape);
  const W = Math.max(...rows.map(([, l, s]) => l + s)) + 2;
  const lines = [];
  rows.forEach(([r, l, s]) => {
    let t = '';
    for (let i = l - 1; i >= 0; i--) t += hintKeys.has(`${r}${i}`) ? ALPHA[answer[`${r}${i}`]] : '□';
    const pre = r === 'B' ? (shape[0] === '+' ? '+' : '×') : ' ';
    lines.push(pre + ' '.repeat(W - l - s - 1) + t + ' '.repeat(s));
    if (r === 'B') lines.push('-'.repeat(W));
  });
  return lines;
}

if (fs.existsSync(NBASE_SRC)) {
  const problems = JSON.parse(fs.readFileSync(NBASE_SRC, 'utf8'));
  const groups = new Map();   // n（進数） -> [id, problem, solution][]
  for (const p of problems) {
    const problem = nbaseLines(p.shape, p.answer, new Set(p.shown)).join('\n');
    const solution = nbaseLines(p.shape, p.answer, new Set(Object.keys(p.answer))).join('\n');
    const id = shortId('nbase', problem);
    if (!groups.has(p.n)) groups.set(p.n, []);
    groups.get(p.n).push([id, problem, solution]);
  }
  const ns = [...groups.keys()].sort((a, b) => a - b);
  const dir = path.join(OUT, 'nbase');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ns) fs.writeFileSync(path.join(dir, `blanks-${n}.json`), JSON.stringify(groups.get(n)));
  const manifest = {
    total: ns.reduce((s, n) => s + groups.get(n).length, 0),
    groups: ns.map((n) => ({ n, ids: groups.get(n).map(([id]) => id) })),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  console.log('nbase', manifest.total, '問（', ns.length, '進数ぶん）');
} else {
  console.log('nbase: スキップ（', NBASE_SRC, 'が無い）');
}
