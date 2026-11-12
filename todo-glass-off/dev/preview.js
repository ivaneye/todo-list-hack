// 把 ../skin.css 注入运行中的窗口（开发预览，不落盘）
// 先带调试端口启动：open -a "Todo清单" --args --remote-debugging-port=9222
// node dev/preview.js            -> 注入
// node dev/preview.js remove     -> 移除
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 9222;

async function main() {
  const mode = process.argv[2] || 'apply';
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  const css = fs.readFileSync(path.join(__dirname, '..', 'skin.css'), 'utf8');
  const expr = mode === 'remove'
    ? `(() => { const e = document.getElementById("macos-skin"); if (e) e.remove(); return "removed"; })()`
    : `(() => {
        let el = document.getElementById("macos-skin");
        if (!el) { el = document.createElement("style"); el.id = "macos-skin"; document.head.appendChild(el); }
        el.textContent = ${JSON.stringify(css)};
        return "injected " + el.textContent.length + " chars";
      })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result?.result?.value ?? JSON.stringify(r.result));
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
