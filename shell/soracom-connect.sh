#!/bin/bash
# soracom-connect.sh

DEV="/dev/cdc-wdm0"
LOGFILE="/var/log/soracom.log"

echo "=== soracom-connect.sh started at $(date) ===" >> "$LOGFILE"

# 古い状態ファイルを削除（競合対策）
rm -f /tmp/mbim-network-state-$DEV

# 接続試行（3回までリトライ）
for i in {1..3}; do
    echo "[INFO] Attempting MBIM connection (try $i)..." >> "$LOGFILE"
    if /usr/bin/mbim-network $DEV start >> "$LOGFILE" 2>&1; then
        echo "[INFO] MBIM connection successful on try $i" >> "$LOGFILE"
        exit 0
    else
        echo "[WARN] MBIM connection failed on try $i" >> "$LOGFILE"
        sleep 3
    fi
done

echo "[ERROR] MBIM connection failed after 3 attempts." >> "$LOGFILE"
exit 1