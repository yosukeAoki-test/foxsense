#!/bin/bash
#
# 統合LTE接続スクリプト
# 対応モデム:
#   - Sierra Wireless EM7430 (MBIM)
#   - Soracom AK-020 (MBIM/AT)
#   - Quectel EG25-G / EC25 (PPP)
#

set -e

# 設定
LOG_FILE="/var/log/lte_connect.log"
CONF_FILE="/etc/lte-connect.conf"
IFACE="wwan0"
DEVICE="/dev/cdc-wdm0"

# デフォルトAPN設定
APN="${APN:-soracom.io}"
APN_USER="${APN_USER:-sora}"
APN_PASS="${APN_PASS:-sora}"

# モデムタイプ
MODEM_TYPE=""
AT_PORT=""

# 設定ファイル読み込み
if [ -f "$CONF_FILE" ]; then
    source "$CONF_FILE"
fi

# ログ関数
log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [LTE] $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [LTE] ERROR: $1" | tee -a "$LOG_FILE" >&2
}

# モデム検出
detect_modem() {
    log_msg "モデム検出中..."

    local usb_devices=$(lsusb 2>/dev/null)

    # EM7430検出 (Sierra Wireless)
    if echo "$usb_devices" | grep -qiE "1199:9071|1199:907d|1199:9079|Sierra.*EM74"; then
        if [ -e /dev/cdc-wdm0 ]; then
            MODEM_TYPE="em7430"
            AT_PORT="/dev/ttyUSB2"
            IFACE="wwan0"
            log_msg "検出: EM7430 (MBIM)"
            return 0
        fi
    fi

    # AK-020検出 (Soracom/ABIT)
    if echo "$usb_devices" | grep -qiE "15eb:7d0e|AK-020|ABIT"; then
        if [ -e /dev/cdc-wdm0 ]; then
            MODEM_TYPE="ak020"
            AT_PORT="/dev/ttyUSB1"
            IFACE="wwan0"
            log_msg "検出: AK-020 (MBIM/AT)"
            return 0
        fi
    fi

    # Quectel検出
    if echo "$usb_devices" | grep -qi "2c7c:0125\|Quectel"; then
        if ls /dev/ttyUSB* >/dev/null 2>&1; then
            MODEM_TYPE="quectel"
            AT_PORT="/dev/ttyUSB2"
            IFACE="ppp0"
            log_msg "検出: Quectel (PPP)"
            return 0
        fi
    fi

    log_error "LTEモデム未検出"
    return 1
}

# ATコマンド送信
send_at_command() {
    local cmd="$1"
    local timeout_sec="${2:-3}"
    local port="${AT_PORT:-/dev/ttyUSB1}"

    if [ ! -e "$port" ]; then
        log_error "ATポート $port が見つかりません"
        return 1
    fi

    # シリアルポート設定
    stty -F "$port" 9600 raw -echo 2>/dev/null || true

    # コマンド送信と応答取得
    {
        echo -e "${cmd}\r"
        sleep "$timeout_sec"
    } > "$port" &

    local result=$(timeout "$timeout_sec" cat "$port" 2>/dev/null | tr -d '\r' | grep -v "^$" | head -20)
    wait 2>/dev/null

    echo "$result"
}

# SIM状態確認
check_sim_status() {
    log_msg "SIM状態確認中..."

    local sim_status=$(send_at_command "AT+CPIN?" 3)

    if echo "$sim_status" | grep -q "+CPIN: READY"; then
        log_msg "SIM: READY"
        return 0
    else
        log_error "SIM未準備: $sim_status"
        return 1
    fi
}

# ネットワーク登録確認
check_network_registration() {
    log_msg "ネットワーク登録確認中..."

    local reg_status=$(send_at_command "AT+CGREG?" 3)

    # +CGREG: n,1 または +CGREG: n,5 が登録済み (スペース対応)
    if echo "$reg_status" | grep -qE "\+CGREG: [0-9], ?[15]"; then
        log_msg "ネットワーク: 登録済み"
        return 0
    else
        log_error "ネットワーク未登録: $reg_status"
        return 1
    fi
}

