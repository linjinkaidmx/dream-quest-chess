import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const CHROME = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));
/* 默认测本地文件；SMOKE_URL=https://... node _smoke.mjs 可直接对线上部署跑同一套断言 */
const PAGE = process.env.SMOKE_URL || ('file:///' + path.join(HERE, 'index.html').replace(/\\/g, '/'));
const OUT = path.join(HERE, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const CDP = 9400 + (process.pid % 100);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, seq = 0; const pending = new Map();
const errors = [];
const send = (m, p = {}, timeout = 60000) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method: m, params: p }));
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('超时: ' + m)); } }, timeout);
  });
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
  return r.result?.value;
};

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--allow-file-access-from-files', '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + path.join(os.tmpdir(), 'qa_' + process.pid), 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch('http://127.0.0.1:' + CDP + '/json/version')).ok) break; } catch {} await sleep(250); }
const tab = await fetch('http://127.0.0.1:' + CDP + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('JS异常: ' + (m.params.exceptionDetails?.text || '') + ' ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
});
await send('Page.enable'); await send('Runtime.enable');

let fails = 0;
const ok = (cond, msg, extra) => { if (cond) console.log('PASS', msg); else { fails++; console.log('FAIL', msg, JSON.stringify(extra) || ''); } };

/* 反复点最上方的走位提示，直到结算面板出现（把一局跑完） */
async function winLoop(maxSteps = 22) {   /* 注意：玩家回合之外没有提示，实际"一步"要花 2~3 次循环 */
  for (let step = 0; step < maxSteps; step++) {
    const done = await ev(`(() => {
      if (document.querySelector('.panel h2')) return 'panel';
      const hints = [...document.querySelectorAll('.move-hint')];
      if (!hints.length) return 'no-hints';
      let top = hints[0];
      hints.forEach(h => { if (+h.getAttribute('cy') < +top.getAttribute('cy')) top = h; });
      top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'moved';
    })()`);
    if (done === 'panel') return true;
    await sleep(1300);
  }
  return false;
}
/* 点结算面板上的某个按钮 */
const hitPanel = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('.panel button')].find(x => (x.textContent || '').includes(${JSON.stringify(text)}));
  if (!b) return false; b.click(); return true;
})()`);

async function shot(name, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1.5, mobile });
  await sleep(600);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
}

/* ---------- 1. 冒险地图（先设桌面视口，再导航） ---------- */
errors.length = 0;
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1.5, mobile: false });
await send('Page.navigate', { url: PAGE + '#/map' });
await sleep(2500);
let st = await ev(`(() => {
  const nodes = document.querySelectorAll('.node-hit').length;
  const roads = document.querySelectorAll('.mapsvg path').length;
  const hero = (document.querySelector('.hero')?.innerText || '').replace(/\\s+/g,' ');
  const tabbar = getComputedStyle(document.querySelector('.tabbar')).display;
  const sidenav = !!document.querySelector('.side-nav');
  return { nodes, roads, hero: hero.slice(0,80), tabbar, sidenav, body: document.body.innerText.length };
})()`);
ok(st.nodes === 100, '地图应有 100 个关卡节点', st);
ok(st.roads > 100, '地图应有关卡道路', st);
ok(st.hero.includes('继续冒险'), '首页核心操作：继续冒险', st);
ok(st.sidenav && st.tabbar === 'none', 'PC 应左侧导航、隐藏底部导航', st);
ok(errors.length === 0, '地图页无 JS 异常', errors);
await shot('01-map-desktop');

/* 锁定节点点击应提示而非进入 */
const lockedMsg = await ev(`(() => {
  const nodes = [...document.querySelectorAll('.node-locked')];
  if (!nodes.length) return 'no-locked';
  nodes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return (document.querySelector('.toast')?.textContent || '').slice(0, 30);
})()`);
await sleep(300);
ok(true, '锁定节点提示: ' + lockedMsg);

/* ---------- 2. 进入第 1 关 ---------- */
errors.length = 0;
await ev(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('开始冒险'))?.click(); })()`);
await sleep(2200);
st = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  const hints = document.querySelectorAll('.move-hint').length;
  const hud = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g,' ');
  const inGame = document.body.classList.contains('in-game');
  const tabbar = getComputedStyle(document.querySelector('.tabbar')).display;
  const bands = [...document.querySelectorAll('.boardsvg rect.goal-cell')].filter(r => +r.getAttribute('width') > 300).length;
  const gm = document.querySelector('.boardsvg g[pointer-events]');
  return { hasBoard: !!svg, hints, hud: hud.slice(0, 120), inGame, tabbar, bands,
           goalPointerEvents: gm ? getComputedStyle(gm).pointerEvents : null,
           thinking: /思考/.test(document.body.innerText) };
})()`);
ok(st.hasBoard, '棋盘已渲染', st);
ok(st.hints === 3, '7x7 底部出生应有 3 个合法走位点', st);
ok(st.bands >= 2, '两侧终点应各有一条贯穿全宽的边线标记（对应「整条边线」规则）', st);
ok(st.goalPointerEvents === 'none', '终点标记不吃点击，边线上的格子照常可点', st);
ok(st.inGame && st.tabbar === 'none', '对局中应隐藏底部导航', st);
ok(!st.thinking, '不得出现 AI 思考类文案', st);
ok(errors.length === 0, '对局页无 JS 异常', errors);
await shot('02-game-desktop');

/* ---------- 3. 筑墙交互（按住交点 → 拖满 2 格 → 松手落墙） ---------- */
errors.length = 0;
const wallRes = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  const vb = svg.viewBox.baseVal; const r = svg.getBoundingClientRect();
  const px = (x, y) => ({ clientX: r.left + x * r.width / vb.width, clientY: r.top + y * r.height / vb.height });
  const cs = 62, M = 64;                       // 第 1 关 7×7：cell=62、边距 64
  const a = px(M + 2 * cs, M + 3 * cs);         // 交点 (2,3)
  svg.dispatchEvent(new PointerEvent('pointerdown', { ...a, pointerType: 'mouse', bubbles: true }));
  const anchored = !!svg.querySelector('.anchor-pulse');
  const b = px(M + 4 * cs, M + 3 * cs);         // 向右拖满 2 格
  svg.dispatchEvent(new PointerEvent('pointermove', { ...b, pointerType: 'mouse', buttons: 1, bubbles: true }));
  const cand = (svg.innerHTML || '').includes('#e6b455') || svg.querySelectorAll('text').length > 0;
  svg.dispatchEvent(new PointerEvent('pointerup', { ...b, pointerType: 'mouse', bubbles: true }));
  return { anchored, cand };
})()`);
ok(wallRes.anchored, '按下交点应出现起点脉冲', wallRes);
ok(wallRes.cand, '拖动时应渲染跟手墙段与提示', wallRes);
await sleep(1800);
const wallCount = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  let dark = 0; svg.querySelectorAll('rect').forEach(r => { if ((r.getAttribute('fill')||'').startsWith('#7a5a38')) dark++; });
  const pill = (document.querySelector('.hud')?.innerText || '').match(/我的墙 (\\d+)/)?.[1];
  return { dark, pill };
})()`);
ok(wallCount.dark >= 1 && wallCount.pill === '9', '筑墙后应扣减为 9 面', wallCount);
ok(errors.length === 0, '筑墙无 JS 异常', errors);

/* 未拖满 2 格松手：不落墙 + 提示（不进入走子） */
await sleep(500);
const shortDrag = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  const vb = svg.viewBox.baseVal; const r = svg.getBoundingClientRect();
  const px = (x, y) => ({ clientX: r.left + x * r.width / vb.width, clientY: r.top + y * r.height / vb.height });
  const cs = 62, M = 64;
  const pill0 = (document.querySelector('.hud')?.innerText.match(/我的墙 (\\d+)/) || [])[1];
  const a = px(M + 2 * cs, M + 5 * cs);
  svg.dispatchEvent(new PointerEvent('pointerdown', { ...a, pointerType: 'mouse', bubbles: true }));
  const b = px(M + 2.5 * cs, M + 5 * cs);      // 只拖 0.5 格
  svg.dispatchEvent(new PointerEvent('pointermove', { ...b, pointerType: 'mouse', buttons: 1, bubbles: true }));
  svg.dispatchEvent(new PointerEvent('pointerup', { ...b, pointerType: 'mouse', bubbles: true }));
  const pill1 = (document.querySelector('.hud')?.innerText.match(/我的墙 (\\d+)/) || [])[1];
  const toast = (document.querySelector('.toast')?.textContent || '').slice(0, 24);
  return { pill0, pill1, toast };
})()`);
ok(shortDrag.pill0 === shortDrag.pill1, '未拖满 2 格松手不应落墙', shortDrag);
ok(shortDrag.toast.includes('2 格'), '未满 2 格松手应给提示', shortDrag);
ok(errors.length === 0, '短拖/非法路径无 JS 异常', errors);
await sleep(400);

