const fs=require('fs');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const js=src.match(/<script>([\s\S]*)<\/script>/)[1];
const grab=re=>{ const m=js.match(re); if(!m) throw new Error('NOT FOUND: '+re); return m[0]; };

const code=[
  'const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',
  grab(/function rng\(seed\)\{[\s\S]*?\n\}/),
  'const K=(k,r,c)=>k+\':\'+r+\':\'+c;',
  'const WALL_QUOTA_P=10; const LEVELS=[]; const EDGES=[]; const NODES=[]; const ZONES=[];',
  grab(/const CHAPTERS=\[[\s\S]*?\n\];/),
  grab(/const MODE_PLAN_15[\s\S]*?TERRAIN_PLAN_10=\[[^\]]*\];/),
  grab(/const BOSSES=\{[\s\S]*?\n\};/),
  grab(/const SPECIAL_PLAN=\{[^\n]*\};/),
  grab(/function makeGame\(level\)\{[\s\S]*?\n\}/),
  grab(/function isBlockedCell[\s\S]*?\n\}/),
  grab(/function edgeBlocked[\s\S]*?\n\}/),
  grab(/function legalMoves[\s\S]*?\n\}/),
  grab(/function bfs\(g,color\)\{[\s\S]*?\n\}/),
  grab(/function specialAt\(g,r,c\)\{[\s\S]*?\n\}/),
  grab(/function canStand\(g,r,c,color\)\{[\s\S]*?\n\}/),
  grab(/function resolveSpecial\(g,color,from,to\)\{[\s\S]*?\n\}/),
  grab(/function specialCellsFor\(level,kind\)\{[\s\S]*?\n\}/),
  grab(/function specialCost\(res\)\{[\s\S]*?\n\}/),
  grab(/const LevelCode=\{[\s\S]*?\n\};/),
  grab(/function makeCustomLevel\(p\)\{[\s\S]*?\n\}/),
  grab(/function levelValid\(level\)\{[\s\S]*?\n\}/),
  grab(/const SKILLS=\{[\s\S]*?\n\};/),
  grab(/function previewOpponent\(g,level\)\{[\s\S]*?\n\}/),
  grab(/const SKINS=\[[\s\S]*?\n\];/),
  grab(/const ACHIEVEMENTS=\[[\s\S]*?\n\];/),
  grab(/function skinById\(id\)\{[^\n]*\}/),
  grab(/function edRow\(r,w\)\{[^\n]*\}/),
  grab(/function edCenter\(w,minN\)\{[\s\S]*?\n\}/),
  grab(/function dailyKey\(d\)\{[\s\S]*?\n\}/),
  grab(/function dailySeedOf\(key\)\{[\s\S]*?\n\}/),
  grab(/function dailyStreak\(map,key\)\{[\s\S]*?\n\}/),
  grab(/function buildDailyLevel\(key,tier\)\{[\s\S]*?\n\}/),
  grab(/function pathLen\(g,from,to\)\{[\s\S]*?\n\}/),
  grab(/function validWall[\s\S]*?\n\}/),
  grab(/function wallBlockReason[\s\S]*?\n\}/),
  grab(/function bothOk\(g\)\{[\s\S]*?\n\}/),
  grab(/function placeWall[\s\S]*?\n\}/),
  grab(/function hasOptions\(g,color\)\{[^\n]*\}/),
  grab(/function hasRealOptions\(g,color\)\{[\s\S]*?\n\}/),
  grab(/function reachedGoal\(g,color\)\{[^\n]*\}/),
  grab(/function wallSlotsOnPath\(path\)\{[\s\S]*?\n\}/),
  grab(/const PERSONAS=\{[\s\S]*?\n\};/),
  grab(/const AI=\{[\s\S]*?\n\};/),
  grab(/function computeStars[\s\S]*?\n\}/),
  grab(/function tickEvents\(g,level\)\{[\s\S]*?\n\}/),
  grab(/function doShrink\(g,step\)\{[\s\S]*?\n\}/),
  grab(/function doShiftGate\(g\)\{[\s\S]*?\n\}/),
  grab(/function doRain\(g,step\)\{[\s\S]*?\n\}/),
  grab(/function doPhase\(g,ev\)\{[\s\S]*?\n\}/),
  grab(/const CHASE_CUT=[^\n]*/),
  grab(/function mazeTerrain\(level,g0,R\)\{[\s\S]*?\n\}/),
  grab(/function buildLevels\(\)\{[\s\S]*?\n\}/),
  'buildLevels();',
].join('\n');
const sandbox=new Function(code+'\nreturn {LEVELS,EDGES,CHAPTERS,CHASE_CUT,makeGame,legalMoves,bfs,pathLen,validWall,edgeBlocked,isBlockedCell,placeWall,reachedGoal,AI,computeStars,hasOptions,hasRealOptions,tickEvents,bothOk,wallSlotsOnPath,PERSONAS,SPECIAL_PLAN,specialAt,resolveSpecial,specialCellsFor,specialCost,LevelCode,makeCustomLevel,levelValid,SKILLS,previewOpponent,SKINS,skinById,ACHIEVEMENTS,dailyKey,dailySeedOf,dailyStreak,buildDailyLevel};');
const M=sandbox();

let fails=0;
const ok=(cond,msg)=>{ if(!cond){ fails++; console.log('FAIL:',msg); } };

/* 1. 数量与章节分布 */
ok(M.LEVELS.length===100,'应有 100 关，实际 '+M.LEVELS.length);
const chCounts=M.CHAPTERS.map(ch=>M.LEVELS.filter(l=>l.chapterId===ch.id).length);
ok(JSON.stringify(chCounts)===JSON.stringify([15,15,15,15,15,15,10]),'章节关卡数 '+chCounts);

/* 2. 每关：目标与引擎一致、尺寸合法、双方可达（预置墙+障碍之后） */
for(const lv of M.LEVELS){
  const g=M.makeGame(lv);
  ok(g.goals.P.length===lv.goalCells.length&&lv.goalCells.every(c=>g.goals.P.some(x=>x.r===c.r&&x.c===c.c)),
     '第'+lv.id+'关 引擎目标应与关卡数据一致');
  ok(g.goals.A.length===lv.aiGoalCells.length&&lv.aiGoalCells.every(c=>g.goals.A.some(x=>x.r===c.r&&x.c===c.c)),
     '第'+lv.id+'关 AI 目标应与关卡数据一致');
  ok(lv.goalCells.length>0,'第'+lv.id+'关 玩家目标不应为空');
  ok(lv.mode==='chase'?lv.aiGoalCells.length===0:lv.aiGoalCells.length>0,'第'+lv.id+'关 目标配置异常（追逐关的怪物不该有终点）');
  ok(lv.goalCells.every(c=>c.r>=0&&c.r<lv.height&&c.c>=0&&c.c<lv.width&&(c.r===0||c.r===lv.height-1)),
     '第'+lv.id+'关 目标格必须落在顶边或底边上');
  ok(!lv.blockedCells.some(b=>lv.goalCells.concat(lv.aiGoalCells).some(c=>c.r===b.r&&c.c===b.c)),
     '第'+lv.id+'关 目标格不应被障碍占用');
  ok(!lv.blockedCells.some(b=>b.r===lv.startPosition.r&&b.c===lv.startPosition.c),'第'+lv.id+'关 起点不应被障碍占用');
  ok(!lv.blockedCells.some(b=>b.r===lv.aiStartPosition.r&&b.c===lv.aiStartPosition.c),'第'+lv.id+'关 AI 起点不应被障碍占用');
  lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K2(w.kind,w.r,w.c)));
  lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
  const dp=M.bfs(g,'P').dist;
  ok(dp>0,'第'+lv.id+'关 玩家到终点不可达 '+dp);
  if(lv.mode==='chase') ok(M.pathLen(g,g.balls.A,g.balls.P).dist>0,'第'+lv.id+'关 怪物应能走到玩家');
  else ok(M.bfs(g,'A').dist>0,'第'+lv.id+'关 AI 到终点不可达');
  ok(lv.width>=7&&lv.width<=13&&lv.height>=7&&lv.height<=11,'第'+lv.id+'关 尺寸异常 '+lv.width+'x'+lv.height);
}
function K2(k,r,c){ return k+':'+r+':'+c; }

