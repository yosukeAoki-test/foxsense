#!/bin/bash

# Mac側で実行: ファイルをtar.gzに圧縮してRaspberry Piに転送

set -e

# 設定
TARGET="${1:-pi@192.168.3.112}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_NAME="agri-iot-${TIMESTAMP}.tar.gz"

echo "📦 Mac側: パッケージ作成開始"
echo "対象: $TARGET"
echo ""

# 一時ディレクトリ作成
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# ディレクトリ構造を作成
mkdir -p "$TMPDIR/agri-iot/shell"
mkdir -p "$TMPDIR/agri-iot/bin"
mkdir -p "$TMPDIR/agri-iot/systemd"
mkdir -p "$TMPDIR/agri-iot/config"

echo "📁 ファイルを整理中..."

# メインスクリプト・設定ファイル
cp -f *.py "$TMPDIR/agri-iot/shell/" 2>/dev/null || true
cp -f mist.sh relay.sh cronjob.sh report.sh update.sh "$TMPDIR/agri-iot/shell/" 2>/dev/null || true
cp -f conf.txt mbim-network.conf "$TMPDIR/agri-iot/shell/" 2>/dev/null || true

# /usr/local/bin用ファイル
cp -f network-startup.sh network_mode.sh prefer_wifi.sh "$TMPDIR/agri-iot/bin/" 2>/dev/null || true
cp -f soracom-connect.sh soracom-ip-setup.sh em7430_init.sh "$TMPDIR/agri-iot/bin/" 2>/dev/null || true
cp -f wifi_off_1h.sh "$TMPDIR/agri-iot/bin/" 2>/dev/null || true

# systemdサービスファイル
cp -f *.service "$TMPDIR/agri-iot/systemd/" 2>/dev/null || true

# その他の設定
cp -f logrotate.d-network_mode "$TMPDIR/agri-iot/config/" 2>/dev/null || true
cp -f dhcpcd.conf.addition "$TMPDIR/agri-iot/config/" 2>/dev/null || true

# Raspberry Pi側のインストールスクリプトも含める
cat > "$TMPDIR/agri-iot/install.sh" << 'EOF'
#!/bin/bash
# Raspberry Pi側で実行するインストールスクリプト
echo "このスクリプトはraspi_install.shで置き換えられます"
EOF

# tar.gz作成
echo "🗜️ 圧縮中: $ARCHIVE_NAME"
tar czf "$ARCHIVE_NAME" -C "$TMPDIR" agri-iot/

# ファイルサイズ表示
SIZE=$(ls -lh "$ARCHIVE_NAME" | awk '{print $5}')
echo "📦 アーカイブサイズ: $SIZE"

# Raspberry Piに転送
echo "📤 転送中: $TARGET:/tmp/"
scp "$ARCHIVE_NAME" "$TARGET:/tmp/"

# ローカルのアーカイブを削除
rm -f "$ARCHIVE_NAME"

echo ""
echo "========================================="
echo "✅ Mac側の処理完了！"
echo "========================================="
echo ""
echo "次の手順（Raspberry Pi側で実行）:"
echo ""
echo "1. ssh $TARGET"
echo "2. cd /tmp"
echo "3. tar tzf $ARCHIVE_NAME  # 中身確認（任意）"
echo "4. ./raspi_install.sh /tmp/$ARCHIVE_NAME  # インストール実行"
echo ""
echo "転送したファイル: /tmp/$ARCHIVE_NAME"