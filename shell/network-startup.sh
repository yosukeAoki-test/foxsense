#!/bin/bash
#
# 起動時のネットワーク自動設定スクリプト
# /usr/local/bin/network-startup.sh に配置
#

# ログ設定
LOG_FILE="/var/log/network-startup.log"
exec 1>>$LOG_FILE 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] ネットワーク起動設定開始"

# DNS設定を確実に設定（接続確立後に実施）
setup_dns() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] DNS設定中..."

    # resolv.confを確実に作成
    cat > /etc/resolv.conf << EOF
nameserver 8.8.8.8
nameserver 8.8.4.4
EOF

    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] DNS設定完了"
    return 0
}

# WiFi接続確認（改良版 - IP取得待機付き）
check_wifi() {
    local wifi_state=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)

    if [ "$wifi_state" = "up" ]; then
        # WiFiがUP状態だが、IP取得を待機（最大30秒）
        local retry=0
        local max_retry=30

        while [ $retry -lt $max_retry ]; do
            local wifi_ip=$(ip addr show wlan0 | grep "inet " | awk '{print $2}')

            if [ -n "$wifi_ip" ]; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi接続確認: $wifi_ip (${retry}秒後)"

                # WiFi優先ルート設定
                ip route del default 2>/dev/null
                ip route add default via 192.168.3.1 dev wlan0 metric 100 2>/dev/null

                return 0
            fi

            sleep 1
            retry=$((retry + 1))
        done

        echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] WiFi UP状態だがIP取得タイムアウト"
        return 1
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi未接続"
        return 1
    fi
}

# LTE接続確立待機（改良版 - 複数モデム対応）
wait_for_lte_connection() {
    local max_wait=180  # 最大180秒待機
    local wait_count=0
    local check_interval=5  # 5秒間隔でチェック

    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTE接続確立を待機中（最大${max_wait}秒）..."

    while [ $wait_count -lt $max_wait ]; do
        # wwan0 (EM7430) または ppp0 (Quectel) のチェック
        local lte_iface=""
        local lte_ip=""

        # wwan0チェック (EM7430)
        if [ -e /sys/class/net/wwan0 ]; then
            lte_ip=$(ip addr show wwan0 2>/dev/null | grep "inet " | awk '{print $2}')
            if [ -n "$lte_ip" ]; then
                lte_iface="wwan0"
            fi
        fi

        # ppp0チェック (Quectel)
        if [ -z "$lte_iface" ] && [ -e /sys/class/net/ppp0 ]; then
            lte_ip=$(ip addr show ppp0 2>/dev/null | grep "inet " | awk '{print $2}')
            if [ -n "$lte_ip" ]; then
                lte_iface="ppp0"
            fi
        fi

        if [ -n "$lte_iface" ] && [ -n "$lte_ip" ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] ${lte_iface}にIPアドレス取得: $lte_ip (${wait_count}秒後)"

            # ping疎通確認（インターフェース明示、リトライ3回）
            local ping_retry=0
            while [ $ping_retry -lt 3 ]; do
                if ping -c 2 -W 5 -I $lte_iface 8.8.8.8 >/dev/null 2>&1; then
                    echo "$(date '+%Y-%m-%d %H:%M:%S') [SUCCESS] LTE接続確立成功 (${lte_iface}, ${wait_count}秒後、ping成功)"
                    return 0
                fi
                ping_retry=$((ping_retry + 1))
                sleep 2
            done

            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] ${lte_iface} IPあり、ただしping未疎通 - 待機継続"
        fi

        sleep $check_interval
        wait_count=$((wait_count + check_interval))

        # 30秒ごとに進捗ログ
        if [ $((wait_count % 30)) -eq 0 ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTE接続確立待機中... ${wait_count}/${max_wait}秒"
            # 現在の状態を表示
            local status_msg="wwan0:"
            if [ -e /sys/class/net/wwan0 ]; then
                status_msg="$status_msg $(ip addr show wwan0 2>/dev/null | grep 'inet ' | awk '{print $2}' || echo 'IPなし')"
            else
                status_msg="$status_msg なし"
            fi
            status_msg="$status_msg, ppp0:"
            if [ -e /sys/class/net/ppp0 ]; then
                status_msg="$status_msg $(ip addr show ppp0 2>/dev/null | grep 'inet ' | awk '{print $2}' || echo 'IPなし')"
            else
                status_msg="$status_msg なし"
            fi
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 現在の状態: $status_msg"
        fi
    done

    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] LTE接続確立タイムアウト（${max_wait}秒）"
    return 1
}

# LTEバックアップ接続開始（WiFi接続時に使用）
start_lte_backup() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTEバックアップ接続を開始..."

    # モデムタイプ検出
    local modem_type=""
    if lsusb 2>/dev/null | grep -qiE "2c7c:0125|Quectel"; then
        modem_type="quectel"
    elif lsusb 2>/dev/null | grep -qiE "1199:907|Sierra"; then
        modem_type="em7430"
    elif lsusb 2>/dev/null | grep -qiE "15eb:7d0e|ABIT"; then
        modem_type="ak020"
    fi

    case "$modem_type" in
        "quectel")
            # Quectel: PPP接続
            if [ -x /root/agri-iot/shell/ppp_connect.sh ]; then
                /root/agri-iot/shell/ppp_connect.sh connect >> /var/log/lte-backup.log 2>&1 &
                echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] Quectel PPP接続開始（バックグラウンド）"
            fi
            ;;
        "em7430"|"ak020")
            # EM7430/AK-020: MBIM接続
            if [ -x /root/agri-iot/shell/mbim_connect_stable.sh ]; then
                /root/agri-iot/shell/mbim_connect_stable.sh connect >> /var/log/lte-backup.log 2>&1 &
                echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $modem_type MBIM接続開始（バックグラウンド）"
            fi
            ;;
        *)
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] LTEモデム未検出"
            return 1
            ;;
    esac

    return 0
}

# メイン処理
main() {
    # WiFi接続を確認
    if check_wifi; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi接続確認完了"
        # WiFi接続後にDNS設定
        setup_dns

        # LTEもバックアップとして開始（WiFiが切れた時用）
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTEバックアップ接続も開始します"
        start_lte_backup

        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi優先 + LTEバックアップで起動完了"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi未接続検出 - LTE接続を開始"

        # LTE接続を試みる
        if [ -x /usr/local/bin/network_mode.sh ]; then
            # network_mode.sh connect を実行（バックグラウンド処理なし、直接実行）
            /usr/local/bin/network_mode.sh connect

            if [ $? -eq 0 ]; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] network_mode.sh connect 完了"

                # LTE接続確立を待機（改良版）
                if wait_for_lte_connection; then
                    echo "$(date '+%Y-%m-%d %H:%M:%S') [SUCCESS] LTE接続確立完了"
                    # LTE接続後にDNS設定
                    setup_dns
                else
                    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] LTE接続確立失敗（タイムアウト）"
                    # DNS設定は試みる（ローカル設定として）
                    setup_dns
                fi
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] network_mode.sh connect 失敗"
                # DNS設定は試みる
                setup_dns
            fi
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] network_mode.shが見つからない"
            setup_dns
        fi
    fi

    # crontabが正しく動作するか確認
    if crontab -l >/dev/null 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] crontab確認OK"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] crontab未設定"
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] ネットワーク起動設定完了"
}

# 実行
main

exit 0