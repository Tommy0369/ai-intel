#!/bin/bash
# AI Intel 自動フル儀式: daily → finish → go → tommy → ship
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME="/Volumes/外付け320GB"
DATA="$VOLUME/ai-intel"
LOG_DIR="$DATA/daily/logs"
STATE_DIR="$DATA/state"
mkdir -p "$LOG_DIR" "$STATE_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DAY="$(date +%Y-%m-%d)"
LOG="$LOG_DIR/auto-$STAMP.log"
MODE="${1:-full}" # full | resume（dailyスキップして finish+go のみ）

{
  echo "==== ai-intel auto ($MODE) start $(date -Iseconds) ===="
  if [[ ! -d "$VOLUME" ]]; then
    echo "ERROR: 外付け320GB がマウントされていません"
    exit 1
  fi
  cd "$ROOT"

  if [[ "$MODE" == "full" ]]; then
    echo "▶ npm run daily"
    /usr/bin/env npm run daily
  else
    echo "▶ skip daily (resume)"
  fi

  echo "▶ npm run finish"
  /usr/bin/env npm run finish

  echo "▶ npm run go"
  /usr/bin/env npm run go

  echo "▶ npm run tommy"
  /usr/bin/env npm run tommy

  echo "▶ npm run intelligence"
  /usr/bin/env npm run intelligence

  echo "▶ npm run ship"
  /usr/bin/env npm run ship

  printf '%s\n' "$DAY" >"$STATE_DIR/last-daily-day.txt"
  printf '%s\n' "$DAY" >"$STATE_DIR/last-auto-day.txt"
  echo "==== ai-intel auto ($MODE) end $(date -Iseconds) ===="
} >>"$LOG" 2>&1
