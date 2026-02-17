import logging
import sys
import time
import datetime
import requests
import Adafruit_DHT
import RPi.GPIO as GPIO
import os
import fcntl
from mist_conf import url, terminal_id, temperature_gpio, relay_gpios

# --- ログ設定 ---
logging.basicConfig(
    level=logging.INFO,
    filename="/dev/shm/mist.log",
    format="%(asctime)s %(levelname)7s %(message)s"
)
log = logging.getLogger(__name__)

# --- ロックファイル設定 ---
LOCK_FILE_PATH = "/tmp/mist_cooler.lock"
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
        try:
            _, temp = Adafruit_DHT.read_retry(Adafruit_DHT.DHT22, temperature_gpio)
            return temp
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

    # --- 設定取得 ---
    try:
        response = requests.post(url + '/api/getMistCoolerConfig', data={'id': terminal_id})
        config = response.json()
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