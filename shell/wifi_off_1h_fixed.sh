#!/bin/bash
#
# LTE通信テスト用（WiFi完全切断版・自動復帰付き）
#

LOG=/tmp/lte_test.log
SCRIPT_DIR=$(cd $(dirname $0); pwd)
START_TIME=$(date +%s)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [LTE_TEST] $1" | tee -a $LOG; }

# WiFi復帰処理（trap用）
wifi_recovery() {
    local END_TIME=$(date +%s)
    local DURATION=$((END_TIME - START_TIME))
    local RECOVERY_SUCCESS=false

    log "=== WiFi復帰処理開始（テスト実行時間: ${DURATION}秒） ==="

    # 復帰試行（最大2回）
    for attempt in 1 2; do
        log "WiFi復帰試行 ($attempt/2)..."

        # wlan0インターフェース起動（先に実行）
        log "wlan0インターフェースをUPに設定"
        sudo ip link set wlan0 up
        sleep 2

        # wpa_supplicant再起動
        log "wpa_supplicant再起動中..."
        sudo systemctl stop wpa_supplicant 2>/dev/null
        sleep 1
        sudo systemctl start wpa_supplicant
        sleep 3
        log "wpa_supplicant起動完了"

        # dhcpcd再起動
        log "dhcpcd再起動中..."
        sudo systemctl stop dhcpcd 2>/dev/null
        sleep 1
        sudo systemctl start dhcpcd
        sleep 5
        log "dhcpcd起動完了"

        # wpa_supplicant再設定
        if [ -x /usr/sbin/wpa_cli ]; then
            sudo /usr/sbin/wpa_cli -i wlan0 reconfigure >/dev/null 2>&1
            log "wpa_cli reconfigure実行完了"
        fi

        # WiFi接続確認（最大45秒）
        log "WiFi接続確認中..."
        local RETRY_COUNT=0
        local MAX_RETRY=45
        while [ $RETRY_COUNT -lt $MAX_RETRY ]; do
            if sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep -q "wpa_state=COMPLETED"; then
                log "WiFi接続確立 (${RETRY_COUNT}秒後)"
                break
            fi
            sleep 1
            RETRY_COUNT=$((RETRY_COUNT + 1))
        done

        if [ $RETRY_COUNT -eq $MAX_RETRY ]; then
            log "[WARN] WiFi接続タイムアウト（試行 $attempt）"
            continue
        fi

        # IP取得待機（最大60秒）
        log "WiFi IPアドレス取得待機中..."
        RETRY_COUNT=0
        MAX_RETRY=60
        while [ $RETRY_COUNT -lt $MAX_RETRY ]; do
            if ip a show wlan0 | grep -q "inet "; then
                log "WiFi IPアドレス取得成功 (${RETRY_COUNT}秒後)"
                break
            fi
            sleep 1
            RETRY_COUNT=$((RETRY_COUNT + 1))

            # 15秒ごとに進捗ログ
            if [ $(($RETRY_COUNT % 15)) -eq 0 ]; then
                log "IP取得待機中... ${RETRY_COUNT}/${MAX_RETRY}秒"
            fi
        done

        if [ $RETRY_COUNT -eq $MAX_RETRY ]; then
            log "[WARN] WiFi IP取得タイムアウト（試行 $attempt）"
            continue
        fi

        # WiFi復帰最終確認
        sleep 3
        if ip a show wlan0 | grep -q "inet " && ping -c 2 -W 3 192.168.3.1 >/dev/null 2>&1; then
            local WIFI_IP=$(ip a show wlan0 | grep 'inet ' | awk '{print $2}')
            log "[SUCCESS] Wi-Fi復帰成功（IP: $WIFI_IP, ゲートウェイ到達確認済）"
            RECOVERY_SUCCESS=true
            break
        else
            log "[WARN] WiFiゲートウェイ到達不可（試行 $attempt）"
        fi
    done

    # 復帰失敗時の処理
    if [ "$RECOVERY_SUCCESS" = false ]; then
        log "[ERROR] WiFi復帰2回失敗 - 60秒後に再起動を実行します"
        log "wlan0状態: $(ip a show wlan0 | grep 'inet ' || echo 'IPなし')"
        log "wpa状態: $(sudo /usr/sbin/wpa_cli -i wlan0 status 2>/dev/null | grep wpa_state || echo '不明')"

        # 60秒待機して再起動
        sleep 60
        log "システム再起動を実行..."
        sudo reboot
    fi

    log "=== WiFi復帰処理完了 ==="
}

