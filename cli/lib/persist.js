'use strict';
/**
 * 可选：让「登录即带 --inspect 启动」常驻（persist）
 *
 * 三平台各用系统自带的"登录启动"机制，都只写**用户自己**的配置目录，不动 App 一个字节：
 *   macOS   ~/Library/LaunchAgents/cn.eve.todolist.agent.plist   (+ launchctl bundle)
 *   Windows HKCU\Software\Microsoft\Windows\CurrentVersion\Run 里的一个值
 *   Linux   ~/.config/autostart/todo-agent.desktop
 *
 * 目的：省掉「每次正常启动 App 之后，第一次写操作要重启一次」的那 2~3 秒。
 * 代价：本地接口端口常开（只绑 127.0.0.1）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLATFORM, locateApp, binaryPath, userDataDir } = require('./platform');

const LABEL = 'cn.eve.todolist.agent';
const WIN_VALUE = 'Todo清单Agent';
const WIN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function uid() {
  return typeof process.getuid === 'function' ? process.getuid() : 501;
}

/* ---------------- macOS ---------------- */
const darwin = {
  file: () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
  content(port) {
    const app = locateApp();
    if (!app || app.kind !== 'app') throw new Error('找不到 Todo清单.app（可用 TODO_APP 指定）');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>${xml(app.path)}</string>
    <string>--args</string>
    <string>--inspect=127.0.0.1:${port}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
  },
  install(port) {
    const f = darwin.file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, darwin.content(port), { mode: 0o644 });
    spawnSync('launchctl', ['bootout', `gui/${uid()}/${LABEL}`], { encoding: 'utf8' });
    const r = spawnSync('launchctl', ['bootstrap', `gui/${uid()}`, f], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`launchctl bootstrap 失败：${(r.stderr || '').trim() || r.status}`);
    return { file: f, how: 'LaunchAgent' };
  },
  uninstall() {
    spawnSync('launchctl', ['bootout', `gui/${uid()}/${LABEL}`], { encoding: 'utf8' });
    try { fs.unlinkSync(darwin.file()); } catch (e) {}
    return { file: darwin.file(), how: 'LaunchAgent' };
  },
  installed: () => fs.existsSync(darwin.file()),
  loaded: () => spawnSync('launchctl', ['print', `gui/${uid()}/${LABEL}`], { encoding: 'utf8' }).status === 0,
};

/* ---------------- Windows ---------------- */
const win32 = {
  command(port) {
    const exe = binaryPath();
    if (!exe) throw new Error('找不到 Todo清单.exe（可用 TODO_APP 指定路径）');
    return `"${exe}" --inspect=127.0.0.1:${port}`;
  },
  install(port) {
    const r = spawnSync('reg', ['add', WIN_KEY, '/v', WIN_VALUE, '/t', 'REG_SZ', '/d', win32.command(port), '/f'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`写注册表失败：${(r.stderr || r.stdout || '').trim() || r.status}`);
    return { file: `${WIN_KEY}\\${WIN_VALUE}`, how: '注册表 Run 键' };
  },
  uninstall() {
    spawnSync('reg', ['delete', WIN_KEY, '/v', WIN_VALUE, '/f'], { encoding: 'utf8' });
    return { file: `${WIN_KEY}\\${WIN_VALUE}`, how: '注册表 Run 键' };
  },
  installed() {
    const r = spawnSync('reg', ['query', WIN_KEY, '/v', WIN_VALUE], { encoding: 'utf8' });
    return r.status === 0;
  },
  loaded() {
    return win32.installed(); // 注册表项本身就是启用的
  },
};

/* ---------------- Linux ---------------- */
const linux = {
  file: () =>
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'todo-agent.desktop'),
  content(port) {
    const exe = binaryPath();
    if (!exe) throw new Error('找不到 Todo清单 可执行文件（可用 TODO_APP 指定路径）');
    return `[Desktop Entry]
Type=Application
Name=Todo清单 (Agent)
Comment=带本地接口启动 Todo清单（todoctl persist）
Exec="${exe}" --inspect=127.0.0.1:${port}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
  },
  install(port) {
    const f = linux.file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, linux.content(port), { mode: 0o644 });
    return { file: f, how: 'XDG autostart' };
  },
  uninstall() {
    try { fs.unlinkSync(linux.file()); } catch (e) {}
    return { file: linux.file(), how: 'XDG autostart' };
  },
  installed: () => fs.existsSync(linux.file()),
  loaded: () => fs.existsSync(linux.file()),
};

const backend = PLATFORM === 'darwin' ? darwin : PLATFORM === 'win32' ? win32 : linux;

/** App 设置里的「开机自启」是否开着（开着会和 persist 抢启动） */
function appAutostartEnabled() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'critical-state-backup.json'), 'utf8'));
    const settings = JSON.parse((raw.backup || {}).settingsState || '{}');
    return !!settings.runWhenComputerStart;
  } catch (e) {
    return null; // 读不到就说不知道
  }
}

function status(port) {
  return {
    platform: PLATFORM,
    supported: true,
    how: backend === darwin ? 'LaunchAgent' : backend === win32 ? '注册表 Run 键' : 'XDG autostart',
    installed: backend.installed(),
    loaded: backend.loaded(),
    file: backend.file ? backend.file() : `${WIN_KEY}\\${WIN_VALUE}`,
    port,
    appAutostart: appAutostartEnabled(),
  };
}

function on(port) {
  const r = backend.install(port);
  return Object.assign({ ok: true, action: 'persist-on', port }, r, {
    appAutostart: appAutostartEnabled(),
    note: '下次登录（或手动执行 ./todoctl app restart）后，App 会一直带本地接口运行',
  });
}

function off() {
  const r = backend.uninstall();
  return Object.assign({ ok: true, action: 'persist-off' }, r, {
    note: '已移除启动项；当前正在运行的 App 不受影响',
  });
}

module.exports = { status, on, off, appAutostartEnabled, LABEL };
