#!/bin/bash
# ============================================================
#  lib/env.sh —— 各脚本共用的环境准备
#
#  用法（在 patch.sh / revert.sh / verify.sh / bridge.sh 里）：
#      HERE="$(cd "$(dirname "$0")" && pwd)"
#      . "$HERE/lib/env.sh"
#      todo_require_node
#
#  为什么必须要 Node.js 22+：
#    lib/asar-tool.js 用它解包 / 重新打包 app.asar；
#    lib/verify.js、dev/*.js 用到全局 fetch 与 WebSocket（Node 22 起才稳定）。
#
#  没有 Node.js 时不需要手动装：本脚本会把官方 Node.js 解压到工具目录
#  .tools/node 下自己用 —— 不动系统里已有的 node，不需要 sudo，也不写系统路径。
#
#  可用环境变量：
#    TODO_NO_INSTALL_NODE=1     缺 node 时不要自动下载，直接报错退出
#    TODO_NODE_MIRROR="..."     指定下载镜像（默认官方 + npmmirror 兜底）
#    TODO_NODE_BIN=/path/node   强行指定用哪个 node
#    TODO_APP="/path/App.app"   指定非默认路径的 App
# ============================================================

TODO_NODE_MIN_MAJOR=22
TODO_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODO_TOOLS="$TODO_HERE/.tools"

todo_say()  { printf '%s\n' "$*"; }
todo_ok()   { printf '   ✓ %s\n' "$*"; }
todo_warn() { printf '⚠️  %s\n' "$*" >&2; }
todo_die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

# ---------- 平台 ----------
todo_need_mac() {
  [ "$(uname -s)" = "Darwin" ] || todo_die "本工具只支持 macOS（当前：$(uname -s)）"
}

todo_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo arm64 ;;
    *)             echo x64 ;;
  esac
}

# node 是否真的可用：版本够新，且有全局 fetch / WebSocket（比只看版本号靠谱）
todo_node_usable() {
  local bin="$1"
  [ -x "$bin" ] || return 1
  "$bin" -e 'const m=+process.versions.node.split(".")[0];
             process.exit(m>='"$TODO_NODE_MIN_MAJOR"' && typeof fetch==="function" && typeof WebSocket==="function" ? 0 : 1)' \
    >/dev/null 2>&1
}

# ---------- 找 node ----------
todo_find_node() {
  local c
  for c in "${TODO_NODE_BIN:-}" \
           "$TODO_TOOLS/node/bin/node" \
           "$(command -v node 2>/dev/null)" \
           /opt/homebrew/bin/node \
           /usr/local/bin/node \
           "$HOME/.nvm/current/bin/node"; do
    [ -n "$c" ] || continue
    if todo_node_usable "$c"; then printf '%s\n' "$c"; return 0; fi
  done
  # nvm / volta / fnm 装过的任意版本
  for c in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node; do
    [ -x "$c" ] || continue
    if todo_node_usable "$c"; then printf '%s\n' "$c"; return 0; fi
  done
  return 1
}

