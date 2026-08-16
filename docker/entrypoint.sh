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

socat \
  "TCP-LISTEN:${relay_port},bind=0.0.0.0,reuseaddr,fork" \
  "TCP:127.0.0.1:${app_port}" &
relay_pid="$!"

node --expose-internals "$dsh_entrypoint" web \
  --host 127.0.0.1 \
  --port "$app_port" \
  --trusted-host "${trusted_hosts[@]}" &
dsh_pid="$!"

set +e
wait -n "$dsh_pid" "$relay_pid"
status="$?"
set -e

stop_children
exit "$status"
