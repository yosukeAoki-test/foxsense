#!/bin/bash
#
# WiFi 1時間切断スクリプト（自動復帰付き）
#

LOG=/tmp/wifi_1h_disconnect.log
SCRIPT_DIR=$(cd $(dirname $0); pwd)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> $LOG; }

# WiFi復帰処理
wifi_recovery() {
    log "=== WiFi復帰処理開始 ==="

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
        log "[SUCCESS] WiFi復帰成功（IP: $WIFI_IP, ゲートウェイ到達確認済）"
    else
        log "[WARN] WiFi復帰失敗 → 手動確認必要"
        log "wlan0状態: $(ip a show wlan0 | grep 'inet ' || echo 'IPなし')"
        log "wpa状態: $(sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep wpa_state || echo '不明')"
    fi

    log "=== WiFi復帰処理完了 ==="
}

# スクリプト終了時に必ずWiFi復帰処理を実行
trap wifi_recovery EXIT

log "=== WiFi 1時間切断開始 ==="

# WiFi切断
log "WiFiを切断します"
sudo ip link set wlan0 down
log "WiFi切断完了"

# 1時間（3600秒）待機
log "1時間待機開始（3600秒）"
sleep 3600
log "1時間待機完了"

log "=== WiFi 1時間切断終了 ==="
# WiFi復帰はtrap EXITで自動実行される
