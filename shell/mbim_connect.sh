#!/bin/bash
#
# EM7430 MBIM接続専用スクリプト (MBIM一本化版)
# AT制御を廃止し、mbim-networkコマンドを使用
#

DEVICE="/dev/cdc-wdm0"
IFACE="wwan0"
LOG_FILE="/tmp/mbim_connect.log"

# ログ関数
log_mbim() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [MBIM_CONN] $1" | tee -a $LOG_FILE
}

# MBIM接続状態確認
check_mbim_status() {
    log_mbim "MBIM接続状態確認中..."

    if [ ! -e "$DEVICE" ]; then
        log_mbim "ERROR: MBIMデバイス $DEVICE が見つかりません"
        return 1
    fi

    # MBIMデバイス基本情報取得
    local device_info=$(mbimcli -d $DEVICE --query-device-caps 2>&1)
    if [ $? -eq 0 ] && ! echo "$device_info" | grep -qi "error\|failed\|timeout"; then
        log_mbim "MBIMデバイス検出成功"

        # SIM状態確認
        local sim_state=$(mbimcli -d $DEVICE --query-subscriber-ready-status 2>&1)
        local ready_state=$(echo "$sim_state" | grep -oP "Ready state:\s*'\K[^']*" || echo "不明")
        log_mbim "SIM状態: $ready_state"

        # SIMが正常でない場合はエラー
        if [[ "$ready_state" != "initialized" ]]; then
            log_mbim "ERROR: SIMが初期化されていません (状態: $ready_state)"
            return 1
        fi

        return 0
    else
        log_mbim "ERROR: MBIMデバイス通信失敗: $device_info"
        return 1
    fi
}

# 詳細な信号強度・セル情報取得
get_lte_signal_info() {
    log_mbim "LTE信号状況取得中..."

    # 信号強度取得（タイムアウト付き）
    local signal_info=$(timeout 8 mbimcli -d $DEVICE --query-signal-state 2>&1)
    local signal_result=$?
    if [ $signal_result -eq 0 ] && ! echo "$signal_info" | grep -qi "error\|failed|timeout"; then
        local rssi=$(echo "$signal_info" | grep -oP "RSSI.*:\s*'\K[^']*" || echo "不明")
        log_mbim "信号強度 - RSSI: $rssi"
    else
        log_mbim "WARN: 信号強度取得失敗 (timeout or error)"
        # タイムアウト時は強制終了してデバイスをクリア
        if [ $signal_result -eq 124 ]; then
            pkill -9 mbimcli 2>/dev/null
            sleep 1
        fi
    fi

    # MBIMデバイスの安定化待機
    sleep 2

    # ネットワーク登録状態（タイムアウト付き）
    local network_info=$(timeout 10 mbimcli -d $DEVICE --query-registration-state 2>&1)
    if [ $? -eq 0 ] && ! echo "$network_info" | grep -qi "error\|failed\|timeout"; then
        local provider=$(echo "$network_info" | grep -oP "Provider name:\s*'\K[^']*" || echo "不明")
        local register_state=$(echo "$network_info" | grep -oP "Register state:\s*'\K[^']*" || echo "不明")
        local data_class=$(echo "$network_info" | grep -oP "Available data classes:\s*'\K[^']*" || echo "不明")

        log_mbim "ネットワーク登録: $register_state"
        log_mbim "接続先: $provider, 技術: $data_class"

        # 登録状態チェック
        if [[ "$register_state" != "home" && "$register_state" != "roaming" ]]; then
            log_mbim "ERROR: ネットワーク未登録 (状態: $register_state)"
            return 1
        fi
    else
        log_mbim "ERROR: ネットワーク状態取得失敗"
        return 1
    fi

    return 0
}

