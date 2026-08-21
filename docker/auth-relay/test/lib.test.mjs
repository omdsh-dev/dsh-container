import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { parseSetCookie } from "cookie";
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
  assert.equal(verifySessionToken("alpha", token), true);
  assert.equal(verifySessionToken("beta", token), false);
  assert.equal(verifySessionToken("alpha", `${token.slice(0, -1)}x`), false);
  assert.equal(verifySessionToken("alpha", `${token}.extra`), false);
  assert.equal(verifySessionToken("alpha", "not-a-token"), false);
});

test("会话 Cookie 长期持久、HttpOnly、SameSite=Lax，并按代理协议设置 Secure", () => {
  const plain = parseSetCookie(sessionCookieHeader("token", false, 0));
  assert.equal(plain.name, "dsh_container_session");
  assert.equal(plain.value, "token");
  assert.equal(plain.httpOnly, true);
  assert.equal(plain.path, "/");
  assert.equal(plain.sameSite, "lax");
  assert.equal(plain.secure, undefined);
  assert.equal(plain.maxAge, 315360000);
  assert.equal(plain.expires?.getTime(), 315360000000);

  const secure = parseSetCookie(sessionCookieHeader("token", true, 0));
  assert.equal(secure.secure, true);

  const cleared = parseSetCookie(clearSessionCookieHeader(true));
  assert.equal(cleared.name, "dsh_container_session");
  assert.equal(cleared.value, "");
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.path, "/");
  assert.equal(cleared.sameSite, "lax");
  assert.equal(cleared.secure, true);
  assert.equal(cleared.maxAge, 0);
  assert.equal(cleared.expires?.getTime(), 0);
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

test("登录页不会原样注入外部 next 与 favicon 输入", () => {
  const page = renderLoginPage({
    headers: {},
    next: '/settings?value="><script id="next-probe"></script>',
    faviconDataUrl: 'data:image/svg+xml,"><script id="favicon-probe"></script>',
  });
  assert.doesNotMatch(page, /<script id="next-probe">/u);
  assert.doesNotMatch(page, /<script id="favicon-probe">/u);
});

test("代理错误日志只包含合法错误码且不泄露异常详情", () => {
  const error = Object.assign(new Error("secret-key Cookie: dsh_container_session=token"), { code: "ECONNREFUSED" });
  const recognized = sanitizedProxyError(error);
  assert.match(recognized, /ECONNREFUSED/u);
  assert.doesNotMatch(recognized, /secret-key|Cookie|dsh_container_session|token/u);

  const malicious = sanitizedProxyError({ code: "bad value: secret", message: "private detail" });
  assert.doesNotMatch(malicious, /bad value|secret|private detail/u);
});
