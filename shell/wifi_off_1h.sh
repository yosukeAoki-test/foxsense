#!/bin/bash
#
# LTE通信テスト用（Wi-Fi自動復帰付き）
#

LOG=/tmp/lte_test.log
SCRIPT_DIR=$(cd $(dirname $0); pwd)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [LTE_TEST] $1" >> $LOG; }

# WiFi復帰処理（trap用）
wifi_recovery() {
    log "=== WiFi復帰処理開始（trap経由） ==="

    # wlan0インターフェース起動
    sudo ip link set wlan0 up
    sleep 3
    log "wlan0インターフェースをUPに設定"

    # wpa_supplicant再設定
    if [ -x /usr/sbin/wpa_cli ]; then
        sudo /usr/sbin/wpa_cli -i wlan0 reconfigure >/dev/null 2>&1
        log "wpa_cli reconfigure実行完了"
    else
        log "[WARN] wpa_cliが見つかりません"
    fi

    # WiFi接続確認（最大20秒）
    log "WiFi接続確認中..."
    RETRY_COUNT=0
    MAX_RETRY=20
    while [ $RETRY_COUNT -lt $MAX_RETRY ]; do
        if sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep -q "wpa_state=COMPLETED"; then
            log "WiFi接続確立 (${RETRY_COUNT}秒後)"
            break
        fi
        sleep 1
        RETRY_COUNT=$((RETRY_COUNT + 1))
    done

    if [ $RETRY_COUNT -eq $MAX_RETRY ]; then
        log "[ERROR] WiFi接続タイムアウト"
    fi

    # dhcpcd再起動でIP取得を確実にする
    log "dhcpcd再起動実行"
    sudo systemctl restart dhcpcd
    log "dhcpcd再起動完了、IP取得待機中..."

    # IP取得待機（最大30秒）
    RETRY_COUNT=0
    MAX_RETRY=30
    while [ $RETRY_COUNT -lt $MAX_RETRY ]; do
        if ip a show wlan0 | grep -q "inet "; then
            log "WiFi IPアドレス取得成功 (${RETRY_COUNT}秒後)"
            break
        fi
        sleep 1
        RETRY_COUNT=$((RETRY_COUNT + 1))

        # 10秒ごとに進捗ログ
        if [ $((RETRY_COUNT % 10)) -eq 0 ]; then
            log "IP取得待機中... ${RETRY_COUNT}/${MAX_RETRY}秒"
        fi
    done

    if [ $RETRY_COUNT -eq $MAX_RETRY ]; then
        log "[ERROR] WiFi IP取得タイムアウト"
    fi

    # WiFi復帰最終確認
    sleep 2
    if ip a show wlan0 | grep -q "inet " && ping -c 1 -W 3 192.168.3.1 >/dev/null 2>&1; then
        WIFI_IP=$(ip a show wlan0 | grep 'inet ' | awk '{print $2}')
        log "[SUCCESS] Wi-Fi復帰成功（IP: $WIFI_IP, ゲートウェイ到達確認済）"
    else
        log "[WARN] Wi-Fi復帰失敗 → 手動確認必要"
        log "wlan0状態: $(ip a show wlan0 | grep 'inet ' || echo 'IPなし')"
        log "wpa状態: $(sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep wpa_state || echo '不明')"
    fi

    log "=== WiFi復帰処理完了 ==="
}

# スクリプト終了時に必ずWiFi復帰処理を実行
trap wifi_recovery EXIT

log "=== LTE専用テスト開始 ==="

# Phase 1: Wi-Fi停止（完全停止）
log "Phase1: Wi-Fi停止"
sudo ip link set wlan0 down
sudo ip addr flush dev wlan0 2>/dev/null
sudo ip route del default via 192.168.3.1 dev wlan0 2>/dev/null
sleep 2

# Phase 2: LTE接続開始
log "Phase2: LTE接続"
if ! sudo $SCRIPT_DIR/network_mode.sh connect; then
    log "[ERROR] LTE接続失敗"
    exit 1
fi

# WiFi停止後のLTE専用ルート確認・設定
log "Phase2.5: LTE専用ルート設定"
if ! ip route | grep -q "default.*wwan0"; then
    sudo ip route add default dev wwan0 metric 100 2>/dev/null
    log "LTEデフォルトルート追加"
fi

# Phase 3: LTE安定化待機（シンプルping確認）
log "Phase3: LTE安定化確認"
sleep 5  # 安定化待機

# 最大30秒間ping確認
LTE_OK=false
for i in $(seq 1 10); do
    if ping -c 2 -W 3 -I wwan0 8.8.8.8 >/dev/null 2>&1; then
        log "LTE接続確認成功 (試行 $i)"
        LTE_OK=true
        break
    fi
    log "LTE確認リトライ中... ($i/10)"
    sleep 3
done

if [ "$LTE_OK" = false ]; then
    log "[ERROR] LTE接続確認失敗（10回試行）"
    exit 1
fi

# Phase 4: LTE接続確認（ping成功確認）
log "Phase4: LTE接続確認"
if ping -c 2 -W 3 8.8.8.8 >/dev/null 2>&1; then
    log "[SUCCESS] LTE基本接続成功 (ping 8.8.8.8)"
else
    log "[ERROR] LTE接続確認失敗"
    exit 1
fi

# Phase 5: 画像送信テスト
log "Phase5: 画像送信テスト実行"
/root/agri-iot/shell/cronjob.sh -p -t

log "=== LTE専用テスト終了 ==="
# WiFi復帰はtrap EXITで自動実行される