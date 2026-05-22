# 部署到群晖 / Linux Docker

PlotMesh 从 v1.6.2 起提供 Docker 部署支持，方便给身边团队尝试用。

## 现状（v1.6.2）

| 组件 | 状态 |
|---|---|
| `Dockerfile.server` | ✅ 可用 |
| `Dockerfile.client` | ⚠️ 镜像可构建，但前端**硬编码** `http://localhost:3001`，不能直接给 LAN 用户用（详见下方"已知限制"） |
| `docker-compose.yml` | ✅ 起容器没问题，仅生产可用度受 client 限制 |

**短期建议**：v1.6.2 阶段先用 docker 跑 server，team 成员仍用 client 的 dev 模式（npm run dev），通过指向你 NAS 的 server URL 访问。等 v1.6.3 把前端 API base url 参数化，就可以直接 client+server 双容器给团队。

---

## 群晖 Container Manager 部署（推荐）

### 1. 把项目上传到 NAS

把整个项目目录上传到 NAS，例如：
```
/volume1/docker/plotmesh/
├── client/
├── server/
├── Dockerfile.client
├── Dockerfile.server
└── docker-compose.yml
```

### 2. SSH 进 NAS 执行
```bash
ssh admin@<NAS-IP>
cd /volume1/docker/plotmesh
docker compose up -d
```

第一次会编译镜像（约 3-5 分钟）。之后：
```bash
docker compose ps           # 看运行状态
docker compose logs -f      # 看日志（Ctrl+C 退出）
docker compose down         # 停止
docker compose up -d --build  # 重启
```

### 3. 拿到 token
```bash
docker exec plotmesh-server cat /data/api-token
# 或者
curl http://<NAS-IP>:3001/api/canvas/auth/token
# 注意：远端访问开启时，curl 也要带 token；建议用 docker exec 拿
```

把这个 token 发给团队成员，他们配 codex / kimi / Claude Desktop 时填入。

### 4. 团队成员访问
- **web 客户端**：等 v1.6.3 修好硬编码 url 后即可 `http://<NAS-IP>:8080/`
- **MCP 客户端（codex / kimi）**：填 server 地址 `http://<NAS-IP>:3001` + token

---

## 数据持久化

Docker 卷把数据挂到 NAS 文件系统：

| 容器内 | 宿主机（NAS） | 内容 |
|---|---|---|
| `/data` | `./data/` | `store.json`（画布数据）、`api-token`、`server-config.json` |
| `/app/uploads` | `./uploads/` | fileUpload 节点上传的文件 |

**备份**：把 `./data/` 整个 zip 即可。**还原**：覆盖 `./data/` 后重启 server 容器。

---

## 大模型 API Key

在 `docker-compose.yml` 的 `environment:` 部分填入：

```yaml
HUNYUAN_API_KEY: "sk-xxx"
DEEPSEEK_API_KEY: "sk-xxx"
# ... etc
```

或者更安全的做法：写一个 `.env` 文件（注意加 .gitignore），让 compose 自动读：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx
GLM_API_KEY=xxxxxxxxxxxx
```

---

## 已知限制

### 前端 url 硬编码
`client/src/components/ApiTokenPanel.tsx`、`ServerStatusIndicator.tsx`、`store/runWorker.ts` 等多处直接写了 `http://localhost:3001`。在容器化部署里：

- 团队用户访问 `http://<NAS-IP>:8080/` 时，这些代码仍在请求 `localhost:3001` → 401 / 失败
- 需要 v1.6.3 把所有前端 fetch 改成相对路径 `/api/...`，让 nginx 反代生效

**临时方案**：v1.6.2 阶段，team 成员各自 clone 代码本地 `npm run dev`，但把 `localhost:3001` 改成 `<NAS-IP>:3001`。把 NAS server 当作"共享后端"，所有人前端在自己 Mac 上跑。

### macOS 不要用此 docker-compose
你自己 Mac 上跑 server 还是用 `npm start` 或者 `bash scripts/install-autostart.sh`。Docker 是给 NAS / Linux 服务器用的。

---

## 排错

```bash
# 容器没起来 / 起来又退出
docker compose logs server
docker compose logs client

# 容器在跑但 :3001 不通
docker compose exec server wget -qO- http://localhost:3001/health

# 改了 docker-compose.yml 后要重建
docker compose down
docker compose up -d --build

# 一切归零
docker compose down -v       # ⚠️ -v 会删数据卷！备份 ./data 再做
```
