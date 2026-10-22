/* AI 强度量表：拿"直线竞速、不放墙"的对手当标尺，看每关 AI 的胜负与放墙数。
   调难度（mistake / noise / wallCost / budget / persona）之后跑一下就知道变化。 */
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
  grab(/function validWall[\s\S]*?\n\}/),
  grab(/function placeWall[\s\S]*?\n\}/),
  grab(/function hasOptions\(g,color\)\{[^\n]*\}/),
  grab(/function hasRealOptions\(g,color\)\{[\s\S]*?\n\}/),
  grab(/function reachedGoal\(g,color\)\{[^\n]*\}/),
  grab(/function wallSlotsOnPath\(path\)\{[\s\S]*?\n\}/),
  grab(/function pathLen\(g,from,to\)\{[\s\S]*?\n\}/),
  grab(/function bothOk\(g\)\{[\s\S]*?\n\}/),
  grab(/const PERSONAS=\{[\s\S]*?\n\};/),
  grab(/const AI=\{[\s\S]*?\n\};/),
  grab(/function tickEvents\(g,level\)\{[\s\S]*?\n\}/),
  grab(/function doShrink\(g,step\)\{[\s\S]*?\n\}/),
  grab(/function doShiftGate\(g\)\{[\s\S]*?\n\}/),
  grab(/function doPhase\(g,ev\)\{[\s\S]*?\n\}/),
  grab(/function buildLevels\(\)\{[\s\S]*?\n\}/),
  'buildLevels();',
].join('\n');
const M = new Function(code + '\nreturn {LEVELS,makeGame,legalMoves,bfs,validWall,placeWall,reachedGoal,AI,wallSlotsOnPath,edgeBlocked,isBlockedCell,tickEvents};')();

function K2(k, r, c) { return k + ':' + r + ':' + c; }

/* 一场比赛：玩家用「永远走自己最短路第一步、不放墙」的新手策略；AI 用真实决策 */
function duel(lv, maxRounds) {
  const g = M.makeGame(lv);
  lv.preWalls.forEach(w => (w.kind === 'H' ? g.hW : g.vW).add(K2(w.kind, w.r, w.c)));
  lv.blockedCells.forEach(c => g.blocked.add(c.r + ':' + c.c));
  let aiWalls = 0, aiMoves = 0;
  const a = () => g.balls.A;
  for (let round = 1; round <= maxRounds; round++) {
    g.round = round;
    M.tickEvents(g, lv);                      /* 带回合事件的关卡（岩浆/门漂移/换阶段）要一并模拟 */
    /* 玩家（先手） */
    const op = M.bfs(g, 'P');
    let target = (op.next && !(op.next.r === a().r && op.next.c === a().c)) ? op.next : null;
    if (!target) {
      let bd = Infinity;
      for (const m of M.legalMoves(g, 'P')) {
        const s = g.balls.P; g.balls.P = m; const d = M.bfs(g, 'P').dist; g.balls.P = s;
        if (d > 0 && d < bd) { bd = d; target = m; }
      }
    }
    if (!target) return { w: 'draw-no-move', round, aiWalls, aiMoves };
    g.balls.P = { ...target };
    if (M.reachedGoal(g, 'P')) return { w: 'P', round, aiWalls, aiMoves };
    /* AI */
    const act = M.AI.decide(g, lv);
    if (!act) return { w: 'draw-ai-stuck', round, aiWalls, aiMoves };
    if (act.type === 'move') {
      if (M.edgeBlocked(g, a(), act.to)) return { w: 'AI穿墙!', round, aiWalls, aiMoves };
      if (act.to.r === g.balls.P.r && act.to.c === g.balls.P.c) return { w: 'AI重叠!', round, aiWalls, aiMoves };
      g.balls.A = { ...act.to }; aiMoves++;
      if (M.reachedGoal(g, 'A')) return { w: 'A', round, aiWalls, aiMoves };
    } else {
      if (!M.validWall(g, act.kind, act.r, act.c)) return { w: 'AI非法墙!', round, aiWalls, aiMoves };
      M.placeWall(g, 'A', act.kind, act.r, act.c); aiWalls++;
    }
  }
  return { w: 'timeout', round: maxRounds, aiWalls, aiMoves };
}

