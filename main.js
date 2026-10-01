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

// 演算の種類。file は data/ 以下の json（[problem, solution] の配列、簡単な順に並んでいる）。
const OPS = {
  mul: { label: 'かけ算', file: './data/mul.json' },
  div: { label: 'わり算', file: './data/div.json' },
  add: { label: 'たし算', file: './data/add.json' },
  sub: { label: 'ひき算', file: './data/sub.json' },
};

const dataCache = {};   // op -> Promise<[problem, solution][]>
function loadPuzzles(op) {
  if (!dataCache[op]) {
    dataCache[op] = fetch(OPS[op].file).then((r) => r.json());
  }
  return dataCache[op];
}

// 解いた問題の番号（印だけ。中身は持たない）
function getSolved(op) {
  const all = load('solved', {});
  return new Set(all[op] || []);
}
function markSolved(op, index) {
  const all = load('solved', {});
  const set = new Set(all[op] || []);
  set.add(index);
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
    </div>
  `;
  stage.appendChild(wrap);
  wrap.querySelectorAll('[data-op]').forEach((btn) => {
    btn.addEventListener('click', () => showList(btn.dataset.op));
  });
}

// 虫食い（□）の数で難易度の区分に分ける。data/*.json は □ の数が少ない順に並んでいるので、
// 同じ数のものは配列の中で連続している（区分ごとに範囲が切れる）。
function groupByBlanks(puzzles) {
  const groups = [];
  puzzles.forEach(([problem], i) => {
    const n = (problem.match(/□/g) || []).length;
    const last = groups[groups.length - 1];
    if (last && last.n === n) last.indexes.push(i);
    else groups.push({ n, indexes: [i] });
  });
  return groups;
}

async function showList(op) {
  stage.innerHTML = '<p class="loading">読み込み中…</p>';
  const puzzles = await loadPuzzles(op);
  const solved = getSolved(op);
  const groups = groupByBlanks(puzzles);
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'list';
  wrap.innerHTML = `
    <div class="list__bar">
      <button class="pill" data-act="back">← もどる</button>
      <h2 class="list__title">${OPS[op].label}</h2>
      <span class="list__total">ぜんぶ ${puzzles.length} 問・解いた ${solved.size} 問</span>
    </div>
    <div class="list__tabs">
      ${groups.map((g) => `<button class="tabBtn" data-jump="blanks-${g.n}">□${g.n}</button>`).join('')}
    </div>
    <div class="list__sections"></div>
  `;
  const sections = wrap.querySelector('.list__sections');
  groups.forEach((g) => {
    const solvedInGroup = g.indexes.filter((i) => solved.has(i)).length;
    const section = document.createElement('section');
    section.className = 'listGroup';
    section.id = `blanks-${g.n}`;
    section.innerHTML = `<h3 class="listGroup__title">□ ${g.n} 個（${g.indexes.length} 問・解いた ${solvedInGroup} 問）</h3>`;
    const grid = document.createElement('div');
    grid.className = 'list__grid';
    g.indexes.forEach((i) => {
      const b = document.createElement('button');
      b.className = 'numBtn' + (solved.has(i) ? ' numBtn--solved' : '');
      b.textContent = String(i + 1);
      b.addEventListener('click', () => showPuzzle(op, i));
      grid.appendChild(b);
    });
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
function buildCells(problem, solution) {
  const pLines = problem.split('\n');
  const sLines = solution.split('\n');
  const cols = Math.max(...pLines.map((l) => l.length));
  const pad = (l) => l + '　'.repeat(cols - l.length);
  const rows = pLines.map((l, r) => {
    const pl = pad(l), sl = pad(sLines[r]);
    return [...pl].map((ch, c) => {
      const sch = sl[c];
      if (ch === '□') return { kind: 'edit', answer: fullToHalf(sch), value: null };
      if (/[０-９]/.test(ch)) return { kind: 'fixed', answer: fullToHalf(ch) };
      return { kind: 'deco', text: ch };
    });
  });
  return rows;
}
const FULL = '０１２３４５６７８９';
function fullToHalf(ch) { const i = FULL.indexOf(ch); return i < 0 ? null : i; }
function halfToFull(n) { return FULL[n]; }

let cur = null;   // { op, index, rows, active: [r,c] | null, done }

function showPuzzle(op, index) {
  loadPuzzles(op).then((puzzles) => {
    const [problem, solution] = puzzles[index];
    cur = { op, index, total: puzzles.length, rows: buildCells(problem, solution), active: null, done: false };
    renderPuzzle();
  });
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
      <span class="puzzle__count">${OPS[cur.op].label} ${cur.index + 1} / ${cur.total}</span>
    </div>
    <div class="grid"></div>
    <p class="status" id="status"></p>
    <div class="actions">
      <button class="pill" data-act="reveal">答えを見る</button>
      <button class="pill pill--main" data-act="check">答え合わせ</button>
      <button class="pill" data-act="next">次の問題 →</button>
    </div>
    <div class="pad" id="pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => `<button class="padBtn" data-digit="${n}">${n}</button>`).join('')}
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
  fitGrid(gridEl, cols);
  window.addEventListener('resize', () => fitGrid(gridEl, cols), { once: true });

  paintGrid();

  wrap.querySelector('[data-act="list"]').addEventListener('click', () => showList(cur.op));
  wrap.querySelector('[data-act="next"]').addEventListener('click', () => {
    const next = (cur.index + 1) % cur.total;
    showPuzzle(cur.op, next);
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

  if (!cur._keyHandler) {
    cur._keyHandler = onKeyDown;
  }
  document.addEventListener('keydown', onKeyDown);
}

function fitGrid(gridEl, cols) {
  const avail = gridEl.parentElement.clientWidth;
  const size = Math.max(16, Math.min(40, Math.floor(avail / cols)));
  gridEl.style.setProperty('--cell', size + 'px');
}

function paintGrid() {
  const gridEl = document.querySelector('.grid');
  if (!gridEl) return;
  cur.rows.forEach((row, r) => row.forEach((cell, c) => {
    const el = gridEl.children[r * row.length + c];
    const isActive = cur.active && cur.active[0] === r && cur.active[1] === c;
    el.classList.toggle('cell--active', !!isActive);
    el.classList.remove('cell--ok', 'cell--bad');
    if (cell.kind === 'fixed') el.textContent = halfToFull(cell.answer);
    else if (cell.kind === 'deco') el.textContent = cell.text;
    else el.textContent = cell.value == null ? '' : halfToFull(cell.value);
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
  if (!cur || cur.done) return;
  if (!document.querySelector('.puzzle')) { document.removeEventListener('keydown', onKeyDown); return; }
  if (/^[0-9]$/.test(e.key)) { setActiveValue(Number(e.key)); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { setActiveValue(null); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { moveActive(1); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { moveActive(-1); return; }
}

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
    markSolved(cur.op, cur.index);
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
