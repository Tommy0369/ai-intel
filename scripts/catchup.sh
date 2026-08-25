#!/bin/bash
# 起床・外付け接続を検知し、本日まだなら auto（daily→finish→go）を実行
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME="/Volumes/外付け320GB"
DATA="$VOLUME/ai-intel"
STATE_DIR="$DATA/state"
LOG_DIR="$DATA/daily/logs"
LOCK="/tmp/ai-intel-catchup.lock"
REASON="${1:-poll}"

mkdir -p "$LOG_DIR" 2>/dev/null || true

log() {
  local line="[$(date -Iseconds)] [$REASON] $*"
  echo "$line" >>"$LOG_DIR/catchup.log" 2>/dev/null || echo "$line"
}

if [[ ! -d "$VOLUME" ]]; then
  exit 0
fi

mkdir -p "$STATE_DIR" "$LOG_DIR"
TODAY="$(date +%Y-%m-%d)"
DONE_STAMP="$STATE_DIR/last-auto-day.txt"
WAKE_STAMP="$STATE_DIR/last-seen-waketime.txt"
BRIEF="$DATA/daily/$TODAY/BRIEF.md"
COMPLETE="$DATA/agent/COMPLETE.md"
TODAY_GO="$DATA/agent/TODAY_GO.md"
TOMMY="$DATA/agent/TOMMY.md"

auto_done_today() {
  [[ -f "$DONE_STAMP" ]] && [[ "$(cat "$DONE_STAMP" 2>/dev/null || true)" == "$TODAY" ]] &&
    [[ -f "$BRIEF" ]] && [[ -f "$COMPLETE" ]] && [[ -f "$TODAY_GO" ]] && [[ -f "$TOMMY" ]]
}

# 本日フル儀式が完了していれば何もしない
if auto_done_today; then
  exit 0
fi

WAKE_NOW="$(sysctl -n kern.waketime 2>/dev/null || echo unknown)"
WAKE_PREV="$(cat "$WAKE_STAMP" 2>/dev/null || echo "")"
WOKE=0
if [[ "$WAKE_NOW" != "$WAKE_PREV" ]]; then
  WOKE=1
fi
if [[ "$REASON" == "mount" ]]; then
  WOKE=1
fi
HOUR="$(date +%H)"
HOUR="${HOUR#0}"
# 9時以降で未完走、または BRIEF だけあって finish/go が欠けている
if [[ "$HOUR" -ge 9 ]] && ! auto_done_today; then
  WOKE=1
fi

if [[ "$WOKE" -ne 1 ]]; then
  printf '%s\n' "$WAKE_NOW" >"$WAKE_STAMP"
  exit 0
fi

if [[ -f "$LOCK" ]]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
  if [[ "$LOCK_AGE" -lt 7200 ]]; then
    log "skip: lock held (${LOCK_AGE}s)"
    exit 0
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

printf '%s\n' "$WAKE_NOW" >"$WAKE_STAMP"

# daily 済みで finish/go だけ欠けている → resume
MODE="full"
if [[ -f "$BRIEF" ]] && { [[ ! -f "$COMPLETE" ]] || [[ ! -f "$TODAY_GO" ]] || [[ ! -f "$TOMMY" ]]; }; then
  MODE="resume"
fi

log "trigger: auto ($MODE) wake/connect/overdue"
if bash "$ROOT/scripts/auto.sh" "$MODE"; then
  printf '%s\n' "$TODAY" >"$DONE_STAMP"
  log "success: auto ($MODE) completed for $TODAY"
else
  log "ERROR: auto ($MODE) failed"
  exit 1
fi
