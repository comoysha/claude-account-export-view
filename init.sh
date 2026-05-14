#!/usr/bin/env bash
# One-shot setup for claude-account-export-view as a macOS LaunchAgent.
#   - installs npm deps
#   - bootstraps config.json from config.example.json if missing
#   - generates ~/Library/LaunchAgents/local.claude-account-export-view.plist
#   - (re)loads it via launchctl
#
# Usage:
#   ./init.sh              # install / reinstall (idempotent)
#   ./init.sh uninstall    # stop daemon and remove plist
#   ./init.sh status       # show daemon state

set -euo pipefail

# --- constants -------------------------------------------------------------
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="local.claude-account-export-view"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/claude-account-export-view"
CONFIG="$REPO_DIR/config.json"
EXAMPLE="$REPO_DIR/config.example.json"

# --- helpers ---------------------------------------------------------------
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[fatal]\033[0m %s\n' "$*" >&2; exit 1; }

require_macos() {
  [[ "$(uname)" == "Darwin" ]] || die "launchd is macOS-only. On Linux use systemd user units; on Windows use Task Scheduler."
}

uid() { id -u; }

is_loaded() { launchctl list 2>/dev/null | awk '{print $3}' | grep -qx "$LABEL"; }

unload_if_loaded() {
  if is_loaded; then
    log "unloading existing $LABEL"
    launchctl bootout "gui/$(uid)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  fi
}

# --- subcommands -----------------------------------------------------------
cmd_install() {
  require_macos
  [[ -f "$REPO_DIR/server.js" ]] || die "run from repo root (server.js not found in $REPO_DIR)"

  NODE_BIN="$(command -v node || true)"
  [[ -n "$NODE_BIN" ]] || die "node not found in PATH. Install Node.js 18+ first."
  log "node binary: $NODE_BIN"

  # config.json
  if [[ ! -f "$CONFIG" ]]; then
    [[ -f "$EXAMPLE" ]] || die "neither config.json nor config.example.json found"
    cp "$EXAMPLE" "$CONFIG"
    warn "created config.json from config.example.json"
    warn "EDIT $CONFIG (set 'sources' to your real export paths), then rerun: ./init.sh"
    exit 0
  fi

  # bail if sources still look like the placeholder
  if grep -q '/absolute/path/to/' "$CONFIG"; then
    die "config.json still contains placeholder paths. Edit it first, then rerun."
  fi

  # deps
  log "installing npm dependencies"
  ( cd "$REPO_DIR" && npm install --silent --no-audit --no-fund )

  mkdir -p "$LOG_DIR"
  mkdir -p "$(dirname "$PLIST")"

  log "writing $PLIST"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${REPO_DIR}/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/err.log</string>
</dict>
</plist>
PLIST_EOF

  plutil -lint "$PLIST" >/dev/null || die "generated plist failed lint"

  unload_if_loaded
  log "loading $LABEL"
  launchctl bootstrap "gui/$(uid)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

  sleep 2
  cmd_status
  log "done. Logs: $LOG_DIR/{out,err}.log"
  log "Open your browser to http://localhost:<port> (port shown in out.log; default 5273, auto-bumps if busy)"
}

cmd_uninstall() {
  require_macos
  unload_if_loaded
  if [[ -f "$PLIST" ]]; then
    rm -f "$PLIST"
    log "removed $PLIST"
  else
    warn "no plist at $PLIST"
  fi
  log "log dir kept at $LOG_DIR (delete manually if you want)"
}

cmd_status() {
  require_macos
  if is_loaded; then
    log "daemon loaded:"
    launchctl list | awk -v l="$LABEL" '$3==l {printf "  pid=%s status=%s label=%s\n", $1, $2, $3}'
  else
    warn "daemon NOT loaded ($LABEL)"
  fi
  if [[ -f "$LOG_DIR/out.log" ]]; then
    log "last 5 lines of out.log:"
    tail -n 5 "$LOG_DIR/out.log" | sed 's/^/  /'
  fi
}

# --- entrypoint ------------------------------------------------------------
case "${1:-install}" in
  ""|install) cmd_install ;;
  uninstall|remove) cmd_uninstall ;;
  status) cmd_status ;;
  *) die "unknown command: $1 (use install | uninstall | status)" ;;
esac
