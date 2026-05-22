# 部署到群晖 / Linux Docker

PlotMesh 从 v1.6.2 起提供 Docker 部署支持，方便给身边团队尝试用。
**v1.6.3 起前端 API base url 已参数化（相对路径），团队成员可直接通过 NAS URL 访问 web 客户端**。

## 现状（v1.6.3）

| 组件 | 状态 |
|---|---|
| `Dockerfile.server` | ✅ 可用 |
| `Dockerfile.client` | ✅ 可用（前端走相对路径，nginx `/api/*` `/health` `/uploads/*` 反代到 server） |
| `docker-compose.yml` | ✅ 可用 |

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
```

把这个 token 发给团队成员，他们配 codex / kimi / Claude Desktop 时填入。

### 4. 团队成员访问
- **web 客户端**：直接 `http://<NAS-IP>:8080/`（v1.6.3 起可用）
  - 第一次进入 → API 配置 → 外部 AI 接入 → 可看到 token + 远端访问开关已自动开
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

## 注意

### macOS 不要用此 docker-compose
你自己 Mac 上跑 server 还是用 `npm start` 或者 `bash scripts/install-autostart.sh`。Docker 是给 NAS / Linux 服务器用的。

### 多用户隔离限制
v1.6.3 仍然是**单 store.json 多用户共享**的形态——所有团队成员看到同一份画布数据。如果需要"每人独立画布空间"，目前的临时方案是给每个用户跑一个独立 container（用不同端口和 ./data 目录）。等 v1.8 多租户路径上线后会原生支持。

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