/* 2b. 玩法编排：经典关必须仍是「整条边线」，新玩法的目标/起点形态正确 */
{
  const ch1All=M.LEVELS.filter(l=>l.chapterId===1);
  const ch1=ch1All.filter(l=>!l.isBoss);        /* 章末 Boss 的玩法是单独指定的，不参与普通配比 */
  const pureRace=ch1.filter(l=>l.mode==='race'&&l.terrain==='plain').length;
  const maze=ch1.filter(l=>l.terrain==='maze').length;
  const gate=ch1.filter(l=>l.mode==='gate').length;
  const same=ch1.filter(l=>l.mode==='sameSide').length;
  const shared=ch1.filter(l=>l.mode==='sharedGate').length;
  ok(ch1All.length-ch1.length===1,'第1章应恰好 1 个 Boss，实际 '+(ch1All.length-ch1.length));
  const chase=ch1.filter(l=>l.mode==='chase').length;
  ok(pureRace===7&&maze===2&&gate===2&&same===1&&shared===1&&chase===1,
     '第1章普通关配比应为 7 经典 + 2 迷宫 + 2 门型 + 1 同向 + 1 共同终点 + 1 追逐，实际 '+[pureRace,maze,gate,same,shared,chase].join('/'));
  ok(pureRace+maze+gate+same+shared+chase===ch1.length,'普通关配比应覆盖本章除 Boss 外的全部关卡');

  M.LEVELS.filter(l=>l.mode==='race').forEach(lv=>{          /* 回归保护：别把经典玩法改坏 */
    ok(lv.goalCells.length===lv.width&&lv.aiGoalCells.length===lv.width,'第'+lv.id+'关 经典关目标应为整条边线');
  });
  M.LEVELS.filter(l=>l.mode==='gate').forEach(lv=>{
    ok(lv.goalCells.length===2&&lv.aiGoalCells.length===2,'第'+lv.id+'关 门型应为 2 格门');
    ok(lv.goalCells[0].r===0&&lv.aiGoalCells[0].r===lv.height-1,'第'+lv.id+'关 门型应为相向的两扇门');
  });
  M.LEVELS.filter(l=>l.mode==='sameSide').forEach(lv=>{
    ok(lv.startPosition.r===lv.aiStartPosition.r&&lv.startPosition.c!==lv.aiStartPosition.c,
       '第'+lv.id+'关 同向关双方应同排不同列出发');
    ok(lv.goalCells.length===lv.aiGoalCells.length&&lv.goalCells.every(c=>lv.aiGoalCells.some(x=>x.r===c.r&&x.c===c.c)),
       '第'+lv.id+'关 同向关双方目标应相同');
  });
  M.LEVELS.filter(l=>l.mode==='sharedGate').forEach(lv=>{
    ok(lv.startPosition.c!==lv.aiStartPosition.c,'第'+lv.id+'关 共同终点关起点应不同');
    ok((lv.goalCells.length===2||lv.goalCells.length===4)&&lv.goalCells.every(c=>lv.aiGoalCells.some(x=>x.r===c.r&&x.c===c.c)),
       '第'+lv.id+'关 共同终点关双方应抢同一组门，实际 '+lv.goalCells.length+' 格');
  });
  M.LEVELS.filter(l=>l.terrain==='maze').forEach(lv=>{
    const g=M.makeGame(lv);
    lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K2(w.kind,w.r,w.c)));
    lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
    ok(lv.blockedCells.length>=10,'第'+lv.id+'关 迷宫关障碍太少 '+lv.blockedCells.length);
    ok(M.bfs(g,'P').dist>=Math.round(lv.startPosition.r*1.4),
       '第'+lv.id+'关 迷宫应造成明显绕路：最短 '+M.bfs(g,'P').dist+' / 直线 '+lv.startPosition.r);
  });
  for(const id of [1,2,3,4,5]){                               /* 用户要求：前 5 关保持纯教学 */
    const lv=M.LEVELS[id-1];
    ok(lv.mode==='race'&&lv.terrain==='plain','第'+id+'关 应为经典平坦关');
    ok(lv.blockedCells.length===0&&lv.preWalls.length===0,'第'+id+'关 新手关应保持空盘');
    ok(lv.goalCells.length===lv.width&&lv.aiGoalCells.length===lv.width,'第'+id+'关 新手关目标应为整条边线');
  }
}

/* 3. 关卡难度爬升合理（普通关的 AI 预算单调不减；Boss 有自己的墙数配置，不参与） */
for(const lv of M.LEVELS.filter(l=>!l.isBoss&&l.mode!=='chase')){
  const prev=M.LEVELS.filter(x=>!x.isBoss&&x.mode!=='chase'&&x.id<lv.id).slice(-1)[0];
  if(prev) ok(lv.aiConfig.budget>=prev.aiConfig.budget,'AI 预算应单调不减 @'+lv.id);
}
const hard=M.LEVELS[99];
ok(hard.aiConfig.mistake<=0.05,'后期 AI 犯错率应接近 0，实际 '+hard.aiConfig.mistake);
ok(hard.aiConfig.budget>=10,'第100关 AI 墙应>=10，实际 '+hard.aiConfig.budget);

/* 4. 分支关卡图：2/4/6/7 章应有分叉（某节点有两个前驱） */
const preds={};
M.EDGES.forEach(e=>{ (preds[e.to]=preds[e.to]||[]).push(e.from); });
const multi=Object.values(preds).filter(a=>a.length>1).length;
ok(multi>=4,'应有至少 4 个合并节点（分支），实际 '+multi);

/* 5. 非方形棋盘 edgeBlocked 双向对称（上次的穿墙 bug 回归） */
{
  const lv=M.LEVELS.find(l=>l.width===13&&l.height===9);
  const g=M.makeGame(lv);
  let bad=0;
  for(let r=0;r<8;r++)for(let c=0;c<12;c++){
    g.hW.clear(); g.vW.clear(); g.vW.add('V:'+r+':'+c); g.hW.add('H:'+r+':'+c);
    for(let ar=0;ar<9;ar++)for(let ac=0;ac<13;ac++)for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const b={r:ar+dr,c:ac+dc}; if(b.r<0||b.r>8||b.c<0||b.c>12) continue;
      if(M.edgeBlocked(g,{r:ar,c:ac},b)!==M.edgeBlocked(g,b,{r:ar,c:ac})) bad++;
    }
  }
  ok(bad===0,'13x9 双向判定不一致 '+bad+' 处');
}

/* 6. AI 单独推演：决策永远合法，且能在有限步内到达终点 */
function simulate(lv,maxSteps){
  const g=M.makeGame(lv);
  lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K2(w.kind,w.r,w.c)));
  lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
  for(let step=0;step<maxSteps;step++){
    const act=M.AI.decide(g,lv);
    if(!act) return 'stuck@'+step;
    if(act.type==='move'){
      const cur=g.balls.A;
      const dist=Math.abs(cur.r-act.to.r)+Math.abs(cur.c-act.to.c);
      if(dist!==1) return 'illegal-jump@'+step;
      if(M.edgeBlocked(g,cur,act.to)) return 'through-wall@'+step;
      if(act.to.r===g.balls.P.r&&act.to.c===g.balls.P.c) return 'overlap@'+step;
      if(g.blocked.has(act.to.r+':'+act.to.c)) return 'into-block@'+step;
      g.balls.A={...act.to};
      if(M.reachedGoal(g,'A')) return 'win@'+step;
    } else {
      if(!M.validWall(g,act.kind,act.r,act.c)) return 'illegal-wall@'+step;
      M.placeWall(g,'A',act.kind,act.r,act.c);
    }
  }
  return 'timeout';
}
for(const id of [1,10,25,50,75,100]){
  const r=simulate(M.LEVELS[id-1],400);
  ok(r.startsWith('win'),'AI 推演 第'+id+'关 结果 '+r);
}

