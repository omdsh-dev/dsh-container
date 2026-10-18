import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import { parseSetCookie } from "cookie";
import {
  AUTH_REQUIRED_HEADER,
  LOGIN_PATH,
  LOGOUT_PATH,
  LoginLimiter,
  issueSessionToken,
} from "../lib.mjs";
import { createAuthRelay } from "../server.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function request(port, { path = "/", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = import("node:http").then(({ request: httpRequest }) => {
      const outgoing = httpRequest({
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      outgoing.on("error", reject);
      if (body !== undefined) outgoing.write(body);
      outgoing.end();
    });
    request.catch(reject);
  });
}

function websocketHandshake(port, cookie, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks = [];
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const response = Buffer.concat(chunks).toString("latin1");
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([
        "GET /api/events.mux HTTP/1.1",
        `Host: ${host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${key}`,
        ...cookie === undefined ? [] : [`Cookie: ${cookie}`],
        "",
        "",
      ].join("\r\n"));
    });
  });
}

async function fixture(t, { key: keyOption = "test-only-key", respond, session: sessionOptions = {} } = {}) {
  const key = keyOption === null ? undefined : keyOption;
  const seen = [];
  const upstream = createServer((request, response) => {
    let bytes = 0;
    request.on("data", (chunk) => { bytes += chunk.length; });
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        host: request.headers.host,
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        bytes,
      });
      if (respond !== undefined) {
        respond(request, response);
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(seen.at(-1)));
    });
  });
  upstream.on("upgrade", (request, socket) => {
    seen.push({ upgrade: true, host: request.headers.host, cookie: request.headers.cookie });
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Connection: Upgrade",
      "Upgrade: websocket",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    socket.on("end", () => { socket.destroy(); });
  });
  const upstreamPort = await listen(upstream);
  const logs = [];
  const invalidations = [];
  const session = {
    async cookieFor() {
      if (sessionOptions.fail === true) throw new Error("no launch token");
      return sessionOptions.cookie ?? "dsh-auth-test=session";
    },
    invalidate(authority) { invalidations.push(authority); },
  };
  const relay = await createAuthRelay({
    key,
    trustedHosts: ["dsh.example"],
    listenPort: 0,
    upstreamPort,
    listenHost: "127.0.0.1",
    limiter: new LoginLimiter({ capacity: 1 }),
    logger: { error: (message) => logs.push(message) },
    session,
  });
  const relayPort = (await relay.listen()).port;
  t.after(async () => {
    await relay.close();
    await close(upstream);
  });
  return { invalidations, key, logs, relay, relayPort, seen, upstream };
}

test("匿名导航重定向，而 API、静态资源和 WebSocket 返回带标记的 401", async (t) => {
  const { relayPort } = await fixture(t);
  const navigation = await request(relayPort, { headers: { accept: "text/html" }, path: "/settings?tab=x" });
  assert.equal(navigation.status, 303);
  assert.equal(navigation.headers.location, `${LOGIN_PATH}?next=%2Fsettings%3Ftab%3Dx`);

  for (const path of ["/api/agentPreset.list", "/assets/app.js"]) {
    const response = await request(relayPort, { path });
    assert.equal(response.status, 401);
    assert.equal(response.headers[AUTH_REQUIRED_HEADER.toLowerCase()], "required");
    assert.equal(response.headers["cache-control"], "no-store");
  }
  const upgrade = await websocketHandshake(relayPort);
  assert.match(upgrade, /^HTTP\/1\.1 401 Unauthorized/mu);
  assert.match(upgrade, new RegExp(`${AUTH_REQUIRED_HEADER}: required`, "u"));
});

test("不可信 Host 和跨站请求在有效 Cookie 前仍返回 403", async (t) => {
  const { key, relayPort } = await fixture(t);
  const cookie = `dsh_container_session=${issueSessionToken(key)}`;
  const badHost = await request(relayPort, { headers: { host: "untrusted.invalid", cookie } });
  assert.equal(badHost.status, 403);
  const badOrigin = await request(relayPort, {
    headers: { host: "dsh.example", origin: "https://evil.example", cookie },
  });
  assert.equal(badOrigin.status, 403);
  const upgrade = await websocketHandshake(relayPort, cookie, "untrusted.invalid");
  assert.match(upgrade, /^HTTP\/1\.1 403 Forbidden/mu);
});

