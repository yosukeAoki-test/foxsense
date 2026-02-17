#!/bin/bash
#
# EM7430デバイス認識修正スクリプト
#

LOG_FILE="/tmp/em7430_device_fix.log"

log_fix() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [EM7430_FIX] $1" | tee -a $LOG_FILE
}

log_fix "=== EM7430デバイス認識修正開始 ==="

# 1. ModemManager停止
log_fix "ModemManager停止中..."
sudo systemctl stop ModemManager
sudo systemctl disable ModemManager

# 2. 既存モジュール削除
log_fix "カーネルモジュール削除中..."
sudo modprobe -r qmi_wwan cdc_mbim cdc_wdm option

# 3. USBデバイスのリセット
log_fix "USBデバイスリセット中..."
# USB全体のリセット
echo "1" | sudo tee /sys/bus/usb/devices/usb*/authorized 2>/dev/null
sleep 2
echo "0" | sudo tee /sys/bus/usb/devices/usb*/authorized 2>/dev/null
sleep 2
echo "1" | sudo tee /sys/bus/usb/devices/usb*/authorized 2>/dev/null

# 4. カーネルモジュール再読み込み
log_fix "カーネルモジュール再読み込み中..."
sudo modprobe option
sudo modprobe cdc_wdm
sudo modprobe cdc_mbim
sudo modprobe qmi_wwan

# 5. EM7430デバイスID強制登録
log_fix "EM7430デバイスID登録中..."
echo "1199 907d" | sudo tee /sys/bus/usb-serial/drivers/option1/new_id 2>/dev/null
echo "1199 907d" | sudo tee /sys/bus/usb/drivers/qmi_wwan/new_id 2>/dev/null

# 6. 待機とデバイス確認
sleep 10
log_fix "デバイス認識確認中..."

if [ -e /dev/cdc-wdm0 ] && [ -e /dev/ttyUSB2 ]; then
    log_fix "SUCCESS: 両デバイスファイルが作成されました"
    log_fix "  /dev/cdc-wdm0: $(ls -la /dev/cdc-wdm0)"
    log_fix "  /dev/ttyUSB2: $(ls -la /dev/ttyUSB2)"
else
    log_fix "ERROR: デバイスファイル作成失敗"
    log_fix "  /dev/cdc-wdm0: $(ls -la /dev/cdc-wdm0 2>/dev/null || echo '存在しません')"
    log_fix "  /dev/ttyUSB2: $(ls -la /dev/ttyUSB2 2>/dev/null || echo '存在しません')"
fi

# 7. USB認識状況
log_fix "USB認識状況:"
lsusb | grep -i sierra | while read line; do
    log_fix "  $line"
done

log_fix "=== EM7430デバイス認識修正完了 ==="