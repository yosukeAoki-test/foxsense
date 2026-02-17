#!/bin/bash
#
# 複数のAPN設定パターンをテスト
#

LOG_FILE="/tmp/apn_test.log"
DEVICE="/dev/cdc-wdm0"
IFACE="wwan0"

log_test() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [APN_TEST] $1" | tee -a $LOG_FILE
}

# テスト前のクリーンアップ
cleanup() {
    log_test "クリーンアップ中..."
    pkill -9 mbimcli 2>/dev/null
    pkill -9 qmicli 2>/dev/null
    rm -f /tmp/mbim-network-state-* 2>/dev/null
    rm -f /tmp/qmi*.txt 2>/dev/null
    ip link set $IFACE down 2>/dev/null
    ip addr flush dev $IFACE 2>/dev/null
    sleep 3
}

# QMIで接続テスト
test_qmi_connection() {
    local apn=$1
    local user=$2
    local pass=$3
    local auth=$4
    local pattern_name=$5

    log_test "========================================="
    log_test "  テスト: $pattern_name"
    log_test "  APN: $apn"
    log_test "  User: $user"
    log_test "  Pass: $pass"
    log_test "  Auth: $auth"
    log_test "========================================="

    cleanup

    # QMI接続コマンド構築
    local connect_cmd="qmicli -d $DEVICE --wds-start-network=\"apn='${apn}'"

    if [ -n "$user" ] && [ "$user" != "none" ]; then
        connect_cmd="${connect_cmd},username='${user}'"
    fi

    if [ -n "$pass" ] && [ "$pass" != "none" ]; then
        connect_cmd="${connect_cmd},password='${pass}'"
    fi

    if [ -n "$auth" ] && [ "$auth" != "none" ]; then
        connect_cmd="${connect_cmd},auth='${auth}'"
    fi

    connect_cmd="${connect_cmd},ip-type=4\" --client-no-release-cid"

    log_test "実行コマンド: $connect_cmd"

    # 接続実行
    local start_output=$(timeout 30 bash -c "$connect_cmd" 2>&1)
    local start_result=$?

    log_test "接続結果 (exit=$start_result):"
    echo "$start_output" | while IFS= read -r line; do
        log_test "  $line"
    done

    # PDH取得確認
    local pdh=$(echo "$start_output" | grep "Packet data handle:" | awk -F"'" '{print $2}')

    if [ -z "$pdh" ]; then
        log_test "RESULT: 失敗 - PDH取得不可"
        return 1
    fi

    log_test "PDH取得成功: $pdh"
    echo "$pdh" > /tmp/qmi_pdh.txt

    sleep 3

    # IP設定取得
    log_test "IP設定取得中..."
    local ip_settings=$(timeout 20 qmicli -d $DEVICE --wds-get-current-settings 2>&1)
    log_test "IP設定:"
    echo "$ip_settings" | while IFS= read -r line; do
        log_test "  $line"
    done

    # IPアドレス抽出
    local ip_addr=$(echo "$ip_settings" | grep "IPv4 address:" | awk -F": " '{print $2}' | tr -d ' ')

    if [ -z "$ip_addr" ] || [ "$ip_addr" = "unknown" ]; then
        log_test "IP取得失敗、ATコマンドで試行..."

        # ATコマンドでIP取得
        if [ -c /dev/ttyUSB2 ]; then
            stty -F /dev/ttyUSB2 115200 raw -echo
            echo -e "AT+CGCONTRDP=1\r" > /dev/ttyUSB2
            sleep 1
            local at_response=$(timeout 2 cat < /dev/ttyUSB2)

            ip_addr=$(echo "$at_response" | grep "+CGCONTRDP:" | awk -F',' '{print $4}' | tr -d '"' | awk -F'.' '{print $1"."$2"."$3"."$4}')

            if [ -n "$ip_addr" ] && [ "$ip_addr" != "..." ]; then
                log_test "AT経由でIP取得: $ip_addr"
            else
                log_test "AT経由でもIP取得失敗"
                log_test "RESULT: 失敗 - IP取得不可"
                qmicli -d $DEVICE --wds-stop-network="$pdh" --client-no-release-cid 2>&1 | tee -a $LOG_FILE
                return 1
            fi
        else
            log_test "RESULT: 失敗 - IP取得不可"
            qmicli -d $DEVICE --wds-stop-network="$pdh" --client-no-release-cid 2>&1 | tee -a $LOG_FILE
            return 1
        fi
    fi

    log_test "IP取得成功: $ip_addr"

    # インターフェース設定
    ip link set $IFACE up
    ip addr add ${ip_addr}/32 dev $IFACE
    ip link set $IFACE mtu 1428

    # テスト用ルート（WiFiルートを削除してLTE優先）
    ip route del default via 192.168.3.1 dev wlan0 2>/dev/null
    ip route add default dev $IFACE metric 50

    log_test "ルート設定完了、接続テスト実行..."

    # Ping テスト
    sleep 2
    if ping -c 3 -W 5 -I $IFACE 8.8.8.8 >/dev/null 2>&1; then
        log_test "========================================="
        log_test "  ✓✓✓ SUCCESS!!! ✓✓✓"
        log_test "  パターン: $pattern_name"
        log_test "  データ通信成功！"
        log_test "========================================="

        # WiFiルートを復元
        ip route add default via 192.168.3.1 dev wlan0 metric 100

        return 0
    else
        log_test "RESULT: 失敗 - Ping不可"

        # WiFiルートを復元
        ip route add default via 192.168.3.1 dev wlan0 metric 100

        # 切断
        qmicli -d $DEVICE --wds-stop-network="$pdh" --client-no-release-cid 2>&1 | tee -a $LOG_FILE
        return 1
    fi
}

