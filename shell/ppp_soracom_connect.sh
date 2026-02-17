#!/bin/bash
#
# PPPダイヤルアップによるSOCOM LTE接続
# 古いファームウェアでも安定動作
#

DEVICE="/dev/ttyUSB0"
APN="soracom.io"
LOG_FILE="/var/log/ppp_connect.log"
PPP_PEERS_FILE="/etc/ppp/peers/soracom"
PPP_CHATSCRIPT="/etc/chatscripts/soracom"
STATE_FILE="/var/run/ppp_connected"

log_ppp() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [PPP] $1" | tee -a $LOG_FILE
}

# PPP接続設定ファイル作成
setup_ppp_config() {
    log_ppp "PPP設定ファイル作成中..."

    # peersファイル作成
    cat > /tmp/soracom << 'EOF'
# SORACOM PPP設定
/dev/ttyUSB0
115200
noauth
defaultroute
usepeerdns
persist
maxfail 3
holdoff 5
connect "/usr/sbin/chat -v -f /etc/chatscripts/soracom"
disconnect "/usr/sbin/chat -v ABORT 'ERROR' '' AT OK ATH0 OK"
nodetach
debug
EOF

    # chatscriptファイル作成
    cat > /tmp/soracom_chat << 'EOF'
ABORT 'BUSY'
ABORT 'NO CARRIER'
ABORT 'ERROR'
TIMEOUT 30
'' AT
OK ATZ
OK ATE0
OK AT+CGDCONT=1,"IP","soracom.io"
OK ATDT*99***1#
CONNECT \d\c
EOF

    # ファイルをシステムディレクトリにコピー
    cp /tmp/soracom $PPP_PEERS_FILE
    chmod 600 $PPP_PEERS_FILE

    mkdir -p /etc/chatscripts
    cp /tmp/soracom_chat $PPP_CHATSCRIPT
    chmod 600 $PPP_CHATSCRIPT

    log_ppp "PPP設定完了"
}

# PPP接続開始
ppp_connect() {
    log_ppp "========================================="
    log_ppp "  SORACOM PPP接続開始"
    log_ppp "========================================="

    # デバイス確認
    if [ ! -c "$DEVICE" ]; then
        log_ppp "ERROR: $DEVICE が見つかりません"
        return 1
    fi

    # 既存のpppd停止
    pkill -9 pppd 2>/dev/null
    sleep 2

    # 設定ファイル作成
    setup_ppp_config

    # LTEモード確認
    log_ppp "LTEモード確認中..."
    echo -e "AT!SELRAT?\r" > /dev/ttyUSB2
    sleep 1
    timeout 2 cat < /dev/ttyUSB2 | tee -a $LOG_FILE

    # PPP接続開始
    log_ppp "PPP接続開始..."
    pppd call soracom &
    PPP_PID=$!

    log_ppp "PPP起動 (PID: $PPP_PID)"

    # 接続確立を待つ（最大30秒）
    for i in {1..30}; do
        if ip addr show ppp0 2>/dev/null | grep -q "inet "; then
            log_ppp "PPP接続確立！"
            break
        fi
        sleep 1
    done

    # 接続確認
    if ip addr show ppp0 2>/dev/null | grep -q "inet "; then
        local ppp_ip=$(ip addr show ppp0 | grep "inet " | awk '{print $2}' | cut -d/ -f1)
        log_ppp "IP取得: $ppp_ip"

        # ルーティング設定
        log_ppp "ルーティング設定中..."

        # WiFi状態確認
        local wifi_state=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)

        if [ "$wifi_state" = "up" ] && ip addr show wlan0 2>/dev/null | grep -q "inet "; then
            # WiFi優先（metric 100）、LTE補助（metric 400）
            log_ppp "WiFi接続中 - WiFi優先ルート設定"

            # 既存のPPPデフォルトルートを削除
            ip route del default dev ppp0 2>/dev/null

            # WiFi優先ルート
            if ! ip route | grep -q "default.*wlan0.*metric 100"; then
                local wifi_gw=$(ip route | grep "^default.*wlan0" | awk '{print $3}' | head -1)
                [ -z "$wifi_gw" ] && wifi_gw="192.168.3.1"
                ip route add default via $wifi_gw dev wlan0 metric 100 2>/dev/null
                log_ppp "WiFiルート: via $wifi_gw metric 100"
            fi

            # LTE補助ルート
            ip route add default dev ppp0 metric 400 2>/dev/null
            log_ppp "LTEルート: dev ppp0 metric 400"
        else
            # WiFi未接続: LTE専用（metric 200）
            log_ppp "WiFi未接続 - LTE専用ルート"
            ip route del default dev ppp0 2>/dev/null
            ip route add default dev ppp0 metric 200
            log_ppp "LTEルート: dev ppp0 metric 200"
        fi

        log_ppp "現在のルート:"
        ip route show | tee -a $LOG_FILE

        # 接続テスト
        log_ppp "接続テスト中..."
        if ping -c 3 -W 3 -I ppp0 8.8.8.8 >/dev/null 2>&1; then
            log_ppp "========================================="
            log_ppp "  ✓✓✓ SUCCESS!!! PPP接続成功！"
            log_ppp "========================================="
            touch $STATE_FILE
            return 0
        else
            log_ppp "WARN: Ping失敗（ルーティング確認推奨）"
            touch $STATE_FILE
            return 0
        fi
    else
        log_ppp "ERROR: PPP接続失敗"
        return 1
    fi
}

# PPP切断
ppp_disconnect() {
    log_ppp "========================================="
    log_ppp "  PPP切断開始"
    log_ppp "========================================="

    pkill -TERM pppd 2>/dev/null
    sleep 2
    pkill -9 pppd 2>/dev/null

    ip route del default dev ppp0 2>/dev/null

    rm -f $STATE_FILE
    log_ppp "PPP切断完了"
}

# 状態確認
ppp_status() {
    if [ -f $STATE_FILE ] && pgrep -x pppd >/dev/null; then
        echo "PPP Status: Connected"
        ip addr show ppp0 2>/dev/null
        ip route show | grep ppp0
    else
        echo "PPP Status: Disconnected"
    fi
}

# メイン処理
case "$1" in
    connect)
        ppp_connect
        exit $?
        ;;
    disconnect)
        ppp_disconnect
        exit $?
        ;;
    status)
        ppp_status
        exit $?
        ;;
    *)
        echo "Usage: $0 {connect|disconnect|status}"
        exit 1
        ;;
esac
