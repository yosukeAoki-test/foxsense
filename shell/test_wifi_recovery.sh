#!/bin/bash
#
# WiFi復旧テスト用スクリプト
#

LOG=/tmp/wifi_recovery_test.log
SCRIPT_DIR=/root/agri-iot/shell

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [WIFI_RECOVERY_TEST] $1" | tee -a $LOG; }

log "=== WiFi復旧テスト開始 ==="

# 現在の状態記録
log "テスト前のwlan0状態:"
ip a show wlan0 | tee -a $LOG

# Step 1: wlan0を一時的にdown
log "Step 1: wlan0をdownに設定"
sudo ip link set wlan0 down
sleep 3
ip a show wlan0 | tee -a $LOG

# === Wi-Fi復帰処理 ===
log "Step 2: Wi-Fi復帰処理開始"

# Step 2-1: wlan0インターフェース起動
sudo ip link set wlan0 up
log "wlan0 upコマンド実行完了"
sleep 2

# Step 2-2: wpa_supplicant再設定（フルパス使用）
if [ -x /usr/sbin/wpa_cli ]; then
    log "wpa_cli reconfigure実行中..."
    sudo /usr/sbin/wpa_cli -i wlan0 reconfigure | tee -a $LOG
    log "wpa_cli reconfigure実行完了"
else
    log "[ERROR] wpa_cliが見つかりません: /usr/sbin/wpa_cli"
fi
sleep 3

# Step 2-3: dhcpcdでwlan0のみ再起動
log "dhcpcd -k wlan0 実行中..."
sudo dhcpcd -k wlan0 2>&1 | tee -a $LOG
sleep 2
log "dhcpcd wlan0 実行中..."
sudo dhcpcd wlan0 2>&1 | tee -a $LOG
log "dhcpcd wlan0再起動完了"

# Step 2-4: Wi-Fi接続待機（最大30秒）
log "WiFi IP取得待機中..."
RETRY_COUNT=0
MAX_RETRY=30
while [ $RETRY_COUNT -lt $MAX_RETRY ]; do
    if ip a show wlan0 | grep -q "inet "; then
        log "Wi-Fi IPアドレス取得成功 (${RETRY_COUNT}秒後)"
        break
    fi
    sleep 1
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRY ]; then
    log "[WARN] WiFi IP取得タイムアウト"
fi

# 現在の状態表示
log "現在のwlan0状態:"
ip a show wlan0 | tee -a $LOG

log "現在のルーティング:"
ip route | tee -a $LOG

log "wpa_supplicant状態:"
sudo /usr/sbin/wpa_cli -i wlan0 status | tee -a $LOG

# Step 2-5: DNS設定をWiFi用に復元
if [ -x $SCRIPT_DIR/dns_manager.sh ]; then
    log "DNS設定をWiFi用に復元"
    $SCRIPT_DIR/dns_manager.sh wifi 2>&1 | tee -a $LOG
else
    log "[WARN] dns_manager.shが見つかりません"
fi

# Step 2-6: Wi-Fi復帰最終確認
sleep 3
log "最終確認: ゲートウェイへのping..."
if ip a show wlan0 | grep -q "inet " && ping -c 1 -W 3 192.168.3.1 >/dev/null 2>&1; then
    log "[SUCCESS] Wi-Fi復帰成功（IP取得・ゲートウェイ到達確認済）"
else
    log "[FAILED] Wi-Fi復帰失敗"
    log "現在のwlan0状態: $(ip a show wlan0 | grep 'inet ')"

    # 追加診断
    log "追加診断: ping 192.168.3.1"
    ping -c 3 192.168.3.1 2>&1 | tee -a $LOG
fi

log "=== WiFi復旧テスト終了 ==="
log "ログファイル: $LOG"