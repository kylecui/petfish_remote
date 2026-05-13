#!/usr/bin/env bash
# petfish-remote installer — self-bootstrapping connector setup.
#
# Usage:
#   curl -sSL https://remote.petfish.ai/install | bash -s -- <token> [project-id] [options]
#
# This script:
#   1. Checks prerequisites (node, npm/npx, git, curl)
#   2. Installs or upgrades petfish-remote client
#   3. Registers with the bot server using the provided token
#      — If connector.yaml already exists, adds the new platform instead of re-registering
#   4. Starts the connector daemon
#
# Pre-requirements:
#   - Node.js >= 18 (https://nodejs.org)
#   - git
#   - curl
#
# Environment variables:
#   PETFISH_REMOTE_DIR  — Install directory (default: ~/.petfish/remote)
#   PETFISH_SERVER_URL  — Server URL override (default: injected by server or https://remote.petfish.ai)
#
# The token is one-time-use and expires in 5 minutes. Get one via /start in Telegram or Feishu.

set -euo pipefail
{ # entire script wrapped in braces — safe for curl | bash (prevents partial execution)

# --- Configuration (may be injected by bot server at serve time) ---
PETFISH_SERVER_URL="${PETFISH_SERVER_URL:-__PETFISH_SERVER_URL__}"
PETFISH_REPO="${PETFISH_REPO:-https://github.com/kylecui/petfish_remote.git}"
PETFISH_REMOTE_DIR="${PETFISH_REMOTE_DIR:-$HOME/.petfish/remote}"
MIN_NODE_VERSION=20

# --- Colors (if terminal supports them) ---
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
fi

info()  { echo -e "${CYAN}><(((^>${NC} $*"; }
ok()    { echo -e "${GREEN}  ✅${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠️${NC}  $*"; }
err()   { echo -e "${RED}  ❌${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

retry() {
  local tries="$1"; shift
  local try=0
  until "$@"; do
    (( ++try == tries )) && return 1
    sleep 2
  done
}

# --- Argument parsing ---
TOKEN=""
PROJECT_ID=""
PROJECT_PATH=""
PROJECT_NAME=""
OPENCODE_BIN=""
AGENT=""
AUTO_START=true
FORCE_REGISTER=false
NPM_CMD=""

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token)         TOKEN="$2"; shift 2 ;;
      --project-id)    PROJECT_ID="$2"; shift 2 ;;
      --project-path)  PROJECT_PATH="$2"; shift 2 ;;
      --project-name)  PROJECT_NAME="$2"; shift 2 ;;
      --opencode-bin)  OPENCODE_BIN="$2"; shift 2 ;;
      --agent)         AGENT="$2"; shift 2 ;;
      --no-start)      AUTO_START=false; shift ;;
      --force-register) FORCE_REGISTER=true; shift ;;
      --help|-h)       usage; exit 0 ;;
      -*)              die "Unknown option: $1. Use --help for usage." ;;
      *)
        # Positional args: token [project-id]
        if [ -z "$TOKEN" ]; then
          TOKEN="$1"
        elif [ -z "$PROJECT_ID" ]; then
          PROJECT_ID="$1"
        else
          die "Unexpected argument: $1"
        fi
        shift
        ;;
    esac
  done
}

