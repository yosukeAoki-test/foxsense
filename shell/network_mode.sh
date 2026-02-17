#!/bin/bash

# cron環境設定
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LANG=C

# ログファイル設定
LOGFILE="/var/log/network_mode.log"

# スクリプトディレクトリ
SCRIPT_DIR=$(cd $(dirname $0); pwd)

# モデムタイプ（グローバル変数）
MODEM_TYPE=""
LTE_INTERFACE=""

# ログ出力関数
log_msg() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a $LOGFILE
}

# エラーハンドリング関数
error_exit() {
    log_msg "ERROR" "$1"
    exit 1
}

# モデム検出関数
detect_modem_type() {
    log_msg "INFO" "LTEモデム検出中..."

    if [ -x "$SCRIPT_DIR/detect_modem.sh" ]; then
        MODEM_TYPE=$($SCRIPT_DIR/detect_modem.sh detect)
    else
        # フォールバック: lsusbで直接検出（デバイスファイルより優先）
        if lsusb 2>/dev/null | grep -qiE "2c7c:0125|Quectel"; then
            # Quectel EC25 (PPP接続)
            MODEM_TYPE="quectel"
        elif lsusb 2>/dev/null | grep -qiE "1199:907|Sierra"; then
            # EM7430 (MBIM接続)
            MODEM_TYPE="em7430"
        elif lsusb 2>/dev/null | grep -qiE "15eb:7d0e|ABIT"; then
            # AK-020 (MBIM接続)
            MODEM_TYPE="ak020"
        elif [ -e /dev/cdc-wdm0 ]; then
            # 不明なMBIMデバイス
            MODEM_TYPE="em7430"
        else
            MODEM_TYPE="none"
        fi
    fi

    # インターフェース名設定
    case "$MODEM_TYPE" in
        "em7430")
            LTE_INTERFACE="wwan0"
            log_msg "INFO" "モデム検出: EM7430 (MBIM) - インターフェース: wwan0"
            ;;
        "ak020")
            LTE_INTERFACE="wwan0"
            log_msg "INFO" "モデム検出: AK-020 (MBIM) - インターフェース: wwan0"
            ;;
        "quectel")
            LTE_INTERFACE="ppp0"
            log_msg "INFO" "モデム検出: Quectel (PPP) - インターフェース: ppp0"
            ;;
        *)
            log_msg "ERROR" "LTEモデムが検出されませんでした"
            return 1
            ;;
    esac

    return 0
}

# MBIMセッション状態確認関数
check_mbim_session_active() {
    local state=$(mbimcli -d /dev/cdc-wdm0 --query-connection-state 2>/dev/null | grep "Activation state:" | awk -F"'" '{print $2}')
    if [ "$state" = "activated" ]; then
        return 0
    else
        log_msg "WARN" "MBIMセッション状態: $state (非アクティブ)"
        return 1
    fi
}

# WiFiゲートウェイ取得関数
get_wifi_gateway() {
    # 方法1: defaultルートから直接取得（最も確実）
    wifi_gw=$(ip route | grep "^default.*wlan0" | awk '{print $3}' | head -1)
    if [ -n "$wifi_gw" ]; then
        echo "$wifi_gw"
        return 0
    fi
    
    # 方法2: wlan0のネットワークから推定
    wifi_network=$(ip addr show wlan0 | grep "inet " | awk '{print $2}' | head -1)
    if [ -n "$wifi_network" ]; then
        # 192.168.3.100/24 -> 192.168.3.1 に変換
        echo "$wifi_network" | sed 's|\.[0-9]*/.*|.1|'
        return 0
    fi
    
    # 方法3: DHCPリースファイルから取得
    if [ -f /var/lib/dhcp/dhclient.wlan0.leases ]; then
        grep "option routers" /var/lib/dhcp/dhclient.wlan0.leases | tail -1 | awk '{print $3}' | tr -d ';'
        return 0
    fi
    
    return 1
}

# より確実なWiFi状態確認
check_wifi_connection() {
    # 1. インターフェース状態確認
    local wifi_operstate=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)
    [ "$wifi_operstate" != "up" ] && return 1
    
    # 2. IPアドレス取得確認
    ip addr show wlan0 2>/dev/null | grep -q "inet " || return 1
    
    # 3. デフォルトルート存在確認
    ip route | grep -q "^default.*wlan0" || return 1
    
    # 4. ゲートウェイ到達確認
    local wifi_gw=$(get_wifi_gateway)
    [ -n "$wifi_gw" ] && ping -c 1 -W 2 "$wifi_gw" >/dev/null 2>&1 || return 1
    
    return 0
}