# スクリプト終了時に必ずWiFi復帰処理を実行
trap wifi_recovery EXIT

log "=== LTE専用テスト開始 (開始時刻: $(date '+%Y-%m-%d %H:%M:%S')) ==="
log ""

# Phase 1: dhcpcd停止（WiFi自動復帰防止）
log "Phase1: dhcpcd停止（WiFi自動復帰を防止）"
if systemctl is-active --quiet dhcpcd; then
    sudo systemctl stop dhcpcd
    sleep 2
    log "dhcpcd停止完了"
else
    log "[INFO] dhcpcdは既に停止しています"
fi

# Phase 2: wpa_supplicant停止（WiFi自動接続防止）
log "Phase2: wpa_supplicant停止（WiFi自動接続を防止）"
if systemctl is-active --quiet wpa_supplicant; then
    sudo systemctl stop wpa_supplicant
    sleep 2
    log "wpa_supplicant停止完了"
else
    log "[INFO] wpa_supplicantは既に停止しています"
fi

# Phase 3: wlan0を完全にdown
log "Phase3: wlan0完全切断"
sudo ip link set wlan0 down
sudo ip addr flush dev wlan0 2>/dev/null || true
sudo ip route del default dev wlan0 2>/dev/null || true
sleep 2
log "wlan0完全切断完了"

# Phase 3.5: wlan0が本当にdownしているか確認
log "Phase3.5: wlan0状態確認"
WLAN0_STATE=$(ip link show wlan0 2>/dev/null | grep -o 'state [A-Z]*' | awk '{print $2}')
WLAN0_HAS_IP=$(ip addr show wlan0 2>/dev/null | grep -c 'inet ' || echo 0)
log "wlan0状態: $WLAN0_STATE, IPアドレス: $WLAN0_HAS_IP個"

if [ "$WLAN0_STATE" != "DOWN" ]; then
    log "[ERROR] wlan0がまだDOWN状態ではありません。強制再試行..."
    sudo ip link set wlan0 down
    sleep 3
fi
log ""

# Phase 4: モデム検出・デバイス健全性確認
log "Phase4: LTEモデム検出・健全性確認"

# モデムタイプ検出
MODEM_TYPE=""
LTE_INTERFACE=""

if lsusb 2>/dev/null | grep -qiE "1199:907|Sierra"; then
    MODEM_TYPE="em7430"
    LTE_INTERFACE="wwan0"
    log "モデム検出: EM7430 (MBIM) - インターフェース: wwan0"
elif lsusb 2>/dev/null | grep -qiE "2c7c:0125|Quectel"; then
    MODEM_TYPE="quectel"
    LTE_INTERFACE="ppp0"
    log "モデム検出: Quectel EC25 (PPP) - インターフェース: ppp0"
elif lsusb 2>/dev/null | grep -qiE "15eb:7d0e|ABIT"; then
    MODEM_TYPE="ak020"
    LTE_INTERFACE="wwan0"
    log "モデム検出: AK-020 (MBIM) - インターフェース: wwan0"
else
    log "[ERROR] LTEモデムが検出されませんでした"
    lsusb | tee -a $LOG
    exit 1
fi

# デバイス健全性確認
if [ "$MODEM_TYPE" = "em7430" ] || [ "$MODEM_TYPE" = "ak020" ]; then
    if [ ! -e /dev/cdc-wdm0 ]; then
        log "[WARN] MBIMデバイス(/dev/cdc-wdm0)が見つかりません"
    else
        log "MBIMデバイス: OK"
    fi
