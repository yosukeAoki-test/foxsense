#!/bin/bash
#
# EM7430 PRI設定修正スクリプト
# KDDI PRIからDOCOMO PRIへ切り替え
#

DEVICE="/dev/cdc-wdm0"
LOG_FILE="/tmp/em7430_pri_fix.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [PRI_FIX] $1" | tee -a $LOG_FILE
}

log "=== EM7430 PRI設定修正開始 ==="

# ModemManager停止
log "ModemManagerを停止中..."
sudo systemctl stop ModemManager 2>/dev/null
sleep 2

# デバイス確認
if [ ! -e "$DEVICE" ]; then
    log "ERROR: $DEVICE が見つかりません"
    exit 1
fi

# 現在のPRI確認
log "現在のPRI設定を確認中..."
CURRENT_PRI=$(sudo qmicli -d $DEVICE --dms-list-stored-images --device-open-mbim 2>&1)
echo "$CURRENT_PRI" | tee -a $LOG_FILE

# DOCOMO PRIが必要か確認
if echo "$CURRENT_PRI" | grep -q "CURRENT.*DOCOMO"; then
    log "既にDOCOMO PRIが設定されています"
    exit 0
fi

if echo "$CURRENT_PRI" | grep -q "CURRENT.*KDDI"; then
    log "KDDI PRIが設定されています。DOCOMO PRIに切り替えます..."

    # DOCOMO PRIを選択
    log "DOCOMO PRI (modem0,pri0) を選択中..."
    sudo qmicli -d $DEVICE --dms-select-stored-image=modem0,pri0 --device-open-mbim 2>&1 | tee -a $LOG_FILE

    if [ $? -ne 0 ]; then
        log "ERROR: PRI選択に失敗しました"
        exit 1
    fi

    # モデムリセット
    log "モデムをリセット中..."
    sudo qmicli -d $DEVICE --dms-set-operating-mode=offline --device-open-mbim 2>&1 | tee -a $LOG_FILE
    sleep 2
    sudo qmicli -d $DEVICE --dms-set-operating-mode=reset --device-open-mbim 2>&1 | tee -a $LOG_FILE

    log "モデムリセット完了。15秒待機..."
    sleep 15

    # リセット後の確認
    log "Operating modeを確認中..."
    OP_MODE=$(sudo qmicli -d $DEVICE --dms-get-operating-mode --device-open-mbim 2>&1)
    echo "$OP_MODE" | tee -a $LOG_FILE

    if echo "$OP_MODE" | grep -q "Mode: 'online'"; then
        log "PRI切り替え成功！"
    else
        log "WARNING: Operating modeがonlineではありません"
    fi

    # ネットワーク登録確認
    log "ネットワーク登録状態を確認中..."
    sleep 5
    SERVING=$(sudo qmicli -d $DEVICE --nas-get-serving-system --device-open-mbim 2>&1)
    echo "$SERVING" | tee -a $LOG_FILE

    if echo "$SERVING" | grep -q "DOCOMO"; then
        log "NTT DOCOMOに登録成功！"
    else
        log "WARNING: ネットワーク登録を確認できません。しばらく待ってから再確認してください。"
    fi
else
    log "KDDI以外のPRIが設定されています。手動で確認してください。"
    exit 1
fi

log "=== PRI設定修正完了 ==="
log "次のステップ: mbim_connect.sh connect を実行してLTE接続を確立してください"
