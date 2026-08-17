const internalPort = process.env.DSH_CONTAINER_INTERNAL_PORT ?? "3081";
const relayPort = process.env.DSH_CONTAINER_RELAY_PORT ?? "3080";
const authenticationEnabled = Object.hasOwn(process.env, "DSH_CONTAINER_KEY");

async function probe(url, options) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(4000),
    ...options,
  });
  return response;
}

try {
  const internal = await probe(`http://127.0.0.1:${internalPort}/`);
  if (!internal.ok) throw new Error("internal DSH probe failed");

  const external = await probe(`http://127.0.0.1:${relayPort}/`, {
    headers: { Accept: "text/html", Host: "127.0.0.1" },
  });
  if (authenticationEnabled) {
    if (external.status !== 303
      || !external.headers.get("location")?.startsWith("/_dsh-container/auth/login?")) {
      throw new Error("authenticated relay probe failed");
    }
  } else if (!external.ok) {
    throw new Error("relay probe failed");
  }
} catch {
  process.exitCode = 1;
}
