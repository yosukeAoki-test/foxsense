#!/usr/bin/env python3
"""
リレー動作デモプログラム
オフラインで30秒ごとにリレーを作動させる

使用方法:
  sudo python3 relay_demo.py

オプション:
  --interval 秒数    リレー作動間隔（デフォルト: 30秒）
  --duration 秒数    リレーON時間（デフォルト: 3秒）
  --gpio 番号        使用するGPIOピン（デフォルト: 5）
  --all              全リレーを順番に作動
"""

import RPi.GPIO as GPIO
import time
import signal
import sys
import argparse
from datetime import datetime

# デフォルトのリレーGPIO（relay_conf.pyから）
DEFAULT_RELAY_GPIOS = [5, 6, 13, 16, 19, 20, 21, 26]

# 終了フラグ
running = True

def log(message):
    """タイムスタンプ付きログ出力"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {message}")

def signal_handler(sig, frame):
    """Ctrl+C ハンドラ"""
    global running
    log("終了シグナル受信...")
    running = False

def init_gpio(gpio_pins):
    """GPIO初期化"""
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    for pin in gpio_pins:
        GPIO.setup(pin, GPIO.OUT)
        GPIO.output(pin, GPIO.LOW)
    log(f"GPIO初期化完了: {gpio_pins}")

def activate_relay(gpio_pin, duration):
    """リレーをONにして指定秒数後にOFF"""
    log(f"GPIO {gpio_pin} ON")
    GPIO.output(gpio_pin, GPIO.HIGH)
    time.sleep(duration)
    GPIO.output(gpio_pin, GPIO.LOW)
    log(f"GPIO {gpio_pin} OFF")

def main():
    global running

    # 引数パーサー
    parser = argparse.ArgumentParser(description='リレー動作デモプログラム')
    parser.add_argument('--interval', type=int, default=30, help='リレー作動間隔（秒）')
    parser.add_argument('--duration', type=float, default=3, help='リレーON時間（秒）')
    parser.add_argument('--gpio', type=int, default=5, help='使用するGPIOピン')
    parser.add_argument('--all', action='store_true', help='全リレーを順番に作動')
    args = parser.parse_args()

    # 使用するGPIOピン
    if args.all:
        gpio_pins = DEFAULT_RELAY_GPIOS
    else:
        gpio_pins = [args.gpio]

    # シグナルハンドラ設定
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    log("=" * 50)
    log("リレー動作デモプログラム")
    log(f"  作動間隔: {args.interval}秒")
    log(f"  ON時間: {args.duration}秒")
    log(f"  GPIOピン: {gpio_pins}")
    log("  終了: Ctrl+C")
    log("=" * 50)

    try:
        # GPIO初期化
        init_gpio(gpio_pins)

        cycle = 0
        while running:
            cycle += 1
            log(f"--- サイクル {cycle} ---")

            # 各リレーを順番に作動
            for gpio_pin in gpio_pins:
                if not running:
                    break
                activate_relay(gpio_pin, args.duration)

                # 複数リレーの場合、間隔を空ける
                if len(gpio_pins) > 1 and running:
                    time.sleep(1)

            # 次のサイクルまで待機
            if running:
                wait_time = args.interval - (len(gpio_pins) * (args.duration + 1))
                if wait_time > 0:
                    log(f"次のサイクルまで {wait_time:.1f}秒待機...")
                    # 1秒ごとにrunningフラグをチェック
                    for _ in range(int(wait_time)):
                        if not running:
                            break
                        time.sleep(1)
                    # 残りの端数
                    if running and wait_time % 1 > 0:
                        time.sleep(wait_time % 1)

    except Exception as e:
        log(f"エラー: {e}")

    finally:
        log("GPIO クリーンアップ中...")
        GPIO.cleanup()
        log("デモプログラム終了")

if __name__ == "__main__":
    main()
