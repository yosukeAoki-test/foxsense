#!/bin/bash
#
# SORACOM IP設定スクリプト (MBIM+AT ハイブリッド方式)
# mbim-networkでPDP Context確立後、AT経由でIP/DNS情報のみ取得
# PDP初期化は行わない（mbim-network側で実施済み）
#

# 環境変数設定
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# 設定
SERIAL_PORT="/dev/ttyUSB2"
IFACE="wwan0"
LOGFILE="/var/log/soracom-ip-setup.log"

# ログ関数
log_msg() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOGFILE"
}

log_msg "INFO" "=== SORACOM IP設定開始 (ハイブリッド方式 - IP/DNS取得のみ) ==="

# シリアルポート存在確認
if [ ! -c "$SERIAL_PORT" ]; then
    log_msg "ERROR" "シリアルポート $SERIAL_PORT が見つかりません"
    exit 1
fi

log_msg "INFO" "シリアルポート確認完了: $SERIAL_PORT"

# シリアルポート設定
stty -F $SERIAL_PORT 115200 raw -echo -echoe -echok 2>/dev/null || true

# ATコマンド送信関数
send_at_command() {
    local cmd="$1"
    local description="$2"
    local timeout="${3:-3}"

    log_msg "DEBUG" "ATコマンド送信: $cmd ($description)"

    # コマンド送信
    echo -e "${cmd}\r" > $SERIAL_PORT

    # 応答読み取り
    local response=""
    local count=0
    while [ $count -lt $timeout ]; do
        if read -t 1 line < $SERIAL_PORT 2>/dev/null; then
            response="${response}${line}"
            # OKまたはERRORが含まれていたら終了
            if echo "$response" | grep -q "OK\|ERROR"; then
                break
            fi
        fi
        count=$((count + 1))
    done

    # 応答ログ出力（長い場合は切り詰め）
    log_msg "DEBUG" "応答: $(echo "$response" | tr -d '\r\n' | head -c 200)"

    # エラーチェック
    if echo "$response" | grep -qi "ERROR"; then
        log_msg "ERROR" "ATコマンドエラー: $cmd"
        return 1
    fi

    # 応答を返す
    echo "$response"
    return 0
}

# === STEP 1: IP/DNS情報取得 (PDP初期化なし) ===
log_msg "INFO" "=== STEP 1: IP/DNS情報取得 (AT+CGCONTRDP=1) ==="

# AT+CGCONTRDP=1 で詳細情報取得（最大3回リトライ）
# 応答例: +CGCONTRDP: 1,5,"soracom.io","10.236.152.129.255.255.255.255","0.0.0.0.0.0.0.0","100.127.0.53","100.127.1.53"
#         形式: +CGCONTRDP: <cid>,<bearer_id>,<apn>,"<ip>.<mask>","<gw>.<mask>","<dns1>","<dns2>"

rdp_response=""
for retry in {1..3}; do
    log_msg "INFO" "IP/DNS情報取得試行 ($retry/3)..."
    rdp_response=$(send_at_command "AT+CGCONTRDP=1" "詳細情報取得" 5)
    if [ $? -eq 0 ] && echo "$rdp_response" | grep -q "+CGCONTRDP:"; then
        break
    fi
    log_msg "WARN" "IP/DNS情報未取得、3秒待機後リトライ..."
    sleep 3
done

if [ $? -ne 0 ] || ! echo "$rdp_response" | grep -q "+CGCONTRDP:"; then
    log_msg "ERROR" "IP/DNS情報取得失敗"
    exit 1
fi

# 応答をログに記録
log_msg "INFO" "AT+CGCONTRDP応答: $(echo "$rdp_response" | grep '+CGCONTRDP:' | tr -d '\r\n')"

# === STEP 2: IP/DNS/GW解析 ===
log_msg "INFO" "=== STEP 2: IP/DNS/GW解析 ==="

