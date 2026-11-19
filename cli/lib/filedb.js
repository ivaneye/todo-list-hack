'use strict';
/**
 * N1 驱动：文件只读
 *
 * 不需要 App 在运行、不需要端口、不需要安装，直接读 App 自己的两个文件：
 *   1. <userData>/todos.db                  —— 明文 SQLite，全部待办（App 主进程用 better-sqlite3 打开，不加密）
 *   2. <userData>/critical-state-backup.json —— electron-store，App 每次状态变更 500ms 落盘：
 *        分类/分组(categoryState)、设置(settingsState)、番茄(tomatoState)、侧栏(sidebarState)
 *
 * 实现方式：把这两个文件拼成一个"假 vuexStore"，再让 commands.js 里那段原封不动的
 * 渲染进程代码跑在上面。所以读命令（list/show/search/stats/cats/folders/tags/tomato…）
 * 与连着 App 时用的是同一份逻辑，没有第二套实现。
 *
 * 写命令在这个驱动上会被 `dispatch/commit` 直接拒绝 —— 调用方会转去 N2（inspect）驱动。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { userDataDir } = require('./platform');

const DB_FILE = 'todos.db';
const BACKUP_FILE = 'critical-state-backup.json';

const camel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** 数据库行 → App store 里的对象（snake_case → camelCase，deleted → delete） */
function toItem(row) {
  const o = {};
  for (const k of Object.keys(row)) o[camel(k)] = row[k];
  if ('deleted' in o) {
    o.delete = !!o.deleted;
    delete o.deleted;
  }
  return o;
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p);
  } catch (e) {
    return null;
  }
}

/** 只读导出 todos.db：优先 node:sqlite 子进程，其次 sqlite3 CLI（macOS/Linux 自带） */
function dumpRows(dbPath) {
  if (fs.existsSync(dbPath)) {
    const r = spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, 'sqlite-dump.js'), dbPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.stdout) {
      try {
        const out = JSON.parse(r.stdout);
        if (out.ok) return out.rows;
      } catch (e) {}
    }
    // 回退：sqlite3 CLI（Windows 不自带，会走到这里后报错）
    const cli = spawnSync('sqlite3', ['-readonly', '-json', dbPath, 'SELECT * FROM todos'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (cli.status === 0 && (cli.stdout || '').trim()) {
      try { return JSON.parse(cli.stdout); } catch (e) {}
    }
  }
  throw new Error(
    `读不到待办数据库：${dbPath}\n` +
      '  可能原因：App 从未运行过 / 数据库被其他程序独占 / 当前 Node 版本过低（需要 ≥ 22.12，自带 node:sqlite）'
  );
}

function parseState(backup, key) {
  const raw = backup[key];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

class FileSession {
  constructor({ userData, rows, backup, warnings }) {
    this.userData = userData;
    this.rows = rows;
    this.backup = backup;
    this.warnings = warnings;

    const category = parseState(backup, 'categoryState') || {};
    const todoList = rows.map(toItem);

    this.store = {
      state: {
        todo: { todoList, version: 0 },
        category: { list: category.list || [] },
        settings: parseState(backup, 'settingsState') || {},
        tomato: parseState(backup, 'tomatoState') || {},
        sidebar: parseState(backup, 'sidebarState') || {},
      },
      getters: {},
      dispatch(type) {
        throw new Error(`「${type}」需要写到 App 里，只读模式做不到`);
      },
      commit(type) {
        throw new Error(`「${type}」需要写到 App 里，只读模式做不到`);
      },
      watch() {},
      subscribe() {},
    };
  }

  static open() {
    const userData = userDataDir();
    const warnings = [];
    const backupRaw = readFileSafe(path.join(userData, BACKUP_FILE));
    let backup = {};
    if (backupRaw) {
      try {
        backup = (JSON.parse(backupRaw.toString('utf8')) || {}).backup || {};
      } catch (e) {
        warnings.push(`${BACKUP_FILE} 解析失败，分类名/设置会缺失`);
      }
    } else {
      warnings.push(`没找到 ${BACKUP_FILE}（分类名/设置会缺失，App 启动过一次就会有）`);
    }
    const rows = dumpRows(path.join(userData, DB_FILE));
    return new FileSession({ userData, rows, backup, warnings });
  }

  /** 建一个新的沙箱上下文（每次命令一个，避免脏状态互相影响） */
  _ctx() {
    const g = {
      window: { vuexStore: this.store },
      console: { log() {}, warn() {}, error() {}, info() {} },
      setTimeout: () => 0,
      clearTimeout() {},
    };
    vm.createContext(g);
    return g;
  }

  /** 在假的 vuexStore 上执行 commands.js 生成的表达式 */
  async run(expression) {
    const g = this._ctx();
    const n = await vm.runInContext(expression, g, { timeout: 20000 });
    if (typeof n !== 'number') throw new Error('命令没有返回结果');
    const text = g.window.__todoctl_out;
    if (typeof text !== 'string') throw new Error('命令没有返回结果');
    return JSON.parse(text);
  }

  async runText(expression) {
    const g = this._ctx();
    vm.runInContext(
      '(() => { const v = (' + expression + '); window.__todoctl_out = (typeof v === "string") ? v : JSON.stringify(v); })()',
      g,
      { timeout: 20000 }
    );
    const text = g.window.__todoctl_out;
    if (typeof text !== 'string') throw new Error('表达式没有返回值');
    return text;
  }

  close() {}
}

module.exports = { FileSession, toItem };
