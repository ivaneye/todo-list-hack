#!/bin/bash
# ============================================================
#  安装后自检：以调试端口拉起 App → 跑 lib/verify.js → 关掉 → 正常重启
#  检查项：皮肤生效（圆角/clip-path）、玻璃已关、列表容器可滚动、真实滚轮能滚动
#
#  用法: ./verify.sh
#        PORT=9333 ./verify.sh          指定调试端口（默认自动挑一个空闲端口）
#        TODO_APP="/path/App.app" ./verify.sh
# ============================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=lib/env.sh
. "$HERE/lib/env.sh"

todo_require_node     # 缺 Node.js 会自动装到 .tools/node
todo_require_app
APP_NAME="$(basename "$APP" .app)"

[ -f "$HERE/lib/verify.js" ] || { echo "✗ 工具包不完整：缺少 lib/verify.js"; exit 1; }

echo "==> 退出 ${APP_NAME}"
if ! todo_quit_app "$APP"; then
  echo "✗ 应用退不掉，先手动退出再自检"; exit 1
fi

# 端口：优先用指定的；否则自动挑一个空闲的（避免 9222 被 VS Code 等占着）。
# 注意：如果装了本地接口（./bridge.sh install），App 会强制开随机端口，
# 真实端口以 App 写出的 DevToolsActivePort 为准，所以启动后再读一次。
REQ_PORT="${PORT:-$(todo_free_port)}"
PORTFILE="$HOME/Library/Application Support/todo-list/DevToolsActivePort"
rm -f "$PORTFILE"   # 清掉上一轮的，避免读到旧端口

echo "==> 启动并开放调试端口 ${REQ_PORT}"
open -a "$APP" --args --remote-debugging-port="$REQ_PORT"

for i in $(seq 1 30); do [ -s "$PORTFILE" ] && break; sleep 0.5; done
PORT="$REQ_PORT"
[ -s "$PORTFILE" ] && PORT="$(head -1 "$PORTFILE")"
export PORT
echo "==> 实际调试端口 ${PORT}"

node "$HERE/lib/verify.js"
STATUS=$?

todo_quit_app "$APP"
open -a "$APP"

exit $STATUS