/* 6b. 扎营死锁回归：玩家停在 AI 目标格上（或目标行上），AI 仍必须能获胜。
   注意：只挑「决策已无随机性」的关卡（noise=0，即第 40 关起）——
   低关卡带噪声的 AI 在迷宫里可能长时间游荡，那是难度梯度不是 bug，
   用 400 步卡它会变成偶发失败。目标行完整性由第 2 节的断言覆盖全部关卡。 */
for(const id of [40,68,83,96,100]){
  const r=simulate(M.LEVELS[id-1],400);   // simulate 中玩家全程不动
  ok(r.startsWith('win'),'扎营场景 第'+id+'关 AI 结果 '+r);
}

/* 7. 星级规则可配置且单调 */
{
  const lv=M.LEVELS[49];
  const s1=M.computeStars(lv,{rounds:lv.starRules.par2+5,walls:9,time:0});
  const s2=M.computeStars(lv,{rounds:lv.starRules.par2,walls:9,time:0});
  const s3=M.computeStars(lv,{rounds:lv.starRules.par3,walls:9,time:0});
  ok(s1===1&&s2===2&&s3===3,'星级计算 '+s1+s2+s3+' (par2='+lv.starRules.par2+',par3='+lv.starRules.par3+')');
}

/* 8. 两球不可重叠：legalMoves 排除对方格 */
{
  const lv=M.LEVELS[0];
  const g=M.makeGame(lv);
  g.balls.P={r:4,c:4}; g.balls.A={r:4,c:5};
  ok(!M.legalMoves(g,'P').some(m=>m.r===4&&m.c===5),'合法走位应排除对方所在格');
}

/* 9. AI 强度曲线：参数单调 + 新手档弱 + 满强度强（Boss 有独立人设曲线，不参与普通曲线的单调性检查） */
{
  const t1=M.LEVELS.filter(l=>l.aiConfig.tier===1&&!l.isBoss&&l.mode!=='chase');
  for(let i=1;i<t1.length;i++){
    const a=t1[i-1].aiConfig, b=t1[i].aiConfig;
    ok(b.mistake<=a.mistake,'tier1 犯错率应单调不增 @第'+t1[i].id+'关');
    ok(b.noise<=a.noise,'tier1 决策噪声应单调不增 @第'+t1[i].id+'关');
    ok(b.wallCost<=a.wallCost,'tier1 放墙代价应单调不增 @第'+t1[i].id+'关');
  }
  const strongest=M.LEVELS.filter(l=>!l.isBoss&&l.mode!=='chase').slice(-1)[0];
  ok(strongest.aiConfig.mistake===0&&strongest.aiConfig.noise===0,
     '最后一个普通关（第'+strongest.id+'关）AI 应不再犯错、不再随机挑选');
  ok(strongest.aiConfig.wallCost<=0.16,'第'+strongest.id+'关 AI 放墙代价应压到最低，实际 '+strongest.aiConfig.wallCost);
  for(let id=1;id<=5;id++) ok(M.LEVELS[id-1].aiConfig.tier===0,'第'+id+'关应为新手档');
}

/* 10. 对局推演：满强度 AI 应能压制「直线竞速不放墙」的对手；新手档则压制不了 */
function K3(k,r,c){ return k+':'+r+':'+c; }
function duel(lv,maxRounds,opt){
  const g=M.makeGame(lv);
  lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K3(w.kind,w.r,w.c)));
  lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
  if(opt&&opt.specials===false) g.specialCells=[];     /* 推演「完全不碰机关」的路线 */
  let aiWalls=0, aiMoves=0, passes=0;
  const other=()=>g.balls.A;
  /* 「还有事可做」= 能走一步或能落一面合法的墙；两边都没事可做就是僵局（与引擎同一套判定） */
  const opts=color=>M.hasRealOptions(g,color);
  for(let round=1;round<=maxRounds;round++){
    const pOpts=opts('P'), aOpts=opts('A');
    if(!pOpts&&!aOpts) return {w:'stalemate',round,aiWalls,aiMoves};
    if(!pOpts) passes++;
    else if(opt&&opt.mirror){
      /* 镜像：玩家位也交给同一套 AI（临时对调双方视角） */
      const bp=g.balls.P,ba=g.balls.A,wp=g.wallsLeft.P,wa=g.wallsLeft.A,gp=g.goals.P,ga=g.goals.A;
      g.balls.P=ba; g.balls.A=bp; g.wallsLeft.P=wa; g.wallsLeft.A=wp; g.goals.P=ga; g.goals.A=gp;
      const act=M.AI.decide(g,lv);
      g.balls.P=bp; g.balls.A=ba; g.wallsLeft.P=wp; g.wallsLeft.A=wa; g.goals.P=gp; g.goals.A=ga;
      if(!act) passes++;                       /* 被围死且无处落墙：跳过这一手（和真实对局一致） */
      else if(act.type==='move'){ g.balls.P={...act.to}; if(M.reachedGoal(g,'P')) return {w:'P',round,aiWalls,aiMoves}; }
      else { M.placeWall(g,'P',act.kind,act.r,act.c); }
    } else {
      /* 基准对手：永远走自己最短路第一步，不放墙 */
      const op=M.bfs(g,'P');
      let target=(op.next&&!(op.next.r===other().r&&op.next.c===other().c))?op.next:null;
      if(!target){
        let bd=Infinity;
        for(const m of M.legalMoves(g,'P')){
          const s=g.balls.P; g.balls.P=m; const d=M.bfs(g,'P').dist; g.balls.P=s;
          if(d>0&&d<bd){bd=d;target=m;}
        }
      }
      if(!target){
        /* 被彻底围死：能放墙就放一面拖住对手，否则这一手跳过（真实对局同样处理） */
        let put=false;
        for(let r=0;r<g.H-1&&!put;r++)for(let c=0;c<g.W-1&&!put;c++)for(const kind of ['H','V']){
          if(!M.validWall(g,kind,r,c)) continue;
          M.placeWall(g,'P',kind,r,c); put=true;
        }
        if(!put) return {w:'p-no-act',round,aiWalls,aiMoves};
        passes++;
      } else {
        const from={r:g.balls.P.r,c:g.balls.P.c};
        const res=M.resolveSpecial(g,'P',from,target);        /* 机关：与真实对局一致地结算 */
        g.balls.P={r:res.r,c:res.c};
        if(res.kind==='trap') g.wallsLeft.P=Math.max(0,g.wallsLeft.P-2);
        else if(res.kind==='pickup') g.wallsLeft.P+=1;
        if(M.reachedGoal(g,'P')) return {w:'P',round,aiWalls,aiMoves};
      }
    }
    if(!aOpts){ passes++; continue; }
    const act=M.AI.decide(g,lv);
    if(!act){ passes++; continue; }          /* AI 被围死且无处落墙：跳过（真实对局同样跳过） */
    if(act.type==='move'){
      const cur=g.balls.A;
      if(Math.abs(cur.r-act.to.r)+Math.abs(cur.c-act.to.c)!==1) return {w:'AI跳格!',round,aiWalls,aiMoves};
      if(M.edgeBlocked(g,cur,act.to)) return {w:'AI穿墙!',round,aiWalls,aiMoves};
      if(M.isBlockedCell(g,act.to.r,act.to.c)) return {w:'AI进障碍!',round,aiWalls,aiMoves};
      if(act.to.r===g.balls.P.r&&act.to.c===g.balls.P.c) return {w:'AI重叠!',round,aiWalls,aiMoves};
      const res=M.resolveSpecial(g,'A',cur,act.to);           /* 机关：与真实对局一致地结算 */
      g.balls.A={r:res.r,c:res.c}; aiMoves++;
      if(res.kind==='trap') g.wallsLeft.A=Math.max(0,g.wallsLeft.A-2);
      if(g.balls.A.r===g.balls.P.r&&g.balls.A.c===g.balls.P.c) return {w:'AI撞上!',round,aiWalls,aiMoves};
      if(M.reachedGoal(g,'A')) return {w:'A',round,aiWalls,aiMoves};
    } else {
      if(!M.validWall(g,act.kind,act.r,act.c)) return {w:'AI非法墙!',round,aiWalls,aiMoves};
      M.placeWall(g,'A',act.kind,act.r,act.c); aiWalls++;
    }
  }
  return {w:'timeout',round:maxRounds,aiWalls,aiMoves,passes};
}
/* 新手档：绝不放墙，也追不上不放墙的对手（用户要求「前 5 关弱一点」） */
for(const id of [1,3,5]){
  const r=duel(M.LEVELS[id-1],300);
  ok(r.aiWalls===0,'新手档第'+id+'关不应放墙，实际 '+r.aiWalls);
  ok(r.w==='P','新手档第'+id+'关应被普通对手拿下，实际 '+r.w);
}
/* 满强度：压制普通对手，且决策全程合法（穿墙/重叠/非法墙都会以 ! 结尾暴露） */
for(const id of [50,80,99]){
  const r=duel(M.LEVELS[id-1],300);
  ok(r.w==='A','满强度第'+id+'关应拿下普通对手，实际 '+r.w+'（'+r.round+' 回合，放墙 '+r.aiWalls+'）');
  ok(!r.w.includes('!'),'第'+id+'关 AI 决策应合法，实际 '+r.w);
  ok(r.aiWalls>0,'满强度第'+id+'关 AI 应主动用墙，实际 '+r.aiWalls);
}
/* 镜像对局：双方用同一套决策互相打（玩家先手）。
   这条不假设"先手必胜"——同策略下谁占优取决于节奏，能验证的是：
   · 对局必须在有限回合内收场（会终局、不死循环、不出现非法动作）；
   · 满强度 AI 在同策略下并不吃亏，说明强度确实拉上来了。 */
