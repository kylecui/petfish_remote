#!/usr/bin/env bash
# petfish-connect.sh — Manage the petfish-remote connector daemon.
#
# Usage:
#   petfish-connect.sh setup --token <token> --project-id <id> [options]
#   petfish-connect.sh start [connector.yaml]  — Start connector as daemon
#   petfish-connect.sh stop                    — Stop running connector
#   petfish-connect.sh status                  — Show connector status
#   petfish-connect.sh restart [connector.yaml] — Restart connector
#   petfish-connect.sh logs                    — Tail connector log
#
# The connector runs as a background daemon (survives terminal close).
# Safe to call from within opencode — uses nohup + disown.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PETFISH_REMOTE_DIR="${PETFISH_REMOTE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CONNECTOR_JS="$PETFISH_REMOTE_DIR/dist/connector/main.js"

PID_DIR="/tmp"
LOG_DIR="/tmp"

get_pid_file() {
  local config_path="${1:-connector.yaml}"
  local project_dir
  project_dir="$(cd "$(dirname "$config_path")" && pwd)"
  local slug
  slug="$(basename "$project_dir" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
  echo "$PID_DIR/petfish-connector-${slug}.pid"
}

get_log_file() {
  local config_path="${1:-connector.yaml}"
  local project_dir
  project_dir="$(cd "$(dirname "$config_path")" && pwd)"
  local slug
  slug="$(basename "$project_dir" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
  echo "$LOG_DIR/petfish-connector-${slug}.log"
}

