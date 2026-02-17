#!/bin/bash
#
# MBIM安定化セットアップスクリプト
# 実行方法: sudo bash setup_stable_mbim.sh
#

SCRIPT_DIR=$(cd $(dirname $0); pwd)

echo "========================================="
echo "  EM7430 MBIM安定化セットアップ"
echo "========================================="

# root権限確認
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: このスクリプトはroot権限で実行してください"
    echo "実行: sudo bash $0"
    exit 1
fi

echo ""
echo "[1/6] ModemManagerの無効化..."
systemctl stop ModemManager
systemctl disable ModemManager
systemctl mask ModemManager
echo "  ✓ ModemManager無効化完了"

echo ""
echo "[2/6] udev rulesのインストール..."
if [ -f "$SCRIPT_DIR/99-em7430-modemmanager-ignore.rules" ]; then
    cp "$SCRIPT_DIR/99-em7430-modemmanager-ignore.rules" /etc/udev/rules.d/
    echo "  ✓ udev rules設置完了: /etc/udev/rules.d/99-em7430-modemmanager-ignore.rules"

    # udev rulesを再読み込み
    udevadm control --reload-rules
    udevadm trigger
    echo "  ✓ udev rules再読み込み完了"
else
    echo "  ⚠ 99-em7430-modemmanager-ignore.rules が見つかりません"
fi

echo ""
echo "[3/6] 安定版スクリプトのインストール..."
if [ -f "$SCRIPT_DIR/mbim_connect_stable.sh" ]; then
    cp "$SCRIPT_DIR/mbim_connect_stable.sh" /usr/local/bin/
    chmod +x /usr/local/bin/mbim_connect_stable.sh
    echo "  ✓ mbim_connect_stable.sh設置完了: /usr/local/bin/mbim_connect_stable.sh"
else
    echo "  ERROR: mbim_connect_stable.sh が見つかりません"
    exit 1
fi

echo ""
echo "[4/6] MBIM設定ファイルの作成..."
cat > /etc/mbim-network.conf << 'EOF'
APN=meeq.io
PROXY=no
IP_TYPE=ipv4
USER=meeq
PASSWORD=meeq
AUTH_TYPE=chap
EOF
echo "  ✓ /etc/mbim-network.conf作成完了"

echo ""
echo "[5/6] カーネルモジュールのリフレッシュ..."
# 既存のmbimcliプロセスを終了
pkill -9 mbimcli 2>/dev/null
pkill -9 -f "mbim-network" 2>/dev/null

# カーネルモジュール再読み込み
modprobe -r qmi_wwan cdc_mbim cdc_wdm option 2>/dev/null
sleep 2
modprobe option
modprobe cdc_wdm
modprobe cdc_mbim
modprobe qmi_wwan

# デバイスID登録
echo "1199 907d" > /sys/bus/usb-serial/drivers/option1/new_id 2>/dev/null || true
echo "1199 907d" > /sys/bus/usb/drivers/qmi_wwan/new_id 2>/dev/null || true

sleep 5
echo "  ✓ カーネルモジュールリフレッシュ完了"

echo ""
echo "[6/6] デバイス確認..."
if [ -e /dev/cdc-wdm0 ]; then
    echo "  ✓ /dev/cdc-wdm0 確認: $(ls -l /dev/cdc-wdm0)"
else
    echo "  ⚠ /dev/cdc-wdm0 が見つかりません"
    echo "    システム再起動後に認識される可能性があります"
fi

if [ -e /dev/ttyUSB2 ]; then
    echo "  ✓ /dev/ttyUSB2 確認: $(ls -l /dev/ttyUSB2)"
else
    echo "  ⚠ /dev/ttyUSB2 が見つかりません"
fi

echo ""
echo "========================================="
echo "  セットアップ完了"
echo "========================================="
echo ""
echo "次のステップ:"
echo "  1. 再起動推奨: sudo reboot"
echo "  2. 再起動後、接続テスト:"
echo "     sudo /usr/local/bin/mbim_connect_stable.sh connect"
echo ""
echo "  診断情報取得:"
echo "     sudo /usr/local/bin/mbim_connect_stable.sh diagnose"
echo ""
echo "  切断:"
echo "     sudo /usr/local/bin/mbim_connect_stable.sh disconnect"
echo ""