usage() {
  cat << 'EOF'
Usage:
  curl -sSL https://remote.petfish.ai/install | bash -s -- <token> [project-id] [options]

Arguments:
  token         One-time registration token (from /start in Telegram or Feishu)
  project-id    Project identifier (default: current directory name)

Options:
  --project-path <path>   Project working directory (default: $PWD)
  --project-name <name>   Display name (default: project-id)
  --opencode-bin <path>   Path to opencode binary
  --agent <type>          AI agent type: auto|opencode|gemini|codex (default: auto)
  --no-start              Don't start connector after setup
  --force-register        Force fresh registration (overwrite existing connector.yaml)
  --help                  Show this help

Multi-platform:
  If connector.yaml already exists, the installer detects this and adds the new
  platform user to your existing projects — no connector restart needed.
  Use --force-register to replace the existing connector identity instead.

Pre-requirements:
  - Node.js >= 18 (https://nodejs.org or: curl -fsSL https://fnm.vercel.app/install | bash)
  - git (https://git-scm.com)
  - curl (usually pre-installed)

Examples:
  # Fresh install (auto-detects project from current directory):
  curl -sSL https://remote.petfish.ai/install | bash -s -- abc123def456

  # Explicit project:
  curl -sSL https://remote.petfish.ai/install | bash -s -- abc123 my-project --project-path ~/dev/myapp

  # Add Feishu to existing Telegram setup:
  curl -sSL https://remote.petfish.ai/install | bash -s -- <feishu-token>
EOF
}

# --- Prerequisite checks ---
check_command() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" &>/dev/null; then
    err "'$cmd' not found."
    echo "    Install: $install_hint"
    return 1
  fi
  return 0
}

check_node_version() {
  local version
  version="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  if [ -z "$version" ] || [ "$version" -lt "$MIN_NODE_VERSION" ]; then
    err "Node.js >= $MIN_NODE_VERSION required (found: ${version:-none})"
    echo "    Install: https://nodejs.org or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install $MIN_NODE_VERSION"
    return 1
  fi
}

check_npm_or_npx() {
  if command -v npm &>/dev/null; then
    NPM_CMD="npm"
    return 0
  fi
  if command -v npx &>/dev/null; then
    NPM_CMD="npx --yes npm@latest"
    warn "npm not found, will use npx as fallback"
    return 0
  fi
  err "Neither 'npm' nor 'npx' found."
  echo "    Install Node.js which includes npm: https://nodejs.org"
  return 1
}

check_prerequisites() {
  info "Checking prerequisites..."
  local failed=0

  check_command "git" "https://git-scm.com/downloads" || ((failed++))
  check_command "curl" "apt install curl / brew install curl" || ((failed++))

  if command -v node &>/dev/null; then
    check_node_version || ((failed++))
  else
    if ! command -v npx &>/dev/null; then
      err "'node' not found."
      echo "    Install: https://nodejs.org or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install $MIN_NODE_VERSION"
      ((failed++))
    else
      warn "node binary not in PATH but npx available — will attempt to proceed"
    fi
  fi

  check_npm_or_npx || ((failed++))

  if [ "$failed" -gt 0 ]; then
    echo ""
    die "Missing $failed prerequisite(s). Install them and retry."
  fi

  ok "All prerequisites met (node $(node --version 2>/dev/null || echo 'via npx'), $NPM_CMD, git $(git --version | cut -d' ' -f3))"
}

# --- Install / Upgrade ---
install_or_upgrade() {
  if [ -d "$PETFISH_REMOTE_DIR/.git" ]; then
    info "Upgrading petfish-remote in $PETFISH_REMOTE_DIR..."
    (cd "$PETFISH_REMOTE_DIR" && retry 3 git pull --quiet 2>&1) || {
      warn "git pull failed — trying fresh clone"
      rm -rf "$PETFISH_REMOTE_DIR"
      do_fresh_install
      return
    }
  else
    if [ -d "$PETFISH_REMOTE_DIR" ]; then
      warn "Existing non-git install found — replacing with fresh clone"
      rm -rf "$PETFISH_REMOTE_DIR"
    fi
    do_fresh_install
  fi

  info "Installing dependencies..."
  (cd "$PETFISH_REMOTE_DIR" && $NPM_CMD install --quiet --no-audit --no-fund 2>&1 | tail -3) || die "npm install failed"

  info "Building..."
  (cd "$PETFISH_REMOTE_DIR" && $NPM_CMD run build --quiet 2>&1) || die "Build failed. Check Node.js version."

  # Ensure runtime dir exists
  mkdir -p "$PETFISH_REMOTE_DIR/.runtime/attachments" "$PETFISH_REMOTE_DIR/.runtime/logs"

  ok "petfish-remote installed at $PETFISH_REMOTE_DIR"
}

do_fresh_install() {
  info "Installing petfish-remote to $PETFISH_REMOTE_DIR..."
  mkdir -p "$(dirname "$PETFISH_REMOTE_DIR")"

  # Try git clone first, fallback to GitHub release tarball
  if retry 3 git clone --quiet --depth 1 "$PETFISH_REPO" "$PETFISH_REMOTE_DIR" 2>/dev/null; then
    return 0
  fi

  warn "git clone failed — trying GitHub tarball..."
  local tarball_url="https://github.com/kylecui/petfish_remote/archive/refs/heads/main.tar.gz"
  local tmp_tar
  tmp_tar="$(mktemp /tmp/petfish-remote-XXXXXX.tar.gz)"

  if curl -sSL -o "$tmp_tar" "$tarball_url" 2>/dev/null; then
    mkdir -p "$PETFISH_REMOTE_DIR"
    tar -xzf "$tmp_tar" -C "$PETFISH_REMOTE_DIR" --strip-components=1
    rm -f "$tmp_tar"
    ok "Downloaded from GitHub tarball"
  else
    rm -f "$tmp_tar"
    die "Failed to download petfish-remote. Check network and try again."
  fi
}

# --- Register with server ---
do_register() {
  info "Registering with server..."

  local setup_script="$PETFISH_REMOTE_DIR/scripts/petfish-connect.sh"
  if [ ! -f "$setup_script" ]; then
    die "Setup script not found at $setup_script"
  fi

  local args=(setup --token "$TOKEN")
  [ -n "$PROJECT_ID" ] && args+=(--project-id "$PROJECT_ID")
  [ -n "$PROJECT_PATH" ] && args+=(--project-path "$PROJECT_PATH")
  [ -n "$PROJECT_NAME" ] && args+=(--project-name "$PROJECT_NAME")
  [ -n "$OPENCODE_BIN" ] && args+=(--opencode-bin "$OPENCODE_BIN")
  [ -n "$AGENT" ] && args+=(--agent "$AGENT")
  [ "$FORCE_REGISTER" = "true" ] && args+=(--force-register)

  if [ "$PETFISH_SERVER_URL" != "__PETFISH_SERVER_URL__" ]; then
    args+=(--server "$PETFISH_SERVER_URL")
  fi

  bash "$setup_script" "${args[@]}"
}

# --- Start connector ---
do_start() {
  if [ "$AUTO_START" = "false" ]; then
    echo ""
    info "Skipping auto-start (--no-start). Start manually with:"
    echo "    $PETFISH_REMOTE_DIR/scripts/petfish-connect.sh start ./connector.yaml"
    return
  fi

  local config_path="${PROJECT_PATH:-$(pwd)}/connector.yaml"
  local pid_file="/tmp/petfish-connector-$(basename "${PROJECT_PATH:-$(pwd)}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-').pid"

  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    info "Connector already running (PID $(cat "$pid_file")) — no restart needed."
    return
  fi

  info "Starting connector..."
  bash "$PETFISH_REMOTE_DIR/scripts/petfish-connect.sh" start "$config_path"
}

# --- Main ---
main() {
  echo ""
  info "PetFish Remote installer"
  echo ""

  parse_args "$@"

  if [ -z "$TOKEN" ]; then
    die "Token required. Get one via /start in Telegram or Feishu bot.\n    Usage: curl -sSL https://remote.petfish.ai/install | bash -s -- <token>"
  fi

  # Defaults — PROJECT_ID only required for fresh install, not add-platform
  PROJECT_PATH="${PROJECT_PATH:-$(pwd)}"
  PROJECT_NAME="${PROJECT_NAME:-$PROJECT_ID}"

  local existing_config="$PROJECT_PATH/connector.yaml"
  if [ -f "$existing_config" ] && [ "$FORCE_REGISTER" != "true" ]; then
    info "Detected existing connector.yaml — will add platform instead of fresh registration."
    PROJECT_ID="${PROJECT_ID:-}"
  else
    PROJECT_ID="${PROJECT_ID:-$(basename "$(pwd)")}"
    PROJECT_NAME="${PROJECT_NAME:-$PROJECT_ID}"
  fi

  check_prerequisites
  install_or_upgrade
  do_register
  do_start

  echo ""
  ok "Done! Your connector is running."
  echo "    Manage: $PETFISH_REMOTE_DIR/scripts/petfish-connect.sh [status|stop|restart|logs]"
  echo "    Add another platform: curl -sSL https://remote.petfish.ai/install | bash -s -- <token-from-new-platform>"
  echo ""
}

main "$@"

} # end curl|bash safety wrapper
