#!/bin/bash
# 使用法: run_print.sh <text> <tapeMm>
# blueutil で接続確立してから print_worker.swift を新規プロセスで起動

set -e
MAC="74:d5:c6:6c:9a:96"
BLUEUTIL="/opt/homebrew/bin/blueutil"
WORKER="$(dirname "$0")/print_worker.swift"

echo "[run_print] BT切断..."
"$BLUEUTIL" --disconnect "$MAC" || true
sleep 5

echo "[run_print] BT接続..."
"$BLUEUTIL" --connect "$MAC" || { sleep 5; "$BLUEUTIL" --connect "$MAC"; }
sleep 3

WORKER="$(dirname "$0")/print_worker.swift"

echo "[run_print] print_worker起動..."
/usr/bin/swift "$WORKER" "$1" "$2"

echo "[run_print] カット確定中..."
sleep 2
"$BLUEUTIL" --disconnect "$MAC" || true
sleep 5
"$BLUEUTIL" --connect "$MAC" || { sleep 5; "$BLUEUTIL" --connect "$MAC"; }
sleep 2

CUTTER="$(dirname "$0")/cut_trigger.swift"
/usr/bin/swift "$CUTTER"
echo "[run_print] 完了"