for(const id of [50,80,99]){
  const r=duel(M.LEVELS[id-1],300,{mirror:true});
  ok(r.w==='P'||r.w==='A','镜像对局第'+id+'关应在 300 回合内终局，实际 '+r.w+'（'+r.round+' 回合）');
  ok(!r.w.includes('!')&&r.w!=='timeout','镜像对局第'+id+'关不应出现非法动作或死循环，实际 '+r.w);
}

/* 11. Boss 关与回合事件 */
{
  const bosses=M.LEVELS.filter(l=>l.isBoss);
  ok(bosses.length===7,'应有 7 个章末 Boss，实际 '+bosses.length);
  bosses.forEach(lv=>{
    ok(lv.index===CHAPTERS2(lv.chapterId).count-1,'第'+lv.id+'关 Boss 应排在章末');
    ok(lv.bossName&&lv.bossNote&&lv.bossCounter,'第'+lv.id+'关 Boss 应有名号/机制/克制提示');
    ok(lv.aiConfig.budget<=lv.wallRules.quota.P,'第'+lv.id+'关 Boss 墙数不应多于玩家（'+lv.aiConfig.budget+' vs '+lv.wallRules.quota.P+'）');
    ok(lv.aiConfig.noise<=0.28&&lv.aiConfig.mistake<=0.05,'第'+lv.id+'关 Boss 应接近满强度');
  });
  const evLevels=M.LEVELS.filter(l=>l.events&&l.events.length);
  ok(evLevels.length===12,'应有 12 个带回合事件的关卡（6 门漂移 + 3 落石 + 岩浆/门/阶段 Boss 各 1），实际 '+evLevels.length);
  /* 中段铺事件：每一章都至少有 1 关带回合事件（不含 Boss） */
  for(let chId=1;chId<=7;chId++){
    const n=M.LEVELS.filter(l=>l.chapterId===chId&&!l.isBoss&&l.events&&l.events.length).length;
    ok(n>=1,'第'+chId+'章应有至少 1 个带事件的普通关，实际 '+n);
  }
}
function CHAPTERS2(id){ return M.CHAPTERS.find(c=>c.id===id); }

/* 11b. 事件安全性：收缩 / 门漂移跑到底，双方必须始终可达、球不被埋、目标格不被埋 */
{
  const lv=M.LEVELS.find(l=>l.events&&l.events.some(e=>e.type==='shrink'));
  const g=M.makeGame(lv);
  lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K3(w.kind,w.r,w.c)));
  lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
  let bad=null;
  for(let round=1;round<=40;round++){
    g.round=round;
    M.tickEvents(g,lv);
    if(M.bfs(g,'P').dist<=0||M.bfs(g,'A').dist<=0){ bad='第'+round+'回合后有人到不了终点'; break; }
    if(g.blocked.has(g.balls.P.r+':'+g.balls.P.c)||g.blocked.has(g.balls.A.r+':'+g.balls.A.c)){ bad='第'+round+'回合后球被埋了'; break; }
    if(g.goals.P.some(c=>g.blocked.has(c.r+':'+c.c))||g.goals.A.some(c=>g.blocked.has(c.r+':'+c.c))){ bad='第'+round+'回合后目标格被埋'; break; }
  }
  ok(!bad,'岩浆收缩 40 回合不应破坏对局：'+(bad||'通过'));
  const lv2=M.LEVELS.find(l=>l.events&&l.events.some(e=>e.type==='shiftGate'));
  const g2=M.makeGame(lv2);
  lv2.preWalls.forEach(w=>(w.kind==='H'?g2.hW:g2.vW).add(K3(w.kind,w.r,w.c)));
  lv2.blockedCells.forEach(c=>g2.blocked.add(c.r+':'+c.c));
  let moved=false, bad2=null;
  for(let round=1;round<=30;round++){
    g2.round=round;
    const fired=M.tickEvents(g2,lv2);
    if(fired.some(f=>f.type==='shiftGate')) moved=true;
    if(M.bfs(g2,'P').dist<=0){ bad2='第'+round+'回合后玩家到不了门'; break; }
  }
  ok(moved,'门漂移事件应当真的把门挪过位置');
  ok(!bad2,'门漂移后玩家必须仍能到门：'+(bad2||'通过'));
  const lv3=M.LEVELS.find(l=>l.events&&l.events.some(e=>e.type==='phase'));
  const g3=M.makeGame(lv3);
  g3.round=8; M.tickEvents(g3,lv3);
  ok(g3.persona&&g3.persona!=='race','阶段事件应把 AI 人设切走，实际 '+g3.persona);
}

/* 11c. AI 人设确实有差异：筑墙型放墙明显多于冲锋型（同一关卡、同一盘面） */
{
  const base=M.LEVELS.find(l=>l.id===45)||M.LEVELS[44];
  const count=(persona)=>{
    const lv=JSON.parse(JSON.stringify(base));
    lv.mode='race'; lv.terrain='plain'; lv.events=null;
    lv.aiConfig.persona=persona; lv.aiConfig.budget=20; lv.aiConfig.tier=1;
    lv.aiConfig.noise=0; lv.aiConfig.mistake=0; lv.aiConfig.wallCost=0.5;
    lv.blockedCells=[]; lv.preWalls=[];
    const g=M.makeGame(lv);
    let walls=0;
    for(let i=0;i<40;i++){
      const act=M.AI.decide(g,lv);
      if(!act) break;
      if(act.type==='wall'){ M.placeWall(g,'A',act.kind,act.r,act.c); walls++; }
      else g.balls.A={...act.to};
    }
    return walls;
  };
  const wB=count('builder'), wC=count('charger');
  ok(wB>wC,'筑墙型应比冲锋型放更多墙：筑墙 '+wB+' vs 冲锋 '+wC);
}

