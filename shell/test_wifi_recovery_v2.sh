#!/bin/bash
#
# WiFi復帰テスト v2（修正版）
#

LOG=/tmp/wifi_recovery_test_v2.log
SCRIPT_DIR=/root/agri-iot/shell

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [WIFI_TEST_V2] $1" | tee -a $LOG; }

log "=== WiFi復帰テストv2 開始 ==="

# 現在の状態記録
log "テスト前のwlan0状態:"
ip a show wlan0 | grep inet | tee -a $LOG

# Step 1: wlan0を一時的にdown
log "Step 1: wlan0をdownに設定"
sudo ip link set wlan0 down
sleep 3

# === 修正版Wi-Fi復帰処理 ===
log "Step 2: 修正版Wi-Fi復帰処理開始"

# Step 2-1: wlan0インターフェース起動
sudo ip link set wlan0 up
sleep 3
log "wlan0インターフェースをUPに設定"

# Step 2-2: wpa_supplicant再設定
if [ -x /usr/sbin/wpa_cli ]; then
    sudo /usr/sbin/wpa_cli -i wlan0 reconfigure >/dev/null 2>&1
    log "wpa_cli reconfigure実行完了"
else
    log "[ERROR] wpa_cliが見つかりません"
    exit 1
fi

# Step 2-3: WiFi接続とDHCP取得を待機
log "WiFi接続・IP取得待機中..."
RETRY_COUNT=0
MAX_RETRY=60
while [ $RETRY_COUNT -lt $MAX_RETRY ]; do
    # WiFi接続状態確認
    if sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep -q "wpa_state=COMPLETED"; then
        log "WiFi接続確立 (${RETRY_COUNT}秒後)"

        # IP取得確認
        if ip a show wlan0 | grep -q "inet "; then
            log "WiFi IPアドレス取得成功 (${RETRY_COUNT}秒後)"
            break
        fi
    fi
    sleep 1
    RETRY_COUNT=$((RETRY_COUNT + 1))

    # 10秒ごとに進捗ログ
    if [ $((RETRY_COUNT % 10)) -eq 0 ]; then
        log "待機中... ${RETRY_COUNT}/${MAX_RETRY}秒"
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRY ]; then
    log "[ERROR] WiFi復帰タイムアウト"
fi

# Step 2-4: DNS設定をWiFi用に復元
if [ -x $SCRIPT_DIR/dns_manager.sh ]; then
    log "DNS設定をWiFi用に復元"
    $SCRIPT_DIR/dns_manager.sh wifi 2>&1 | tee -a $LOG
else
    log "[WARN] dns_manager.shが見つかりません"
fi

# Step 2-5: Wi-Fi復帰最終確認
sleep 2
log "最終確認実行中..."
if ip a show wlan0 | grep -q "inet " && ping -c 1 -W 3 192.168.3.1 >/dev/null 2>&1; then
    WIFI_IP=$(ip a show wlan0 | grep 'inet ' | awk '{print $2}')
    log "[SUCCESS] Wi-Fi復帰成功（IP: $WIFI_IP, ゲートウェイ到達確認済）"
else
    log "[FAILED] Wi-Fi復帰失敗"
    log "wlan0状態: $(ip a show wlan0 | grep 'inet ' || echo 'IPなし')"
    log "wpa状態: $(sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep wpa_state || echo '不明')"
fi

log "現在のwlan0詳細:"
ip a show wlan0 | tee -a $LOG
log "現在のルーティング:"
ip route | tee -a $LOG
log "DNS設定:"
cat /etc/resolv.conf | tee -a $LOG

log "=== WiFi復帰テストv2 終了 ==="
log "ログファイル: $LOG"