#!/bin/sh
#
# 気温・湿度・写真などのデータをサーバーにPOSTする
# 事前にネットワークは開通している必要がある
# 本スクリプトと同一ディレクトリに配置される conf.txt に各種設定値を記載する
#
# パラメータ
#  -p 写真撮影あり
#  -t 気温取得
#  -h 湿度取得
#  -n 二酸化炭素取得
#  -r 雨量取得
#  -d DS18B20
#  -a AM2301b気温
#  -b AM2301b湿度
#  -e WD5土壌水分量
#  -f WD5土壌温度
#  -c 回線接続・切断処理を行う(3G)
#  -u モジュールアップデート確認を行う（必要であればアップデート実施）
#

# 設定ファイルの読込
SCRIPT_DIR=$(cd $(dirname $0); pwd)
. $SCRIPT_DIR/conf.txt

# 未定義変数にデフォルト値を設定
latitude=${latitude:-""}
longitude=${longitude:-""}
pressure=${pressure:-""}
water_level=${water_level:-""}
sensor_power_gpio=${sensor_power_gpio:-""}

# === センサー電源GPIO制御（最適化版） ===
SENSOR_POWER_INITIALIZED=0

init_sensor_power() {
    [ -z "$sensor_power_gpio" ] && return 0

    # GPIOが未エクスポートの場合のみ初期化
    if [ ! -d /sys/class/gpio/gpio${sensor_power_gpio} ]; then
        echo $sensor_power_gpio > /sys/class/gpio/export 2>/dev/null
        sleep 0.1
        echo out > /sys/class/gpio/gpio${sensor_power_gpio}/direction 2>/dev/null
        echo 1 > /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null
        SENSOR_POWER_INITIALIZED=1
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] GPIO${sensor_power_gpio} 新規初期化"
        return 0
    fi

    # 既にエクスポート済みの場合
    echo out > /sys/class/gpio/gpio${sensor_power_gpio}/direction 2>/dev/null
    current_value=$(cat /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null)
    if [ "$current_value" = "1" ]; then
        # 既にON状態の場合：短いパルスを入れてセンサーをリフレッシュ
        # (センサーがスタック状態の場合に有効)
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] GPIO${sensor_power_gpio} 電源リフレッシュ実行"
        echo 0 > /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null
        sleep 0.5
        echo 1 > /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null
        SENSOR_POWER_INITIALIZED=1
        return 0
    fi

    # OFFだったのでONにする
    echo 1 > /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null
    SENSOR_POWER_INITIALIZED=1
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] GPIO${sensor_power_gpio} OFF→ON"
}

# センサー電源を強制的にサイクル（スタック状態からの復帰用）
force_power_cycle() {
    [ -z "$sensor_power_gpio" ] && return 1
    [ ! -d /sys/class/gpio/gpio${sensor_power_gpio} ] && return 1

    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] センサー電源強制サイクル実行"
    echo 0 > /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null
    sleep 1
    echo 1 > /sys/class/gpio/gpio${sensor_power_gpio}/value 2>/dev/null
    sleep 2
    return 0
}

# === DS18B20 (1-Wire) デバイス検出 ===
find_w1_device() {
    W1_DEVICE_PATH=""
    # 1-Wireデバイスを探す（28-で始まるのがDS18B20）
    for dev in /sys/bus/w1/devices/28-*; do
        if [ -f "$dev/w1_slave" ]; then
            W1_DEVICE_PATH="$dev"
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] DS18B20検出: $dev"
            return 0
        fi
    done
    return 1
}

# DS18B20リセット（1-Wireバス再初期化）
reset_w1_sensor() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] DS18B20リセット実行"

    # GPIO電源リセット（配線済みの場合）
    if [ -n "$sensor_power_gpio" ] && [ -d /sys/class/gpio/gpio${sensor_power_gpio} ]; then
        echo 0 > /sys/class/gpio/gpio${sensor_power_gpio}/value
        sleep 2
        echo 1 > /sys/class/gpio/gpio${sensor_power_gpio}/value
        sleep 2
    fi

    # 1-Wireカーネルモジュール再ロード
    modprobe -r w1_therm 2>/dev/null
    modprobe -r w1_gpio 2>/dev/null
    sleep 1
    modprobe w1_gpio 2>/dev/null
    modprobe w1_therm 2>/dev/null
    sleep 3
}

