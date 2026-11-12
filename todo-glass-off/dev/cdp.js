// Minimal CDP client: node cdp.js '<js expression>'  -> prints result
// Requires the app launched with --remote-debugging-port=9222
const port = process.env.PORT || 9222;

async function target() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}

async function main() {
  const expr = process.argv[2];
  const ws = new WebSocket(await target());
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
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.result?.exceptionDetails) {
    console.error(JSON.stringify(r.result.exceptionDetails, null, 2));
  } else {
    const v = r.result?.result?.value;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  }
  ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
