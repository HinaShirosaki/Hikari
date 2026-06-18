#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${HIKARI_TG_SESSION_NAME:-hikari-telegram-bot}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_DIR}/data"
LOG_FILE="${LOG_DIR}/telegram-bot-tmux.log"
TMUX_SOCKET_DIR="${PROJECT_DIR}/tmp/tmux"
TMUX_SOCKET="${TMUX_SOCKET_DIR}/telegram-bot.sock"

usage() {
  cat <<'USAGE'
Usage: scripts/telegram-bot-tmux.sh <start|stop|restart|status|attach|logs>

Commands:
  start    Start Hikari in a detached tmux session with caffeinate.
  stop     Stop the tmux session.
  restart  Restart the tmux session.
  status   Show tmux session status.
  attach   Attach to the tmux session.
  logs     Tail the log file.
USAGE
}

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is not installed."
    exit 1
  fi
  mkdir -p "${TMUX_SOCKET_DIR}"
}

tmux_cmd() {
  tmux -S "${TMUX_SOCKET}" "$@"
}

session_exists() {
  tmux_cmd has-session -t "${SESSION_NAME}" 2>/dev/null
}

start_session() {
  require_tmux
  mkdir -p "${LOG_DIR}"

  if session_exists; then
    echo "Session '${SESSION_NAME}' is already running."
    return 0
  fi

  local launch_cmd
  launch_cmd="cd \"${PROJECT_DIR}\" && exec caffeinate -dimsu npm run start >> \"${LOG_FILE}\" 2>&1"
  tmux_cmd new-session -d -s "${SESSION_NAME}" "${launch_cmd}"
  if ! session_exists; then
    echo "Failed to create tmux session '${SESSION_NAME}'."
    exit 1
  fi
  echo "Started session '${SESSION_NAME}'."
  echo "Log: ${LOG_FILE}"
}

stop_session() {
  require_tmux
  if ! session_exists; then
    echo "Session '${SESSION_NAME}' is not running."
    return 0
  fi
  tmux_cmd kill-session -t "${SESSION_NAME}"
  echo "Stopped session '${SESSION_NAME}'."
}

show_status() {
  require_tmux
  if ! session_exists; then
    echo "Session '${SESSION_NAME}': not running"
    return 1
  fi
  tmux_cmd list-sessions | awk -v target="${SESSION_NAME}:" '$0 ~ target'
}

attach_session() {
  require_tmux
  tmux_cmd attach -t "${SESSION_NAME}"
}

tail_logs() {
  mkdir -p "${LOG_DIR}"
  touch "${LOG_FILE}"
  tail -n 80 -f "${LOG_FILE}"
}

main() {
  local cmd="${1:-status}"
  case "${cmd}" in
    start)
      start_session
      ;;
    stop)
      stop_session
      ;;
    restart)
      stop_session || true
      start_session
      ;;
    status)
      show_status
      ;;
    attach)
      attach_session
      ;;
    logs)
      tail_logs
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "${1:-status}"