# ATコマンドでPDPコンテキスト設定・接続
at_connect() {
    log_msg "ATコマンドで接続中..."

    # APN設定
    log_msg "APN設定: $APN"
    send_at_command "AT+CGDCONT=1,\"IP\",\"${APN}\"" 2

    # PDPコンテキスト有効化を試行
    log_msg "PDPコンテキスト有効化..."
    local activate_result=$(send_at_command "AT+CGACT=1,1" 5)

    if echo "$activate_result" | grep -q "OK"; then
        log_msg "PDPコンテキスト有効化成功"
        return 0
    elif echo "$activate_result" | grep -q "ERROR"; then
        # MBIMモードの場合、AT+CGACTは失敗する可能性あり
        # wwan0インターフェースを直接使用
        log_msg "AT+CGACT失敗、MBIMモードで継続..."
    fi

    return 0
}

# ATコマンドでIP情報取得
get_ip_from_at() {
    log_msg "IP情報取得中..."

    local ip_info=$(send_at_command "AT+CGPADDR=1" 3)

    # +CGPADDR: 1,"10.xxx.xxx.xxx" 形式
    local ip_addr=$(echo "$ip_info" | grep "+CGPADDR" | sed 's/.*"\([0-9.]*\)".*/\1/')

    if [ -n "$ip_addr" ] && [ "$ip_addr" != "0.0.0.0" ]; then
        log_msg "取得IP: $ip_addr"
        echo "$ip_addr"
        return 0
    fi

    # AT+CGCONTRDP でより詳細な情報取得
    local rdp_info=$(send_at_command "AT+CGCONTRDP=1" 5)
    ip_addr=$(echo "$rdp_info" | grep "+CGCONTRDP" | awk -F',' '{print $4}' | tr -d '"')

    if [ -n "$ip_addr" ] && [ "$ip_addr" != "0.0.0.0" ]; then
        log_msg "取得IP (RDP): $ip_addr"
        echo "$ip_addr"
        return 0
    fi

    log_error "IP取得失敗"
    return 1
}

# MBIM接続（mbimcliが利用可能な場合）
mbim_connect() {
    if ! command -v mbimcli &>/dev/null; then
        log_msg "mbimcli未インストール、ATコマンド方式を使用"
        return 1
    fi

    log_msg "MBIM接続中..."

    # ModemManager停止
    systemctl stop ModemManager 2>/dev/null || true

    # 既存プロセスクリーンアップ
    pkill -9 mbimcli 2>/dev/null || true
    pkill -9 -f "mbim-network" 2>/dev/null || true
    rm -f /tmp/mbim-network-state-* 2>/dev/null

    # mbim-network設定ファイル作成
    cat > /etc/mbim-network.conf << EOF
APN=${APN}
PROXY=no
IP_TYPE=ipv4
EOF

    # 接続実行
    if command -v mbim-network &>/dev/null; then
        mbim-network "$DEVICE" start >/dev/null 2>&1
        local result=$?
        if [ $result -eq 0 ]; then
            log_msg "MBIM接続成功"
            return 0
        fi
    fi

    # mbimcli直接接続
    local connect_output=$(timeout 30 mbimcli -d "$DEVICE" --connect="apn=${APN}" 2>&1)

    if echo "$connect_output" | grep -qi "successfully\|connected"; then
        log_msg "MBIM接続成功 (mbimcli)"
        return 0
    fi

    log_error "MBIM接続失敗"
    return 1
}

# インターフェース設定
configure_interface() {
    local ip_addr="$1"

    log_msg "インターフェース $IFACE 設定中..."

    # インターフェースアップ
    ip link set "$IFACE" up 2>/dev/null

    # 既存IP削除
    ip addr flush dev "$IFACE" 2>/dev/null

    # IP設定
    if [ -n "$ip_addr" ]; then
        ip addr add "${ip_addr}/32" dev "$IFACE" 2>/dev/null
        log_msg "IP設定: ${ip_addr}/32"
    fi

    # MTU設定（LTE最適値）
    ip link set "$IFACE" mtu 1428 2>/dev/null

    return 0
}

