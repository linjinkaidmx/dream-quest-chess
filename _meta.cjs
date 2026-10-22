/* AI 人设锦标赛：让 5 种人设两两对打（先手/后手各半），出一张胜率矩阵。
   用途：回答"筑墙型是不是真的难打""哪种性格最强"，比人肉试关高效得多。
   两边都用 AI 决策、都关掉随机性（noise/mistake=0），所以差异只来自人设本身。
   用法：node _meta.cjs [每人设的对局数，默认 8] */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = src.match(/<script>([\s\S]*)<\/script>/)[1];
const grab = re => { const m = js.match(re); if (!m) throw new Error('NOT FOUND: ' + re); return m[0]; };

const code = [
  'const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',
  grab(/function rng\(seed\)\{[\s\S]*?\n\}/),
  'const K=(k,r,c)=>k+\':\'+r+\':\'+c;',
  'const WALL_QUOTA_P=10; const LEVELS=[]; const EDGES=[]; const NODES=[]; const ZONES=[];',
  grab(/const CHAPTERS=\[[\s\S]*?\n\];/),
  grab(/const MODE_PLAN_15[\s\S]*?TERRAIN_PLAN_10=\[[^\]]*\];/),
  grab(/const BOSSES=\{[\s\S]*?\n\};/),
  grab(/const SPECIAL_PLAN=\{[^\n]*\};/),
  grab(/function mazeTerrain\(level,g0,R\)\{[\s\S]*?\n\}/),
  grab(/function makeGame\(level\)\{[\s\S]*?\n\}/),
  grab(/function edgeBlocked[\s\S]*?\n\}/),
  grab(/function isBlockedCell[\s\S]*?\n\}/),
  grab(/function legalMoves[\s\S]*?\n\}/),
  grab(/function bfs\(g,color\)\{[\s\S]*?\n\}/),
  grab(/function specialAt\(g,r,c\)\{[\s\S]*?\n\}/),
  grab(/function canStand\(g,r,c,color\)\{[\s\S]*?\n\}/),
  grab(/function resolveSpecial\(g,color,from,to\)\{[\s\S]*?\n\}/),
  grab(/function specialCellsFor\(level,kind\)\{[\s\S]*?\n\}/),
  grab(/function pathLen\(g,from,to\)\{[\s\S]*?\n\}/),
  grab(/function validWall[\s\S]*?\n\}/),
  grab(/function placeWall[\s\S]*?\n\}/),
  grab(/function hasOptions\(g,color\)\{[^\n]*\}/),
  grab(/function hasRealOptions\(g,color\)\{[\s\S]*?\n\}/),
  grab(/function reachedGoal\(g,color\)\{[^\n]*\}/),
  grab(/function wallSlotsOnPath\(path\)\{[\s\S]*?\n\}/),
  grab(/const PERSONAS=\{[\s\S]*?\n\};/),
  grab(/const AI=\{[\s\S]*?\n\};/),
  grab(/function bothOk\(g\)\{[\s\S]*?\n\}/),
  grab(/function buildLevels\(\)\{[\s\S]*?\n\}/),
  'buildLevels();',
].join('\n');
const M = new Function(code + '\nreturn {LEVELS,PERSONAS,makeGame,bfs,pathLen,validWall,placeWall,reachedGoal,AI,legalMoves};')();
const K2 = (k, r, c) => k + ':' + r + ':' + c;

const GAMES = parseInt(process.argv[2] || '8', 10);
const MAX_ROUNDS = 60;
const LEVEL_IDS = [50, 80, 99];                 /* 用几张不同的中后期图，避免结果只对某一张图成立 */

/* 让某一方按指定人设出招（P 方需要临时对调视角，因为 decide 是写给 A 的） */
function actFor(g, level, color, persona) {
  if (color === 'A') { level.aiConfig.persona = persona; return M.AI.decide(g, level); }
  const bp = g.balls.P, ba = g.balls.A, wp = g.wallsLeft.P, wa = g.wallsLeft.A, gp = g.goals.P, ga = g.goals.A;
  g.balls.P = ba; g.balls.A = bp; g.wallsLeft.P = wa; g.wallsLeft.A = wp; g.goals.P = ga; g.goals.A = gp;
  const oldPersona = level.aiConfig.persona;
  level.aiConfig.persona = persona;
  const act = M.AI.decide(g, level);
  level.aiConfig.persona = oldPersona;
  g.balls.P = bp; g.balls.A = ba; g.wallsLeft.P = wp; g.wallsLeft.A = wa; g.goals.P = gp; g.goals.A = ga;
  return act;
}

