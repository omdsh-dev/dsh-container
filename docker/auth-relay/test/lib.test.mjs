import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import {
  LOGIN_PATH,
  LoginLimiter,
  assertTrustedAuthority,
  clearSessionCookieHeader,
  createKeyVerifier,
  isSecureRequest,
  isTopLevelHtmlNavigation,
  isTrustedRequest,
  issueSessionToken,
  parsePort,
  parseTrustedHosts,
  readAuthenticationKey,
  renderLoginPage,
  safeReturnPath,
  sanitizedProxyError,
  sessionCookieHeader,
  sessionFromCookieHeader,
  verifySessionToken,
  withoutSessionCookie,
} from "../lib.mjs";

test("密钥配置区分未定义，并拒绝空白、控制字符和超长 UTF-8 值", () => {
  assert.deepEqual(readAuthenticationKey({}), { enabled: false });
  assert.deepEqual(readAuthenticationKey({ DSH_CONTAINER_KEY: "  raw key  " }), {
    enabled: true,
    key: "  raw key  ",
  });
  for (const key of ["", " \t ", "line\nfeed", "delete\u007fcharacter", "界".repeat(1366)]) {
    assert.throws(() => readAuthenticationKey({ DSH_CONTAINER_KEY: key }), /DSH_CONTAINER_KEY/u);
  }
  assert.equal(Buffer.byteLength("界".repeat(1365), "utf8"), 4095);
  assert.equal(readAuthenticationKey({ DSH_CONTAINER_KEY: "界".repeat(1365) }).enabled, true);
});

test("端口与 trusted-host 配置使用与 DSH 相同的规范化规则", () => {
  assert.equal(parsePort("3080", "PORT"), 3080);
  for (const value of ["0", "65536", "3.5", " 80", ""] ) {
    assert.throws(() => parsePort(value, "PORT"), /PORT/u);
  }
  assert.deepEqual(parseTrustedHosts(" localhost, 192.168.1.10,dsh.example:8443 "), [
    "localhost",
    "192.168.1.10",
    "dsh.example:8443",
  ]);
  for (const entry of ["", " dsh.example", "dsh.example/route", "user@dsh.example", "dsh.example:", "[::1"] ) {
    if (entry === "") assert.throws(() => parseTrustedHosts(entry), /must not be empty/u);
    else assert.throws(() => assertTrustedAuthority(entry), /invalid trusted host/u);
  }
});

test("恒定长度摘要比较保留密钥原始字符串语义", () => {
  const verifier = createKeyVerifier(" secret ", Buffer.alloc(32, 7));
  assert.equal(verifier(" secret "), true);
  assert.equal(verifier("secret"), false);
  assert.equal(verifier(" secret  "), false);
  assert.equal(verifier("完全不同且长度也不同"), false);
});

test("会话令牌使用随机 nonce 与 HMAC，密钥轮换后立即失效", () => {
  const token = issueSessionToken("alpha", Buffer.alloc(32, 1));
  assert.equal(token.split(".").length, 2);
  assert.equal(verifySessionToken("alpha", token), true);
  assert.equal(verifySessionToken("beta", token), false);
  assert.equal(verifySessionToken("alpha", `${token.slice(0, -1)}x`), false);
  assert.equal(verifySessionToken("alpha", `${token}.extra`), false);
  assert.equal(verifySessionToken("alpha", "not-a-token"), false);
});

