#!/bin/bash
#
# LTEモデム自動検出スクリプト
# 対応モデム:
#   - Sierra Wireless EM7430 (MBIM)
#   - Soracom AK-020 (MBIM)
#   - Quectel EG25-G / EC25 (PPP/wvdial)
#

# USB Vendor:Product IDs
# EM7430: 1199:9071 (通常モード), 1199:907d (MBIMモード)
# AK-020: 15eb:7d0e (Soracomドングル、MBIM対応)
EM7430_USB_IDS="1199:9071|1199:907d|1199:9079"
AK020_USB_ID="15eb:7d0e"
QUECTEL_USB_ID="2c7c:0125"

# モデムタイプ定数
MODEM_NONE="none"
MODEM_EM7430="em7430"
MODEM_AK020="ak020"
MODEM_QUECTEL="quectel"

# ログ関数
log_detect() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [DETECT] $1" >&2
}

# モデム検出メイン関数
detect_modem() {
    local verbose=${1:-false}

    # lsusbでUSBデバイス確認
    local usb_devices=$(lsusb 2>/dev/null)

    # EM7430検出 (Sierra Wireless)
    if echo "$usb_devices" | grep -qiE "1199:9071|1199:907d|1199:9079|Sierra.*EM74|Sierra.*Wireless"; then
        if [ -e /dev/cdc-wdm0 ]; then
            [ "$verbose" = "true" ] && log_detect "EM7430検出: /dev/cdc-wdm0"
            echo "$MODEM_EM7430"
            return 0
        fi
    fi

    # AK-020検出 (Soracomドングル、MBIM対応)
    if echo "$usb_devices" | grep -qiE "15eb:7d0e|ABIT"; then
        if [ -e /dev/cdc-wdm0 ]; then
            [ "$verbose" = "true" ] && log_detect "AK-020検出: /dev/cdc-wdm0 (MBIM)"
            echo "$MODEM_AK020"
            return 0
        fi
    fi

    # Quectel検出 (EG25-G, EC25など)
    if echo "$usb_devices" | grep -qi "2c7c:0125\|Quectel"; then
        # ttyUSBデバイス確認
        if ls /dev/ttyUSB* >/dev/null 2>&1; then
            [ "$verbose" = "true" ] && log_detect "Quectel検出: /dev/ttyUSB*"
            echo "$MODEM_QUECTEL"
            return 0
        fi
    fi

    # モデム未検出
    [ "$verbose" = "true" ] && log_detect "LTEモデム未検出"
    echo "$MODEM_NONE"
    return 1
}

# モデム詳細情報取得
get_modem_info() {
    local modem_type=$(detect_modem)

    case "$modem_type" in
        "$MODEM_EM7430")
            echo "type=$MODEM_EM7430"
            echo "device=/dev/cdc-wdm0"
            echo "interface=wwan0"
            echo "method=mbim"
            echo "script=mbim_connect_stable.sh"
            ;;
        "$MODEM_AK020")
            # AK-020もMBIM対応（EM7430と同じインターフェース）
            echo "type=$MODEM_AK020"
            echo "device=/dev/cdc-wdm0"
            echo "interface=wwan0"
            echo "method=mbim"
            echo "script=mbim_connect_stable.sh"
            ;;
        "$MODEM_QUECTEL")
            # Quectelのポート構成を確認
            local at_port=""
            local ppp_port=""

            # ttyUSB2がAT、ttyUSB3がPPP（一般的な構成）
            [ -e /dev/ttyUSB2 ] && at_port="/dev/ttyUSB2"
            [ -e /dev/ttyUSB3 ] && ppp_port="/dev/ttyUSB3"

            echo "type=$MODEM_QUECTEL"
            echo "at_port=$at_port"
            echo "ppp_port=$ppp_port"
            echo "interface=ppp0"
            echo "method=ppp"
            echo "script=ppp_connect.sh"
            ;;
        *)
            echo "type=$MODEM_NONE"
            return 1
            ;;
    esac

    return 0
}

# モデム状態確認
check_modem_ready() {
    local modem_type=$(detect_modem)

    case "$modem_type" in
        "$MODEM_EM7430"|"$MODEM_AK020")
            # MBIMデバイス応答確認（EM7430とAK-020共通）
            if timeout 5 mbimcli -d /dev/cdc-wdm0 --query-device-caps >/dev/null 2>&1; then
                echo "ready"
                return 0
            fi
            ;;
        "$MODEM_QUECTEL")
            # ATコマンド応答確認
            if [ -e /dev/ttyUSB2 ]; then
                echo -e "AT\r" > /dev/ttyUSB2
                sleep 0.5
                if timeout 2 head -3 /dev/ttyUSB2 2>/dev/null | grep -q "OK"; then
                    echo "ready"
                    return 0
                fi
            fi
            ;;
    esac

    echo "not_ready"
    return 1
}

# メイン処理
case "$1" in
    "detect"|"")
        detect_modem
        ;;
    "info")
        get_modem_info
        ;;
    "ready")
        check_modem_ready
        ;;
    "verbose")
        detect_modem true
        ;;
    *)
        echo "Usage: $0 {detect|info|ready|verbose}"
        echo "  detect  - モデムタイプを出力 (em7430/quectel/none)"
        echo "  info    - モデム詳細情報を出力"
        echo "  ready   - モデム応答確認"
        echo "  verbose - 詳細ログ付き検出"
        exit 1
        ;;
esac
