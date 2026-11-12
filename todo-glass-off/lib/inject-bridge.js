#!/usr/bin/env node
// 在解包后的 app 目录里注入 / 移除「打开本地调试端口」的那一行
// 用法：node inject-bridge.js <appDir> install|uninstall
//
// 用 Node 而不是 python3：macOS 12+ 已经不自带 python3，
// 而这里本来就要求有 Node.js（打包 asar 要用），少一个前置依赖。
const fs = require('fs');
const path = require('path');

const MARK = '/* @todo-bridge */';
const INJECT =
  'try{require("electron").app.commandLine.appendSwitch("remote-debugging-port","0")}catch(e){}' + MARK + '\n';

const appDir = process.argv[2];
const action = process.argv[3];

if (!appDir || (action !== 'install' && action !== 'uninstall')) {
  console.error('usage: inject-bridge.js <appDir> install|uninstall');
  process.exit(2);
}

const bgPath = path.join(appDir, 'background.js');
if (!fs.existsSync(bgPath)) {
  console.error('  ✗ 找不到 background.js（版本结构可能变了）');
  process.exit(1);
}

// 用 latin1 读写：字节级原样进出，避免 utf8 解码把压缩代码里的非法字节替换成 U+FFFD。
// 注入的是纯 ASCII 前缀，所以 latin1 不会把中文/多字节内容改坏。
const src = fs.readFileSync(bgPath, 'latin1');
const has = src.indexOf(MARK) >= 0;

if (action === 'install') {
  if (has) {
    console.log('  · 接口已存在，跳过注入');
    process.exit(0);
  }
  fs.writeFileSync(bgPath, INJECT + src, 'latin1');
  console.log('  ✓ 已注入调试端口开关');
} else {
  if (!has) {
    console.log('  · 接口本来就不在，跳过');
    process.exit(0);
  }
  // 注入时是「整行前缀」，移除时按标记整行切掉，保留原来的全部内容
  const idx = src.indexOf(MARK);
  const lineEnd = src.indexOf('\n', idx);
  const head = idx >= 0 ? src.slice(0, src.lastIndexOf('\n', idx) + 1) : src;
  const tail = lineEnd >= 0 ? src.slice(lineEnd + 1) : '';
  fs.writeFileSync(bgPath, head + tail, 'latin1');
  console.log('  ✓ 已移除调试端口开关');
}

// 断言：落盘结果必须和预期一致
const after = fs.readFileSync(bgPath, 'latin1');
const stillHas = after.indexOf(MARK) >= 0;
if ((action === 'install') !== stillHas) {
  console.error('  ✗ 注入未生效（标记状态不符）');
  process.exit(1);
}
process.exit(0);