# === IIOデバイス動的検出 ===
# 温度/湿度入力を持つIIOデバイスを探す（device番号に依存しない）
find_iio_device() {
    IIO_DEVICE_PATH=""
    # 温度入力があるデバイスを探す
    for dev in /sys/bus/iio/devices/iio:device*; do
        if [ -f "$dev/in_temp_input" ] || [ -f "$dev/in_humidityrelative_input" ]; then
            IIO_DEVICE_PATH="$dev"
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] IIOデバイス検出: $dev"
            return 0
        fi
    done
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] IIOデバイスが見つかりません"
    return 1
}

# === センサードライバ自動検出 ===
# IIOデバイスから実際に使用中のドライバを検出（BME280/DHT22両対応）
detect_sensor_driver() {
    # 動的にIIOデバイスを検出（ログ出力を抑制）
    if [ -z "$IIO_DEVICE_PATH" ]; then
        find_iio_device >/dev/null 2>&1
    fi
    IIO_DEV="$IIO_DEVICE_PATH"

    DRIVER=""
    DEV_PATH=""

    # IIOデバイスが存在する場合の検出
    if [ -n "$IIO_DEV" ] && [ -d "$IIO_DEV" ]; then
        # 方法1: deviceサブディレクトリ経由（BME280等I2Cデバイス）
        if [ -d "$IIO_DEV/device/driver" ]; then
            DRIVER=$(basename $(readlink "$IIO_DEV/device/driver" 2>/dev/null) 2>/dev/null)
            DEV_PATH=$(basename $(readlink "$IIO_DEV/device" 2>/dev/null) 2>/dev/null)
        fi

        # 方法2: nameファイルから取得（DHT22等platformデバイス）
        if [ -z "$DRIVER" ] && [ -f "$IIO_DEV/name" ]; then
            DEV_PATH=$(cat "$IIO_DEV/name" 2>/dev/null)
            # dht11@0 → dht11ドライバと推定
            case "$DEV_PATH" in
                dht11*)
                    DRIVER="dht11"
                    ;;
            esac
        fi

        # 方法3: platformデバイスから直接確認
        if [ -z "$DRIVER" ] && [ -n "$DEV_PATH" ]; then
            if [ -L "/sys/devices/platform/$DEV_PATH/driver" ]; then
                DRIVER=$(basename $(readlink "/sys/devices/platform/$DEV_PATH/driver" 2>/dev/null) 2>/dev/null)
            fi
        fi
    fi

    # 方法4: I2Cデバイス存在チェック（BME280 0x76/0x77）- IIOデバイスがなくても実行
    if [ -z "$DRIVER" ]; then
        for addr in "1-0076" "1-0077"; do
            if [ -d "/sys/bus/i2c/devices/$addr" ]; then
                DEV_PATH="$addr"
                DRIVER="bmp280"
                break
            fi
        done
    fi

    echo "${DRIVER:-none}:${DEV_PATH:-none}"
}

# ドライバ再バインド（センサー種類自動判別）
rebind_sensor_driver() {
    SENSOR_INFO=$(detect_sensor_driver)
    DRIVER=$(echo "$SENSOR_INFO" | cut -d: -f1 | tr -d '\n')
    DEV_PATH=$(echo "$SENSOR_INFO" | cut -d: -f2 | tr -d '\n')

    [ -z "$DRIVER" ] || [ "$DRIVER" = "none" ] && return 1

    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] ドライバ再バインド: $DRIVER ($DEV_PATH)"

    case "$DRIVER" in
        bmp280)
            # BME280/BMP280: I2Cドライバ再バインド
            echo "$DEV_PATH" > /sys/bus/i2c/drivers/bmp280/unbind 2>/dev/null
            sleep 2
            echo "$DEV_PATH" > /sys/bus/i2c/drivers/bmp280/bind 2>/dev/null
            ;;
        dht11)
            # DHT22/AM2301/AM2302: platformドライバ再バインド
            echo "$DEV_PATH" > /sys/bus/platform/drivers/dht11/unbind 2>/dev/null
            sleep 2
            echo "$DEV_PATH" > /sys/bus/platform/drivers/dht11/bind 2>/dev/null
            ;;
        *)
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 未知のドライバ: $DRIVER"
            return 1
            ;;
    esac
    sleep 3
    return 0
}