# AT応答から+CGCONTRDP行を抽出してクリーンアップ
CGCONTRDP_LINE=$(echo "$rdp_response" | grep "+CGCONTRDP:" | tr -d '\r\n' | head -1)
log_msg "DEBUG" "CGCONTRDP_LINE: $CGCONTRDP_LINE"

# フィールド抽出（カンマ区切り、クォート有無両対応）
# 応答例1: +CGCONTRDP: 1,5,soracom.io,10.236.152.129,,100.127.0.53,100.127.1.53
# 応答例2: +CGCONTRDP: 1,5,"soracom.io","10.236.152.129.255.255.255.255","0.0.0.0.0.0.0.0","100.127.0.53","100.127.1.53"

# IP抽出（4つ目のフィールド、クォートと余分なオクテット削除）
IP_ADDR=$(echo "$CGCONTRDP_LINE" | awk -F',' '{print $4}' | tr -d '"' | awk -F'.' '{print $1"."$2"."$3"."$4}')

# GW抽出（5つ目のフィールド）
GW_ADDR=$(echo "$CGCONTRDP_LINE" | awk -F',' '{print $5}' | tr -d '"' | awk -F'.' '{print $1"."$2"."$3"."$4}')

# DNS1抽出（6つ目のフィールド）
DNS1=$(echo "$CGCONTRDP_LINE" | awk -F',' '{print $6}' | tr -d '"')

# DNS2抽出（7つ目のフィールド）
DNS2=$(echo "$CGCONTRDP_LINE" | awk -F',' '{print $7}' | tr -d '"')

# 取得結果検証
if [ -z "$IP_ADDR" ] || [ "$IP_ADDR" = "..." ]; then
    log_msg "ERROR" "IPアドレス抽出失敗 (応答: $rdp_response)"
    exit 1
fi

log_msg "INFO" "取得IPアドレス: $IP_ADDR"
log_msg "INFO" "取得GW: $GW_ADDR (Point-to-Pointの場合は0.0.0.0)"
if [ -n "$DNS1" ]; then
    log_msg "INFO" "取得DNS1: $DNS1"
fi
if [ -n "$DNS2" ]; then
    log_msg "INFO" "取得DNS2: $DNS2"
fi

# === STEP 3: ネットワーク設定 ===
log_msg "INFO" "=== STEP 3: ネットワーク設定 ==="

# wwan0インターフェース存在確認
if [ ! -e /sys/class/net/$IFACE ]; then
    log_msg "ERROR" "ネットワークインターフェース $IFACE が見つかりません"
    exit 1
fi

# インターフェースUP
log_msg "INFO" "インターフェース $IFACE を起動中..."
ip link set $IFACE up

if [ $? -ne 0 ]; then
    log_msg "ERROR" "インターフェース起動失敗"
    exit 1
fi

# 既存IPアドレス削除（冪等性確保）
log_msg "INFO" "既存IPアドレスをフラッシュ..."
ip addr flush dev $IFACE 2>/dev/null

# IPアドレス設定 (/32 Point-to-Point)
log_msg "INFO" "IPアドレス設定: ${IP_ADDR}/32"
ip addr add ${IP_ADDR}/32 dev $IFACE

if [ $? -ne 0 ]; then
    log_msg "ERROR" "IPアドレス設定失敗"
    exit 1
fi

# MTU設定 (LTE最適値 1428)
log_msg "INFO" "MTU設定: 1428"
ip link set $IFACE mtu 1428

if [ $? -ne 0 ]; then
    log_msg "WARN" "MTU設定失敗（継続）"
fi

# 既存デフォルトルート削除（wwan0関連のみ）
log_msg "INFO" "既存wwan0デフォルトルート削除..."
ip route del default dev $IFACE 2>/dev/null
ip route del default dev $IFACE metric 200 2>/dev/null

# デフォルトルート追加 (Point-to-Point方式)
log_msg "INFO" "デフォルトルート追加: dev $IFACE metric 200"
ip route add default dev $IFACE metric 200

