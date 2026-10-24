# PlotMesh 部署到群晖 NAS（局域网）

## 已验证的目标环境

- NAS：Synology RS3618xs
- DSM：7.2.1-69057 Update 1
- CPU：Intel Xeon D-1521（x86_64 / amd64）
- 内存：32 GB
- 局域网地址：`10.118.118.10`
- 建议部署目录：`/volume1/docker/plotmesh`
- 应用入口：`http://10.118.118.10:18180`

该硬件足以运行 PlotMesh 的 Node 后端和 Nginx 前端；模型推理仍调用各云端模型 API，不会在 NAS 上执行本地大模型推理。

## 0. 前置条件

1. 在 DSM 套件中心安装并打开 **Container Manager**。
2. 在 DSM 控制面板启用 SSH（如使用命令行部署），登录账户需有管理员权限。
3. 默认使用 `18180`，避开常见的管理端口与应用端口。若仍有冲突，只需在 `.env` 中改 `PLOTMESH_HTTP_PORT`，例如 `18181`。
4. 仅限局域网使用时，不要在路由器做端口转发，也不要把 `3001` 映射到 NAS 主机。

## 0.1 使用 Docker CLI（无需另装 CLI）

`docker` 和 `docker compose` 命令由 **Container Manager** 提供，因此无需在 Mac 或 NAS 上单独安装 Docker CLI。只要 NAS 已安装 Container Manager，启用 SSH 后即可在 NAS 内执行命令。

1. DSM 打开「控制面板 → 终端机和 SNMP」，勾选「启用 SSH 服务」（默认端口 22），应用设置。
2. 在 Mac 的“终端”执行以下命令，将 `你的DSM用户名` 替换为有管理员权限的 DSM 用户名：

```sh
ssh 你的DSM用户名@10.118.118.10
sudo -i
docker version
docker compose version
```

首次连接时输入 `yes` 确认主机指纹，随后输入 DSM 用户密码；`sudo -i` 可能再次要求密码。看到 Docker 与 Compose 的版本信息即表示命令行可用。

若提示 `docker: command not found`，先在 DSM 套件中心确认 **Container Manager** 已安装且处于运行状态，再重新 SSH 登录。部署完成后可输入 `exit` 退出 root shell，再输入一次 `exit` 断开 SSH。

如果不愿开启 SSH，也可在 Container Manager 的「项目」页面导入 `docker-compose.yml`；但命令行更适合首次构建和查看完整日志。

## 1. 准备 NAS 目录

通过 SSH 登录 NAS 后执行：

```sh
sudo mkdir -p /volume1/docker/plotmesh/data
sudo mkdir -p /volume1/docker/plotmesh/uploads
sudo chown -R 1000:1000 /volume1/docker/plotmesh/data /volume1/docker/plotmesh/uploads
sudo chmod 750 /volume1/docker/plotmesh/data /volume1/docker/plotmesh/uploads
```

`data/` 保存账号、项目、画布、JWT 签名密钥、服务器设置与外部 AI token；`uploads/` 保存上传文件及图片 AI 产物。两者都必须随 NAS 备份任务备份。

## 2. 上传源码和生产环境文件

把 PlotMesh 源码上传到 `/volume1/docker/plotmesh`。上传时不要带本机的 `client/node_modules`、`client/dist`、`data`、`uploads`、`server/.env` 或 `.env`；仓库根目录的 `.dockerignore` 已避免它们进入镜像构建上下文。

在 NAS 的项目目录中创建生产环境文件：

```sh
cd /volume1/docker/plotmesh
cp .env.nas.example .env
```

编辑 `.env`，仅填写实际要启用的模型 API Key。没有使用的 Key 保持为空即可。默认端口为 18180。

## 3. 可选：迁移当前 Mac 的 PlotMesh 数据

如果要保留当前账号、画布、项目、运行历史和上传文件，应在 Mac 上停止写入后复制以下目录内容到 NAS 的同名目录：

- `~/.plotmesh/` → `/volume1/docker/plotmesh/data/`
- `<本机 PlotMesh 项目>/server/uploads/` → `/volume1/docker/plotmesh/uploads/`

复制完后，在 NAS 重新执行：

```sh
sudo chown -R 1000:1000 /volume1/docker/plotmesh/data /volume1/docker/plotmesh/uploads
```

不要让本机服务与 NAS 服务长期同时写入同一份业务数据；迁移完成后以 NAS 为唯一服务端。

## 4. 构建并启动

```sh
cd /volume1/docker/plotmesh
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 server
```

预期看到 `plotmesh-server` 与 `plotmesh-client` 均为运行状态，server 健康检查为 healthy。前端容器只暴露 `18180`，后端 `3001` 只留在 Docker 内部网络。

也可以在 Container Manager 的「项目」中导入这个目录内的 `docker-compose.yml`，但首次排查和升级推荐 SSH 命令行方式，日志更完整。

## 5. 首次初始化与验收

1. 打开 `http://10.118.118.10:18180`。
2. 首次部署会显示创建首位用户页面；该首位用户自动成为管理员。
3. 管理员进入系统后，在系统管理中创建成员账号或按需开启注册。
4. 在「外部 AI 接入」中，管理员可查看或重置 server API token。此 token 仅供 MCP、脚本或外部 AI 调用，不能放进普通成员浏览器或聊天记录。
5. 用第二台局域网设备登录，验证：登录、画布同步、上传文件、图片生成结果访问和通知实时推送。

可用以下命令检查入口：

```sh
curl -I http://127.0.0.1:18180/
curl http://127.0.0.1:18180/health
```

## 6. 日常运维

```sh
# 查看状态与日志
docker compose ps
docker compose logs -f --tail=200 server

# 更新源码后重建
# 先备份 data/ 与 uploads/，再执行：
docker compose up -d --build

# 停止服务（不会删除 data/ 与 uploads/）
docker compose down
```

建议在 Hyper Backup 或快照任务中备份整个 `/volume1/docker/plotmesh/data` 与 `/volume1/docker/plotmesh/uploads`，并至少保留一个部署前恢复点。

## 网络与安全约束

- 只通过 `http://10.118.118.10:18180` 对局域网提供服务；不要发布 `3001`。
- 当前配置强制账号登录，并在第一位管理员创建后默认关闭自助注册。
- 浏览器经同源 Nginx 代理访问 API，SSE 已关闭代理缓冲，通知和运行进度应实时到达。
- 如果未来需要 HTTPS 或局域网域名，使用 DSM「登录门户 / 反向代理」将一个内网域名转发至 `127.0.0.1:18180`，并签发可信证书后再启用。
