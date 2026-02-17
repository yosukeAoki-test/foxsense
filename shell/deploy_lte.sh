#!/bin/bash
#
# agri-iot2 全コード一括デプロイツール
# Usage: ./deploy_lte.sh [OPTIONS] <device_ip> [device_ip2] ...
#
# Options:
#   --setup-drivers, -d  ドライバ・パッケージのセットアップも実行
#   --full, -f           全コードデプロイ（センサー・ミスト・リレー含む）
#   --lte-only, -l       LTEスクリプトのみデプロイ（デフォルト）
#
# Example:
#   ./deploy_lte.sh 192.168.3.101 192.168.3.102
#   ./deploy_lte.sh --full 192.168.3.101  # 全コードデプロイ
#   ./deploy_lte.sh --setup-drivers --full 192.168.3.101  # 初回フルセットアップ
#

SCRIPT_DIR=$(cd $(dirname $0); pwd)
PASSWORD="Serena22#"
SETUP_DRIVERS=false
FULL_DEPLOY=false

# オプション解析
while [[ "$1" == -* ]]; do
    case "$1" in
        --setup-drivers|-d)
            SETUP_DRIVERS=true
            shift
            ;;
        --full|-f)
            FULL_DEPLOY=true
            shift
            ;;
        --lte-only|-l)
            FULL_DEPLOY=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# 引数チェック
