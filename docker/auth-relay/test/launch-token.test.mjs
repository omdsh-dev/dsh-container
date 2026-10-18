import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseLaunchToken, waitForLaunchToken } from "../launch-token.mjs";

const TOKEN = randomBytes(32).toString("base64url");

test("从 dsh web 启动行读取 launch token", () => {
  assert.equal(parseLaunchToken(`dsh web: http://127.0.0.1:3081/?token=${TOKEN}\n`), TOKEN);
  assert.equal(parseLaunchToken(`prefix\ndsh web: http://127.0.0.1:1/?token=${TOKEN}\n`), TOKEN);
});

test("忽略无关、重复与畸形行，并以最后一条为准", () => {
  const later = randomBytes(32).toString("base64url");
  assert.equal(parseLaunchToken("dsh web: opening the default browser\n"), undefined);
  assert.equal(parseLaunchToken(`dsh web: http://127.0.0.1:1/?token=${TOKEN}&token=${TOKEN}\n`), undefined);
  assert.equal(parseLaunchToken("dsh web: not-a-url\n"), undefined);
  assert.equal(parseLaunchToken(`dsh web: http://127.0.0.1:1/?token=short\n`), undefined);
  assert.equal(
    parseLaunchToken(`dsh web: http://127.0.0.1:1/?token=${TOKEN}\ndsh web: http://127.0.0.1:1/?token=${later}\n`),
    later,
  );
});

test("等待启动日志出现", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-container-launch-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const file = join(directory, "dsh-web.log");
  const pending = waitForLaunchToken({ file, timeoutMs: 5_000, intervalMs: 10 });
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  await writeFile(file, `dsh web: http://127.0.0.1:3081/?token=${TOKEN}\n`);
  assert.equal(await pending, TOKEN);
});

test("超时后抛出错误", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-container-launch-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(
    waitForLaunchToken({ file: join(directory, "missing.log"), timeoutMs: 50, intervalMs: 10 }),
    /no "dsh web:" startup line/u,
  );
});
