#!/usr/bin/env bash
# NotebookLM → Google Drive 出口のセットアップ
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/config/config.json"

echo "=== NotebookLM Drive セットアップ ==="
echo ""

# 1) Google Drive for desktop
if [[ -d "$HOME/Library/CloudStorage" ]] && ls "$HOME/Library/CloudStorage" 2>/dev/null | grep -qi '^GoogleDrive-'; then
  echo "✓ Google Drive for desktop を検出"
else
  echo "Google Drive for desktop が見つかりません。"
  if command -v brew >/dev/null 2>&1; then
    printf "brew でインストールしますか？ [y/N] "
    read -r ans || true
    if [[ "${ans:-}" =~ ^[yY]$ ]]; then
      brew install --cask google-drive
      echo ""
      echo "→ Google Drive を起動して Google アカウントでログインしてください。"
      open -a "Google Drive" 2>/dev/null || true
      echo "ログイン後、もう一度このスクリプトを実行してください。"
      exit 0
    fi
  fi
  echo "手動: https://www.google.com/drive/download/ から Drive for desktop を入れてログイン"
fi

# 2) My Drive パス解決
MY_DRIVE=""
for d in "$HOME"/Library/CloudStorage/GoogleDrive-*; do
  [[ -d "$d" ]] || continue
  if [[ -d "$d/My Drive" ]]; then
    MY_DRIVE="$d/My Drive"
    break
  fi
  if [[ -d "$d/マイドライブ" ]]; then
    MY_DRIVE="$d/マイドライブ"
    break
  fi
done

if [[ -z "$MY_DRIVE" ]]; then
  echo ""
  echo "まだ My Drive が見えません（ログイン／同期待ちの可能性）。"
  echo "代替: rclone config のあと config.json に"
  echo '  "googleDriveRcloneRemote": "gdrive:NotebookLM"'
  echo "を追加して npm run notebook:drive"
  exit 1
fi

TARGET="$MY_DRIVE/NotebookLM"
mkdir -p "$TARGET/inbox" "$TARGET/LATEST"
echo "✓ 公開先: $TARGET"

python3 - "$CONFIG" "$TARGET" <<'PY'
import json, sys
from pathlib import Path
cfg_path = Path(sys.argv[1])
target = sys.argv[2]
data = json.loads(cfg_path.read_text())
data["googleDriveNotebookRoot"] = target
cfg_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print("✓ config.json に googleDriveNotebookRoot を設定")
PY

echo ""
echo "次: cd \"$ROOT\" && npm run notebook:drive"
echo "（先に npm run notebook で本文付きフォルダを作っておく）"
