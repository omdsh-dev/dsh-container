[English](guide.en.md) | 简体中文

# dsh-container 使用指南

本指南介绍 dsh-container 的持久化部署、局域网访问、配置、WebUI 管理、安全边界和更新方法。项目概览与最短启动命令见[项目首页](../README.md)。

> [!WARNING]
> **请勿将本服务直接暴露到公网。** 可选共享密钥适用于可信局域网，或已有外部 HTTPS 和访问策略的单管理员场景；它不提供多账号、角色、数据隔离或公共互联网加固。通过认证的客户端可以修改设置与凭据，并驱动 Agent 在容器内执行命令。

## Docker 运行

### 临时体验

```sh
docker run -d --name dsh-container --restart unless-stopped -p 127.0.0.1:3080:3080 -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/omdsh-dev/dsh-container:latest
```

健康检查通过后访问 <http://localhost:3080>。设置与工作区保存在容器内部，删除容器后会丢失。

### 持久化运行

使用命名卷分别保存工作区和 DSH 配置：

```sh
docker run -d \
  --name dsh-container \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --stop-timeout 20 \
  -p 127.0.0.1:3080:3080 \
  -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  -v dsh-workspace:/home/node \
  -v dsh-config:/home/node/.dsh \
  ghcr.io/omdsh-dev/dsh-container:latest
```

Docker 会以正确的属主初始化命名卷。

如需让 Agent 直接操作宿主机目录，可将命名卷替换为绑定挂载：

```sh
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace

-v "$(pwd)/workspace:/home/node" \
-v "$(pwd)/.dsh:/home/node/.dsh" \
```

镜像以 UID 1000 运行，绑定目录必须允许该用户写入。

## Docker Compose

仓库中的 Compose 文件会在本地构建镜像，不使用 GHCR：

```sh
cp .env.example .env
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
# 浏览器使用其他主机名或 IP 时，先编辑 .env。
docker compose up -d --build
docker compose ps
```

Compose 默认启用持久化绑定挂载、只读根文件系统、`no-new-privileges`、删除全部 Linux capabilities，并使用 `unless-stopped` 重启策略。

## 局域网访问

所有示例默认只绑定 `127.0.0.1`。如需从局域网中的其他设备访问，必须同时开放监听地址并配置信任的 Host：

- Docker Run：将端口映射改为 `-p 3080:3080`，并将 `DSH_CONTAINER_TRUSTED_HOSTS` 设置为浏览器实际使用的所有主机名或 IP。
- Docker Compose：在 `.env` 中将 `DSH_CONTAINER_BIND_ADDRESS` 设为 `0.0.0.0`，并更新 `DSH_CONTAINER_TRUSTED_HOSTS`。

示例：

```dotenv
DSH_CONTAINER_BIND_ADDRESS=0.0.0.0
DSH_CONTAINER_TRUSTED_HOSTS=192.168.1.100,dsh.local
```

多个 trusted hosts 使用逗号分隔，可以填写主机名、IP 或 `host:port`。不带端口的值匹配该主机的任意端口。trusted-host 只是可达性和同源边界，不是身份认证。

## 管理员密钥认证

在 Docker Run 中增加 `-e "DSH_CONTAINER_KEY=你的私有密钥"`，或在 Compose 使用的 `.env` 中设置：

```dotenv
DSH_CONTAINER_KEY=replace-with-a-private-key
```

未定义该变量时保持原有无认证行为。变量已定义但值为空、纯空白、包含控制字符或超过 4096 个 UTF-8 字节时，容器会按配置错误退出；其他值按原始字符串比较，不自动去除空格，也不设置最低强度。启用后，除登录和退出接口外的页面、静态资源、API 与 WebSocket 都需要认证。不可信 Host、跨站 Fetch Metadata 或不匹配的 Origin 会先返回 `403`，有效 Cookie 不会绕过这些检查。

登录页根据 `Accept-Language` 选择简体中文或英文，也可手动切换。成功登录会写入名为 `dsh_container_session` 的长期 `HttpOnly`、`Path=/`、`SameSite=Lax` Cookie；令牌由随机 nonce 和 HMAC-SHA256 组成，服务端不设置时间失效。浏览器仍可缩短保留时间或淘汰 Cookie。容器重启不会使 Cookie 失效，轮换 `DSH_CONTAINER_KEY` 会使旧 Cookie 立即失效。

![管理员密钥登录页](login.zh-CN.png)

每个实际 TCP 对端可连续失败 5 次，之后每 60 秒恢复一次尝试；成功登录会重置该对端记录。设置页的「退出本设备」只清除当前浏览器 Cookie，不维护服务端撤销列表。已经复制的 Cookie 在轮换密钥前仍可重放。程序客户端必须通过 `GET|POST /_dsh-container/auth/login` 获取 Cookie 并随请求发送；不支持 Bearer 认证。`POST /_dsh-container/auth/logout` 清除当前 Cookie。未认证响应为 `401`，并携带 `X-DSH-Container-Auth: required`。