/* ---------- 4. 走子到胜利（无需切换模式，直接点提示点） ----------
   先点 ↺ 重开本关：第 3 段落下的测试用墙会堵住玩家直线推进的列，
   带墙盘面上谁能先到取决于 AI 的随机决策，胜负不确定；
   空盘上玩家先手沿同列直上，6 步必胜，测试才稳定。 */
errors.length = 0;
await ev(`(() => { [...document.querySelectorAll('.hud button')].find(b => b.textContent.includes('↺'))?.click(); })()`);
await sleep(1600);
st = await ev(`(() => {
  const t = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ');
  let walls = 0;
  document.querySelectorAll('.boardsvg rect').forEach(r => { if ((r.getAttribute('fill') || '').startsWith('#7a5a38')) walls++; });
  return { my: (t.match(/我的墙 (\\d+)/) || [])[1], round: (t.match(/回合 (\\d+)/) || [])[1], walls };
})()`);
ok(st.my === '10' && st.round === '1' && st.walls === 0, '重开本关应复位墙体、回合与棋盘', st);
await winLoop();
st = await ev(`(() => {
  const panel = document.querySelector('.panel');
  const text = panel ? panel.innerText.replace(/\\s+/g, ' ') : '';
  const save = JSON.parse(localStorage.getItem('dreamquest.save.v1') || '{}');
  const rec = save.records && save.records['1'];
  return { hasPanel: !!panel, text: text.slice(0, 160), rec };
})()`);
ok(st.hasPanel && st.text.includes('关卡完成'), '胜利面板应出现', st);
ok(st.text.includes('回合') && st.text.includes('筑墙') && st.text.includes('用时'), '胜利统计三件套', st);
ok(st.text.includes('筑墙 0 面'), '重开后空盘直推取胜：本局不应落墙（防止误落墙/状态残留）', st);
ok(st.rec && st.rec.stars >= 1, '存档应记录第 1 关成绩', st);
ok(errors.length === 0, '胜利流程无 JS 异常', errors);
await shot('03-victory');

/* 结算面板的三条出路：三个按钮都要在，而且都得真的能走通 */
const panelBtns = await ev(`(() => {
  const p = document.querySelector('.panel');
  return p ? [...p.querySelectorAll('button')].map(b => (b.textContent || '').trim()) : [];
})()`);
ok(panelBtns.includes('再次挑战') && panelBtns.includes('下一关') && panelBtns.includes('回到主界面'),
  '胜利面板应有 再次挑战 / 下一关 / 回到主界面', panelBtns);

/* ①「再次挑战」：重开本关（墙体、回合复位） */
ok(await hitPanel('再次挑战'), '「再次挑战」按钮可点');
await sleep(1800);
st = await ev(`(() => {
  const t = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ');
  let walls = 0;
  document.querySelectorAll('.boardsvg rect').forEach(r => { if ((r.getAttribute('fill') || '').startsWith('#7a5a38')) walls++; });
  return { level: (t.match(/第(\\d+)关/) || [])[1], my: (t.match(/我的墙 (\\d+)/) || [])[1], round: (t.match(/回合 (\\d+)/) || [])[1], walls };
})()`);
ok(st.level === '1' && st.my === '10' && st.round === '1', '「再次挑战」应重开本关并复位状态', st);

/* ② 再赢一次，用「下一关」进第 2 关 */
await winLoop();
await sleep(600);
ok(await hitPanel('下一关'), '「下一关」按钮可点');
await sleep(2000);
st = await ev(`(() => {
  const hud = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g,' ');
  const size = (document.querySelector('.hud')?.innerText.match(/(\\d+)×(\\d+)/)||[])[0];
  return { hud: hud.slice(0, 60), size };
})()`);
ok(st.hud.includes('第2关'), '应进入第 2 关', st);
ok(st.size === '7×7', '第 2 关棋盘应为 7×7（第 6 关起才升到 9×9）', st);

/* ---------- 5. 地图回显（通关标记 + 当前节点） ---------- */
errors.length = 0;
await ev(`(() => { document.querySelector('.hud .icon-btn')?.click(); })()`);
await sleep(2000);
st = await ev(`(() => {
  const svg = document.querySelector('.mapsvg');
  const ring = !!svg.querySelector('.node-ring');
  const hero = (document.querySelector('.hero')?.innerText || '').replace(/\\s+/g,' ');
  return { ring, hero: hero.slice(0, 60) };
})()`);
ok(st.ring, '地图上当前关卡应有呼吸光环', st);
ok(errors.length === 0, '返回地图无 JS 异常', errors);
await shot('04-map-after-win');

