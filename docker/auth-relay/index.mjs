import {
  parsePort,
  parseTrustedHosts,
  readAuthenticationKey,
} from "./lib.mjs";
import { createAuthRelay } from "./server.mjs";
import { createHostSession } from "./session.mjs";

const authentication = readAuthenticationKey(process.env);
const listenPort = parsePort(process.env.DSH_CONTAINER_RELAY_PORT ?? "3080", "DSH_CONTAINER_RELAY_PORT");
const upstreamPort = parsePort(process.env.DSH_CONTAINER_INTERNAL_PORT ?? "3081", "DSH_CONTAINER_INTERNAL_PORT");
const trustedHosts = parseTrustedHosts(process.env.DSH_CONTAINER_TRUSTED_HOSTS ?? "");
const startupLog = process.env.DSH_CONTAINER_STARTUP_LOG ?? "/tmp/dsh-web.log";
const session = createHostSession({ upstreamPort, startupLog });
const relay = await createAuthRelay({
  key: authentication.enabled ? authentication.key : undefined,
  trustedHosts,
  listenPort,
  upstreamPort,
  faviconPath: new URL("./favicon.svg", import.meta.url),
  session,
});

try {
  await session.ready();
} catch (error) {
  console.error(`dsh-container auth relay: ${error.message}`);
  process.exit(70);
}
await relay.listen();
console.log(
  `dsh-container auth relay: listening on port ${listenPort}`
  + ` (${authentication.enabled ? "administrator key enabled" : "no administrator key"})`,
);

let stopping = false;
async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  try {
    await relay.close();
  } finally {
    process.exit(exitCode);
  }
}

process.on("SIGTERM", () => { void stop(0); });
process.on("SIGINT", () => { void stop(0); });
