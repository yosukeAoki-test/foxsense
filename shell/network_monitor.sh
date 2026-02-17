#!/bin/bash
#
# ネットワーク状態監視・診断スクリプト
#

LOG_FILE="/tmp/cron.log"
MONITOR_LOG="/var/log/network_monitor.log"

# ログ関数
log_net() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [NET_MON] $1" >> $LOG_FILE
}

# 監視ログ関数（network_monitor専用）
log_monitor() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [NET_MON] $1" | tee -a $MONITOR_LOG
}

# ネットワーク状態の完全診断
network_diagnose() {
    log_net "=== ネットワーク診断開始 ==="

    # インターフェース状態
    log_net "wlan0状態: $(cat /sys/class/net/wlan0/operstate 2>/dev/null || echo 'N/A')"
    log_net "wwan0状態: $(cat /sys/class/net/wwan0/operstate 2>/dev/null || echo 'N/A')"

    # IPアドレス
    wlan0_ip=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' || echo "N/A")
    wwan0_ip=$(ip addr show wwan0 2>/dev/null | grep "inet " | awk '{print $2}' || echo "N/A")
    log_net "wlan0 IP: $wlan0_ip"
    log_net "wwan0 IP: $wwan0_ip"

    # ルーティング
    log_net "デフォルトルート:"
    ip route show default | while read route; do
        log_net "  $route"
    done

    # DNS設定
    log_net "DNS設定: $(cat /etc/resolv.conf | grep nameserver | tr '\n' ' ')"

    # 接続テスト
    test_connectivity

    log_net "=== ネットワーク診断完了 ==="
}

# 接続性テスト（2段階判定）
test_connectivity() {
    local mode="${1:-full}"  # basic, full (デフォルト: full)

    # === Phase 1: 基本接続テスト (ping) ===
    log_monitor "[INFO] Phase 1: 基本接続テスト開始 (ping 8.8.8.8)"

    if ping -c 2 -W 3 8.8.8.8 >/dev/null 2>&1; then
        log_monitor "[INFO] LTE basic connectivity OK (ping)"
        log_net "基本接続: 成功 (ping)"

        # basicモードの場合はここで終了
        if [ "$mode" = "basic" ]; then
            return 0
        fi
    else
        log_monitor "[ERROR] LTE basic connectivity FAILED (ping)"
        log_net "基本接続: 失敗 (ping)"
        return 1
    fi

    # === Phase 2: サービス接続テスト (DNS + HTTPS) ===
    log_monitor "[INFO] Phase 2: サービス接続テスト開始 (DNS/HTTPS)"

    local max_retry=5
    local retry_interval=10

    for retry in $(seq 1 $max_retry); do
        log_monitor "[INFO] サービス接続試行 ($retry/$max_retry)..."

        # DNS解決テスト
        if ! nslookup app-stg.nougubako.jp >/dev/null 2>&1; then
            log_monitor "[WARN] DNS解決失敗 (試行 $retry/$max_retry)"

            if [ $retry -lt $max_retry ]; then
                log_monitor "[INFO] ${retry_interval}秒後にリトライ..."
                sleep $retry_interval
                continue
            else
                log_monitor "[ERROR] DNS解決最終失敗"
                log_net "DNS解決: 失敗 (最大リトライ到達)"
                return 1
            fi
        fi

        log_monitor "[INFO] DNS解決成功"

        # HTTPS接続テスト
        if curl -s --connect-timeout 10 --max-time 20 \
            https://app-stg.nougubako.jp/api/receive \
            -d '{"test":"connection"}' \
            -H 'Content-Type: application/json' >/dev/null 2>&1; then

            log_monitor "[INFO] LTE service connectivity OK (DNS/HTTPS)"
            log_net "サービス接続: 成功 (DNS/HTTPS)"
            return 0
        else
            log_monitor "[WARN] HTTPS接続失敗 (試行 $retry/$max_retry)"

            if [ $retry -lt $max_retry ]; then
                log_monitor "[INFO] ${retry_interval}秒後にリトライ..."
                sleep $retry_interval
                continue
            else
                log_monitor "[ERROR] HTTPS接続最終失敗"
                log_net "HTTPS接続: 失敗 (最大リトライ到達)"
                return 1
            fi
        fi
    done

    return 1
}

# ネットワーク種別判定（改良版）
detect_network_type() {
    # WiFi接続チェック（wlan0がup状態の場合のみ）
    if [ "$(cat /sys/class/net/wlan0/operstate 2>/dev/null)" = "up" ] && \
       ip addr show wlan0 | grep -q "inet " && \
       ip route | grep -q "^default.*wlan0" && \
       ping -c 1 -W 2 192.168.3.1 >/dev/null 2>&1; then
        echo "wifi"
        return 0
    fi

    # LTE接続チェック（ping成功で判定）
    # wwan0インターフェースとIPアドレスの確認を簡略化
    if [ -e /sys/class/net/wwan0 ] && \
       ip addr show wwan0 2>/dev/null | grep -q "inet " && \
       ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1; then
        echo "lte"
        return 0
    fi

    echo "unknown"
    return 1
}

# ネットワーク切替待機（改良版 - 基本接続テストのみ使用）
wait_for_network_stable() {
    local network_type=$1
    local max_wait=${2:-60}
    local count=0

    log_monitor "[INFO] ネットワーク安定化待機開始 (type: $network_type, max: ${max_wait}秒)"
    log_net "ネットワーク安定化待機開始 (type: $network_type, max: ${max_wait}秒)"

    while [ $count -lt $max_wait ]; do
        current_type=$(detect_network_type)
        if [ "$current_type" = "$network_type" ]; then
            # 基本接続テストのみで判定（高速化）
            if test_connectivity "basic"; then
                log_monitor "[INFO] ネットワーク安定化完了 (${count}秒後) - 基本接続OK"
                log_net "ネットワーク安定化完了 (${count}秒後)"
                return 0
            fi
        fi

        sleep 2
        count=$((count + 2))
    done

    log_monitor "[ERROR] ネットワーク安定化タイムアウト (${max_wait}秒)"
    log_net "ネットワーク安定化タイムアウト (${max_wait}秒)"
    return 1
}

case "$1" in
    "diagnose")
        network_diagnose
        ;;
    "detect")
        detect_network_type
        ;;
    "wait")
        wait_for_network_stable "$2" "$3"
        ;;
    "test")
        test_connectivity
        ;;
    *)
        echo "Usage: $0 {diagnose|detect|wait <type> [timeout]|test}"
        exit 1
        ;;
esac