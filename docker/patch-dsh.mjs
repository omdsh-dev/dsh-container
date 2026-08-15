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
const hostApiProxy = path.join(packageRoot, "dsh-host-apiproxy", "lib", "index.js");
const settingsClient = path.join(packageRoot, "dsh-client-ui-settings", "lib", "client.js");
const settingsModelsClient = path.join(
  packageRoot,
  "dsh-client-ui-settings-models",
  "lib",
  "client.js",
);

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
const removedGuardMarker =
  '/* dsh-container: trusted-host validation is the sole API access check. */';
let serverSource = await readFile(connectionServer, "utf8");

if (!serverSource.includes(removedGuardMarker)) {
  if (!serverSource.includes(upstreamGuard)) {
    throw new Error("DSH 权限检查实现已变化，需要复核兼容补丁");
  }
  serverSource = serverSource.replace(upstreamGuard, removedGuardMarker);
  await writeFile(connectionServer, serverSource);
}

const nativePathCapability =
  'return isWsl(internals) || present(env.DISPLAY) || present(env.WAYLAND_DISPLAY);';
const containerPathCapability =
  'return false; /* dsh-container: containers have no native desktop opener. */';
const settingsDocumentCapability =
  'hasDocument: settings.documentPath !== void 0,';
const containerSettingsDocumentCapability =
  'hasDocument: settings.documentPath !== void 0 && canOpenPaths(),';
let hostSource = await readFile(hostApiProxy, "utf8");

if (!hostSource.includes(containerPathCapability)) {
  if (!hostSource.includes(nativePathCapability)) {
    throw new Error("DSH 原生路径打开能力实现已变化，需要复核兼容补丁");
  }
  hostSource = hostSource.replace(nativePathCapability, containerPathCapability);
}

if (!hostSource.includes(containerSettingsDocumentCapability)) {
  if (!hostSource.includes(settingsDocumentCapability)) {
    throw new Error("DSH 设置文档能力实现已变化，需要复核兼容补丁");
  }
  hostSource = hostSource.replace(
    settingsDocumentCapability,
    containerSettingsDocumentCapability,
  );
}

await writeFile(hostApiProxy, hostSource);

const loopbackSettingsMode = 'connection.isLoopback ? "host" : "memory"';
const trustedHostSettingsMode =
  '"host" /* dsh-container: trusted-host clients persist settings on the Host. */';

for (const target of [settingsClient, settingsModelsClient]) {
  let clientSource = await readFile(target, "utf8");
  if (!clientSource.includes(trustedHostSettingsMode)) {
    if (!clientSource.includes(loopbackSettingsMode)) {
      throw new Error(`DSH 客户端设置持久化实现已变化，需要复核兼容补丁：${target}`);
    }
    clientSource = clientSource.replace(loopbackSettingsMode, trustedHostSettingsMode);
    await writeFile(target, clientSource);
  }
}
