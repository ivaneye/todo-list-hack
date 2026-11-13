#!/bin/bash
# ============================================================
#  Todo清单 · 还原官方原版
#  用 backup/app.asar.orig 覆盖回去并重新签名（恢复毛玻璃、去掉皮肤）
#
#  用法: ./revert.sh
#        TODO_APP="/path/App.app" ./revert.sh
# ============================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BK="$HERE/backup"

# shellcheck source=lib/env.sh
. "$HERE/lib/env.sh"

todo_require_app
APP_NAME="$(basename "$APP" .app)"
ASAR="$APP/Contents/Resources/app.asar"

[ -f "$ASAR" ] || { echo "✗ 找不到 $ASAR"; exit 1; }
[ -f "$BK/app.asar.orig" ] || {
  echo "✗ 没有备份（$BK/app.asar.orig）"
  echo "  说明这台机器上还没打过补丁；要恢复官方版，直接删掉 App 重新安装即可。"
  exit 1
}

VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)
BKVER=$(cat "$BK/version" 2>/dev/null || echo unknown)
if [ "$VER" != "$BKVER" ]; then
  echo "⚠️  当前 App 版本 ${VER}，备份是 ${BKVER} —— 版本不一致，直接还原会把两个版本的文件混在一起。"
  echo "   建议：删掉 App 后从官网重新下载安装（等同于还原官方原版）。"
  echo "   仍要继续还原请输入 yes："
  read -r ans
  [ "$ans" = "yes" ] || { echo "已取消"; exit 1; }
fi

echo "==> 退出 ${APP_NAME}"
todo_quit_app "$APP" || echo "   ⚠️ 应用没退出，继续尝试还原"

echo "==> 还原 app.asar"
cp "$BK/app.asar.orig" "$ASAR"
if ! codesign --force --deep --sign - "$APP" || ! codesign --verify "$APP"; then
  echo "✗ 签名失败，请删除 App 后重新安装"
  exit 1
fi
rm -f "$BK/skin.sha"

echo "==> 启动"
open -a "$APP"
echo "✅ 已还原官方原版（毛玻璃回来了，皮肤已去掉）"