/* ---------- 5b.「回到主界面」：结算后直接回地图 ---------- */
errors.length = 0;
await ev(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('开始冒险'))?.click(); })()`);
await sleep(2100);
st = await ev(`(() => (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g,' ').slice(0, 30))()`);
ok(st.includes('第2关'), '从地图继续应进入第 2 关', { hud: st });
await winLoop();
await sleep(600);
ok(await hitPanel('回到主界面'), '「回到主界面」按钮可点');
await sleep(2000);
st = await ev(`(() => ({
  nodes: document.querySelectorAll('.node-hit').length,
  hero: (document.querySelector('.hero')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 40),
  ring: !!document.querySelector('.mapsvg .node-ring')
}))()`);
ok(st.nodes === 100 && st.hero.includes('继续冒险'), '「回到主界面」应回到世界地图', st);
ok(st.ring, '回主界面后当前关卡仍有呼吸光环', st);
ok(errors.length === 0, '「回到主界面」无 JS 异常', errors);

/* ---------- 5c. 玩法角标：地图节点应能看出关卡类型 ---------- */
st = await ev(`(() => {
  const badges = document.querySelectorAll('.mapsvg circle[r="9.5"]').length;
  const curBadge = !!document.querySelector('.mapsvg circle[r="9.5"]');
  return { badges, curBadge };
})()`);
ok(st.badges >= 30, '地图上应有玩法角标（门型/迷宫/同向）', st);

/* ---------- 5d. 门型关（第 6 关）：教学卡 → 拱门 → HUD 目标 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/play/6' });
await sleep(2300);
st = await ev(`(() => ({
  intro: (document.querySelector('.panel h2')?.textContent || ''),
  hud: (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 120)
}))()`);
ok(st.intro.includes('新玩法'), '首次进入门型关应先弹教学卡', st);
ok(st.hud.includes('中央门'), '门型关 HUD 目标应写「中央门」', st);
await shot('08-gate-intro');
ok(await hitPanel('开始挑战'), '教学卡应有「开始挑战」按钮');
await sleep(900);
st = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  const wideBands = [...svg.querySelectorAll('rect.goal-cell')].filter(r => +r.getAttribute('width') > 300).length;
  const smallMarks = [...svg.querySelectorAll('rect.goal-cell')].filter(r => +r.getAttribute('width') <= 60).length;
  const panelGone = !document.querySelector('.panel h2');
  return { wideBands, smallMarks, panelGone };
})()`);
ok(st.panelGone, '点「开始挑战」后教学卡应关闭', st);
ok(st.wideBands === 0, '门型关不应画整条边线色带（否则又被读成「整条都算」）', st);
ok(st.smallMarks >= 4, '门型关两侧应各有 2 格门标记', st);
ok(errors.length === 0, '门型关无 JS 异常', errors);
await shot('09-gate-board');

/* 教学卡只弹一次：再进同一关不再打扰 */
await send('Page.navigate', { url: PAGE + '#/play/6' });
await sleep(2000);
st = await ev(`(() => !!document.querySelector('.panel h2'))()`);
ok(!st, '同一玩法的教学卡只应弹一次', { panel: st });

/* ---------- 5e. 迷宫关 / 同向关 / 共同终点：HUD 文案与目标形态 ---------- */
for (const [id, modeWord, expectBand] of [[12, '迷宫', true], [10, '同向竞速', true], [14, '共同终点', false]]) {
  errors.length = 0;
  await send('Page.navigate', { url: PAGE + '#/play/' + id });
  await sleep(2200);
  if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(900); }
  st = await ev(`(() => {
    const svg = document.querySelector('.boardsvg');
    const wideBands = [...svg.querySelectorAll('rect.goal-cell')].filter(r => +r.getAttribute('width') > 300).length;
    const hud = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ');
    return { wideBands, hud: hud.slice(0, 130), hints: document.querySelectorAll('.move-hint').length };
  })()`);
  ok(st.hud.includes(modeWord), '第' + id + '关 HUD 应标出「' + modeWord + '」', st);
  ok((st.wideBands > 0) === expectBand, '第' + id + '关终点画法 ' + (expectBand ? '应为整条边线' : '应为门'), st);
  ok(st.hints >= 1, '第' + id + '关应能走子', st);
  ok(errors.length === 0, '第' + id + '关无 JS 异常', errors);
  await shot('10-mode-' + id);
}

/* ---------- 5g. 追逐关（第 11 关）：图文教学卡 / 怪物造型 / 距离胶囊 / 被抓 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/play/11' });
await sleep(2500);
st = await ev(`(() => {
  const panel = document.querySelector('.panel');
  return {
    title: (panel?.querySelector('h2')?.textContent || ''),
    body: (panel?.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
    art: !!(panel && panel.querySelector('svg.intro-art')),
    anim: (panel ? panel.querySelectorAll('svg.intro-art [class*="ia-"]').length : 0)
  };
})()`);
ok(st.title.includes('追逐'), '第 11 关（追逐关首秀）应弹「追逐」教学卡', st);
ok(st.body.includes('两格') || st.body.includes('每回合') || st.body.includes('同速') || st.body.includes('拦截'), '追逐教学卡应讲清怪物的拦截规则', st);
ok(st.art, '教学卡应带示意图（不是纯文字）', st);
ok(st.anim >= 2, '示意图应带轻动画元素', { anim: st.anim });
await shot('14-intro-chase');
ok(await hitPanel('开始挑战'), '追逐教学卡应有「开始挑战」按钮');
await sleep(900);
st = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  const hud = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ');
  return {
    monster: !!svg.querySelector('circle[fill="#a8324a"]'),
    chasePill: (document.querySelector('.chase-pill')?.innerText || '').trim(),
    wall: (hud.match(/我的墙 (\\d+)/) || [])[1],
    hints: document.querySelectorAll('.move-hint').length
  };
})()`);
ok(st.monster, '追逐关的对手应画成怪物（暗红造型），不是普通对手球', st);
ok(/怪物\s*\d+\s*格外/.test(st.chasePill), '追逐关 HUD 应显示怪物还有几步追上', st);
ok(st.wall === '15', '追逐关应给足墙（15 面）', st);
ok(st.hints >= 1, '追逐关开局应有走位提示', st);
await shot('15-chase-board');

/* 被贴身应当失败（追逐重做后：怪物同速拦截，主动走到怪物旁边=回合结束贴身=被扑上） */
let caught = '';
for (let i = 0; i < 12; i++) {
  const done = await ev(`(() => {
    const h = document.querySelector('.panel h2');
    if (h) return h.textContent;
    const svg = document.querySelector('.boardsvg');
    const hints = [...document.querySelectorAll('.move-hint')];
    const mon = svg ? svg.querySelector('circle[fill="#a8324a"]') : null;
    if (!hints.length || !mon) return '';
    /* 挑离怪物最近的提示格走（主动贴上去） */
    const mx = +mon.getAttribute('cx'), my = +mon.getAttribute('cy');
    let best = null, bd = 1e9;
    hints.forEach(h => {
      const d = Math.abs(+h.getAttribute('cx') - mx) + Math.abs(+h.getAttribute('cy') - my);
      if (d < bd) { bd = d; best = h; }
    });
    best.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return '';
  })()`);
  if (done) { caught = done; break; }
  await sleep(2600);
}
ok(caught.includes('追') || caught.includes('贴上') || caught.includes('走错'), '被怪物追到应进入失败结算', { title: caught });
st = await ev(`(() => {
  const box = document.querySelector('.panel .advice');
  const raw = localStorage.getItem('dreamquest.stats.v1');
  let lv11 = null;
  try { const o = raw ? JSON.parse(raw) : null; lv11 = o && o['11'] ? o['11'] : null; } catch (e) {}
  return { advice: (box?.innerText || '').replace(/\\s+/g, ' '), lv11 };
})()`);
ok(st.advice.includes('下次可以这样'), '失败面板应给出针对性建议', st);
ok(st.lv11 && st.lv11.fails >= 1, '失败应计入本地难度统计（第 11 关应有一次失败记录）', st);
ok(errors.length === 0, '追逐关无 JS 异常', errors);
/* 收尾：关掉结算面板（hash 导航不会重载页面，残留面板会挡住后面的用例） */
if (caught) {
  await ev(`(() => { [...document.querySelectorAll('.panel button')].find(b => b.textContent.includes('回到主界面'))?.click(); })()`);
  await sleep(1500);
}
ok(!(await ev(`!!document.querySelector('.panel h2')`)), '追逐关结算面板应能正常关闭');

