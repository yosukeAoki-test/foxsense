#!/bin/bash
#
# EM7430 モデム設定バックアップスクリプト
# ファームウェア更新前に実行
#

DEVICE_AT="/dev/ttyUSB2"
BACKUP_DIR="/root/agri-iot/modem_backup"
BACKUP_FILE="$BACKUP_DIR/modem_config_$(date +%Y%m%d_%H%M%S).txt"

echo "==========================================="
echo "  EM7430 モデム設定バックアップ"
echo "==========================================="
echo ""

# バックアップディレクトリ作成
mkdir -p $BACKUP_DIR

# ログファイル作成
echo "バックアップ実行日時: $(date)" > $BACKUP_FILE
echo "" >> $BACKUP_FILE

# AT通信設定
if [ -c "$DEVICE_AT" ]; then
    stty -F $DEVICE_AT 115200 raw -echo 2>/dev/null
else
    echo "ERROR: $DEVICE_AT が見つかりません"
    exit 1
fi

# ATコマンド送信関数
send_at() {
    local cmd="$1"
    local desc="$2"

    echo "取得中: $desc"
    echo "=== $desc ===" >> $BACKUP_FILE
    echo "コマンド: $cmd" >> $BACKUP_FILE

    echo -e "${cmd}\r" > $DEVICE_AT
    sleep 2
    timeout 3 cat < $DEVICE_AT 2>&1 | tr -d '\r' | grep -v "^$" >> $BACKUP_FILE
    echo "" >> $BACKUP_FILE
}

# モデム情報取得
echo "[1/12] モデル情報..."
send_at "ATI" "モデル情報"

echo "[2/12] ファームウェアバージョン..."
send_at "AT+CGMR" "ファームウェアバージョン"

echo "[3/12] IMEI..."
send_at "AT+CGSN" "IMEI"

echo "[4/12] SIM状態..."
send_at "AT+CPIN?" "SIM状態"

echo "[5/12] RAT設定..."
send_at "AT!SELRAT?" "RAT設定 (LTE/WCDMA/Auto)"

echo "[6/12] バンド設定..."
send_at "AT!BAND?" "バンド設定"

echo "[7/12] PDP Context設定..."
send_at "AT+CGDCONT?" "PDP Context設定"

echo "[8/12] PDP Context状態..."
send_at "AT+CGACT?" "PDP Context状態"

echo "[9/12] ネットワーク登録状態..."
send_at "AT+CREG?" "ネットワーク登録状態"

echo "[10/12] オペレーター情報..."
send_at "AT+COPS?" "オペレーター情報"

echo "[11/12] 信号強度..."
send_at "AT+CSQ" "信号強度"

echo "[12/12] USB構成..."
send_at "AT!USBCOMP?" "USB構成"

# /etc/mbim-network.conf のバックアップ
echo ""
echo "[追加] 設定ファイルバックアップ..."
echo "=== /etc/mbim-network.conf ===" >> $BACKUP_FILE
cat /etc/mbim-network.conf >> $BACKUP_FILE 2>/dev/null
echo "" >> $BACKUP_FILE

echo "=== /root/agri-iot/shell/mbim-network.conf ===" >> $BACKUP_FILE
cat /root/agri-iot/shell/mbim-network.conf >> $BACKUP_FILE 2>/dev/null
echo "" >> $BACKUP_FILE

# デバイス情報
echo "=== lsusb (EM7430) ===" >> $BACKUP_FILE
lsusb | grep -i sierra >> $BACKUP_FILE
echo "" >> $BACKUP_FILE

echo "=== デバイスノード ===" >> $BACKUP_FILE
ls -la /dev/ttyUSB* /dev/cdc-wdm* 2>&1 >> $BACKUP_FILE
echo "" >> $BACKUP_FILE

echo ""
echo "==========================================="
echo "  バックアップ完了！"
echo "==========================================="
echo ""
echo "バックアップファイル: $BACKUP_FILE"
echo ""
echo "次のステップ:"
echo "  1. バックアップ内容確認:"
echo "     cat $BACKUP_FILE"
echo ""
echo "  2. ファームウェア更新実行"
echo ""
