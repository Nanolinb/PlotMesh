#!/usr/bin/env bash
# scripts/install-autostart.sh · macOS launchd 自启安装脚本（v1.6.2）
# ----------------------------------------------------------------
# 把 PlotMesh server 注册成"登录 Mac 时自动启动"的后台服务，
# 之后再也不用手动 cd server && npm start。
#
# 用法：
#   bash scripts/install-autostart.sh           # 安装并启动
#   bash scripts/install-autostart.sh --uninstall  # 卸载
#   bash scripts/install-autostart.sh --status   # 查看状态
#
# 实现：
#   - 写一个 plist 到 ~/Library/LaunchAgents/com.plotmesh.server.plist
#   - launchctl load 让它生效；KeepAlive=true 让它崩了自动拉起来
#   - 日志输出到 ~/.plotmesh/server.log / server-err.log

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.plotmesh.server"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.plotmesh"
LOG_OUT="$LOG_DIR/server.log"
LOG_ERR="$LOG_DIR/server-err.log"

# 找 node 的绝对路径（launchd 不继承 shell 的 PATH）
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "❌ 找不到 node。请先安装 Node.js（建议 v22+），或 brew install node"
  exit 1
fi

usage() {
  echo "用法："
  echo "  $0                # 安装并启动"
  echo "  $0 --uninstall    # 卸载"
  echo "  $0 --status       # 查看状态"
}

cmd="${1:-install}"

case "$cmd" in
  --status|status)
    echo "📋 PlotMesh server 自启状态："
    if [[ -f "$PLIST_PATH" ]]; then
      echo "   plist：✅ 存在 $PLIST_PATH"
    else
      echo "   plist：❌ 未安装"
    fi
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      echo "   launchctl：✅ 已加载"
      launchctl list | grep "$LABEL" | awk '{print "     PID="$1, "ExitCode="$2, "Label="$3}'
    else
      echo "   launchctl：❌ 未加载"
    fi
    echo "   日志：$LOG_OUT"
    echo "        $LOG_ERR"
    if [[ -f "$LOG_OUT" ]]; then
      echo
      echo "📝 最后 5 行 stdout："
      tail -n 5 "$LOG_OUT" | sed 's/^/     /'
    fi
    exit 0
    ;;

  --uninstall|uninstall)
    echo "🗑  卸载 PlotMesh 自启..."
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      launchctl unload "$PLIST_PATH" 2>/dev/null || true
      echo "   - launchctl unload ✓"
    fi
    if [[ -f "$PLIST_PATH" ]]; then
      rm "$PLIST_PATH"
      echo "   - 删除 plist ✓"
    fi
    echo "✅ 已卸载。日志保留在 $LOG_DIR/"
    exit 0
    ;;

  --help|-h|help)
    usage
    exit 0
    ;;

  install|"")
    : # 继续往下走
    ;;

  *)
    echo "❌ 未知命令：$cmd"
    usage
    exit 1
    ;;
esac

# ─── 安装流程 ─────────────────────────────────────────────────
echo "📦 PlotMesh server 自启安装"
echo "   项目路径：$PROJECT_ROOT"
echo "   Node：    $NODE_BIN"
echo "   plist：   $PLIST_PATH"

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$PLIST_PATH")"

# 如果已经装了，先 unload
if launchctl list 2>/dev/null | grep -q "$LABEL"; then
  echo "⚠️  已有同名服务在跑，先 unload..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# 写 plist
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_ROOT/server/src/index.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_ROOT/server</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>

    <key>StandardErrorPath</key>
    <string>$LOG_ERR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

echo "   - 写入 plist ✓"

# load
launchctl load "$PLIST_PATH"
echo "   - launchctl load ✓"

sleep 1

# 验证
if launchctl list 2>/dev/null | grep -q "$LABEL"; then
  echo
  echo "✅ 安装完成！PlotMesh server 已在后台运行。"
  echo
  echo "   端口：     3001"
  echo "   登录自启： 是（重启 Mac 后会自动启动）"
  echo "   崩溃重启： 是"
  echo "   日志：     $LOG_OUT"
  echo
  echo "💡 接下来就可以打开浏览器访问 http://localhost:5173/"
  echo "   sidebar 顶部的状态灯应该是 🟢"
  echo
  echo "   想看运行日志：     tail -f $LOG_OUT"
  echo "   想查看状态：       $0 --status"
  echo "   想卸载（停止自启）：$0 --uninstall"
else
  echo
  echo "⚠️  load 后未在 launchctl list 中找到 $LABEL。请检查日志："
  echo "    cat $LOG_ERR"
  exit 1
fi
