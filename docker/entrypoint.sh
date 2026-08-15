#!/usr/bin/env bash

set -Eeuo pipefail

readonly relay_port="${DSH_RELAY_PORT:-3080}"
readonly app_port="${DSH_INTERNAL_PORT:-3081}"
readonly trusted_hosts_csv="${DSH_TRUSTED_HOSTS:-}"

require_port() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    printf 'dsh-server: %s must be an integer from 1 to 65535, got %q\n' "$name" "$value" >&2
    exit 64
  fi
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

require_port DSH_RELAY_PORT "$relay_port"
require_port DSH_INTERNAL_PORT "$app_port"

if [[ "$relay_port" == "$app_port" ]]; then
  printf 'dsh-server: DSH_RELAY_PORT and DSH_INTERNAL_PORT must differ\n' >&2
  exit 64
fi

IFS=',' read -r -a raw_trusted_hosts <<< "$trusted_hosts_csv"
trusted_hosts=()
for raw_host in "${raw_trusted_hosts[@]}"; do
  host="$(trim "$raw_host")"
  if [[ -n "$host" ]]; then
    trusted_hosts+=("$host")
  fi
done

if (( ${#trusted_hosts[@]} == 0 )); then
  printf 'dsh-server: DSH_TRUSTED_HOSTS must contain at least one LAN authority\n' >&2
  exit 64
fi

dsh_entrypoint="$(readlink -f "$(command -v dsh)")"
if [[ ! -f "$dsh_entrypoint" ]]; then
  printf 'dsh-server: unable to resolve the dsh executable\n' >&2
  exit 69
fi

dsh_pid=''
relay_pid=''

stop_children() {
  trap - INT TERM

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

trap on_term TERM
trap on_int INT

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