# センサーリセット（汎用版：センサー種類自動判別）
reset_sensor() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] センサーリセット実行"

    # GPIO電源リセット（配線済みの場合）
    if [ -n "$sensor_power_gpio" ] && [ -d /sys/class/gpio/gpio${sensor_power_gpio} ]; then
        echo 0 > /sys/class/gpio/gpio${sensor_power_gpio}/value
        sleep 2
        echo 1 > /sys/class/gpio/gpio${sensor_power_gpio}/value
        sleep 2
    fi

    # ドライバ再バインド（センサー種類自動判別）
    rebind_sensor_driver
}

# 起動時に電源ON確認
init_sensor_power

# === センサードライバ初期化（汎用） ===
init_sensor_driver() {
    # IIOデバイスを検出（再バインドは行わない、リセット時のみ実行）
    find_iio_device

    SENSOR_INFO=$(detect_sensor_driver)
    DRIVER=$(echo "$SENSOR_INFO" | cut -d: -f1)

    if [ -n "$DRIVER" ] && [ "$DRIVER" != "none" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] センサードライバ検出: $DRIVER"
    fi
}

# 起動時処理
init_sensor_driver

# GPIO新規初期化時のみ安定待ち
if [ "${SENSOR_POWER_INITIALIZED:-0}" = "1" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] センサー電源ON - 安定待ち(3秒)"
    sleep 3
fi

# IIOデバイス検出（電源サイクル付きリトライ）
if ! find_iio_device; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] IIOデバイス検出失敗 - センサーリセット試行"
    reset_sensor
    sleep 2
    if ! find_iio_device; then
        # ドライバ再バインドでも失敗した場合、強制電源サイクル
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] リセット後もIIO検出失敗 - 強制電源サイクル実行"
        if force_power_cycle; then
            # 電源サイクル後にドライバ再バインド
            rebind_sensor_driver
            sleep 2
            find_iio_device
        fi
    fi
fi

# パラメータ解析
while getopts :pthnrdabefc OPT ; do
	case $OPT in
		"p" ) FLG_P="TRUE";;
		"t" ) FLG_TEMPERATURE="TRUE";;
		"h" ) FLG_HUMIDITY="TRUE";;
		"n" ) FLG_CO2="TRUE";;
		"r" ) FLG_RAINFALL="TRUE";;
		"d" ) FLG_DS18B20="TRUE";;
		"a" ) FLG_AM2301BTEMP="TRUE";;
		"b" ) FLG_AM2301BHUMI="TRUE";;
		"e" ) FLG_WD5VWC="TRUE";;
		"f" ) FLG_WD5TEMP="TRUE";;
		"c" ) ;; # 接続オプション（report.shでは無視）
	esac
done