if [ "$1" = "connect" ]; then
  log_msg "INFO" "[network_mode] LTE接続開始"

  # モデム検出
  if ! detect_modem_type; then
    error_exit "LTEモデムが見つかりません"
  fi

  # モデムタイプに応じた接続処理
  case "$MODEM_TYPE" in
    "em7430"|"ak020")
      # EM7430/AK-020 (MBIM) 接続
      log_msg "INFO" "$MODEM_TYPE MBIM接続開始..."

      # mbim-network設定ファイルの確認
      if [ ! -f /etc/mbim-network.conf ]; then
        log_msg "WARN" "/etc/mbim-network.conf が見つかりません"
      fi

      # MBIM安定版接続スクリプト使用（優先）
      if [ -x "$SCRIPT_DIR/mbim_connect_stable.sh" ]; then
        log_msg "INFO" "MBIM安定版スクリプトで接続実行..."
        lte_output=$($SCRIPT_DIR/mbim_connect_stable.sh connect 2>&1)
        lte_result=$?
        log_msg "INFO" "MBIM接続結果: $lte_output"
      elif [ -x "$SCRIPT_DIR/mbim_connect.sh" ]; then
        log_msg "INFO" "MBIM専用スクリプトで接続実行..."
        lte_output=$($SCRIPT_DIR/mbim_connect.sh connect 2>&1)
        lte_result=$?
        log_msg "INFO" "MBIM接続結果: $lte_output"
      else
        # フォールバック: 従来方式
        log_msg "INFO" "従来方式でmbim-network start 実行中..."
        lte_output=$(mbim-network /dev/cdc-wdm0 start 2>&1)
        lte_result=$?
      fi

      if [ $lte_result -ne 0 ]; then
        log_msg "ERROR" "LTE接続失敗: $lte_output"
        if [ -x "$SCRIPT_DIR/mbim_connect_stable.sh" ]; then
          log_msg "INFO" "LTE接続失敗のため詳細診断実行..."
          $SCRIPT_DIR/mbim_connect_stable.sh diagnose
        elif [ -x "$SCRIPT_DIR/mbim_connect.sh" ]; then
          log_msg "INFO" "LTE接続失敗のため詳細診断実行..."
          $SCRIPT_DIR/mbim_connect.sh diagnose
        fi
        error_exit "LTE接続の開始に失敗しました"
      fi

      # IP設定確認 + 実際の疎通確認（重要）
      # IPアドレスがあっても実際に通信できるか確認が必要
      if ip addr show wwan0 2>/dev/null | grep -q "inet 10\."; then
        # IPはあるが、実際にping疎通できるか確認（MBIMセッション状態は信頼性が低い）
        if ping -c 1 -W 3 -I wwan0 8.8.8.8 >/dev/null 2>&1; then
          log_msg "INFO" "mbim_connect_stable.shでIP設定完了済み、疎通確認OK"
        else
          # pingが失敗 - 再接続が必要
          log_msg "WARN" "IPアドレスはあるが疎通失敗 - 再接続実行"
          if [ -x "$SCRIPT_DIR/mbim_connect_stable.sh" ]; then
            $SCRIPT_DIR/mbim_connect_stable.sh connect 2>&1
            # 再接続後のping確認
            if ! ping -c 1 -W 3 -I wwan0 8.8.8.8 >/dev/null 2>&1; then
              log_msg "ERROR" "再接続後も疎通失敗"
              error_exit "LTE疎通の確立に失敗しました"
            fi
            log_msg "INFO" "LTE再接続・疎通確認成功"
          fi
        fi
      else
        # IP未設定の場合のみsoracom-ip-setup.shを実行
        log_msg "INFO" "soracom-ip-setup.sh を実行中..."
        if [ -x /usr/local/bin/soracom-ip-setup.sh ]; then
          /usr/local/bin/soracom-ip-setup.sh
          setup_result=$?
          if [ $setup_result -ne 0 ]; then
            log_msg "WARN" "soracom-ip-setup.sh 失敗"
            # IPアドレスがあれば続行
            if ! ip addr show wwan0 2>/dev/null | grep -q "inet "; then
              log_msg "ERROR" "wwan0にIPアドレスがありません"
              mbim-network /dev/cdc-wdm0 stop 2>/dev/null
              error_exit "IP設定に失敗したため、LTE接続を中止しました"
            fi
            log_msg "INFO" "soracom-ip-setup.sh失敗したがIP設定あり、続行"
          fi
        else
          log_msg "WARN" "soracom-ip-setup.sh が見つかりません（スキップ）"
        fi
      fi
      ;;

    "quectel")
      # Quectel (PPP/wvdial) 接続
      log_msg "INFO" "Quectel PPP接続開始..."

      if [ -x "$SCRIPT_DIR/ppp_connect.sh" ]; then
        lte_output=$($SCRIPT_DIR/ppp_connect.sh connect 2>&1)
        lte_result=$?
        log_msg "INFO" "PPP接続結果: $lte_output"
      else
        error_exit "ppp_connect.sh が見つかりません"
      fi

      if [ $lte_result -ne 0 ]; then
        log_msg "ERROR" "PPP接続失敗"
        if [ -x "$SCRIPT_DIR/ppp_connect.sh" ]; then
          $SCRIPT_DIR/ppp_connect.sh diagnose
        fi
        error_exit "LTE接続の開始に失敗しました"
      fi

      # PPPの場合、ppp_connect.sh内でIP/ルーティング設定済み
      log_msg "INFO" "PPP接続完了（IP設定済み）"
      ;;

    *)
      error_exit "未対応のモデムタイプ: $MODEM_TYPE"
      ;;
  esac

  log_msg "INFO" "LTE接続成功"

  # 最終疎通確認（MBIMモデムの場合）
  if [ "$MODEM_TYPE" = "em7430" ] || [ "$MODEM_TYPE" = "ak020" ]; then
    log_msg "INFO" "LTE実際の疎通確認中..."
    if ping -c 1 -W 5 -I wwan0 8.8.8.8 >/dev/null 2>&1; then
      log_msg "INFO" "LTE疎通確認OK"
    else
      log_msg "WARN" "LTE疎通確認失敗 - 再接続実行"
      if [ -x "$SCRIPT_DIR/mbim_connect_stable.sh" ]; then
        $SCRIPT_DIR/mbim_connect_stable.sh connect 2>&1
        # 最終確認
        if ping -c 1 -W 5 -I wwan0 8.8.8.8 >/dev/null 2>&1; then
          log_msg "INFO" "再接続後の疎通確認OK"
        else
          log_msg "ERROR" "再接続後も疎通失敗"
        fi
      fi
    fi
  fi

  # DNS設定（EM7430の場合はsoracom-ip-setup.shで実施済み、Quectelはppp_connect.shで実施済み）
  log_msg "INFO" "DNS設定完了"

  # LTE専用最適化実行（MBIM系モデムの場合）
  if [ "$MODEM_TYPE" = "em7430" ] || [ "$MODEM_TYPE" = "ak020" ]; then
    if [ -e /sys/class/net/wwan0 ]; then
      log_msg "INFO" "$MODEM_TYPE LTE専用最適化実行中..."

      # LTE最適化スクリプト実行
      if [ -x "$SCRIPT_DIR/lte_optimizer.sh" ]; then
        $SCRIPT_DIR/lte_optimizer.sh all
        log_msg "INFO" "LTE専用最適化完了"
      else
        # フォールバック: 従来方式
        log_msg "WARN" "LTE最適化スクリプトなし - 従来方式実行"
        ip link set dev wwan0 mtu 1428  # LTE最適MTU

        # 基本TCP最適化
        echo 16777216 > /proc/sys/net/core/rmem_max 2>/dev/null
        echo 16777216 > /proc/sys/net/core/wmem_max 2>/dev/null
        echo "4096 65536 16777216" > /proc/sys/net/ipv4/tcp_rmem 2>/dev/null
        echo "4096 65536 16777216" > /proc/sys/net/ipv4/tcp_wmem 2>/dev/null
        echo 1 > /proc/sys/net/ipv4/tcp_window_scaling 2>/dev/null
        echo 1 > /proc/sys/net/ipv4/tcp_timestamps 2>/dev/null
        echo bbr > /proc/sys/net/ipv4/tcp_congestion_control 2>/dev/null || \
        echo cubic > /proc/sys/net/ipv4/tcp_congestion_control 2>/dev/null

        log_msg "INFO" "従来方式最適化完了"
      fi

      # LTE品質モニタリング
      if [ -x "$SCRIPT_DIR/lte_optimizer.sh" ]; then
        $SCRIPT_DIR/lte_optimizer.sh monitor
      fi
    fi
  fi

  # LTE接続時のデフォルトルート設定（MBIM系モデムの場合、Quectelはppp_connect.sh内で設定済み）
  if [ "$MODEM_TYPE" = "em7430" ] || [ "$MODEM_TYPE" = "ak020" ]; then
    # 改善されたWiFi検出を使用
    if check_wifi_connection; then
      # WiFi接続中の場合、WiFiを優先ルートに設定
      log_msg "INFO" "WiFi接続確認済み - WiFi優先ルート設定"

      # 既存のdefaultルートをクリア
      ip route del default 2>/dev/null

      # WiFiを最優先ルートに設定
      wifi_gw=$(get_wifi_gateway)
      if [ -n "$wifi_gw" ]; then
          ip route add default via "$wifi_gw" dev wlan0 metric 100
          # LTEを補助ルートに設定
          ip route add default dev $LTE_INTERFACE metric 400 2>/dev/null
          log_msg "INFO" "WiFi優先ルート設定完了 (gw: $wifi_gw)"
      else
          log_msg "ERROR" "WiFiゲートウェイ取得失敗 - LTE単独ルート設定"
          ip route add default dev $LTE_INTERFACE
      fi
    else
      # WiFi未接続の場合、LTEをメインルートに設定
      log_msg "INFO" "WiFi未接続確認 - LTE専用ルート設定"
      ip route del default 2>/dev/null
      ip route add default dev $LTE_INTERFACE metric 200
      if [ $? -eq 0 ]; then
        log_msg "INFO" "LTEデフォルトルート設定完了 ($LTE_INTERFACE)"

        # 外部接続確認（改良版 - リトライ付き）
        local ping_success=false
        for retry in {1..3}; do
          if ping -c 2 -W 5 -I $LTE_INTERFACE 8.8.8.8 >/dev/null 2>&1; then
            log_msg "INFO" "LTE経由の外部接続確認成功 (試行 $retry)"
            ping_success=true
            break
          else
            log_msg "WARN" "LTE経由の外部接続確認失敗 (試行 $retry/3)"
            sleep 3
          fi
        done

        if [ "$ping_success" = false ]; then
          log_msg "WARN" "LTE接続確認: pingは失敗したが、接続自体は確立済み"
        fi
      else
        log_msg "WARN" "LTEデフォルトルート設定に失敗"
      fi
    fi
  fi

  log_msg "INFO" "[network_mode] LTE接続完了"
  exit 0
