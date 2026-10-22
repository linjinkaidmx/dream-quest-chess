const { spawn } = require('node:child_process');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const CHROME = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
const CDP = 9455;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = [];
const send = (m, p = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method: m, params: p }));
  return new Promise((res, rej) => { pending.set(id, { res, rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)); } }, 30000); }); };
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 600));
  return r.result?.value; };
(async () => {
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--allow-file-access-from-files',
    '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(),'qa_dbg')], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch('http://127.0.0.1:' + CDP + '/json/version')).ok) break; } catch {} await sleep(250); }
  const tab = await fetch('http://127.0.0.1:' + CDP + '/json/new?' + PAGE, { method: 'PUT' }).then(r => r.json());
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 700));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + (m.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,300));
  });
  await send('Runtime.enable');
  await sleep(2500);
  const info = await ev(`JSON.stringify({
    appChildren: document.querySelectorAll('#app > *').length,
    tabbar: !!document.querySelector('.tabbar'),
    sideNav: !!document.querySelector('.side-nav'),
    bodyLen: document.body.innerText.length,
    head: document.body.innerText.slice(0, 60)
  })`);
  console.log('页面状态:', info);
  console.log('运行时错误:', errors.length ? errors.join('\n---\n') : '无');
  chrome.kill(); process.exit(0);
})();
