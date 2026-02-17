#!/bin/bash
#
# EM7430 LTE通信品質最適化スクリプト
# 3Gで動作していた機能をLTEで確実に動作させる
#

LOG_FILE="/tmp/lte_optimizer.log"

# ログ関数
log_opt() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [LTE_OPT] $1" | tee -a $LOG_FILE
}

# TCP/IP スタック最適化（LTE専用）
optimize_tcp_stack() {
    log_opt "=== TCP/IPスタック LTE最適化開始 ==="

    # LTE高遅延対応のTCP設定
    echo 1 > /proc/sys/net/ipv4/tcp_window_scaling 2>/dev/null
    echo 1 > /proc/sys/net/ipv4/tcp_timestamps 2>/dev/null
    echo 1 > /proc/sys/net/ipv4/tcp_sack 2>/dev/null

    # バッファサイズ最適化（大容量画像転送対応）
    echo 65536 > /proc/sys/net/core/rmem_default 2>/dev/null
    echo 65536 > /proc/sys/net/core/wmem_default 2>/dev/null
    echo 16777216 > /proc/sys/net/core/rmem_max 2>/dev/null  # 16MB
    echo 16777216 > /proc/sys/net/core/wmem_max 2>/dev/null  # 16MB

    # TCP窓サイズ（LTE最適化）
    echo "4096 65536 16777216" > /proc/sys/net/ipv4/tcp_rmem 2>/dev/null
    echo "4096 65536 16777216" > /proc/sys/net/ipv4/tcp_wmem 2>/dev/null

    # LTE遅延対応
    echo 30 > /proc/sys/net/ipv4/tcp_keepalive_time 2>/dev/null
    echo 9 > /proc/sys/net/ipv4/tcp_keepalive_probes 2>/dev/null
    echo 10 > /proc/sys/net/ipv4/tcp_keepalive_intvl 2>/dev/null

    # 輻輳制御最適化
    if [ -w /proc/sys/net/ipv4/tcp_congestion_control ]; then
        # BBR > CUBIC > reno の順で試行
        if echo bbr > /proc/sys/net/ipv4/tcp_congestion_control 2>/dev/null; then
            log_opt "輻輳制御: BBR適用成功"
        elif echo cubic > /proc/sys/net/ipv4/tcp_congestion_control 2>/dev/null; then
            log_opt "輻輳制御: CUBIC適用成功"
        else
            log_opt "輻輳制御: デフォルト使用"
        fi
    fi

    # LTE接続の再送制御
    echo 6 > /proc/sys/net/ipv4/tcp_syn_retries 2>/dev/null
    echo 6 > /proc/sys/net/ipv4/tcp_retries2 2>/dev/null

    # IPフラグメント処理最適化（大容量データ対応）
    echo 0 > /proc/sys/net/ipv4/ip_no_pmtu_disc 2>/dev/null   # PMTU Discovery有効
    echo 30 > /proc/sys/net/ipv4/ipfrag_time 2>/dev/null      # フラグメント再組み立て時間延長
    echo 262144 > /proc/sys/net/ipv4/ipfrag_high_thresh 2>/dev/null  # フラグメントメモリ上限拡大
    echo 196608 > /proc/sys/net/ipv4/ipfrag_low_thresh 2>/dev/null   # フラグメントメモリ下限拡大
    log_opt "IPフラグメント処理最適化完了"

    log_opt "TCP/IPスタック最適化完了"
}

# wwan0インターフェース最適化
optimize_wwan_interface() {
    log_opt "=== wwan0インターフェース最適化開始 ==="

    if [ ! -e /sys/class/net/wwan0 ]; then
        log_opt "ERROR: wwan0インターフェースが存在しません"
        return 1
    fi

    # インターフェース基本設定
    ip link set dev wwan0 up

    # MTU設定（EM7430最適値）
    # 3Gの1500ではなく、LTE最適値を設定
    local optimal_mtu=1428  # LTE + SORACOM最適値
    ip link set dev wwan0 mtu $optimal_mtu
    log_opt "MTU設定: $optimal_mtu"

    # Queue Discipline最適化
    tc qdisc del dev wwan0 root 2>/dev/null
    tc qdisc add dev wwan0 root handle 1: fq_codel
    log_opt "Queue Discipline: fq_codel適用"

    # TCPオフロード無効化（大容量データ転送最適化）
    if command -v ethtool >/dev/null 2>&1; then
        ethtool -K wwan0 tso off 2>/dev/null && log_opt "TSO無効化完了"
        ethtool -K wwan0 gso off 2>/dev/null && log_opt "GSO無効化完了"
        ethtool -K wwan0 gro off 2>/dev/null && log_opt "GRO無効化完了"
        log_opt "TCPオフロード機能無効化完了"
    else
        log_opt "WARNING: ethtoolが見つかりません"
    fi

    # インターフェース統計リセット
    echo 0 > /sys/class/net/wwan0/statistics/rx_dropped 2>/dev/null
    echo 0 > /sys/class/net/wwan0/statistics/tx_dropped 2>/dev/null

    log_opt "wwan0インターフェース最適化完了"
}

