#!/bin/bash

# prefer_wifi.sh - Wi-Fi優先のルート設定スクリプト（LTEはバックアップ）

IP_CMD="/sbin/ip"
GREP_CMD="/bin/grep"
AWK_CMD="/usr/bin/awk"
MBIM_CMD=$(which mbim-network || echo "/usr/bin/mbim-network")

LOGFILE="/var/log/prefer_wifi.log"
echo "=== prefer_wifi.sh started at $(date) ===" >> "$LOGFILE"

# 実行環境確認ログ
echo "[DEBUG] PATH: $PATH" >> "$LOGFILE"
echo "[DEBUG] User: $(whoami)" >> "$LOGFILE"

# インターフェース起動確認（UPまたはUNKNOWNを許容）
for i in {1..30}; do
    WLAN_STATE=$($IP_CMD link show wlan0 | $GREP_CMD -E "state (UP|UNKNOWN)")
    WWAN_STATE=$($IP_CMD link show wwan0 | $GREP_CMD -E "state (UP|UNKNOWN)")
    if [[ -n "$WLAN_STATE" && -n "$WWAN_STATE" ]]; then
        echo "[INFO] Both interfaces are up or unknown (attempt $i)" >> "$LOGFILE"
        break
    fi
    echo "[WAIT] Waiting for interfaces... (attempt $i)" >> "$LOGFILE"
    sleep 2
done

# Wi-Fiゲートウェイ検出
WIFI_GW=$($IP_CMD route | $GREP_CMD "default via" | $GREP_CMD "wlan0" | $AWK_CMD '{print $3}')

# LTE IP検出
LTE_IP=$($IP_CMD addr show wwan0 | $GREP_CMD "inet " | $AWK_CMD '{print $2}' | cut -d/ -f1)
echo "[DEBUG] LTE IP detected (pre-check): $LTE_IP" >> "$LOGFILE"

# MBIM接続が必要な場合の自動処理
if [[ -z "$LTE_IP" ]]; then
    echo "[INFO] No LTE IP found, attempting MBIM connection..." >> "$LOGFILE"
    if $MBIM_CMD /dev/cdc-wdm0 start >> "$LOGFILE" 2>&1; then
        echo "[INFO] MBIM connection successful" >> "$LOGFILE"
        sleep 5
    else
        echo "[ERROR] MBIM connection failed" >> "$LOGFILE"
    fi

    # 再取得
    LTE_IP=$($IP_CMD addr show wwan0 | $GREP_CMD "inet " | $AWK_CMD '{print $2}' | cut -d/ -f1)
    echo "[DEBUG] LTE IP detected (post-MBIM): $LTE_IP" >> "$LOGFILE"
fi

# IP未取得ならDHCP試行（mbim-networkがDHCP非対応な場合）
if [[ -z "$LTE_IP" ]]; then
    echo "[INFO] Attempting DHCP on wwan0..." >> "$LOGFILE"
    dhclient wwan0 || udhcpc -i wwan0
    sleep 3
    LTE_IP=$($IP_CMD addr show wwan0 | $GREP_CMD "inet " | $AWK_CMD '{print $2}' | cut -d/ -f1)
    echo "[DEBUG] LTE IP detected (post-DHCP): $LTE_IP" >> "$LOGFILE"
fi

# LTE IP確認のみ（ゲートウェイ推定は削除）
if [[ -n "$LTE_IP" ]]; then
    echo "[INFO] LTE IP address found: $LTE_IP" >> "$LOGFILE"
else
    echo "[WARN] LTE IP address not found after MBIM and DHCP attempts" >> "$LOGFILE"
fi

# Wi-Fiルート設定（metric 100）
if [[ -n "$WIFI_GW" ]]; then
    $IP_CMD route replace default via "$WIFI_GW" dev wlan0 metric 100 && \
    echo "[INFO] Wi-Fi default route set via $WIFI_GW" >> "$LOGFILE"
else
    echo "[WARN] No Wi-Fi gateway found" >> "$LOGFILE"
fi

# LTEルート設定（metric 200） - Point-to-Point接続のためゲートウェイ指定なし
if [[ -n "$LTE_IP" ]]; then
    $IP_CMD route add default dev wwan0 metric 200 2>/dev/null && \
    echo "[INFO] LTE default route set (Point-to-Point connection)" >> "$LOGFILE"
else
    echo "[WARN] No LTE route could be set - IP address not found" >> "$LOGFILE"
fi

# サマリ出力とルーティングテーブル表示
echo "[SUMMARY] Wi-Fi: $WIFI_GW (metric 100), LTE: Point-to-Point (metric 200)" >> "$LOGFILE"
$IP_CMD route >> "$LOGFILE"
echo "=== prefer_wifi.sh completed at $(date) ===" >> "$LOGFILE"
echo "" >> "$LOGFILE"