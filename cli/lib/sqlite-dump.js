'use strict';
/**
 * 子进程：只读导出 todos.db（App 的本地明文库），把行以 JSON 打到 stdout。
 * 用 `node --no-warnings` 启动，避免 node:sqlite 的 ExperimentalWarning 污染 stderr。
 * 只读打开失败（WAL/SHM 权限、库被独占）时，把 db+wal+shm 复制到临时目录再读。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function dump(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM todos').all();
  } finally {
    db.close();
  }
}

function dumpCopy(dbPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todoctl-'));
  const dst = path.join(dir, 'todos.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const from = dbPath + suffix;
    if (fs.existsSync(from)) fs.copyFileSync(from, dst + suffix);
  }
  try {
    return dump(dst);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

function main() {
  const dbPath = process.argv[2];
  let rows;
  try {
    rows = dump(dbPath);
  } catch (e) {
    rows = dumpCopy(dbPath);
  }
  process.stdout.write(JSON.stringify({ ok: true, rows }));
}

try {
  main();
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
}
