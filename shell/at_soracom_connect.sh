#!/bin/bash
#
# AT直接制御によるSOCOM LTE接続スクリプト
#

DEVICE="/dev/ttyUSB2"
APN="soracom.io"
LOG_FILE="/tmp/at_soracom_connect.log"

log_at() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [SORACOM] $1" | tee -a $LOG_FILE
}

# ATコマンド送信関数
send_at() {
    local cmd="$1"
    local wait_time=${2:-2}

    log_at "送信: $cmd"
    echo -e "${cmd}\r" > $DEVICE
    sleep $wait_time
    timeout 3 cat < $DEVICE 2>/dev/null | tee -a $LOG_FILE
}

log_at "========================================="
log_at "  SORACOM AT直接制御接続開始"
log_at "========================================="

# デバイス確認
if [ ! -c "$DEVICE" ]; then
    log_at "ERROR: $DEVICE が見つかりません"
    exit 1
fi

log_at "=== ステップ1: モデム初期化 ==="
send_at "ATZ" 2
send_at "ATE0" 1

log_at "=== ステップ2: SIMとネットワーク確認 ==="
send_at "AT+CPIN?" 1
send_at "AT+CSQ" 1
send_at "AT+COPS?" 2

log_at "=== ステップ3: PDP Context設定（SORACOM） ==="
# PDP Context 1をIPv4専用、soracom.ioで設定（認証なし）
send_at "AT+CGDCONT=1,\"IP\",\"${APN}\"" 2
send_at "AT+CGDCONT?" 2

log_at "=== ステップ4: データコール有効化 ==="
send_at "AT+CGACT=1,1" 3
send_at "AT+CGACT?" 2

log_at "=== ステップ5: IPアドレス取得 ==="
send_at "AT+CGPADDR=1" 2
send_at "AT+CGCONTRDP=1" 3

log_at "=== ステップ6: 接続状態の詳細確認 ==="
send_at "AT!GSTATUS?" 3

log_at "========================================="
log_at "  SORACOM AT接続スクリプト完了"
log_at "========================================="

# IP設定適用
log_at "=== ステップ7: wwan0設定適用 ==="
if [ -x /usr/local/bin/soracom-ip-setup.sh ]; then
    /usr/local/bin/soracom-ip-setup.sh 2>&1 | tee -a $LOG_FILE
else
    log_at "WARN: soracom-ip-setup.sh not found"
fi

log_at "=== ステップ8: 接続テスト ==="
# WiFiルート一時削除
ip route del default via 192.168.3.1 dev wlan0 2>/dev/null

ip addr show wwan0 | tee -a $LOG_FILE
ip route show | tee -a $LOG_FILE

log_at "Ping test..."
if ping -c 3 -W 5 -I wwan0 8.8.8.8 2>&1 | tee -a $LOG_FILE | grep -q "0% packet loss"; then
    log_at "========================================="
    log_at "  ✓✓✓ SUCCESS!!! SORACOM接続成功！"
    log_at "========================================="
else
    log_at "WARN: Ping失敗"
fi

# WiFiルート復元
ip route add default via 192.168.3.1 dev wlan0 metric 100 2>/dev/null
