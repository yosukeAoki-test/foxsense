#!/bin/bash
#
# EM7430 安定版MBIM接続スクリプト
# タイムアウト対策、リトライ機構、デバイスクリーンアップ強化版
#

DEVICE="/dev/cdc-wdm0"
IFACE="wwan0"
LOG_FILE="/tmp/mbim_connect_stable.log"

# APN設定: /etc/mbim-network.conf から読み込み（存在する場合）
if [ -f /etc/mbim-network.conf ]; then
    APN=$(grep "^APN=" /etc/mbim-network.conf | cut -d'=' -f2)
    APN_USER=$(grep "^APN_USER=" /etc/mbim-network.conf | cut -d'=' -f2)
    APN_PASS=$(grep "^APN_PASS=" /etc/mbim-network.conf | cut -d'=' -f2)
    APN_AUTH=$(grep "^APN_AUTH=" /etc/mbim-network.conf | cut -d'=' -f2 | tr '[:upper:]' '[:lower:]')
fi

# デフォルト値（SORACOM）
APN="${APN:-soracom.io}"
APN_USER="${APN_USER:-sora}"
APN_PASS="${APN_PASS:-sora}"
APN_AUTH="${APN_AUTH:-chap}"

# ログ関数
log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [MBIM_STABLE] $1" | tee -a $LOG_FILE
}

# エラー時の終了関数
error_exit() {
    log_msg "ERROR: $1"
    exit 1
}

# タイムアウト付きコマンド実行
run_with_timeout() {
    local timeout_sec=$1
    shift
    local cmd="$@"

    log_msg "実行: $cmd (timeout: ${timeout_sec}s)"
    timeout $timeout_sec bash -c "$cmd" 2>&1
    local result=$?

    if [ $result -eq 124 ]; then
        log_msg "WARN: タイムアウト (${timeout_sec}s)"
        return 124
    elif [ $result -ne 0 ]; then
        log_msg "WARN: コマンド失敗 (exit: $result)"
        return $result
    fi

    return 0
}