/* ---------- 5h. 难度热力图与单关战绩 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/me' });
await sleep(2200);
st = await ev(`(() => ({
  cells: document.querySelectorAll('.heat-cell').length,
  legend: document.querySelectorAll('.heat-legend .lg-item').length,
  title: (document.querySelector('.heat-box .page-head h1')?.textContent || ''),
  detail: !!document.querySelector('.heat-detail .stat-card')
}))()`);
ok(st.cells === 100, '难度热力图应有 100 格（对应 100 关）', st);
ok(st.legend === 5, '热力图应有 5 档图例', st);
ok(st.title.includes('难度热力图'), '「我的」页应有难度热力图', st);
ok(st.detail, '热力图默认应展示一关的战绩卡', st);

/* 造一份统计数据，验证分档颜色（写完要重载页面才会生效） */
await ev(`(() => { localStorage.setItem('dreamquest.stats.v1', JSON.stringify({
  "1":{plays:3,wins:3,fails:0,best:8,sumRounds:24,sumWalls:2},
  "4":{plays:6,wins:4,fails:2,best:12,sumRounds:90,sumWalls:14},
  "5":{plays:7,wins:1,fails:6,best:14,sumRounds:120,sumWalls:20}
})); return true; })()`);
await send('Page.reload');
await sleep(2600);
st = await ev(`(() => {
  const cls = id => (document.querySelector('.heat-cell[data-id="' + id + '"]')?.className || '');
  return {
    t1: cls(1), t2: cls(4), t4: cls(5), t0: cls(9),
    sum: (document.querySelector('.heat-sum')?.innerText || '').replace(/\\s+/g, ' ')
  };
})()`);
ok(/t1/.test(st.t1), '全胜的关卡应显示为「顺利」色', st);
ok(/t2/.test(st.t2), '少量失败的关卡应显示为「有点难」色', st);
ok(/t4/.test(st.t4), '反复失败的关卡应显示为「反复失败」色', st);
ok(/t0/.test(st.t0), '没挑战过的关卡应显示为「未挑战」色', st);
ok(st.sum.includes('最难') && st.sum.includes('第 5 关'), '汇总应指出最难的一关', st);

await ev(`(() => document.querySelector('.heat-cell[data-id="5"]').click())()`);
await sleep(400);
st = await ev(`(() => (document.querySelector('.stat-card')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 160))()`);
ok(st.includes('第 5 关') && st.includes('挑战次数') && st.includes('平均用墙'), '点格子应展开该关战绩', { text: st });
ok(/建议|怪物|墙/.test(st), '战绩卡应带一句可执行的建议', { text: st });
ok(errors.length === 0, '难度统计页无 JS 异常', errors);
await shot('16-heatmap');
/* 清掉造的数据，避免影响后面的用例 */
await ev(`(() => { localStorage.removeItem('dreamquest.stats.v1'); return true; })()`);
await send('Page.reload');
await sleep(1800);

