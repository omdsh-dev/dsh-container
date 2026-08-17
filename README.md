English | [简体中文](README.zh.md)

# dsh-container

[![Publish GHCR image](https://github.com/omdsh-dev/dsh-container/actions/workflows/publish-ghcr.yaml/badge.svg)](https://github.com/omdsh-dev/dsh-container/actions/workflows/publish-ghcr.yaml)

Run the npm release of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) in Docker. Published images support `linux/amd64` and `linux/arm64`, and include the npm dependencies needed at runtime.

> [!WARNING]
> **Do not expose this service to the public internet.** dsh-container provides no authentication. A client that passes the trusted-host check can call the API, change settings and credentials, and run Agent commands in the container. Use it only on a fully trusted network; if remote access is unavoidable, use HTTPS, authentication, and access controls.

## Quick start

Install Docker and run:

```sh
docker run -d --name dsh-container --restart unless-stopped -p 127.0.0.1:3080:3080 -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/omdsh-dev/dsh-container:latest
```

Open <http://localhost:3080> after the health check passes. This command is for a disposable trial: settings and workspace data live inside the container and are lost when it is removed.

For LAN access, replace the port mapping with `-p 3080:3080` and set `DSH_CONTAINER_TRUSTED_HOSTS` to every hostname or IP (or `host:port`) used in the browser. Separate multiple entries with commas.

## Persistent use

Use named volumes for settings and workspace data:

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

Docker initializes named volumes with the correct ownership. To let the Agent work directly in host directories, replace the two volume lines with bind mounts:

```sh
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace

-v "$(pwd)/workspace:/home/node" \
-v "$(pwd)/.dsh:/home/node/.dsh" \
```

The image runs as UID 1000, so bind-mounted directories must be writable by that user.

## Configuration

| Variable | Default | Use |
|---|---|---|
| `DSH_CONTAINER_TRUSTED_HOSTS` | required | Hostnames, IPs, or `host:port` authorities accepted by DSH. A port-less entry matches any port. |
| `TZ` | system default | Container time zone. |
| `DEEPSEEK_API_KEY` | unset | Optional API key; it can also be saved in the Web UI. |
| `DEEPSEEK_BASE_URL` | official API | Optional OpenAI-compatible endpoint. |

Compose-only image, port, DSH version, and proxy settings are documented in [`.env.example`](.env.example).

## DSH container integration

The Web UI adds a read-only **DSH Container** page with the DSH version, ports, trusted hosts, runtime user, permission mode, and telemetry state. Its restart action interrupts running Agents, terminals, and network connections. Automatic recovery requires Docker restart policy `on-failure[:max-retries]`, `always`, or `unless-stopped`; `no` or an unset policy leaves the container stopped.

## Build from source

The Compose file builds locally and does not use GHCR:

```sh
cp .env.example .env
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
# Edit .env when the browser uses a different hostname or IP.
docker compose up -d --build
docker compose ps
```

## Security

trusted-host is a reachability and same-origin boundary, not authentication. The image runs as a non-root user; the persistent command and Compose use a read-only root filesystem, drop Linux capabilities, enable `no-new-privileges`, and do not mount the Docker socket. Older kernels may not support DSH's Landlock or unprivileged Bubblewrap, so the image uses `DSH_PERMISSION_MODE=danger-full-access` inside the container. This does not replace network access controls or authentication.

## Updating

GHCR publishes `latest`, an exact DSH version tag, and a `sha-<commit>` tag. To update a persistent container:

```sh
docker pull ghcr.io/omdsh-dev/dsh-container:latest
docker rm -f dsh-container
# Run the persistent command above again.
```

For a source build, force npm `latest` to resolve again:

```sh
docker compose build --no-cache dsh
docker compose up -d dsh
```

## License

[MIT](LICENSE)
