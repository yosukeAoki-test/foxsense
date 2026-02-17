#!/bin/bash
#
# EM7430 LTE完全接続スクリプト（以前の設定手順に基づく）
#

LOG_FILE="/var/log/lte_full_connect.log"

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [LTE_CONNECT] $1" | tee -a $LOG_FILE
}

log_msg "==========================================="
log_msg "  EM7430 SORACOM LTE接続開始"
log_msg "==========================================="

# Step 1: MBIM接続開始
log_msg "=== STEP 1: MBIM接続開始 ==="
mbim-network /dev/cdc-wdm0 start
MBIM_RESULT=$?

if [ $MBIM_RESULT -ne 0 ]; then
    log_msg "ERROR: MBIM接続失敗"
    exit 1
fi

log_msg "MBIM接続コマンド実行完了"
sleep 5

# Step 2: AT経由でIP/DNS情報取得
log_msg "=== STEP 2: IP/DNS情報取得 (AT+CGCONTRDP=1) ==="
stty -F /dev/ttyUSB2 115200 raw -echo 2>/dev/null
echo -e "AT+CGCONTRDP=1\r" > /dev/ttyUSB2
sleep 3
CGCONTRDP_RESULT=$(timeout 5 cat < /dev/ttyUSB2 2>/dev/null)

log_msg "AT応答:"
echo "$CGCONTRDP_RESULT" | tee -a $LOG_FILE

# IP/DNS解析
CGCONTRDP_LINE=$(echo "$CGCONTRDP_RESULT" | grep "+CGCONTRDP:" | tr -d '\r\n')
log_msg "CGCONTRDP行: $CGCONTRDP_LINE"

# フィールド抽出
IP=$(echo "$CGCONTRDP_LINE" | awk -F',' '{print $4}' | tr -d '" ' | awk -F'.' '{print $1"."$2"."$3"."$4}')
DNS=$(echo "$CGCONTRDP_LINE" | awk -F',' '{print $6}' | tr -d '" ')

log_msg "抽出IP: $IP"
log_msg "抽出DNS: $DNS"

if [ -z "$IP" ] || [ "$IP" = "..." ]; then
    log_msg "ERROR: IP未取得"
    exit 1
fi

# GW推定 (SORACOM /30 前提)
GW=$(echo "$IP" | awk -F. '{print $1"."$2"."$3"."($4+1)}')
log_msg "推定GW: $GW"

# Step 3: wwan0設定
log_msg "=== STEP 3: wwan0インターフェース設定 ==="
ip link set wwan0 up
ip addr flush dev wwan0 2>/dev/null
ip addr add ${IP}/30 dev wwan0

log_msg "IP設定完了: ${IP}/30"

# Step 4: ルーティング設定
log_msg "=== STEP 4: ルーティング設定 ==="
ip route del default dev wwan0 2>/dev/null
ip route add default via $GW dev wwan0 metric 200

log_msg "GW設定完了: via $GW metric 200"

# Step 5: DNS設定
log_msg "=== STEP 5: DNS設定 ==="
chattr -i /etc/resolv.conf 2>/dev/null
{
    echo "nameserver $DNS"
    echo "nameserver 8.8.8.8"
} > /etc/resolv.conf
chattr +i /etc/resolv.conf 2>/dev/null

log_msg "DNS設定完了"

# Step 6: 接続確認
log_msg "=== STEP 6: 接続テスト ==="
log_msg "インターフェース状態:"
ip addr show wwan0 | grep "inet " | tee -a $LOG_FILE

log_msg "ルート:"
ip route show | grep wwan0 | tee -a $LOG_FILE

log_msg ""
log_msg "Pingテスト (wwan0経由)..."
if ping -c 3 -W 5 -I wwan0 8.8.8.8; then
    log_msg ""
    log_msg "==========================================="
    log_msg "  ✓✓✓ SUCCESS!!! LTE接続成功！"
    log_msg "==========================================="
    exit 0
else
    log_msg "WARN: Ping失敗"
    exit 1
fi