test("登录按实际 TCP 对端限流，成功后签发 Cookie、回跳并重置限流", async (t) => {
  const { relayPort } = await fixture(t);
  const page = await request(relayPort, {
    path: `${LOGIN_PATH}?lang=zh&next=%2Fsettings`,
  });
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /default-src 'none'/u);
  assert.equal(page.headers["referrer-policy"], "same-origin");

  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
  const failed = await request(relayPort, {
    path: LOGIN_PATH,
    method: "POST",
    headers: formHeaders,
    body: "key=wrong&next=%2Fsettings&lang=en",
  });
  assert.equal(failed.status, 401);
  assert.equal(failed.headers[AUTH_REQUIRED_HEADER.toLowerCase()], "required");

  const limited = await request(relayPort, {
    path: LOGIN_PATH,
    method: "POST",
    headers: formHeaders,
    body: "key=wrong-again&next=%2Fsettings&lang=en",
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");

  const success = await request(relayPort, {
    path: LOGIN_PATH,
    method: "POST",
    headers: { ...formHeaders, forwarded: "for=192.0.2.1;proto=https" },
    body: "key=test-only-key&next=%2Fsettings%3Ftab%3Dcontainer&lang=en",
  });
  assert.equal(success.status, 303);
  assert.equal(success.headers.location, "/settings?tab=container");
  const sessionCookie = parseSetCookie(success.headers["set-cookie"][0]);
  assert.equal(sessionCookie.httpOnly, true);
  assert.equal(sessionCookie.secure, true);

  const failedAfterReset = await request(relayPort, {
    path: LOGIN_PATH,
    method: "POST",
    headers: formHeaders,
    body: "key=wrong&lang=en",
  });
  assert.equal(failedAfterReset.status, 401);
});

test("认证 HTTP 保留 Host/Origin、完整转发请求体，并替换为 relay 换取的 DSH Cookie", async (t) => {
  const { key, relayPort, seen } = await fixture(t);
  const payload = "deterministic upload body";
  const response = await request(relayPort, {
    path: "/api/upload",
    method: "POST",
    headers: {
      host: "dsh.example",
      origin: "http://dsh.example",
      cookie: `theme=dark; dsh_container_session=${issueSessionToken(key)}; dsh-auth-stale=old; other=value`,
      "content-type": "application/octet-stream",
      "content-length": String(Buffer.byteLength(payload)),
    },
    body: payload,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(seen.at(-1), {
    method: "POST",
    url: "/api/upload",
    host: "dsh.example",
    origin: "http://dsh.example",
    cookie: "theme=dark; other=value; dsh-auth-test=session",
    bytes: Buffer.byteLength(payload),
  });
});

test("认证 WebSocket 透传 Upgrade 并携带 relay 换取的 DSH Cookie", async (t) => {
  const { key, relayPort, seen } = await fixture(t);
  const header = await websocketHandshake(
    relayPort,
    `theme=dark; dsh_container_session=${issueSessionToken(key)}`,
    "dsh.example",
  );
  assert.match(header, /^HTTP\/1\.1 101 Switching Protocols/mu);
  assert.deepEqual(seen.at(-1), {
    upgrade: true,
    host: "dsh.example",
    cookie: "theme=dark; dsh-auth-test=session",
  });
});

test("未启用管理员密钥时仍转发并注入 DSH 会话 Cookie", async (t) => {
  const { relayPort, seen } = await fixture(t, { key: null });
  const response = await request(relayPort, {
    path: "/api/agentPresets/list",
    method: "POST",
    headers: { host: "dsh.example", cookie: "theme=dark; dsh-auth-stale=old" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(seen.at(-1).cookie, "theme=dark; dsh-auth-test=session");

  const login = await request(relayPort, { path: LOGIN_PATH, headers: { host: "dsh.example" } });
  assert.equal(login.body, JSON.stringify(seen.at(-1)));

  const untrusted = await request(relayPort, { headers: { host: "untrusted.invalid" } });
  assert.equal(untrusted.status, 403);
});

test("DSH 会话不可用时返回 503 并提示重试", async (t) => {
  const { key, relayPort } = await fixture(t, { session: { fail: true } });
  const cookie = `dsh_container_session=${issueSessionToken(key)}`;
  const response = await request(relayPort, { headers: { cookie } });
  assert.equal(response.status, 503);
  assert.equal(response.headers["retry-after"], "2");
  const upgrade = await websocketHandshake(relayPort, cookie, "dsh.example");
  assert.match(upgrade, /^HTTP\/1\.1 503 Service Unavailable/mu);
});

test("上游 401 使该 authority 的 DSH 会话缓存失效", async (t) => {
  const { invalidations, key, relayPort } = await fixture(t, {
    respond: (_request, response) => {
      response.writeHead(401);
      response.end("unauthorized");
    },
  });
  const response = await request(relayPort, {
    headers: { host: "dsh.example", cookie: `dsh_container_session=${issueSessionToken(key)}` },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(invalidations, ["dsh.example"]);
});

test("退出只清除当前 Cookie，旧令牌仍可重放直至轮换密钥", async (t) => {
  const { key, relayPort } = await fixture(t);
  const token = issueSessionToken(key);
  const logout = await request(relayPort, {
    path: LOGOUT_PATH,
    method: "POST",
    headers: { cookie: `dsh_container_session=${token}` },
  });
  assert.equal(logout.status, 204);
  const clearedCookie = parseSetCookie(logout.headers["set-cookie"][0]);
  assert.equal(clearedCookie.maxAge, 0);
  const replay = await request(relayPort, {
    headers: { cookie: `dsh_container_session=${token}` },
  });
  assert.equal(replay.status, 200);
});

test("上游失败返回 502，日志不包含密钥、Cookie 或请求头", async (t) => {
  const fixtureValue = await fixture(t);
  const { key, logs, relayPort, upstream } = fixtureValue;
  await close(upstream);
  const response = await request(relayPort, {
    headers: {
      cookie: `private=value; dsh_container_session=${issueSessionToken(key)}`,
      "x-secret": key,
    },
  });
  assert.equal(response.status, 502);
  assert.ok(logs.length > 0);
  const logText = logs.join("\n");
  assert.match(logText, /upstream proxy error/u);
  assert.doesNotMatch(logText, /test-only-key|private|dsh_container_session/u);
});
