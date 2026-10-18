import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import httpProxy from "http-proxy-3";
import {
  AUTH_REQUIRED_HEADER,
  LOGIN_PATH,
  LOGOUT_PATH,
  LoginLimiter,
  clearSessionCookieHeader,
  createKeyVerifier,
  isSecureRequest,
  isTopLevelHtmlNavigation,
  isTrustedRequest,
  issueSessionToken,
  noStoreHeaders,
  readLoginForm,
  renderLoginPage,
  safeReturnPath,
  sanitizedProxyError,
  sanitizedSessionError,
  sessionCookieHeader,
  sessionFromCookieHeader,
  verifySessionToken,
  withoutDshSessionCookies,
  withoutSessionCookie,
} from "./lib.mjs";

function writeText(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function writeLoginPage(response, status, options, extraHeaders = {}) {
  const body = renderLoginPage(options);
  response.writeHead(status, noStoreHeaders({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extraHeaders,
  }));
  response.end(body);
}

function peerOf(request) {
  return request.socket.remoteAddress ?? "unknown";
}

function validSession(request, key) {
  return verifySessionToken(key, sessionFromCookieHeader(request.headers.cookie));
}

/**
 * Drop the relay's own login cookie and any stale DSH browser-session cookie
 * carried by the client, then attach the pair the relay exchanged for it.
 * @param {import("node:http").IncomingMessage} request - request about to be proxied.
 * @param {string} cookie - DSH browser-session cookie pair.
 */
function applyProxyCookie(request, cookie) {
  const remaining = withoutDshSessionCookies(withoutSessionCookie(request.headers.cookie));
  request.headers.cookie = remaining === undefined ? cookie : `${remaining}; ${cookie}`;
}

async function loadFaviconDataUrl(path) {
  if (path === undefined) return undefined;
  try {
    const bytes = await readFile(path);
    return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function createAuthRelay({
  key,
  trustedHosts,
  listenPort,
  upstreamPort,
  listenHost = "0.0.0.0",
  limiter = new LoginLimiter(),
  logger = console,
  faviconPath,
  session,
}) {
  const authenticationEnabled = key !== undefined;
  const verifyKey = authenticationEnabled ? createKeyVerifier(key) : undefined;
  const faviconDataUrl = authenticationEnabled ? await loadFaviconDataUrl(faviconPath) : undefined;
  const target = `http://127.0.0.1:${upstreamPort}`;
  const proxy = httpProxy.createProxyServer({ target, ws: true, changeOrigin: false, xfwd: false });
  const acceptedSockets = new Set();
  const upstreamWebSockets = new Set();

  proxy.on("open", (socket) => {
    upstreamWebSockets.add(socket);
    socket.once("close", () => { upstreamWebSockets.delete(socket); });
  });

  proxy.on("proxyRes", (proxyResponse, request) => {
    if (proxyResponse.statusCode === 401) session.invalidate(request.headers.host ?? "");
  });

  const proxyHttp = (request, response) => {
    proxy.web(request, response, {}, (error) => {
      logger.error(sanitizedProxyError(error));
      if (!response.headersSent) writeText(response, 502, "bad gateway");
      else response.destroy();
    });
  };

  const server = createServer(async (request, response) => {
    try {
      if (!isTrustedRequest(request.headers, trustedHosts)) {
        writeText(response, 403, "forbidden", noStoreHeaders());
        return;
      }
      let url;
      try {
        url = new URL(request.url ?? "/", "http://dsh-container.invalid");
      } catch {
        writeText(response, 400, "bad request", noStoreHeaders());
        return;
      }
      if (authenticationEnabled && url.pathname === LOGIN_PATH) {
        if (request.method === "GET" || request.method === "HEAD") {
          const options = {
            headers: request.headers,
            requestedLanguage: url.searchParams.get("lang") ?? undefined,
            next: url.searchParams.get("next") ?? "/",
            faviconDataUrl,
          };
          if (request.method === "HEAD") {
            const body = renderLoginPage(options);
            response.writeHead(200, noStoreHeaders({
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": Buffer.byteLength(body),
            }));
            response.end();
          } else {
            writeLoginPage(response, 200, options);
          }
          return;
        }
        if (request.method !== "POST") {
          writeText(response, 405, "method not allowed", noStoreHeaders({ Allow: "GET, HEAD, POST" }));
          return;
        }
        let form;
        try {
          form = await readLoginForm(request);
        } catch (error) {
          writeText(response, error.statusCode ?? 400, error.message, noStoreHeaders());
          return;
        }
        const candidate = form.get("key") ?? "";
        const next = safeReturnPath(form.get("next") ?? "/");
        const requestedLanguage = form.get("lang") ?? undefined;
        const peer = peerOf(request);
        if (verifyKey(candidate)) {
          limiter.reset(peer);
          response.writeHead(303, noStoreHeaders({
            Location: next,
            "Set-Cookie": sessionCookieHeader(issueSessionToken(key), isSecureRequest(request.headers)),
          }));
          response.end();
          return;
        }
        const result = limiter.recordFailure(peer);
        const status = result.allowed ? 401 : 429;
        writeLoginPage(response, status, {
          headers: request.headers,
          requestedLanguage,
          next,
          error: result.allowed ? "invalid" : "limited",
          retryAfterSeconds: result.retryAfterSeconds,
          faviconDataUrl,
        }, {
          [AUTH_REQUIRED_HEADER]: "required",
          ...result.allowed ? {} : { "Retry-After": String(result.retryAfterSeconds) },
        });
        return;
      }
      if (authenticationEnabled && url.pathname === LOGOUT_PATH) {
        if (request.method !== "POST") {
          writeText(response, 405, "method not allowed", noStoreHeaders({ Allow: "POST" }));
          return;
        }
        response.writeHead(204, noStoreHeaders({
          "Set-Cookie": clearSessionCookieHeader(isSecureRequest(request.headers)),
        }));
        response.end();
        return;
      }
      if (authenticationEnabled && !validSession(request, key)) {
        if (isTopLevelHtmlNavigation(request, url.pathname)) {
          const query = new URLSearchParams({ next: safeReturnPath(request.url ?? "/") });
          response.writeHead(303, noStoreHeaders({ Location: `${LOGIN_PATH}?${query}` }));
          response.end();
        } else {
          writeText(response, 401, "authentication required", noStoreHeaders({
            [AUTH_REQUIRED_HEADER]: "required",
          }));
        }
        return;
      }
      let cookie;
      try {
        cookie = await session.cookieFor(request.headers.host ?? "");
      } catch (error) {
        logger.error(sanitizedSessionError(error));
        writeText(response, 503, "DSH session unavailable", noStoreHeaders({ "Retry-After": "2" }));
        return;
      }
      applyProxyCookie(request, cookie);
      proxyHttp(request, response);
    } catch (error) {
      logger.error(sanitizedProxyError(error));
      if (!response.headersSent) writeText(response, 500, "internal server error", noStoreHeaders());
      else response.destroy();
    }
  });
  server.on("connection", (socket) => {
    acceptedSockets.add(socket);
    socket.once("close", () => { acceptedSockets.delete(socket); });
  });

  server.on("upgrade", async (request, socket, head) => {
    if (!isTrustedRequest(request.headers, trustedHosts)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (authenticationEnabled && !validSession(request, key)) {
      socket.end(`HTTP/1.1 401 Unauthorized\r\n${AUTH_REQUIRED_HEADER}: required\r\nConnection: close\r\n\r\n`);
      return;
    }
    try {
      applyProxyCookie(request, await session.cookieFor(request.headers.host ?? ""));
    } catch (error) {
      logger.error(sanitizedSessionError(error));
      socket.end("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 2\r\nConnection: close\r\n\r\n");
      return;
    }
    proxy.ws(request, socket, head, {}, (error) => {
      logger.error(sanitizedProxyError(error));
      if (!socket.destroyed) socket.destroy();
    });
  });

  const close = async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    for (const socket of acceptedSockets) socket.destroy();
    for (const socket of upstreamWebSockets) socket.destroy();
    await closed;
    proxy.close();
  };
  const listen = async () => {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, listenHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return server.address();
  };
  return { server, proxy, listen, close };
}
