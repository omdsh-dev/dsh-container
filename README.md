# dsh-server

`dsh-server` 使用 Docker Compose 运行 npm 发布版的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。镜像构建时安装指定版本的 `@deepseek-ai/dsh`，运行时不依赖 npm 下载。

## 安全说明

DSH Web UI 可以驱动 Agent 在挂载的工作区中执行命令。本项目默认监听所有网络接口，不提供认证，并允许 trusted host 通过 Web UI 管理设置、凭据和模型探测，因此只适合在完全可信的网络中使用。

不要将服务端口直接映射到公网。需要远程访问时，应在反向代理或访问网关中配置 HTTPS、认证和访问控制。将 `DSH_ALLOW_REMOTE_SETTINGS` 设为 `0` 可以恢复上游仅允许 loopback 调用敏感设置 API 的限制。

容器采用以下边界限制影响范围：

- 使用 UID 1000 的非 root 用户运行；
- 根文件系统只读，仅挂载的工作区、DSH 配置目录及 `/tmp` 可写；
- 删除全部 Linux capabilities，并启用 `no-new-privileges`；
- 不挂载 Docker socket 或宿主机其他目录。

部分较旧的 Linux 内核无法使用 DSH 所需的 Landlock 或非特权 Bubblewrap，因此容器将 `DSH_PERMISSION_MODE` 设置为 `danger-full-access`。该设置只影响容器内部，仍需依靠上述容器边界和可信网络限制风险。

## 快速开始

需要 Docker Engine 和 Docker Compose v2。先创建本地配置：

```sh
cp .env.example .env
```

编辑 `.env`，至少将 `DSH_TRUSTED_HOSTS` 改为浏览器实际使用的主机名、IP 或 `host:port`。然后构建并启动：

```sh
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
docker compose up -d --build
docker compose ps
```

默认端口为 `3080`。服务通过健康检查后，可访问 `http://<主机地址>:3080`。

仓库不包含针对特定设备或环境的自动部署脚本。

## 配置

Compose 从项目根目录的 `.env` 读取配置，该文件已被 Git 和 Docker 构建上下文忽略。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_VERSION` | `latest` | 构建时安装的 npm 包版本；生产环境建议固定版本 |
| `DSH_BIND_ADDRESS` | `0.0.0.0` | 宿主机端口绑定地址 |
| `DSH_PORT` | `3080` | 宿主机对外端口 |
| `DSH_TRUSTED_HOSTS` | 必填 | 逗号分隔的主机名、IP 或 `host:port` |
| `DSH_ALLOW_REMOTE_SETTINGS` | `1` | 是否允许 trusted host 管理设置、凭据和模型探测 |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `DEEPSEEK_API_KEY` | 未设置 | 可选 DeepSeek API 密钥，也可在 Web UI 中配置 |
| `DEEPSEEK_BASE_URL` | 官方 API | 可选兼容端点 |

Node.js 24 会通过 `NODE_USE_ENV_PROXY` 自动使用 `.env` 中的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。

## 数据目录

Compose 使用项目目录内的相对路径：

| 宿主机路径 | 容器路径 | 内容 |
|---|---|---|
| `./.dsh` | `/home/node/.dsh` | 设置、凭据、profiles、sessions 和 storages |
| `./workspace` | `/home/node` | Agent 可读写的用户主目录和工作区根目录 |

容器以 UID 1000 运行，因此两个目录必须允许 UID 1000 写入。请备份 `.dsh` 和工作区；`docker compose down` 不会删除这些绑定挂载中的数据。

## 更新与回滚

重新构建当前配置：

```sh
docker compose up -d --build
```

当 `DSH_VERSION=latest` 时，显式获取当前 npm 版本需要跳过构建缓存：

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```

需要回滚时，在 `.env` 中将 `DSH_VERSION` 改为已知版本，再执行无缓存构建。

常用运维命令：

```sh
docker compose logs -f --tail 200 dsh
docker compose restart dsh
docker compose down
```

## 许可证

[MIT](LICENSE)
