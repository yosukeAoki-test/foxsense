#!/bin/bash
#
# MBIM + AT ハイブリッド接続スクリプト
# ATでPDP確立 → MBIMでIP設定取得 → wwan0設定
#

DEVICE_MBIM="/dev/cdc-wdm0"
DEVICE_AT="/dev/ttyUSB2"
IFACE="wwan0"
APN="meeq.io"
LOG_FILE="/tmp/mbim_at_hybrid.log"

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [HYBRID] $1" | tee -a $LOG_FILE
}

log_msg "========================================="
log_msg "  MBIM+AT ハイブリッド接続開始"
log_msg "========================================="

# ステップ1: 全プロセスクリーンアップ
log_msg "=== ステップ1: クリーンアップ ==="
pkill -9 mbimcli qmicli 2>/dev/null
rm -f /tmp/mbim-network-state-* 2>/dev/null
ip link set $IFACE down 2>/dev/null
ip addr flush dev $IFACE 2>/dev/null
sleep 3

# ステップ2: ATでPDP Context有効化
log_msg "=== ステップ2: AT経由でPDP Context確立 ==="
echo -e "ATZ\r" > $DEVICE_AT && sleep 2 && timeout 2 cat < $DEVICE_AT > /dev/null 2>&1
echo -e "AT+CGDCONT=1,\"IP\",\"${APN}\"\r" > $DEVICE_AT && sleep 2 && timeout 2 cat < $DEVICE_AT > /dev/null 2>&1
echo -e "AT\$QCPDPP=1,1,\"meeq\",\"meeq\"\r" > $DEVICE_AT && sleep 2 && timeout 2 cat < $DEVICE_AT > /dev/null 2>&1

log_msg "PDP Context有効化中..."
echo -e "AT+CGACT=1,1\r" > $DEVICE_AT && sleep 3 && timeout 3 cat < $DEVICE_AT | tee -a $LOG_FILE

log_msg "PDP状態確認..."
echo -e "AT+CGACT?\r" > $DEVICE_AT && sleep 1
PDP_STATUS=$(timeout 2 cat < $DEVICE_AT)
log_msg "PDP Status: $PDP_STATUS"

if ! echo "$PDP_STATUS" | grep -q "+CGACT: 1,1"; then
    log_msg "ERROR: PDP Context有効化失敗"
    exit 1
fi

log_msg "SUCCESS: PDP Context有効化完了"

#ステップ3: MBIM経由でIP設定を取得
log_msg "=== ステップ3: MBIM経由でIP設定取得 ==="

# MBIMデバイスを開く
log_msg "MBIMデバイスオープン..."
MBIM_OPEN=$(timeout 10 mbimcli -d $DEVICE_MBIM --no-close --noop 2>&1)
log_msg "$MBIM_OPEN"

# Subscriber状態確認
log_msg "Subscriber状態確認..."
timeout 10 mbimcli -d $DEVICE_MBIM --query-subscriber-ready-status 2>&1 | tee -a $LOG_FILE

# IP設定を取得（セッションIDは1）
log_msg "IP設定取得中..."
IP_CONFIG=$(timeout 15 mbimcli -d $DEVICE_MBIM --query-ip-configuration --no-open 2>&1)
log_msg "$IP_CONFIG"

# IPアドレス抽出
IP_ADDR=$(echo "$IP_CONFIG" | grep "IPv4 address" | awk -F": " '{print $2}' | tr -d ' ' | head -1)
DNS1=$(echo "$IP_CONFIG" | grep "DNS \[0\]" | awk -F": " '{print $2}' | tr -d "'\" " | head -1)
DNS2=$(echo "$IP_CONFIG" | grep "DNS \[1\]" | awk -F": " '{print $2}' | tr -d "'\" " | head -1)
MTU=$(echo "$IP_CONFIG" | grep "MTU" | awk '{print $2}' | tr -d ' ')

# IP取得失敗時はATから取得
if [ -z "$IP_ADDR" ] || [ "$IP_ADDR" = "0.0.0.0" ]; then
    log_msg "MBIM経由でのIP取得失敗、AT経由で再試行..."

    echo -e "AT+CGCONTRDP=1\r" > $DEVICE_AT && sleep 2
    AT_RESPONSE=$(timeout 3 cat < $DEVICE_AT)
    log_msg "AT Response: $AT_RESPONSE"

    IP_ADDR=$(echo "$AT_RESPONSE" | grep "+CGCONTRDP:" | awk -F',' '{print $4}' | tr -d '\"' | head -1)
    DNS1=$(echo "$AT_RESPONSE" | grep "+CGCONTRDP:" | awk -F',' '{print $6}' | tr -d '\"' | head -1)
    DNS2=$(echo "$AT_RESPONSE" | grep "+CGCONTRDP:" | awk -F',' '{print $7}' | tr -d '\"' | head -1)
fi

if [ -z "$IP_ADDR" ] || [ "$IP_ADDR" = "0.0.0.0" ]; then
    log_msg "ERROR: IP取得完全失敗"
    exit 1
fi

log_msg "取得成功:"
log_msg "  IP: $IP_ADDR"
log_msg "  DNS1: $DNS1"
log_msg "  DNS2: $DNS2"
log_msg "  MTU: $MTU"

# ステップ4: wwan0インターフェース設定
log_msg "=== ステップ4: wwan0設定 ==="

ip link set $IFACE up
[ -n "$IP_ADDR" ] && ip addr add ${IP_ADDR}/32 dev $IFACE
[ -n "$MTU" ] && [ "$MTU" != "0" ] && ip link set $IFACE mtu $MTU || ip link set $IFACE mtu 1428

# デフォルトルート
ip route del default dev $IFACE 2>/dev/null
ip route add default dev $IFACE metric 200

log_msg "wwan0設定完了"
ip addr show $IFACE | tee -a $LOG_FILE
ip route show | tee -a $LOG_FILE

# ステップ5: 接続テスト
log_msg "=== ステップ5: 接続テスト ==="

# WiFiルートを一時削除
ip route del default via 192.168.3.1 dev wlan0 2>/dev/null

log_msg "LTE経由でPingテスト..."
if ping -c 3 -W 5 -I $IFACE 8.8.8.8 >/dev/null 2>&1; then
    log_msg "========================================="
    log_msg "  ✓✓✓ SUCCESS!!! データ通信確立！"
    log_msg "========================================="

    # WiFiルート復元
    ip route add default via 192.168.3.1 dev wlan0 metric 100 2>/dev/null

    exit 0
else
    log_msg "WARN: Ping失敗"

    # WiFiルート復元
    ip route add default via 192.168.3.1 dev wlan0 metric 100 2>/dev/null

    exit 1
fi