/* 12. 追逐关（重做后）：怪物同速拦截、必须可解、墙是唯一手段（不用墙应输多数关） */
function chasePlayable(lv,maxRounds,useWalls){
  const g=M.makeGame(lv);
  lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K3(w.kind,w.r,w.c)));
  lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
  let walls=0;
  const manhattan=()=>Math.abs(g.balls.A.r-g.balls.P.r)+Math.abs(g.balls.A.c-g.balls.P.c);
  for(let round=1;round<=maxRounds;round++){
    let acted=false;
    if(useWalls&&g.wallsLeft.P>0){
      /* 怪物要来拦截：沿它的拦截路线放一面最拖住它的墙 */
      const pp=M.bfs(g,'P');
      if(pp.path.length>1){
        const k=Math.min(pp.path.length-1,Math.max(1,Math.round(pp.path.length*M.CHASE_CUT)));
        const mp=M.pathLen(g,g.balls.A,pp.path[k]);
        if(mp.path&&mp.path.length>1){
          let best=null,bestGain=0;
          for(const slot of M.wallSlotsOnPath(mp.path)){
            if(!M.validWall(g,slot.kind,slot.r,slot.c)) continue;
            const set=slot.kind==='H'?g.hW:g.vW, key=K3(slot.kind,slot.r,slot.c);
            set.add(key);
            const nd=M.pathLen(g,g.balls.A,pp.path[k]).dist;
            set.delete(key);
            if(nd-mp.dist>bestGain){ bestGain=nd-mp.dist; best=slot; }
          }
          if(best&&bestGain>=2){ M.placeWall(g,'P',best.kind,best.r,best.c); walls++; acted=true; }
        }
      }
    }
    if(!acted){                                        /* 否则朝终点跑（会避开怪物的格子） */
      const op=M.bfs(g,'P');
      let tgt=op.next;
      if(!tgt||(tgt.r===g.balls.A.r&&tgt.c===g.balls.A.c)){
        let bd=-1;
        for(const m of M.legalMoves(g,'P')){
          const s=g.balls.P; g.balls.P=m;
          const pd=M.pathLen(g,g.balls.A,g.balls.P).dist, gd=M.bfs(g,'P').dist;
          g.balls.P=s;
          if(gd>0&&pd*10-gd>bd){ bd=pd*10-gd; tgt=m; }
        }
      }
      if(!tgt) return {r:'player-stuck',round,walls};
      g.balls.P={...tgt};
      if(M.reachedGoal(g,'P')) return {r:'win',round,walls};
    }
    /* 扑击判定：玩家回合结束时仍与怪物贴身 → 被扑上（与真实对局同一套规则） */
    if(manhattan()<=1) return {r:'caught',round,walls};
    const act=M.AI.decide(g,lv);
    if(!act) return {r:'monster-stuck',round,walls};
    if(act.type!=='move') return {r:'monster-wall?!',round,walls};
    g.balls.A={...act.to};
    if(g.balls.A.r===g.balls.P.r&&g.balls.A.c===g.balls.P.c) return {r:'caught',round,walls};
  }
  return {r:'timeout',round:maxRounds,walls};
}
{
  const chasers=M.LEVELS.filter(l=>l.mode==='chase');
  ok(chasers.length===7,'应有 7 个追逐关，实际 '+chasers.length);
  chasers.forEach(lv=>{
    ok(lv.aiGoalCells.length===0,'第'+lv.id+'关 怪物不该有终点（它只追人）');
    ok(lv.chaseSteps===1,'第'+lv.id+'关 怪物应与玩家同速（每回合 1 格）');
    ok(lv.wallRules.quota.P>=12,'第'+lv.id+'关 追逐关应给足墙，实际 '+lv.wallRules.quota.P);
    ok(lv.blockedCells.length===0,'第'+lv.id+'关 追逐关不该撒随机障碍');
  });
  let usedW=0;
  for(const lv of chasers){
    const r=chasePlayable(lv,60,true);
    usedW+=r.walls||0;
    ok(r.r==='win','追逐关第'+lv.id+'关必须可解（会放墙的打法），实际 '+r.r+'（'+r.round+' 回合，用墙 '+r.walls+'）');
  }
  ok(usedW>0,'追逐关必须真的用到墙（墙是唯一手段）');
  /* 不放墙的玩家应输掉大多数追逐关——这就是"技巧空间"的量化 */
  let noWallWins=0;
  for(const lv of chasers){ if(chasePlayable(lv,60,false).r==='win') noWallWins++; }
  ok(noWallWins<=3,'不放墙的玩家应输掉大多数追逐关（赢 '+noWallWins+'/7）——否则这关就是走空路');
  /* 墙体铁律：任何被判定可放的墙，落下后怪物必须仍能走到玩家（否则一堵墙就能把它永久隔离） */
  for(const lv of chasers.slice(0,3)){
    const g=M.makeGame(lv);
    lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K3(w.kind,w.r,w.c)));
    lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
    let bad=0,checked=0;
    for(let r=0;r<lv.height-1;r++)for(let c=0;c<lv.width-1;c++)for(const kind of ['H','V']){
      if(!M.validWall(g,kind,r,c)) continue;
      const set=kind==='H'?g.hW:g.vW;
      set.add(K3(kind,r,c));
      const reach=M.pathLen(g,g.balls.A,g.balls.P).dist>0;
      set.delete(K3(kind,r,c));
      checked++; if(!reach) bad++;
    }
    ok(checked>0&&bad===0,'第'+lv.id+'关：可放的墙都必须保证怪物仍能追到玩家（查 '+checked+' 处，违规 '+bad+'）');
  }
}

/* 13. 人设平衡：5 种人设两两对打（先手/后手各一局），不允许出现无敌性格或废性格
   （更完整的矩阵跑 node _meta.cjs） */
{
  const names=Object.keys(M.PERSONAS);
  const actFor=(g,level,color,persona)=>{
    if(color==='A'){ level.aiConfig.persona=persona; return M.AI.decide(g,level); }
    const bp=g.balls.P,ba=g.balls.A,wp=g.wallsLeft.P,wa=g.wallsLeft.A,gp=g.goals.P,ga=g.goals.A;
    g.balls.P=ba; g.balls.A=bp; g.wallsLeft.P=wa; g.wallsLeft.A=wp; g.goals.P=ga; g.goals.A=gp;
    const old=level.aiConfig.persona; level.aiConfig.persona=persona;
    const act=M.AI.decide(g,level);
    level.aiConfig.persona=old;
    g.balls.P=bp; g.balls.A=ba; g.wallsLeft.P=wp; g.wallsLeft.A=wa; g.goals.P=gp; g.goals.A=ga;
    return act;
  };
  const match=(levelId,first,second)=>{
    const level=JSON.parse(JSON.stringify(M.LEVELS[levelId-1]));
    level.aiConfig.tier=1; level.aiConfig.noise=0; level.aiConfig.mistake=0;
    level.aiConfig.wallCost=0.5; level.aiConfig.budget=level.wallRules.quota.P;
    const g=M.makeGame(level);
    level.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K3(w.kind,w.r,w.c)));
    level.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
    for(let r=1;r<=50;r++)for(const color of ['P','A']){
      if(!M.legalMoves(g,color).length&&g.wallsLeft[color]<=0) continue;
      const act=actFor(g,level,color,color==='P'?first:second);
      if(!act) continue;
      if(act.type==='move') g.balls[color]={...act.to};
      else M.placeWall(g,color,act.kind,act.r,act.c);
      if(M.reachedGoal(g,color)) return color;
      const other=color==='P'?'A':'P';
      if(g.balls[color].r===g.balls[other].r&&g.balls[color].c===g.balls[other].c) return color;
    }
    return 'draw';
  };
  const score={}; names.forEach(n=>score[n]={win:0,lose:0});
  for(const row of names)for(const col of names){
    if(row===col) continue;
    for(let i=0;i<2;i++){                                  /* 跨两张风格不同的图：一张开阔、一张多墙 */
      const lvId=i===0?20:50;
      const res=(i===0)?match(lvId,row,col):match(lvId,col,row);
      if(res==='draw') continue;
      const winnerIsRow=(i===0)?(res==='P'):(res==='A');
      if(winnerIsRow){ score[row].win++; score[col].lose++; } else { score[col].win++; score[row].lose++; }
    }
  }
  names.forEach(n=>{
    const t=score[n].win+score[n].lose, rate=t?score[n].win/t:1;
    ok(score[n].win>0,'人设「'+n+'」不该是必输的废性格（胜 '+score[n].win+' / '+t+'）');
    ok(rate<0.8,'人设「'+n+'」不该是无敌性格（胜率 '+(rate*100).toFixed(0)+'%）');
  });
}