elif [ "$MODEM_TYPE" = "quectel" ]; then
    if [ ! -e /dev/ttyUSB2 ] && [ ! -e /dev/ttyUSB3 ]; then
        log "[WARN] Quectelシリアルデバイスが見つかりません"
    else
        log "Quectelシリアルデバイス: OK"
    fi
fi
log ""

# Phase 5: LTE接続開始（リトライ付き）
log "Phase5: LTE接続開始（最大3回リトライ）"
LTE_CONNECT_SUCCESS=false

# モデムタイプに応じた接続スクリプト選択
LTE_CONNECT_SCRIPT=""
if [ "$MODEM_TYPE" = "quectel" ]; then
    # Quectelはnetwork_mode.shを使用（PPP対応）
    if [ -x "$SCRIPT_DIR/network_mode.sh" ]; then
        LTE_CONNECT_SCRIPT="$SCRIPT_DIR/network_mode.sh connect"
    elif [ -x "/root/agri-iot/shell/network_mode.sh" ]; then
        LTE_CONNECT_SCRIPT="/root/agri-iot/shell/network_mode.sh connect"
    fi
    log "接続スクリプト: network_mode.sh (Quectel PPP用)"
elif [ "$MODEM_TYPE" = "em7430" ] || [ "$MODEM_TYPE" = "ak020" ]; then
    # EM7430/AK020はmbim_connect_stable.shを優先
    if [ -x "$SCRIPT_DIR/mbim_connect_stable.sh" ]; then
        LTE_CONNECT_SCRIPT="$SCRIPT_DIR/mbim_connect_stable.sh connect"
    elif [ -x "/root/agri-iot/shell/mbim_connect_stable.sh" ]; then
        LTE_CONNECT_SCRIPT="/root/agri-iot/shell/mbim_connect_stable.sh connect"
    elif [ -x "$SCRIPT_DIR/network_mode.sh" ]; then
        LTE_CONNECT_SCRIPT="$SCRIPT_DIR/network_mode.sh connect"
    fi
    log "接続スクリプト: mbim_connect_stable.sh (MBIM用)"
fi

if [ -z "$LTE_CONNECT_SCRIPT" ]; then
    log "[ERROR] LTE接続スクリプトが見つかりません"
    exit 1
fi

for retry in {1..3}; do
    log "LTE接続試行 ($retry/3)..."
    if sudo $LTE_CONNECT_SCRIPT >> $LOG 2>&1; then
        LTE_CONNECT_SUCCESS=true
        log "[SUCCESS] LTE接続コマンド成功 (試行 $retry)"
        break
    else
        log "[WARN] LTE接続コマンド失敗 (試行 $retry)"
        if [ $retry -lt 3 ]; then
            log "10秒後にリトライ..."
            sleep 10
        fi
    fi
done

if [ "$LTE_CONNECT_SUCCESS" = false ]; then
    log "[ERROR] LTE接続最終失敗（3回リトライ済み）"
    exit 1
fi

# Phase 5.5: LTE専用ルート確認・設定
log "Phase5.5: LTE専用ルート設定 (インターフェース: $LTE_INTERFACE)"
if ! ip route | grep -q "default.*$LTE_INTERFACE"; then
    sudo ip route add default dev $LTE_INTERFACE metric 100 2>/dev/null
    log "LTEデフォルトルート追加 (metric 100)"
else
    log "LTEデフォルトルート: 既存"
fi
log ""

# Phase 5.6: モデムタイプに応じたDNS設定
log "Phase5.6: DNS設定 (モデムタイプ: $MODEM_TYPE)"
if [ "$MODEM_TYPE" = "quectel" ]; then
    # Quectel/PPP: Soracom DNSは使えないのでGoogle DNSを使用
    sudo tee /etc/resolv.conf > /dev/null << 'DNSEOF'
# PPP connection DNS (Quectel)
nameserver 8.8.8.8
nameserver 1.1.1.1
options timeout:2
options attempts:2
DNSEOF
    log "DNS設定: Google DNS (8.8.8.8, 1.1.1.1) - PPP用"