# 湿度取得（改良版：ウォームアップ、5回測定、スパンチェック、異常値除外、リセット対応）
# ※BME280は湿度→温度の順で読む必要がある
if [ "$FLG_HUMIDITY" != "" ]; then
	humi_values=""
	humi_count=0
	humi_retry=0
	humi_min=999999
	humi_max=0

	# ウォームアップ：最初の1回は捨てる（センサー安定化）
	if [ -n "$IIO_DEVICE_PATH" ]; then
		cat ${IIO_DEVICE_PATH}/in_humidityrelative_input >/dev/null 2>&1
		sleep 0.5
	fi

	# リセット付きリトライループ（最大2回リセット）
	while [ $humi_count -eq 0 ] && [ $humi_retry -lt 2 ]; do
		# 5回測定
		for i in `seq 1 5`; do
			humi_raw=`cat ${IIO_DEVICE_PATH}/in_humidityrelative_input 2>/dev/null`
			if [ $? = 0 ] && [ -n "$humi_raw" ]; then
				# Step1: 固定範囲チェック(0％～100％)
				if [ $humi_raw -ge 0 ] && [ $humi_raw -le 100000 ]; then
					humi_values="$humi_values $humi_raw"
					humi_count=$((humi_count + 1))
					# 最小・最大値を記録
					[ $humi_raw -lt $humi_min ] && humi_min=$humi_raw
					[ $humi_raw -gt $humi_max ] && humi_max=$humi_raw
				fi
			fi
			[ $i -lt 5 ] && sleep 0.2
		done

		# 取得失敗時はセンサーリセット
		if [ $humi_count -eq 0 ]; then
			echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 湿度取得失敗 - センサーリセット試行 $((humi_retry + 1))"
			reset_sensor
			find_iio_device
			# リセット後の安定待ち（センサー初期化に時間がかかる）
			sleep 2
			humi_retry=$((humi_retry + 1))
		fi
	done

	# 測定値が取得できた場合
	if [ $humi_count -ge 3 ]; then
		# ソート（ロケール固定、空行除去）
		humi_sorted=$(echo "$humi_values" | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort -n)
		humi_median=$(echo "$humi_sorted" | sed -n "$((($humi_count + 1) / 2))p")

		# スパンチェック（30%超で全体異常）
		humi_span=$((humi_max - humi_min))
		echo "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG] 湿度 min=$humi_min max=$humi_max span=$humi_span median=$humi_median"

		if [ "$humi_span" -gt 30000 ]; then
			echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 湿度スパン異常（${humi_span}）- 湿度無効化"
			humi=""
		else
			# 閾値計算（中央値の±30%、最低保証±10%=10000）
			humi_threshold=$((humi_median * 3 / 10))
			[ "$humi_threshold" -lt 10000 ] && humi_threshold=10000

			# 中央値フィルターで異常値除外
			humi_filtered=""
			humi_filtered_count=0
			for val in $humi_values; do
				diff=$((val - humi_median))
				[ $diff -lt 0 ] && diff=$((0 - diff))

				if [ $diff -le $humi_threshold ]; then
					humi_filtered="$humi_filtered $val"
					humi_filtered_count=$((humi_filtered_count + 1))
				fi
			done

			# 最終平均を計算
			if [ $humi_filtered_count -gt 0 ]; then
				humi_sum=0
				for val in $humi_filtered; do
					humi_sum=$((humi_sum + val))
				done
				humi_final=$((humi_sum / humi_filtered_count))
				humi=`echo "scale=2; $humi_final/1000" | bc`
				echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 湿度取得成功: ${humi}%"
			else
				# 全て異常値の場合は中央値を使用
				humi=`echo "scale=2; $humi_median/1000" | bc`
				echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 湿度異常値多発 - 中央値使用: ${humi}%"
			fi
		fi
	elif [ $humi_count -gt 0 ]; then
		# 3回未満だがデータあり → 中央値を使用
		humi_sorted=$(echo "$humi_values" | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort -n)
		humi_median=$(echo "$humi_sorted" | sed -n "$((($humi_count + 1) / 2))p")
		humi=`echo "scale=2; $humi_median/1000" | bc`
		echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 湿度測定回数不足($humi_count回) - 中央値使用: ${humi}%"
	fi
fi

