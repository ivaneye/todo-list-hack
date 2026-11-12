#!/bin/bash
# ============================================================
#  Todo清单 · macOS 皮肤工具包
#  1) 关闭主窗口的原生毛玻璃（vibrancy）
#  2) 注入 macOS 26/27 风格视觉皮肤（skin.css）
#
#  用法:
#    ./patch.sh                 打补丁 / 升级后重打（结束自动体检）
#    ./patch.sh --no-verify     打补丁但不体检
#    ./patch.sh --diag          只打印当前状态
#    TODO_APP="/path/App.app" ./patch.sh   指定非默认路径的 App
#
#  幂等：已是最新状态会直接退出；失败会在替换前中止。
# ============================================================
set -uo pipefail

TOOLKIT_VER="1.1"
HERE="$(cd "$(dirname "$0")" && pwd)"
BK="$HERE/backup"
DO_VERIFY=1
[ "${1:-}" = "--no-verify" ] && DO_VERIFY=0

# shellcheck source=lib/env.sh
. "$HERE/lib/env.sh"

echo "Todo清单 皮肤工具包 v${TOOLKIT_VER}"

# ---------- 环境检查 ----------
# node 缺失 / 版本太旧时，自动装一份到 .tools/node（不需要 sudo）
todo_require_node
[ -f "$HERE/skin.css" ] || { echo "✗ 工具包不完整：缺少 skin.css"; exit 1; }
[ -f "$HERE/lib/bake.js" ] || { echo "✗ 工具包不完整：缺少 lib/bake.js"; exit 1; }
todo_require_app
APP_NAME="$(basename "$APP" .app)"
RES="$APP/Contents/Resources"
ASAR="$RES/app.asar"
[ -f "$ASAR" ] || { echo "✗ 找不到 $ASAR（这个版本可能不是 Electron 应用）"; exit 1; }

VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)
ASAR_VER=$(node "$HERE/lib/asar-tool.js" getfile "$ASAR" package.json 2>/dev/null | grep -m1 -oE '"version": *"[0-9][0-9.]*"' | grep -oE '[0-9][0-9.]*')
HAS_BG=0; grep -a -q 'vibrancy:"titlebar"' "$ASAR" && HAS_BG=1
HAS_SKIN=0; grep -a -q '@macos-skin start' "$ASAR" && HAS_SKIN=1
SKIN_SHA=$(shasum "$HERE/skin.css" | awk '{print $1}')
APPLIED_SHA=$(cat "$BK/skin.sha" 2>/dev/null || echo none)

if [ "${1:-}" = "--diag" ]; then
  echo "----------------------------------------"
  echo "App 版本        : ${VER}（asar 内 package.json: ${ASAR_VER:-?}）"
  echo "App 路径        : ${APP}"
  echo "asar 大小/时间  : $(stat -f '%z bytes  %Sm' "$ASAR")"
  echo "含 vibrancy     : $([ "$HAS_BG" = 1 ] && echo '是（玻璃未关）' || echo '否（已关）')"
  echo "含皮肤标记      : $([ "$HAS_SKIN" = 1 ] && echo '是' || echo '否（皮肤未打进包）')"
  echo "skin.css 指纹   : ${SKIN_SHA}"
  echo "上次安装指纹    : ${APPLIED_SHA}"
  echo "Node.js        : $("${TODO_NODE}" -v)  ${TODO_NODE}"
  echo "备份            : $([ -f "$BK/app.asar.orig" ] && echo "$(stat -f%z "$BK/app.asar.orig") bytes（版本 $(cat "$BK/version" 2>/dev/null || echo '?')）" || echo '无')"
  exit 0
fi

# ---------- 是否已是最新 ----------
NEED=0
[ "$HAS_BG" = 1 ] && NEED=1
[ "$HAS_SKIN" = 0 ] && NEED=1
[ "$SKIN_SHA" != "$APPLIED_SHA" ] && NEED=1
if [ "$NEED" = 0 ]; then
  echo "✅ 补丁与皮肤都已是最新状态，无需重复操作"
  if ! todo_app_running "$APP"; then
    echo "==> 应用没在运行，帮你启动"
    open -a "$APP"
  fi
  exit 0
fi
echo "==> 待处理：$([ "$HAS_BG" = 1 ] && echo -n '关闭玻璃 ')$([ "$HAS_SKIN" = 0 ] && echo -n '写入皮肤')$([ "$SKIN_SHA" != "$APPLIED_SHA" ] && echo -n '更新皮肤')"

# ---------- 退出应用 ----------
echo "==> 退出 ${APP_NAME}"
if ! todo_quit_app "$APP"; then
  echo "✗ 应用未能退出，请手动退出后重试（未做任何修改）"; exit 1
fi

mkdir -p "$BK"

