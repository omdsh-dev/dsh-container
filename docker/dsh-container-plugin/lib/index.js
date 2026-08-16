import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-container";
export const inject = ["connection"];
export const Config = z.object({});

const RPC_CHANNEL = "/dsh-container";
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
    },
    restartAllowed: process.env.DSH_CONTAINER_ALLOW_RESTART === "1",
  };
}

export function apply(ctx) {
  let restartScheduled = false;

  ctx.connection.rpc.handle(
    RPC_CHANNEL,
    async (endpoint, payload) => {
      if (!isEmptyObject(payload)) {
        return badRequest(`${endpoint} accepts only an empty object`);
      }

      if (endpoint === "describe") {
        return { ok: true, value: describeContainer() };
      }

      if (endpoint !== "restart") {
        return badRequest(`unknown dsh-container endpoint: ${endpoint}`);
      }

      if (process.env.DSH_CONTAINER_ALLOW_RESTART !== "1") {
        return badRequest("container restart is disabled by the deployment");
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
    },
    { authority: "trusted-host" },
  );
}
