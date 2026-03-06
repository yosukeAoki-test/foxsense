#!/bin/bash
# TEPRA Bridge Launch Agent インストーラー
# 使用法: bash install.sh [API_URL] [BRIDGE_SECRET]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_SWIFT="$SCRIPT_DIR/bridge.swift"
API_URL="${1:-https://foxsense.smart-agri-vision.net/api}"
SECRET="${2:-dev-bridge-secret}"
LOG_DIR="$HOME/.foxsense/logs"
PLIST_NAME="com.foxsense.tepra-bridge"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "=== TEPRA Bridge Launch Agent インストール ==="
echo "  API URL: $API_URL"
echo "  ログ:    $LOG_DIR/"

mkdir -p "$LOG_DIR"

# plistを生成 (パスを置換)
sed \
  -e "s|BRIDGE_SWIFT_PATH|$BRIDGE_SWIFT|g" \
  -e "s|FOXSENSE_API_URL|$API_URL|g" \
  -e "s|BRIDGE_SECRET_VALUE|$SECRET|g" \
  -e "s|BRIDGE_LOG_DIR|$LOG_DIR|g" \
  "$SCRIPT_DIR/com.foxsense.tepra-bridge.plist" > "$PLIST_DEST"

echo "  plist:   $PLIST_DEST"

# 既存のエージェントをアンロード (エラー無視)
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# ロード・起動
launchctl load "$PLIST_DEST"

echo ""
echo "✅ インストール完了。ブリッジがバックグラウンドで起動しました。"
echo ""
echo "確認コマンド:"
echo "  launchctl list | grep foxsense   # 起動状態"
echo "  tail -f $LOG_DIR/bridge.log      # ログ"
echo ""
echo "停止・削除:"
echo "  launchctl unload $PLIST_DEST"
echo "  rm $PLIST_DEST"