`DSH_CONTAINER_KEY` 按已确认的运行模型保留在 DSH 进程环境中，因此容器内 Agent 可以读取并外传该密钥。不要在不可信任务、工作区或插件可访问该环境时把它视为不可提取的秘密。它是单管理员入口控制，不是 Agent 隔离边界。

### HTTPS 反向代理

直接 HTTP 登录不会设置 `Secure`；当 relay 收到 `Forwarded: proto=https` 或 `X-Forwarded-Proto: https` 时，登录 Cookie 会增加 `Secure`。HTTPS 代理必须覆盖客户端提供的协议头，并原样保留 Host 和 Origin。以下 Nginx 示例同时支持流式请求和 WebSocket：

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 443 ssl;
  server_name dsh.example.com;

  location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_request_buffering off;
    proxy_buffering off;
  }
}
```

`DSH_CONTAINER_TRUSTED_HOSTS` 必须包含浏览器实际使用的 `dsh.example.com`。如果代理未覆盖协议头，直接客户端可以伪造该头让浏览器收到不适用于 HTTP 的 `Secure` Cookie；如果代理未传递正确 Host/Origin，请求会按设计返回 `403`。

## 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DSH_CONTAINER_TRUSTED_HOSTS` | 必填 | DSH 接受的主机名、IP 或 `host:port`。 |
| `DSH_CONTAINER_KEY` | 未设置 | 可选单管理员共享密钥；设置后启用全入口 Cookie 认证。 |
| `DSH_CONTAINER_BIND_ADDRESS` | `127.0.0.1` | Compose 发布端口的宿主机监听地址。 |
| `DSH_CONTAINER_PORT` | `3080` | Compose 发布到宿主机的端口。 |
| `DSH_CONTAINER_RELAY_PORT` | `3080` | 容器内中继服务端口，通常无需修改。 |
| `DSH_CONTAINER_INTERNAL_PORT` | `3081` | 容器内 DSH 服务端口，通常无需修改。 |
| `DSH_CONTAINER_IMAGE` | `dsh-container` | Compose 构建和运行使用的镜像名。 |
| `DSH_CONTAINER_DSH_VERSION` | `latest` | 构建时安装的 DSH npm 版本或 dist-tag。 |
| `TZ` | Compose：`Asia/Shanghai` | 容器时区；直接使用 Docker Run 时沿用镜像默认值。 |
| `DEEPSEEK_API_KEY` | 未设置 | 可选 API 密钥，也可以在 WebUI 中保存。 |
| `DEEPSEEK_BASE_URL` | 官方 API | 可选的 OpenAI 兼容端点。 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 未设置 | 可选网络代理配置。 |

Compose 的完整示例值和注释见 [`.env.example`](../.env.example)。`latest` 只会在构建缓存失效或显式跳过缓存时重新解析 npm 最新版本。

## WebUI 容器管理

WebUI 设置中提供只读的「DSH 容器」页面，显示 DSH 版本、端口、trusted hosts、运行用户、权限模式、遥测和认证状态。启用认证时还提供「退出本设备」。

![DSH 容器设置页](settings.png)

「重启容器」会请求当前进程平滑退出，但仍会中断正在运行的 Agent、终端和网络连接。要让容器自动恢复，Docker restart policy 必须为 `on-failure[:max-retries]`、`always` 或 `unless-stopped`；配置为 `no` 或未设置时，容器会保持停止。

## 安全说明

- 镜像以非 root 用户运行，UID 和 GID 均为 1000。
- 推荐部署使用只读根文件系统、删除全部 Linux capabilities、启用 `no-new-privileges`，且不挂载 Docker socket。
- 较旧内核可能不支持 DSH 所需的 Landlock 或非特权 Bubblewrap，因此镜像在容器内使用 `DSH_PERMISSION_MODE=danger-full-access`。
- 共享管理员密钥不提供用户身份、角色授权或 Agent 隔离，并且对容器内 Agent 可见。
- 容器加固和共享密钥都不能替代 HTTPS 与网络访问控制。不要直接暴露到公共互联网；远程访问应放在外部 HTTPS 和访问策略之后。

## 镜像与更新

GHCR 为 `linux/amd64` 和 `linux/arm64` 发布 `latest`、DSH 精确版本和 `sha-<commit>` 标签。

更新使用命名卷或绑定挂载的容器：

```sh
docker pull ghcr.io/omdsh-dev/dsh-container:latest
docker rm -f dsh-container
# 使用原来的持久化参数重新运行容器。
```

数据保存在外部卷或宿主机目录中，不会随旧容器删除。源码构建需要跳过缓存，才能重新解析 npm `latest`：

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```
