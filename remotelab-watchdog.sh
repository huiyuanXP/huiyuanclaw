#!/bin/bash
# RemoteLab Watchdog — hourly health check & auto-repair
# Mirrors the logic in mcp-server.mjs restart_server tool

LOG=/home/ally/.local/share/remotelab/logs/watchdog.log
export XDG_RUNTIME_DIR=/run/user/$(id -u)
CHAT_PORT="${CHAT_PORT:-7690}"
MAX_LOG_LINES=2000

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(timestamp)] $*" >> "$LOG"; echo "[$(timestamp)] $*"; }

# Trim log to avoid unbounded growth
if [ -f "$LOG" ]; then
  lines=$(wc -l < "$LOG")
  if [ "$lines" -gt "$MAX_LOG_LINES" ]; then
    tail -n $((MAX_LOG_LINES / 2)) "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
  fi
fi

log "=== Watchdog check started ==="
REPAIRED=0

# --- Check a systemd user service; start it if not active ---
check_service() {
  local name=$1
  local status
  status=$(systemctl --user is-active "$name" 2>/dev/null)
  if [ "$status" = "active" ]; then
    log "✓ $name is active"
    return 0
  else
    log "✗ $name is '$status' — attempting start"
    if systemctl --user start "$name" 2>/dev/null; then
      log "  ↳ started successfully"
      REPAIRED=$((REPAIRED + 1))
    else
      log "  ↳ failed to start (check: journalctl --user -u $name -n 20)"
    fi
    return 1
  fi
}

check_service remotelab-chat.service
check_service remotelab-proxy.service
check_service remotelab-tunnel.service

# --- HTTP health check for the chat-server API ---
TOKEN=$(node -e "
  try {
    const fs = require('fs');
    const a = JSON.parse(fs.readFileSync(
      process.env.HOME + '/.config/claude-web/auth.json', 'utf8'));
    process.stdout.write(a.token || '');
  } catch(e) {}
" 2>/dev/null)

if [ -n "$TOKEN" ]; then
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:${CHAT_PORT}/api/session-labels" 2>/dev/null)

  if [ "$HTTP_STATUS" = "200" ]; then
    log "✓ Chat-server API responding (HTTP $HTTP_STATUS)"
  else
    log "✗ Chat-server API not responding (HTTP ${HTTP_STATUS:-timeout}) — restarting service"
    systemctl --user restart remotelab-chat.service 2>/dev/null
    REPAIRED=$((REPAIRED + 1))
    sleep 10
    HTTP_STATUS2=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer $TOKEN" \
      "http://127.0.0.1:${CHAT_PORT}/api/session-labels" 2>/dev/null)
    if [ "$HTTP_STATUS2" = "200" ]; then
      log "  ↳ Chat-server recovered (HTTP $HTTP_STATUS2)"
    else
      log "  ↳ Chat-server still not responding after restart (HTTP ${HTTP_STATUS2:-timeout})"
    fi
  fi
else
  log "⚠ Could not read auth token — skipping HTTP check"
fi

# --- Final summary ---
if [ "$REPAIRED" -gt 0 ]; then
  log "=== Check complete: $REPAIRED issue(s) repaired ==="
else
  log "=== Check complete: all services healthy ==="
fi