# USBモデムリセット
reset_usb_modem() {
    log_msg "USBモデムリセット中..."

    # EM7430のVendor:Product ID
    local USB_ID="1199:907d"

    if command -v usbreset &>/dev/null; then
        usbreset $USB_ID 2>/dev/null && log_msg "USBリセット成功" || log_msg "WARN: USBリセット失敗"
    else
        # usbresetがない場合はドライバーバインド解除/再バインド
        local USB_PATH=$(ls -d /sys/bus/usb/devices/*/idVendor 2>/dev/null | while read f; do
            if [ "$(cat $f 2>/dev/null)" = "1199" ]; then
                dirname $f
            fi
        done | head -1)

        if [ -n "$USB_PATH" ]; then
            local DEV_NAME=$(basename $USB_PATH)
            echo $DEV_NAME > /sys/bus/usb/drivers/usb/unbind 2>/dev/null
            sleep 1
            echo $DEV_NAME > /sys/bus/usb/drivers/usb/bind 2>/dev/null
            log_msg "USBドライバー再バインド完了"
        fi
    fi

    sleep 3
}

# 全MBIMプロセスの強制終了
kill_all_mbim_processes() {
    log_msg "全MBIMプロセスをクリーンアップ中..."

    # mbimcliプロセスを強制終了
    pkill -9 mbimcli 2>/dev/null
    pkill -9 -f "mbim-network" 2>/dev/null
    pkill -9 mbim-proxy 2>/dev/null

    # ModemManagerを停止（競合回避）
    systemctl stop ModemManager 2>/dev/null
    systemctl disable ModemManager 2>/dev/null

    # MBIM状態ファイルを削除
    rm -f /tmp/mbim-network-state-* 2>/dev/null

    sleep 1
    log_msg "MBIMプロセスクリーンアップ完了"
}

# デバイスの健全性確認
check_device_health() {
    log_msg "=== デバイス健全性確認 ==="

    # デバイスファイルの存在確認
    if [ ! -e "$DEVICE" ]; then
        log_msg "ERROR: MBIMデバイス $DEVICE が見つかりません"
        log_msg "デバイス修復スクリプトを実行してください: em7430_device_fix.sh"
        return 1
    fi

    # デバイスへの基本アクセス確認（タイムアウト付き）
    log_msg "デバイス基本確認中..."
    local device_caps=$(run_with_timeout 10 "mbimcli -d $DEVICE --query-device-caps")

    if [ $? -eq 124 ]; then
        log_msg "ERROR: デバイス応答タイムアウト - デバイス再初期化が必要"
        return 1
    elif [ $? -ne 0 ]; then
        log_msg "WARN: デバイス確認で警告（継続）"
    else
        log_msg "デバイス確認成功"
    fi

    return 0
}

# シンプルなMBIM接続（方式1: mbimcli直接実行）
mbim_connect_direct() {
    log_msg "=== MBIM直接接続方式 ==="

    # インターフェースのクリーンアップ
    ip link set $IFACE down 2>/dev/null
    ip addr flush dev $IFACE 2>/dev/null
    sleep 1

    # 接続コマンド構築
    local connect_cmd="mbimcli -d $DEVICE --connect=\"apn=${APN}"
    if [ -n "$APN_USER" ] && [ "$APN_USER" != "unset" ]; then
        connect_cmd="${connect_cmd},username=${APN_USER},password=${APN_PASS},auth=${APN_AUTH}"
    fi
    connect_cmd="${connect_cmd}\""

    log_msg "接続実行: $connect_cmd"

    # タイムアウト付きで接続実行
    local connect_output=$(run_with_timeout 30 "$connect_cmd")
    local connect_result=$?

    log_msg "接続結果 (exit=$connect_result):"
    echo "$connect_output" | while IFS= read -r line; do
        log_msg "  $line"
    done

    if [ $connect_result -eq 0 ] && echo "$connect_output" | grep -qi "successfully\|connected"; then
        log_msg "MBIM接続成功（直接方式）"
        return 0
    else
        log_msg "ERROR: MBIM接続失敗（直接方式）"
        return 1
    fi
}

# mbim-network を使用した接続（方式2: 従来方式）
mbim_connect_via_network() {
    log_msg "=== mbim-network方式 ==="

    # 設定ファイルの確認と作成
    if [ ! -f /etc/mbim-network.conf ]; then
        log_msg "mbim-network.conf を作成中..."
        cat > /etc/mbim-network.conf << EOF
APN=${APN}
PROXY=no
IP_TYPE=ipv4
USER=${APN_USER}
PASSWORD=${APN_PASS}
AUTH_TYPE=${APN_AUTH}
EOF
    fi

    # mbim-network start（出力抑制で高速化）
    log_msg "mbim-network start 実行中..."
    mbim-network $DEVICE start >/dev/null 2>&1
    local network_result=$?

    if [ $network_result -eq 0 ]; then
        log_msg "MBIM接続成功（mbim-network方式）"
        return 0
    else
        log_msg "ERROR: mbim-network接続失敗"
        return 1
    fi
}

# 安定版IP設定（セッション安定化待機付き）
# ★重要: mbim-network startでセッション作成後、十分な待機時間を設けてから
#   TRIDを状態ファイルから取得し、セッションを維持したままIP設定を取得する方式
fast_ip_setup() {
    local cached_ip="${1:-}"
    local ip_addr=""

    log_msg "=== 安定版IP設定（セッション安定化待機付き）==="

    # インターフェース起動
    ip link set $IFACE up 2>/dev/null
    ip addr flush dev $IFACE 2>/dev/null
    log_msg "インターフェース $IFACE 起動、2秒待機..."
    sleep 2

    # TRIDを状態ファイルから取得（mbim-networkが作成）
    local TRID=""
    if [ -f /tmp/mbim-network-state-cdc-wdm0 ]; then
        TRID=$(grep 'TRID=' /tmp/mbim-network-state-cdc-wdm0 | tail -1 | cut -d'=' -f2 | tr -d '\"')
        log_msg "MBIM TRID取得: $TRID"
    else
        TRID="7"
        log_msg "TRID状態ファイルなし、デフォルト値使用: $TRID"
    fi

    # 方式1: セッション維持しながらIP取得（引数順序重要）
    log_msg "mbimcli --query-ip-configuration --no-open=$TRID --no-close でIP取得試行..."
    local ip_config=$(timeout 10 mbimcli -d $DEVICE --query-ip-configuration --no-open=$TRID --no-close 2>&1)

    if echo "$ip_config" | grep -q "IP \[0\]"; then
        # IPアドレス抽出（/プレフィックス付きの場合と無しの場合に対応）
        ip_addr=$(echo "$ip_config" | grep -oP "IP \[0\]:\s*'\K[^'/]*" | head -1)
        local ip_with_prefix=$(echo "$ip_config" | grep -oP "IP \[0\]:\s*'\K[^']*" | head -1)
        local ip_gw=$(echo "$ip_config" | grep -oP "Gateway:\s*'\K[^']*" | head -1)
        local ip_dns=$(echo "$ip_config" | grep -oP "DNS \[0\]:\s*'\K[^']*" | head -1)

        if [ -n "$ip_addr" ]; then
            log_msg "MBIM IP取得成功: $ip_addr (full: $ip_with_prefix)"
            echo "$ip_addr" > /tmp/wwan0_cached_ip
            [ -n "$ip_gw" ] && echo "$ip_gw" > /tmp/wwan0_gateway
            [ -n "$ip_dns" ] && echo "$ip_dns" > /tmp/wwan0_dns

            # IP設定（/32でポイントツーポイント接続）
            ip addr add ${ip_addr}/32 dev $IFACE 2>/dev/null
            ip link set $IFACE mtu 1428 2>/dev/null
            log_msg "IP設定完了: $ip_addr"
            return 0
        fi
    fi

    # 方式2: 通常のmbimcliでIP取得（セッションが維持されている場合用）
    log_msg "フォールバック: 通常mbimcli経由でIP取得試行..."
    ip_config=$(timeout 5 mbimcli -d $DEVICE --query-ip-configuration 2>&1)
    if echo "$ip_config" | grep -q "IP \[0\]"; then
        ip_addr=$(echo "$ip_config" | grep -oP "IP \[0\]:\s*'\K[^'/]*" | head -1)
        local ip_gw=$(echo "$ip_config" | grep -oP "Gateway:\s*'\K[^']*" | head -1)

        if [ -n "$ip_addr" ]; then
            log_msg "通常MBIM IP取得成功: $ip_addr"
            echo "$ip_addr" > /tmp/wwan0_cached_ip
            [ -n "$ip_gw" ] && echo "$ip_gw" > /tmp/wwan0_gateway

            ip addr add ${ip_addr}/32 dev $IFACE 2>/dev/null
            ip link set $IFACE mtu 1428 2>/dev/null
            log_msg "IP設定完了: $ip_addr"
            return 0
        fi
    fi

    # 方式3: キャッシュIPがあればそれを使用
    if [ -n "$cached_ip" ] && [ "$cached_ip" != "..." ] && [ "$cached_ip" != "" ]; then
        log_msg "キャッシュIP使用: $cached_ip"
        ip_addr="$cached_ip"
    elif [ -f /tmp/wwan0_cached_ip ]; then
        cached_ip=$(cat /tmp/wwan0_cached_ip)
        log_msg "フォールバック: 前回キャッシュIP使用: $cached_ip"
        ip_addr="$cached_ip"
    else
        log_msg "ERROR: IP取得失敗（キャッシュもなし）"
        return 1
    fi

    # IPアドレス設定
    if [ -n "$ip_addr" ]; then
        ip addr add ${ip_addr}/32 dev $IFACE 2>/dev/null
        echo "$ip_addr" > /tmp/wwan0_cached_ip
    fi

    # MTU設定
    ip link set $IFACE mtu 1428 2>/dev/null

    return 0
}

# IP設定の取得と適用
configure_ip_address() {
    log_msg "=== IP設定の取得と適用 ==="

    # wwan0インターフェースの起動
    if [ ! -e /sys/class/net/$IFACE ]; then
        log_msg "ERROR: インターフェース $IFACE が見つかりません"
        return 1
    fi

    log_msg "インターフェース $IFACE を起動中..."
    ip link set $IFACE up
    # ★遅延を最小化（セッション維持のため）
    sleep 0.5

    # MBIM経由でIP設定取得（タイムアウト付き）
    log_msg "MBIM IP設定取得中..."
    local ip_config=$(run_with_timeout 15 "mbimcli -d $DEVICE -p --query-ip-configuration")
    local ip_result=$?

    if [ $ip_result -eq 0 ] && echo "$ip_config" | grep -q "IP \[0\]"; then
        log_msg "MBIM IP設定取得成功:"
        echo "$ip_config" | while IFS= read -r line; do
            log_msg "  $line"
        done

        # IPアドレスとゲートウェイを抽出
        local ip_addr=$(echo "$ip_config" | grep "IP \[0\]:" | awk -F"'" '{print $2}' | head -1)
        local gw_addr=$(echo "$ip_config" | grep "Gateway:" | awk -F"'" '{print $2}' | head -1)
        if [ -n "$ip_addr" ]; then
            log_msg "IPアドレス設定: ${ip_addr}"
            ip addr flush dev $IFACE 2>/dev/null
            ip addr add ${ip_addr} dev $IFACE 2>/dev/null
            ip link set $IFACE up
            ip link set $IFACE mtu 1428
            if [ -n "$gw_addr" ]; then
                log_msg "ゲートウェイ: ${gw_addr}"
                echo "$gw_addr" > /tmp/wwan0_gateway
            fi
            return 0
        fi
    fi

    # MBIMでIP取得失敗時はATコマンドにフォールバック
    log_msg "WARN: MBIM IP取得失敗、ATコマンドでリトライ..."

    if [ -x /usr/local/bin/soracom-ip-setup.sh ]; then
        /usr/local/bin/soracom-ip-setup.sh
        return $?
    else
        log_msg "ERROR: IP設定スクリプトが見つかりません"
        return 1
    fi
}

# ルーティング設定
configure_routing() {
    log_msg "=== ルーティング設定 ==="

    # 既存のwwan0ルートを削除
    ip route del default dev $IFACE 2>/dev/null

    # WiFi状態を確認
    local wifi_state=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)

    if [ "$wifi_state" = "up" ] && ip addr show wlan0 | grep -q "inet "; then
        # WiFi接続中: WiFi優先、LTE補助
        log_msg "WiFi接続中 - WiFi優先ルート設定"

        # WiFi優先ルート確認
        if ! ip route | grep -q "default.*wlan0"; then
            local wifi_gw=$(ip route | grep "^default" | awk '{print $3}' | head -1)
            if [ -z "$wifi_gw" ]; then
                wifi_gw="192.168.3.1"
            fi
            ip route add default via $wifi_gw dev wlan0 metric 100 2>/dev/null
        fi

        # LTE補助ルート（ゲートウェイ使用）
        local lte_gw=$(cat /tmp/wwan0_gateway 2>/dev/null)
        if [ -n "$lte_gw" ]; then
            ip route add default via $lte_gw dev $IFACE metric 700 2>/dev/null
        else
            ip route add default dev $IFACE metric 700 2>/dev/null
        fi
        log_msg "ルート設定完了: WiFi優先 + LTE(metric 700)"
    else
        # WiFi未接続: LTE専用
        log_msg "WiFi未接続 - LTE専用ルート設定"
        local lte_gw=$(cat /tmp/wwan0_gateway 2>/dev/null)
        if [ -n "$lte_gw" ]; then
            ip route add default via $lte_gw dev $IFACE metric 200 2>/dev/null
        else
            ip route add default dev $IFACE metric 200 2>/dev/null
        fi

        if [ $? -eq 0 ]; then
            log_msg "LTEルート設定完了"

            # 接続テスト
            if ping -c 2 -W 3 -I $IFACE 8.8.8.8 >/dev/null 2>&1; then
                log_msg "LTE経由の接続テスト成功"
            else
                log_msg "WARN: LTE経由の接続テスト失敗"
            fi
        else
            log_msg "ERROR: LTEルート設定失敗"
            return 1
        fi
    fi

    return 0
}

# 接続状態の確認
verify_connection() {
    log_msg "=== 接続状態確認 ==="

    # 接続状態取得
    local conn_status=$(timeout 10 mbimcli -d $DEVICE -p --query-connection-state 2>&1)

    if echo "$conn_status" | grep -q "Activation state: 'activated'"; then
        log_msg "SUCCESS: MBIM接続がactivated状態です"
        return 0
    else
        log_msg "WARN: MBIM接続状態が不明または非アクティブ"
        log_msg "  $conn_status"
        return 1
    fi
}

# メイン接続処理
main_connect() {
    local use_usb_reset="${1:-false}"

    log_msg "========================================="
    log_msg "  EM7430 安定版MBIM接続開始"
    log_msg "  APN: $APN (User: $APN_USER)"
    log_msg "========================================="

    # ステップ1: 全プロセスクリーンアップ
    kill_all_mbim_processes

    # ステップ1.5: USBリセット（オプション、推奨）
    if [ "$use_usb_reset" = "true" ] || [ "$use_usb_reset" = "reset" ]; then
        reset_usb_modem
    fi

    # ステップ2: デバイス健全性確認
    if ! check_device_health; then
        log_msg "デバイス修復を実行します..."
        reset_usb_modem
        sleep 2
        if ! check_device_health; then
            error_exit "デバイス修復失敗"
        fi
    fi

    # ステップ3: MBIM接続（複数方式でリトライ）
    local connect_success=false

    # 方式1: mbim-network を優先（セッション維持に優れる）
    if mbim_connect_via_network; then
        connect_success=true
    else
        log_msg "mbim-network方式失敗、直接方式にフォールバック..."
        kill_all_mbim_processes
        sleep 1

        # 方式2: mbimcli直接実行を試行
        if mbim_connect_direct; then
            connect_success=true
        fi
    fi

    if [ "$connect_success" = false ]; then
        # 最終手段: USBリセット後に再試行
        log_msg "全方式失敗、USBリセット後に最終リトライ..."
        reset_usb_modem
        kill_all_mbim_processes
        if mbim_connect_via_network; then
            connect_success=true
        fi
    fi

    if [ "$connect_success" = false ]; then
        error_exit "全ての接続方式が失敗しました"
    fi

    # ★★★ 最重要: ステップ4: セッション安定化待機後にIP設定
    # mbim-network start後、セッションが安定するまで待機してからIP設定を実行
    log_msg "★★★ MBIMセッション安定化待機（10秒）..."
    sleep 10
    log_msg "安定化待機完了、IP設定を実行"

    # 安定版IP設定を使用（キャッシュIP優先）
    local cached_ip=""
    if [ -f /tmp/wwan0_cached_ip ]; then
        cached_ip=$(cat /tmp/wwan0_cached_ip)
    fi
    fast_ip_setup "$cached_ip"

    # ステップ5: ルーティング設定
    log_msg "=== ルーティング設定 ==="
    # 既存のwwan0ルートを全て削除
    ip route del default dev $IFACE 2>/dev/null
    ip route del default dev $IFACE metric 200 2>/dev/null
    ip route del default dev $IFACE metric 400 2>/dev/null
    ip route del default dev $IFACE metric 700 2>/dev/null

    ip route add default dev $IFACE metric 200 2>/dev/null
    log_msg "デフォルトルート設定完了 (metric 200)"

    # WiFiがある場合はmetric調整
    if ip link show wlan0 2>/dev/null | grep -q "state UP"; then
        ip route del default dev $IFACE metric 200 2>/dev/null
        ip route add default dev $IFACE metric 700 2>/dev/null
        log_msg "WiFi検出 - LTEをmetric 700に設定"
    fi

    # ステップ5.3: ソースルーティング設定（WiFi併用時に必須）
    # wwan0の/32アドレスでは戻りパケットがWiFi経由になるため、ソースベースルーティングが必要
    local wwan_ip=$(ip addr show $IFACE | grep "inet " | awk '{print $2}' | cut -d'/' -f1)
    if [ -n "$wwan_ip" ]; then
        # 既存のルールを削除（重複防止）
        ip rule del from $wwan_ip table 100 2>/dev/null
        ip route del default dev $IFACE table 100 2>/dev/null
        # ソースルーティング追加
        ip rule add from $wwan_ip table 100 2>/dev/null
        ip route add default dev $IFACE table 100 2>/dev/null
        log_msg "ソースルーティング設定完了 (from $wwan_ip table 100)"
    fi

    # ステップ5.5: DNS設定（Soracom DNS + 公開DNS）
    log_msg "=== DNS設定 ==="
    local dns_from_mbim=$(cat /tmp/wwan0_dns 2>/dev/null)
    chattr -i /etc/resolv.conf 2>/dev/null
    {
        echo "# Generated by mbim_connect_stable.sh"
        echo "# $(date '+%Y-%m-%d %H:%M:%S')"
        echo "nameserver 100.127.0.53"
        echo "nameserver 8.8.8.8"
        echo "nameserver 100.127.1.53"
        echo "nameserver 1.1.1.1"
        echo "options timeout:2"
        echo "options attempts:2"
        echo "options rotate"
    } > /etc/resolv.conf
    log_msg "DNS設定完了 (Soracom + 公開DNS)"

    # ステップ6: 接続テスト（状態確認クエリの代わりにping）
    log_msg "=== 接続テスト ==="
    if ping -c 2 -W 2 -I $IFACE 8.8.8.8 >/dev/null 2>&1; then
        log_msg "★ LTE接続成功（ping OK）"
    else
        log_msg "WARN: ping失敗（セッションが切れた可能性）"
    fi

    log_msg "========================================="
    log_msg "  EM7430 安定版MBIM接続完了"
    log_msg "========================================="

    return 0
}

# 切断処理
main_disconnect() {
    log_msg "=== MBIM切断開始 ==="

    # mbim-network stop
    timeout 20 mbim-network $DEVICE stop 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    # ソースルーティングクリーンアップ
    local wwan_ip=$(ip addr show $IFACE 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1)
    if [ -n "$wwan_ip" ]; then
        ip rule del from $wwan_ip table 100 2>/dev/null
        ip route del default dev $IFACE table 100 2>/dev/null
        log_msg "ソースルーティング削除完了"
    fi

    # インターフェースクリーンアップ
    ip route del default dev $IFACE 2>/dev/null
    ip addr flush dev $IFACE 2>/dev/null
    ip link set $IFACE down 2>/dev/null

    # プロセスクリーンアップ
    kill_all_mbim_processes

    log_msg "=== MBIM切断完了 ==="
}

# 診断情報取得
main_diagnose() {
    log_msg "=== MBIM診断情報 ==="

    log_msg "--- デバイス情報 ---"
    timeout 10 mbimcli -d $DEVICE --query-device-caps 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    log_msg "--- SIM情報 ---"
    timeout 10 mbimcli -d $DEVICE --query-subscriber-ready-status 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    log_msg "--- ネットワーク登録 ---"
    timeout 10 mbimcli -d $DEVICE --query-registration-state 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    log_msg "--- 接続状態 ---"
    timeout 10 mbimcli -d $DEVICE --query-connection-state 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    log_msg "--- 信号強度 ---"
    timeout 10 mbimcli -d $DEVICE --query-signal-state 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    log_msg "--- インターフェース状態 ---"
    ip addr show $IFACE 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done

    log_msg "--- ルーティング ---"
    ip route show 2>&1 | while IFS= read -r line; do
        log_msg "  $line"
    done
}

# メイン処理
case "$1" in
    "connect")
        main_connect "$2"
        exit $?
        ;;
    "reset-connect")
        # USBリセット付き接続（推奨）
        main_connect "true"
        exit $?
        ;;
    "disconnect")
        main_disconnect
        exit $?
        ;;
    "diagnose")
        main_diagnose
        exit $?
        ;;
    *)
        echo "Usage: $0 {connect|reset-connect|disconnect|diagnose}"
        echo "  connect       - 安定版MBIM接続実行"
        echo "  reset-connect - USBリセット後に接続（推奨、より確実）"
        echo "  disconnect    - MBIM切断"
        echo "  diagnose      - 診断情報取得"
        echo ""
        echo "APN設定: /etc/mbim-network.conf から読み込み"
        echo "現在のAPN: $APN"
        exit 1
        ;;
esac
