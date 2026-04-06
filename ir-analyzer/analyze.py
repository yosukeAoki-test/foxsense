#!/usr/bin/env python3
"""
IR Signal Analyzer
ATTiny85からシリアルで受け取ったパルスデータを解析・表示する

使用方法:
  python3 analyze.py /dev/cu.usbserial-XXXX   # ポートを指定
  python3 analyze.py                           # 対話モード (貼り付け解析)
"""

import sys
import re

# ─── プロトコル判定 ──────────────────────────────────────────────────

def classify_header(low0, high0):
    """リーダーパルスからプロトコルを推定"""
    if 8500 < low0 < 9500 and 4000 < high0 < 5000:
        return "NEC系 (家電全般)"
    if 8500 < low0 < 9500 and 2000 < high0 < 2800:
        return "NEC Repeat"
    if 3000 < low0 < 3600 and 1500 < high0 < 1800:
        return "AEHA/家製協 (日本家電)"
    if 2300 < low0 < 2700 and 600 < high0 < 900:
        return "SONY SIRC"
    if 5800 < low0 < 6200 and 2800 < high0 < 3200:
        return "Daikin (1フレーム目)"
    return f"不明 (L:{low0}µs H:{high0}µs)"

def decode_bits(pulses, mark_us=560, zero_space=560, one_space=1690, tolerance=0.35):
    """
    パルス列からビットデータをデコード
    偶数index=LOW(マーク), 奇数index=HIGH(スペース)
    リーダー(index 0,1)の後から開始
    """
    bits = []
    i = 2  # リーダーをスキップ
    while i + 1 < len(pulses):
        space = pulses[i + 1]  # HIGH幅でビット判定
        if abs(space - one_space) < one_space * tolerance:
            bits.append(1)
        elif abs(space - zero_space) < zero_space * tolerance:
            bits.append(0)
        else:
            bits.append('?')  # 不明
        i += 2
    return bits

def bits_to_bytes(bits):
    """ビット列をバイト列に変換 (LSB first)"""
    result = []
    for i in range(0, len(bits) - 7, 8):
        byte = 0
        for j in range(8):
            if bits[i + j] == 1:
                byte |= (1 << j)
        result.append(byte)
    return result

# ─── パース & 表示 ────────────────────────────────────────────────────

def parse_capture(text):
    """キャプチャテキストをパースしてパルスリストを返す"""
    pulses = []
    for m in re.finditer(r'[LH]:(\d+)', text):
        pulses.append(int(m.group(1)))
    return pulses

def analyze(pulses):
    if len(pulses) < 4:
        print("パルスが少なすぎます")
        return

    print(f"\n{'='*50}")
    print(f"パルス数: {len(pulses)}")

    # リーダー
    low0, high0 = pulses[0], pulses[1]
    proto = classify_header(low0, high0)
    print(f"プロトコル推定: {proto}")
    print(f"リーダー: L={low0}µs  H={high0}µs")

    # ビットデコード (NEC/AEHA仮定)
    bits = decode_bits(pulses)
    valid_bits = [b for b in bits if b != '?']
    print(f"\nビット列 ({len(bits)}ビット):")
    bit_str = ''.join(str(b) for b in bits)
    # 8ビットごとにスペース
    grouped = ' '.join(bit_str[i:i+8] for i in range(0, len(bit_str), 8))
    print(f"  {grouped}")

    # バイト変換
    if len(valid_bits) >= 8:
        data_bytes = bits_to_bytes([b if b != '?' else 0 for b in bits])
        print(f"\nバイト列 (LSB first, {len(data_bytes)}バイト):")
        hex_str = ' '.join(f'{b:02X}' for b in data_bytes)
        print(f"  {hex_str}")

        # NEC標準チェック (アドレス + アドレス反転 + コマンド + コマンド反転)
        if len(data_bytes) >= 4:
            addr, addr_inv, cmd, cmd_inv = data_bytes[0], data_bytes[1], data_bytes[2], data_bytes[3]
            addr_ok = (addr ^ addr_inv) == 0xFF
            cmd_ok  = (cmd  ^ cmd_inv ) == 0xFF
            if addr_ok and cmd_ok:
                print(f"\n[NEC確定] アドレス: 0x{addr:02X}  コマンド: 0x{cmd:02X}")
            elif addr_ok or cmd_ok:
                print(f"\n[NEC部分一致] アドレス: 0x{addr:02X}(反転{'OK' if addr_ok else 'NG'})  "
                      f"コマンド: 0x{cmd:02X}(反転{'OK' if cmd_ok else 'NG'})")

    # 生データ表示
    print(f"\n生パルス (µs):")
    for i in range(0, len(pulses), 2):
        h = pulses[i+1] if i+1 < len(pulses) else '-'
        print(f"  [{i//2:3d}] L:{pulses[i]:5d}  H:{h if h=='-' else f'{h:5d}'}")
    print('='*50)

# ─── シリアル受信モード ───────────────────────────────────────────────

def serial_mode(port):
    try:
        import serial
    except ImportError:
        print("pyserialが必要です: pip3 install pyserial")
        sys.exit(1)

    print(f"接続中: {port} @ 9600bps")
    with serial.Serial(port, 9600, timeout=30) as ser:
        buf = ""
        print("リモコンのボタンを押してください... (Ctrl+C で終了)\n")
        while True:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if not line:
                continue
            print(f"  {line}")
            buf += line + "\n"
            if "--- End ---" in line:
                analyze(parse_capture(buf))
                buf = ""

# ─── 対話モード ──────────────────────────────────────────────────────

def interactive_mode():
    print("シリアルモニタからコピーしたデータを貼り付けてください。")
    print("空行2連続で解析開始:\n")
    lines = []
    empty = 0
    while empty < 2:
        line = input()
        if line == "":
            empty += 1
        else:
            empty = 0
            lines.append(line)
    analyze(parse_capture("\n".join(lines)))

# ─── Entry Point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1:
        serial_mode(sys.argv[1])
    else:
        interactive_mode()
