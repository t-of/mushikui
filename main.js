'use strict';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'mushikui.' で始める。
const STORE = 'mushikui.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'mushikui', text: '筆算の空いているマスを埋める虫食い算。かけ算・わり算が中心。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----

// 演算の種類。問題は data/<op>/ 以下にある（tools/make-data.mjs が作る）。
//   manifest.json: 区分（虫食い=□ の数）ごとの id の並びと件数だけ（軽い。一覧画面が読む）
//   blanks-<n>.json: その区分の問題本体 [id, grid_problem, grid_solution][]（問題を開くときだけ読む）
// groupLabel/groupTitle: 一覧の区分（manifest.groups[].n）の見せ方。他の演算は虫食いの数、n 進数は進数そのもの。
// puzzleLabel: 問題画面の上に出す名前。n 進数はその問題の進数を見せる（n は group 側と同じ値）。
const OPS = {
  mul: { label: 'かけ算', groupLabel: (n) => `□${n}`, groupTitle: (n) => `□ ${n} 個`, puzzleLabel: () => 'かけ算' },
  div: { label: 'わり算', groupLabel: (n) => `□${n}`, groupTitle: (n) => `□ ${n} 個`, puzzleLabel: () => 'わり算' },
  add: { label: 'たし算', groupLabel: (n) => `□${n}`, groupTitle: (n) => `□ ${n} 個`, puzzleLabel: () => 'たし算' },
  sub: { label: 'ひき算', groupLabel: (n) => `□${n}`, groupTitle: (n) => `□ ${n} 個`, puzzleLabel: () => 'ひき算' },
  nbase: {
    label: 'n進数', groupLabel: (n) => `${n}進数`, groupTitle: (n) => `${n} 進数`, puzzleLabel: (n) => `${n} 進数`,
    note: 'n 進数の筆算。0〜(n−1) の数字（10 以上は A〜F）を使い、同じ数字は 2 回出てこない。',
  },
};
// n 進数の数字は 0〜F（半角）。10 以上は A〜F で書く
const NBASE_ALPHA = '0123456789ABCDEF';

const manifestCache = {};   // op -> Promise<{ total, groups: [{ n, ids }] }>
function loadManifest(op) {
  if (!manifestCache[op]) manifestCache[op] = fetch(`./data/${op}/manifest.json`).then((r) => r.json());
  return manifestCache[op];
}
const groupCache = {};   // "op:n" -> Promise<[id, problem, solution][]>
function loadGroup(op, n) {
  const key = `${op}:${n}`;
  if (!groupCache[key]) groupCache[key] = fetch(`./data/${op}/blanks-${n}.json`).then((r) => r.json());
  return groupCache[key];
}

// 次の問題（区分をまたいで、見えている並びのまま進む）
function nextPosition(manifest, n, localIndex) {
  const gi = manifest.groups.findIndex((g) => g.n === n);
  const g = manifest.groups[gi];
  if (localIndex + 1 < g.ids.length) return { n, localIndex: localIndex + 1 };
  const ngi = (gi + 1) % manifest.groups.length;
  return { n: manifest.groups[ngi].n, localIndex: 0 };
}
// その問題が全体の何問目か（表示用。1 始まり）
function globalPosition(manifest, n, localIndex) {
  let pos = localIndex;
  for (const g of manifest.groups) { if (g.n === n) break; pos += g.ids.length; }
  return pos + 1;
}

// 解いた問題の印（id だけ。中身は持たない）。問題を減らす・足すと番号がずれるので、
// 番号ではなく問題ごとに安定した id（grid_problem のハッシュ）で覚える。
function getSolved(op) {
  const all = load('solved', {});
  return new Set(all[op] || []);
}
function markSolved(op, id) {
  const all = load('solved', {});
  const set = new Set(all[op] || []);
  set.add(id);
  all[op] = [...set];
  save('solved', all);
}

// ---- 短い音（必須の効果音。設定は置かず、正解・不正解のときだけ鳴らす） ----
let audioCtx = null;
function beep(freqs, dur = 0.12) {
  try {
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); setAudioSession(true); }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = f;
      osc.type = 'sine';
      gain.gain.value = 0.08;
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * dur + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + i * dur);
      osc.stop(t0 + i * dur + dur);
    });
  } catch { /* 音が出せなくても遊べる */ }
}

// ---- 画面の切り替え ----
const stage = document.getElementById('stage');

