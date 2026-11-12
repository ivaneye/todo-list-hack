#!/bin/bash
# 截图 Todo清单 主窗口 -> /tmp/$1.png
name="${1:-shot}"
osascript -e 'tell application "Todo清单" to activate' >/dev/null 2>&1
sleep 1.2
b=$(osascript -e 'tell application "System Events" to tell process "Todo清单" to get {position, size} of window 1' 2>/dev/null)
x=$(echo "$b" | cut -d, -f1 | tr -d ' '); y=$(echo "$b" | cut -d, -f2 | tr -d ' ')
w=$(echo "$b" | cut -d, -f3 | tr -d ' '); h=$(echo "$b" | cut -d, -f4 | tr -d ' ')
screencapture -x -R "$x,$y,$w,$h" "/tmp/$name.png"
echo "/tmp/$name.png  ($b)"