/* 一场：pFirst 先手，sSecond 后手。返回 'P' 或 'A' 或 'draw' */
function match(levelId, pFirst, sSecond) {
  const base = M.LEVELS[levelId - 1];
  const level = JSON.parse(JSON.stringify(base));
  level.aiConfig.tier = 1; level.aiConfig.noise = 0; level.aiConfig.mistake = 0;
  level.aiConfig.wallCost = 0.5; level.aiConfig.budget = base.wallRules.quota.P;
  const g = M.makeGame(level);
  level.preWalls.forEach(w => (w.kind === 'H' ? g.hW : g.vW).add(K2(w.kind, w.r, w.c)));
  level.blockedCells.forEach(c => g.blocked.add(c.r + ':' + c.c));
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const color of ['P', 'A']) {
      const persona = color === 'P' ? pFirst : sSecond;
      const other = color === 'P' ? 'A' : 'P';
      if (!M.legalMoves(g, color).length && g.wallsLeft[color] <= 0) continue;   /* 被围死：跳过 */
      const act = actFor(g, level, color, persona);
      if (!act) continue;
      if (act.type === 'move') {
        g.balls[color] = { ...act.to };
        if (M.reachedGoal(g, color)) return color;
      } else {
        M.placeWall(g, color, act.kind, act.r, act.c);
      }
      if (g.balls[color].r === g.balls[other].r && g.balls[color].c === g.balls[other].c) return color;
    }
  }
  return 'draw';
}

const names = Object.keys(M.PERSONAS);
const label = n => (M.PERSONAS[n].name + ' ' + n);
console.log('AI 人设锦标赛：' + names.length + ' 种人设两两对打，每个配对 ' + GAMES + ' 局（先手/后手各半，跨 ' + LEVEL_IDS.length + ' 张图）');
console.log('（双方都关掉随机性，差异只来自人设本身；同一格的两侧数字＝行方胜/列方胜）\n');

const score = {}; names.forEach(n => score[n] = { win: 0, lose: 0, draw: 0 });
const pad = (s, n) => String(s).padEnd(n, ' ');
const w = 13;
console.log(pad('行\\列', 14) + names.map(n => pad(M.PERSONAS[n].name, w)).join(''));
for (const row of names) {
  let line = pad(label(row).slice(0, 12), 14);
  for (const col of names) {
    if (row === col) { line += pad('—', w); continue; }
    let rw = 0, cw = 0, dr = 0;
    for (let i = 0; i < GAMES; i++) {
      const lv = LEVEL_IDS[i % LEVEL_IDS.length];
      const res = (i % 2 === 0) ? match(lv, row, col) : match(lv, col, row);
      const rowIsFirst = (i % 2 === 0);
      const winner = res === 'draw' ? 'draw' : (res === 'P' ? (rowIsFirst ? 'row' : 'col') : (rowIsFirst ? 'col' : 'row'));
      if (winner === 'row') rw++; else if (winner === 'col') cw++; else dr++;
    }
    score[row].win += rw; score[row].lose += cw; score[row].draw += dr;
    score[col].win += cw; score[col].lose += rw; score[col].draw += dr;
    line += pad(rw + ':' + cw + (dr ? ('(' + dr + '平)') : ''), w);
  }
  console.log(line);
}
console.log('\n总战绩（含所有配对）：');
names.map(n => ({ n, ...score[n], rate: score[n].win / Math.max(1, score[n].win + score[n].lose) }))
  .sort((a, b) => b.rate - a.rate)
  .forEach(x => {
    console.log('  ' + pad(label(x.n), 16) + ' 胜 ' + pad(x.win, 4) + ' 负 ' + pad(x.lose, 4) +
      (x.draw ? (' 平 ' + x.draw + '  ') : '      ') + ' 胜率 ' + (x.rate * 100).toFixed(1) + '%');
  });