function showHome() {
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'home';
  wrap.innerHTML = `
    <h2 class="home__title">虫食い算</h2>
    <p class="home__lead">筆算の空いているマスを埋めよう</p>
    <div class="home__main">
      <button class="opBtn opBtn--main" data-op="mul">かけ算</button>
      <button class="opBtn opBtn--main" data-op="div">わり算</button>
    </div>
    <p class="home__sub">おまけ</p>
    <div class="home__extra">
      <button class="opBtn opBtn--sub" data-op="add">たし算</button>
      <button class="opBtn opBtn--sub" data-op="sub">ひき算</button>
      <button class="opBtn opBtn--sub" data-op="nbase">n進数</button>
    </div>
  `;
  stage.appendChild(wrap);
  wrap.querySelectorAll('[data-op]').forEach((btn) => {
    btn.addEventListener('click', () => showList(btn.dataset.op));
  });
}

// 一覧は manifest（id の並びだけ）で描く。問題の中身（重い）は問題を開くときだけ読む。
async function showList(op) {
  stage.innerHTML = '<p class="loading">読み込み中…</p>';
  const manifest = await loadManifest(op);
  const solved = getSolved(op);
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'list';
  const solvedTotal = manifest.groups.reduce((s, g) => s + g.ids.filter((id) => solved.has(id)).length, 0);
  wrap.innerHTML = `
    <div class="list__bar">
      <button class="pill" data-act="back">← もどる</button>
      <h2 class="list__title">${OPS[op].label}</h2>
      <span class="list__total">ぜんぶ ${manifest.total} 問・解いた ${solvedTotal} 問</span>
    </div>
    ${OPS[op].note ? `<p class="list__note">${OPS[op].note}</p>` : ''}
    <div class="list__tabs">
      ${manifest.groups.map((g) => `<button class="tabBtn" data-jump="blanks-${g.n}">${OPS[op].groupLabel(g.n)}</button>`).join('')}
    </div>
    <div class="list__sections"></div>
  `;
  const sections = wrap.querySelector('.list__sections');
  let cum = 0;
  manifest.groups.forEach((g) => {
    const solvedInGroup = g.ids.filter((id) => solved.has(id)).length;
    const section = document.createElement('section');
    section.className = 'listGroup';
    section.id = `blanks-${g.n}`;
    section.innerHTML = `<h3 class="listGroup__title">${OPS[op].groupTitle(g.n)}（${g.ids.length} 問・解いた ${solvedInGroup} 問）</h3>`;
    const grid = document.createElement('div');
    grid.className = 'list__grid';
    g.ids.forEach((id, localIndex) => {
      const b = document.createElement('button');
      b.className = 'numBtn' + (solved.has(id) ? ' numBtn--solved' : '');
      b.textContent = String(cum + localIndex + 1);
      b.addEventListener('click', () => showPuzzle(op, g.n, localIndex));
      grid.appendChild(b);
    });
    cum += g.ids.length;
    section.appendChild(grid);
    sections.appendChild(section);
  });
  stage.appendChild(wrap);
  wrap.querySelector('[data-act="back"]').addEventListener('click', showHome);
  wrap.querySelector('.list__tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    if (!b) return;
    document.getElementById(b.dataset.jump).scrollIntoView({ block: 'start' });
  });
}

// 1 文字ずつのマス。kind: 'edit'（空マス）/ 'fixed'（最初から見えている数字）/ 'deco'（記号・空白・線）
// 普通の演算は全角の数字（０〜９）、n 進数は半角の数字・英字（0〜F）で書かれている（data/ の中身がそう）。
function buildCells(op, problem, solution) {
  const isNbase = op === 'nbase';
  const padChar = isNbase ? ' ' : '　';
  const isDigit = isNbase ? (ch) => NBASE_ALPHA.includes(ch) : (ch) => /[０-９]/.test(ch);
  const toVal = isNbase ? (ch) => NBASE_ALPHA.indexOf(ch) : fullToHalf;
  const pLines = problem.split('\n');
  const sLines = solution.split('\n');
  const cols = Math.max(...pLines.map((l) => l.length));
  const pad = (l) => l + padChar.repeat(cols - l.length);
  const rows = pLines.map((l, r) => {
    const pl = pad(l), sl = pad(sLines[r]);
    return [...pl].map((ch, c) => {
      const sch = sl[c];
      if (ch === '□') return { kind: 'edit', answer: toVal(sch), value: null };
      if (isDigit(ch)) return { kind: 'fixed', answer: toVal(ch) };
      return { kind: 'deco', text: ch };
    });
  });
  return rows;
}
const FULL = '０１２３４５６７８９';
function fullToHalf(ch) { const i = FULL.indexOf(ch); return i < 0 ? null : i; }
function halfToFull(n) { return FULL[n]; }
function toChar(op, n) { return op === 'nbase' ? NBASE_ALPHA[n] : halfToFull(n); }
// 数字パッドに出す値。n 進数は 0〜(n−1)（n はその問題の進数＝showPuzzle に渡した n そのもの）
function padDigits(op, n) { return op === 'nbase' ? Array.from({ length: n }, (_, i) => i) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]; }

