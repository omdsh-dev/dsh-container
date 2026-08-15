import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const npmRoot = process.argv[2];
if (!npmRoot) {
  throw new Error("缺少 npm 全局模块目录参数");
}

const packageRoot = path.join(npmRoot, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai");
const frontendDirectory = path.join(packageRoot, "dsh-web-frontend", "dist");
const frontendIndex = path.join(frontendDirectory, "index.html");
const polyfillTarget = path.join(frontendDirectory, "random-uuid-polyfill.js");
const connectionServer = path.join(packageRoot, "dsh-client-connection", "lib", "index.js");

const moduleTag = '    <script type="module"';
const polyfillTag = '    <script src="/random-uuid-polyfill.js"></script>\n';
let html = await readFile(frontendIndex, "utf8");

if (!html.includes(polyfillTag)) {
  if (!html.includes(moduleTag)) {
    throw new Error("无法定位 DSH 前端模块入口");
  }
  html = html.replace(moduleTag, `${polyfillTag}${moduleTag}`);
  await writeFile(frontendIndex, html);
}

await copyFile("/tmp/random-uuid-polyfill.js", polyfillTarget);
await chmod(polyfillTarget, 0o644);

const upstreamGuard =
  'if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])) return new Response("forbidden", { status: 403 });';
const remoteSettingsCheck =
  'process.env.DSH_ALLOW_REMOTE_SETTINGS === "1" && (method.startsWith("settings.") || method.startsWith("credentials.") || method === "llm.discoverModels")';
const patchedGuard =
  `if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !(${remoteSettingsCheck}) && !isTrustedApiRequest(request, [])) return new Response("forbidden", { status: 403 });`;
let serverSource = await readFile(connectionServer, "utf8");

if (!serverSource.includes(patchedGuard)) {
  if (!serverSource.includes(upstreamGuard)) {
    throw new Error("DSH 权限检查实现已变化，需要复核兼容补丁");
  }
  serverSource = serverSource.replace(upstreamGuard, patchedGuard);
  await writeFile(connectionServer, serverSource);
}
