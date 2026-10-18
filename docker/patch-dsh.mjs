import { chmod, copyFile, cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const moduleRoot = process.argv[2];
if (!moduleRoot) {
  throw new Error("缺少模块目录参数");
}

const dshRoot = path.join(moduleRoot, "@deepseek-ai", "dsh");
const dshManifestPath = path.join(dshRoot, "package.json");
const packageRoot = path.join(moduleRoot, "@deepseek-ai");
const frontendDirectory = path.join(packageRoot, "dsh-web-frontend", "dist");
const frontendIndex = path.join(frontendDirectory, "index.html");
const authBootstrapTarget = path.join(frontendDirectory, "auth-bootstrap.js");
const faviconSource = path.join(frontendDirectory, "favicon.svg");
const relayFaviconTarget = "/opt/dsh-container/auth-relay/favicon.svg";
const connectionServer = path.join(packageRoot, "dsh-client-connection", "lib", "index.js");
const webServerPackage = path.join(packageRoot, "dsh-host-webserver", "lib", "index.js");
const settingsModelsClient = path.join(
  packageRoot,
  "dsh-client-ui-settings-models",
  "lib",
  "client.js",
);
const webAppPatch = path.join(packageRoot, "dsh-web-app", "cordis.patch.yml");
const containerPluginSource = "/tmp/dsh-container-plugin";
const containerPluginTarget = path.join(moduleRoot, "dsh-container-plugin");
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

// The container plugin's browser half loads through the same module loader and
// settings slot every first-party browser package uses; assert both contracts
// so a DSH refactor fails the build instead of shipping a blank settings page.
const moduleLoaderAnchor = `window.__ModuleLoader__.load({
\tid: "@deepseek-ai/dsh-client-ui-settings-models",
\tfactory: (require) => {`;
const settingsSectionAnchor = `ctx.slots.inject("settings.section", () => ctx.slots.register({
\t\t\t\tname: "settings.section",
\t\t\t\tid: "models",`;
// The container plugin's host half owns one web route and asks Connection to
// admit each request; assert both services expose the entry points it calls.
const admissionAnchor = "requestRejection(request) {";
const webRouteAnchor = "register(route) {";
const settingsExtensionSource = await readFile(settingsModelsClient, "utf8");
const connectionExtensionSource = await readFile(connectionServer, "utf8");
const webServerSource = await readFile(webServerPackage, "utf8");

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
  admissionAnchor,
  "DSH Connection 请求放行接口已变化，需要复核容器 RPC channel",
);
requireExactAnchor(
  webServerSource,
  webRouteAnchor,
  "DSH Web 路由注册接口已变化，需要复核容器 RPC channel",
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
const authBootstrapTag = '    <script src="/auth-bootstrap.js"></script>\n';
let html = await readFile(frontendIndex, "utf8");

if (!html.includes(authBootstrapTag)) {
  if (!html.includes(moduleTag)) {
    throw new Error("无法定位 DSH 前端模块入口");
  }
  html = html.replace(moduleTag, `${authBootstrapTag}${moduleTag}`);
  await writeFile(frontendIndex, html);
}

await copyFile("/tmp/auth-bootstrap.js", authBootstrapTarget);
await copyFile(faviconSource, relayFaviconTarget);
await chmod(authBootstrapTarget, 0o644);
await chmod(relayFaviconTarget, 0o644);