# ---------- 自动下载安装（只装到工具目录）----------
todo_install_node() {
  local arch base line sum file url actual dir got_base="" ver nv
  arch="$(todo_arch)"

  todo_say "==> 没找到可用的 Node.js（需要 ${TODO_NODE_MIN_MAJOR}+），自动装一份到 .tools/node"
  todo_say "    只解压到本工具目录，不动系统已有的 node，不需要 sudo"

  mkdir -p "$TODO_TOOLS" || todo_die "无法创建 $TODO_TOOLS（目录不可写）"
  command -v curl >/dev/null 2>&1 || todo_die "没有 curl，无法自动安装 Node.js"

  # 1) 从 index.json 找最新 LTS 版本号，再拿这个版本的 SHASUMS256.txt（含 sha256）
  for base in ${TODO_NODE_MIRROR:-https://nodejs.org/dist https://cdn.npmmirror.com/binaries/node}; do
    [ -n "$got_base" ] && break
    ver="$(curl -fsSL --max-time 25 "$base/index.json" 2>/dev/null \
           | grep -E '"version":"v[0-9]+\.[0-9]+\.[0-9]+"' \
           | grep -E '"lts":"' | head -1 \
           | sed -E 's/.*"version":"(v[0-9.]+)".*/\1/')"
    [ -n "$ver" ] || continue
    line="$(curl -fsSL --max-time 25 "$base/$ver/SHASUMS256.txt" 2>/dev/null \
            | grep -E "node-${ver}-darwin-${arch}\.tar\.gz[[:space:]]*$" \
            | head -1)"
    [ -n "$line" ] && got_base="$base"
  done
  [ -n "$got_base" ] || todo_die "连不上下载源（nodejs.org / npmmirror），无法自动安装。
  可手动安装后再跑：brew install node   或   https://nodejs.org/zh-cn/download"

  sum="$(printf '%s' "$line" | awk '{print $1}')"
  file="$(printf '%s' "$line" | awk '{print $2}')"
  url="$got_base/$ver/$file"

  todo_say "==> 下载 Node.js ${ver}（$(todo_arch)）"
  curl -fL --progress-bar -o "$TODO_TOOLS/$file" "$url" || {
    rm -f "$TODO_TOOLS/$file"
    todo_die "下载失败：$url
  换个镜像再试：TODO_NODE_MIRROR=https://cdn.npmmirror.com/binaries/node ./patch.sh"
  }

  actual="$(shasum -a 256 "$TODO_TOOLS/$file" | awk '{print $1}')"
  if [ "$actual" != "$sum" ]; then
    rm -f "$TODO_TOOLS/$file"
    todo_die "校验失败（sha256 不匹配），已删除下载文件"
  fi
  todo_ok "sha256 校验通过"

  tar -xzf "$TODO_TOOLS/$file" -C "$TODO_TOOLS" || todo_die "解压失败"
  rm -f "$TODO_TOOLS/$file"
  dir="$TODO_TOOLS/${file%.tar.gz}"

  rm -rf "$TODO_TOOLS/node"
  ln -sfn "$dir" "$TODO_TOOLS/node" || todo_die "创建软链失败：$TODO_TOOLS/node"
  todo_node_usable "$TODO_TOOLS/node/bin/node" || todo_die "装完仍无法运行 node（$dir/bin/node）"
  nv="$("$TODO_TOOLS/node/bin/node" -v)"
  todo_ok "已安装 $nv"
}

# ---------- 对外入口：确保有可用 node，并把 node 放进 PATH ----------
todo_require_node() {
  local bin
  todo_need_mac
  if bin="$(todo_find_node)"; then
    TODO_NODE="$bin"
  else
    [ "${TODO_NO_INSTALL_NODE:-0}" = "1" ] && todo_die \
      "没找到可用的 Node.js（${TODO_NODE_MIN_MAJOR}+），已按 TODO_NO_INSTALL_NODE=1 跳过自动安装。
  手动安装：brew install node   或   https://nodejs.org/zh-cn/download"
    todo_install_node
    TODO_NODE="$TODO_TOOLS/node/bin/node"
  fi
  export TODO_NODE
  # 让脚本里所有 `node xxx` 都用到同一个版本（含被 patch.sh 调起的 verify.sh / bridge.sh）
  export PATH="$(dirname "$TODO_NODE"):$PATH"
}

# ---------- App 定位 / 退出 ----------
todo_find_app() {
  local a
  for a in "${TODO_APP:-}" \
           "/Applications/Todo清单.app" \
           "$HOME/Applications/Todo清单.app"; do
    [ -n "$a" ] || continue
    [ -d "$a" ] && { printf '%s\n' "$a"; return 0; }
  done
  return 1
}

todo_require_app() {
  APP="$(todo_find_app)" || todo_die "找不到 Todo清单.app（试过 /Applications、~/Applications）。
  可用 TODO_APP=\"/path/Todo清单.app\" 指定路径"
  export APP
}

# 退出应用并等它真的退干净；成功返回 0
todo_quit_app() {
  local APP="$1" APP_NAME i
  APP_NAME="$(basename "$APP" .app)"
  osascript -e "quit app \"$APP_NAME\"" 2>/dev/null
  for i in $(seq 1 20); do
    pgrep -f "$APP/Contents/MacOS" >/dev/null || return 0
    sleep 0.5
  done
  ! pgrep -f "$APP/Contents/MacOS" >/dev/null
}

todo_app_running() { pgrep -f "$1/Contents/MacOS" >/dev/null; }

# ---------- 找一个空闲的本机端口（体检用的调试端口）----------
todo_free_port() {
  local p list
  if command -v jot >/dev/null 2>&1; then
    list="$(jot -r 60 9300 9599)"
  else
    list="$(seq 9300 9359)"
  fi
  for p in $list; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || { printf '%s\n' "$p"; return 0; }
  done
  printf '9222\n'
}