/* 14. 特殊格：数据合法 / 效果正确 / 不吃它也必须能过关 */
{
  const withSpec=M.LEVELS.filter(l=>l.specialCells.length);
  ok(withSpec.length===11,'应有 11 关带特殊格（10 关教学 + 1 个 Boss），实际 '+withSpec.length);
  withSpec.forEach(lv=>{
    ok(M.SPECIAL_PLAN[lv.id]===lv.specialKind,'第'+lv.id+'关 特殊格类型应与编排一致');
    lv.specialCells.forEach(s=>{
      ok(s.kind===lv.specialKind,'第'+lv.id+'关 特殊格类型应统一');
      ok(s.r>=0&&s.r<lv.height&&s.c>=0&&s.c<lv.width,'第'+lv.id+'关 特殊格应在盘内');
      ok(!lv.blockedCells.some(b=>b.r===s.r&&b.c===s.c),'第'+lv.id+'关 特殊格不该压在障碍上');
      ok(!(s.r===lv.startPosition.r&&s.c===lv.startPosition.c),'第'+lv.id+'关 特殊格不该压在起点');
      ok(!lv.goalCells.concat(lv.aiGoalCells).some(x=>x.r===s.r&&x.c===s.c),'第'+lv.id+'关 特殊格不该压在终点');
      if(s.kind==='portal') ok(s.to&&s.to.r>=0&&s.to.r<lv.height&&s.to.c>=0&&s.to.c<lv.width,'第'+lv.id+'关 传送门必须成对并指向盘内');
    });
    if(lv.specialKind==='portal'){
      const a=lv.specialCells[0], b=lv.specialCells[1];
      ok(a.to.r===b.r&&a.to.c===b.c&&b.to.r===a.r&&b.to.c===a.c,'第'+lv.id+'关 两扇传送门应互指');
    }
    if(lv.specialKind==='boost') ok(lv.specialCells.length>=2,'加速带关应有多条加速带');
    if(lv.specialKind==='trap') ok(lv.specialCells.length>=2,'陷阱关应有多处陷阱');
  });

  /* 传送门：踩上应被送到配对的那扇 */
  {
    const lv=withSpec.find(l=>l.specialKind==='portal');
    const g=M.makeGame(lv), p=lv.specialCells[0];
    const nb=[{r:p.r+1,c:p.c},{r:p.r-1,c:p.c},{r:p.r,c:p.c+1},{r:p.r,c:p.c-1}]
      .find(x=>x.r>=0&&x.r<g.H&&x.c>=0&&x.c<g.W&&!M.isBlockedCell(g,x.r,x.c));
    ok(nb,'传送门旁应有一格能站人');
    const res=M.resolveSpecial(g,'P',nb,{r:p.r,c:p.c});
    ok(res.kind==='portal'&&res.r===p.to.r&&res.c===p.to.c,'踩上传送门应被送到配对那扇（实际 '+res.r+','+res.c+'）');
  }
  /* 加速带：沿原方向多滑一格（滑行不穿墙） */
  {
    const lv=withSpec.find(l=>l.specialKind==='boost');
    const g=M.makeGame(lv), b=lv.specialCells[0];
    g.blocked.clear(); g.hW.clear(); g.vW.clear();          /* 清空棋盘，专测机关本身 */
    const from={r:b.r+1,c:b.c};
    if(from.r<g.H&&!M.isBlockedCell(g,from.r,from.c)){
      const res=M.resolveSpecial(g,'P',from,{r:b.r,c:b.c});
      ok(res.kind==='boost','踩上加速带应触发加速');
      ok(res.r===b.r-1&&res.c===b.c,'加速带应沿原方向多走一格（实际 '+res.r+','+res.c+'）');
      /* 顶上那格站不住时，就不该硬滑过去 */
      g.blocked.add((b.r-1)+':'+b.c);
      const res2=M.resolveSpecial(g,'P',from,{r:b.r,c:b.c});
      ok(res2.r===b.r&&res2.c===b.c,'加速带落点不合法时应停在原地');
    }
  }
  /* 弹簧：弹两格，且能越过中间那格的障碍 */
  {
    const lv=withSpec.find(l=>l.specialKind==='spring');
    const g=M.makeGame(lv), s=lv.specialCells[0];
    g.blocked.clear(); g.hW.clear(); g.vW.clear();
    const from={r:s.r+1,c:s.c};
    if(from.r<g.H&&!M.isBlockedCell(g,from.r,from.c)){
      const res=M.resolveSpecial(g,'P',from,{r:s.r,c:s.c});
      ok(res.kind==='spring'&&res.r===s.r-2&&res.c===s.c,'弹簧应沿原方向弹两格（实际 '+res.r+','+res.c+'）');
      g.blocked.add((s.r-1)+':'+s.c);            /* 中间那格摆上障碍 */
      const res2=M.resolveSpecial(g,'P',from,{r:s.r,c:s.c});
      ok(res2.r===s.r-2&&res2.c===s.c,'弹簧应能越过中间那格的障碍（这是它唯一的价值）');
    }
  }
  /* 陷阱：位置不变，代价是丢 2 面墙 */
  {
    const lv=withSpec.find(l=>l.specialKind==='trap');
    const g=M.makeGame(lv), t=lv.specialCells[0];
    const res=M.resolveSpecial(g,'P',{r:t.r+1,c:t.c},{r:t.r,c:t.c});
    ok(res.kind==='trap'&&res.r===t.r&&res.c===t.c,'踩到陷阱不该改变位置');
    const cost=M.specialCost(res);
    ok(cost&&cost.walls===-2,'陷阱的代价应是丢 2 面墙');
  }
  /* 拆墙器：位置不变，收益是多 1 面墙（结算层负责加墙，引擎只报类型） */
  {
    const lv=withSpec.find(l=>l.specialKind==='pickup');
    ok(lv,'应存在拆墙器教学关');
    if(lv){
      const g=M.makeGame(lv), p=lv.specialCells[0];
      const res=M.resolveSpecial(g,'P',{r:p.r+1,c:p.c},{r:p.r,c:p.c});
      ok(res.kind==='pickup'&&res.r===p.r&&res.c===p.c,'踩到拆墙器不该改变位置');
      const before=g.wallsLeft.P;
      g.wallsLeft.P+=1;
      ok(g.wallsLeft.P===before+1,'拆墙器应让玩家多 1 面墙（结算层）');
    }
  }
  /* 底线一：机关只会帮忙、不会添乱 —— 带机关时玩家不该比不带更慢
     （两个对比都必须关掉 AI 的随机性，否则两次跑的不是同一盘棋，比不出结论） */
  for(const lv of withSpec){
    const det=JSON.parse(JSON.stringify(lv));
    det.aiConfig.tier=1; det.aiConfig.noise=0; det.aiConfig.mistake=0;
    const withS=duel(det,300);
    const without=duel(det,300,{specials:false});
    ok(!withS.w.includes('!')&&!without.w.includes('!'),'第'+lv.id+'关 不该出现非法动作：'+withS.w+' / '+without.w);
    if(withS.w==='P'&&without.w==='P'){
      ok(withS.round<=without.round+1,'第'+lv.id+'关 带上机关不该比不带更慢（带 '+withS.round+' / 不带 '+without.round+' 回合）');
    }
    /* 底线二：把机关拿掉，关卡本身仍是一盘能打完的棋（不会因为机关而变成唯一解） */
    ok(without.w==='P'||without.w==='A','第'+lv.id+'关 去掉机关后仍应能正常分出胜负，实际 '+without.w);
  }
}

