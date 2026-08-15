# dsh-server

[![发布 GHCR 镜像](https://github.com/Juexe/dsh-server/actions/workflows/publish-ghcr.yaml/badge.svg)](https://github.com/Juexe/dsh-server/actions/workflows/publish-ghcr.yaml)

`dsh-server` 使用 Docker 运行 npm 发布版的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。公开镜像支持 `linux/amd64` 和 `linux/arm64`，运行时不需要下载 npm 依赖。

## 快速开始

安装 Docker 后直接运行：

```sh
docker run -d -p 3080:3080 -e "DSH_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/juexe/dsh-server:latest
```

容器通过健康检查后访问 <http://localhost:3080>。通过主机名或局域网 IP 访问时，将 `DSH_TRUSTED_HOSTS` 改为浏览器实际使用的主机名、IP 或 `host:port`，多个值使用逗号分隔。

这条最简命令适合快速体验，不包含持久化、自动重启和额外的容器安全限制。删除容器会同时丢失其中的设置和工作区数据。

## 长期运行

推荐使用命名卷保存数据，并添加运行限制：

```sh
docker run -d \
  --name dsh-server \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --stop-timeout 20 \
  -p 3080:3080 \
  -e "DSH_TRUSTED_HOSTS=localhost,127.0.0.1" \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  -v dsh-workspace:/home/node \
  -v dsh-config:/home/node/.dsh \
  ghcr.io/juexe/dsh-server:latest
```

如需直接访问宿主机文件，可将两个命名卷参数替换为绑定挂载：

```sh
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace

-v "$(pwd)/workspace:/home/node" \
-v "$(pwd)/.dsh:/home/node/.dsh"
```

容器以 UID 1000 运行，绑定目录必须允许该用户写入。命名卷由 Docker 自动初始化，不需要手动调整权限。

## 源码构建

仓库中的 `docker-compose.yaml` 用于本地构建，不依赖 GHCR。复制示例配置并准备绑定目录：

```sh
cp .env.example .env
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
docker compose up -d --build
docker compose ps
```

`.env` 中的 `DSH_TRUSTED_HOSTS` 必须按实际访问地址修改。仓库不包含针对特定设备或环境的自动部署脚本。

## 安全说明

DSH Web UI 可以驱动 Agent 在工作区中执行命令。本项目默认不提供认证，并允许 trusted host 管理设置、凭据和模型探测，因此只适合在完全可信的网络中使用。

不要将服务端口直接暴露到公网。仅需本机访问时，可将端口参数改为 `-p 127.0.0.1:3080:3080`；需要远程访问时，应在反向代理或访问网关中配置 HTTPS、认证和访问控制。将 `DSH_ALLOW_REMOTE_SETTINGS` 设为 `0` 可以恢复上游仅允许 loopback 调用敏感设置 API 的限制。

镜像始终使用非 root 用户运行。长期运行命令和 Compose 还会使用只读根文件系统、删除 Linux capabilities、启用 `no-new-privileges`，且不会挂载 Docker socket。

部分较旧的 Linux 内核无法使用 DSH 所需的 Landlock 或非特权 Bubblewrap，因此镜像将 `DSH_PERMISSION_MODE` 设置为 `danger-full-access`。该设置只影响容器内部，仍需依靠容器边界和可信网络限制风险。

当前 npm 版 DSH 在普通 HTTP 地址中依赖仅限安全上下文的 `crypto.randomUUID`。镜像包含基于 `crypto.getRandomValues` 的兼容实现；HTTPS 或 localhost 下仍使用浏览器原生实现。

## 配置

| 变量 | 镜像默认值 | 说明 |
|---|---|---|
| `DSH_TRUSTED_HOSTS` | 必填 | 逗号分隔的主机名、IP 或 `host:port` |
| `DSH_ALLOW_REMOTE_SETTINGS` | `1` | 是否允许 trusted host 管理设置、凭据和模型探测 |
| `DSH_PERMISSION_MODE` | `danger-full-access` | 容器内 Agent 权限模式 |
| `DSH_TELEMETRY_DISABLED` | `1` | 禁用遥测 |
| `TZ` | 系统默认 | 容器时区 |
| `DEEPSEEK_API_KEY` | 未设置 | 可选 DeepSeek API 密钥，也可在 Web UI 中配置 |
| `DEEPSEEK_BASE_URL` | 官方 API | 可选兼容端点 |

Node.js 24 会通过 `NODE_USE_ENV_PROXY` 自动使用 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。

源码构建还支持 `DSH_VERSION`，用于指定构建时安装的 npm 包版本。GHCR 镜像可直接使用相同版本标签：

```sh
docker pull ghcr.io/juexe/dsh-server:0.1.0-rc.6
```

## 数据目录

| 容器路径 | 内容 |
|---|---|
| `/home/node/.dsh` | 设置、凭据、profiles、sessions 和 storages |
| `/home/node` | Agent 可读写的用户主目录和工作区根目录 |

`docker rm` 不会删除命名卷；删除绑定挂载对应的宿主机目录或显式执行 `docker volume rm` 才会移除持久化数据。

## 更新与运维

GHCR 的 `latest` 跟随 main 分支，每次发布还会生成 DSH 精确版本标签和 `sha-<commit>` 标签。更新长期运行的容器：

```sh
docker pull ghcr.io/juexe/dsh-server:latest
docker rm -f dsh-server
# 再次执行“长期运行”中的 docker run 命令
```

源码构建需要显式跳过缓存才能重新解析 npm 的 `latest`：

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```

常用运维命令：

```sh
docker logs -f --tail 200 dsh-server
docker restart dsh-server
docker stop dsh-server
```

## 许可证

[MIT](LICENSE)
