import { request as httpRequest } from "node:http";
import { DSH_SESSION_COOKIE_PREFIX } from "./lib.mjs";
import { waitForLaunchToken } from "./launch-token.mjs";

const MINT_TIMEOUT_MS = 5_000;
const TOKEN_TIMEOUT_MS = 60_000;
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
const FALLBACK_LIFETIME_MS = 60 * 60 * 1000;
const MAX_AUTHORITIES = 64;

/**
 * Keep exactly the browser-session cookie pairs the DSH Host set.
 * @param {string[] | undefined} setCookie - raw `set-cookie` header values.
 * @param {number} now - current epoch milliseconds.
 * @returns {{ cookie: string, expiresAt: number } | undefined} the injected pair and its deadline.
 */
export function parseDshSessionCookie(setCookie, now = Date.now()) {
  if (!Array.isArray(setCookie)) return undefined;
  const pairs = [];
  let expiresAt = 0;
  for (const raw of setCookie) {
    const [pair] = raw.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    if (!name.startsWith(DSH_SESSION_COOKIE_PREFIX)) continue;
    pairs.push(pair.trim());
    const attributes = raw.slice(pair.length).toLowerCase();
    const maxAge = /;\s*max-age=(\d+)/u.exec(attributes);
    const expires = /;\s*expires=([^;]+)/u.exec(attributes);
    const deadline = maxAge === null
      ? expires === null ? now + FALLBACK_LIFETIME_MS : Date.parse(expires[1])
      : now + Number(maxAge[1]) * 1000;
    if (Number.isFinite(deadline) && deadline > expiresAt) expiresAt = deadline;
  }
  if (pairs.length === 0) return undefined;
  return { cookie: pairs.join("; "), expiresAt };
}

function mintSession({ upstreamPort, token, authority, timeoutMs, now }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: upstreamPort,
      method: "GET",
      path: `/?token=${encodeURIComponent(token)}`,
      headers: { accept: "text/html", host: authority },
      timeout: timeoutMs,
    }, (response) => {
      response.resume();
      if (response.statusCode !== 303) {
        reject(new Error(`DSH launch-token exchange answered ${response.statusCode}`));
        return;
      }
      const session = parseDshSessionCookie(response.headers["set-cookie"], now);
      if (session === undefined) {
        reject(new Error("DSH launch-token exchange set no browser-session cookie"));
        return;
      }
      resolve(session);
    });
    request.on("timeout", () => {
      request.destroy(new Error("DSH launch-token exchange timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Complete the DSH browser-session handshake on behalf of container clients:
 * exchange the process launch token for one signed cookie per request
 * authority and keep it until shortly before it expires.
 * @param {object} options - upstream address, startup log, and timing budget.
 * @param {number} options.upstreamPort - DSH listener the relay forwards to.
 * @param {string} options.startupLog - file carrying the `dsh web:` line.
 * @param {() => number} [options.now] - clock, injectable for tests.
 * @param {number} [options.tokenTimeoutMs] - how long to wait for the token.
 * @param {number} [options.mintTimeoutMs] - per-exchange timeout.
 * @returns {{ cookieFor(authority: string): Promise<string>, invalidate(authority: string): void, ready(): Promise<void> }} the broker.
 */
export function createHostSession({
  upstreamPort,
  startupLog,
  now = Date.now,
  tokenTimeoutMs,
  mintTimeoutMs = MINT_TIMEOUT_MS,
}) {
  const cache = new Map();
  let token;
  const discovery = waitForLaunchToken({
    file: startupLog,
    timeoutMs: tokenTimeoutMs ?? TOKEN_TIMEOUT_MS,
  }).then((value) => { token = value; });

  /** Wait until the startup line hands the relay its launch token. */
  async function ready() {
    await discovery;
  }

  async function cookieFor(authority) {
    const current = now();
    const cached = cache.get(authority);
    if (cached !== undefined && cached.expiresAt - REFRESH_MARGIN_MS > current) {
      cache.delete(authority);
      cache.set(authority, cached);
      return cached.cookie;
    }
    await discovery;
    const session = await mintSession({
      upstreamPort,
      token,
      authority,
      timeoutMs: mintTimeoutMs,
      now: current,
    });
    if (cache.size >= MAX_AUTHORITIES) cache.delete(cache.keys().next().value);
    cache.set(authority, session);
    return session.cookie;
  }

  function invalidate(authority) {
    cache.delete(authority);
  }

  return { cookieFor, invalidate, ready };
}
