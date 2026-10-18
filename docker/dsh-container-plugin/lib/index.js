import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-container";
export const inject = ["connection", "webServer"];
export const Config = z.object({});

const RPC_CHANNEL = "/dsh-container";
const ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/u;
const REQUEST_BODY_LIMIT = 16 * 1024;
const RESTART_AFTER_MS = 500;
const instanceId = randomUUID();

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const dshVersion = manifest.dshContainer?.dshVersion;
if (typeof dshVersion !== "string" || dshVersion.length === 0) {
  throw new Error("dsh-container: missing installed DSH version metadata");
}

function portFromEnvironment(name, fallback) {
  const value = process.env[name] ?? fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`dsh-container: invalid normalized port ${name}`);
  }
  return port;
}

function trustedHostsFromEnvironment() {
  return (process.env.DSH_CONTAINER_TRUSTED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

function isEmptyObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 0;
}

function badRequest(message) {
  return {
    ok: false,
    error: { code: "bad-request", message, details: { issues: [] } },
  };
}

function describeContainer() {
  return {
    instanceId,
    dshVersion,
    trustedHosts: trustedHostsFromEnvironment(),
    relayPort: portFromEnvironment("DSH_CONTAINER_RELAY_PORT", "3080"),
    internalPort: portFromEnvironment("DSH_CONTAINER_INTERNAL_PORT", "3081"),
    timeZone: process.env.TZ?.trim()
      || Intl.DateTimeFormat().resolvedOptions().timeZone
      || "UTC",
    security: {
      uid: process.getuid?.() ?? -1,
      gid: process.getgid?.() ?? -1,
      permissionMode: process.env.DSH_PERMISSION_MODE ?? "unknown",
      telemetryDisabled: (process.env.DSH_TELEMETRY_DISABLED ?? "").length > 0,
      authenticationEnabled: Object.hasOwn(process.env, "DSH_CONTAINER_KEY"),
    },
  };
}

function writeEnvelope(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function writeText(response, status, text) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > REQUEST_BODY_LIMIT) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function endpointOf(pathname) {
  const prefix = `${RPC_CHANNEL}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const endpoint = pathname.slice(prefix.length);
  return ENDPOINT_PATTERN.test(endpoint) ? endpoint : undefined;
}

export function apply(ctx) {
  let restartScheduled = false;

  const dispatch = async (endpoint, payload) => {
    if (!isEmptyObject(payload)) {
      return badRequest(`${endpoint} accepts only an empty object`);
    }

    if (endpoint === "describe") {
      return { ok: true, value: describeContainer() };
    }

    if (endpoint !== "restart") {
      return badRequest(`unknown dsh-container endpoint: ${endpoint}`);
    }

    if (!restartScheduled) {
      restartScheduled = true;
      setTimeout(() => {
        try {
          process.kill(process.ppid, "SIGUSR1");
        } catch (error) {
          ctx.logger.error(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }, RESTART_AFTER_MS);
    }

    return {
      ok: true,
      value: { accepted: true, instanceId, restartAfterMs: RESTART_AFTER_MS },
    };
  };

  const channel = async (request, response) => {
    // Same fence and browser-session gate the Host applies to its own /api
    // route; DSH 0.2 no longer exposes a per-channel registration hook, so the
    // plugin owns the route and asks Connection to admit the request.
    const rejection = ctx.connection.requestRejection(request);
    if (rejection !== undefined) {
      writeText(response, rejection, rejection === 401 ? "unauthorized" : "forbidden");
      return;
    }

    const url = new URL(request.url ?? "/", "http://dsh-container.invalid");
    const endpoint = endpointOf(url.pathname);
    if (request.method !== "POST" || endpoint === undefined) {
      writeText(response, 404, "not found");
      return;
    }
    const contentType = (request.headers["content-type"] ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      writeText(response, 415, "content type must be application/json");
      return;
    }

    const body = await readJsonBody(request);
    if (body === undefined) {
      writeText(response, 400, "body is not a bounded JSON document");
      return;
    }
    if (body === null
      || typeof body !== "object"
      || body.type !== "client-request"
      || typeof body.rpcId !== "string"
      || typeof body.method !== "string") {
      writeText(response, 400, "body is not a client-request envelope");
      return;
    }

    if (body.method !== endpoint) {
      writeEnvelope(response, 200, {
        type: "server-response",
        rpcId: body.rpcId,
        result: badRequest(
          `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
        ),
      });
      return;
    }

    writeEnvelope(response, 200, {
      type: "server-response",
      rpcId: body.rpcId,
      result: await dispatch(endpoint, body.payload),
    });
  };

  ctx.effect(
    () => ctx.webServer.register({
      kind: "prefix",
      path: RPC_CHANNEL,
      handler: (request, response) => {
        void channel(request, response).catch((error) => {
          ctx.logger.error(
            error instanceof Error ? error : new Error(String(error)),
          );
          if (response.headersSent) response.destroy();
          else writeText(response, 500, "internal server error");
        });
      },
    }),
    "dsh-container: rpc channel",
  );
}