fi

if [ "$1" = "disconnect" ]; then
  log_msg "INFO" "[network_mode] LTE切断開始"

  # モデム検出
  detect_modem_type

  # モデムタイプに応じた切断処理
  case "$MODEM_TYPE" in
    "em7430"|"ak020")
      # EM7430/AK-020 (MBIM) 切断
      if [ ! -e /dev/cdc-wdm0 ]; then
        log_msg "WARN" "MBIMデバイスが見つかりませんが、切断処理を続行します"
      fi

      mbim_output=$(mbim-network /dev/cdc-wdm0 stop 2>&1)
      mbim_result=$?

      if [ $mbim_result -ne 0 ]; then
        log_msg "WARN" "mbim-network stop でエラーが発生: $mbim_output"
      else
        log_msg "INFO" "mbim-network stop 成功"
      fi

      # wwan0のデフォルトルートを削除
      log_msg "INFO" "wwan0のデフォルトルートを削除"
      ip route del default dev wwan0 2>/dev/null
      ip route del default dev wwan0 metric 200 2>/dev/null
      ip route del default dev wwan0 metric 400 2>/dev/null
      ;;

    "quectel")
      # Quectel (PPP) 切断
      if [ -x "$SCRIPT_DIR/ppp_connect.sh" ]; then
        $SCRIPT_DIR/ppp_connect.sh disconnect
      else
        # フォールバック
        pkill -9 wvdial 2>/dev/null
        pkill -9 pppd 2>/dev/null
      fi

      # ppp0のデフォルトルートを削除
      log_msg "INFO" "ppp0のデフォルトルートを削除"
      ip route del default dev ppp0 2>/dev/null
      ip route del default dev ppp0 metric 200 2>/dev/null
      ip route del default dev ppp0 metric 400 2>/dev/null
      ;;

    *)
      log_msg "WARN" "モデム未検出 - 汎用切断処理"
      mbim-network /dev/cdc-wdm0 stop 2>/dev/null
      pkill -9 wvdial 2>/dev/null
      pkill -9 pppd 2>/dev/null
      ip route del default dev wwan0 2>/dev/null
      ip route del default dev ppp0 2>/dev/null
      ;;
  esac

  # Wi-Fiインターフェースの確認と再設定
  wifi_gw=$(ip route show dev wlan0 | grep -m1 "default via" | awk '{print $3}')
  if [ -z "$wifi_gw" ]; then
    log_msg "INFO" "Wi-Fiデフォルトルートを192.168.3.1に設定を試みます"
    ip route add default via 192.168.3.1 dev wlan0 2>/dev/null || \
    log_msg "WARN" "Wi-Fiデフォルトルートの設定に失敗しました"
  else
    log_msg "INFO" "Wi-Fiデフォルトルートは既に設定済み: $wifi_gw"
  fi

  log_msg "INFO" "[network_mode] LTE切断完了"
  exit 0