# ---------- 备份（首次运行 / 版本变化时自动创建）----------
# revert.sh 完全依赖它，所以每次动 asar 之前一定先确保有一份可用的原版备份。
if [ ! -f "$BK/app.asar.orig" ] || [ "$(cat "$BK/version" 2>/dev/null || true)" != "$VER" ]; then
  if [ "$HAS_SKIN" = 1 ] || [ "$HAS_BG" = 0 ]; then
    # 当前包已经是"改过"的状态，拿它当原版备份会把 revert 也一起废掉
    echo "⚠️  当前 App 看起来已经打过补丁（含皮肤标记 / 无 vibrancy），不能作为原版备份。"
    if [ -f "$BK/app.asar.orig" ]; then
      echo "   已保留原有备份：backup/app.asar.orig（版本 $(cat "$BK/version" 2>/dev/null || echo '?')）"
    else
      echo "   这台机器上没有可用的原版备份，revert.sh 将无法还原。"
      echo "   如需可还原：先从官网重新安装官方版，再跑一次 ./patch.sh（会自动备份）。"
    fi
  else
    echo "==> 首次运行：备份原始 app.asar（版本 ${VER}）→ backup/app.asar.orig"
    cp "$ASAR" "$BK/app.asar.orig"
    echo "$VER" > "$BK/version"
    echo "    （revert.sh 靠它还原官方版，请不要删除 backup/ 目录）"
  fi
fi

# 没有原版备份就没法安全打包（pack 需要它来确定哪些文件是 unpacked 的）
if [ ! -f "$BK/app.asar.orig" ]; then
  echo "✗ 没有可用的原版 app.asar 备份，无法安全打包。"
  echo "  请先从官网重新安装官方版，再运行 ./patch.sh（会自动备份）。"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 解包"
node "$HERE/lib/asar-tool.js" extract "$ASAR" "$WORK/app" || { echo "✗ 解包失败（未做任何修改）"; exit 1; }

echo "==> 打补丁"
node "$HERE/lib/bake.js" "$WORK/app" "$HERE/skin.css"
BAKE=$?
if [ "$BAKE" != 0 ]; then
  echo "✗ 补丁未应用（退出码 ${BAKE}），应用未做任何修改。"
  exit 1
fi

echo "==> 重新打包"
node "$HERE/lib/asar-tool.js" pack "$WORK/app" "$WORK/app.asar" "$BK/app.asar.orig" || { echo "✗ 打包失败（未做任何修改）"; exit 1; }
node "$HERE/lib/asar-tool.js" verify "$BK/app.asar.orig" "$WORK/app.asar"

echo "==> 替换并重新签名（ad-hoc）"
cp "$WORK/app.asar" "$ASAR"
if ! codesign --force --deep --sign - "$APP" || ! codesign --verify "$APP"; then
  echo "✗ 签名失败，请执行 ./revert.sh 回滚"
  exit 1
fi
echo "   ✓ 签名校验通过"

# ---------- 安装后断言：确认落盘的就是打好补丁的包 ----------
echo "==> 安装后断言"
FAIL=0
grep -a -q 'vibrancy:"titlebar"' "$ASAR" && { echo "   ✗ asar 里仍有 vibrancy"; FAIL=1; }
grep -a -q '@macos-skin start' "$ASAR" || { echo "   ✗ asar 里没有皮肤标记（皮肤没打进去）"; FAIL=1; }
SZ=$(stat -f%z "$ASAR"); [ "$SZ" -gt 20000000 ] || { echo "   ✗ asar 体积异常（${SZ} bytes）"; FAIL=1; }
if [ "$FAIL" = 1 ]; then
  echo "✗ 断言失败：请执行 ./patch.sh --diag 查看状态，或 ./revert.sh 回滚"
  exit 1
fi
echo "   ✓ 磁盘上的 app.asar 已包含皮肤、且不含 vibrancy"
echo "$SKIN_SHA" > "$BK/skin.sha"

# ---------- 清理渲染缓存（asar 内 CSS 文件名不变，旧缓存会让新样式不生效）----------
APP_PKG_NAME=$(node "$HERE/lib/asar-tool.js" getfile "$ASAR" package.json 2>/dev/null | grep -m1 -oE '"name": *"[^"]+"' | sed 's/.*"name": *"//;s/"$//')
UD="$HOME/Library/Application Support/${APP_PKG_NAME:-$APP_NAME}"
if [ -d "$UD" ]; then
  rm -rf "$UD/Cache" "$UD/Code Cache" 2>/dev/null
  echo "==> 已清理渲染缓存"
fi

# 之前开过本地接口（todoctl 用）就自动补回，避免被本次 asar 重打包覆盖
if [ -f "$BK/bridge.enabled" ] && ! grep -a -q '@todo-bridge' "$ASAR"; then
  echo "==> 检测到之前启用的本地接口，自动补回"
  "$HERE/bridge.sh" install >/dev/null 2>&1 || echo "   ⚠️ 本地接口补回失败，请手动执行 ./bridge.sh install"
fi

if [ "$DO_VERIFY" = 1 ]; then
  echo "==> 自检（滚轮 / 皮肤 / 玻璃）"
  if "$HERE/verify.sh"; then
    echo "✅ 完成：补丁生效，自检通过"
    exit 0
  else
    echo "✗ 自检未通过：请执行 ./revert.sh 回滚，并把上面的输出反馈"
    exit 1
  fi
else
  echo "==> 启动"
  open -a "$APP"
fi
