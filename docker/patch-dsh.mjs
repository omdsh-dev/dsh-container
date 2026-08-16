import { chmod, copyFile, cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const npmRoot = process.argv[2];
if (!npmRoot) {
  throw new Error("缺少 npm 全局模块目录参数");
}

const dshRoot = path.join(npmRoot, "@deepseek-ai", "dsh");
const dshManifestPath = path.join(dshRoot, "package.json");
const packageRoot = path.join(dshRoot, "node_modules", "@deepseek-ai");
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
const webAppPatch = path.join(packageRoot, "dsh-web-app", "cordis.patch.yml");
const containerPluginSource = "/tmp/dsh-container-plugin";
const containerPluginTarget = path.join(dshRoot, "node_modules", "dsh-container-plugin");
const containerPluginManifest = path.join(containerPluginTarget, "package.json");

function requireExactAnchor(source, anchor, message) {
  if (source.split(anchor).length !== 2) {
    throw new Error(message);
  }
}

const dshManifest = JSON.parse(await readFile(dshManifestPath, "utf8"));
if (typeof dshManifest.version !== "string" || dshManifest.version.length === 0) {
  throw new Error("无法读取实际安装的 DSH 版本");
}
if (
  dshManifest.dependencies === null
  || typeof dshManifest.dependencies !== "object"
  || Array.isArray(dshManifest.dependencies)
) {
  throw new Error("DSH 安装清单 dependencies 已变化，需要复核插件注入");
}

const moduleLoaderAnchor = `window.__ModuleLoader__.load({
\tid: "@deepseek-ai/dsh-client-ui-settings-models",
\tfactory: (require) => {`;
const settingsSectionAnchor = `ctx.slots.inject("settings.section", () => ctx.slots.register({
\t\t\t\tname: "settings.section",
\t\t\t\tid: "models",`;
const connectionRpcAnchor =
  "handle: (channel, handler, options) => this.register(owner, channel, handler, options),";
const connectionTrustedHostAnchor =
  'const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;';
const settingsExtensionSource = await readFile(settingsModelsClient, "utf8");
const connectionExtensionSource = await readFile(connectionServer, "utf8");

requireExactAnchor(
  settingsExtensionSource,
  moduleLoaderAnchor,
  "DSH 浏览器模块加载器已变化，需要复核容器插件入口",
);
requireExactAnchor(
  settingsExtensionSource,
  settingsSectionAnchor,
  "DSH 设置 section 扩展点已变化，需要复核容器设置页注册",
);
requireExactAnchor(
  connectionExtensionSource,
  connectionRpcAnchor,
  "DSH Connection RPC 扩展点已变化，需要复核容器 RPC channel",
);
requireExactAnchor(
  connectionExtensionSource,
  connectionTrustedHostAnchor,
  "DSH Connection RPC 权限模型已变化，需要复核 trusted-host 防护",
);

await cp(containerPluginSource, containerPluginTarget, {
  recursive: true,
  force: true,
});

const pluginManifest = JSON.parse(await readFile(containerPluginManifest, "utf8"));
pluginManifest.dshContainer = { dshVersion: dshManifest.version };
await writeFile(containerPluginManifest, `${JSON.stringify(pluginManifest, undefined, 2)}\n`);

if (dshManifest.dependencies[pluginManifest.name] !== pluginManifest.version) {
  dshManifest.dependencies[pluginManifest.name] = pluginManifest.version;
  await writeFile(dshManifestPath, `${JSON.stringify(dshManifest, undefined, 2)}\n`);
}

const containerPluginRow = `    - id: dsh-container
      name: 'dsh-container-plugin'`;
const webProfileAnchor = `    - id: ui-settings-plugins
      name: '@deepseek-ai/dsh-client-ui-settings-plugins'`;
let webProfileSource = await readFile(webAppPatch, "utf8");
const containerPluginRowCount = webProfileSource.split(containerPluginRow).length - 1;
if (containerPluginRowCount === 0) {
  if (webProfileSource.split(webProfileAnchor).length !== 2) {
    throw new Error("DSH Web 插件清单已变化，需要复核容器插件注入");
  }
  webProfileSource = webProfileSource.replace(
    webProfileAnchor,
    `${webProfileAnchor}\n\n${containerPluginRow}`,
  );
  await writeFile(webAppPatch, webProfileSource);
} else if (containerPluginRowCount !== 1) {
  throw new Error("DSH Web 插件清单包含重复的容器插件，需要复核插件注入");
}

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
let serverSource = connectionExtensionSource;

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
