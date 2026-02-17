#!/bin/bash

# Raspberry Pi側で実行するプルスクリプト
# 使用方法: Raspberry Piで実行
# wget/curlでMacから直接ファイルを取得

set -e

# 設定（MacのIPアドレスを指定）
SOURCE_HOST="${1:-192.168.3.100}"  # Macのアドレスに変更してください
SOURCE_USER="${2:-aoki_dog}"
SOURCE_DIR="/Users/aoki_dog/agri-iot2/shell"

echo "🔄 Macからファイルを取得します"
echo "接続先: ${SOURCE_USER}@${SOURCE_HOST}:${SOURCE_DIR}"

# ディレクトリ作成
sudo mkdir -p /root/agri-iot/shell
sudo mkdir -p /root/agri-iot/log
sudo mkdir -p /usr/local/bin
sudo mkdir -p /etc/systemd/system
sudo mkdir -p /etc/logrotate.d

# 一時ディレクトリ
TMPDIR="/tmp/agri-deploy"
rm -rf $TMPDIR
mkdir -p $TMPDIR

echo "📥 ファイルをダウンロード中..."

# rsyncでMacから直接取得（Raspberry Pi側から実行）
rsync -avz "${SOURCE_USER}@${SOURCE_HOST}:${SOURCE_DIR}/" $TMPDIR/ \
    --exclude="*.DS_Store" \
    --exclude=".claude" \
    --exclude="deploy*.sh" \
    --exclude="raspi_pull.sh"

echo "📁 ファイルを配置中..."

# メインスクリプト配置
if [ -d "$TMPDIR" ]; then
    # シェル/Pythonスクリプト
    sudo cp -f $TMPDIR/*.py /root/agri-iot/shell/ 2>/dev/null || true
    sudo cp -f $TMPDIR/*.sh /root/agri-iot/shell/ 2>/dev/null || true
    sudo cp -f $TMPDIR/conf.txt /root/agri-iot/shell/ 2>/dev/null || true
    sudo cp -f $TMPDIR/mbim-network.conf /root/agri-iot/shell/ 2>/dev/null || true

    # 実行権限
    sudo chmod +x /root/agri-iot/shell/*.sh
    sudo chmod 644 /root/agri-iot/shell/*.py
    sudo chmod 644 /root/agri-iot/shell/*.txt
    sudo chmod 644 /root/agri-iot/shell/*.conf
fi

# ネットワーク関連を/usr/local/binへ
NETWORK_SCRIPTS="network-startup.sh network_mode.sh prefer_wifi.sh soracom-connect.sh soracom-ip-setup.sh em7430_init.sh wifi_off_1h.sh"
for script in $NETWORK_SCRIPTS; do
    if [ -f "$TMPDIR/$script" ]; then
        sudo cp -f "$TMPDIR/$script" /usr/local/bin/
        sudo chmod +x "/usr/local/bin/$script"
    fi
done

# systemdサービス
for service in $TMPDIR/*.service; do
    if [ -f "$service" ]; then
        sudo cp -f "$service" /etc/systemd/system/
        sudo chmod 644 "/etc/systemd/system/$(basename $service)"
    fi
done

# logrotate
if [ -f "$TMPDIR/logrotate.d-network_mode" ]; then
    sudo cp -f "$TMPDIR/logrotate.d-network_mode" /etc/logrotate.d/network_mode
    sudo chmod 644 /etc/logrotate.d/network_mode
fi

# systemd再読み込み
echo "⚙️ サービスを設定中..."
sudo systemctl daemon-reload

for service in network-startup soracom prefer_wifi; do
    if [ -f "/etc/systemd/system/${service}.service" ]; then
        sudo systemctl enable ${service}.service 2>/dev/null || true
        echo "  ✅ ${service}.service 有効化"
    fi
done

# クリーンアップ
rm -rf $TMPDIR

echo ""
echo "========================================="
echo "✅ ファイル取得・配置完了！"
echo "========================================="
echo ""
echo "ファイルサイズを確認:"
ls -lh /root/agri-iot/shell/*.py | head -5
echo ""
echo "次の手順:"
echo "1. sudo /root/agri-iot/shell/cronjob.sh"
echo "2. sudo reboot"