# 気温取得（改良版：5回測定、スパンチェック、絶対値閾値、異常値除外、リセット対応）
if [ "$FLG_TEMPERATURE" != "" ]; then
	temp_values=""
	temp_count=0
	temp_retry=0
	temp_min=999999
	temp_max=-999999

	# リセット付きリトライループ（最大2回リセット）
	while [ $temp_count -eq 0 ] && [ $temp_retry -lt 2 ]; do
		# 5回測定
		for i in `seq 1 5`; do
			temp_raw=`cat ${IIO_DEVICE_PATH}/in_temp_input 2>/dev/null`
			if [ $? = 0 ] && [ -n "$temp_raw" ]; then
				# Step1: 固定範囲チェック(-30℃～50℃)
				if [ $temp_raw -ge -30000 ] && [ $temp_raw -le 50000 ]; then
					temp_values="$temp_values $temp_raw"
					temp_count=$((temp_count + 1))
					# 最小・最大値を記録
					[ $temp_raw -lt $temp_min ] && temp_min=$temp_raw
					[ $temp_raw -gt $temp_max ] && temp_max=$temp_raw
				fi
			fi
			[ $i -lt 5 ] && sleep 0.2
		done

		# 取得失敗時はセンサーリセット（温度は独立してリセット試行）
		if [ $temp_count -eq 0 ]; then
			echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 温度取得失敗 - センサーリセット試行 $((temp_retry + 1))"
			reset_sensor
			find_iio_device
			# リセット後の安定待ち
			sleep 2
			temp_retry=$((temp_retry + 1))
		fi
	done

	# 測定値が取得できた場合
	if [ $temp_count -ge 3 ]; then
		# ソート（ロケール固定、空行除去）
		temp_sorted=$(echo "$temp_values" | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort -n)
		temp_median=$(echo "$temp_sorted" | sed -n "$((($temp_count + 1) / 2))p")

		# スパンチェック（10℃超で全体異常）
		temp_span=$((temp_max - temp_min))
		echo "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG] 温度 min=$temp_min max=$temp_max span=$temp_span median=$temp_median"

		if [ "$temp_span" -gt 10000 ]; then
			echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 温度スパン異常（${temp_span}）- 温度無効化"
			temp=""
		else
			# 閾値計算（絶対値ベース±20%、最低保証±3℃=3000）
			temp_abs=$temp_median
			[ "$temp_abs" -lt 0 ] && temp_abs=$((0 - temp_abs))
			temp_threshold=$((temp_abs / 5))
			[ "$temp_threshold" -lt 3000 ] && temp_threshold=3000

			# 中央値フィルターで異常値除外
			temp_filtered=""
			temp_filtered_count=0
			for val in $temp_values; do
				diff=$((val - temp_median))
				[ $diff -lt 0 ] && diff=$((0 - diff))

				if [ $diff -le $temp_threshold ]; then
					temp_filtered="$temp_filtered $val"
					temp_filtered_count=$((temp_filtered_count + 1))
				fi
			done

			# 最終平均を計算
			if [ $temp_filtered_count -gt 0 ]; then
				temp_sum=0
				for val in $temp_filtered; do
					temp_sum=$((temp_sum + val))
				done
				temp_final=$((temp_sum / temp_filtered_count))
				temp=`echo "scale=2; $temp_final/1000" | bc`
				echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 温度取得成功: ${temp}℃"
			else
				# 全て異常値の場合は中央値を使用
				temp=`echo "scale=2; $temp_median/1000" | bc`
				echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 温度異常値多発 - 中央値使用: ${temp}℃"
			fi
		fi
	elif [ $temp_count -gt 0 ]; then
		# 3回未満だがデータあり → 中央値を使用
		temp_sorted=$(echo "$temp_values" | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort -n)
		temp_median=$(echo "$temp_sorted" | sed -n "$((($temp_count + 1) / 2))p")
		temp=`echo "scale=2; $temp_median/1000" | bc`
		echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 温度測定回数不足($temp_count回) - 中央値使用: ${temp}℃"
	fi
fi

# 二酸化炭素濃度取得
if [ "$FLG_CO2" != "" ]; then
	for i in `seq 1 10`; do
		co2=`python3 -m mh_z19`
		if [ $? = 0 ]; then
			co2=$(echo $co2 | jq -r '.co2')
			if [ "$co2" != "null" ]; then
				#echo $co2 "正常終了"
				break
			fi
		fi
		sleep 1
	done
fi

# 雨量取得（改行をカンマに変換して、タイムスタンプ文字列を作る）
if [ "$FLG_RAINFALL" != "" ]; then
	rainfall_log_file=/dev/shm/rainfall_timestamp.log
	if [ -e $rainfall_log_file ]; then
		mv $rainfall_log_file $rainfall_log_file.go
		rainfall=`tr '\n' ',' < $rainfall_log_file.go`
		rm -f $rainfall_log_file.go
	fi
fi

# DS18B20温度取得（リセット対応版）
if [ "$FLG_DS18B20" != "" ]; then
	ds18b20_retry=0
	ds18b20_success=0

	# リセット付きリトライループ（最大2回リセット）
	while [ $ds18b20_success -eq 0 ] && [ $ds18b20_retry -lt 2 ]; do
		# 10回試行
		for i in `seq 1 10`; do
			temp=`python3 $SCRIPT_DIR/ds18b20.py 2>/dev/null`
			if [ $? = 0 ] && [ -n "$temp" ]; then
				echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] DS18B20温度取得成功: ${temp}℃"
				ds18b20_success=1
				break
			fi
			sleep 1
		done

		# 取得失敗時はセンサーリセット
		if [ $ds18b20_success -eq 0 ]; then
			echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] DS18B20取得失敗 - リセット試行 $((ds18b20_retry + 1))"
			reset_w1_sensor
			ds18b20_retry=$((ds18b20_retry + 1))
		fi
	done

	if [ $ds18b20_success -eq 0 ]; then
		echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] DS18B20取得失敗（リセット後も復旧せず）"
	fi
