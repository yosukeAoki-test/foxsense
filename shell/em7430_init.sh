#!/bin/bash
#
# AirPrime EM7430 LTE最適化初期化スクリプト
# 3G→LTE移行時の問題を解決する包括的な設定
#

LOG_FILE="/tmp/em7430_init.log"

# ログ関数
log_init() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [EM7430_INIT] $1" | tee -a $LOG_FILE
}

log_init "=== AirPrime EM7430 LTE初期化開始 ==="

# === 1. 必要パッケージの確認・インストール ===
log_init "必要パッケージの確認中..."
PACKAGES_NEEDED="minicom libqmi-utils modemmanager"
for pkg in $PACKAGES_NEEDED; do
    if ! dpkg -l | grep -q "^ii  $pkg"; then
        log_init "$pkg をインストール中..."
        sudo apt update >/dev/null 2>&1
        sudo apt install -y $pkg >/dev/null 2>&1
    else
        log_init "$pkg は既にインストール済み"
    fi
done

# === 2. カーネルモジュールの適切な読み込み ===
log_init "LTE用カーネルモジュール読み込み中..."
sudo modprobe option
sudo modprobe cdc_wdm
sudo modprobe cdc_mbim
sudo modprobe qmi_wwan

# デバイスIDを明示的に追加（EM7430対応）
echo "1199 907d" | sudo tee /sys/bus/usb-serial/drivers/option1/new_id >/dev/null 2>&1

# === 3. ATコマンド送信用関数（改良版） ===
send_at() {
    local CMD="$1"
    local EXPECT_OK=${2:-true}
    local TIMEOUT=${3:-3}

    log_init "AT送信: $CMD"

    # シリアルポート設定の確認
    if [ ! -c /dev/ttyUSB2 ]; then
        log_init "ERROR: /dev/ttyUSB2 が見つかりません"
        return 1
    fi

    # ポート設定の最適化
    stty -F /dev/ttyUSB2 115200 raw -echo -echoe -echok

    # ATコマンド送信
    echo -e "$CMD\r" > /dev/ttyUSB2

    # レスポンス待機
    local response=""
    local count=0
    while [ $count -lt $TIMEOUT ]; do
        if read -t 1 response < /dev/ttyUSB2 2>/dev/null; then
            log_init "応答: $(echo $response | tr -d '\r\n')"
            if echo "$response" | grep -q "OK\|ERROR"; then
                break
            fi
        fi
        count=$((count + 1))
        sleep 0.5
    done

    if [ $EXPECT_OK = true ] && ! echo "$response" | grep -q "OK"; then
        log_init "WARNING: 期待する応答(OK)を受信できませんでした"
        return 1
    fi

    return 0
}

# === 4. デバイス存在・状態確認 ===
log_init "EM7430デバイス状態確認中..."

if [ ! -e /dev/ttyUSB2 ]; then
    log_init "ERROR: /dev/ttyUSB2 が見つかりません"
    log_init "USB接続とモジュール認識を確認してください"
    exit 1
fi

# USB記述子の確認
USB_INFO=$(lsusb -d 1199:907d 2>/dev/null)
if [ -z "$USB_INFO" ]; then
    log_init "ERROR: EM7430 (1199:907d) がUSBバス上に見つかりません"
    exit 1
else
    log_init "EM7430検出: $USB_INFO"
fi

# === 5. LTE最適化ATコマンドシーケンス ===
log_init "LTE最適化設定開始..."

# 基本初期化
send_at 'ATZ' true 5  # リセット
sleep 2
send_at 'ATE0' true 3  # エコー無効化
send_at 'AT+CMEE=2' true 3  # 詳細エラー情報有効

# EM7430専用の事前設定確認
send_at 'AT+CGMI' false 3  # メーカー情報
send_at 'AT+CGMM' false 3  # モデル情報
send_at 'AT+CGMR' false 3  # リビジョン情報

# === LTE固有の最適化設定 ===
log_init "LTE固有設定適用中..."

# 管理者モード移行（EM7430専用）
send_at 'AT!ENTERCND="A710"' false 3

# LTE専用設定
send_at 'AT!SELRAT=06' false 3        # LTE Only（GSM/UMTS無効化）
send_at 'AT!BAND=09' false 3          # LTE Band設定（日本キャリア対応）

# PDP Context最適化設定
send_at 'AT+CGDCONT=1,"IP","soracom.io"' true 3  # SORACOM APN設定
send_at 'AT+CGDCONT?' false 3         # 設定確認

# LTE QoS最適化（大容量画像転送対応）
send_at 'AT+CGEQMIN=1,4,1024,1024,1024,1024' false 3   # 最小QoS設定: 1Mbps
send_at 'AT+CGEQREQ=1,4,5120,5120,5120,5120' false 3   # 要求QoS設定: 5Mbps

# ネットワーク選択最適化
send_at 'AT+COPS=0,2' false 3         # 自動ネットワーク選択

# 3G互換問題対応
send_at 'AT!IMPREF="GENERIC"' false 3  # イメージ設定

# 大容量データ転送最適化
send_at 'AT+CGATT=1' false 3          # PS Service有効
send_at 'AT+CGACT=1,1' false 3        # PDP Context有効化

log_init "設定完了。モジュールリセット実行中..."

# === 6. ソフトリセットと最終確認 ===
send_at 'AT!RESET' false 5
log_init "モジュールリセット完了。10秒待機..."
sleep 10

# === 7. 設定確認とログ出力 ===
log_init "=== 設定確認 ==="
send_at 'AT!SELRAT?' false 3
send_at 'AT!BAND?' false 3
send_at 'AT+CGDCONT?' false 3
send_at 'AT+CGATT?' false 3

log_init "=== EM7430 LTE初期化完了 ==="
log_init "約30秒後にMBIMデバイスとして認識されます"

exit 0