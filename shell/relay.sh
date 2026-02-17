#!/bin/sh
#
# rootのcronによって定期的に起動される
# mistから流用。温度取得についてreport｡shの関数を使用する
#
# パラメータ
#  -c 回線接続・切断処理を行う(MBIM)
#  -u モジュールアップデート確認を行う（必要であればアップデート実施）
#  -t システム内蔵温度センサー使用
#  -a AM2301b温度センサー使用

# 二重起動チェック
PGREP=`pgrep -f $0 -o`
if [ $$ != $PGREP ]&&[ $PPID != $PGREP ];
then
  exit 1
fi


# TODO: 要検討
sleep 10

# 通信中なら待機する
for i in `seq 1 10`
do
	ps -aux | grep "mbimcli\|qmi-network" | grep -v grep > /dev/null
	if [ $? = 0 ]; then
		sleep 3
	else
		break
	fi
done

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# ========================================
# WiFi健全性チェック関数
# ========================================
check_wifi_health() {
    local wifi_operstate=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)
    local wifi_has_ip=$(ip addr show wlan0 2>/dev/null | grep -q "inet " && echo "yes" || echo "no")

    # WiFiインターフェースが起動しているか
    if [ "$wifi_operstate" != "up" ]; then
        return 1
    fi

    # WiFiにIPアドレスがあるか
    if [ "$wifi_has_ip" != "yes" ]; then
        return 1
    fi

    # WiFiゲートウェイに到達可能か
    if ! ping -c 1 -W 2 192.168.3.1 >/dev/null 2>&1; then
        return 1
    fi

    # 全てクリア - WiFi健全
    return 0
}

# ========================================
# LTE接続状態チェック関数
# ========================================
check_lte_connected() {
    local wwan_operstate=$(cat /sys/class/net/wwan0/operstate 2>/dev/null)
    local wwan_has_ip=$(ip addr show wwan0 2>/dev/null | grep -q "inet " && echo "yes" || echo "no")

    # wwan0が起動しており、IPアドレスがある場合は接続済み
    if [ "$wwan_operstate" = "up" ] && [ "$wwan_has_ip" = "yes" ]; then
        return 0
    fi
    return 1
}

# ========================================
# LTE接続スロットル（5分以内の再接続を防止）
# ========================================
LTE_THROTTLE_FILE="/tmp/relay_lte_last_connect"
LTE_THROTTLE_SECONDS=300  # 5分

should_throttle_lte() {
    if [ ! -f "$LTE_THROTTLE_FILE" ]; then
        return 1  # ファイルなし = スロットル不要
    fi

    local last_connect=$(cat "$LTE_THROTTLE_FILE" 2>/dev/null)
    local now=$(date +%s)
    local elapsed=$((now - last_connect))

    if [ "$elapsed" -lt "$LTE_THROTTLE_SECONDS" ]; then
        return 0  # スロットル必要
    fi
    return 1  # スロットル不要
}

record_lte_connect() {
    date +%s > "$LTE_THROTTLE_FILE"
}

# パラメータ解析
while getopts :cputa OPT ; do
        case $OPT in
                "c" ) FLG_C="TRUE";;
                "u" ) FLG_U="TRUE";;
                "t" ) FLG_T="TRUE";;
                "a" ) FLG_A="TRUE";;
        esac
done

# 接続（WiFi健全時はスキップ、LTE接続済みなら再利用）
LTE_CONNECTED_BY_US=""
if [ "$FLG_C" != "" ]; then
        if check_wifi_health; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] WiFi健全 - LTE接続スキップ"
                FLG_C=""
        elif check_lte_connected; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] LTE接続済み - 再利用"
                # 既存接続を再利用（切断しない）
                FLG_C=""
        elif should_throttle_lte; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] LTEスロットル中 - 5分以内の再接続を防止"
                FLG_C=""
        else
                echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] WiFi障害 - LTE接続実行"
                $SCRIPT_DIR/network_mode.sh connect
                record_lte_connect
                LTE_CONNECTED_BY_US="TRUE"
        fi
fi

# リレー動作チェック
RELAY_ARGS=""
[ "$FLG_T" != "" ] && RELAY_ARGS="$RELAY_ARGS -t"
[ "$FLG_A" != "" ] && RELAY_ARGS="$RELAY_ARGS -a"
python3 $SCRIPT_DIR/relay.py $RELAY_ARGS

# プログラムの更新チェック
[ "$FLG_U" != "" ] && $SCRIPT_DIR/update.sh $@

# 切断（このスクリプトでLTE接続した場合のみ）
if [ "$LTE_CONNECTED_BY_US" = "TRUE" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] LTE切断中..."
        $SCRIPT_DIR/network_mode.sh disconnect

        # WiFi復帰
        echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] WiFi復帰中..."
        ip link set wlan0 up 2>/dev/null
        sleep 3
        echo "$(date '+%Y-%m-%d %H:%M:%S') [relay] WiFi復帰完了"
fi
