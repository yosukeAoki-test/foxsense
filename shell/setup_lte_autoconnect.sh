#!/bin/bash
#
# SORACOM LTE自動接続セットアップスクリプト
# 実行方法: sudo bash setup_lte_autoconnect.sh
#

SCRIPT_DIR=$(cd $(dirname $0); pwd)

echo "========================================="
echo "  SORACOM LTE自動接続セットアップ"
echo "========================================="

# root権限確認
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: root権限で実行してください"
    echo "実行: sudo bash $0"
    exit 1
fi

echo ""
echo "[1/6] LTE接続スクリプトのインストール..."
if [ -f "$SCRIPT_DIR/lte_soracom_connect.sh" ]; then
    cp "$SCRIPT_DIR/lte_soracom_connect.sh" /usr/local/bin/
    chmod +x /usr/local/bin/lte_soracom_connect.sh
    echo "  ✓ /usr/local/bin/lte_soracom_connect.sh"
else
    echo "  ERROR: lte_soracom_connect.sh not found"
    exit 1
fi

echo ""
echo "[2/6] systemdサービスのインストール..."
if [ -f "$SCRIPT_DIR/lte-soracom.service" ]; then
    cp "$SCRIPT_DIR/lte-soracom.service" /etc/systemd/system/
    echo "  ✓ /etc/systemd/system/lte-soracom.service"
else
    echo "  ERROR: lte-soracom.service not found"
    exit 1
fi

echo ""
echo "[3/6] LTEモード永続化（em7430_init.sh更新）..."
if [ -f /root/agri-iot/shell/em7430_init.sh ]; then
    # LTE onlyモード設定を追加/更新
    if grep -q "AT!SELRAT=" /root/agri-iot/shell/em7430_init.sh; then
        sed -i 's/AT!SELRAT=[0-9]*/AT!SELRAT=06/' /root/agri-iot/shell/em7430_init.sh
        echo "  ✓ em7430_init.sh更新済み (LTE only mode)"
    else
        # SELRAT設定を追加（ファイル末尾に）
        echo 'echo -e "AT!SELRAT=06\r" > /dev/ttyUSB2 && sleep 2' >> /root/agri-iot/shell/em7430_init.sh
        echo "  ✓ em7430_init.sh更新 (LTE only mode追加)"
    fi

    # 念のため今すぐLTEモード設定
    echo -e "AT!SELRAT=06\r" > /dev/ttyUSB2 2>/dev/null && sleep 2
    timeout 2 cat < /dev/ttyUSB2 2>/dev/null
fi

echo ""
echo "[4/6] systemdデーモン再読み込み..."
systemctl daemon-reload
echo "  ✓ daemon-reload完了"

echo ""
echo "[5/6] サービス有効化..."
systemctl enable lte-soracom.service
echo "  ✓ lte-soracom.service有効化完了"

echo ""
echo "[6/6] ログディレクトリ確認..."
touch /var/log/lte_connect.log
chmod 644 /var/log/lte_connect.log
echo "  ✓ /var/log/lte_connect.log"

echo ""
echo "========================================="
echo "  セットアップ完了！"
echo "========================================="
echo ""
echo "次のステップ:"
echo "  1. サービス起動テスト:"
echo "     sudo systemctl start lte-soracom.service"
echo ""
echo "  2. 状態確認:"
echo "     sudo systemctl status lte-soracom.service"
echo "     sudo /usr/local/bin/lte_soracom_connect.sh status"
echo ""
echo "  3. ログ確認:"
echo "     sudo tail -f /var/log/lte_connect.log"
echo "     sudo journalctl -u lte-soracom.service -f"
echo ""
echo "  4. 再起動テスト:"
echo "     sudo reboot"
echo "     (再起動後、自動的にLTE接続が確立されます)"
echo ""