console.log('关卡 | 玩法 | 档位 | 结果 | 回合 | AI放墙 | AI走子');
for (const id of [1, 3, 5, 6, 8, 10, 14, 15, 20, 30, 45, 50, 60, 75, 80, 90, 99, 100]) {
  const lv = M.LEVELS[id - 1];
  const r = duel(lv, 300);
  console.log([String(id).padStart(3), (lv.mode + (lv.terrain === 'maze' ? '/迷宫' : '')).padEnd(14), lv.aiConfig.tier,
    r.w.padStart(4), String(r.round).padStart(4), String(r.aiWalls).padStart(6), String(r.aiMoves).padStart(6)].join(' | '));
}
/* 重复跑满强度档，看随机性（noise=0 时应当稳定） */
console.log('\n第 100 关重复 5 次：', [1, 2, 3, 4, 5].map(() => duel(M.LEVELS[99], 300).w).join(' '));
console.log('第 10 关重复 5 次：', [1, 2, 3, 4, 5].map(() => duel(M.LEVELS[9], 300).w).join(' '));

/* ---- 镜像对局：双方都用同一套 AI，先手方应当能赢（说明难度上限不是不可战胜） ---- */
function mirrorSwapOn(g) {
  const bp = g.balls.P, ba = g.balls.A, wp = g.wallsLeft.P, wa = g.wallsLeft.A, gp = g.goals.P, ga = g.goals.A;
  g.balls.P = ba; g.balls.A = bp; g.wallsLeft.P = wa; g.wallsLeft.A = wp; g.goals.P = ga; g.goals.A = gp;
  return () => { g.balls.P = bp; g.balls.A = ba; g.wallsLeft.P = wp; g.wallsLeft.A = wa; g.goals.P = gp; g.goals.A = ga; };
}
function duelMirror(lv, maxRounds) {
  const g = M.makeGame(lv);
  lv.preWalls.forEach(w => (w.kind === 'H' ? g.hW : g.vW).add(K2(w.kind, w.r, w.c)));
  lv.blockedCells.forEach(c => g.blocked.add(c.r + ':' + c.c));
  let pWalls = 0, aWalls = 0;
  for (let round = 1; round <= maxRounds; round++) {
    /* 玩家（先手）用同一套 AI 决策：临时把双方视角对调 */
    let undo = mirrorSwapOn(g);
    const pAct = M.AI.decide(g, lv);
    undo();
    if (!pAct) return { w: 'no-act', round, pWalls, aWalls };
    if (pAct.type === 'move') { g.balls.P = { ...pAct.to }; if (M.reachedGoal(g, 'P')) return { w: 'P', round, pWalls, aWalls }; }
    else { M.placeWall(g, 'P', pAct.kind, pAct.r, pAct.c); pWalls++; }
    const aAct = M.AI.decide(g, lv);
    if (!aAct) return { w: 'no-act', round, pWalls, aWalls };
    if (aAct.type === 'move') { g.balls.A = { ...aAct.to }; if (M.reachedGoal(g, 'A')) return { w: 'A', round, pWalls, aWalls }; }
    else { M.placeWall(g, 'A', aAct.kind, aAct.r, aAct.c); aWalls++; }
  }
  return { w: 'timeout', round: maxRounds, pWalls, aWalls };
}
console.log('\n镜像对局（双方同强度 AI，玩家先手）');
for (const id of [10, 30, 50, 80, 100]) {
  const out = [1, 2, 3].map(() => { const r = duelMirror(M.LEVELS[id - 1], 300); return r.w + '(' + r.round + ',墙' + r.pWalls + '/' + r.aWalls + ')'; });
  console.log('第 ' + id + ' 关：', out.join('  '));
}