let cur = null;   // { op, n, localIndex, id, manifest, pos, total, rows, active: [r,c] | null, done }

async function showPuzzle(op, n, localIndex) {
  stage.innerHTML = '<p class="loading">読み込み中…</p>';
  const [manifest, group] = await Promise.all([loadManifest(op), loadGroup(op, n)]);
  const [id, problem, solution] = group[localIndex];
  cur = {
    op, n, localIndex, id, manifest,
    pos: globalPosition(manifest, n, localIndex), total: manifest.total,
    rows: buildCells(op, problem, solution), active: null, done: false,
  };
  renderPuzzle();
}

function editableList() {
  const out = [];
  cur.rows.forEach((row, r) => row.forEach((cell, c) => { if (cell.kind === 'edit') out.push([r, c]); }));
  return out;
}

function renderPuzzle() {
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'puzzle';
  wrap.innerHTML = `
    <div class="puzzle__bar">
      <button class="pill" data-act="list">← 一覧</button>
      <span class="puzzle__count">${OPS[cur.op].puzzleLabel(cur.n)} ${cur.pos} / ${cur.total}</span>
    </div>
    <div class="grid"></div>
    <p class="status" id="status"></p>
    <div class="actions">
      <button class="pill" data-act="reveal">答えを見る</button>
      <button class="pill pill--main" data-act="check">答え合わせ</button>
      <button class="pill" data-act="next">次の問題 →</button>
    </div>
    <div class="pad" id="pad">
      ${padDigits(cur.op, cur.n).map((n) => `<button class="padBtn" data-digit="${n}">${toChar(cur.op, n)}</button>`).join('')}
      <button class="padBtn padBtn--clear" data-digit="clear">消す</button>
    </div>
  `;
  stage.appendChild(wrap);

  const gridEl = wrap.querySelector('.grid');
  const cols = cur.rows[0].length;
  cur.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const el = document.createElement(cell.kind === 'edit' ? 'button' : 'div');
      el.className = 'cell cell--' + cell.kind;
      el.dataset.r = r; el.dataset.c = c;
      gridEl.appendChild(el);
    });
  });
  gridEl.style.setProperty('--cols', cols);
  fitGrid(gridEl, cols, cur.rows.length);

  paintGrid();

  wrap.querySelector('[data-act="list"]').addEventListener('click', () => showList(cur.op));
  wrap.querySelector('[data-act="next"]').addEventListener('click', () => {
    const { n, localIndex } = nextPosition(cur.manifest, cur.n, cur.localIndex);
    showPuzzle(cur.op, n, localIndex);
  });
  wrap.querySelector('[data-act="reveal"]').addEventListener('click', reveal);
  wrap.querySelector('[data-act="check"]').addEventListener('click', checkAnswer);

  gridEl.addEventListener('click', (e) => {
    const b = e.target.closest('.cell--edit');
    if (!b || cur.done) return;
    cur.active = [Number(b.dataset.r), Number(b.dataset.c)];
    paintGrid();
  });
  wrap.querySelector('#pad').addEventListener('click', (e) => {
    const b = e.target.closest('.padBtn');
    if (!b) return;
    if (b.dataset.digit === 'clear') setActiveValue(null);
    else setActiveValue(Number(b.dataset.digit));
  });
}