# MBIM接続実行 (mbim-network使用)
mbim_connect() {
    log_mbim "=== MBIM接続開始 (mbim-network方式) ==="

    # 既存MBIMプロセスのクリーンアップ（デバイスロック回避）
    log_mbim "既存MBIMプロセスのクリーンアップ中..."
    pkill -9 mbimcli 2>/dev/null
    pkill -9 -f "mbim-network" 2>/dev/null
    rm -f /tmp/mbim-network-state-* 2>/dev/null
    sleep 1

    # デバイス状態確認（最小限）
    if [ ! -e "$DEVICE" ]; then
        log_mbim "ERROR: MBIMデバイス $DEVICE が見つかりません"
        return 1
    fi
    log_mbim "MBIMデバイス確認完了"

    # インターフェースとルートのクリーンアップ
    log_mbim "既存接続のクリーンアップ中..."
    mbim-network $DEVICE stop >/dev/null 2>&1
    ip link set $IFACE down 2>/dev/null
    ip addr flush dev $IFACE 2>/dev/null
    ip route del default dev $IFACE 2>/dev/null
    sleep 2

    # mbim-network で接続開始
    log_mbim "mbim-network接続実行中（APN: soracom.io）..."

    local connect_result=$(mbim-network $DEVICE start 2>&1)
    local connect_status=$?

    log_mbim "接続結果 (exit=$connect_status):"
    echo "$connect_result" | while IFS= read -r line; do
        log_mbim "  $line"
    done

    # 接続成功確認（シンプル化）
    if [ $connect_status -ne 0 ]; then
        log_mbim "ERROR: mbim-network接続失敗 (終了コード: $connect_status)"
        return 1
    fi

    if echo "$connect_result" | grep -qi "Network started successfully"; then
        log_mbim "MBIM接続成功"
    else
        log_mbim "WARN: 接続成功メッセージ確認できず（継続）"
    fi

    # 接続成功（IP設定はsoracom-ip-setup.shに委譲）
    log_mbim "=== MBIM接続完了 ==="
    log_mbim "IP設定は /usr/local/bin/soracom-ip-setup.sh で実施します"
    return 0
}

# MBIM切断
mbim_disconnect() {
    log_mbim "=== MBIM切断開始 ==="

    if [ ! -e "$DEVICE" ]; then
        log_mbim "WARN: MBIMデバイスが見つかりません（既に切断済み）"
        return 0
    fi

    # mbim-network で切断
    local disconnect_result=$(mbim-network $DEVICE stop 2>&1)
    local disconnect_status=$?

    log_mbim "切断結果 (exit=$disconnect_status):"
    echo "$disconnect_result" | while IFS= read -r line; do
        log_mbim "  $line"
    done

    # インターフェースのクリーンアップ
    ip link set $IFACE down 2>/dev/null
    ip addr flush dev $IFACE 2>/dev/null
    ip route del default dev $IFACE 2>/dev/null

    if [ $disconnect_status -eq 0 ] || echo "$disconnect_result" | grep -qi "successfully"; then
        log_mbim "MBIM切断成功"
        return 0
    else
        log_mbim "WARN: MBIM切断で警告 (終了コード: $disconnect_status)"
        return 0  # 切断は警告レベルで処理継続
    fi
}

# MBIM診断情報取得
mbim_diagnose() {
    log_mbim "=== MBIM診断情報取得 ==="

    if [ ! -e "$DEVICE" ]; then
        log_mbim "ERROR: MBIMデバイスなし"
        return 1
    fi

    # デバイス能力
    log_mbim "--- デバイス能力 ---"
    mbimcli -d $DEVICE --query-device-caps 2>&1 | while IFS= read -r line; do
        log_mbim "  $line"
    done

    # SIM情報
    log_mbim "--- SIM情報 ---"
    mbimcli -d $DEVICE --query-subscriber-ready-status 2>&1 | while IFS= read -r line; do
        log_mbim "  $line"
    done

    # ネットワーク登録状態
    log_mbim "--- ネットワーク状態 ---"
    mbimcli -d $DEVICE --query-registration-state 2>&1 | while IFS= read -r line; do
        log_mbim "  $line"
    done

    # 接続状態
    log_mbim "--- 接続状態 ---"
    mbimcli -d $DEVICE --query-connection-state 2>&1 | while IFS= read -r line; do
        log_mbim "  $line"
    done

    # IP設定
    log_mbim "--- IP設定 ---"
    mbimcli -d $DEVICE --query-ip-configuration 2>&1 | while IFS= read -r line; do
        log_mbim "  $line"
    done
}

# メイン処理
case "$1" in
    "connect")
        mbim_connect
        exit $?
        ;;
    "disconnect")
        mbim_disconnect
        exit $?
        ;;
    "status")
        check_mbim_status
        exit $?
        ;;
    "diagnose")
        mbim_diagnose
        exit $?
        ;;
    "signal")
        get_lte_signal_info
        exit $?
        ;;
    *)
        echo "Usage: $0 {connect|disconnect|status|diagnose|signal}"
        echo "  connect    - MBIM接続実行 (mbim-network使用)"
        echo "  disconnect - MBIM切断実行"
        echo "  status     - 接続状態確認"
        echo "  diagnose   - 詳細診断情報"
        echo "  signal     - 信号強度確認"
        exit 1
        ;;
esac