# DNS解決最適化（LTE専用）
optimize_dns_resolution() {
    log_opt "=== DNS解決最適化開始 ==="

    # nscd（Name Service Cache Daemon）の設定確認
    if command -v nscd >/dev/null 2>&1; then
        # nscdの無効化（LTE環境では不安定要因）
        systemctl stop nscd 2>/dev/null
        systemctl disable nscd 2>/dev/null
        log_opt "nscd無効化完了"
    fi

    # systemd-resolved設定最適化
    if [ -f /etc/systemd/resolved.conf ]; then
        # LTE用DNS設定のバックアップと最適化
        cp /etc/systemd/resolved.conf /etc/systemd/resolved.conf.backup 2>/dev/null

        cat > /etc/systemd/resolved.conf << EOF
[Resolve]
DNS=8.8.8.8 1.1.1.1
FallbackDNS=100.127.0.53
Domains=~.
DNSSEC=no
Cache=yes
DNSStubListener=no
EOF
        systemctl restart systemd-resolved 2>/dev/null
        log_opt "systemd-resolved最適化完了"
    fi

    log_opt "DNS解決最適化完了"
}

# LTE接続品質モニタリング
monitor_lte_quality() {
    log_opt "=== LTE接続品質モニタリング ==="

    # MBIM信号強度取得
    if [ -e /dev/cdc-wdm0 ]; then
        local signal_info=$(timeout 10 mbimcli -d /dev/cdc-wdm0 --query-signal-state 2>/dev/null)
        if [ $? -eq 0 ]; then
            local rssi=$(echo "$signal_info" | grep -oP "RSSI:\s*\K[-0-9]+" 2>/dev/null || echo "不明")
            local rsrp=$(echo "$signal_info" | grep -oP "RSRP:\s*\K[-0-9]+" 2>/dev/null || echo "不明")
            log_opt "信号品質 - RSSI: ${rssi}dBm, RSRP: ${rsrp}dBm"

            # 信号品質による警告
            if [ "$rssi" != "不明" ] && [ "$rssi" -lt -100 ]; then
                log_opt "WARNING: 信号強度が弱いです (RSSI: ${rssi}dBm)"
            fi
        else
            log_opt "WARNING: 信号強度取得失敗"
        fi
    fi

    # ネットワーク遅延測定
    local ping_result=$(ping -c 3 -W 5 8.8.8.8 2>/dev/null | tail -1)
    if echo "$ping_result" | grep -q "min/avg/max"; then
        local avg_latency=$(echo "$ping_result" | grep -oP "= [-0-9.]+/\K[0-9.]+" 2>/dev/null)
        log_opt "平均遅延: ${avg_latency}ms"

        # 遅延による警告
        if [ "${avg_latency%.*}" -gt 1000 ]; then
            log_opt "WARNING: 高遅延を検出 (${avg_latency}ms)"
        fi
    else
        log_opt "WARNING: 遅延測定失敗"
    fi

    # スループット簡易測定
    local start_time=$(date +%s)
    local test_result=$(timeout 10 curl -s -w "%{speed_download}" -o /dev/null "http://httpbin.org/bytes/1048576" 2>/dev/null)
    local end_time=$(date +%s)

    if [ -n "$test_result" ] && [ "$test_result" != "0" ]; then
        local speed_kbps=$((${test_result%.*} / 1024))
        log_opt "ダウンロード速度: ${speed_kbps} KB/s"

        # 速度による警告
        if [ "$speed_kbps" -lt 100 ]; then
            log_opt "WARNING: 低速通信を検出 (${speed_kbps} KB/s)"
        fi
    else
        log_opt "WARNING: 速度測定失敗"
    fi
}

# 全体最適化実行
run_full_optimization() {
    log_opt "=== EM7430 LTE全体最適化開始 ==="

    optimize_tcp_stack
    optimize_wwan_interface
    optimize_dns_resolution
    monitor_lte_quality

    log_opt "=== EM7430 LTE全体最適化完了 ==="
}

# メイン処理
case "$1" in
    "tcp")
        optimize_tcp_stack
        ;;
    "interface")
        optimize_wwan_interface
        ;;
    "dns")
        optimize_dns_resolution
        ;;
    "monitor")
        monitor_lte_quality
        ;;
    "all"|"")
        run_full_optimization
        ;;
    *)
        echo "Usage: $0 [tcp|interface|dns|monitor|all]"
        echo "  tcp       - TCP/IPスタック最適化"
        echo "  interface - wwan0インターフェース最適化"
        echo "  dns       - DNS解決最適化"
        echo "  monitor   - LTE品質モニタリング"
        echo "  all       - 全体最適化実行（デフォルト）"
        exit 1
        ;;
esac