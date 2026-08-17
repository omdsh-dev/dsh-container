import { readAuthenticationKey } from "./lib.mjs";

try {
  const authentication = readAuthenticationKey(process.env);
  if (!authentication.enabled) process.exitCode = 2;
} catch (error) {
  console.error(`dsh-container: invalid DSH_CONTAINER_KEY: ${error.message}`);
  process.exitCode = 64;
}
