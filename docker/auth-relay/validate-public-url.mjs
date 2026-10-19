import { parsePublicUrl } from "./lib.mjs";

try {
  process.stdout.write(parsePublicUrl(process.argv[2] ?? ""));
} catch (error) {
  console.error(`dsh-container: invalid DSH_CONTAINER_PUBLIC_URL: ${error.message}`);
  process.exitCode = 64;
}
