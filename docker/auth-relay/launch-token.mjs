import { readFile } from "node:fs/promises";

const LOG_LINE = /^dsh web: (\S+)$/u;
const TOKEN_VALUE = /^[A-Za-z0-9_-]{43}$/u;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 200;

function delay(milliseconds) {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

/**
 * Read the launch token out of the startup line `dsh web` prints once its
 * Loader tree settled. The file keeps every line the process wrote, so the last
 * matching line wins; anything else is ignored.
 * @param {string} text - whole contents of the startup log.
 * @returns {string | undefined} the process launch token.
 */
export function parseLaunchToken(text) {
  let token;
  for (const line of text.split(/\r?\n/u)) {
    const match = LOG_LINE.exec(line.trim());
    if (match === null) continue;
    let url;
    try {
      url = new URL(match[1]);
    } catch {
      continue;
    }
    const values = url.searchParams.getAll("token");
    if (values.length === 1 && TOKEN_VALUE.test(values[0])) token = values[0];
  }
  return token;
}

/**
 * Wait until the startup log carries the launch token.
 * @param {object} options - file to read and the waiting budget.
 * @param {string} options.file - startup log path.
 * @param {number} [options.timeoutMs] - how long to keep polling.
 * @param {number} [options.intervalMs] - polling interval.
 * @returns {Promise<string>} the launch token.
 */
export async function waitForLaunchToken({
  file,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      text = undefined;
    }
    const token = text === undefined ? undefined : parseLaunchToken(text);
    if (token !== undefined) return token;
    if (Date.now() >= deadline) {
      throw new Error(`no "dsh web:" startup line with a launch token in ${file}`);
    }
    await delay(intervalMs);
  }
}
