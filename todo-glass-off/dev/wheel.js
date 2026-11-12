// 用真实鼠标滚轮事件测试滚动：node wheel.js [deltaY] [x] [y]
const port = process.env.PORT || 9222;
(async () => {
  const deltaY = Number(process.argv[2] || 300);
  const x = Number(process.argv[3] || 500);
  const y = Number(process.argv[4] || 400);
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const before = await send('Runtime.evaluate', { expression: 'document.querySelector(".page__main").scrollTop', returnByValue: true });
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 700));
  const after = await send('Runtime.evaluate', { expression: '(() => { const m=document.querySelector(".page__main"); const rows=[...document.querySelectorAll(".todo-list-item")].map(e=>e.getBoundingClientRect()); return {scrollTop:m.scrollTop, max:m.scrollHeight-m.clientHeight, lastRowBottom: Math.round(Math.max(...rows.map(r=>r.bottom))), listBottom: Math.round(m.getBoundingClientRect().bottom)}; })()', returnByValue: true });
  console.log('before', before.result?.result?.value, '→ after', JSON.stringify(after.result?.result?.value));
  ws.close();
})();