fi

# AM2301b気温取得
if [ "$FLG_AM2301BTEMP" != "" ]; then
	for i in `seq 1 10`; do
		temp=`python3 $SCRIPT_DIR/am2301btemp.py`
		if [ $? = 0 ]; then
			#echo $temp "正常終了"
			break
		fi
		sleep 1
	done
fi

# AM2301b湿度取得
if [ "$FLG_AM2301BHUMI" != "" ]; then
	for i in `seq 1 10`; do
		humi=`python3 $SCRIPT_DIR/am2301bhumi.py`
		if [ $? = 0 ]; then
			#echo $temp "正常終了"
			break
		fi
		sleep 1
	done
fi

# WD5土壌水分量取得
if [ "$FLG_WD5VWC" != "" ]; then
	for i in `seq 1 10`; do
		underground_water_content=`python3 $SCRIPT_DIR/soil_sensor_vwc.py`
		if [ $? = 0 ]; then
			#echo $temp "正常終了"
			break
		fi
		sleep 1
	done
fi

# WD5土壌温度取得
if [ "$FLG_WD5TEMP" != "" ]; then
	for i in `seq 1 10`; do
		underground_temperature=`python3 $SCRIPT_DIR/soil_sensor_temp.py`
		if [ $? = 0 ]; then
			#echo $temp "正常終了"
			break
		fi
		sleep 1
	done
fi

