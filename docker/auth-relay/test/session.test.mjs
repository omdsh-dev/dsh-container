import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHostSession, parseDshSessionCookie } from "../session.mjs";

const TOKEN = randomBytes(32).toString("base64url");

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

function sessionCookie(authority, value) {
  return `dsh-auth-${Buffer.from(authority).toString("base64url").slice(0, 8)}=${value}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict`;
}

function startupLog(text) {
  return `dsh-container auth relay: starting\n${text}\n`;
}

async function fixture(t, { handler } = {}) {
  const exchanges = [];
  const upstream = createServer((request, response) => {
    exchanges.push({ host: request.headers.host, url: request.url });
    if (handler !== undefined) {
      handler(request, response);
      return;
    }
    if (request.url === `/?token=${encodeURIComponent(TOKEN)}`) {
      response.writeHead(303, {
        "cache-control": "no-store",
        location: "./",
        "set-cookie": sessionCookie(request.headers.host, randomBytes(8).toString("base64url")),
      });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const upstreamPort = await listen(upstream);
  const directory = await mkdtemp(join(tmpdir(), "dsh-container-session-"));
  t.after(async () => {
    await close(upstream);
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, exchanges, upstreamPort };
}

test("只保留 DSH 的浏览器会话 Cookie 并记录其截止时间", () => {
  const now = 1_000_000;
  const parsed = parseDshSessionCookie([
    "theme=dark; Path=/",
    "dsh-auth-abc=value; Path=/; Max-Age=60; HttpOnly; SameSite=Strict",
  ], now);
  assert.deepEqual(parsed, { cookie: "dsh-auth-abc=value", expiresAt: now + 60_000 });

  assert.equal(parseDshSessionCookie(["theme=dark; Path=/"], now), undefined);
  assert.equal(parseDshSessionCookie(undefined, now), undefined);
  assert.deepEqual(
    parseDshSessionCookie(["dsh-auth-a=1; Path=/", "dsh-auth-b=2; Path=/"], now).cookie,
    "dsh-auth-a=1; dsh-auth-b=2",
  );
});

test("按 authority 换取一次 DSH 会话 Cookie 并保持缓存", async (t) => {
  const { directory, exchanges, upstreamPort } = await fixture(t);
  const log = join(directory, "startup.log");
  await writeFile(log, startupLog(`dsh web: http://127.0.0.1:1/?token=${TOKEN}`));
  const session = createHostSession({ upstreamPort, startupLog: log });

  const first = await session.cookieFor("dsh.example");
  const second = await session.cookieFor("dsh.example");
  assert.equal(first, second);
  assert.deepEqual(exchanges, [{ host: "dsh.example", url: `/?token=${TOKEN}` }]);
  assert.match(first, /^dsh-auth-/u);

  const other = await session.cookieFor("other.example");
  assert.notEqual(other, first);
  assert.equal(exchanges.length, 2);
});

test("invalidate 后重新换取", async (t) => {
  const { directory, exchanges, upstreamPort } = await fixture(t);
  const log = join(directory, "startup.log");
  await writeFile(log, startupLog(`dsh web: http://127.0.0.1:1/?token=${TOKEN}`));
  const session = createHostSession({ upstreamPort, startupLog: log });

  await session.cookieFor("dsh.example");
  session.invalidate("dsh.example");
  await session.cookieFor("dsh.example");
  assert.equal(exchanges.length, 2);
});

test("换取失败或缺少启动行时抛出错误", async (t) => {
  const rejecting = await fixture(t, {
    handler: (_request, response) => {
      response.writeHead(303, { location: "./" });
      response.end();
    },
  });
  const log = join(rejecting.directory, "startup.log");
  await writeFile(log, startupLog(`dsh web: http://127.0.0.1:1/?token=${TOKEN}`));
  await assert.rejects(
    createHostSession({ upstreamPort: rejecting.upstreamPort, startupLog: log }).cookieFor("dsh.example"),
    /set no browser-session cookie/u,
  );

  const unavailable = await fixture(t);
  await assert.rejects(
    createHostSession({
      upstreamPort: unavailable.upstreamPort,
      startupLog: join(unavailable.directory, "missing.log"),
      tokenTimeoutMs: 50,
    }).cookieFor("dsh.example"),
    /no "dsh web:" startup line/u,
  );
});

test("等待启动行出现后再完成握手", async (t) => {
  const { directory, upstreamPort } = await fixture(t);
  const log = join(directory, "startup.log");
  await writeFile(log, startupLog("starting"));
  const session = createHostSession({ upstreamPort, startupLog: log });
  const pending = session.cookieFor("dsh.example");
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  await writeFile(log, startupLog(`dsh web: http://127.0.0.1:1/?token=${TOKEN}`));
  assert.match(await pending, /^dsh-auth-/u);
});

test("ready 在启动行出现前保持等待", async (t) => {
  const { directory, upstreamPort } = await fixture(t);
  const log = join(directory, "startup.log");
  await writeFile(log, startupLog("starting"));
  const session = createHostSession({ upstreamPort, startupLog: log, tokenTimeoutMs: 5_000 });
  let settled = false;
  const pending = session.ready().then(() => { settled = true; });
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  assert.equal(settled, false);
  await writeFile(log, startupLog(`dsh web: http://127.0.0.1:1/?token=${TOKEN}`));
  await pending;
  assert.equal(settled, true);
});
