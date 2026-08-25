#!/bin/bash
# 情報収集班 — とみーの今日（デスクトップ）
set -euo pipefail

VOLUME="/Volumes/外付け320GB"
DASH="$VOLUME/ai-intel/ready/DASHBOARD.html"
TOMMY="$VOLUME/ai-intel/agent/TOMMY.md"
ROOT="/Users/gig/Projects/comic-shelf/ai-intel"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

notify() {
  /usr/bin/osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null || true
}

alert() {
  /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with title \"情報収集班\"" 2>/dev/null || echo "$1"
}

if [[ ! -d "$VOLUME" ]]; then
  alert "外付け320GB が見つからないよ。\\nケーブルをつないでから、もう一度押してね。"
  exit 1
fi

notify "情報収集班" "画面を更新中…"
if [[ -d "$ROOT" ]]; then
  (cd "$ROOT" && npm run tommy) >/tmp/ai-intel-tommy-desktop.log 2>&1 || true
fi

if [[ -f "$DASH" ]]; then
  open "$DASH"
  notify "情報収集班" "とみー、班の画面を開いたよ"
elif [[ -f "$TOMMY" ]]; then
  open "$TOMMY"
  notify "情報収集班" "任務メモを開いたよ"
else
  alert "案内がまだないよ。\\nターミナルで:\\ncd ai-intel && npm run tommy"
  exit 1
fi

exit 0