is_running() {
  local pid_file="$1"
  if [ ! -f "$pid_file" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  else
    rm -f "$pid_file"
    return 1
  fi
}

check_version() {
  local server_url="${1:-https://remote.petfish.ai}"
  local local_version=""
  local remote_version=""

  if [ -f "$PETFISH_REMOTE_DIR/package.json" ]; then
    local_version="$(grep -o '"version": *"[^"]*"' "$PETFISH_REMOTE_DIR/package.json" | cut -d'"' -f4)"
  fi

  if [ -z "$local_version" ]; then
    return 0
  fi

  remote_version="$(curl -s --max-time 5 "${server_url}/api/version" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true)"

  if [ -z "$remote_version" ]; then
    return 0
  fi

  if [ "$local_version" = "$remote_version" ]; then
    return 0
  fi

  echo "   ⚠️  Version mismatch: local=$local_version server=$remote_version"
  echo "   Updating..."
  (cd "$PETFISH_REMOTE_DIR" && git pull --quiet && npm install --quiet && npm run build --quiet) 2>&1 | sed 's/^/   /'

  if [ $? -eq 0 ]; then
    echo "   ✅ Updated to $remote_version"
  else
    echo "   ⚠️  Update failed — continuing with local version"
  fi
}

do_start() {
  local config_path="${1:-$(pwd)/connector.yaml}"

  if [ ! -f "$config_path" ]; then
    echo "ERROR: connector.yaml not found at: $config_path"
    echo ""
    echo "Create one first. See SETUP.md in petfish_remote repo."
    exit 1
  fi

  local server_url
  server_url="$(grep -o 'serverUrl: *"[^"]*"' "$config_path" | cut -d'"' -f2 | sed 's|wss://|https://|; s|/ws/connector||' || echo "https://remote.petfish.ai")"
  check_version "$server_url"

  if [ ! -f "$CONNECTOR_JS" ]; then
    echo "ERROR: Connector not built. Run:"
    echo "  cd $PETFISH_REMOTE_DIR && npm run build"
    exit 1
  fi

  local pid_file
  pid_file="$(get_pid_file "$config_path")"
  local log_file
  log_file="$(get_log_file "$config_path")"

  if is_running "$pid_file"; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    echo "Connector already running (PID $existing_pid)"
    echo "Use 'petfish-connect.sh stop' first, or 'petfish-connect.sh restart'"
    exit 0
  fi

  local opencode_pid="${OPENCODE_PID:-}"
  if [ -z "$opencode_pid" ]; then
    opencode_pid="$(pgrep -x "opencode" | head -1 || true)"
  fi

  if [ -z "$opencode_pid" ]; then
    echo "WARNING: No opencode process found. Connector will run in process-spawn mode."
  fi

  config_path="$(cd "$(dirname "$config_path")" && pwd)/$(basename "$config_path")"

  echo "><(((^> petfish-connect: starting daemon"
  echo "   config: $config_path"
  echo "   log: $log_file"
  echo "   opencode PID: ${opencode_pid:-none}"

  OPENCODE_PID="${opencode_pid}" nohup node "$CONNECTOR_JS" "$config_path" \
    >> "$log_file" 2>&1 &
  local daemon_pid=$!
  disown "$daemon_pid" 2>/dev/null || true

  echo "$daemon_pid" > "$pid_file"

  sleep 2

  if ! kill -0 "$daemon_pid" 2>/dev/null; then
    echo "ERROR: Connector process died immediately. Check log:"
    echo "  tail -20 $log_file"
    rm -f "$pid_file"
    exit 1
  fi

  if grep -q "Registration accepted" "$log_file" 2>/dev/null; then
    echo "   status: ✅ registered with server"
  else
    echo "   status: ⏳ connecting (check 'petfish-connect.sh status' in a few seconds)"
  fi

  echo "   PID: $daemon_pid"
  echo ""
  echo "Connector is running in background. It will survive terminal close."
  echo "To stop: $0 stop"
}

do_stop() {
  local config_path="${1:-$(pwd)/connector.yaml}"
  local pid_file
  pid_file="$(get_pid_file "$config_path")"

  if is_running "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    echo "Stopping connector (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
    echo "Stopped."
  else
    echo "Connector is not running (no tracked PID)."
    rm -f "$pid_file"
  fi

  local orphans
  orphans="$(pgrep -f "dist/connector/main.js" 2>/dev/null || true)"
  if [ -n "$orphans" ]; then
    echo "Killing orphan connector process(es): $orphans"
    echo "$orphans" | xargs kill 2>/dev/null || true
    sleep 1
    local remaining
    remaining="$(pgrep -f "dist/connector/main.js" 2>/dev/null || true)"
    if [ -n "$remaining" ]; then
      echo "$remaining" | xargs kill -9 2>/dev/null || true
    fi
  fi
}

do_status() {
  local config_path="${1:-$(pwd)/connector.yaml}"
  local pid_file
  pid_file="$(get_pid_file "$config_path")"
  local log_file
  log_file="$(get_log_file "$config_path")"

  echo "><(((^> PetFish Remote Connector Status"
  echo ""

  if is_running "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    echo "  Status: RUNNING (PID $pid)"
    echo "  PID file: $pid_file"
    echo "  Log file: $log_file"
    echo ""
    echo "  Recent log:"
    tail -5 "$log_file" 2>/dev/null | sed 's/^/    /'
  else
    echo "  Status: STOPPED"
    if [ -f "$log_file" ]; then
      echo "  Last log entries:"
      tail -5 "$log_file" 2>/dev/null | sed 's/^/    /'
    fi
  fi
}

do_logs() {
  local config_path="${1:-$(pwd)/connector.yaml}"
  local log_file
  log_file="$(get_log_file "$config_path")"

  if [ ! -f "$log_file" ]; then
    echo "No log file found at: $log_file"
    exit 1
  fi

  tail -50 "$log_file"
}

do_setup() {
  local token=""
  local project_id=""
  local project_name=""
  local project_path=""
  local server_url="https://remote.petfish.ai"
  local opencode_bin=""
  local agent="auto"
  local config_out="./connector.yaml"

  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token) token="$2"; shift 2 ;;
      --project-id) project_id="$2"; shift 2 ;;
      --project-name) project_name="$2"; shift 2 ;;
      --project-path) project_path="$2"; shift 2 ;;
      --server) server_url="$2"; shift 2 ;;
      --opencode-bin) opencode_bin="$2"; shift 2 ;;
      --agent) agent="$2"; shift 2 ;;
      --output) config_out="$2"; shift 2 ;;
      *) echo "Unknown option: $1"; exit 1 ;;
    esac
  done

  if [ -z "$token" ]; then
    echo "ERROR: --token is required. Get one from /start in Telegram."
    exit 1
  fi
  if [ -z "$project_id" ]; then
    echo "ERROR: --project-id is required."
    exit 1
  fi

  case "$agent" in
    auto|opencode|gemini|codex) ;;
    *) echo "ERROR: --agent must be one of: auto, opencode, gemini, codex"; exit 1 ;;
  esac

  project_name="${project_name:-$project_id}"
  project_path="${project_path:-$(pwd)}"
  project_path="$(cd "$project_path" && pwd)"

  if [ -z "$opencode_bin" ]; then
    opencode_bin="$(which opencode 2>/dev/null || echo "$HOME/.opencode/bin/opencode")"
  fi

  if [ "$agent" = "opencode" ] || [ "$agent" = "auto" ]; then
    if ! pgrep -f "opencode.*--port" > /dev/null 2>&1; then
      echo "   ⚠️  No running opencode instance detected."
      echo "   The connector will keep retrying until opencode starts with --port."
    fi
  fi

  local hostname
  hostname="$(hostname)"

  echo "><(((^> petfish-connect: registering with server..."
  echo "   server: $server_url"
  echo "   project: $project_id ($project_name)"
  echo "   path: $project_path"
  echo "   agent: $agent"

  local response
  response="$(curl -s -w "\n%{http_code}" -X POST "${server_url}/api/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"token\": \"${token}\",
      \"projectId\": \"${project_id}\",
      \"projectName\": \"${project_name}\",
      \"projectPath\": \"${project_path}\",
      \"hostname\": \"${hostname}\"
    }")"

  local http_code
  http_code="$(echo "$response" | tail -1)"
  local body
  body="$(echo "$response" | sed '$d')"

  if [ "$http_code" != "200" ]; then
    echo "ERROR: Registration failed (HTTP $http_code)"
    echo "  $body"
    exit 1
  fi

  local connector_token
  connector_token="$(echo "$body" | grep -o '"connectorToken":"[^"]*"' | cut -d'"' -f4)"
  local ws_url
  ws_url="$(echo "$body" | grep -o '"serverUrl":"[^"]*"' | cut -d'"' -f4)"

  if [ -z "$connector_token" ]; then
    echo "ERROR: No connectorToken in response"
    echo "  $body"
    exit 1
  fi

  cat > "$config_out" << YAML
connectorId: auto
serverUrl: "${ws_url}"
token: "${connector_token}"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: ${project_id}
    path: ${project_path}
    opencodeBin: ${opencode_bin}
    agent: ${agent}
YAML

  echo ""
  echo "   ✅ Registration successful!"
  echo "   Config written to: $config_out"
  echo ""
  echo "Start the connector with:"
  echo "  petfish-connect.sh start $config_out"
}

case "${1:-}" in
  setup)
    do_setup "$@"
    ;;
  start)
    do_start "${2:-$(pwd)/connector.yaml}"
    ;;
  stop)
    do_stop "${2:-$(pwd)/connector.yaml}"
    ;;
  restart)
    do_stop "${2:-$(pwd)/connector.yaml}"
    sleep 1
    do_start "${2:-$(pwd)/connector.yaml}"
    ;;
  status)
    do_status "${2:-$(pwd)/connector.yaml}"
    ;;
  logs)
    do_logs "${2:-$(pwd)/connector.yaml}"
    ;;
  *)
    echo "Usage: petfish-connect.sh {setup|start|stop|restart|status|logs} [connector.yaml]"
    echo ""
    echo "Commands:"
    echo "  setup   — Register with server and generate connector.yaml"
    echo "  start   — Start connector as background daemon"
    echo "  stop    — Stop running connector"
    echo "  restart — Stop and start"
    echo "  status  — Show if running + recent log"
    echo "  logs    — Show last 50 log lines"
    echo ""
    echo "Setup:"
    echo "  petfish-connect.sh setup --token <token> --project-id <id> [--project-path /path] [--server url]"
    exit 1
    ;;
esac
