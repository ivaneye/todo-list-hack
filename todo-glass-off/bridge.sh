#!/bin/bash
# ============================================================
#  bridge.sh —— 给 Todo清单 打开一个「本地自动化接口」
#
#  作用：让 App 启动时开放 Chrome DevTools 调试端口（仅 127.0.0.1、随机端口，
#        端口号写在 App 数据目录的 DevToolsActivePort 里），
#        这样 ./todoctl 就能像「界面点按钮」一样操作待办。
#
#  用法：
#    ./bridge.sh install     安装（幂等）→ 重启 App
#    ./bridge.sh uninstall   移除
#    ./bridge.sh status      查看状态
#
#  安全说明：端口只绑定 127.0.0.1，本机任意进程都能连（相当于本机任意进程
#  都能读你的 todo-list 数据目录，本来也读得到）。不需要时可用 uninstall 关掉。
# ============================================================
set -uo pipefail

TOOLKIT_VER="1.0"
APP="${TODO_APP:-/Applications/Todo清单.app}"
APP_NAME="$(basename "$APP" .app)"
RES="$APP/Contents/Resources"
ASAR="$RES/app.asar"
HERE="$(cd "$(dirname "$0")" && pwd)"
BK="$HERE/backup"
MARK='/* @todo-bridge */'
INJECT='try{require("electron").app.commandLine.appendSwitch("remote-debugging-port","0")}catch(e){}'"$MARK"'\n'

ACTION="${1:-status}"

command -v node >/dev/null 2>&1 || { echo "✗ 需要 Node.js（brew install node）"; exit 1; }
[ -f "$ASAR" ] || { echo "✗ 找不到 $ASAR"; exit 1; }

has_mark() { grep -a -q '@todo-bridge' "$ASAR"; }

case "$ACTION" in
  status)
    if has_mark; then echo "✅ 已安装本地接口（todoctl 可用）"; else echo "❌ 未安装本地接口（todoctl 不可用）"; fi
    PORTFILE="$HOME/Library/Application Support/todo-list/DevToolsActivePort"
    if [ -f "$PORTFILE" ]; then echo "   当前调试端口：$(head -1 "$PORTFILE")"; else echo "   当前没有运行中的调试端口（App 未启动或未装接口）"; fi
    exit 0
    ;;
  install|uninstall) ;;
  *) echo "用法: ./bridge.sh [install|uninstall|status]"; exit 2 ;;
esac

osascript -e "quit app \"$APP_NAME\"" 2>/dev/null
for i in $(seq 1 20); do pgrep -f "$APP/Contents/MacOS" >/dev/null || break; sleep 0.5; done
if pgrep -f "$APP/Contents/MacOS" >/dev/null; then echo "✗ 应用未能退出，请手动退出后重试"; exit 1; fi

[ -f "$BK/app.asar.orig" ] || { echo "✗ 缺少 backup/app.asar.orig（先跑一次 ./patch.sh）"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 解包"
node "$HERE/lib/asar-tool.js" extract "$ASAR" "$WORK/app" >/dev/null || { echo "✗ 解包失败"; exit 1; }

BG="$WORK/app/background.js"
if [ "$ACTION" = install ]; then
  if grep -q '@todo-bridge' "$BG"; then
    echo "==> 接口已存在，跳过注入"
  else
    python3 - "$BG" <<'PY'
import sys
p = sys.argv[1]
src = open(p, encoding='utf-8', errors='surrogateescape').read()
inject = 'try{require("electron").app.commandLine.appendSwitch("remote-debugging-port","0")}catch(e){}/* @todo-bridge */\n'
open(p, 'w', encoding='utf-8', errors='surrogateescape').write(inject + src)
print("   ✓ 已注入调试端口开关")
PY
  fi
else
  if grep -q '@todo-bridge' "$BG"; then
    python3 - "$BG" <<'PY'
import sys
p = sys.argv[1]
src = open(p, encoding='utf-8', errors='surrogateescape').read()
mark = '/* @todo-bridge */\n'
i = src.find(mark)
src = src[i + len(mark):] if i >= 0 else src
open(p, 'w', encoding='utf-8', errors='surrogateescape').write(src)
print("   ✓ 已移除调试端口开关")
PY
  else
    echo "==> 接口本来就不在，跳过"
  fi
fi

if [ "$ACTION" = install ]; then touch "$BK/bridge.enabled"; else rm -f "$BK/bridge.enabled"; fi

echo "==> 重新打包并签名"
node "$HERE/lib/asar-tool.js" pack "$WORK/app" "$WORK/app.asar" "$BK/app.asar.orig" >/dev/null || { echo "✗ 打包失败"; exit 1; }
cp "$WORK/app.asar" "$ASAR"
if ! codesign --force --deep --sign - "$APP" || ! codesign --verify "$APP"; then
  echo "✗ 签名失败"; exit 1
fi
echo "   ✓ 签名校验通过"

# 断言
if [ "$ACTION" = install ]; then
  grep -a -q '@todo-bridge' "$ASAR" || { echo "✗ 注入未生效"; exit 1; }
else
  grep -a -q '@todo-bridge' "$ASAR" && { echo "✗ 移除未生效"; exit 1; }
fi

echo "==> 启动"
open -a "$APP"
sleep 5
if [ "$ACTION" = install ]; then
  PORTFILE="$HOME/Library/Application Support/todo-list/DevToolsActivePort"
  for i in $(seq 1 20); do [ -f "$PORTFILE" ] && break; sleep 0.5; done
  if [ -f "$PORTFILE" ]; then
    echo "✅ 完成：本地接口端口 $(head -1 "$PORTFILE")（仅 127.0.0.1）"
    echo "   试试：./todoctl list --table"
  else
    echo "⚠️  接口已写入，但没检测到端口文件；手动重启一次 Todo清单 再看 ./bridge.sh status"
  fi
else
  echo "✅ 已移除本地接口"
fi
