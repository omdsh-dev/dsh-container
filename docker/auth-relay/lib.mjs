import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Buffer } from "node:buffer";
import * as cookie from "cookie";

export const AUTH_BASE_PATH = "/_dsh-container/auth";
export const LOGIN_PATH = `${AUTH_BASE_PATH}/login`;
export const LOGOUT_PATH = `${AUTH_BASE_PATH}/logout`;
export const SESSION_COOKIE = "dsh_container_session";
export const AUTH_REQUIRED_HEADER = "X-DSH-Container-Auth";
/** Prefix of the DSH Host browser-session cookies the relay completes on behalf of its clients. */
export const DSH_SESSION_COOKIE_PREFIX = "dsh-auth-";

const MAX_KEY_BYTES = 4096;
const SESSION_NONCE_BYTES = 32;
const SESSION_DOMAIN = "dsh-container-session-v1\0";
const LOGIN_BODY_LIMIT = 16 * 1024;
const COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Security validation intentionally rejects C0/C1 controls.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u;

function hasOwn(object, key) {
  return Object.hasOwn(object, key);
}

export function readAuthenticationKey(environment) {
  if (!hasOwn(environment, "DSH_CONTAINER_KEY")
    || environment.DSH_CONTAINER_KEY === undefined) {
    return { enabled: false };
  }
  const key = environment.DSH_CONTAINER_KEY;
  if (key.trim().length === 0) {
    throw new Error("DSH_CONTAINER_KEY must not be empty or whitespace-only");
  }
  if (CONTROL_CHARACTER.test(key)) {
    throw new Error("DSH_CONTAINER_KEY must not contain control characters");
  }
  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw new Error(`DSH_CONTAINER_KEY must not exceed ${MAX_KEY_BYTES} UTF-8 bytes`);
  }
  return { enabled: true, key };
}

export function parsePort(value, name) {
  if (!/^[0-9]{1,5}$/u.test(value)) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

function digestCandidate(candidate, salt) {
  return createHmac("sha256", salt).update(candidate, "utf8").digest();
}

export function createKeyVerifier(key, salt = randomBytes(32)) {
  const expected = digestCandidate(key, salt);
  return (candidate) => timingSafeEqual(expected, digestCandidate(candidate, salt));
}

function sessionSignature(key, nonce) {
  return createHmac("sha256", key)
    .update(SESSION_DOMAIN, "utf8")
    .update(nonce)
    .digest();
}

export function issueSessionToken(key, nonce = randomBytes(SESSION_NONCE_BYTES)) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== SESSION_NONCE_BYTES) {
    throw new Error(`session nonce must be ${SESSION_NONCE_BYTES} bytes`);
  }
  return `${nonce.toString("base64url")}.${sessionSignature(key, nonce).toString("base64url")}`;
}

export function verifySessionToken(key, token) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2
    || !BASE64URL_32_BYTES.test(parts[0])
    || !BASE64URL_32_BYTES.test(parts[1])) return false;
  const nonce = Buffer.from(parts[0], "base64url");
  const actual = Buffer.from(parts[1], "base64url");
  const expected = sessionSignature(key, nonce);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sessionCookieHeader(token, secure, now = Date.now()) {
  return cookie.stringifySetCookie({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    expires: new Date(now + COOKIE_MAX_AGE_SECONDS * 1000),
  });
}

export function clearSessionCookieHeader(secure) {
  return cookie.stringifySetCookie({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
    maxAge: 0,
    expires: new Date(0),
  });
}

export function sessionFromCookieHeader(header) {
  if (typeof header !== "string") return undefined;
  try {
    return cookie.parseCookie(header)[SESSION_COOKIE];
  } catch {
    return undefined;
  }
}

function withoutCookieWhere(header, excluded) {
  if (typeof header !== "string") return undefined;
  const filtered = header.split(";").filter((part) => {
    const separator = part.indexOf("=");
    return separator === -1 || !excluded(part.slice(0, separator).trim());
  });
  const value = filtered.join(";").trim();
  return value.length === 0 ? undefined : value;
}

export function withoutSessionCookie(header) {
  return withoutCookieWhere(header, (name) => name === SESSION_COOKIE);
}

export function withoutDshSessionCookies(header) {
  return withoutCookieWhere(header, (name) => name.startsWith(DSH_SESSION_COOKIE_PREFIX));
}