test("会话 Cookie 长期持久、HttpOnly、SameSite=Lax，并按代理协议设置 Secure", () => {
  const plain = sessionCookieHeader("token", false, 0);
  assert.match(plain, /^dsh_container_session=token;/u);
  assert.match(plain, /HttpOnly/u);
  assert.match(plain, /Path=\//u);
  assert.match(plain, /SameSite=Lax/u);
  assert.match(plain, /Max-Age=315360000/u);
  assert.doesNotMatch(plain, /Secure/u);
  assert.match(sessionCookieHeader("token", true, 0), /Secure/u);
  assert.match(clearSessionCookieHeader(true), /Max-Age=0/u);
  assert.match(clearSessionCookieHeader(true), /Expires=Thu, 01 Jan 1970 00:00:00 GMT/u);
});

test("认证 Cookie 可读取并会在转发前精确移除", () => {
  const header = "theme=dark; dsh_container_session=secret-token; other=value";
  assert.equal(sessionFromCookieHeader(header), "secret-token");
  assert.equal(withoutSessionCookie(header), "theme=dark; other=value");
  assert.equal(withoutSessionCookie("dsh_container_session=x"), undefined);
  assert.equal(withoutSessionCookie(undefined), undefined);
});

test("Host、Origin 和 Fetch Metadata 校验先于认证", () => {
  const trusted = ["dsh.example", "192.168.1.3:3080"];
  assert.equal(isTrustedRequest({ host: "localhost:3080" }, trusted), true);
  assert.equal(isTrustedRequest({ host: "127.99.1.2:3080" }, trusted), true);
  assert.equal(isTrustedRequest({ host: "dsh.example:443" }, trusted), true);
  assert.equal(isTrustedRequest({ host: "192.168.1.3:3080" }, trusted), true);
  assert.equal(isTrustedRequest({ host: "192.168.1.3:80" }, trusted), false);
  assert.equal(isTrustedRequest({ host: "untrusted.example" }, trusted), false);
  assert.equal(isTrustedRequest({ host: "dsh.example", "sec-fetch-site": "cross-site" }, trusted), false);
  assert.equal(isTrustedRequest({ host: "dsh.example", origin: "https://evil.example" }, trusted), false);
  assert.equal(isTrustedRequest({ host: "dsh.example", origin: "https://dsh.example" }, trusted), true);
  assert.equal(isTrustedRequest({}, trusted), false);
});

test("Secure 检测读取 Forwarded 或 X-Forwarded-Proto 的首个值", () => {
  assert.equal(isSecureRequest({ forwarded: "for=192.0.2.1; proto=https; host=dsh.example" }), true);
  assert.equal(isSecureRequest({ forwarded: "proto=http", "x-forwarded-proto": "https" }), false);
  assert.equal(isSecureRequest({ "x-forwarded-proto": "https, http" }), true);
  assert.equal(isSecureRequest({ "x-forwarded-proto": "http" }), false);
  assert.equal(isSecureRequest({}), false);
});

test("回跳只接受同站相对路径并避免认证页面循环", () => {
  assert.equal(safeReturnPath("/settings?tab=container#security"), "/settings?tab=container#security");
  for (const value of [undefined, "", "https://evil.example/", "//evil.example/", "/\\evil", LOGIN_PATH, `${LOGIN_PATH}?x=1`, "/bad\npath"]) {
    assert.equal(safeReturnPath(value), "/");
  }
});

test("仅顶层 HTML 导航重定向，API、资源和非 GET 请求保持 401", () => {
  assert.equal(isTopLevelHtmlNavigation({ method: "GET", headers: { accept: "text/html" } }, "/settings"), true);
  assert.equal(isTopLevelHtmlNavigation({ method: "GET", headers: { "sec-fetch-mode": "navigate" } }, "/"), true);
  assert.equal(isTopLevelHtmlNavigation({ method: "GET", headers: { accept: "text/html" } }, "/api/export"), false);
  assert.equal(isTopLevelHtmlNavigation({ method: "GET", headers: { accept: "text/css" } }, "/app.css"), false);
  assert.equal(isTopLevelHtmlNavigation({ method: "POST", headers: { accept: "text/html" } }, "/"), false);
});

test("登录限流允许突发五次失败、每分钟恢复一次、成功重置并限制记录数", () => {
  const limiter = new LoginLimiter({
    refillMilliseconds: 60_000,
    idleMilliseconds: 120_000,
    maxEntries: 2,
  });
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.recordFailure("peer-a", 0).allowed, true);
  }
  assert.deepEqual(limiter.recordFailure("peer-a", 1), { allowed: false, retryAfterSeconds: 60 });
  assert.equal(limiter.recordFailure("peer-a", 60_000).allowed, true);
  assert.equal(limiter.recordFailure("peer-a", 60_001).allowed, false);
  limiter.reset("peer-a");
  assert.equal(limiter.recordFailure("peer-a", 60_002).allowed, true);
  limiter.recordFailure("peer-b", 60_002);
  limiter.recordFailure("peer-c", 60_002);
  assert.equal(limiter.size, 2);
  limiter.recordFailure("peer-d", 200_003);
  assert.equal(limiter.size, 1);
});

test("登录页双语、无障碍、明暗主题、CSP 兼容且不会泄露密钥", () => {
  const chinese = renderLoginPage({
    headers: { "accept-language": "zh-CN,zh;q=0.9" },
    next: "/settings?<unsafe>",
    error: "invalid",
    faviconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
  });
  assert.match(chinese, /<html lang="zh">/u);
  assert.match(chinese, /管理员登录/u);
  assert.match(chinese, /role="alert"/u);
  assert.match(chinese, /prefers-color-scheme:dark/u);
  assert.match(chinese, /autocomplete="current-password"/u);
  assert.match(chinese, /data:image\/svg\+xml;base64/u);
  assert.doesNotMatch(chinese, /<unsafe>/u);
  const english = renderLoginPage({ headers: {}, requestedLanguage: "en", next: "/" });
  assert.match(english, /<html lang="en">/u);
  assert.match(english, /Administrator sign in/u);
  const preferredEnglish = renderLoginPage({
    headers: { "accept-language": "en-US,zh-CN;q=0.9" },
    next: "/",
  });
  assert.match(preferredEnglish, /<html lang="en">/u);
  const disabledChinese = renderLoginPage({
    headers: { "accept-language": "zh-CN;q=0,en;q=0.8" },
    next: "/",
  });
  assert.match(disabledChinese, /<html lang="en">/u);
});

test("代理错误日志只包含受限错误码", () => {
  const error = Object.assign(new Error("secret-key Cookie: dsh_container_session=token"), { code: "ECONNREFUSED" });
  assert.equal(sanitizedProxyError(error), "dsh-container auth relay: upstream proxy error (ECONNREFUSED)");
  assert.equal(sanitizedProxyError({ code: "bad value: secret" }), "dsh-container auth relay: upstream proxy error (UNKNOWN)");
});
