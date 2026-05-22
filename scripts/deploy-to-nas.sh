#!/usr/bin/env bash
# scripts/deploy-to-nas.sh · 一键部署 PlotMesh 到群晖 / Linux 服务器（v1.6.4+）
# ----------------------------------------------------------------
# 通过 ssh 远程操作目标机器：
#   - 第一次：git clone + docker compose up -d
#   - 之后：  git fetch + reset + docker compose up -d --build
#   - 收尾：  健康检查 + 打印 token 和访问地址
#
# 用法：
#   1) 首次配置：复制 scripts/deploy.env.example 为 scripts/deploy.env 并填入 NAS 信息
#      （deploy.env 已被 .gitignore 排除，不会提交）
#   2) 部署：bash scripts/deploy-to-nas.sh
#   3) 子命令：
#      bash scripts/deploy-to-nas.sh logs       # 看 NAS 上的容器日志
#      bash scripts/deploy-to-nas.sh status     # 看运行状态 + token
#      bash scripts/deploy-to-nas.sh down       # 停止 NAS 上的容器
#      bash scripts/deploy-to-nas.sh restart    # 重启容器（不重新 build）
#      bash scripts/deploy-to-nas.sh ssh        # 直接 ssh 进 NAS
#
# 前提：
#   - 已有 ssh key 登录权限（不再问密码）。否则每步会重复输密码
#   - NAS 上已装 docker + docker-compose（群晖 Container Manager 自带）
#   - NAS 上已装 git
#
# ⚠️ 不会自动拉 .env 里的大模型 key（PlotMesh 设计上 key 是写在 NAS 上 server/.env，
#    跟代码仓库分离）。第一次部署后到前端 API 配置 → 大模型 API Key 填即可。

set -euo pipefail

# ─── 加载配置 ───────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/scripts/deploy.env"

# help 子命令不需要 env，先处理掉
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
PlotMesh 部署脚本（v1.6.4+）

用法：
  bash scripts/deploy-to-nas.sh [命令]

命令：
  deploy   （默认）首次 git clone + 后续 git pull + docker compose up -d --build
  status   查看 NAS 上的容器状态 + token
  logs     实时跟踪 NAS 上的容器日志
  restart  重启容器（不重新 build）
  down     停止 NAS 上的所有容器
  ssh      直接 ssh 进 NAS 项目目录
  help     显示此帮助

配置：
  scripts/deploy.env  NAS 地址、用户名、部署路径（自己创建，已 .gitignore）

示例：
  bash scripts/deploy-to-nas.sh             # 部署
  bash scripts/deploy-to-nas.sh status      # 看状态
  bash scripts/deploy-to-nas.sh logs        # 看日志
EOF
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat <<EOF
❌ 找不到配置文件：$ENV_FILE

请先创建它：
  cp $PROJECT_ROOT/scripts/deploy.env.example $ENV_FILE
然后编辑填入 NAS 地址、用户名、部署路径等信息。

之后跑：
  bash scripts/deploy-to-nas.sh        # 部署
  bash scripts/deploy-to-nas.sh help   # 看所有命令
EOF
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

# 校验必填变量
: "${NAS_HOST:?NAS_HOST 未设置（在 $ENV_FILE 中）}"
: "${NAS_USER:?NAS_USER 未设置}"
: "${NAS_PORT:=22}"
: "${NAS_DEPLOY_PATH:?NAS_DEPLOY_PATH 未设置}"
: "${GIT_REPO:=https://github.com/Nanolinb/PlotMesh.git}"
: "${GIT_BRANCH:=main}"

# ssh helper
SSH_OPTS="-p $NAS_PORT -o ServerAliveInterval=30 -o ServerAliveCountMax=3"
SSH="ssh $SSH_OPTS $NAS_USER@$NAS_HOST"