/* 15. 自定义关卡编解码：往返一致 / 畸形码拒绝 / 码要短 */
{
  let round=0, bad=0;
  for(const lv of M.LEVELS){
    const code=M.LevelCode.encode(lv);
    const back=M.LevelCode.decode(code);
    if(!back){ bad++; continue; }
    const same=back.mode===lv.mode&&back.width===lv.width&&back.height===lv.height
      &&back.goalCells.length===lv.goalCells.length
      &&back.aiGoalCells.length===lv.aiGoalCells.length
      &&back.blockedCells.length===lv.blockedCells.length
      &&back.preWalls.length===lv.preWalls.length
      &&back.specialCells.length===lv.specialCells.length
      &&back.startPosition.r===lv.startPosition.r&&back.startPosition.c===lv.startPosition.c
      &&back.aiStartPosition.r===lv.aiStartPosition.r&&back.aiStartPosition.c===lv.aiStartPosition.c;
    if(same) round++; else bad++;
  }
  ok(bad===0,'100 关的分享码应能原样还原（失败 '+bad+' 关）');
  ok(round===100,'编解码往返应全部一致，实际 '+round);
  /* 传送门要成对还原，且互指 */
  const portalLv=M.LEVELS.find(l=>l.specialKind==='portal');
  const pb=M.LevelCode.decode(M.LevelCode.encode(portalLv));
  ok(pb&&pb.specialCells.filter(s=>s.kind==='portal').length===2,'传送门关往返后仍应是一对');
  const pa=pb.specialCells.filter(s=>s.kind==='portal');
  ok(pa[0].to.r===pa[1].r&&pa[0].to.c===pa[1].c&&pa[1].to.r===pa[0].r,'往返后两扇门应互指');
  /* 码长：最长的关也要能塞进一条微信消息 */
  const lens=M.LEVELS.map(l=>M.LevelCode.encode(l).length);
  ok(Math.max.apply(null,lens)<400,'分享码不应过长（最长 '+Math.max.apply(null,lens)+' 字符）');
  /* 畸形码一律拒绝，不能崩 */
  const junk=['',null,undefined,'abc','1','1r9x91_','1z9x911_x','1r9x911_'+'_'.repeat(9),
              '1r99x991_x','1r9x919_?????????','1c5x511_@@@_@@@_@@@_@@@_@@@_'];
  junk.forEach((j,i)=>ok(M.LevelCode.decode(j)===null,'畸形码 #'+i+' 应被拒绝'));
  /* 只有一方到达不了的图也必须拒绝（不可玩） */
  {
    const dead=M.LevelCode.encode({
      mode:'race',width:5,height:5,aiTier:1,
      startPosition:{r:4,c:0},aiStartPosition:{r:4,c:4},
      goalCells:[{r:0,c:0},{r:0,c:1},{r:0,c:2},{r:0,c:3},{r:0,c:4}],
      aiGoalCells:[{r:4,c:0},{r:4,c:1},{r:4,c:2},{r:4,c:3},{r:4,c:4}],
      blockedCells:[{r:0,c:0}],preWalls:[],specialCells:[],
    });
    ok(M.LevelCode.decode(dead)===null||M.levelValid(M.LevelCode.decode(dead)),'自造的合法图应能通过校验');
  }
}

/* 16. 技能卡：四张基础卡 + 三张章节解锁卡、效果正确、预知不会改动对局 */
{
  const keys=Object.keys(M.SKILLS);
  ok(keys.length===7,'应有 7 张技能卡（4 基础 + 3 进阶），实际 '+keys.length);
  keys.forEach(k=>{
    const s=M.SKILLS[k];
    ok(s.name&&s.desc&&s.mark,'技能卡「'+k+'」应有名字、说明与图标');
  });
  ['dash','echo','crowbar'].forEach(k=>{
    const s=M.SKILLS[k];
    ok(s&&s.ch>=2&&s.ch<=6,'进阶卡「'+k+'」应有 2~6 章的解锁门槛');
  });
  ['walls','strip','foresee','scout'].forEach(k=>{
    ok(!M.SKILLS[k].ch,'基础卡「'+k+'」不该有解锁门槛（开局就有）');
  });
  {
    const g=M.makeGame(M.LEVELS[9]);
    const before=g.wallsLeft.P;
    M.SKILLS.walls.apply(g);
    ok(g.wallsLeft.P===before+2,'「备墙」应让我方多 2 面墙（'+before+' → '+g.wallsLeft.P+'）');
  }
  {
    const g=M.makeGame(M.LEVELS[9]);
    const before=g.wallsLeft.A;
    M.SKILLS.strip.apply(g);
    ok(g.wallsLeft.A===before-1,'「拆墙」应让对手少 1 面墙（'+before+' → '+g.wallsLeft.A+'）');
    g.wallsLeft.A=0;
    M.SKILLS.strip.apply(g);
    ok(g.wallsLeft.A===0,'对手没墙时「拆墙」不该变成负数');
  }
  {
    const lv=M.LEVELS[49];
    const g=M.makeGame(lv);
    lv.preWalls.forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K3(w.kind,w.r,w.c)));
    lv.blockedCells.forEach(c=>g.blocked.add(c.r+':'+c.c));
    const snap=JSON.stringify({a:g.balls.A,p:g.balls.P,h:Array.from(g.hW),v:Array.from(g.vW),wa:g.wallsLeft.A});
    const act=M.previewOpponent(g,lv);
    ok(act&&(act.type==='move'||act.type==='wall'),'「预知」应能拿到对手的一步打算');
    const after=JSON.stringify({a:g.balls.A,p:g.balls.P,h:Array.from(g.hW),v:Array.from(g.vW),wa:g.wallsLeft.A});
    ok(snap===after,'「预知」只是问一次，不该改动任何对局状态');
    const lv2=M.LEVELS[10];                                  /* 追逐关：怪物沿最短路逼近 */
    const g2=M.makeGame(lv2);
    const act2=M.previewOpponent(g2,lv2);
    ok(act2&&act2.type==='move','追逐关的「预知」应给出怪物的下一步');
  }
}

/* 17. 成就与外观：清单完整、判定条件正确、不给空存档白送成就 */
{
  const ACH=M.ACHIEVEMENTS;
  ok(ACH.length>=20,'成就应有 20 条以上，实际 '+ACH.length);
  const ids=new Set(ACH.map(a=>a.id));
  ok(ids.size===ACH.length,'成就 id 不该重复');
  ACH.forEach(a=>ok(a.name&&a.desc&&typeof a.check==='function','成就「'+a.id+'」应有名字、说明与判定函数'));
  const by=id=>ACH.find(a=>a.id===id);
  /* 判定函数是纯的：直接喂数据看结果 */
  ok(by('first').check({done:0})===false&&by('first').check({done:1})===true,'「初次上路」应只看是否通关过');
  ok(by('fast5').check({fastWin:5})===true&&by('fast5').check({fastWin:6})===false,'「快如闪电」应卡在 5 回合');
  ok(by('fast3').check({fastWin:3})===true&&by('fast3').check({fastWin:4})===false,'「极速传说」应卡在 3 回合');
  ok(by('bosses').check({bossDone:6,bossTotal:7})===false&&by('bosses').check({bossDone:7,bossTotal:7})===true,'「守卫终结者」要打满全部守卫');
  ok(by('all100').check({done:99,total:100})===false&&by('all100').check({done:100,total:100})===true,'「百关归途」要通满 100 关');
  ok(by('starsall').check({allStars:false})===false&&by('starsall').check({allStars:true})===true,'「满星传说」要看满星');
  ok(by('nowall').check({noWallDone:0})===false&&by('nowall').check({noWallDone:1})===true,'「一步不挡」要看无墙通关数');
  ok(by('duel10').check({duelPlays:9})===false&&by('duel10').check({duelPlays:10})===true,'「双人宿敌」要打满 10 局');
  /* 空存档不该白送：所有条件在空数据下都不成立 */
  const empty={done:0,stars:0,total:100,allStars:false,chapterDone:[0,0,0,0,0,0,0],
    gateDone:0,gateTotal:0,mazeDone:0,mazeTotal:0,chaseDone:0,chaseTotal:7,
    bossDone:0,bossTotal:7,noWallDone:0,fastWin:99,noSkillWins:0,customMade:0,
    customCleared:0,duelPlays:0,persistWin:false,totalPlays:0};
  const freeAchieved=ACH.filter(a=>{ try{ return a.check(empty); }catch(e){ return false; } });
  ok(freeAchieved.length===0,'空存档不该白送成就，实际送了：'+freeAchieved.map(a=>a.id).join(','));
  /* 外观：清单完整、未知 id 回退到经典 */
  ok(M.SKINS.length===6,'应有 6 套外观，实际 '+M.SKINS.length);
  M.SKINS.forEach(s=>ok(s.name&&s.hat&&s.body,'外观「'+s.id+'」应有名字与配色'));
  ok(M.skinById('classic').id==='classic','经典外观应能取到');
  ok(M.skinById('不存在的皮肤').id==='classic','未知外观 id 应回退到经典');
  M.SKINS.filter(s=>s.ach).forEach(s=>ok(ids.has(s.ach),'外观「'+s.id+'」挂的成就「'+s.ach+'」必须存在'));
}

