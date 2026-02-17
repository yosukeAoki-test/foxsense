#!/bin/bash
#
# Quectel EG25-G/EC25 PPP接続スクリプト
# wvdialを使用したSORACAOM LTE接続
#

LOG_FILE="/tmp/ppp_connect.log"
STATE_FILE="/var/run/ppp_connected"
WVDIAL_CONF="/etc/wvdial.conf"
PPP_PORT="/dev/ttyUSB3"
AT_PORT="/dev/ttyUSB2"

# ログ関数
log_ppp() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [PPP] $1" | tee -a $LOG_FILE
}

# wvdial設定確認・作成
setup_wvdial_config() {
    log_ppp "wvdial設定確認中..."

    # 設定ファイルが存在しない、または不完全な場合は作成
    if [ ! -f "$WVDIAL_CONF" ] || ! grep -q "soracom.io" "$WVDIAL_CONF" 2>/dev/null; then
        log_ppp "wvdial設定ファイル作成中..."

        cat > "$WVDIAL_CONF" << 'EOF'
[Dialer Defaults]
Init1 = AT+CFUN=1
Init2 = ATZ
Init3 = AT+CGDCONT=1,"IP","soracom.io"
Dial Attempts = 3
Stupid Mode = 1
Modem Type = Analog Modem
Dial Command = ATD
Stupid Mode = yes
Baud = 460800
New PPPD = yes
ISDN = 0
APN = soracom.io
Phone = *99***1#
Username = sora
Password = sora
Carrier Check = no
Auto DNS = 1
Check Def Route = 1
Modem = /dev/ttyUSB3
EOF
        log_ppp "wvdial設定ファイル作成完了"
    else
        log_ppp "wvdial設定ファイル確認OK"
    fi
}

# PPP/CHAP認証設定確認
setup_ppp_secrets() {
    # chap-secretsにsoracom設定があるか確認
    if ! grep -q "^sora" /etc/ppp/chap-secrets 2>/dev/null; then
        log_ppp "chap-secrets設定追加中..."
        echo "sora	*	sora" >> /etc/ppp/chap-secrets
    fi
}

# モデム初期化
init_modem() {
    log_ppp "モデム初期化中..."

    # 既存プロセス停止
    pkill -9 wvdial 2>/dev/null
    pkill -9 pppd 2>/dev/null
    sleep 1

    # ATポートでモデム確認
    if [ -e "$AT_PORT" ]; then
        echo -e "AT\r" > "$AT_PORT"
        sleep 0.5
        local response=$(timeout 2 head -3 "$AT_PORT" 2>/dev/null)
        if echo "$response" | grep -q "OK"; then
            log_ppp "モデム応答確認OK"
        else
            log_ppp "WARN: モデム応答なし"
        fi

        # ネットワーク登録確認
        echo -e "AT+CREG?\r" > "$AT_PORT"
        sleep 0.5
        local creg=$(timeout 2 head -5 "$AT_PORT" 2>/dev/null | grep "+CREG")
        log_ppp "ネットワーク登録: $creg"
    fi

    return 0
}

# PPP接続実行
ppp_connect() {
    log_ppp "========================================="
    log_ppp "  PPP接続開始 (Quectel/wvdial)"
    log_ppp "========================================="

    # PPPポート確認
    if [ ! -c "$PPP_PORT" ]; then
        log_ppp "ERROR: $PPP_PORT が見つかりません"
        return 1
    fi

    # 設定確認
    setup_wvdial_config
    setup_ppp_secrets

    # モデム初期化
    init_modem

    # wvdial実行（バックグラウンド）
    log_ppp "wvdial接続開始..."
    wvdial >> /tmp/wvdial.log 2>&1 &
    local WVDIAL_PID=$!

    log_ppp "wvdial起動 (PID: $WVDIAL_PID)"

    # 接続確立待機（最大45秒）
    local wait_count=0
    local max_wait=45

    while [ $wait_count -lt $max_wait ]; do
        if ip addr show ppp0 2>/dev/null | grep -q "inet "; then
            log_ppp "PPP接続確立！"
            break
        fi
        sleep 1
        wait_count=$((wait_count + 1))

        # 15秒ごとに進捗表示
        if [ $((wait_count % 15)) -eq 0 ]; then
            log_ppp "接続待機中... ${wait_count}/${max_wait}秒"
        fi
    done

    # 接続確認
    if ip addr show ppp0 2>/dev/null | grep -q "inet "; then
        local ppp_ip=$(ip addr show ppp0 | grep "inet " | awk '{print $2}' | cut -d/ -f1)
        log_ppp "IP取得: $ppp_ip"

        # ルーティング設定
        setup_routing

        # 接続テスト
        log_ppp "接続テスト中..."
        if ping -c 3 -W 5 -I ppp0 8.8.8.8 >/dev/null 2>&1; then
            log_ppp "========================================="
            log_ppp "  PPP接続成功！"
            log_ppp "========================================="
            touch $STATE_FILE
            return 0
        else
            log_ppp "WARN: ping失敗（接続自体は確立）"
            touch $STATE_FILE
            return 0
        fi
    else
        log_ppp "ERROR: PPP接続タイムアウト"
        pkill -9 wvdial 2>/dev/null
        return 1
    fi
}