# パラメータ"-p"があれば写真を撮る
if [ "$FLG_P" != "" ]; then
	# 古い一時ファイルを削除（メモリ枯渇防止）
	old_files=$(ls /dev/shm/*.jpg 2>/dev/null | wc -l)
	if [ $old_files -gt 5 ]; then
		echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] /dev/shmに${old_files}個のjpgファイル。古いファイルを削除"
		# 最新5個を残して削除
		ls -t /dev/shm/*.jpg 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
	fi
	
	filename=`date "+%Y%m%d%H%M%S"`.jpg
	echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 写真撮影開始: $filename"
	
	# raspistillコマンド実行（タイムアウト10秒、エラー出力も記録）
	timeout 10 raspistill -rot $rotate -w 1024 -h 768 -o /dev/shm/$filename 2>&1
	photo_result=$?
	
	if [ $photo_result -eq 124 ]; then
		# タイムアウトエラー（exitコード124）
		echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] 写真撮影タイムアウト"
		img64=""
	elif [ $photo_result -eq 0 ]; then
		if [ -f /dev/shm/$filename ]; then
			file_size=$(stat -f%z "/dev/shm/$filename" 2>/dev/null || stat -c%s "/dev/shm/$filename" 2>/dev/null)
			echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 写真撮影成功: ${file_size} bytes"
			
			# base64エンコード
			img64=`base64 /dev/shm/$filename 2>&1`
			encode_result=$?
			
			if [ $encode_result -eq 0 ] && [ -n "$img64" ]; then
				echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] Base64エンコード成功"
				rm -f /dev/shm/$filename
			else
				echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] Base64エンコード失敗"
				rm -f /dev/shm/$filename
				img64=""
			fi
		else
			echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] 写真ファイルが作成されませんでした"
			img64=""
		fi
	else
		echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] raspistill実行失敗 (exit code: $photo_result)"
		img64=""
	fi
fi

# === 送信制御（温度・湿度両方のフラグがある場合） ===
if [ -n "$FLG_HUMIDITY" ] && [ -n "$FLG_TEMPERATURE" ]; then
	if [ -z "$humi" ] && [ -z "$temp" ]; then
		echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] 温度・湿度両方の取得に失敗 - 送信スキップ"
		exit 1
	fi
	if [ -z "$humi" ] || [ -z "$temp" ]; then
		echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] 温度または湿度の取得に失敗 - 送信スキップ"
		exit 1
	fi
fi

# データをJOSNファイルに出力(画像が大きいため、一度ファイルにしないとcurlでPOSTできない)
REPORT_JSON=/dev/shm/report_json.txt
cat << EOF > $REPORT_JSON
{
	"terminal_id": "${terminal_id}",
	"datetime": "`date "+%Y%m%d%H%M"`",
	"temperature": "${temp}",
	"humidity": "${humi}",
	"co2": "${co2}",
	"rainfall": "${rainfall}",
	"coordinate": {
		"latitude": "${latitude}",
		"longitude": "${longitude}"
	},
	"pressure": "${pressure}",
	"water_level": "${water_level}",
    "underground": {
		"temperature": "${underground_temperature}",
        "water_content": "${underground_water_content}",
		"ec": "",
        "ph": "",
        "nitrogen_content": "",
        "phosphorus_content": "",
        "potassium_content": ""
	},
	"picture": "${img64}"
}
EOF

# サーバーにデータをPOST
echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] データ送信開始 (URL: $url/api/receive)"

# ネットワークタイプ判定（改良版）
NETWORK_TYPE=$($SCRIPT_DIR/network_monitor.sh detect)
echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] ネットワーク種別判定: $NETWORK_TYPE"

# ネットワークタイプに応じたcurl設定（改良版）
case "$NETWORK_TYPE" in
    "wifi")
        # WiFi接続時: 標準設定
        CONNECT_TIMEOUT=30
        MAX_TIME=120
        RETRY_COUNT=2
        RETRY_DELAY=2
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] WiFi最適化設定適用"
        ;;
    "lte")
        # LTE接続時: 大容量画像転送最適化設定
        CONNECT_TIMEOUT=120   # DNS+SSL接続タイムアウト（延長）
        MAX_TIME=600          # 10分（大容量画像対応）
        RETRY_COUNT=3         # 適度なリトライ回数
        RETRY_DELAY=15        # LTE輻輳回避待機時間
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] LTE超最適化設定適用"
        ;;
    *)
        # 不明/混在状態: 最も安全な設定
        echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] ネットワーク状態不明 - 診断実行"
        $SCRIPT_DIR/network_monitor.sh diagnose

        # 再判定を1回実行
        sleep 5
        NETWORK_TYPE=$($SCRIPT_DIR/network_monitor.sh detect)
        echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 再判定結果: $NETWORK_TYPE"

        if [ "$NETWORK_TYPE" = "lte" ]; then
            CONNECT_TIMEOUT=120
            MAX_TIME=600
            RETRY_COUNT=3
            RETRY_DELAY=15
            echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 再判定によりLTE設定適用"
        else
            CONNECT_TIMEOUT=90    # 中間値
            MAX_TIME=400          # 中間値
            RETRY_COUNT=4         # 多めのリトライ
            RETRY_DELAY=10        # 中間値
            echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] 安全重視設定適用"
        fi
        ;;
esac

# curlを実行し、HTTPステータスコードも取得
curl_result=$(curl -X POST -H "Content-Type: application/json" \
  --connect-timeout $CONNECT_TIMEOUT \
  --max-time $MAX_TIME \
  --retry $RETRY_COUNT \
  --retry-delay $RETRY_DELAY \
  --retry-connrefused \
  --retry-max-time 1200 \
  --tcp-nodelay \
  --compressed \
  --keepalive-time 30 \
  --speed-time 60 \
  --speed-limit 512 \
  --limit-rate 1M \
  -w "\n%{http_code}" \
  -d @$REPORT_JSON $url/api/receive 2>&1)

# 終了コードを保存
curl_exit_code=$?

# HTTPステータスコードとレスポンスを分離
http_code=$(echo "$curl_result" | tail -n1)
response=$(echo "$curl_result" | head -n-1)

# 送信結果をログ出力
if [ $curl_exit_code -ne 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] curl実行エラー (exit code: $curl_exit_code)"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] エラー詳細: $curl_result"
elif [ "$http_code" != "200" ] && [ "$http_code" != "201" ] && [ "$http_code" != "204" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] 送信失敗 (HTTP: $http_code)"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] レスポンス: $response"
  # デバッグ用：失敗時はJSONの一部を確認（画像データは除く）
  if [ -f $REPORT_JSON ]; then
    json_size=$(stat -f%z "$REPORT_JSON" 2>/dev/null || stat -c%s "$REPORT_JSON" 2>/dev/null)
    echo "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG] JSONサイズ: ${json_size} bytes"
    grep -v '"picture"' $REPORT_JSON | head -20
  fi
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] 送信成功 (HTTP: $http_code)"
fi

rm -f $REPORT_JSON