else
    # MBIM: Soracom DNS + フォールバック
    sudo tee /etc/resolv.conf > /dev/null << 'DNSEOF'
# MBIM connection DNS (EM7430/AK-020)
nameserver 100.127.0.53
nameserver 8.8.8.8
nameserver 100.127.1.53
nameserver 1.1.1.1
options timeout:2
options attempts:2
options rotate
DNSEOF
    log "DNS設定: Soracom DNS + Google DNS - MBIM用"
fi
log ""

# Phase 6: LTE接続確立待機（延長版 - 180秒）
log "Phase6: LTE接続確立待機（最大180秒、5秒間隔チェック、インターフェース: $LTE_INTERFACE）"
LTE_WAIT_MAX=180
LTE_WAIT_COUNT=0

while [ $LTE_WAIT_COUNT -lt $LTE_WAIT_MAX ]; do
    # LTEインターフェースとIPアドレスの確認
    LTE_HAS_IP=false
    if [ "$MODEM_TYPE" = "quectel" ]; then
        # PPP接続の場合はppp0を確認
        if ip addr show ppp0 2>/dev/null | grep -q "inet "; then
            LTE_IP=$(ip addr show ppp0 | grep 'inet ' | awk '{print $2}')
            LTE_HAS_IP=true
        fi
    else
        # MBIM接続の場合はwwan0を確認
        if [ -e /sys/class/net/wwan0 ] && ip addr show wwan0 2>/dev/null | grep -q "inet "; then
            LTE_IP=$(ip addr show wwan0 | grep 'inet ' | awk '{print $2}')
            LTE_HAS_IP=true
        fi
    fi

    if [ "$LTE_HAS_IP" = true ]; then
        log "${LTE_INTERFACE}にIPアドレス取得: $LTE_IP (${LTE_WAIT_COUNT}秒後)"

        # ping疎通確認（インターフェース明示）
        if ping -c 2 -W 3 -I $LTE_INTERFACE 8.8.8.8 >/dev/null 2>&1; then
            log "[SUCCESS] LTE接続確立成功 (${LTE_WAIT_COUNT}秒後、ping成功)"
            break
        else
            log "${LTE_INTERFACE} IPあり、ただしping未疎通 - 待機継続"
        fi
    fi

    sleep 5
    LTE_WAIT_COUNT=$((LTE_WAIT_COUNT + 5))

    # 30秒ごとに進捗ログ
    if [ $(($LTE_WAIT_COUNT % 30)) -eq 0 ]; then
        log "LTE接続確立待機中... ${LTE_WAIT_COUNT}/${LTE_WAIT_MAX}秒"
        log "現在の${LTE_INTERFACE}状態: $(ip addr show $LTE_INTERFACE 2>/dev/null | grep 'inet ' || echo 'IPなし')"
    fi
done

if [ $LTE_WAIT_COUNT -ge $LTE_WAIT_MAX ]; then
    log "[ERROR] LTE接続確立タイムアウト（180秒）"
    exit 1
fi
log ""

# Phase 6.5: LTE信号品質確認
log "Phase6.5: LTE信号品質確認"
if [ -e /dev/cdc-wdm0 ]; then
    SIGNAL_INFO=$(timeout 10 sudo mbimcli -d /dev/cdc-wdm0 --query-signal-state 2>/dev/null)
    if [ $? -eq 0 ]; then
        RSSI=$(echo "$SIGNAL_INFO" | grep -oP "RSSI:\s*\K[-0-9]+" || echo "不明")
        RSRP=$(echo "$SIGNAL_INFO" | grep -oP "RSRP:\s*\K[-0-9]+" || echo "不明")
        log "LTE信号品質 - RSSI: ${RSSI}dBm, RSRP: ${RSRP}dBm"

        if [ "$RSSI" != "不明" ] && [ "$RSSI" -lt -100 ]; then
            log "[WARN] 信号強度が弱いです（RSSI: ${RSSI}dBm）"
        fi
    else
        log "[WARN] LTE信号品質取得失敗"
    fi
