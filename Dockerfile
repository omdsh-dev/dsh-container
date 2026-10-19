FROM node:24-bookworm-slim AS auth-relay-build

WORKDIR /build

RUN corepack enable \
    && corepack install --global pnpm@11.7.0

COPY docker/auth-relay/package.json docker/auth-relay/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY docker/auth-relay/launch-token.mjs docker/auth-relay/lib.mjs docker/auth-relay/server.mjs docker/auth-relay/session.mjs ./
COPY docker/auth-relay/test ./test

RUN pnpm test \
    && pnpm prune --prod

FROM node:24-bookworm-slim

ENV DSH_HOME=/home/node/.dsh \
    DSH_PERMISSION_MODE=danger-full-access \
    DSH_TELEMETRY_DISABLED=1 \
    NODE_USE_ENV_PROXY=1 \
    PATH=/opt/dsh/node_modules/.bin:$PATH

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
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && corepack enable \
    && corepack install --global pnpm@11.7.0

ARG DSH_CONTAINER_DSH_VERSION=latest

RUN mkdir -p /opt/dsh \
    && cd /opt/dsh \
    && pnpm init --bare --no-init-package-manager \
    && pnpm config set node-linker hoisted --location=project \
    && dsh_resolved_version="$(pnpm view "@deepseek-ai/dsh@${DSH_CONTAINER_DSH_VERSION}" version --json \
        | jq -er 'if type == "string" then . else error("expected one resolved DSH version") end')" \
    && pnpm add --save-exact \
        --allow-build=@deepseek-ai/dsh-subprocess-local \
        --allow-build=koffi \
        --allow-build=node-pty \
        --allow-build=@google/genai \
        --allow-build=protobufjs \
        "react@18.3.1" \
        "react-dom@18.3.1" \
        "@deepseek-ai/dsh@${dsh_resolved_version}" \
    && pnpm peers check \
    && pnpm store prune \
    && mkdir -p /home/node/.dsh /workspace \
    && chown -R node:node /home/node /workspace

COPY --chown=root:root docker/dsh-container-plugin /tmp/dsh-container-plugin

COPY --from=auth-relay-build --chown=root:root /build/node_modules /opt/dsh-container/auth-relay/node_modules
COPY --chown=root:root \
    docker/auth-relay/package.json \
    docker/auth-relay/index.mjs \
    docker/auth-relay/launch-token.mjs \
    docker/auth-relay/lib.mjs \
    docker/auth-relay/server.mjs \
    docker/auth-relay/session.mjs \
    docker/auth-relay/validate-key.mjs \
    docker/auth-relay/validate-public-url.mjs \
    /opt/dsh-container/auth-relay/

COPY --chown=root:root \
    docker/auth-bootstrap.js \
    docker/patch-dsh.mjs \
    /tmp/

RUN node /tmp/patch-dsh.mjs /opt/dsh/node_modules \
    && rm -rf \
        /tmp/dsh-container-plugin \
        /tmp/auth-bootstrap.js \
        /tmp/patch-dsh.mjs

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
