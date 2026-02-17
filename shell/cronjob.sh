#!/bin/sh
#
# rootのcronによって定期的に起動され、気温・湿度・写真などのデータをサーバーにPOSTする
# WiFi障害時は自動的にLTEに切り替える
#

# cron環境設定
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LANG=C

# 多重実行防止
PIDFILE=/var/run/cronjob.pid
if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 前回の処理がまだ実行中 (PID: $OLD_PID)"
        exit 0
    fi
fi
echo $$ > "$PIDFILE"
trap "rm -f $PIDFILE" EXIT

# パラメータ解析
while getopts :cpu OPT ; do
	case $OPT in
		"c" ) FLG_C="TRUE";;
		"p" ) FLG_P="TRUE";;
		"u" ) FLG_U="TRUE";;
	esac
done

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# 設定ファイルの読込
. $SCRIPT_DIR/conf.txt

# ========================================
# 【新機能】WiFi健全性チェック関数
# ========================================
check_wifi_health() {
    local wifi_operstate=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)
    local wifi_has_ip=$(ip addr show wlan0 2>/dev/null | grep -q "inet " && echo "yes" || echo "no")
    local wifi_has_route=$(ip route | grep -q "^default.*wlan0" && echo "yes" || echo "no")
    
    # WiFiインターフェースが起動しているか
    if [ "$wifi_operstate" != "up" ]; then
        echo "wifi_down"
        return 1
    fi
    
    # WiFiにIPアドレスがあるか
    if [ "$wifi_has_ip" != "yes" ]; then
        echo "wifi_no_ip"
        return 1
    fi
    
    # WiFiデフォルトルートがあるか
    if [ "$wifi_has_route" != "yes" ]; then
        echo "wifi_no_route"
        return 1
    fi
    
    # WiFiゲートウェイに到達可能か（最重要）
    if ! ping -c 2 -W 3 192.168.3.1 >/dev/null 2>&1; then
        echo "wifi_unreachable"
        return 1
    fi
    
    # 全てクリア - WiFi健全
    echo "wifi_healthy"
    return 0
}

# ========================================
# 【新機能】ネットワーク自動選択ロジック
# ========================================
if [ "$FLG_C" != "" ]; then
    WIFI_HEALTH=$(check_wifi_health)
    
    if [ "$WIFI_HEALTH" = "wifi_healthy" ]; then
        # WiFi健全 - LTE接続をスキップ
        WIFI_STATE=$(iwgetid -r 2>/dev/null || echo "WiFi-Connected")
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi健全（SSID: $WIFI_STATE）- LTE接続スキップ"
        FLG_C=""
    else
        # WiFi障害検知 - LTEに切り替え
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] WiFi障害検知: $WIFI_HEALTH - LTEに切り替え"
        
        # WiFiを明示的に無効化（競合防止）
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi一時停止中..."
        ip link set wlan0 down 2>/dev/null
        
        # LTE接続実行
        $SCRIPT_DIR/network_mode.sh connect
        
        if [ $? -eq 0 ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTE接続成功"

            # LTE接続後の安定化待機
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTE接続後の安定化のため60秒待機"
            sleep 60

            # カメラモジュールの状態確認
            vcgencmd get_camera > /dev/null 2>&1
            sleep 1
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] LTE接続失敗 - WiFiを復帰"
            ip link set wlan0 up 2>/dev/null
            FLG_C=""
        fi
    fi
fi

# 通信中なら待機する
for i in `seq 1 10`; do
	ps -aux | grep "mbimcli\|qmi-network" | grep -v grep > /dev/null
	if [ $? = 0 ]; then
		sleep 3
	else
		break
	fi
done

# プログラムの更新チェック
[ "$FLG_U" != "" ] && $SCRIPT_DIR/update.sh $@

# 情報の取得と送信
$SCRIPT_DIR/report.sh $@

# 切断（LTE使用時のみ）
if [ "$FLG_C" != "" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTE切断中..."
    $SCRIPT_DIR/network_mode.sh disconnect
    
    # WiFi復帰
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi復帰中..."
    ip link set wlan0 up 2>/dev/null
    sleep 5
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi復帰完了"
fi