if [ $# -eq 0 ]; then
    echo "Usage: $0 [OPTIONS] <device_ip> [device_ip2] ..."
    echo ""
    echo "Options:"
    echo "  --setup-drivers, -d  ドライバ・パッケージのセットアップも実行"
    echo "  --full, -f           全コードデプロイ（センサー・ミスト・リレー含む）"
    echo "  --lte-only, -l       LTEスクリプトのみデプロイ（デフォルト）"
    echo ""
    echo "Example:"
    echo "  $0 192.168.3.101 192.168.3.102"
    echo "  $0 --full 192.168.3.101"
    echo "  $0 --setup-drivers --full 192.168.3.101"
    exit 1
fi

DEVICES=("$@")

# ドライバセットアップ関数
setup_drivers() {
    local DEVICE_IP=$1
    echo "[DRIVER] ドライバ・パッケージセットアップ中..."

    sshpass -p "$PASSWORD" ssh -o ConnectTimeout=30 -o StrictHostKeyChecking=no pi@$DEVICE_IP << 'REMOTE'
        echo "[1/6] パッケージインストール..."
        sudo apt update -qq
        sudo apt install -y libmbim-utils libqmi-utils usb-modeswitch usb-modeswitch-data ppp net-tools python3-pip python3-rpi.gpio 2>/dev/null

        echo "[2/6] Python依存パッケージ..."
        pip3 install requests pytz pyserial 2>/dev/null || true

        echo "[3/6] カーネルモジュール確認..."
        for mod in cdc_mbim cdc_ncm cdc_wdm option usb_wwan; do
            if ! lsmod | grep -q $mod; then
                sudo modprobe $mod 2>/dev/null
            fi
        done

        # 永続化
        for mod in cdc_mbim option usb_wwan; do
            if ! grep -q "^$mod$" /etc/modules 2>/dev/null; then
                echo "$mod" | sudo tee -a /etc/modules > /dev/null
            fi
        done

        echo "[4/6] ModemManager無効化..."
        sudo systemctl stop ModemManager 2>/dev/null
        sudo systemctl disable ModemManager 2>/dev/null

        echo "[5/6] udevルール設定..."
        # EM7430用udevルール
        sudo tee /etc/udev/rules.d/99-em7430.rules > /dev/null << 'UDEV'
# Sierra Wireless EM7430
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="1199", ATTR{idProduct}=="907d", RUN+="/bin/sh -c 'echo 1199 907d > /sys/bus/usb-serial/drivers/option1/new_id 2>/dev/null || true'"
ACTION=="add|change", SUBSYSTEM=="usb", ATTR{idVendor}=="1199", ENV{ID_MM_DEVICE_IGNORE}="1"
UDEV

        # USB電源管理無効化
        sudo tee /etc/udev/rules.d/50-usb-power.rules > /dev/null << 'UDEV'
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="1199", ATTR{power/autosuspend}="-1"
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="1199", ATTR{power/control}="on"
UDEV

        sudo udevadm control --reload-rules
        sudo udevadm trigger

        echo "[6/6] デバイス認識確認..."
        if lsusb | grep -qi sierra; then
            echo "[OK] EM7430検出"
        elif lsusb | grep -qi quectel; then
            echo "[OK] Quectel検出"
        elif lsusb | grep -qi ABIT; then
            echo "[OK] AK-020検出"
        else
            echo "[INFO] LTEモデム未接続"
        fi

        echo "[DRIVER] ドライバセットアップ完了"
REMOTE
}

deploy_to_device() {
    local DEVICE_IP=$1
    local STEP_COUNT=8
    if [ "$SETUP_DRIVERS" = true ]; then
        STEP_COUNT=$((STEP_COUNT + 1))
    fi

    echo ""
    echo "=========================================="
    echo "  Deploying to $DEVICE_IP"
    if [ "$FULL_DEPLOY" = true ]; then
        echo "  モード: 全コードデプロイ"
    else
        echo "  モード: LTEスクリプトのみ"
    fi
    if [ "$SETUP_DRIVERS" = true ]; then
        echo "  (ドライバセットアップ含む)"
    fi
    echo "=========================================="

    # 接続テスト
    echo "[1/$STEP_COUNT] 接続確認..."
    if ! ping -c 1 -W 3 $DEVICE_IP > /dev/null 2>&1; then
        echo "[ERROR] $DEVICE_IP に接続できません"
        return 1
    fi

    # SSHホストキー確認・削除
    ssh-keygen -R $DEVICE_IP 2>/dev/null

    # ホスト名取得
    HOSTNAME=$(sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP "hostname" 2>/dev/null)
    if [ -z "$HOSTNAME" ]; then
        echo "[ERROR] SSH接続失敗"
        return 1
    fi
    echo "[OK] ホスト名: $HOSTNAME"

    # ドライバセットアップ（オプション）
    local CURRENT_STEP=2
    if [ "$SETUP_DRIVERS" = true ]; then
        echo "[$CURRENT_STEP/$STEP_COUNT] ドライバセットアップ..."
        setup_drivers $DEVICE_IP
        CURRENT_STEP=$((CURRENT_STEP + 1))
    fi

    # ファイル転送
    echo "[$CURRENT_STEP/$STEP_COUNT] ファイル転送中..."

    # LTEスクリプト（必須）
    sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
        $SCRIPT_DIR/mbim_connect_stable.sh \
        $SCRIPT_DIR/mbim_connect.sh \
        $SCRIPT_DIR/network_mode.sh \
        $SCRIPT_DIR/ppp_connect.sh \
        $SCRIPT_DIR/detect_modem.sh \
        $SCRIPT_DIR/network-startup.sh \
        $SCRIPT_DIR/wifi_off_1h_fixed.sh \
        $SCRIPT_DIR/mbim-network.conf \
        pi@$DEVICE_IP:/tmp/ 2>/dev/null

    # コアスクリプト
    sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
        $SCRIPT_DIR/cronjob.sh \
        $SCRIPT_DIR/report.sh \
        $SCRIPT_DIR/update.sh \
        $SCRIPT_DIR/conf.txt \
        pi@$DEVICE_IP:/tmp/ 2>/dev/null

    if [ "$FULL_DEPLOY" = true ]; then
        # センサースクリプト
        sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
            $SCRIPT_DIR/am2301bhumi.py \
            $SCRIPT_DIR/am2301btemp.py \
            $SCRIPT_DIR/ds18b20.py \
            $SCRIPT_DIR/soil_sensor_temp.py \
            $SCRIPT_DIR/soil_sensor_vwc.py \
            pi@$DEVICE_IP:/tmp/ 2>/dev/null

        # ミスト/リレースクリプト
        sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
            $SCRIPT_DIR/mist.py \
            $SCRIPT_DIR/mist.sh \
            $SCRIPT_DIR/relay.py \
            $SCRIPT_DIR/relay.sh \
            $SCRIPT_DIR/relay_demo.py \
            pi@$DEVICE_IP:/tmp/ 2>/dev/null

        # サービスファイル
        sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
            $SCRIPT_DIR/network-startup.service \
            $SCRIPT_DIR/relay_demo.service \
            pi@$DEVICE_IP:/tmp/ 2>/dev/null
    fi

    if [ $? -ne 0 ]; then
        echo "[ERROR] ファイル転送失敗"
        return 1
    fi
    echo "[OK] ファイル転送完了"

    # インストール
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo "[$CURRENT_STEP/$STEP_COUNT] スクリプトインストール中..."

    if [ "$FULL_DEPLOY" = true ]; then
        # 全コードインストール
        sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP << 'REMOTE'
            sudo mkdir -p /root/agri-iot/shell

            # LTEスクリプト
            sudo cp /tmp/mbim_connect_stable.sh /root/agri-iot/shell/
            sudo cp /tmp/mbim_connect.sh /root/agri-iot/shell/
            sudo cp /tmp/network_mode.sh /root/agri-iot/shell/
            sudo cp /tmp/ppp_connect.sh /root/agri-iot/shell/
            sudo cp /tmp/detect_modem.sh /root/agri-iot/shell/
            sudo cp /tmp/wifi_off_1h_fixed.sh /root/agri-iot/shell/

            # コアスクリプト
            sudo cp /tmp/cronjob.sh /root/agri-iot/shell/
            sudo cp /tmp/report.sh /root/agri-iot/shell/
            sudo cp /tmp/update.sh /root/agri-iot/shell/

            # conf.txt（既存がない場合のみコピー - センサー電源GPIO設定必須）
            if [ ! -f /root/agri-iot/shell/conf.txt ]; then
                sudo cp /tmp/conf.txt /root/agri-iot/shell/
                echo "[WARN] conf.txt をテンプレートからコピーしました。terminal_id の設定が必要です。"
            fi

            # センサースクリプト
            sudo cp /tmp/am2301bhumi.py /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/am2301btemp.py /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/ds18b20.py /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/soil_sensor_temp.py /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/soil_sensor_vwc.py /root/agri-iot/shell/ 2>/dev/null || true

            # ミスト/リレースクリプト
            sudo cp /tmp/mist.py /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/mist.sh /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/relay.py /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/relay.sh /root/agri-iot/shell/ 2>/dev/null || true
            sudo cp /tmp/relay_demo.py /root/agri-iot/shell/ 2>/dev/null || true

            # /usr/local/binへコピー
            sudo cp /tmp/network_mode.sh /usr/local/bin/
            sudo cp /tmp/mbim_connect_stable.sh /usr/local/bin/
            sudo cp /tmp/network-startup.sh /usr/local/bin/

            # 設定ファイル
            sudo cp /tmp/mbim-network.conf /etc/
            sudo cp /tmp/network-startup.service /etc/systemd/system/ 2>/dev/null || true
            sudo cp /tmp/relay_demo.service /etc/systemd/system/ 2>/dev/null || true

            # 実行権限付与
            sudo chmod +x /root/agri-iot/shell/*.sh 2>/dev/null || true
            sudo chmod +x /root/agri-iot/shell/*.py 2>/dev/null || true
            sudo chmod +x /usr/local/bin/network_mode.sh
            sudo chmod +x /usr/local/bin/mbim_connect_stable.sh
            sudo chmod +x /usr/local/bin/network-startup.sh
REMOTE
    else
        # LTEスクリプトのみ
        sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP << 'REMOTE'
            sudo mkdir -p /root/agri-iot/shell

            # LTEスクリプト
            sudo cp /tmp/mbim_connect_stable.sh /root/agri-iot/shell/
            sudo cp /tmp/mbim_connect.sh /root/agri-iot/shell/
            sudo cp /tmp/network_mode.sh /root/agri-iot/shell/
            sudo cp /tmp/ppp_connect.sh /root/agri-iot/shell/
            sudo cp /tmp/detect_modem.sh /root/agri-iot/shell/
            sudo cp /tmp/wifi_off_1h_fixed.sh /root/agri-iot/shell/

            # コアスクリプト
            sudo cp /tmp/cronjob.sh /root/agri-iot/shell/
            sudo cp /tmp/report.sh /root/agri-iot/shell/
            sudo cp /tmp/update.sh /root/agri-iot/shell/

            # conf.txt（既存がない場合のみコピー - センサー電源GPIO設定必須）
            if [ ! -f /root/agri-iot/shell/conf.txt ]; then
                sudo cp /tmp/conf.txt /root/agri-iot/shell/
                echo "[WARN] conf.txt をテンプレートからコピーしました。terminal_id の設定が必要です。"
            fi

            # /usr/local/binへコピー
            sudo cp /tmp/network_mode.sh /usr/local/bin/
            sudo cp /tmp/mbim_connect_stable.sh /usr/local/bin/
            sudo cp /tmp/network-startup.sh /usr/local/bin/

            # 設定ファイル
            sudo cp /tmp/mbim-network.conf /etc/

            # 実行権限付与
            sudo chmod +x /root/agri-iot/shell/*.sh
            sudo chmod +x /usr/local/bin/network_mode.sh
            sudo chmod +x /usr/local/bin/mbim_connect_stable.sh
            sudo chmod +x /usr/local/bin/network-startup.sh
REMOTE
    fi
    echo "[OK] インストール完了"

    # systemdサービス設定
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo "[$CURRENT_STEP/$STEP_COUNT] systemdサービス設定中..."
    sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP << 'REMOTE'
        sudo tee /etc/systemd/system/network-startup.service > /dev/null << 'EOF'
[Unit]
Description=Network Startup Configuration
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/bin/sleep 10
ExecStart=/usr/local/bin/network-startup.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
        sudo systemctl daemon-reload
        sudo systemctl enable network-startup.service 2>/dev/null
REMOTE
    echo "[OK] systemdサービス設定完了"

    # dhcpcd.conf設定（LTE安定化のため必須）
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo "[$CURRENT_STEP/$STEP_COUNT] dhcpcd.conf設定中..."
    sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP << 'REMOTE'
        # denyinterfaces wwan0 がない場合は追加（LTE安定化のため必須）
        if ! grep -q "denyinterfaces wwan0" /etc/dhcpcd.conf 2>/dev/null; then
            sudo cp /etc/dhcpcd.conf /etc/dhcpcd.conf.backup.$(date +%Y%m%d)
            sudo tee -a /etc/dhcpcd.conf > /dev/null << 'EOF'

# LTE wwan0インターフェースをdhcpcdから除外（LTE安定化のため必須）
denyinterfaces wwan0

# DNS設定を保護（LTEスクリプトが管理）
nohook resolv.conf
EOF
            echo "[追加] denyinterfaces wwan0, nohook resolv.conf"
            sudo systemctl restart dhcpcd
        else
            echo "[OK] dhcpcd.conf設定済み"
        fi

        # 既存のリンクローカルアドレスがあれば削除
        if ip addr show wwan0 2>/dev/null | grep -q "169.254"; then
            LINK_LOCAL=$(ip addr show wwan0 | grep "169.254" | awk '{print $2}')
            sudo ip addr del $LINK_LOCAL dev wwan0 2>/dev/null
            echo "[削除] wwan0のリンクローカルアドレス: $LINK_LOCAL"
        fi
REMOTE
    echo "[OK] dhcpcd.conf設定完了"

    # crontab確認
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo "[$CURRENT_STEP/$STEP_COUNT] crontab確認..."
    CRONTAB=$(sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP "sudo crontab -l 2>/dev/null")

    if echo "$CRONTAB" | grep -q "cronjob.sh"; then
        if echo "$CRONTAB" | grep "cronjob.sh" | grep -q "\-c"; then
            echo "[OK] crontabに-cフラグあり"
        else
            echo "[WARN] crontabに-cフラグがありません！"
            echo "       手動で追加してください: cronjob.sh ... -c ..."
        fi
    else
        echo "[INFO] cronjob.shがcrontabにありません"
    fi

    # LTE接続テスト
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo "[$CURRENT_STEP/$STEP_COUNT] LTE接続テスト..."

    # モデム検出（EM7430/AK-020/Quectel）
    MODEM_INFO=$(sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP "lsusb" 2>/dev/null)

    if echo "$MODEM_INFO" | grep -qiE "sierra|1199:"; then
        echo "[OK] EM7430モデム検出"
        echo "     MBIM接続テスト実行中..."
        sshpass -p "$PASSWORD" ssh -o ConnectTimeout=60 -o StrictHostKeyChecking=no pi@$DEVICE_IP \
            "sudo /usr/local/bin/network_mode.sh connect 2>&1 | tail -5"
    elif echo "$MODEM_INFO" | grep -qiE "quectel|2c7c:"; then
        echo "[OK] Quectel EC25モデム検出"
        echo "     PPP接続テスト実行中..."
        sshpass -p "$PASSWORD" ssh -o ConnectTimeout=60 -o StrictHostKeyChecking=no pi@$DEVICE_IP \
            "sudo /usr/local/bin/network_mode.sh connect 2>&1 | tail -5"
    elif echo "$MODEM_INFO" | grep -qiE "ABIT|15eb:"; then
        echo "[OK] AK-020モデム検出"
        echo "     MBIM接続テスト実行中..."
        sshpass -p "$PASSWORD" ssh -o ConnectTimeout=60 -o StrictHostKeyChecking=no pi@$DEVICE_IP \
            "sudo /usr/local/bin/network_mode.sh connect 2>&1 | tail -5"
    else
        echo "[INFO] LTEモデムが検出されませんでした"
    fi

    # デプロイ結果サマリー
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo "[$CURRENT_STEP/$STEP_COUNT] デプロイ結果確認..."
    sshpass -p "$PASSWORD" ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@$DEVICE_IP << 'REMOTE'
        echo "--- インストール済みスクリプト ---"
        ls -la /root/agri-iot/shell/*.sh 2>/dev/null | wc -l | xargs -I{} echo "シェルスクリプト: {}個"
        ls -la /root/agri-iot/shell/*.py 2>/dev/null | wc -l | xargs -I{} echo "Pythonスクリプト: {}個"
        echo "--- 設定ファイル ---"
        [ -f /etc/mbim-network.conf ] && echo "mbim-network.conf: OK" || echo "mbim-network.conf: NG"
        if [ -f /root/agri-iot/shell/conf.txt ]; then
            TERM_ID=$(grep "terminal_id=" /root/agri-iot/shell/conf.txt | cut -d= -f2)
            GPIO=$(grep "sensor_power_gpio=" /root/agri-iot/shell/conf.txt | cut -d= -f2)
            if [ "$TERM_ID" = "1234" ]; then
                echo "conf.txt: [要設定] terminal_id=1234 (デフォルト値)"
            else
                echo "conf.txt: OK (terminal_id=$TERM_ID, gpio=$GPIO)"
            fi
        else
            echo "conf.txt: [必須] なし - センサーが動作しません！"
        fi
REMOTE

    echo ""
    echo "[DONE] $DEVICE_IP ($HOSTNAME) へのデプロイ完了"
    return 0
}

# メイン処理
echo "=========================================="
echo "  agri-iot2 一括デプロイツール"
echo "  対象デバイス: ${#DEVICES[@]}台"
if [ "$FULL_DEPLOY" = true ]; then
    echo "  モード: 全コードデプロイ"
else
    echo "  モード: LTEスクリプトのみ"
fi
echo "=========================================="

SUCCESS_COUNT=0
FAIL_COUNT=0

for DEVICE_IP in "${DEVICES[@]}"; do
    if deploy_to_device "$DEVICE_IP"; then
        ((SUCCESS_COUNT++))
    else
        ((FAIL_COUNT++))
    fi
done

echo ""
echo "=========================================="
echo "  デプロイ完了"
echo "  成功: $SUCCESS_COUNT / 失敗: $FAIL_COUNT"
echo "=========================================="

# 注意喚起
echo ""
echo "[重要な注意事項]"
echo "1. crontabに-cフラグを追加してください:"
echo "   例: cronjob.sh -a -b -c"
echo ""
echo "2. デバイス固有設定はデプロイされません:"
echo "   - conf.txt（端末ID、GPIO設定）"
echo "   - mist_conf.py（ミスト端末ID）"
echo "   - relay_conf.py（リレー端末ID）"
echo ""
echo "3. meeq SIMの場合はAPN設定を変更:"
echo "   echo 'APN=meeq.io' > /etc/mbim-network.conf"
echo ""