# メイン処理
log_test "========================================="
log_test "  APN設定パターンテスト開始"
log_test "========================================="

# パターン1: フル認証 (CHAP)
test_qmi_connection "meeq.io" "meeq" "meeq" "chap" "Pattern 1: meeq/meeq (CHAP)"
if [ $? -eq 0 ]; then
    log_test "最適設定: APN=meeq.io, USER=meeq, PASS=meeq, AUTH=CHAP"
    exit 0
fi

sleep 5

# パターン2: フル認証 (PAP)
test_qmi_connection "meeq.io" "meeq" "meeq" "pap" "Pattern 2: meeq/meeq (PAP)"
if [ $? -eq 0 ]; then
    log_test "最適設定: APN=meeq.io, USER=meeq, PASS=meeq, AUTH=PAP"
    exit 0
fi

sleep 5

# パターン3: 認証なし
test_qmi_connection "meeq.io" "none" "none" "none" "Pattern 3: 認証なし"
if [ $? -eq 0 ]; then
    log_test "最適設定: APN=meeq.io, 認証なし"
    exit 0
fi

sleep 5

# パターン4: ユーザー名のみ (CHAP)
test_qmi_connection "meeq.io" "meeq" "none" "chap" "Pattern 4: USER=meeq only (CHAP)"
if [ $? -eq 0 ]; then
    log_test "最適設定: APN=meeq.io, USER=meeq, AUTH=CHAP"
    exit 0
fi

sleep 5

# パターン5: ユーザー名のみ (PAP)
test_qmi_connection "meeq.io" "meeq" "none" "pap" "Pattern 5: USER=meeq only (PAP)"
if [ $? -eq 0 ]; then
    log_test "最適設定: APN=meeq.io, USER=meeq, AUTH=PAP"
    exit 0
fi

sleep 5

# パターン6: 空パスワード (CHAP)
test_qmi_connection "meeq.io" "meeq" "" "chap" "Pattern 6: empty password (CHAP)"
if [ $? -eq 0 ]; then
    log_test "最適設定: APN=meeq.io, USER=meeq, PASS=(空), AUTH=CHAP"
    exit 0
fi

log_test "========================================="
log_test "  全パターン失敗"
log_test "========================================="

# WiFiルート復元確認
ip route | grep -q "default via 192.168.3.1 dev wlan0" || ip route add default via 192.168.3.1 dev wlan0 metric 100

exit 1
