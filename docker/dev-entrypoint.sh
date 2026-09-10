#!/usr/bin/env bash
# Entrypoint for the Malloy model development image.
#
# Brings up a workspace and serves VS Code over HTTP. The repo lives INSIDE the
# container, so the only thing between a URL and a working editor is a
# `docker run`. Anything other than the default command is exec'd unchanged, so
# `docker run ... bash` still gets you a shell.
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-/home/node/workspace}"
CODE_SERVER_PORT="${CODE_SERVER_PORT:-8080}"
CODE_SERVER_CONFIG="${HOME}/.config/code-server/config.yaml"

say()  { printf '  %s\n' "$*"; }
warn() { printf '  !! %s\n' "$*" >&2; }

# Is $1 (or a parent) a bind mount or volume? Work written anywhere else dies
# with the container, and "my model repo is not on my filesystem" is exactly the
# setup where that is a surprise rather than an expectation.
is_persisted() {
  local dir="$1"
  while [ "$dir" != "/" ]; do
    if awk '{print $2}' /proc/self/mounts | grep -qx -- "$dir"; then return 0; fi
    dir="$(dirname "$dir")"
  done
  return 1
}

workspace_is_empty() {
  [ ! -d "$WORKSPACE_DIR" ] || [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]
}

prepare_workspace() {
  if ! workspace_is_empty; then
    # Never clobber. A populated workspace is either a volume from a previous
    # run or a bind mount, and both mean someone's work is in there.
    if [ -n "${REPO_URL:-}" ]; then
      local existing
      existing="$(git -C "$WORKSPACE_DIR" remote get-url origin 2>/dev/null || echo 'not a git repo')"
      say "Workspace already populated — leaving it alone."
      say "  REPO_URL was set to: ${REPO_URL}"
      say "  what is there now:   ${existing}"
    fi
    return
  fi

  mkdir -p "$WORKSPACE_DIR"

  if [ -z "${REPO_URL:-}" ]; then
    say "No REPO_URL set — starting with an empty workspace."
    say "Clone one from the terminal, or restart with:"
    say "  -e REPO_URL=https://github.com/owner/repo"
    return
  fi

  say "Cloning ${REPO_URL} …"
  # A private repo needs credentials; gh's config (or GH_TOKEN) supplies them,
  # and `gh auth login --web` works headless if neither is present yet.
  if ! git clone --depth 50 "${REPO_URL}" "$WORKSPACE_DIR" 2>&1 | sed 's/^/    /'; then
    warn "Clone failed. The workspace is empty; fix the URL or your credentials"
    warn "and clone by hand from the terminal — code-server still starts."
    return
  fi
  say "Cloned into ${WORKSPACE_DIR}"
}

# Unpushed work is invisible until the container is gone. Say so on the way in,
# while it can still be pushed.
report_unpushed() {
  git -C "$WORKSPACE_DIR" rev-parse --git-dir >/dev/null 2>&1 || return 0
  local dirty ahead
  dirty="$(git -C "$WORKSPACE_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  ahead="$(git -C "$WORKSPACE_DIR" rev-list --count '@{u}..' 2>/dev/null || echo 0)"
  [ "$dirty" = "0" ] && [ "$ahead" = "0" ] && return 0
  warn "Workspace has ${dirty} uncommitted change(s) and ${ahead} unpushed commit(s)."
}

ensure_code_server_config() {
  [ -f "$CODE_SERVER_CONFIG" ] && return 0
  mkdir -p "$(dirname "$CODE_SERVER_CONFIG")"
  local pw="${CODE_SERVER_PASSWORD:-}"
  if [ -z "$pw" ]; then
    pw="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24)"
  fi
  cat > "$CODE_SERVER_CONFIG" <<YAML
bind-addr: 0.0.0.0:${CODE_SERVER_PORT}
auth: password
password: ${pw}
cert: false
YAML
  chmod 600 "$CODE_SERVER_CONFIG"
}

start_code_server() {
  ensure_code_server_config
  local pw
  pw="$(awk '/^password:/ {print $2}' "$CODE_SERVER_CONFIG")"

  echo
  say "VS Code:  http://localhost:${CODE_SERVER_PORT}/"
  say "Password: ${pw}"
  echo

  if ! is_persisted "$WORKSPACE_DIR"; then
    # Deliberately loud. The whole point of this image is that the repo is not
    # on your filesystem, which also means nothing here survives `docker rm`.
    warn "${WORKSPACE_DIR} is not a volume or bind mount."
    warn "Everything in it — including your logins — is lost when this container"
    warn "is removed. Restart with:  -v malloyyo-home:/home/node"
    echo
  fi

  # Publish this port to 127.0.0.1 on the host, never 0.0.0.0: code-server is a
  # terminal in a browser, running as a user holding your cloud credentials.
  exec code-server --bind-addr "0.0.0.0:${CODE_SERVER_PORT}" "$WORKSPACE_DIR"
}

prepare_workspace
report_unpushed

if [ "${1:-code-server}" = "code-server" ] && [ "$#" -le 1 ]; then
  start_code_server
fi

exec "$@"
