#!/usr/bin/env bash
# petfish-connect.sh — Manage the petfish-remote connector daemon.
#
# Usage:
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
PETFISH_REMOTE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
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

do_start() {
  local config_path="${1:-$(pwd)/connector.yaml}"

  if [ ! -f "$config_path" ]; then
    echo "ERROR: connector.yaml not found at: $config_path"
    echo ""
    echo "Create one first. See SETUP.md in petfish_remote repo."
    exit 1
  fi

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

  if ! is_running "$pid_file"; then
    echo "Connector is not running."
    if pgrep -f "dist/connector/main.js" > /dev/null 2>&1; then
      echo "WARNING: Found orphaned connector process(es):"
      pgrep -af "dist/connector/main.js"
      echo "Kill manually with: pkill -f 'dist/connector/main.js'"
    fi
    return 0
  fi

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

case "${1:-}" in
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
    echo "Usage: petfish-connect.sh {start|stop|restart|status|logs} [connector.yaml]"
    echo ""
    echo "Commands:"
    echo "  start   — Start connector as background daemon"
    echo "  stop    — Stop running connector"
    echo "  restart — Stop and start"
    echo "  status  — Show if running + recent log"
    echo "  logs    — Show last 50 log lines"
    exit 1
    ;;
esac
