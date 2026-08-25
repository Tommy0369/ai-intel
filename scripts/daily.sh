#!/bin/bash
# launchd 互換ラッパー → 毎回 auto（daily→finish→go）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/auto.sh" full
