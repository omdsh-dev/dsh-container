FROM node:24-bookworm-slim

ARG DSH_SERVER_DSH_VERSION=latest

ENV DSH_HOME=/home/node/.dsh \
    DSH_PERMISSION_MODE=danger-full-access \
    DSH_TELEMETRY_DISABLED=1 \
    NODE_USE_ENV_PROXY=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        fd-find \
        g++ \
        git \
        jq \
        make \
        openssh-client \
        python3 \
        ripgrep \
        socat \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && corepack enable \
    && corepack install --global pnpm@11.7.0

RUN npm install --global --no-audit --no-fund \
        --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
        "@deepseek-ai/dsh@${DSH_SERVER_DSH_VERSION}" \
    && npm cache clean --force \
    && mkdir -p /home/node/.dsh /workspace \
    && chown -R node:node /home/node /workspace

COPY --chown=root:root \
    docker/patch-dsh.mjs \
    docker/random-uuid-polyfill.js \
    /tmp/

RUN node /tmp/patch-dsh.mjs "$(npm root --global)" \
    && rm /tmp/patch-dsh.mjs /tmp/random-uuid-polyfill.js

COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/dsh-server-entrypoint

RUN chmod 0755 /usr/local/bin/dsh-server-entrypoint

USER node
WORKDIR /home/node

EXPOSE 3080

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
    CMD node -e "const port = process.env.DSH_SERVER_INTERNAL_PORT ?? '3081'; fetch('http://127.0.0.1:' + port + '/').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/dsh-server-entrypoint"]
