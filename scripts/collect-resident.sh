#!/bin/bash
# 常駐収集（launchd から定期実行）: fleet patrol → vet → links
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME="/Volumes/外付け320GB"
DATA="$VOLUME/ai-intel"
HOME_LOG="$HOME/Library/Logs/ai-intel"
mkdir -p "$HOME_LOG"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
LOG="$HOME_LOG/resident-$STAMP.log"

# HDD にも控え（マウント時のみ）
if [[ -d "$DATA" ]]; then
  mkdir -p "$DATA/daily/logs"
  ln -sfn "$LOG" "$DATA/daily/logs/resident-latest.log" 2>/dev/null || true
fi

{
  echo "==== resident collect $(date -Iseconds) ===="
  if [[ ! -d "$VOLUME" ]]; then
    echo "SKIP: 外付け320GB 未マウント"
    exit 0
  fi
  cd "$ROOT"
  # launchd の PATH でも npm を見つける
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm が見つからない"
    exit 1
  fi
  /usr/bin/env npm run collect -- --profile=patrol
  /usr/bin/env npm run vet
  /usr/bin/env npm run dup:watch
  /usr/bin/env npm run links
  echo "==== resident end $(date -Iseconds) ===="
} >>"$LOG" 2>&1