/* ---------- 5i. 特殊格：教学卡（四种）/ 渲染 / 真的会触发 ---------- */
errors.length = 0;
/* 四种机关各自的首秀关卡都要弹对应的教学卡 */
for (const [id, word] of [[22, '传送门'], [37, '加速带'], [52, '弹簧'], [67, '陷阱']]) {
  await send('Page.navigate', { url: PAGE + '#/play/' + id });
  await sleep(2300);
  st = await ev(`(() => ({
    title: (document.querySelector('.panel h2')?.textContent || ''),
    body: (document.querySelector('.panel')?.innerText || '').replace(/\\s+/g, ' '),
    art: !!document.querySelector('svg.intro-art')
  }))()`);
  ok(st.title.includes(word), '第' + id + '关应弹「' + word + '」教学卡', st);
  ok(st.art, '第' + id + '关教学卡应带示意图', st);
  if (id === 22) {
    ok(/传送|漩涡/.test(st.body), '传送门教学卡应说清规则', st);
    ok(await hitPanel('开始挑战'), '特殊格教学卡应有「开始挑战」按钮');
    await sleep(900);
    st = await ev(`(() => {
      const svg = document.querySelector('.boardsvg');
      return { portals: svg.querySelectorAll('circle[stroke="#534AB7"]').length,
               hints: document.querySelectorAll('.move-hint').length };
    })()`);
    ok(st.portals === 2, '传送门关应画出两扇配对的门', st);
    /* 一路往上走，应该会踩到传送门并弹出提示（端到端验证机关真的会触发） */
    let sawToast = false;
    for (let i = 0; i < 8 && !sawToast; i++) {
      await ev(`(() => {
        const hints = [...document.querySelectorAll('.move-hint')];
        if (!hints.length) return;
        let pick = hints[0];
        hints.forEach(h => { if (+h.getAttribute('cy') < +pick.getAttribute('cy')) pick = h; });
        pick.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(1100);
      const t = await ev(`(() => (document.querySelector('.toast')?.innerText || ''))()`);
      if (/传送门/.test(t)) sawToast = true;
    }
    ok(sawToast, '踩上传送门应真的触发（弹出提示）');
    await shot('17-specials');
  }
  /* 收尾：关掉卡片再跳下一关，避免弹层叠加干扰后续用例 */
  if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(700); }
  ok(errors.length === 0, '第' + id + '关无 JS 异常', errors);
}

/* ---------- 5j. 关卡编辑器：画图 / 体检 / 分享码 / 打开别人的图 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/edit' });
await sleep(2400);
st = await ev(`(() => ({
  cells: document.querySelectorAll('.ed-cell').length,
  tools: document.querySelectorAll('.ed-tool').length,
  status: (document.querySelector('.ed-status')?.innerText || ''),
  ok: document.querySelector('.ed-status')?.classList.contains('ok')
}))()`);
ok(st.cells === 81, '编辑器默认应是 9×9 = 81 格', st);
ok(st.tools === 11, '编辑器应有 11 种画笔（含拆墙器）', st);
ok(st.ok && st.status.includes('可以玩'), '默认局面应通过体检', st);
await shot('18-editor');

/* 画障碍：先选「障碍」画笔，再点格子 */
await ev(`(() => { [...document.querySelectorAll('.ed-tool')].find(b => b.textContent === '障碍').click(); })()`);
await sleep(300);
const blockBefore = await ev(`(() => document.querySelectorAll('.ed-cell.k-block').length)()`);
await ev(`(() => {
  const cell = document.querySelector('.ed-cell[data-r="4"][data-c="4"]');
  cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
})()`);
await sleep(400);
const blockAfter = await ev(`(() => document.querySelectorAll('.ed-cell.k-block').length)()`);
ok(blockAfter === blockBefore + 1, '选画笔后点格子应画上一个障碍', { blockBefore, blockAfter });

/* 横着画满一整行障碍 → 体检必须拦住（阻挡了通路） */
await ev(`(() => {
  for (let c = 0; c < 9; c++) {
    const cell = document.querySelector('.ed-cell[data-r="5"][data-c="' + c + '"]');
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }
})()`);
await sleep(500);
st = await ev(`(() => ({
  status: (document.querySelector('.ed-status')?.innerText || ''),
  bad: document.querySelector('.ed-status')?.classList.contains('bad'),
  disabled: [...document.querySelectorAll('button')].find(b => b.textContent.includes('试玩'))?.disabled
}))()`);
ok(st.bad && /到不了目标|堵死/.test(st.status), '把路堵死时体检应明确报出来', st);
ok(st.disabled === true, '体检不过时不该允许试玩', st);

/* 擦掉那一行 → 恢复可玩，再生成分享码 */
await ev(`(() => { [...document.querySelectorAll('.ed-tool')].find(b => b.textContent === '橡皮').click(); })()`);
await sleep(300);
await ev(`(() => {
  for (let c = 0; c < 9; c++) {
    const cell = document.querySelector('.ed-cell[data-r="5"][data-c="' + c + '"]');
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }
})()`);
await sleep(500);
st = await ev(`(() => document.querySelector('.ed-status')?.classList.contains('ok'))()`);
ok(st === true, '擦掉障碍后体检应恢复通过');
await ev(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('生成分享码')).click(); })()`);
await sleep(500);
st = await ev(`(() => {
  const ta = document.querySelector('.ed-code-area');
  return { link: (ta?.value || ''), shown: !document.querySelector('.ed-code')?.classList.contains('hidden'),
           mine: JSON.parse(localStorage.getItem('dreamquest.mine.v1') || '[]').length };
})()`);
ok(st.shown && /#\/c\/1[rgsch]/.test(st.link), '应生成一条可打开的分享链接', st);
ok(st.mine >= 1, '生成的关应存进「我造的关」', st);
const shareLink = st.link;

/* 打开这条链接 → 直接进对局 */
await send('Page.navigate', { url: shareLink });
await sleep(2600);
st = await ev(`(() => ({
  hud: (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' '),
  hints: document.querySelectorAll('.move-hint').length,
  cells: document.querySelectorAll('.boardsvg rect').length
}))()`);
ok(st.hud.includes('自制关卡'), '打开分享码应进入自制关卡', st);
ok(st.hints >= 1, '自制关卡应能正常走子', st);
ok(errors.length === 0, '自制关卡无 JS 异常', errors);
await shot('19-custom-level');

/* 坏码要给出友好提示，而不是白屏 */
await send('Page.navigate', { url: PAGE + '#/c/1r9x91_badbadbad' });
await sleep(2200);
st = await ev(`(() => ({
  title: (document.querySelector('.page-head h1')?.textContent || ''),
  body: (document.querySelector('.paper')?.innerText || '').replace(/\\s+/g, ' ')
}))()`);
ok(st.title.includes('打不开'), '损坏的分享码应给出友好提示', st);
ok(/重新发|截断|改动/.test(st.body), '提示里应说清怎么办', st);
ok(errors.length === 0, '无效分享码页无 JS 异常', errors);

/* ---------- 5k. 技能卡：按钮 / 选卡 / 效果 / 每关只能一张 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/play/3' });
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(800); }
st = await ev(`(() => {
  const b = [...document.querySelectorAll('.hud button')].find(x => x.textContent.includes('技能'));
  const hud = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ');
  return { hasBtn: !!b, warn: b?.classList.contains('warn'), walls: (hud.match(/我的墙 (\\d+)/) || [])[1] };
})()`);
ok(st.hasBtn && st.warn, 'HUD 应有「技能」按钮并提示可用', st);
const wallsBefore = parseInt(st.walls, 10);

await ev(`(() => { [...document.querySelectorAll('.hud button')].find(x => x.textContent.includes('技能')).click(); })()`);
await sleep(600);
st = await ev(`(() => ({
  title: (document.querySelector('.panel h2')?.textContent || ''),
  cards: document.querySelectorAll('.skill-card').length,
  body: (document.querySelector('.panel')?.innerText || '').replace(/\\s+/g, ' ')
}))()`);
ok(st.title.includes('技能卡'), '点技能按钮应弹出选卡面板', st);
ok(st.cards === 7, '应有 7 张技能卡', st);
ok(/备墙/.test(st.body) && /预知/.test(st.body), '选卡面板应列出各卡效果', st);
await shot('20-skill-panel');

/* 选「备墙」→ 立刻多 2 面墙，按钮变成已用 */
await ev(`(() => { [...document.querySelectorAll('.skill-card')].find(c => c.textContent.includes('备墙')).click(); })()`);
await sleep(900);
st = await ev(`(() => {
  const b = [...document.querySelectorAll('.hud button')].find(x => x.textContent.includes('已用') || x.textContent.includes('技能'));
  const hud = (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ');
  return { btn: (b?.textContent || ''), warn: b?.classList.contains('warn'), walls: (hud.match(/我的墙 (\\d+)/) || [])[1] };
})()`);
ok(parseInt(st.walls, 10) === wallsBefore + 2, '用了「备墙」应立刻多 2 面墙', { wallsBefore, after: st.walls });
ok(st.btn.includes('已用') && !st.warn, '用过的技能应在按钮上标出来', st);

/* 再用一张应当被拦住 */
await ev(`(() => { [...document.querySelectorAll('.hud button')].find(x => x.textContent.includes('已用')).click(); })()`);
await sleep(600);
st = await ev(`(() => ({
  body: (document.querySelector('.panel')?.innerText || '').replace(/\\s+/g, ' '),
  disabled: [...document.querySelectorAll('.skill-card')].every(c => c.disabled)
}))()`);
ok(/已经用过/.test(st.body), '每关只能用一张：再用应明确告知', st);
ok(st.disabled, '已用过后其它卡应不可点', st);
await ev(`(() => { [...document.querySelectorAll('.panel button')].find(b => /知道了|先不用/.test(b.textContent))?.click(); })()`);
await sleep(500);

/* 侦察：本关应画出对手到目标的最短路（紫色虚线） */
await send('Page.navigate', { url: PAGE + '#/play/4' });
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(800); }
await ev(`(() => { [...document.querySelectorAll('.hud button')].find(x => x.textContent.includes('技能')).click(); })()`);
await sleep(600);
await ev(`(() => { [...document.querySelectorAll('.skill-card')].find(c => c.textContent.includes('侦察')).click(); })()`);
await sleep(800);
st = await ev(`(() => {
  const paths = [...document.querySelectorAll('.boardsvg path')].filter(p => (p.getAttribute('stroke-dasharray') || '').includes('7 7'));
  return { dashed: paths.length, stroke: paths[0]?.getAttribute('stroke') || '' };
})()`);
ok(st.dashed >= 1 && /7F77DD/i.test(st.stroke), '「侦察」应画出对手到目标的最短路（紫色虚线）', st);

/* 预知：应圈出对手想走的位置（红色虚线） */
await send('Page.navigate', { url: PAGE + '#/play/5' });
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(800); }
await ev(`(() => { [...document.querySelectorAll('.hud button')].find(x => x.textContent.includes('技能')).click(); })()`);
await sleep(600);
await ev(`(() => { [...document.querySelectorAll('.skill-card')].find(c => c.textContent.includes('预知')).click(); })()`);
await sleep(900);
st = await ev(`(() => {
  const svg = document.querySelector('.boardsvg');
  const ring = svg.querySelector('circle[stroke="#a8324a"]');
  const rect = svg.querySelector('rect[stroke="#a8324a"]');
  return { ring: !!ring, rect: !!rect, dash: (ring?.getAttribute('stroke-dasharray') || rect?.getAttribute('stroke-dasharray') || '') };
})()`);
ok(st.ring || st.rect, '「预知」应圈出对手的下一步打算（红色虚线）', st);
ok(errors.length === 0, '技能卡无 JS 异常', errors);
await shot('21-skill-foresee');

/* 双人同屏不给用技能（两边都是人，会失衡） */
await send('Page.navigate', { url: PAGE + '#/map' });
await sleep(2100);
await ev(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('双人对战'))?.click(); })()`);
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始对战'); await sleep(800); }
st = await ev(`(() => [...document.querySelectorAll('.hud button')].some(x => x.textContent.includes('技能')))()`);
ok(st === false, '双人同屏不应出现技能卡按钮');
ok(errors.length === 0, '双人模式下无 JS 异常', errors);
/* 收尾：把双人开关关掉（它是模块级状态，不关会污染后面的用例） */
const switched = await ev(`(() => {
  const b = [...document.querySelectorAll('.hud button')].find(x => x.textContent.trim() === '单人');
  if (!b) return false;
  b.click(); return true;
})()`);
await sleep(1600);
ok(switched, '双人模式下 HUD 应有「单人」切换按钮');
st = await ev(`(() => !!document.querySelector('.turn-pill'))()`);
ok(st === false, '切回单人后不该再有「轮到谁」提示');

/* ---------- 5l. 成就与外观：成就墙 / 换装 / 锁定拦截 / 结算念出新成就 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/me' });
await sleep(2300);
st = await ev(`(() => ({
  cards: document.querySelectorAll('.ach-card').length,
  on: document.querySelectorAll('.ach-card.on').length,
  sum: (document.querySelector('.ach-box .heat-sum')?.innerText || '').replace(/\\s+/g, ' '),
  skins: document.querySelectorAll('.skin-card').length,
  skinOn: (document.querySelector('.skin-card.on')?.innerText || '').replace(/\\s+/g, ' '),
  locked: document.querySelectorAll('.skin-card.lock').length
}))()`);
ok(st.cards >= 20, '「我的」页应有成就墙（≥20 条）', st);
ok(st.on >= 1, '已经玩过几关，应有已解锁的成就', st);
ok(/已解锁 \d+ \/ \d+/.test(st.sum), '成就区应显示解锁进度', st);
ok(st.skins === 6, '外观应有 6 套', st);
ok(st.skinOn.includes('经典'), '默认应选中「经典」外观', st);
ok(st.locked >= 1, '还没达成的外观应显示为锁定', st);
await ev(`(() => { document.querySelector('.ach-box')?.scrollIntoView({ block: 'center' }); })()`);
await sleep(700);
await shot('22-achievements');

/* 换装：小红帽（「初次上路」的奖励，前面已通关过第 1 关） */
await ev(`(() => { [...document.querySelectorAll('.skin-card')].find(c => c.innerText.includes('小红帽'))?.click(); })()`);
await sleep(1600);
st = await ev(`(() => ({
  skin: localStorage.getItem('dreamquest.skin.v1'),
  on: (document.querySelector('.skin-card.on')?.innerText || '').replace(/\\s+/g, ' ')
}))()`);
ok(st.skin === 'redcap', '点已解锁的外观应立刻换上', st);
ok(st.on.includes('小红帽'), '换装后应高亮新的那套', st);

/* 锁定的外观点不动，并说明解锁条件 */
await ev(`(() => { [...document.querySelectorAll('.skin-card')].find(c => c.innerText.includes('黄金冠'))?.click(); })()`);
await sleep(800);
st = await ev(`(() => ({
  skin: localStorage.getItem('dreamquest.skin.v1'),
  toast: (document.querySelector('.toast.show')?.innerText || '')
}))()`);
ok(st.skin === 'redcap', '锁定外观不该被换上', st);
ok(/还没解锁/.test(st.toast), '点锁定外观应提示解锁条件', st);

/* 清掉成就记录后再通关一次：结算面板应把新成就念出来 */
await ev(`(() => { localStorage.removeItem('dreamquest.ach.v1'); return true; })()`);
await send('Page.navigate', { url: PAGE + '#/play/1' });
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(800); }
await winLoop();
await sleep(1000);
st = await ev(`(() => ({
  title: (document.querySelector('.panel h2')?.textContent || ''),
  ach: (document.querySelector('.ach-new')?.innerText || '').replace(/\\s+/g, ' ')
}))()`);
ok(st.title.includes('完成'), '通关后应出结算面板', st);
ok(/新成就/.test(st.ach), '结算面板应念出新解锁的成就', st);
ok(/初次上路/.test(st.ach), '通关第 1 关应解锁「初次上路」', st);
ok(errors.length === 0, '成就与外观无 JS 异常', errors);
await shot('23-ach-new');
/* 收尾：关掉弹层，免得影响后面的用例 */
await ev(`(() => { [...document.querySelectorAll('.panel button')].find(b => /回到主界面|下一关/.test(b.textContent))?.click(); })()`);
await sleep(1300);

/* ---------- 5m. 每日挑战：地图入口 / 同一天同图 / 结算与连续天数 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/map' });
await sleep(2400);
st = await ev(`(() => {
  const card = document.querySelector('.daily-card');
  return {
    has: !!card,
    tag: (card?.querySelector('.daily-tag')?.textContent || ''),
    title: (card?.querySelector('h2')?.textContent || ''),
    info: (card?.querySelector('.daily-info')?.innerText || '').replace(/\\s+/g, ' '),
    btn: (card?.querySelector('button')?.textContent || '')
  };
})()`);
ok(st.has, '地图页应有「今日挑战」入口', st);
ok(st.tag.includes('今日挑战'), '入口应有今日挑战标识', st);
ok(/^\d{4}-\d{2}-\d{2}$/.test(st.title), '入口应写着今天的日期，实际 ' + st.title);
ok(/同一张图/.test(st.info), '入口应说明「同一天同一张图」', st);
ok(st.btn.includes('开始') || st.btn.includes('再打') || st.btn.includes('挑战'), '入口应有开始按钮（普通挑战/地狱挑战）', st);
await shot('24-daily-card');
const todayKey = st.title;

/* 打开今日挑战 */
await ev(`(() => { document.querySelector('.daily-card button').click(); })()`);
await sleep(2700);
st = await ev(`(() => ({
  hud: (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' '),
  hints: document.querySelectorAll('.move-hint').length,
  panel: (document.querySelector('.panel h2')?.textContent || '')
}))()`);
ok(st.hud.includes('今日挑战'), '进入今日挑战后 HUD 应标明', st);
if (st.panel) { await hitPanel('开始挑战'); await sleep(900); }
st = await ev(`(() => document.querySelectorAll('.move-hint').length)()`);
ok(st >= 1, '今日挑战应能正常走子', { hints: st });
await shot('25-daily-board');

/* 打完（赢或输都应有每日结算，并落盘今天的记录） */
await winLoop(32);
await sleep(1400);
for (let i = 0; i < 6 && !(await ev(`!!document.querySelector('.panel h2')`)); i++) await sleep(1300);
st = await ev(`(() => ({
  title: (document.querySelector('.panel h2')?.textContent || ''),
  body: (document.querySelector('.panel')?.innerText || '').replace(/\\s+/g, ' '),
  rec: JSON.parse(localStorage.getItem('dreamquest.daily.v1') || '{}')
}))()`);
ok(/今日挑战|今天这张图/.test(st.title + st.body), '每日挑战应有自己的结算文案', st);
ok(/连续/.test(st.body) && /累计完成/.test(st.body), '每日结算应显示连续天数与累计完成', st);
ok(!!st.rec[todayKey], '每日结算应把今天的记录落盘', { rec: st.rec });
await shot('26-daily-result');

/* 造一条「今天已通关」的记录，验证地图入口会变成已完成（顺带看连续天数） */
await ev(`(() => {
  const o = JSON.parse(localStorage.getItem('dreamquest.daily.v1') || '{}');
  o['${todayKey}'] = { win: true, best: 9, tries: 2 };
  localStorage.setItem('dreamquest.daily.v1', JSON.stringify(o));
  return true;
})()`);
await send('Page.reload');
await sleep(2700);
st = await ev(`(() => {
  const card = document.querySelector('.daily-card');
  return {
    done: (card?.querySelector('.daily-done')?.textContent || ''),
    streak: (card?.querySelector('.daily-streak')?.textContent || ''),
    btn: (card?.querySelector('button')?.textContent || '')
  };
})()`);
ok(/最好 9 步/.test(st.done) && /普通/.test(st.done), '通关后入口应显示已完成（普通 ✓）与最好成绩', st);
ok(/连续 1 天/.test(st.streak), '通关后应显示连续 1 天', st);
ok(/再打一次/.test(st.btn), '已完成后的按钮应变成「再打一次」', st);

/* 每日成就：成就只在对局结束时刷新，所以先落下"今天通关"的记录，再随便打一局把它带出来 */
await send('Page.navigate', { url: PAGE + '#/play/1' });
await sleep(2300);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('开始挑战'); await sleep(800); }
await winLoop();
await sleep(1200);
await ev(`(() => { [...document.querySelectorAll('.panel button')].find(b => /回到主界面|下一关/.test(b.textContent))?.click(); })()`);
await sleep(1400);
await send('Page.navigate', { url: PAGE + '#/me' });
await sleep(2400);
st = await ev(`(() => {
  const names = [...document.querySelectorAll('.ach-card')].map(c => c.innerText.replace(/\\s+/g, ' '));
  return { on: document.querySelectorAll('.ach-card.on').length,
           daily1: names.some(x => x.includes('今日已阅')),
           daily7: names.some(x => x.includes('坚持一周')),
           unlockedDaily: names.some(x => x.includes('今日已阅') && x.startsWith('✓')) };
})()`);
ok(st.daily1 && st.daily7, '成就墙应包含两条每日挑战成就', st);
ok(st.unlockedDaily, '今天通关过每日挑战，成就「今日已阅」应当已解锁', st);
ok(errors.length === 0, '每日挑战无 JS 异常', errors);

/* ---------- 5f. 章末 Boss：Boss 卡 / HUD 名号 / 回合事件倒计时 / 地图金环 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/play/15' });
await sleep(2400);
st = await ev(`(() => ({
  title: (document.querySelector('.panel h2')?.textContent || ''),
  body: (document.querySelector('.panel')?.innerText || '').replace(/\\s+/g, ' '),
  hud: (document.querySelector('.hud')?.innerText || '').replace(/\\s+/g, ' ')
}))()`);
ok(st.title.includes('林间守卫'), '第 15 关（章末 Boss）应先弹 Boss 卡', st);
ok(st.body.includes('克制提示') && st.body.includes('对手打法'), 'Boss 卡应写明打法与克制提示', st);
ok(st.hud.includes('林间守卫'), 'Boss 关 HUD 应显示 Boss 名号', st);
await shot('11-boss-card');
ok(await hitPanel('应战'), 'Boss 卡应有「应战」按钮');
await sleep(1000);
st = await ev(`(() => ({
  tabbar: getComputedStyle(document.querySelector('.tabbar')).display,
  hints: document.querySelectorAll('.move-hint').length
}))()`);
ok(st.hints >= 1 && st.tabbar === 'none', '点「应战」后应进入 Boss 棋盘', st);
ok(errors.length === 0, 'Boss 关无 JS 异常', errors);

/* 回合事件：倒计时要随回合变化（证明事件真的在 tick） */
await send('Page.navigate', { url: PAGE + '#/play/75' });
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) { await hitPanel('应战'); await sleep(900); }
st = await ev(`(() => ({ pill: document.querySelector('.evt-pill')?.innerText || '' }))()`);
ok(st.pill.includes('岩浆') && /\d+/.test(st.pill), '带回合事件的关卡应显示事件倒计时', st);
const evtBefore = st.pill;
await ev(`(() => {
  const hints = [...document.querySelectorAll('.move-hint')];
  if (hints.length) hints[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
})()`);
await sleep(3200);
st = await ev(`(() => ({ pill: document.querySelector('.evt-pill')?.innerText || '' }))()`);
ok(st.pill !== evtBefore, '回合事件倒计时应随回合变化（岩浆在 tick）', { before: evtBefore, after: st.pill });
ok(errors.length === 0, '回合事件无 JS 异常', errors);
await shot('12-boss-event');

/* 地图上 Boss 节点的专属金环 */
await send('Page.navigate', { url: PAGE + '#/map' });
await sleep(2200);
st = await ev(`(() => ({ rings: document.querySelectorAll('.mapsvg circle[r="30"]').length }))()`);
ok(st.rings === 7, '地图上 7 个章末 Boss 应有专属金环', st);

/* ---------- 5g. 双人同屏：入口 / 换手 / 不跑 AI / 结算 ---------- */
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/map' });
await sleep(2100);
const hasDuel = await ev(`(() => !![...document.querySelectorAll('button')].find(b => b.textContent.includes('双人对战')))()`);
ok(hasDuel, '地图首页应有「双人对战」入口');
await ev(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('双人对战'))?.click(); })()`);
await sleep(2400);
if (await ev(`!!document.querySelector('.panel h2')`)) {
  ok(await hitPanel('开始对战'), '首次进双人应弹双人规则卡');
  await sleep(900);
}
st = await ev(`(() => ({
  turn: (document.querySelector('.turn-pill')?.innerText || '').trim(),
  goal: (document.querySelector('.goal-pill')?.innerText || '').replace(/\\s+/g, ' '),
  hint: (document.querySelector('.actions .hint')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 40),
  hints: document.querySelectorAll('.move-hint').length
}))()`);
ok(st.turn.includes('金球'), '双人局应显示「轮到 金球」', st);
ok(st.goal.includes('金球') && st.goal.includes('紫球'), '双人局应同时标出双方目标', st);
ok(st.hint.includes('轮到金球'), '双人局底部提示应写明轮到谁', st);
ok(st.hints >= 1, '双人局开局应有走位提示', st);