# ルーティング設定
configure_routing() {
    log_msg "ルーティング設定中..."

    # 既存のwwan0ルートを削除
    ip route del default dev "$IFACE" 2>/dev/null || true

    # WiFi状態確認
    local wifi_state=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)

    if [ "$wifi_state" = "up" ] && ip addr show wlan0 2>/dev/null | grep -q "inet "; then
        # WiFi接続中: WiFi優先、LTE補助
        log_msg "WiFi検出 - WiFi優先ルート設定"

        local wifi_gw=$(ip route | grep "^default.*wlan0" | awk '{print $3}' | head -1)
        if [ -z "$wifi_gw" ]; then
            wifi_gw="192.168.3.1"
        fi

        ip route del default 2>/dev/null || true
        ip route add default via "$wifi_gw" dev wlan0 metric 100 2>/dev/null
        ip route add default dev "$IFACE" metric 400 2>/dev/null

        log_msg "ルート: WiFi(metric 100) + LTE(metric 400)"
    else
        # WiFi未接続: LTE専用
        log_msg "WiFi未検出 - LTE専用ルート設定"

        ip route del default 2>/dev/null || true
        ip route add default dev "$IFACE" metric 200 2>/dev/null

        log_msg "ルート: LTE(metric 200)"
    fi

    return 0
}

# DNS設定
configure_dns() {
    log_msg "DNS設定中..."

    cat > /etc/resolv.conf << EOF
nameserver 8.8.8.8
nameserver 8.8.4.4
EOF

    log_msg "DNS: 8.8.8.8, 8.8.4.4"
}

# 接続テスト
test_connection() {
    log_msg "接続テスト中..."

    local retry=0
    local max_retry=3

    while [ $retry -lt $max_retry ]; do
        if ping -c 2 -W 3 -I "$IFACE" 8.8.8.8 >/dev/null 2>&1; then
            log_msg "接続テスト成功"
            return 0
        fi
        retry=$((retry + 1))
        log_msg "接続テスト失敗 (リトライ $retry/$max_retry)"
        sleep 2
    done

    log_error "接続テスト失敗"
    return 1
}

# メイン接続処理
main_connect() {
    log_msg "========================================="
    log_msg "  LTE接続開始"
    log_msg "========================================="

    # モデム検出
    if ! detect_modem; then
        return 1
    fi

    # SIM確認
    if ! check_sim_status; then
        return 1
    fi

    # ネットワーク登録確認
    if ! check_network_registration; then
        log_msg "ネットワーク登録待機中..."
        sleep 5
        if ! check_network_registration; then
            return 1
        fi
    fi

    local ip_addr=""

    # モデムタイプ別接続
    case "$MODEM_TYPE" in
        "em7430")
            # EM7430: MBIM優先
            if mbim_connect; then
                # MBIM接続成功、IP取得
                sleep 2
                ip_addr=$(get_ip_from_at)
            else
                # ATコマンドフォールバック
                at_connect
                ip_addr=$(get_ip_from_at)
            fi
            ;;
        "ak020")
            # AK-020: MBIM/wwan0直接方式
            log_msg "AK-020 接続処理..."

            # APN設定
            send_at_command "AT+CGDCONT=1,\"IP\",\"${APN}\"" 2

            # wwan0をアップにして接続試行
            ip link set "$IFACE" up 2>/dev/null
            sleep 2

            # dhclientでIP取得を試行
            if command -v dhclient &>/dev/null; then
                log_msg "dhclientでIP取得中..."
                dhclient -v "$IFACE" 2>&1 | head -5 || true
                sleep 3
                ip_addr=$(ip addr show "$IFACE" 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)
            fi

            # dhclient失敗時はATコマンドでIP取得
            if [ -z "$ip_addr" ] || [ "$ip_addr" = "169.254"* ]; then
                log_msg "dhclient失敗、ATコマンドでIP取得..."
                at_connect
                ip_addr=$(get_ip_from_at)
            fi
            ;;
        "quectel")
            # Quectel: PPP (未実装、従来スクリプト使用)
            log_msg "Quectel PPP接続は ppp_connect.sh を使用してください"
            return 1
            ;;
    esac

    # インターフェース設定
    configure_interface "$ip_addr"

    # ルーティング設定
    configure_routing

    # DNS設定
    configure_dns

    # 接続テスト
    test_connection

    log_msg "========================================="
    log_msg "  LTE接続完了"
    log_msg "========================================="

    return 0
}

