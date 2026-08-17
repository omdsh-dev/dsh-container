[English](README.md) | 简体中文

# dsh-container

[![发布 GHCR 镜像](https://github.com/omdsh-dev/dsh-container/actions/workflows/publish-ghcr.yaml/badge.svg)](https://github.com/omdsh-dev/dsh-container/actions/workflows/publish-ghcr.yaml)

使用 Docker 运行 npm 发布版的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。公开镜像支持 `linux/amd64` 和 `linux/arm64`，并包含运行时所需的 npm 依赖。

> [!WARNING]
> **请勿将本服务部署到公网环境。** dsh-container 不提供身份认证；通过 trusted-host 校验的客户端可以调用 API、修改设置与凭据，并驱动 Agent 在容器内执行命令。服务只适合在完全可信的网络中使用；必须远程访问时，请配置 HTTPS、身份认证和访问控制。

## 快速开始

安装 Docker 后运行：

```sh
docker run -d --name dsh-container --restart unless-stopped -p 127.0.0.1:3080:3080 -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/omdsh-dev/dsh-container:latest
```

健康检查通过后访问 <http://localhost:3080>。这条命令适合临时体验：设置和工作区数据保存在容器内部，删除容器后会丢失。

如需局域网访问，将端口映射改为 `-p 3080:3080`，并将 `DSH_CONTAINER_TRUSTED_HOSTS` 设置为浏览器实际使用的所有主机名或 IP（也可使用 `host:port`）。多个值用逗号分隔。

## 长期运行

使用命名卷保存设置和工作区数据：

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

Docker 会以正确的属主初始化命名卷。如需让 Agent 直接操作宿主机目录，将上面两行命名卷替换为绑定挂载：

```sh
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace

-v "$(pwd)/workspace:/home/node" \
-v "$(pwd)/.dsh:/home/node/.dsh" \
```

镜像以 UID 1000 运行，绑定目录必须允许该用户写入。

## 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DSH_CONTAINER_TRUSTED_HOSTS` | 必填 | DSH 接受的主机名、IP 或 `host:port` 权威。不带端口的值匹配该主机的任意端口。 |
| `TZ` | 系统默认 | 容器时区。 |
| `DEEPSEEK_API_KEY` | 未设置 | 可选 API 密钥，也可以在 Web UI 中保存。 |
| `DEEPSEEK_BASE_URL` | 官方 API | 可选兼容 OpenAI API 的端点。 |

Compose 专用的镜像、端口、DSH 版本和代理配置见 [`.env.example`](.env.example)。

## DSH 容器集成

WebUI 设置中提供只读的「DSH 容器」页面，显示 DSH 版本、端口、trusted hosts、运行用户、权限模式和遥测状态。重启操作会中断正在运行的 Agent、终端和网络连接。要自动恢复，Docker restart policy 必须为 `on-failure[:max-retries]`、`always` 或 `unless-stopped`；配置为 `no` 或未设置时容器会保持停止。

## 源码构建

Compose 文件只在本地构建，不使用 GHCR：

```sh
cp .env.example .env
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
# 浏览器使用其他主机名或 IP 时，编辑 .env。
docker compose up -d --build
docker compose ps
```

## 安全说明

trusted-host 是可达性和同源边界，不是身份认证。镜像始终以非 root 用户运行；长期运行命令和 Compose 使用只读根文件系统、删除 Linux capabilities、启用 `no-new-privileges`，且不挂载 Docker socket。较旧内核可能不支持 DSH 所需的 Landlock 或非特权 Bubblewrap，因此镜像在容器内使用 `DSH_PERMISSION_MODE=danger-full-access`。该设置不能替代网络访问控制或身份认证。

## 更新

GHCR 会发布 `latest`、DSH 精确版本和 `sha-<commit>` 标签。更新长期运行的容器：

```sh
docker pull ghcr.io/omdsh-dev/dsh-container:latest
docker rm -f dsh-container
# 再次执行上面的长期运行命令。
```

源码构建需要显式跳过缓存，重新解析 npm `latest`：

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```

## 许可证

[MIT](LICENSE)
