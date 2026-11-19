'use strict';
/**
 * N2 驱动：主进程 Node Inspector 桥
 *
 * 不修改 App 任何文件、不重新签名，用
 *     open -a Todo清单 --args --inspect=127.0.0.1:9331
 * 让主进程开一个 Node 调试口，然后：
 *     主进程 Runtime.evaluate → require('electron') → 主窗口 webContents.executeJavaScript
 * 直接调 App 自己的 Vuex action（与点界面按钮同一条路径），且：
 *   - 不改 App 任何文件 / 不重签 / App 升级不会被覆盖
 *   - 端口固定 9331（TODO_INSPECT_PORT 可改），只绑 127.0.0.1
 */
const { locateApp } = require('./platform');

const DEFAULT_PORT = Number(process.env.TODO_INSPECT_PORT || 9331);

/** 在主进程里跑：拿到 electron 模块 */
const REQUIRE = `(function(){ 
  if (typeof require === 'function') return require;
  if (typeof module !== 'undefined' && module.require) return module.require.bind(module);
  throw new Error('拿不到 require（Node 版本差异）');
})()`;

class Session {
  constructor(ws, port) {
    this.ws = ws;
    this.port = port;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    });
  }

  static async tryOpen(port = DEFAULT_PORT, timeoutMs = 700) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const list = await res.json();
      const target = (list || []).find((t) => t.webSocketDebuggerUrl);
      if (!target) return null;
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((ok, bad) => {
        const t = setTimeout(() => bad(new Error('连接 inspector 超时')), 3000);
        ws.addEventListener('open', () => { clearTimeout(t); ok(); });
        ws.addEventListener('error', () => { clearTimeout(t); bad(new Error('连接 inspector 失败')); });
      });
      const s = new Session(ws, port);
      await s.send('Runtime.enable', {}, 4000);
      return s;
    } catch (e) {
      return null;
    }
  }

  /** 只探活：连上取一条信息就关掉，不留下打开的 socket */
  static async probe(port = DEFAULT_PORT) {
    const s = await Session.tryOpen(port);
    if (!s) return null;
    try {
      const info = await s.evalMain('process.versions.electron + "/node " + process.versions.node').catch(() => null);
      return { port, info };
    } finally {
      s.close();
    }
  }

  static async open({ port = DEFAULT_PORT, timeoutMs = 30000 } = {}) {
    const started = Date.now();
    let lastErr = null;
    while (Date.now() - started < timeoutMs) {
      const s = await Session.tryOpen(port);
      if (s) return s;
      const app = locateApp();
      lastErr = app
        ? `App 已运行但主进程没开 --inspect（需要带参数重启）`
        : `找不到 ${'Todo清单'} 的安装位置`;
      await new Promise((r) => setTimeout(r, 350));
    }
    throw new Error(`连不上本地接口（127.0.0.1:${port}）：${lastErr || '超时'}`);
  }

  send(method, params, timeoutMs = 15000) {
    return new Promise((res, rej) => {
      this.id += 1;
      const id = this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`inspector 无响应（${method} 超过 ${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        res(msg);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在主进程里求值 */
  async evalMain(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      includeCommandLineAPI: true,
    });
    const det = r.result && r.result.exceptionDetails;
    if (det) {
      const desc = det.exception && (det.exception.description || det.exception.value);
      throw new Error(String(desc || det.text).split('\n')[0]);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  /** 在 App 主窗口渲染进程里求值 */
  async evalInRenderer(code) {
    const expr =
      `(async () => { const R = ${REQUIRE}; const { BrowserWindow } = R('electron');\n` +
      `const wins = BrowserWindow.getAllWindows().filter((w) => !w.webContents.isDestroyed());\n` +
      `const win = wins.find((w) => /index\\.html/.test(w.webContents.getURL())) || wins.find((w) => w.isVisible()) || wins[0];\n` +
      `if (!win) throw new Error('没有可用窗口（App 可能还在启动，稍后重试）');\n` +
      `return await win.webContents.executeJavaScript(${JSON.stringify(code)}, true);\n})()`;
    let lastErr;
    for (let i = 0; i < 6; i++) {
      try {
        return await this.evalMain(expr);
      } catch (e) {
        lastErr = e;
        if (!/没有可用窗口|webContents|destroyed|仍在加载/i.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr;
  }

  async eval(expression) {
    return this.evalInRenderer(expression);
  }

  /** 等渲染进程里 Vuex store 初始化完成（App 刚启动时页面还在加载） */
  async waitRenderer(timeoutMs = 25000) {
    const started = Date.now();
    let lastErr = null;
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = await this.evalInRenderer(
          '!!(window.vuexStore && window.vuexStore.state && window.vuexStore.state.todo)'
        );
        if (ok === true) return true;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`App 主窗口还没准备好（Vuex store 未初始化）${lastErr ? '：' + lastErr.message : ''}`);
  }

  /** 表达式把结果写进 window.__todoctl_out，返回长度，再分片取回（避免单次消息过大） */
  async run(expression) {
    let n = await this.eval(expression);
    for (let i = 0; i < 5 && typeof n !== 'number'; i++) {
      // 页面刚加载完 / 热重载会返回空值，等一下再试
      await new Promise((r) => setTimeout(r, 400));
      n = await this.eval(expression);
    }
    if (typeof n !== 'number') throw new Error('命令没有返回结果');
    const CHUNK = 60000;
    let text = '';
    for (let i = 0; i < n; i += CHUNK) {
      text += await this.eval('window.__todoctl_out.slice(' + i + ',' + (i + CHUNK) + ')');
    }
    await this.eval('delete window.__todoctl_out');
    return JSON.parse(text);
  }

  async runText(expression) {
    const code =
      '(() => { const v = (' + expression + '); window.__todoctl_out = (typeof v === "string") ? v : JSON.stringify(v); return window.__todoctl_out.length; })()';
    let n = await this.eval(code);
    for (let i = 0; i < 5 && typeof n !== 'number'; i++) {
      await new Promise((r) => setTimeout(r, 400));
      n = await this.eval(code);
    }
    if (typeof n !== 'number') throw new Error('表达式没有返回值');
    const CHUNK = 60000;
    let text = '';
    for (let i = 0; i < n; i += CHUNK) {
      text += await this.eval('window.__todoctl_out.slice(' + i + ',' + (i + CHUNK) + ')');
    }
    await this.eval('delete window.__todoctl_out');
    return text;
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

module.exports = { Session, DEFAULT_PORT };
