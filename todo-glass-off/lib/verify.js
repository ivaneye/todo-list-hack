#!/usr/bin/env node
// 装完补丁后的自动体检（需要应用以 --remote-debugging-port=9222 运行）
// 检查：皮肤生效、玻璃已关、列表能滚动（真实滚轮事件）
process.env.PORT = process.env.PORT || '9222';
const port = process.env.PORT;

async function getPageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('连接不到调试端口 ' + port);
}

(async () => {
  const ws = new WebSocket(await getPageTarget());
  let id = 0;
  const pending = new Map();
  const send = (m, p) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
    });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 确保停在 Day Todo 页面
  await evaluate(`(async () => {
    const el = [...document.querySelectorAll(".sidebar-nav-item")].find(e => (e.innerText || "").includes("Day Todo"));
    if (el && !el.className.includes("--active")) { (el.querySelector("a,div") || el).click(); await new Promise(r => setTimeout(r, 1000)); }
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  const state = await evaluate(`(() => {
    const m = document.querySelector(".page__main");
    const cs = m && getComputedStyle(m);
    const rows = document.querySelectorAll(".todo-list-item").length;
    const argv = (typeof process !== "undefined" && process.argv || []).join(" ");
    return {
      rows,
      overflowY: cs && cs.overflowY,
      clipPath: cs && cs.clipPath,
      radius: cs && cs.borderTopLeftRadius,
      vibrancyArg: /vibrancy/.test(argv),
      scrollTop: m && m.scrollTop,
      maxScroll: m ? m.scrollHeight - m.clientHeight : 0
    };
  })()`);

  if (!state) {
    console.log('  ✗ 拿不到页面状态（应用可能没能启动）');
    process.exit(1);
  }

  check('页面有内容（待办行存在）', state.rows > 0, 'rows=' + state.rows);
  check('皮肤已生效（卡片圆角 14px + clip-path）', parseFloat(state.radius) >= 12 && /inset/.test(state.clipPath || ''), `radius=${state.radius}`);
  check('玻璃已关闭（renderer 无 vibrancy 参数）', state.vibrancyArg === false);
  check('列表容器未被 overflow:hidden 掉', state.overflowY !== 'hidden', 'overflowY=' + state.overflowY);

  // 真实滚轮事件
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 420, deltaX: 0, deltaY: 320, pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 700));
  const after = await evaluate('document.querySelector(".page__main").scrollTop');
  if (state.maxScroll <= 0) {
    check('滚轮滚动（内容不足一屏，跳过）', true, '无需滚动');
  } else {
    check('滚轮滚动正常', after > state.scrollTop, `${state.scrollTop} → ${after}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 420, deltaX: 0, deltaY: -320, pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 500));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n体检未通过：${failed.length} 项异常` : '\n体检全部通过');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('  体检出错：' + e.message);
  process.exit(1);
});
