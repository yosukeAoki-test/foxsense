#!/bin/bash
#
# AT直接制御によるLTE接続スクリプト
# MBIM/QMIをバイパスして最も基本的なATコマンドで接続
#

DEVICE="/dev/ttyUSB2"
APN="meeq.io"
APN_USER="meeq"
APN_PASS="meeq"
LOG_FILE="/tmp/at_direct_connect.log"

log_at() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [AT_DIRECT] $1" | tee -a $LOG_FILE
}

# ATコマンド送信関数
send_at() {
    local cmd="$1"
    local wait_time=${2:-2}

    log_at "送信: $cmd"
    echo -e "${cmd}\r" > $DEVICE
    sleep $wait_time
    timeout 3 cat < $DEVICE 2>/dev/null | tee -a $LOG_FILE
}

log_at "========================================="
log_at "  AT直接制御によるLTE接続開始"
log_at "========================================="

# デバイス確認
if [ ! -c "$DEVICE" ]; then
    log_at "ERROR: $DEVICE が見つかりません"
    exit 1
fi

log_at "=== ステップ1: モデム初期化 ==="
send_at "ATZ" 2  # モデムリセット
send_at "ATE0" 1  # エコーOFF
send_at "AT+CMEE=2" 1  # 詳細エラー表示

log_at "=== ステップ2: SIMとネットワーク確認 ==="
send_at "AT+CPIN?" 1  # SIM状態
send_at "AT+CSQ" 1  # 信号強度
send_at "AT+COPS?" 2  # ネットワーク登録

log_at "=== ステップ3: PDP Context設定 ==="
# PDP Context 1をIPv4専用、meeq.ioで設定
send_at "AT+CGDCONT=1,\"IP\",\"${APN}\"" 2

# 認証設定（CHAP=2, PAP=1）
send_at "AT\$QCPDPP=1,1,\"${APN_PASS}\",\"${APN_USER}\"" 2

# PDP Context確認
send_at "AT+CGDCONT?" 2

log_at "=== ステップ4: LTE専用モード設定 ==="
# LTE Onlyモードに設定
send_at "AT+CNMP=38" 2  # 38=LTE only

# LTE Band設定確認
send_at "AT!BAND?" 2

log_at "=== ステップ5: データコール有効化 ==="
# PDP Context Activateを試行
send_at "AT+CGACT=1,1" 3

# 状態確認
send_at "AT+CGACT?" 2

log_at "=== ステップ6: IPアドレス取得 ==="
send_at "AT+CGPADDR=1" 2
send_at "AT+CGCONTRDP=1" 3

log_at "=== ステップ7: データセッション開始（代替方法） ==="
# Sierra WirelessのプロプライエタリATコマンド
send_at "AT!SCACT=1,1" 3

# セッション状態確認
send_at "AT!SCACT?" 2

log_at "=== ステップ8: 接続状態の詳細確認 ==="
send_at "AT!GSTATUS?" 3

log_at "========================================="
log_at "  AT直接接続スクリプト完了"
log_at "  ログ: $LOG_FILE"
log_at "========================================="
