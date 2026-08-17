English | [简体中文](README.md)

# dsh-container

[![GHCR](https://github.com/omdsh-dev/dsh-container/actions/workflows/publish-ghcr.yaml/badge.svg)](https://github.com/omdsh-dev/dsh-container/actions/workflows/publish-ghcr.yaml)

`dsh-container` packages the npm release of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as a ready-to-run Docker service for `linux/amd64` and `linux/arm64`.

- **Ready to run:** DSH and its runtime dependencies are preinstalled; no Node.js or npm setup is required on the host.
- **LAN access:** Access the Web UI from multiple devices, including over plain HTTP and from headless hosts.
- **Hardened and persistent:** Runs as non-root; the recommended deployment uses a read-only root filesystem, drops Linux capabilities, and stores configuration and workspace data separately.
- **Web management:** View effective container settings and request a graceful restart from the Web UI.

> [!WARNING]
> **Do not expose this service directly to the public internet.** dsh-container provides no authentication, and trusted-host is not a substitute for authentication. Use it only on a trusted network; remote access requires additional HTTPS, authentication, and access controls.

## Quick start

### Docker

```sh
docker run -d --name dsh-container --restart unless-stopped -p 127.0.0.1:3080:3080 -e "DSH_CONTAINER_TRUSTED_HOSTS=localhost,127.0.0.1" ghcr.io/omdsh-dev/dsh-container:latest
```

Open <http://localhost:3080> after the health check passes. This command is for a disposable trial: settings and workspace data are lost when the container is removed.

### Docker Compose

```sh
cp .env.example .env
mkdir -p .dsh workspace
sudo chown -R 1000:1000 .dsh workspace
docker compose up -d --build
```

Compose builds the image from the current repository and allows local access only by default.

## Documentation

The [complete guide](docs/guide.en.md) covers persistent deployment, LAN access, configuration, Web UI management, security, and updates.

## License

[MIT](LICENSE)