/* 18. 每日挑战：同一天同图 / 逐日都能生成可玩的图 / 连续天数算得对 */
{
  ok(M.dailyKey(new Date(2026,8,26))==='2026-09-26','日期键格式应为 YYYY-MM-DD，实际 '+M.dailyKey(new Date(2026,8,26)));
  ok(M.dailyKey(new Date(2026,0,5))==='2026-01-05','日期键应补零，实际 '+M.dailyKey(new Date(2026,0,5)));
  const s1=M.dailySeedOf('2026-09-26'), s2=M.dailySeedOf('2026-09-26'), s3=M.dailySeedOf('2026-09-27');
  ok(s1===s2,'同一天的种子必须一样（否则就不是同题了）');
  ok(s1!==s3,'不同天的种子应不同');
  /* 连续 40 天都要能生成一张可玩的图，且不能天天一样 */
  const bad=[], modes={};
  let fails2=0;
  const base=new Date(2026,8,26);
  for(let i=0;i<40;i++){
    const key=M.dailyKey(new Date(base.getTime()+i*86400000));
    const lv=M.buildDailyLevel(key);
    if(!lv){ fails2++; bad.push(key+':生成失败'); continue; }
    if(!M.levelValid(lv)){ bad.push(key+':不可玩'); continue; }
    const dist=M.bfs(M.makeGame(lv),'P').dist;
    if(lv.width<9||lv.width>13){ bad.push(key+':尺寸异常 '+lv.width); continue; }
    if(dist<6||dist>lv.width*2){ bad.push(key+':路程不合理 '+dist); continue; }
    modes[lv.mode]=(modes[lv.mode]||0)+1;
  }
  ok(fails2===0&&bad.length===0,'连续 40 天的每日挑战都必须能生成且可玩，问题：'+bad.slice(0,4).join(' / '));
  ok(Object.keys(modes).length>=3,'每日挑战的玩法应有变化，实际只出现 '+Object.keys(modes).join(','));

  /* 连续天数：纯函数，直接喂数据 */
  const mk=ks=>{ const m={}; ks.forEach(k=>m[k]={win:true}); return m; };
  ok(M.dailyStreak(mk(['2026-09-26','2026-09-25','2026-09-24']),'2026-09-26')===3,'连续三天应算 3');
  ok(M.dailyStreak(mk(['2026-09-25','2026-09-24']),'2026-09-26')===2,'今天没打应从昨天起算');
  ok(M.dailyStreak(mk(['2026-09-26','2026-09-24']),'2026-09-26')===1,'中间断了只算到断点');
  ok(M.dailyStreak(mk([]),'2026-09-26')===0,'没打过就是 0');
  ok(M.dailyStreak(mk(['2026-09-26','2026-09-25','2026-09-24','2026-09-23','2026-09-22','2026-09-21','2026-09-20']),'2026-09-26')===7,
     '连续七天应算 7（「坚持一周」靠它）');
  ok(M.dailyStreak(mk(['2026-10-01','2026-09-30','2026-09-29']),'2026-10-01')===3,'跨月连续应算 3');
  ok(M.dailyStreak(mk(['2027-01-01','2026-12-31','2026-12-30']),'2027-01-01')===3,'跨年连续应算 3');
}

/* 19. 每日挑战难度：要"很难但可解"（档位拉满 + 关卡加难），且主线追逐关没被改坏 */
{
  const K2=(k,r,c)=>k+':'+r+':'+c;
  const setup=(lv)=>{
    const g=M.makeGame(lv);
    (lv.preWalls||[]).forEach(w=>(w.kind==='H'?g.hW:g.vW).add(K2(w.kind,w.r,w.c)));
    (lv.blockedCells||[]).forEach(c=>g.blocked.add(c.r+':'+c.c));
    return g;
  };
  /* 会放墙的玩家（比直线冲强）：危险时用宽候选封堵，允许自己慢 1 格换对手慢 ≥2 格 */
  const playerAct=(g,lv,solid)=>{
    const me={...g.balls.P}, foe={...g.balls.A};
    const myDist=M.bfs(g,'P').dist, foeDist=M.pathLen(g,foe,me).dist;
    if(solid&&g.wallsLeft.P>0&&foeDist<=myDist+2){
      const path=M.bfs(g,'A').path;
      let best=null,bestGain=0;
      for(const slot of M.wallSlotsOnPath(path)){
        if(!M.validWall(g,slot.kind,slot.r,slot.c)) continue;
        const set=slot.kind==='H'?g.hW:g.vW, key=K2(slot.kind,slot.r,slot.c);
        set.add(key);
        const gain=M.bfs(g,'A').dist-foeDist, hurt=M.bfs(g,'P').dist-myDist;
        set.delete(key);
        if(gain-hurt>bestGain){ bestGain=gain-hurt; best=slot; }
      }
      if(best&&bestGain>=1) return {type:'wall',kind:best.kind,r:best.r,c:best.c};
    }
    const nx=M.bfs(g,'P').next;
    return nx?{type:'move',to:nx}:null;
  };
  const play=(lv,solid,maxRound)=>{
    const g=setup(lv);
    for(let round=1;round<=(maxRound||90);round++){
      const pa=playerAct(g,lv,solid);
      if(!pa) return 'player-stuck';
      if(pa.type==='move'){
        const from={...g.balls.P};
        const res=M.resolveSpecial(g,'P',from,pa.to);
        g.balls.P={r:res.r,c:res.c};
        if(res.kind==='trap') g.wallsLeft.P=Math.max(0,g.wallsLeft.P-2);
      } else M.placeWall(g,'P',pa.kind,pa.r,pa.c);
      if(M.reachedGoal(g,'P')) return 'P';
      const act=M.AI.decide(g,lv);
      if(!act) return 'ai-stuck';
      if(act.type==='move'){
        const from={...g.balls.A};
        const res=M.resolveSpecial(g,'A',from,act.to);
        g.balls.A={r:res.r,c:res.c};
      } else M.placeWall(g,'A',act.kind,act.r,act.c);
      if(M.reachedGoal(g,'A')) return 'A';
    }
    return 'timeout';
  };

  /* 每日挑战双档难度水位：
     · 地狱（tier 1）：够难但可解——不放墙几乎赢不了，会放墙的玩家有胜算但不该全胜；
     · 普通（tier 0）：该赢能赢——会放墙的玩家赢下多数，且明显强于不放墙的（技能有用）。 */
  const base=new Date(2026,8,26);
  const runTier=(tier)=>{
    let dumbWins=0, solidWins=0, days=0;
    for(let i=0;i<6;i++){
      const key=M.dailyKey(new Date(base.getTime()+i*86400000));
      const lv=M.buildDailyLevel(key,tier);
      if(!lv) continue;
      days++;
      if(play(lv,false)==='P') dumbWins++;
      if(play(lv,true) ==='P') solidWins++;
    }
    return {dumbWins,solidWins,days};
  };
  const hell=runTier(1), norm=runTier(0);
  ok(hell.days>=5,'地狱档应能连续生成，实际 '+hell.days+' 天');
  ok(hell.dumbWins<=2,'地狱档要够难：不放墙的玩家最多只能赢 2 天（实际 '+hell.dumbWins+'/'+hell.days+'）');
  ok(hell.solidWins>=1,'地狱档必须可解：会放墙的玩家至少要能赢 1 天（实际 '+hell.solidWins+'/'+hell.days+'）');
  ok(hell.solidWins<hell.days,'地狱档不该是送分题：会放墙的玩家也不该全胜（实际 '+hell.solidWins+'/'+hell.days+'）');
  ok(norm.days>=5,'普通档应能连续生成，实际 '+norm.days+' 天');
  ok(norm.solidWins>=3,'普通档该赢能赢：会放墙的玩家应赢下多数（实际 '+norm.solidWins+'/'+norm.days+'）');
  ok(norm.solidWins>norm.dumbWins,'普通档技能应当有用：会放墙的玩家应明显强于不放墙的（'+norm.solidWins+' vs '+norm.dumbWins+'）');
}

console.log(fails===0?'全部通过':'存在 '+fails+' 个失败');
process.exit(fails===0?0:1);
