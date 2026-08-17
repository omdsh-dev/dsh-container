English | [简体中文](guide.md)

# dsh-container guide

This guide covers persistent deployment, LAN access, configuration, Web UI management, security boundaries, and updates. See the [project home](../README.en.md) for an overview and the shortest startup commands.

> [!WARNING]
> **Do not expose this service directly to the public internet.** dsh-container provides no authentication. A client that passes the trusted-host check can call the API, change settings and credentials, and run Agent commands in the container.

## Run with Docker

### Disposable trial

```sh
docker run -d --name dsh-container --restart unless-stopped -p 127.0.0.1:3080:3080 -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/omdsh-dev/dsh-container:latest
```

Open <http://localhost:3080> after the health check passes. Settings and workspace data live inside the container and are lost when it is removed.

### Persistent deployment

Use separate named volumes for the workspace and DSH configuration:

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

Docker initializes named volumes with the correct ownership.

To let the Agent work directly in host directories, replace the named volumes with bind mounts:

```sh
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace

-v "$(pwd)/workspace:/home/node" \
-v "$(pwd)/.dsh:/home/node/.dsh" \
```

The image runs as UID 1000, so bind-mounted directories must be writable by that user.

## Docker Compose

The repository's Compose file builds the image locally and does not use GHCR:

```sh
cp .env.example .env
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
# Edit .env first when the browser uses another hostname or IP.
docker compose up -d --build
docker compose ps
```

Compose enables persistent bind mounts, a read-only root filesystem, `no-new-privileges`, all-capability dropping, and the `unless-stopped` restart policy by default.

## LAN access

All examples bind to `127.0.0.1` by default. To connect from another device on the LAN, expose the listening address and configure every trusted Host at the same time:

- Docker Run: change the port mapping to `-p 3080:3080` and set `DSH_CONTAINER_TRUSTED_HOSTS` to every hostname or IP used in the browser.
- Docker Compose: set `DSH_CONTAINER_BIND_ADDRESS` to `0.0.0.0` in `.env` and update `DSH_CONTAINER_TRUSTED_HOSTS`.

Example:

```dotenv
DSH_CONTAINER_BIND_ADDRESS=0.0.0.0
DSH_CONTAINER_TRUSTED_HOSTS=192.168.1.100,dsh.local
```

Separate multiple trusted hosts with commas. Entries can be hostnames, IP addresses, or `host:port`; an entry without a port matches any port for that host. trusted-host is a reachability and same-origin boundary, not authentication.

## Configuration

| Variable | Default | Use |
|---|---|---|
| `DSH_CONTAINER_TRUSTED_HOSTS` | required | Hostnames, IP addresses, or `host:port` values accepted by DSH. |
| `DSH_CONTAINER_BIND_ADDRESS` | `127.0.0.1` | Host address used by the Compose port mapping. |
| `DSH_CONTAINER_PORT` | `3080` | Port published on the host by Compose. |
| `DSH_CONTAINER_RELAY_PORT` | `3080` | Internal relay port; normally unchanged. |
| `DSH_CONTAINER_INTERNAL_PORT` | `3081` | Internal DSH service port; normally unchanged. |
| `DSH_CONTAINER_IMAGE` | `dsh-container` | Image name built and run by Compose. |
| `DSH_CONTAINER_DSH_VERSION` | `latest` | DSH npm version or dist-tag installed at build time. |
| `TZ` | Compose: `Asia/Shanghai` | Container time zone; Docker Run uses the image default when unset. |
| `DEEPSEEK_API_KEY` | unset | Optional API key; it can also be saved in the Web UI. |
| `DEEPSEEK_BASE_URL` | official API | Optional OpenAI-compatible endpoint. |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | unset | Optional network proxy configuration. |

See [`.env.example`](../.env.example) for the complete Compose example and comments. The `latest` dist-tag is resolved again only when the build cache is invalidated or explicitly bypassed.

## Web UI container management

The Web UI adds a read-only **DSH Container** settings page showing the DSH version, ports, trusted hosts, runtime user, permission mode, and telemetry state.

**Restart container** requests a graceful exit, but it still interrupts running Agents, terminals, and network connections. Automatic recovery requires Docker restart policy `on-failure[:max-retries]`, `always`, or `unless-stopped`; `no` or an unset policy leaves the container stopped.

## Security

- The image runs as a non-root user with UID and GID 1000.
- The recommended deployment uses a read-only root filesystem, drops all Linux capabilities, enables `no-new-privileges`, and does not mount the Docker socket.
- Older kernels may not support the Landlock or unprivileged Bubblewrap features required by DSH, so the image uses `DSH_PERMISSION_MODE=danger-full-access` inside the container.
- Container hardening does not replace authentication or network access controls. Public access requires an external reverse proxy or access gateway providing HTTPS, authentication, and authorization.

## Images and updates

GHCR publishes `latest`, an exact DSH version tag, and a `sha-<commit>` tag for `linux/amd64` and `linux/arm64`.

To update a container that uses named volumes or bind mounts:

```sh
docker pull ghcr.io/omdsh-dev/dsh-container:latest
docker rm -f dsh-container
# Re-run the container with the same persistent options.
```

Data remains in the external volumes or host directories when the old container is removed. Source builds must bypass the cache to resolve npm `latest` again:

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```