function headerValue(headers, name) {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function canonicalAuthority(entry, parsed) {
  const port = parsed.port !== "" ? parsed.port : new URL(`https://${entry}`).port;
  return port === "" ? parsed.hostname : `${parsed.hostname}:${port}`;
}

export function assertTrustedAuthority(entry) {
  const parsed = parseAuthority(entry);
  if (parsed !== undefined && canonicalAuthority(entry, parsed) === entry.toLowerCase()) return;
  throw new Error(`invalid trusted host authority ${JSON.stringify(entry)}`);
}

export function parseTrustedHosts(value) {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("DSH_CONTAINER_TRUSTED_HOSTS must not be empty");
  for (const entry of entries) assertTrustedAuthority(entry);
  return entries;
}

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4
    && parts[0] === "127"
    && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

function isTrustedAuthority(host, trustedHosts) {
  return trustedHosts.some((entry) => {
    const parsed = parseAuthority(entry);
    if (parsed === undefined) return false;
    return canonicalAuthority(entry, parsed) === parsed.hostname
      ? parsed.hostname === host.hostname
      : parsed.host === host.host;
  });
}

export function isTrustedRequest(headers, trustedHosts) {
  const hostHeader = headerValue(headers, "host");
  if (hostHeader === undefined) return false;
  const host = parseAuthority(hostHeader);
  if (host === undefined
    || (!isLoopbackHostname(host.hostname) && !isTrustedAuthority(host, trustedHosts))) return false;
  if (headerValue(headers, "sec-fetch-site") === "cross-site") return false;
  const origin = headerValue(headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host.host;
  } catch {
    return false;
  }
}

export function isSecureRequest(headers) {
  const forwarded = headerValue(headers, "forwarded");
  if (forwarded !== undefined) {
    const first = forwarded.split(",", 1)[0];
    for (const field of first.split(";")) {
      const match = /^\s*proto\s*=\s*"?([^"\s;]+)"?\s*$/iu.exec(field);
      if (match !== null) return match[1].toLowerCase() === "https";
    }
  }
  const forwardedProto = headerValue(headers, "x-forwarded-proto");
  return forwardedProto?.split(",", 1)[0].trim().toLowerCase() === "https";
}

