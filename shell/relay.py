import logging
import sys
import time
import datetime
import requests
import RPi.GPIO as GPIO
import os
import fcntl
import subprocess
import json
from relay_conf import url, terminal_id, relay_gpios

# --- 設定キャッシュ ---
CONFIG_CACHE_PATH = "/dev/shm/relay_config_cache.json"
CONFIG_CACHE_MAX_AGE = 300  # 5分（秒）

# --- ログ設定 ---
logging.basicConfig(
    level=logging.INFO,
    filename="/dev/shm/relay.log",
    format="%(asctime)s %(levelname)7s %(message)s"
)
log = logging.getLogger(__name__)

# --- ロックファイル設定 ---
LOCK_FILE_PATH = "/tmp/relay_cooler.lock"
lock_file = None

try:
    lock_file = open(LOCK_FILE_PATH, 'w')
    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    log.info("ロック取得成功。実行開始")

    # --- GPIO初期化 ---
    def init_gpio():
        GPIO.setmode(GPIO.BCM)
        for relay_gpio in relay_gpios:
            GPIO.setup(relay_gpio, GPIO.OUT)

    # --- 温度取得関数 ---
    def read_temperature():
        # コマンドライン引数から温度センサー種別を判定
        temp_sensor_type = None
        if '-t' in sys.argv:
            temp_sensor_type = 'builtin'
        elif '-a' in sys.argv:
            temp_sensor_type = 'am2301b'
        else:
            # デフォルトはシステム内蔵温度センサー
            temp_sensor_type = 'builtin'
        
        try:
            if temp_sensor_type == 'builtin':
                # システム内蔵温度センサーを使用
                for i in range(10):
                    try:
                        with open('/sys/bus/iio/devices/iio:device0/in_temp_input', 'r') as f:
                            temp_raw = f.read().strip()
                        temp = float(temp_raw) / 1000.0
                        return temp
                    except (FileNotFoundError, ValueError) as e:
                        log.warning(f"システム内蔵温度取得試行{i+1}失敗: {e}")
                        if i < 9:
                            time.sleep(1)
                        continue
                return None
            
            elif temp_sensor_type == 'am2301b':
                # AM2301b温度センサーを使用
                for i in range(10):
                    try:
                        result = subprocess.run(['python3', '/root/agri-iot/shell/am2301btemp.py'], 
                                              capture_output=True, text=True, timeout=10)
                        if result.returncode == 0:
                            temp = float(result.stdout.strip())
                            return temp
                    except (subprocess.TimeoutExpired, ValueError, FileNotFoundError) as e:
                        log.warning(f"AM2301b温度取得試行{i+1}失敗: {e}")
                        if i < 9:
                            time.sleep(1)
                        continue
                return None
            
            return None
        except Exception as e:
            log.warning(f"温度取得失敗: {e}")
            return None

    # --- バルブ開閉処理 ---
    def activate_valves(duration_sec):
        for relay_gpio in relay_gpios:
            GPIO.output(relay_gpio, GPIO.HIGH)
            time.sleep(duration_sec)
            GPIO.output(relay_gpio, GPIO.LOW)

    # --- 時間文字列解析 ---
    def parse_time_str(time_str):
        try:
            return datetime.datetime.strptime(time_str, "%H:%M").time()
        except ValueError as e:
            log.error(f"時間文字列の解析に失敗: {time_str} -> {e}")
            raise

    # --- 噴霧処理 ---
    def mist_start(initial_temperature, time_to, config):
        try:
            init_gpio()
            current_temp = initial_temperature

            if current_temp <= config['lower_threshold']:
                log.info("気温が下限を下回ったため噴霧スキップ")
                return

            if time_to:
                now = datetime.datetime.now().time()
                if now >= time_to:
                    log.info("定時終了時間に到達。噴霧スキップ")
                    return

            activate_valves(config['mist_sec'])

            temp = read_temperature()
            if temp is not None:
                log.info(f"再取得温度: {temp:.1f}℃")
            else:
                log.warning("温度取得に失敗（再取得）")

        except KeyboardInterrupt:
            log.warning("ユーザーによる中断")

        finally:
            try:
                with open("/dev/shm/last_mist_end_time.txt", "w") as f:
                    f.write(datetime.datetime.now().isoformat())
            except Exception as e:
                log.warning(f"終了時刻の保存に失敗: {e}")

            GPIO.cleanup()
            log.info(f"finish: {current_temp:.1f}℃")

    # --- 設定キャッシュ関数 ---
    def load_config_cache():
        """キャッシュから設定を読み込む（有効期限内の場合）"""
        try:
            if not os.path.exists(CONFIG_CACHE_PATH):
                return None

            cache_mtime = os.path.getmtime(CONFIG_CACHE_PATH)
            cache_age = time.time() - cache_mtime

            if cache_age > CONFIG_CACHE_MAX_AGE:
                log.info(f"キャッシュ期限切れ（{cache_age:.0f}秒経過）")
                return None

            with open(CONFIG_CACHE_PATH, 'r') as f:
                config = json.load(f)
            log.info(f"キャッシュから設定読込（{cache_age:.0f}秒前）")
            return config
        except Exception as e:
            log.warning(f"キャッシュ読込失敗: {e}")
            return None

    def save_config_cache(config):
        """設定をキャッシュに保存"""
        try:
            with open(CONFIG_CACHE_PATH, 'w') as f:
                json.dump(config, f)
            log.info("設定をキャッシュに保存")
        except Exception as e:
            log.warning(f"キャッシュ保存失敗: {e}")

    # --- 設定取得（キャッシュ優先） ---
    config = load_config_cache()
    if config is None:
        try:
            log.info("Webから設定を取得中...")
            response = requests.post(url + '/api/getMistCoolerConfig', data={'id': terminal_id})
            config = response.json()
            save_config_cache(config)
        except Exception as e:
            log.error(f"設定取得に失敗: {e}")
            sys.exit(1)

    # --- mist_time 整合性 ---
    if len(config.get('mist_time_from', [])) != len(config.get('mist_time_to', [])):
        log.error("mist_time_from と mist_time_to の数が一致しません")
        sys.exit(1)

    # --- インターバル取得 ---
    try:
        interval_minutes = int(config.get("interval_minutes", 1))
        log.info(f"取得した interval_minutes: {interval_minutes}")
    except (ValueError, TypeError):
        interval_minutes = 1
        log.warning("interval_minutes の取得に失敗。デフォルト値 1 を使用")

    interval_sec = max(interval_minutes, 1) * 60
    log.info(f"インターバルタイム（秒）: {interval_sec}")

    # --- インターバルチェック ---
    now = datetime.datetime.now()
    try:
        with open("/dev/shm/last_mist_end_time.txt", "r") as f:
            last_end_str = f.read().strip()
            last_end_time = datetime.datetime.fromisoformat(last_end_str)
            elapsed = (now - last_end_time).total_seconds()
            remaining = interval_sec - elapsed

            if interval_sec == 60:
                if elapsed < 60:
                    wait_sec = 60 - elapsed
                    log.info(f"インターバル1分設定：{elapsed:.1f}秒経過、{wait_sec:.1f}秒待機")
                    time.sleep(wait_sec)
                else:
                    log.info(f"インターバル1分設定：{elapsed:.1f}秒経過、即実行")
            else:
                if remaining > 0:
                    if remaining < 120:
                        log.info(f"インターバル未到達：{elapsed:.1f}秒経過、{remaining:.1f}秒待機")
                        time.sleep(remaining)
                    else:
                        log.info(f"インターバル未到達：{elapsed:.1f}秒経過、スキップ")
                        sys.exit(0)
    except Exception as e:
        log.warning(f"前回の終了時刻取得に失敗: {e}")

    # --- 温度取得（最大3回） ---
    temperature = None
    for _ in range(3):
        temperature = read_temperature()
        if temperature is not None:
            break
        time.sleep(3)

    if temperature is None:
        log.error("温度を取得できなかったため処理中止")
        sys.exit(1)

    # --- モード判定 ---
    def determine_mode_by_schedule(config):
        if config['mist_time_from'] == ['00:00'] and config['mist_time_to'] == ['00:01']:
            log.info("モード判定: OFF")
            return 'off'
        if config['mist_time_from'] == ['00:00'] and config['mist_time_to'] == ['23:59']:
            log.info("モード判定: ON")
            return 'on'
        return 'auto'

    mode = determine_mode_by_schedule(config)

    # --- モード分岐 ---
    if mode == 'off':
        log.info("モード: off。スキップ")
        sys.exit(0)

    if mode == 'on':
        log.info("モード: on 常時噴霧")
        mist_start(temperature, None, config)
        sys.exit(0)

    # --- autoモード ---
    now_time = now.time()

    if config['upper_threshold'] <= temperature:
        log.info(f"臨時噴霧: {temperature:.1f}℃")
        mist_start(temperature, None, config)
        sys.exit(0)
    else:
        try:
            mist_from = parse_time_str(config['mist_time_from'][0])
            mist_to = parse_time_str(config['mist_time_to'][-1])
            log.info(f"判定中: 現在 {now_time}, 範囲 {mist_from}～{mist_to}")

            if mist_from <= now_time < mist_to:
                if config['lower_threshold'] <= temperature:
                    log.info(f"scheduled_mist: {temperature:.1f}℃")
                    mist_start(temperature, mist_to, config)
                else:
                    log.info(f"温度が下限未満（{temperature:.1f}℃ < {config['lower_threshold']}）のためスキップ")
                sys.exit(0)
            else:
                log.info("現在は時間帯外")
                sys.exit(0)
        except Exception as e:
            log.error(f"autoモード判定エラー: {e}")
            sys.exit(1)

finally:
    if lock_file:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()
            log.info("ロック解除")
        except Exception as e:
            log.warning(f"ロック解除失敗: {e}")