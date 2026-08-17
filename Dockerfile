FROM node:24-bookworm-slim AS auth-relay-build

WORKDIR /build

RUN corepack enable \
    && corepack install --global pnpm@11.7.0

COPY docker/auth-relay/package.json docker/auth-relay/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY docker/auth-relay/lib.mjs docker/auth-relay/server.mjs ./
COPY docker/auth-relay/test ./test

RUN pnpm test \
    && pnpm prune --prod

FROM node:24-bookworm-slim

ARG DSH_CONTAINER_DSH_VERSION=latest

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
        "@deepseek-ai/dsh@${DSH_CONTAINER_DSH_VERSION}" \
    && npm cache clean --force \
    && mkdir -p /home/node/.dsh /workspace \
    && chown -R node:node /home/node /workspace

COPY --chown=root:root docker/dsh-container-plugin /tmp/dsh-container-plugin

COPY --from=auth-relay-build --chown=root:root /build/node_modules /opt/dsh-container/auth-relay/node_modules
COPY --chown=root:root \
    docker/auth-relay/package.json \
    docker/auth-relay/index.mjs \
    docker/auth-relay/lib.mjs \
    docker/auth-relay/server.mjs \
    docker/auth-relay/validate-key.mjs \
    /opt/dsh-container/auth-relay/

COPY --chown=root:root \
    docker/auth-bootstrap.js \
    docker/patch-dsh.mjs \
    docker/random-uuid-polyfill.js \
    /tmp/

RUN node /tmp/patch-dsh.mjs "$(npm root --global)" \
    && rm -rf \
        /tmp/dsh-container-plugin \
        /tmp/auth-bootstrap.js \
        /tmp/patch-dsh.mjs \
        /tmp/random-uuid-polyfill.js

COPY --chown=root:root \
    docker/entrypoint.sh \
    docker/healthcheck.mjs \
    /usr/local/lib/dsh-container/

RUN ln -s /usr/local/lib/dsh-container/entrypoint.sh /usr/local/bin/dsh-container-entrypoint \
    && chmod 0755 /usr/local/lib/dsh-container/entrypoint.sh

USER node
WORKDIR /home/node

EXPOSE 3080

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
    CMD ["node", "/usr/local/lib/dsh-container/healthcheck.mjs"]

ENTRYPOINT ["/usr/local/bin/dsh-container-entrypoint"]
