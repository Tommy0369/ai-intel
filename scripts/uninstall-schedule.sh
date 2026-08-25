#!/bin/bash
set -euo pipefail
DOMAIN="gui/$(id -u)"
for label in \
  com.comic-shelf.ai-intel.daily \
  com.comic-shelf.ai-intel.catchup \
  com.comic-shelf.ai-intel.mount \
  com.comic-shelf.ai-intel.resident
do
  launchctl bootout "${DOMAIN}/${label}" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/${label}.plist"
  echo "✓ uninstalled ${label}"
done
