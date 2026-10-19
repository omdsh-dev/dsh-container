#!/usr/bin/env bash

set -Eeuo pipefail

relay_port_value="${DSH_CONTAINER_RELAY_PORT:-3080}"
app_port_value="${DSH_CONTAINER_INTERNAL_PORT:-3081}"
trusted_hosts_value="${DSH_CONTAINER_TRUSTED_HOSTS:-}"

require_port() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || (( 10#$value < 1 || 10#$value > 65535 )); then
    printf 'dsh-container: %s must be an integer from 1 to 65535, got %q\n' "$name" "$value" >&2
    exit 64
  fi
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

is_loopback_authority() {
  local entry="${1,,}"
  local host

  if [[ "$entry" == \[* ]]; then
    host="${entry#\[}"
    host="[${host%%]*}]"
  elif [[ "$entry" == *:* ]]; then
    host="${entry%%:*}"
  else
    host="$entry"
  fi

  case "$host" in
    localhost|"[::1]"|"::1") return 0 ;;
    127.*) [[ "$host" =~ ^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] ;;
    *) return 1 ;;
  esac
}

require_port DSH_CONTAINER_RELAY_PORT "$relay_port_value"
require_port DSH_CONTAINER_INTERNAL_PORT "$app_port_value"

readonly relay_port="$((10#$relay_port_value))"
readonly app_port="$((10#$app_port_value))"

if [[ "$relay_port" == "$app_port" ]]; then
  printf 'dsh-container: DSH_CONTAINER_RELAY_PORT and DSH_CONTAINER_INTERNAL_PORT must differ\n' >&2
  exit 64
fi

IFS=',' read -r -a raw_trusted_hosts <<< "$trusted_hosts_value"
trusted_hosts=()
for raw_host in "${raw_trusted_hosts[@]}"; do
  host="$(trim "$raw_host")"
  if [[ -n "$host" ]]; then
    trusted_hosts+=("$host")
  fi
done

if (( ${#trusted_hosts[@]} == 0 )); then
  printf 'dsh-container: DSH_CONTAINER_TRUSTED_HOSTS must contain at least one LAN authority\n' >&2
  exit 64
fi

trusted_hosts_csv="$(IFS=,; printf '%s' "${trusted_hosts[*]}")"
export DSH_CONTAINER_RELAY_PORT="$relay_port"
export DSH_CONTAINER_INTERNAL_PORT="$app_port"
export DSH_CONTAINER_TRUSTED_HOSTS="$trusted_hosts_csv"

if [[ -v DSH_CONTAINER_KEY ]]; then
  node /opt/dsh-container/auth-relay/validate-key.mjs || { status="$?"; exit "$status"; }
fi

public_url_value="${DSH_CONTAINER_PUBLIC_URL:-}"
public_url=''
if [[ -n "$public_url_value" ]]; then
  if ! public_url="$(node /opt/dsh-container/auth-relay/validate-public-url.mjs "$public_url_value")"; then
    exit 64
  fi
fi

if [[ ! -v DSH_CONTAINER_KEY ]]; then
  has_remote_trusted_host=0
  for trusted_host in "${trusted_hosts[@]}"; do
    if ! is_loopback_authority "$trusted_host"; then
      has_remote_trusted_host=1
      break
    fi
  done
  if (( has_remote_trusted_host )); then
    printf 'dsh-container: WARNING: DSH_CONTAINER_KEY is not set and DSH_CONTAINER_TRUSTED_HOSTS accepts non-loopback authorities; every client that can reach the published port acts as the DSH owner. Set DSH_CONTAINER_KEY before exposing this port beyond localhost.\n' >&2
  else
    printf 'dsh-container: WARNING: DSH_CONTAINER_KEY is not set; clients that can reach the published port act as the DSH owner.\n' >&2
  fi
fi

startup_log="${DSH_CONTAINER_STARTUP_LOG:-/tmp/dsh-web.log}"
if ! : > "$startup_log" 2>/dev/null; then
  printf 'dsh-container: %s must be writable; mount a writable /tmp or set DSH_CONTAINER_STARTUP_LOG\n' "$startup_log" >&2
  exit 70
fi
export DSH_CONTAINER_STARTUP_LOG="$startup_log"

tmp_directory_is_executable() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { tmpdir } from "node:os";
    try {
      const target = tmpdir();
      let point = "";
      let options;
      for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
        const fields = line.split(" ");
        if (fields.length < 6) continue;
        const mountPoint = fields[4];
        const covered = mountPoint === "/" || target === mountPoint || target.startsWith(`${mountPoint}/`);
        if (covered && mountPoint.length >= point.length) {
          point = mountPoint;
          options = fields[5];
        }
      }
      process.exit(options !== undefined && options.split(",").includes("noexec") ? 1 : 0);
    } catch {
      process.exit(0);
    }
  '
}

if ! tmp_directory_is_executable; then
  printf 'dsh-container: %s must allow executable mappings (add exec to the tmpfs mount); DSH loads its prebuilt native addon from the temp directory\n' "${TMPDIR:-/tmp}" >&2
  exit 70
fi

dsh_entrypoint="$(readlink -f "$(command -v dsh)")"
if [[ ! -f "$dsh_entrypoint" ]]; then
  printf 'dsh-container: unable to resolve the dsh executable\n' >&2
  exit 69
fi

dsh_pid=''
relay_pid=''
children_stopped=0

stop_children() {
  if (( children_stopped )); then
    return
  fi
  children_stopped=1
  trap '' INT TERM USR1

  if [[ -n "$dsh_pid" ]]; then
    kill -TERM "$dsh_pid" 2>/dev/null || true
  fi
  if [[ -n "$relay_pid" ]]; then
    kill -TERM "$relay_pid" 2>/dev/null || true
  fi

  if [[ -n "$dsh_pid" ]]; then
    wait "$dsh_pid" 2>/dev/null || true
  fi
  if [[ -n "$relay_pid" ]]; then
    wait "$relay_pid" 2>/dev/null || true
  fi
}

on_term() {
  stop_children
  exit 143
}

on_int() {
  stop_children
  exit 130
}

on_restart() {
  stop_children
  exit 75
}

trap on_term TERM
trap on_int INT
trap on_restart USR1

node /opt/dsh-container/auth-relay/index.mjs &
relay_pid="$!"

dsh_arguments=(
  web
  --host 127.0.0.1
  --port "$app_port"
  --trusted-host "${trusted_hosts[@]}"
  --no-open
)
if [[ -n "$public_url" ]]; then
  dsh_arguments+=(--public-url "$public_url")
fi

node --expose-internals "$dsh_entrypoint" "${dsh_arguments[@]}" \
  > >(tee "$startup_log") 2>&1 &
dsh_pid="$!"

set +e
wait -n "$dsh_pid" "$relay_pid"
status="$?"
set -e

stop_children
exit "$status"