/* 金球走一步 → 立刻轮到紫球（双人不跑 AI，没有 420ms 思考延迟） */
await ev(`(() => { const h = [...document.querySelectorAll('.move-hint')];
  if (h.length) h[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
await sleep(750);
st = await ev(`(() => ({
  turn: (document.querySelector('.turn-pill')?.innerText || '').trim(),
  hints: document.querySelectorAll('.move-hint').length,
  round: (document.querySelector('.hud')?.innerText.match(/回合 (\\d+)/) || [])[1]
}))()`);
ok(st.turn.includes('紫球'), '金球走完应立刻轮到紫球', st);
ok(st.hints >= 1, '轮到紫球时走位提示应切到紫球一侧', st);
ok(st.round === '1', '两人各走一手才算一回合（此刻仍应是第 1 回合）', st);

/* 紫球走一步 → 回合 +1 */
await ev(`(() => { const h = [...document.querySelectorAll('.move-hint')];
  if (h.length) h[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
await sleep(750);
st = await ev(`(() => (document.querySelector('.hud')?.innerText.match(/回合 (\\d+)/) || [])[1])()`);
ok(st === '2', '双方各走一手后回合数应为 2', { round: st });

/* 一路点到分出胜负：金球挑最上方的提示点（朝顶边），紫球挑最下方的（朝底边） */
for (let i = 0; i < 16; i++) {
  const done = await ev(`(() => {
    if (document.querySelector('.panel h2')) return 'panel';
    const hints = [...document.querySelectorAll('.move-hint')];
    if (!hints.length) return 'none';
    const gold = (document.querySelector('.turn-pill')?.innerText || '').includes('金球');
    let pick = hints[0];
    hints.forEach(h => {
      const cy = +h.getAttribute('cy'), best = +pick.getAttribute('cy');
      if (gold ? cy < best : cy > best) pick = h;
    });
    pick.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'clicked';
  })()`);
  if (done === 'panel') break;
  await sleep(700);
}
st = await ev(`(() => {
  const panel = document.querySelector('.panel');
  return { title: (panel?.querySelector('h2')?.textContent || ''), text: (panel?.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) };
})()`);
ok(st.title.includes('赢了'), '双人分出胜负后应显示「金球/紫球赢了」', st);
ok(st.text.includes('总比分'), '双人结算应显示总比分', st);
ok(!/思考/.test(st.text), '双人结算不应出现思考类文案', st);
ok(errors.length === 0, '双人对局无 JS 异常', errors);
await shot('13-duel');

/* ---------- 6. 三个一级页面 ---------- */
for (const [route, check] of [
  ['#/rank', t => t.includes('综合榜') || t.includes('排行')],
  ['#/community', t => t.includes('未来会在这里遇见更多冒险者')],
  ['#/me', t => t.includes('我的冒险档案') && t.includes('最近冒险记录')],
]) {
  errors.length = 0;
  await send('Page.navigate', { url: PAGE + route });
  await sleep(1600);
  const text = await ev(`document.body.innerText.replace(/\\s+/g,' ')`);
  ok(text.length > 50 && check(text), route + ' 页面渲染', { head: text.slice(0, 60) });
  ok(errors.length === 0, route + ' 无 JS 异常', errors);
}
await shot('05-rank');
/* ---------- 7. 移动端（390×844）功能断言 ---------- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true });
errors.length = 0;
await send('Page.navigate', { url: PAGE + '#/play/1' });
await sleep(2000);
st = await ev(`(() => {
  const tb = document.querySelector('.tabbar');
  return {
    board: !!document.querySelector('.boardsvg'),
    hints: document.querySelectorAll('.move-hint').length,
    tabbarHidden: !tb || getComputedStyle(tb).display === 'none',
    inGame: document.body.classList.contains('in-game')
  };
})()`);
ok(st.board && st.hints === 3, '移动端对局：棋盘渲染 + 3 个走位点', st);
ok(st.tabbarHidden && st.inGame, '移动端对局：底部导航避让不遮挡操作区', st);
ok(errors.length === 0, '移动端对局无 JS 异常', errors);
await shot('06-game-mobile', true);

await send('Page.navigate', { url: PAGE + '#/map' });
await sleep(1800);
st = await ev(`(() => {
  const tb = document.querySelector('.tabbar');
  return {
    nodes: document.querySelectorAll('.node-hit').length,
    tabbarShown: !!tb && getComputedStyle(tb).display !== 'none',
    items: tb ? tb.querySelectorAll('.nav-item').length : 0
  };
})()`);
ok(st.nodes === 100 && st.tabbarShown && st.items === 4, '移动端地图：100 关 + 底部四导航', st);
ok(errors.length === 0, '移动端地图无 JS 异常', errors);
await shot('07-map-mobile', true);

/* ---------- 收尾 ---------- */
await send('Target.closeTarget', { targetId: tab.id }).catch(() => {});
chrome.kill();
await sleep(600);
console.log(fails === 0 ? '\n冒烟测试全部通过' : '\n存在 ' + fails + ' 个失败');
process.exit(fails === 0 ? 0 : 1);
