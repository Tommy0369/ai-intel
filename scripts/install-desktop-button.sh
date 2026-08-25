#!/bin/bash
# デスクトップに「とみーの今日」ボタンを常備する
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/scripts/tommy-desktop.command"
DESKTOP="$HOME/Desktop"
NAME="とみーの今日.command"
DEST="$DESKTOP/$NAME"
APP_DIR="$DESKTOP/とみーの今日.app"

chmod +x "$SRC"

# 1) ダブルクリック用 .command
cp "$SRC" "$DEST"
chmod +x "$DEST"
# Gatekeeper / quarantine を外す（デスクトップ実行用）
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true

# 2) 見た目がボタンっぽい .app（AppleScript）
TMP_SCRIPT="$(mktemp /tmp/tommy-desktop.XXXXXX.applescript)"
cat >"$TMP_SCRIPT" <<'APPLESCRIPT'
on run
  set cmd to "bash " & quoted form of "/Users/gig/Projects/comic-shelf/ai-intel/scripts/tommy-desktop.command"
  do shell script cmd
end run
APPLESCRIPT

# 既存アプリを置き換え
rm -rf "$APP_DIR"
/usr/bin/osacompile -o "$APP_DIR" "$TMP_SCRIPT" 2>/dev/null || true
rm -f "$TMP_SCRIPT"

# app 内のスクリプトパスは固定ROOTを使うよう再生成（osacompile成功時）
if [[ -d "$APP_DIR" ]]; then
  # アイコンっぽくするため名前はそのまま
  xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true
fi

echo "✓ デスクトップに置いたよ"
echo "  1) $DEST"
if [[ -d "$APP_DIR" ]]; then
  echo "  2) $APP_DIR  ← ダブルクリック用アプリ"
fi
echo ""
echo "とみーはデスクトップの『とみーの今日』を押せばOK。"