export function safeReturnPath(value) {
  if (typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || CONTROL_CHARACTER.test(value)) return "/";
  try {
    const parsed = new URL(value, "http://dsh-container.invalid");
    if (parsed.origin !== "http://dsh-container.invalid"
      || parsed.pathname === LOGIN_PATH
      || parsed.pathname === LOGOUT_PATH) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function preferredLanguage(headers, requested) {
  if (requested === "zh" || requested === "en") return requested;
  const preferences = (headerValue(headers, "accept-language") ?? "")
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) => /^\s*q=/iu.test(parameter));
      const quality = qualityParameter === undefined
        ? 1
        : Number(qualityParameter.slice(qualityParameter.indexOf("=") + 1));
      return { tag: tag.toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(({ quality }) => quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);
  for (const { tag } of preferences) {
    if (tag === "zh" || tag.startsWith("zh-")) return "zh";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderLoginPage({
  headers,
  requestedLanguage,
  next,
  error,
  retryAfterSeconds,
  faviconDataUrl,
}) {
  const language = preferredLanguage(headers, requestedLanguage);
  const zh = language === "zh";
  const copy = zh ? {
    title: "管理员登录",
    subtitle: "输入此容器的管理员密钥",
    key: "管理员密钥",
    placeholder: "输入密钥",
    submit: "登录",
    invalid: "密钥不正确，请重试。",
    limited: `尝试次数过多，请在 ${retryAfterSeconds} 秒后重试。`,
    language: "English",
  } : {
    title: "Administrator sign in",
    subtitle: "Enter the administrator key for this container",
    key: "Administrator key",
    placeholder: "Enter key",
    submit: "Sign in",
    invalid: "The key is incorrect. Try again.",
    limited: `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
    language: "简体中文",
  };
  const targetLanguage = zh ? "en" : "zh";
  const safeNext = safeReturnPath(next);
  const query = new URLSearchParams({ lang: targetLanguage, next: safeNext });
  const errorText = error === "limited" ? copy.limited : error === "invalid" ? copy.invalid : undefined;
  const favicon = typeof faviconDataUrl === "string" && faviconDataUrl.startsWith("data:image/")
    ? `<link rel="icon" href="${escapeHtml(faviconDataUrl)}">`
    : "";
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${copy.title} | DSH Container</title>
${favicon}
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f6f7;color:#18191b}
*{box-sizing:border-box}body{min-width:280px;min-height:100vh;margin:0;background:#f5f6f7}main{min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(100%,380px)}.brand{display:flex;align-items:center;gap:10px;margin:0 0 28px;font-size:15px;font-weight:650;color:#242629}.mark{width:26px;height:26px;border-radius:6px;background:#18191b;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:750}.panel{padding:28px;border:1px solid #d9dcdf;border-radius:8px;background:#fff;box-shadow:0 8px 24px rgba(22,25,29,.06)}h1{margin:0;font-size:22px;line-height:30px;letter-spacing:0}p{margin:7px 0 24px;color:#62676d;font-size:14px;line-height:21px}label{display:block;margin:0 0 7px;font-size:13px;font-weight:600}input{width:100%;height:42px;padding:0 12px;border:1px solid #b8bdc3;border-radius:6px;background:#fff;color:#18191b;font:inherit;outline:none}input:focus{border-color:#1677d2;box-shadow:0 0 0 3px rgba(22,119,210,.15)}button{width:100%;height:42px;margin-top:14px;border:0;border-radius:6px;background:#1677d2;color:#fff;font:600 14px/1 inherit;cursor:pointer}button:hover{background:#1268b9}button:focus-visible,a:focus-visible{outline:3px solid rgba(22,119,210,.35);outline-offset:2px}.error{margin:12px 0 0;color:#bf3030;font-size:13px;line-height:20px}.footer{display:flex;justify-content:flex-end;margin-top:14px}.footer a{color:#4f5963;font-size:13px;text-decoration:none}.footer a:hover{text-decoration:underline}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(prefers-color-scheme:dark){:root,body{background:#111315;color:#f2f3f4}.brand{color:#eceeef}.mark{background:#f0f2f4;color:#111315}.panel{border-color:#34383d;background:#1b1e21;box-shadow:none}p,.footer a{color:#aeb4ba}input{border-color:#4b5158;background:#141719;color:#f2f3f4}input:focus{border-color:#5aaaf1;box-shadow:0 0 0 3px rgba(90,170,241,.18)}button{background:#318bdc}button:hover{background:#4a9ae2}.error{color:#ff8585}}
@media(max-width:440px){main{align-items:start;padding:20px 16px}.shell{margin-top:min(18vh,96px)}.brand{margin-bottom:20px}.panel{padding:22px 18px}h1{font-size:20px;line-height:28px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style>
</head>
<body>
<main><div class="shell">
<div class="brand"><span class="mark" aria-hidden="true">DSH</span><span>DSH Container</span></div>
<section class="panel" aria-labelledby="login-title">
<h1 id="login-title">${copy.title}</h1><p>${copy.subtitle}</p>
<form method="post" action="${LOGIN_PATH}">
<input type="hidden" name="next" value="${escapeHtml(safeNext)}">
<input type="hidden" name="lang" value="${language}">
<input class="sr-only" type="text" name="username" value="administrator" autocomplete="username" tabindex="-1" aria-hidden="true">
<label for="key">${copy.key}</label>
<input id="key" name="key" type="password" maxlength="4096" autocomplete="current-password" placeholder="${copy.placeholder}" required autofocus>
<button type="submit">${copy.submit}</button>
${errorText === undefined ? "" : `<div class="error" role="alert">${escapeHtml(errorText)}</div>`}
</form>
</section>
<div class="footer"><a href="${LOGIN_PATH}?${escapeHtml(query.toString())}" hreflang="${targetLanguage}">${copy.language}</a></div>
</div></main>
</body>
</html>`;
}

export class LoginLimiter {
  constructor({ capacity = 5, refillMilliseconds = 60_000, idleMilliseconds = 15 * 60_000, maxEntries = 2048 } = {}) {
    this.capacity = capacity;
    this.refillMilliseconds = refillMilliseconds;
    this.idleMilliseconds = idleMilliseconds;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  cleanup(now, peer) {
    for (const [peer, entry] of this.entries) {
      if (now - entry.lastSeen >= this.idleMilliseconds) this.entries.delete(peer);
    }
    while (!this.entries.has(peer) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  recordFailure(peer, now = Date.now()) {
    this.cleanup(now, peer);
    const previous = this.entries.get(peer);
    const elapsed = previous === undefined ? 0 : Math.max(0, now - previous.refilledAt);
    const recovered = previous === undefined ? 0 : Math.floor(elapsed / this.refillMilliseconds);
    const available = previous === undefined
      ? this.capacity
      : Math.min(this.capacity, previous.tokens + recovered);
    const refilledAt = previous === undefined
      ? now
      : previous.refilledAt + recovered * this.refillMilliseconds;
    this.entries.delete(peer);
    if (available <= 0) {
      this.entries.set(peer, { tokens: 0, refilledAt, lastSeen: now });
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((this.refillMilliseconds - (now - refilledAt)) / 1000)),
      };
    }
    this.entries.set(peer, { tokens: available - 1, refilledAt, lastSeen: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(peer) {
    this.entries.delete(peer);
  }

  get size() {
    return this.entries.size;
  }
}

export function isTopLevelHtmlNavigation(request, pathname) {
  if (pathname.startsWith("/api") || (request.method !== "GET" && request.method !== "HEAD")) return false;
  const accept = headerValue(request.headers, "accept") ?? "";
  return headerValue(request.headers, "sec-fetch-mode") === "navigate"
    || headerValue(request.headers, "sec-fetch-dest") === "document"
    || accept.toLowerCase().includes("text/html");
}

export async function readLoginForm(request) {
  const contentType = headerValue(request.headers, "content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    const error = new Error("unsupported login content type");
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > LOGIN_BODY_LIMIT) {
      const error = new Error("login form is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function noStoreHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    ...extra,
  };
}

export function sanitizedProxyError(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
    ? error.code
    : "UNKNOWN";
  return `dsh-container auth relay: upstream proxy error (${code})`;
}

export function sanitizedSessionError(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
    ? error.code
    : "UNKNOWN";
  return `dsh-container auth relay: DSH browser-session exchange failed (${code})`;
}
