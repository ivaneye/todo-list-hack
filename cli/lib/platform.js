'use strict';
/**
 * 跨平台层：定位 App / 数据目录 / 判断运行状态 / 带参数启动 / 优雅退出
 *
 * 三平台差异只有三处（App 的 Electron userData 都叫 todo-list）：
 *   macOS   : ~/Library/Application Support/todo-list   + /Applications/Todo清单.app
 *   Windows : %APPDATA%\todo-list                        + 安装目录里的 Todo清单.exe
 *   Linux   : ~/.config/todo-list                        + 可执行文件（TODO_APP 指定）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PLATFORM = process.platform;
const APP_NAME = 'Todo清单';

function expandEnv(v) {
  return v.replace(/%([^%]+)%/g, (_, k) => process.env[k] || '').replace(/^~(?=\/)/, os.homedir());
}

/** App 数据目录（Electron app.getPath('userData')） */
function userDataDir() {
  if (process.env.TODO_USERDATA) return expandEnv(process.env.TODO_USERDATA);
  if (PLATFORM === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'todo-list');
  if (PLATFORM === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'todo-list');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'todo-list');
}

function firstExisting(list) {
  for (const p of list) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** 安装位置：返回 { kind: 'app' | 'exe', path } */
function locateApp() {
  if (process.env.TODO_APP) {
    const p = expandEnv(process.env.TODO_APP);
    return { kind: PLATFORM === 'darwin' && p.endsWith('.app') ? 'app' : 'exe', path: p };
  }
  if (PLATFORM === 'darwin') {
    const app = firstExisting([
      `/Applications/${APP_NAME}.app`,
      path.join(os.homedir(), 'Applications', `${APP_NAME}.app`),
    ]);
    if (app) return { kind: 'app', path: app };
  }
  if (PLATFORM === 'win32') {
    const exe = firstExisting([
      path.join(process.env.LOCALAPPDATA || '', 'Programs', APP_NAME, `${APP_NAME}.exe`),
      path.join(process.env.ProgramFiles || '', APP_NAME, `${APP_NAME}.exe`),
      path.join(process.env['ProgramFiles(x86)'] || '', APP_NAME, `${APP_NAME}.exe`),
      path.join(process.env.APPDATA || '', APP_NAME, `${APP_NAME}.exe`),
      path.join(process.env.LOCALAPPDATA || '', APP_NAME, `${APP_NAME}.exe`),
    ]);
    if (exe) return { kind: 'exe', path: exe };
    const where = spawnSync('where', [`${APP_NAME}.exe`], { encoding: 'utf8' });
    const hit = (where.stdout || '').split(/\r?\n/).find((x) => x.trim());
    if (hit) return { kind: 'exe', path: hit.trim() };
  }
  if (PLATFORM === 'linux') {
    const which = spawnSync('bash', ['-lc', `command -v "${APP_NAME}" || command -v todo-list || command -v todolist`], { encoding: 'utf8' });
    const hit = (which.stdout || '').split(/\r?\n/).find((x) => x.trim());
    if (hit) return { kind: 'exe', path: hit.trim() };
  }
  return null;
}

/** 真正用于启动的可执行路径（macOS 走 .app 内的可执行文件） */
function binaryPath() {
  const app = locateApp();
  if (!app) return null;
  if (app.kind === 'exe') return app.path;
  const mac = firstExisting([
    path.join(app.path, 'Contents', 'MacOS', APP_NAME),
    path.join(app.path, 'Contents', 'MacOS', 'todo-list'),
  ]);
  return mac;
}

/** App 是否在运行 */
function isRunning() {
  if (PLATFORM === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${APP_NAME}.exe`, '/NH'], { encoding: 'utf8' });
    return new RegExp(`${APP_NAME}\\.exe`, 'i').test(r.stdout || '');
  }
  const r = spawnSync('pgrep', ['-x', APP_NAME], { encoding: 'utf8' });
  if (r.status === 0 && (r.stdout || '').trim()) return true;
  // 兜底：名字可能被改过（开发版 / 重命名）
  const bin = binaryPath();
  if (!bin) return false;
  const r2 = spawnSync('pgrep', ['-f', bin], { encoding: 'utf8' });
  return (r2.stdout || '').trim().length > 0;
}

/** 带 --inspect 启动（端口固定，便于发现） */
function launchWithInspect(port) {
  const app = locateApp();
  if (!app) throw new Error(`找不到 ${APP_NAME}，请用 TODO_APP=/path/to/app 指定安装位置`);
  const args = [`--inspect=127.0.0.1:${port}`];
  if (PLATFORM === 'darwin' && app.kind === 'app') {
    // open --args 会走 LaunchServices（Dock/焦点/通知归属都正常），且参数能被 Electron 收到
    const r = spawnSync('open', ['-a', app.path, '--args', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`启动失败：${(r.stderr || '').trim() || 'open 返回 ' + r.status}`);
    return { cmd: `open -a "${app.path}" --args ${args.join(' ')}` };
  }
  const exe = binaryPath();
  if (!exe) throw new Error(`${app.path} 里找不到可执行文件`);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { cmd: `"${exe}" ${args.join(' ')}` };
}

/** 优雅退出：让 App 自己走 before-quit（落盘 critical-state-backup / 云同步） */
function quit() {
  if (!isRunning()) return true;
  if (PLATFORM === 'win32') {
    spawnSync('taskkill', ['/IM', `${APP_NAME}.exe`], { encoding: 'utf8' }); // 不带 /F = WM_CLOSE
  } else if (PLATFORM === 'darwin') {
    spawnSync('osascript', ['-e', `tell application "${APP_NAME}" to quit`], { encoding: 'utf8' });
  } else {
    spawnSync('pkill', ['-x', APP_NAME], { encoding: 'utf8' });
  }
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitExit(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isRunning()) return true;
    await sleep(200);
  }
  return !isRunning();
}

module.exports = {
  PLATFORM, APP_NAME, userDataDir, locateApp, binaryPath, isRunning,
  launchWithInspect, quit, waitExit, sleep, expandEnv,
};
