#!/bin/zsh
set -u
PROJECT_DIR="/Users/shaunlin/WorkBuddy/20260425211359"
NODE_BIN="/Users/shaunlin/.workbuddy/binaries/node/versions/22.22.2/bin/node"
export NODE_OPTIONS=""
export NO_PROXY="localhost,127.0.0.1,::1"
export no_proxy="$NO_PROXY"

cd "$PROJECT_DIR/server" || exit 1

if /usr/bin/curl --noproxy '*' -fsS --max-time 2 "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
  /usr/bin/open "http://127.0.0.1:3001/"
  exit 0
fi

/usr/bin/open "http://127.0.0.1:3001/"
exec "$NODE_BIN" src/index.js
