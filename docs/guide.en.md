English | [简体中文](guide.md)

# dsh-container guide

This guide covers persistent deployment, LAN access, configuration, Web UI management, security boundaries, and updates. See the [project home](../README.en.md) for an overview and the shortest startup commands.

> [!WARNING]
> **Do not expose this service directly to the public internet.** The optional shared key is intended for a trusted LAN or a single-administrator deployment already behind external HTTPS and access policy. It does not provide accounts, roles, data isolation, or public-internet hardening. An authenticated client can change settings and credentials and run Agent commands in the container.

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

## Administrator key authentication

Add `-e "DSH_CONTAINER_KEY=your-private-key"` to Docker Run, or set the variable in the `.env` used by Compose:

```dotenv
DSH_CONTAINER_KEY=replace-with-a-private-key
```

Leaving the variable undefined preserves the existing unauthenticated behavior. Defining it as empty, whitespace-only, containing control characters, or longer than 4096 UTF-8 bytes makes the container exit with a configuration error. Every other value is compared as the original string: surrounding spaces are not removed and there is no minimum-strength rule. When enabled, every page, static asset, API, and WebSocket outside the login and logout endpoints requires authentication. An untrusted Host, cross-site Fetch Metadata, or mismatched Origin returns `403` before Cookie validation, so a valid Cookie cannot bypass those checks.

The login page selects Simplified Chinese or English from `Accept-Language` and also offers an explicit switch. A successful login writes a long-lived `dsh_container_session` Cookie with `HttpOnly`, `Path=/`, and `SameSite=Lax`. Its token contains a random nonce and an HMAC-SHA256 signature and has no server-side expiry. Browsers can still shorten its lifetime or evict it. A container restart preserves validity; rotating `DSH_CONTAINER_KEY` immediately invalidates old Cookies.

![Administrator key sign-in](login.en.png)

Each actual TCP peer can fail five times in a burst, then recovers one attempt every 60 seconds; a successful login resets that peer's record. **Sign out this device** on the settings page only clears the current browser Cookie and does not maintain a server-side revocation list. A copied Cookie remains replayable until the key is rotated. Programmatic clients must obtain a Cookie through `GET|POST /_dsh-container/auth/login` and send it on later requests; Bearer authentication is not supported. `POST /_dsh-container/auth/logout` clears the current Cookie. An unauthenticated response has status `401` and `X-DSH-Container-Auth: required`.

The confirmed runtime model leaves `DSH_CONTAINER_KEY` in the DSH process environment. An Agent running inside the container can read and exfiltrate it. Do not treat the key as non-extractable when untrusted tasks, workspaces, or plugins can access that environment. It is a single-administrator entry control, not an Agent isolation boundary.

### HTTPS reverse proxy

A direct HTTP login does not set `Secure`. The relay adds `Secure` when it receives `Forwarded: proto=https` or `X-Forwarded-Proto: https`. An HTTPS proxy must overwrite client-supplied protocol headers and preserve the original Host and Origin. This Nginx example also supports streaming requests and WebSockets:

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

`DSH_CONTAINER_TRUSTED_HOSTS` must include the browser-facing `dsh.example.com`. If the proxy does not overwrite the protocol header, a direct client can spoof it and make the browser receive a `Secure` Cookie that plain HTTP cannot send. If the proxy does not forward the correct Host and Origin, requests return `403` by design.

## Configuration

| Variable | Default | Use |
|---|---|---|
| `DSH_CONTAINER_TRUSTED_HOSTS` | required | Hostnames, IP addresses, or `host:port` values accepted by DSH. |
| `DSH_CONTAINER_KEY` | unset | Optional shared administrator key; enables Cookie authentication for the whole entry point. |
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

The Web UI adds a read-only **DSH Container** settings page showing the DSH version, ports, trusted hosts, runtime user, permission mode, telemetry, and authentication state. It also provides **Sign out this device** when authentication is enabled.

![DSH Container settings](settings.png)

**Restart container** requests a graceful exit, but it still interrupts running Agents, terminals, and network connections. Automatic recovery requires Docker restart policy `on-failure[:max-retries]`, `always`, or `unless-stopped`; `no` or an unset policy leaves the container stopped.

## Security

- The image runs as a non-root user with UID and GID 1000.
- The recommended deployment uses a read-only root filesystem, drops all Linux capabilities, enables `no-new-privileges`, and does not mount the Docker socket.
- Older kernels may not support the Landlock or unprivileged Bubblewrap features required by DSH, so the image uses `DSH_PERMISSION_MODE=danger-full-access` inside the container.
- The shared administrator key provides no user identity, role authorization, or Agent isolation, and Agents inside the container can read it.
- Neither container hardening nor the shared key replaces HTTPS and network access controls. Do not expose the service directly to the public internet; place remote access behind external HTTPS and access policy.

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
