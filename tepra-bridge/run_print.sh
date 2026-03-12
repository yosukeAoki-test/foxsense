#!/bin/bash
# 使用法: run_print.sh <text> <tapeMm>
# blueutil で接続確立してから print_worker.swift を新規プロセスで起動

set -e
MAC="74:d5:c6:6c:9a:96"
BLUEUTIL="/opt/homebrew/bin/blueutil"
WORKER="$(dirname "$0")/print_worker.swift"

echo "[run_print] BT切断..."
"$BLUEUTIL" --disconnect "$MAC" || true
sleep 3

echo "[run_print] BT接続..."
"$BLUEUTIL" --connect "$MAC" || { sleep 5; "$BLUEUTIL" --connect "$MAC"; }

# 接続確立まで最大20秒待機
for i in $(seq 1 20); do
  sleep 1
  if "$BLUEUTIL" --info "$MAC" 2>/dev/null | grep -q "connected"; then
    echo "[run_print] BT接続確認 (${i}秒)"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "[run_print] BT接続タイムアウト"
    exit 1
  fi
done

WORKER="$(dirname "$0")/print_worker_bin"

echo "[run_print] print_worker起動..."
"$WORKER" "$1" "$2"
echo "[run_print] 完了"