# 颜色
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[34m%s\033[0m\n" "$*"; }
gray()  { printf "\033[2m%s\033[0m\n" "$*"; }

cmd="${1:-deploy}"

# ─── 子命令 ─────────────────────────────────────────────────────

cmd_logs() {
  blue "📋 NAS 上的容器日志（Ctrl+C 退出）"
  $SSH -t "cd $NAS_DEPLOY_PATH && docker compose logs -f --tail=100"
}

cmd_status() {
  blue "📊 NAS 部署状态"
  echo
  $SSH "cd $NAS_DEPLOY_PATH 2>/dev/null && docker compose ps && echo && echo '── token ──' && docker exec plotmesh-server cat /data/api-token 2>/dev/null || echo '(server 容器未运行)'"
  echo
  green "🌐 访问地址："
  echo "   web: http://$NAS_HOST:8080/"
  echo "   API: http://$NAS_HOST:3001/"
}

cmd_down() {
  blue "🛑 停止 NAS 上的容器"
  $SSH "cd $NAS_DEPLOY_PATH && docker compose down"
  green "✅ 已停止"
}

cmd_restart() {
  blue "🔄 重启容器（不 rebuild）"
  $SSH "cd $NAS_DEPLOY_PATH && docker compose restart"
  green "✅ 已重启"
}

cmd_ssh() {
  blue "💻 进入 NAS shell"
  $SSH -t "cd $NAS_DEPLOY_PATH 2>/dev/null; bash -l"
}

# ─── 主部署流程 ─────────────────────────────────────────────────

cmd_deploy() {
  blue "🚀 部署 PlotMesh 到 $NAS_USER@$NAS_HOST:$NAS_DEPLOY_PATH"
  gray "   分支：$GIT_BRANCH"
  gray "   仓库：$GIT_REPO"
  echo

  # 检测远端连接
  if ! $SSH "echo connected" >/dev/null 2>&1; then
    red "❌ SSH 连接失败：$NAS_USER@$NAS_HOST:$NAS_PORT"
    echo "   请检查："
    echo "   1. NAS 是否开机？docker 是否在跑？"
    echo "   2. ssh key 是否已配置？（推荐：ssh-copy-id $NAS_USER@$NAS_HOST）"
    echo "   3. scripts/deploy.env 里的 NAS_HOST / NAS_PORT / NAS_USER 是否正确？"
    exit 1
  fi

  # 检测 NAS 上 docker / git
  if ! $SSH "command -v docker >/dev/null && command -v git >/dev/null"; then
    red "❌ NAS 上缺 docker 或 git"
    echo "   群晖：套件中心安装 Container Manager；Git Server 套件"
    echo "   Linux：sudo apt install docker.io docker-compose-plugin git"
    exit 1
  fi

  # 检测远端仓库存不存在
  blue "📦 检测远端目录..."
  if $SSH "[ -d $NAS_DEPLOY_PATH/.git ]"; then
    green "   ✓ 已是 git 仓库，将 fetch + reset"
    $SSH "cd $NAS_DEPLOY_PATH && git fetch origin && git reset --hard origin/$GIT_BRANCH"
  elif $SSH "[ -d $NAS_DEPLOY_PATH ]"; then
    red "⚠️  目录 $NAS_DEPLOY_PATH 存在但不是 git 仓库"
    echo "    手动处理："
    echo "    ssh $NAS_USER@$NAS_HOST 'mv $NAS_DEPLOY_PATH ${NAS_DEPLOY_PATH}.backup && mkdir $NAS_DEPLOY_PATH'"
    echo "    然后重跑此脚本"
    exit 1
  else
    green "   ✓ 首次部署，将 git clone"
    # 父目录可能不存在
    $SSH "mkdir -p $(dirname "$NAS_DEPLOY_PATH")"
    $SSH "git clone -b $GIT_BRANCH $GIT_REPO $NAS_DEPLOY_PATH"
  fi

  # docker compose
  blue "🐳 docker compose up -d --build （首次约 3-5 分钟）..."
  echo
  $SSH "cd $NAS_DEPLOY_PATH && docker compose up -d --build"

  # 等容器健康
  echo
  blue "⏳ 等待容器健康检查（最长 30 秒）..."
  for i in $(seq 1 15); do
    sleep 2
    if $SSH "cd $NAS_DEPLOY_PATH && docker compose ps --format json 2>/dev/null | grep -q '\"State\":\"running\"'"; then
      green "   ✓ 容器已运行（$((i*2)) 秒）"
      break
    fi
    printf "."
  done
  echo

  # 收尾打印
  echo
  green "✅ 部署完成！"
  echo
  echo "   web 客户端：http://$NAS_HOST:8080/"
  echo "   API 端点：  http://$NAS_HOST:3001/"
  echo
  blue "🔑 API Token（外部 AI 接入需要）"
  $SSH "docker exec plotmesh-server cat /data/api-token 2>/dev/null" | sed 's/^/   /'
  echo
  gray "💡 团队成员配 codex / kimi / Claude Desktop 时填上面这个 token"
  gray "💡 看运行日志：    bash scripts/deploy-to-nas.sh logs"
  gray "💡 状态检查：      bash scripts/deploy-to-nas.sh status"
}

# ─── 路由 ──────────────────────────────────────────────────────

case "$cmd" in
  deploy|"")  cmd_deploy ;;
  status)     cmd_status ;;
  logs)       cmd_logs ;;
  restart)    cmd_restart ;;
  down)       cmd_down ;;
  ssh)        cmd_ssh ;;
  *)
    red "❌ 未知命令：$cmd"
    echo "运行 bash scripts/deploy-to-nas.sh help 看帮助"
    exit 1
    ;;
esac
