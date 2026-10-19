import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublicUrl } from "../lib.mjs";

test("公开地址只接受站点根并规范化为尾斜杠", () => {
  assert.equal(parsePublicUrl("https://dsh.example.com"), "https://dsh.example.com/");
  assert.equal(parsePublicUrl("HTTP://192.168.1.100:3080"), "http://192.168.1.100:3080/");
  assert.equal(parsePublicUrl("https://[::1]:8443/"), "https://[::1]:8443/");
  assert.equal(parsePublicUrl("https://dsh.example.com:443"), "https://dsh.example.com/");
});

test("公开地址拒绝挂载前缀、凭据、查询、片段、空白和非 http(s)", () => {
  for (const value of [
    "https://dsh.example.com/ui/",
    "https://dsh.example.com/ui",
    "https://user@dsh.example.com/",
    "https://dsh.example.com/?a=1",
    "https://dsh.example.com/#x",
    "https://dsh.example.com/ path",
    "https:///ui",
    "https://dsh.example.com:99999/",
    "ftp://dsh.example.com/",
    "dsh.example.com",
    "",
  ]) {
    assert.throws(() => parsePublicUrl(value), /must/u, value);
  }
});