// マスの大きさは問題ごとに、画面の幅と高さの両方に収まる最大にする（上限 72px）。
// 他の部品（上のバー・答え合わせなどのボタン・数字パッド）が使っている分は、グリッド以外の
// 高さとして差し引く。resize（回転・ウィンドウ変更）のたびに window が呼び直す（下の 1 回だけの登録）。
function fitGrid(gridEl, cols, rows) {
  const MIN = 18, MAX = 72;
  const availW = gridEl.parentElement.clientWidth;
  const appEl = document.querySelector('.app');
  const otherH = appEl.scrollHeight - (gridEl.offsetHeight || 0);
  const availH = Math.max(100, window.innerHeight - otherH - 8);
  const sizeW = Math.min(MAX, Math.floor(availW / cols));   // 横は必ずこの中に収める（上限はある）
  const sizeH = Math.floor(availH / rows);
  // 高さにも収めると小さくなりすぎるときは、縦のスクロールを許して横基準の大きさのままにする
  const size = sizeH >= MIN ? Math.min(sizeW, sizeH) : sizeW;
  gridEl.style.setProperty('--cell', Math.max(1, size) + 'px');
}
window.addEventListener('resize', () => {
  const gridEl = document.querySelector('.grid');
  if (gridEl && cur) fitGrid(gridEl, cur.rows[0].length, cur.rows.length);
});

function paintGrid() {
  const gridEl = document.querySelector('.grid');
  if (!gridEl) return;
  cur.rows.forEach((row, r) => row.forEach((cell, c) => {
    const el = gridEl.children[r * row.length + c];
    const isActive = cur.active && cur.active[0] === r && cur.active[1] === c;
    el.classList.toggle('cell--active', !!isActive);
    el.classList.remove('cell--ok', 'cell--bad');
    if (cell.kind === 'fixed') el.textContent = toChar(cur.op, cell.answer);
    else if (cell.kind === 'deco') el.textContent = cell.text;
    else el.textContent = cell.value == null ? '' : toChar(cur.op, cell.value);
  }));
}

function setActiveValue(value) {
  if (!cur.active || cur.done) return;
  const [r, c] = cur.active;
  cur.rows[r][c].value = value;
  beep(value == null ? [220] : [440]);
  // 次の空マスへ自動で進む
  const list = editableList();
  const i = list.findIndex(([rr, cc]) => rr === r && cc === c);
  if (i >= 0 && i + 1 < list.length) cur.active = list[i + 1];
  paintGrid();
}

function moveActive(delta) {
  const list = editableList();
  if (list.length === 0) return;
  if (!cur.active) { cur.active = list[0]; paintGrid(); return; }
  const i = list.findIndex(([r, c]) => r === cur.active[0] && c === cur.active[1]);
  const next = ((i + delta) % list.length + list.length) % list.length;
  cur.active = list[next];
  paintGrid();
}

function onKeyDown(e) {
  if (!cur || cur.done || !document.querySelector('.puzzle')) return;
  if (cur.op === 'nbase') {
    const i = NBASE_ALPHA.indexOf(e.key.toUpperCase());
    if (i >= 0 && i < cur.n) { setActiveValue(i); return; }
  } else if (/^[0-9]$/.test(e.key)) { setActiveValue(Number(e.key)); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { setActiveValue(null); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { moveActive(1); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { moveActive(-1); return; }
}
document.addEventListener('keydown', onKeyDown);   // 画面ごとに付け替えない（1 回だけ登録）

function checkAnswer() {
  const list = editableList();
  const unfilled = list.some(([r, c]) => cur.rows[r][c].value == null);
  const status = document.getElementById('status');
  if (unfilled) { status.textContent = 'まだ空いているマスがあるよ'; return; }
  let ok = true;
  const gridEl = document.querySelector('.grid');
  list.forEach(([r, c]) => {
    const cell = cur.rows[r][c];
    const good = cell.value === cell.answer;
    if (!good) ok = false;
    gridEl.children[r * cur.rows[r].length + c].classList.toggle('cell--bad', !good);
    gridEl.children[r * cur.rows[r].length + c].classList.toggle('cell--ok', good);
  });
  if (ok) {
    cur.done = true;
    markSolved(cur.op, cur.id);
    status.textContent = 'せいかい！';
    beep([523, 659, 784]);
  } else {
    status.textContent = '違うマスが赤いよ';
    beep([160, 110]);
  }
}

function reveal() {
  cur.rows.forEach((row) => row.forEach((cell) => { if (cell.kind === 'edit') cell.value = cell.answer; }));
  cur.done = true;
  paintGrid();
  document.getElementById('status').textContent = '答え';
}

showHome();
