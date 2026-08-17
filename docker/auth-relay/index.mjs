import {
  parsePort,
  parseTrustedHosts,
  readAuthenticationKey,
} from "./lib.mjs";
import { createAuthRelay } from "./server.mjs";

const authentication = readAuthenticationKey(process.env);
if (!authentication.enabled) {
  throw new Error("DSH_CONTAINER_KEY is not defined");
}
const listenPort = parsePort(process.env.DSH_CONTAINER_RELAY_PORT ?? "3080", "DSH_CONTAINER_RELAY_PORT");
const upstreamPort = parsePort(process.env.DSH_CONTAINER_INTERNAL_PORT ?? "3081", "DSH_CONTAINER_INTERNAL_PORT");
const trustedHosts = parseTrustedHosts(process.env.DSH_CONTAINER_TRUSTED_HOSTS ?? "");
const relay = await createAuthRelay({
  key: authentication.key,
  trustedHosts,
  listenPort,
  upstreamPort,
  faviconPath: new URL("./favicon.svg", import.meta.url),
});

await relay.listen();
console.log(`dsh-container auth relay: listening on port ${listenPort}`);

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