else
    log "[WARN] MBIMデバイスが見つからないため、信号品質取得をスキップ"
fi
log ""

# Phase 7: WiFi復帰チェック（意図せず復帰していないか確認）
log "Phase7: WiFi意図せず復帰チェック"
WLAN0_CURRENT_STATE=$(ip link show wlan0 2>/dev/null | grep -o 'state [A-Z]*' | awk '{print $2}')
WLAN0_CURRENT_IP=$(ip addr show wlan0 2>/dev/null | grep -c 'inet ' || echo 0)

if [ "$WLAN0_CURRENT_STATE" != "DOWN" ]; then
    log "[ERROR] wlan0が意図せず復帰しています！（state: $WLAN0_CURRENT_STATE）"
    ip link show wlan0 >> $LOG
fi

if [ "$WLAN0_CURRENT_IP" -gt 0 ] 2>/dev/null; then
    log "[ERROR] wlan0にIPアドレスが割り当てられています！"
    ip addr show wlan0 | grep 'inet ' >> $LOG
fi

if ip route | grep -q "default.*wlan0"; then
    log "[ERROR] wlan0のデフォルトルートが存在します！"
    ip route show | grep wlan0 >> $LOG
fi

if [ "$WLAN0_CURRENT_STATE" = "DOWN" ] && [ "${WLAN0_CURRENT_IP:-0}" -eq 0 ] 2>/dev/null; then
    log "[SUCCESS] wlan0は完全に切断されています"
fi
log ""

# Phase 8: LTE専用ルート確認
log "Phase8: 現在のルーティングテーブル確認"
log "デフォルトルート:"
ip route show | grep default | tee -a $LOG
log ""
log "全ルーティングテーブル:"
ip route show | tee -a $LOG
log ""

# Phase 9-10: スキップ（Phase6で接続確認済み、MBIMセッション維持のため即座に画像送信へ）
log "Phase9-10: スキップ（Phase6で接続確認済み）"
log ""

# Phase 11: 画像送信テスト（リトライ付き）
log "Phase11: 画像送信テスト実行（最大2回リトライ）"
IMAGE_SEND_SUCCESS=false
CRONJOB_PATH="${SCRIPT_DIR}/cronjob.sh"
if [ ! -x "$CRONJOB_PATH" ]; then
    CRONJOB_PATH="/root/agri-iot/shell/cronjob.sh"
fi
for retry in {1..2}; do
    log "画像送信試行 ($retry/2)..."
    if $CRONJOB_PATH -p -t >> $LOG 2>&1; then
        IMAGE_SEND_SUCCESS=true
        log "[SUCCESS] 画像送信成功 (試行 $retry)"
        break
    else
        log "[WARN] 画像送信失敗 (試行 $retry)"
        if [ $retry -lt 2 ]; then
            log "30秒後にリトライ..."
            sleep 30
        fi
    fi
done

if [ "$IMAGE_SEND_SUCCESS" = false ]; then
    log "[ERROR] 画像送信最終失敗（2回リトライ済み）"
    log "cronjob.shログを確認してください: /tmp/cron.log"
    exit 1
fi
log ""

log "=== LTE専用テスト完了、1時間WiFi停止維持開始 ==="
log "WiFi停止維持中（1時間）... Ctrl+Cで中断可能"
log "終了予定時刻: $(date -d '+1 hour' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -v+1H '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '1時間後')"

# 1時間（3600秒）WiFi停止を維持
# 10分ごとに進捗ログを出力
for i in $(seq 1 6); do
    log "WiFi停止維持中... ${i}0分経過予定（残り$((60 - i*10))分）"
    sleep 600

    # LTE接続状態を定期確認
    if ping -c 1 -W 3 -I $LTE_INTERFACE 8.8.8.8 >/dev/null 2>&1; then
        log "LTE接続状態: OK ($LTE_INTERFACE)"
    else
        log "[WARN] LTE接続状態: 不安定 ($LTE_INTERFACE)"
    fi
done

log "=== 1時間経過、WiFi復帰処理へ ==="
# WiFi復帰はtrap EXITで自動実行される