# ルーティング設定
setup_routing() {
    log_ppp "ルーティング設定中..."

    # WiFi状態確認
    local wifi_state=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)

    if [ "$wifi_state" = "up" ] && ip addr show wlan0 2>/dev/null | grep -q "inet "; then
        # WiFi優先（metric 100）、LTE補助（metric 400）
        log_ppp "WiFi接続中 - WiFi優先ルート設定"

        # 既存のPPPデフォルトルートを削除
        ip route del default dev ppp0 2>/dev/null

        # WiFi優先ルート
        local wifi_gw=$(ip route | grep "^default.*wlan0" | awk '{print $3}' | head -1)
        [ -z "$wifi_gw" ] && wifi_gw="192.168.3.1"

        if ! ip route | grep -q "default.*wlan0.*metric 100"; then
            ip route add default via $wifi_gw dev wlan0 metric 100 2>/dev/null
        fi

        # LTE補助ルート
        ip route add default dev ppp0 metric 400 2>/dev/null
        log_ppp "WiFi: metric 100, LTE: metric 400"
    else
        # WiFi未接続: LTE専用（metric 200）
        log_ppp "WiFi未接続 - LTE専用ルート"
        ip route del default dev ppp0 2>/dev/null
        ip route add default dev ppp0 metric 200
        log_ppp "LTE: metric 200"
    fi

    # DNS設定
    setup_dns
}

# DNS設定
setup_dns() {
    log_ppp "DNS設定中..."

    # resolv.conf更新
    cat > /etc/resolv.conf << EOF
nameserver 8.8.8.8
nameserver 8.8.4.4
EOF

    log_ppp "DNS設定完了"
}

# PPP切断
ppp_disconnect() {
    log_ppp "========================================="
    log_ppp "  PPP切断開始"
    log_ppp "========================================="

    # wvdial/pppd停止
    pkill -TERM wvdial 2>/dev/null
    sleep 2
    pkill -9 wvdial 2>/dev/null
    pkill -9 pppd 2>/dev/null

    # ルート削除
    ip route del default dev ppp0 2>/dev/null
    ip route del default dev ppp0 metric 200 2>/dev/null
    ip route del default dev ppp0 metric 400 2>/dev/null

    rm -f $STATE_FILE
    log_ppp "PPP切断完了"
    return 0
}

# 状態確認
ppp_status() {
    if [ -f $STATE_FILE ] && pgrep -x pppd >/dev/null; then
        echo "status=connected"
        local ppp_ip=$(ip addr show ppp0 2>/dev/null | grep "inet " | awk '{print $2}')
        echo "ip=$ppp_ip"
        echo "interface=ppp0"
        return 0
    else
        echo "status=disconnected"
        return 1
    fi
}

# 診断情報取得
ppp_diagnose() {
    log_ppp "=== PPP診断情報 ==="

    log_ppp "--- デバイス状態 ---"
    ls -la /dev/ttyUSB* 2>/dev/null | while read line; do log_ppp "  $line"; done

    log_ppp "--- モデム情報 ---"
    if [ -e "$AT_PORT" ]; then
        echo -e "ATI\r" > "$AT_PORT"
        sleep 0.5
        timeout 2 head -10 "$AT_PORT" 2>/dev/null | while read line; do log_ppp "  $line"; done
    fi

    log_ppp "--- ネットワーク状態 ---"
    if [ -e "$AT_PORT" ]; then
        echo -e "AT+COPS?\r" > "$AT_PORT"
        sleep 0.5
        timeout 2 head -5 "$AT_PORT" 2>/dev/null | while read line; do log_ppp "  $line"; done
    fi

    log_ppp "--- PPP状態 ---"
    ip addr show ppp0 2>/dev/null | while read line; do log_ppp "  $line"; done

    log_ppp "--- ルーティング ---"
    ip route show | while read line; do log_ppp "  $line"; done
}

# メイン処理
case "$1" in
    "connect")
        ppp_connect
        exit $?
        ;;
    "disconnect")
        ppp_disconnect
        exit $?
        ;;
    "status")
        ppp_status
        exit $?
        ;;
    "diagnose")
        ppp_diagnose
        exit $?
        ;;
    *)
        echo "Usage: $0 {connect|disconnect|status|diagnose}"
        echo "  connect    - PPP接続開始"
        echo "  disconnect - PPP切断"
        echo "  status     - 接続状態確認"
        echo "  diagnose   - 診断情報表示"
        exit 1
        ;;
esac
