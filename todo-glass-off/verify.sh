#!/bin/bash
# ============================================================
#  安装后自检：以调试端口拉起 App → 跑 lib/verify.js → 关掉 → 正常重启
#  检查项：皮肤生效（圆角/clip-path）、玻璃已关、列表容器可滚动、真实滚轮能滚动
#
#  用法: ./verify.sh
# ============================================================
set -uo pipefail

APP="${TODO_APP:-/Applications/Todo清单.app}"
APP_NAME="$(basename "$APP" .app)"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -d "$APP" ] || { echo "✗ 找不到应用：$APP"; exit 1; }

osascript -e "quit app \"$APP_NAME\"" 2>/dev/null
for i in $(seq 1 20); do pgrep -f "$APP/Contents/MacOS" >/dev/null || break; sleep 0.5; done
if pgrep -f "$APP/Contents/MacOS" >/dev/null; then
  echo "✗ 应用退不掉，先手动退出再自检"; exit 1
fi

open -a "$APP" --args --remote-debugging-port=9222
sleep 6

node "$HERE/lib/verify.js"
STATUS=$?

osascript -e "quit app \"$APP_NAME\"" 2>/dev/null
for i in $(seq 1 20); do pgrep -f "$APP/Contents/MacOS" >/dev/null || break; sleep 0.5; done
open -a "$APP"

exit $STATUS
