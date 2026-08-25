#!/bin/bash
# 毎朝9時 + 起床/接続キャッチアップ をまとめてインストール
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs/ai-intel"
mkdir -p "/Volumes/外付け320GB/ai-intel/daily/logs" 2>/dev/null || true
mkdir -p "/Volumes/外付け320GB/ai-intel/state" 2>/dev/null || true

chmod +x "$ROOT/scripts/daily.sh" "$ROOT/scripts/catchup.sh" "$ROOT/scripts/collect-resident.sh"

install_one() {
  local label="$1"
  local template="$ROOT/launchd/${label}.plist.template"
  local dest="$HOME/Library/LaunchAgents/${label}.plist"
  sed -e "s|__AI_INTEL_ROOT__|${ROOT}|g" -e "s|__HOME__|${HOME}|g" "$template" >"$dest"
  launchctl bootout "${DOMAIN}/${label}" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$dest"
  launchctl enable "${DOMAIN}/${label}"
  echo "✓ $label → $dest"
}

install_one "com.comic-shelf.ai-intel.daily"
install_one "com.comic-shelf.ai-intel.catchup"
install_one "com.comic-shelf.ai-intel.mount"
install_one "com.comic-shelf.ai-intel.resident"

echo ""
echo "スケジュール:"
echo "  • 毎朝 09:00          … auto（daily→finish→go→tommy→ship）"
echo "  • 60秒ごと            … 起床を検知して未完走なら auto"
echo "  • /Volumes 監視       … 外付け接続を検知して未完走なら auto"
echo "  • 30分ごと（常駐）    … collect → vet（鮮度・信憑性精査）"
echo ""
echo "精査期間: config.vetReviewHours（既定24時間）→ HDD vet/"
echo "解除: npm run schedule:uninstall"
echo "ログ: /Volumes/外付け320GB/ai-intel/daily/logs/"
