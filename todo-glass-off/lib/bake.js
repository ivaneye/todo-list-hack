#!/usr/bin/env node
// 在解包后的 app 目录里打补丁：
//   1) 关闭 macOS 主窗口 vibrancy（原生玻璃）
//   2) 追加 skin.css 视觉皮肤（先做安全检查）
// 用法：node bake.js <appDir> <skin.css>
const fs = require('fs');
const path = require('path');

const appDir = process.argv[2];
const skinPath = process.argv[3];

// ---------- 0. 皮肤安全检查 ----------
// 这些都是在真机上踩过的坑，命中就不许装，避免把应用改坏。
const skinRaw = fs.readFileSync(skinPath, 'utf8');
const skin = skinRaw;
// 安全检查只看规则本身，注释里的示例文字不算
const ruleText = skinRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const danger = [];

// 滚动容器被 overflow 掉 → 滚轮失效
const surfaceBlocks = ruleText.match(/\.todo-page-surface[^{]*\{[^}]*\}/g) || [];
for (const block of surfaceBlocks) {
  if (/overflow\s*:\s*hidden/.test(block)) {
    danger.push(
      '`.todo-page-surface` 里出现了 overflow: hidden —— 它是列表的滚动容器，会导致滚轮失效。\n' +
        '    圆角裁切请用 clip-path: inset(0 round 14px)。'
    );
  }
}
// 虚拟列表：改行高 / 内外边距会让滚动位置算错
const rowBlocks = ruleText.match(/\.todo-list-item[^{]*\{[^}]*\}/g) || [];
for (const block of rowBlocks) {
  const m = block.match(/(?:^|[;{\s])(margin(?:-top|-bottom)?|height|padding(?:-top|-bottom)?)\s*:\s*([^;}]+)/);
  if (m && !/^margin\s*:\s*0\s+[\d.]+px\s*(!important)?\s*$/.test(m[0].trim())) {
    danger.push(
      '`.todo-list-item` 里改了 ' + m[1] + ': ' + m[2].trim() + ' —— 会让虚拟滚动算错高度。\n' +
        '    只允许 margin: 0 <水平值>（水平缩进），不要动上下边距和高度。'
    );
  }
}
if (danger.length) {
  console.error('  ✗ 皮肤安全检查未通过：');
  danger.forEach((d) => console.error('    - ' + d));
  process.exit(2);
}
console.log('  ✓ 皮肤安全检查通过');

// ---------- 1. 关闭 vibrancy ----------
const bgPath = path.join(appDir, 'background.js');
const bg = fs.readFileSync(bgPath, 'utf8');
const OLD = '"darwin"===e?{backgroundColor:"#00000000",vibrancy:"titlebar",visualEffectState:"followWindow"}';
const NEW = '"darwin"===e?{backgroundColor:"dark"===r?"#202020":"#f3f3f3"}';
if (bg.includes(OLD)) {
  fs.writeFileSync(bgPath, bg.replace(OLD, NEW));
  console.log('  ✓ 已关闭主窗口 vibrancy');
} else if (bg.includes(NEW)) {
  console.log('  · vibrancy 已是关闭状态，跳过');
} else {
  // 官方可能自己改掉了这段代码，退化成“只装皮肤”，不影响使用
  console.log('  ! 未找到 vibrancy 目标代码（官方可能改过窗口参数），跳过玻璃补丁，继续装皮肤');
}

// ---------- 2. 追加皮肤 CSS ----------
const cssDir = path.join(appDir, 'css');
const cssFile = fs
  .readdirSync(cssDir)
  .filter((f) => /^index\..*\.css$/.test(f))
  .sort()
  .pop();
if (!cssFile) {
  console.error('  ✗ 找不到 css/index.*.css');
  process.exit(1);
}
const cssPath = path.join(cssDir, cssFile);
let css = fs.readFileSync(cssPath, 'utf8');
const START = '/* @macos-skin start */';
const END = '/* @macos-skin end */';
if (css.includes(START)) {
  css = css.slice(0, css.indexOf(START));
  console.log('  · 发现旧皮肤，替换为新版本');
}
fs.writeFileSync(cssPath, css + '\n' + START + '\n' + skin + '\n' + END + '\n');
console.log('  ✓ 皮肤已写入 ' + cssFile);