fi

if [ "$1" = "auto" ]; then
  log_msg "INFO" "[network_mode] 自動接続モード開始"

  # モデム検出
  detect_modem_type

  # 無限ループの前に初期状態をログ
  current_routes=$(ip route show default)
  log_msg "INFO" "現在のデフォルトルート: $current_routes"
  log_msg "INFO" "検出モデム: $MODEM_TYPE, インターフェース: $LTE_INTERFACE"

  while true; do
    # Wi-Fi状態の確認
    WIFI_STATE=$(iwgetid -r 2>/dev/null)
    wifi_link_status=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)

    # Wi-Fi接続性の詳細チェック
    if [ -n "$WIFI_STATE" ] && [ "$wifi_link_status" = "up" ]; then
      # Wi-Fiが接続中でも実際に通信可能か確認
      ping -c 1 -W 2 192.168.3.1 >/dev/null 2>&1
      wifi_reachable=$?

      if [ $wifi_reachable -eq 0 ]; then
        # Wi-Fiが利用可能
        log_msg "INFO" "Wi-Fi接続中（SSID: $WIFI_STATE）- 通信可能"

        # LTEが接続中なら切断
        local lte_connected=false
        case "$MODEM_TYPE" in
          "em7430"|"ak020")
            pgrep -f "mbim-network.*start" >/dev/null 2>&1 && lte_connected=true
            ;;
          "quectel")
            pgrep -x pppd >/dev/null 2>&1 && lte_connected=true
            ;;
        esac

        if [ "$lte_connected" = true ]; then
          log_msg "INFO" "Wi-Fi利用可能のため、LTEを切断します"
          $0 disconnect
        fi
      else
        # Wi-Fi接続はあるが通信不可
        log_msg "WARN" "Wi-Fi接続中（SSID: $WIFI_STATE）だが通信不可、LTEへ切替"
        $0 connect
      fi
    else
      # Wi-Fi未接続
      log_msg "INFO" "Wi-Fi未接続、LTEへ切替"

      # LTEがまだ接続されていない場合のみ接続
      local lte_connected=false
      case "$MODEM_TYPE" in
        "em7430"|"ak020")
          pgrep -f "mbim-network.*start" >/dev/null 2>&1 && lte_connected=true
          ;;
        "quectel")
          pgrep -x pppd >/dev/null 2>&1 && lte_connected=true
          ;;
      esac

      if [ "$lte_connected" = false ]; then
        $0 connect
      else
        log_msg "INFO" "LTEは既に接続中"
      fi
    fi

    sleep 30
  done
fi

# 未知の引数の場合
if [ -n "$1" ]; then
  log_msg "ERROR" "引数が不正です: $1 （使用可能: connect / disconnect / auto）"
  echo "使用方法: $0 {connect|disconnect|auto}"
  exit 1
fi

# 引数なしの場合の使用方法表示
echo "使用方法: $0 {connect|disconnect|auto}"
echo "  connect    - LTE接続を開始"
echo "  disconnect - LTE接続を切断"
echo "  auto       - Wi-Fi/LTE自動切替モード"
exit 1