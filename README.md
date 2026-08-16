# dsh-container

[![发布 GHCR 镜像](https://github.com/Juexe/dsh-container/actions/workflows/publish-ghcr.yaml/badge.svg)](https://github.com/Juexe/dsh-container/actions/workflows/publish-ghcr.yaml)

`dsh-container` 使用 Docker 运行 npm 发布版的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。公开镜像支持 `linux/amd64` 和 `linux/arm64`，运行时不需要下载 npm 依赖。

> [!WARNING]
> **请勿将本服务部署到公网环境。** 本项目不提供身份认证；能够访问服务的客户端可以调用全部 API、修改设置与凭据，并驱动 Agent 在容器内执行命令。因公网暴露、错误配置或缺少访问控制造成的一切后果由部署者自行承担。

## 快速开始

安装 Docker 后直接运行：

```sh
docker run -d -p 3080:3080 -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/juexe/dsh-container:latest
```

容器通过健康检查后访问 <http://localhost:3080>。通过主机名或局域网 IP 访问时，将 `DSH_CONTAINER_TRUSTED_HOSTS` 改为浏览器实际使用的主机名、IP 或 `host:port`，多个值使用逗号分隔。

这条最简命令适合快速体验，不包含持久化、自动重启和额外的容器安全限制。删除容器会同时丢失其中的设置和工作区数据，WebUI 中的容器重启能力也保持禁用。

## 长期运行

推荐使用命名卷保存数据，并添加运行限制：

```sh
docker run -d \
  --name dsh-container \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --stop-timeout 20 \
  -p 3080:3080 \
  -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" \
  -e "DSH_CONTAINER_ALLOW_RESTART=1" \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  -v dsh-workspace:/home/node \
  -v dsh-config:/home/node/.dsh \
  ghcr.io/juexe/dsh-container:latest
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

`.env` 中的 `DSH_CONTAINER_TRUSTED_HOSTS` 必须按实际访问地址修改。仓库不包含针对特定设备或环境的自动部署脚本。

## DSH 容器设置

WebUI 设置导航末尾的「DSH 容器」页面提供当前实例的只读有效配置总览，包括 DSH 版本、trusted hosts、容器内 relay 与 DSH 端口、时区、运行 UID/GID、权限模式、遥测状态和 WebUI 重启能力。页面不会读取或展示宿主绑定地址、发布端口、镜像引用、代理地址、API Key、凭据或其他环境变量，也不支持修改配置、更新镜像或重建容器。

WebUI 重启默认禁用。只有部署者同时配置 Docker restart policy，并将 `DSH_CONTAINER_ALLOW_RESTART` 精确设置为 `1` 时才能启用；上面的长期运行命令和仓库 Compose 配置已经同时设置两者。页面无法读取 Docker 的 restart policy，能力开关只是部署者对策略已经就绪的明确声明。

重启会中断正在运行的 Agent、终端和网络连接，确认框要求先勾选中断确认。接受请求后，DSH 会通知容器入口脚本优雅停止 DSH 与 relay，并以状态码 `75` 退出；Docker 随后拉起同一容器。浏览器最多等待 90 秒，以新进程的实例 ID 确认恢复后刷新页面。若只设置 `DSH_CONTAINER_ALLOW_RESTART=1` 而没有 restart policy，容器会退出且不会自动恢复。

## 安全说明

DSH Web UI 可以驱动 Agent 在工作区中执行命令。本项目默认不提供认证；通过 DSH trusted-host 和同源校验的客户端可以调用全部 API，包括设置、凭据、Agent Preset、模型探测和宿主操作，因此只适合在完全可信的网络中使用。

trusted-host 是 Host 与同源信任边界，不是身份认证。**请勿在公网环境部署本服务；因公网暴露或访问控制配置不当造成的一切后果由部署者自行承担。** 仅需本机访问时，可将端口参数改为 `-p 127.0.0.1:3080:3080`；需要跨设备访问时，应仅在可信内网中使用，并在反向代理或访问网关中配置 HTTPS、认证和访问控制。

镜像始终使用非 root 用户运行。长期运行命令和 Compose 还会使用只读根文件系统、删除 Linux capabilities、启用 `no-new-privileges`，且不会挂载 Docker socket。

部分较旧的 Linux 内核无法使用 DSH 所需的 Landlock 或非特权 Bubblewrap，因此镜像将 `DSH_PERMISSION_MODE` 设置为 `danger-full-access`。该设置只影响容器内部，仍需依靠容器边界和可信网络限制风险。

当前 npm 版 DSH 在普通 HTTP 地址中依赖仅限安全上下文的 `crypto.randomUUID`。镜像包含基于 `crypto.getRandomValues` 的兼容实现；HTTPS 或 localhost 下仍使用浏览器原生实现。

## 配置

### dsh-container 配置

以下变量由容器封装定义，不属于 DSH 上游：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_CONTAINER_IMAGE` | `dsh-container` | Compose 构建或运行使用的镜像仓库名；使用 GHCR 时设为 `ghcr.io/juexe/dsh-container` |
| `DSH_CONTAINER_TRUSTED_HOSTS` | 必填 | 传给 DSH `--trusted-host` 的主机名、IP 或 `host:port`，多个值用逗号分隔 |
| `DSH_CONTAINER_BIND_ADDRESS` | `0.0.0.0` | Compose 发布端口的监听地址 |
| `DSH_CONTAINER_PORT` | `3080` | Compose 发布到宿主机的端口 |
| `DSH_CONTAINER_RELAY_PORT` | `3080` | 容器内对外 relay 端口 |
| `DSH_CONTAINER_INTERNAL_PORT` | `3081` | 容器内 DSH Web 服务端口 |
| `DSH_CONTAINER_ALLOW_RESTART` | 未设置 | 仅精确值 `1` 启用 WebUI 重启接口；必须同时配置 Docker restart policy |
| `DSH_CONTAINER_DSH_VERSION` | `latest` | 源码构建时安装的 DSH npm 版本或 dist-tag |

### DSH 原生配置

这些变量由 DSH 上游读取，dsh-container 只提供适合容器的默认值：

| 变量 | 镜像默认值 | 说明 |
|---|---|---|
| `DSH_HOME` | `/home/node/.dsh` | DSH 配置和运行状态目录 |
| `DSH_PERMISSION_MODE` | `danger-full-access` | 容器内 Agent 权限模式 |
| `DSH_TELEMETRY_DISABLED` | `1` | 禁用遥测 |

### 通用及提供方配置

| 变量 | 镜像默认值 | 说明 |
|---|---|---|
| `TZ` | 系统默认 | 容器时区 |
| `DEEPSEEK_API_KEY` | 未设置 | 可选 DeepSeek API 密钥，也可在 Web UI 中配置 |
| `DEEPSEEK_BASE_URL` | 官方 API | 可选兼容端点 |

Node.js 24 会通过 `NODE_USE_ENV_PROXY` 自动使用 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。

GHCR 镜像可直接使用 DSH 版本标签：

```sh
docker pull ghcr.io/juexe/dsh-container:0.1.0-rc.6
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
docker pull ghcr.io/juexe/dsh-container:latest
docker rm -f dsh-container
# 再次执行“长期运行”中的 docker run 命令
```

源码构建需要显式跳过缓存才能重新解析 npm 的 `latest`：

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```

常用运维命令：

```sh
docker logs -f --tail 200 dsh-container
docker restart dsh-container
docker stop dsh-container
```

## 许可证

[MIT](LICENSE)