if [ $? -ne 0 ]; then
    log_msg "WARN" "デフォルトルート追加失敗（既存ルートがある可能性、継続）"
fi

# === STEP 4: DNS設定 ===
log_msg "INFO" "=== STEP 4: DNS設定 ==="

# resolv.confのロック解除（存在する場合）
chattr -i /etc/resolv.conf 2>/dev/null

# DNS設定（AT応答から取得したDNSを優先）
log_msg "INFO" "DNS設定を書き込み中..."
{
    echo "# Generated by soracom-ip-setup.sh (ハイブリッド方式)"
    echo "# $(date '+%Y-%m-%d %H:%M:%S')"

    # AT応答から取得したDNS1（最優先）
    if [ -n "$DNS1" ] && [ "$DNS1" != "0.0.0.0" ]; then
        echo "nameserver $DNS1"
    else
        echo "nameserver 100.127.0.53"  # SORACOM DNS1デフォルト
    fi

    # Google DNS（フォールバック）
    echo "nameserver 8.8.8.8"

    # AT応答から取得したDNS2（オプション）
    if [ -n "$DNS2" ] && [ "$DNS2" != "0.0.0.0" ] && [ "$DNS2" != "$DNS1" ]; then
        echo "nameserver $DNS2"
    fi

    # Cloudflare DNS（追加フォールバック）
    echo "nameserver 1.1.1.1"

    # DNS最適化オプション
    echo "options timeout:2"
    echo "options attempts:2"
    echo "options rotate"
} > /etc/resolv.conf

log_msg "INFO" "DNS設定完了"

# === STEP 5: 接続確認 ===
log_msg "INFO" "=== STEP 5: 接続確認 ==="

# インターフェース状態確認
IFACE_STATE=$(ip addr show $IFACE 2>/dev/null | grep "state" | awk '{print $9}')
log_msg "INFO" "インターフェース状態: $IFACE_STATE"

# IPアドレス確認
CONFIGURED_IP=$(ip addr show $IFACE | grep "inet " | awk '{print $2}')
log_msg "INFO" "設定済みIP: $CONFIGURED_IP"

# ルーティング確認
DEFAULT_ROUTE=$(ip route show default | grep $IFACE)
if [ -n "$DEFAULT_ROUTE" ]; then
    log_msg "INFO" "デフォルトルート確認: $DEFAULT_ROUTE"
else
    log_msg "WARN" "デフォルトルートが見つかりません"
fi

# DNS確認
CONFIGURED_DNS=$(grep "^nameserver" /etc/resolv.conf | head -1 | awk '{print $2}')
log_msg "INFO" "設定済みDNS: $CONFIGURED_DNS"

# Ping接続テスト（オプション、タイムアウト短め）
log_msg "INFO" "接続テスト実行中 (ping 8.8.8.8)..."
if ping -c 2 -W 3 -I $IFACE 8.8.8.8 >/dev/null 2>&1; then
    log_msg "INFO" "接続テスト成功: LTE経由でインターネット到達可能"
    CONNECTIVITY_STATUS="SUCCESS"
else
    log_msg "WARN" "接続テスト失敗 (タイムアウト) - ルート設定を確認してください"
    CONNECTIVITY_STATUS="TIMEOUT"
fi

# === 完了サマリー ===
log_msg "INFO" "=== 設定完了サマリー ==="
log_msg "INFO" "  IPアドレス: $IP_ADDR"
log_msg "INFO" "  ゲートウェイ: $GW_ADDR"
log_msg "INFO" "  インターフェース: $IFACE"
log_msg "INFO" "  MTU: 1428"
log_msg "INFO" "  DNS1: ${DNS1:-100.127.0.53}"
log_msg "INFO" "  DNS2: 8.8.8.8"
log_msg "INFO" "  接続状態: $CONNECTIVITY_STATUS"
log_msg "INFO" "=== SORACOM IP設定完了 ==="

exit 0
