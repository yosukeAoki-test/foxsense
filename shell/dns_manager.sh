#!/bin/bash
#
# DNS設定管理スクリプト
# 複数プロセス間のDNS競合を回避
#

LOCK_FILE="/tmp/dns_manager.lock"
RESOLV_CONF="/etc/resolv.conf"
BACKUP_RESOLV="/tmp/resolv.conf.backup"

# ログ関数
log_dns() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [DNS_MGR] $1" >> /tmp/cron.log
}

# DNS設定ロック取得
acquire_dns_lock() {
    local timeout=${1:-30}
    local count=0

    while [ -f "$LOCK_FILE" ] && [ $count -lt $timeout ]; do
        sleep 1
        count=$((count + 1))
    done

    if [ $count -eq $timeout ]; then
        log_dns "DNS設定ロック取得タイムアウト"
        return 1
    fi

    echo $$ > "$LOCK_FILE"
    return 0
}

# DNS設定ロック解除
release_dns_lock() {
    rm -f "$LOCK_FILE"
}

# LTE用DNS設定
set_lte_dns() {
    acquire_dns_lock || return 1

    log_dns "LTE用DNS設定開始"

    # 現在の設定をバックアップ
    cp "$RESOLV_CONF" "$BACKUP_RESOLV" 2>/dev/null

    # LTE最適化DNS設定
    cat > "$RESOLV_CONF" << EOF
nameserver 8.8.8.8
nameserver 1.1.1.1
nameserver 100.127.0.53
options timeout:3
options attempts:2
options rotate
options single-request-reopen
EOF

    # 設定確認
    if nslookup app-stg.nougubako.jp >/dev/null 2>&1; then
        log_dns "LTE用DNS設定完了・動作確認成功"
        release_dns_lock
        return 0
    else
        log_dns "LTE用DNS設定失敗・設定を復元"
        cp "$BACKUP_RESOLV" "$RESOLV_CONF" 2>/dev/null
        release_dns_lock
        return 1
    fi
}

# WiFi用DNS復元
restore_wifi_dns() {
    acquire_dns_lock || return 1

    log_dns "WiFi用DNS設定復元開始"

    # dhcpcdからDNS設定を再取得
    systemctl restart dhcpcd
    sleep 3

    # DNS動作確認
    if nslookup app-stg.nougubako.jp >/dev/null 2>&1; then
        log_dns "WiFi用DNS設定復元完了・動作確認成功"
    else
        log_dns "WiFi用DNS設定復元失敗・手動設定実施"
        cat > "$RESOLV_CONF" << EOF
nameserver 192.168.3.1
nameserver 8.8.8.8
nameserver 1.1.1.1
options timeout:2
options attempts:2
EOF
    fi

    release_dns_lock
}

# DNS状態診断
diagnose_dns() {
    log_dns "DNS診断開始"
    log_dns "現在のresolv.conf: $(cat $RESOLV_CONF | tr '\n' ' ')"

    # 各DNSサーバーをテスト
    for dns in 8.8.8.8 1.1.1.1 192.168.3.1 100.127.0.53; do
        if nslookup app-stg.nougubako.jp $dns >/dev/null 2>&1; then
            log_dns "DNS $dns: 正常"
        else
            log_dns "DNS $dns: 失敗"
        fi
    done
}

case "$1" in
    "lte")
        set_lte_dns
        ;;
    "wifi")
        restore_wifi_dns
        ;;
    "diagnose")
        diagnose_dns
        ;;
    *)
        echo "Usage: $0 {lte|wifi|diagnose}"
        exit 1
        ;;
esac