# 切断処理
main_disconnect() {
    log_msg "========================================="
    log_msg "  LTE切断開始"
    log_msg "========================================="

    detect_modem 2>/dev/null || true

    # PDPコンテキスト無効化
    if [ -n "$AT_PORT" ] && [ -e "$AT_PORT" ]; then
        send_at_command "AT+CGACT=0,1" 3
    fi

    # MBIMセッション停止
    if command -v mbim-network &>/dev/null && [ -e "$DEVICE" ]; then
        mbim-network "$DEVICE" stop 2>/dev/null || true
    fi

    # インターフェースダウン
    ip route del default dev "$IFACE" 2>/dev/null || true
    ip addr flush dev "$IFACE" 2>/dev/null || true
    ip link set "$IFACE" down 2>/dev/null || true

    log_msg "LTE切断完了"

    return 0
}

# ステータス表示
main_status() {
    echo "=== LTE接続ステータス ==="

    detect_modem 2>/dev/null
    echo "モデムタイプ: ${MODEM_TYPE:-未検出}"
    echo "ATポート: ${AT_PORT:-なし}"
    echo "インターフェース: $IFACE"
    echo ""

    echo "=== インターフェース状態 ==="
    ip addr show "$IFACE" 2>/dev/null || echo "インターフェース未設定"
    echo ""

    echo "=== ルーティング ==="
    ip route | grep -E "default|$IFACE"
    echo ""

    if [ -n "$AT_PORT" ] && [ -e "$AT_PORT" ]; then
        echo "=== モデム情報 ==="
        echo "SIM: $(send_at_command 'AT+CPIN?' 2 | grep '+CPIN' | head -1)"
        echo "信号: $(send_at_command 'AT+CSQ' 2 | grep '+CSQ' | head -1)"
        echo "登録: $(send_at_command 'AT+CGREG?' 2 | grep '+CGREG' | head -1)"
        echo "PDP: $(send_at_command 'AT+CGACT?' 2 | grep '+CGACT' | head -1)"
    fi
}

# 診断
main_diagnose() {
    echo "=== LTE診断情報 ==="
    echo ""

    echo "--- USBデバイス ---"
    lsusb
    echo ""

    echo "--- デバイスファイル ---"
    ls -la /dev/cdc-wdm* /dev/ttyUSB* 2>/dev/null || echo "なし"
    echo ""

    echo "--- カーネルモジュール ---"
    lsmod | grep -E "cdc|mbim|qmi|option|usb"
    echo ""

    echo "--- dmesg (モデム関連) ---"
    dmesg | grep -iE "usb|modem|cdc|mbim|15eb|1199|2c7c" | tail -20
    echo ""

    main_status
}

# ヘルプ
show_help() {
    echo "統合LTE接続スクリプト"
    echo ""
    echo "使用方法: $0 {connect|disconnect|status|diagnose}"
    echo ""
    echo "コマンド:"
    echo "  connect    - LTE接続を開始"
    echo "  disconnect - LTE接続を切断"
    echo "  status     - 接続状態を表示"
    echo "  diagnose   - 診断情報を表示"
    echo ""
    echo "対応モデム:"
    echo "  - Sierra Wireless EM7430 (MBIM)"
    echo "  - Soracom AK-020 (MBIM/AT)"
    echo "  - Quectel EG25-G/EC25 (PPP) ※ppp_connect.sh使用"
    echo ""
    echo "設定ファイル: /etc/lte-connect.conf"
    echo "  APN=soracom.io"
    echo "  APN_USER=sora"
    echo "  APN_PASS=sora"
}

# メイン
case "${1:-}" in
    connect)
        main_connect
        exit $?
        ;;
    disconnect)
        main_disconnect
        exit $?
        ;;
    status)
        main_status
        exit 0
        ;;
    diagnose)
        main_diagnose
        exit 0
        ;;
    help|--help|-h)
        show_help
        exit 0
        ;;
    *)
        show_help
        exit 1
        ;;
esac
