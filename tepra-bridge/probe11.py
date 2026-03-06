#!/opt/homebrew/bin/python3.11
"""
シリアルポートを開いたときのBT接続状態変化を確認
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'
PORT = '/dev/cu.SR-R2500P'

def is_connected():
    r = subprocess.run(['blueutil', '--is-connected', MAC], capture_output=True)
    return r.stdout.strip() == b'1'

print(f"[start] BT接続: {is_connected()}")

# BT事前接続なしでシリアルポートを開く
print("\nblueutil接続なし・シリアルポートだけ開く...")
try:
    with serial.Serial(PORT, 9600, timeout=2) as s:
        print(f"  ポート開通直後 BT接続: {is_connected()}")
        time.sleep(1)
        print(f"  1秒後 BT接続: {is_connected()}")

        # 何か送信してみる
        s.write(bytes([0x0C]))
        s.flush()
        time.sleep(0.5)
        print(f"  0x0C送信後 BT接続: {is_connected()}")

        resp = s.read(100)
        print(f"  応答: {resp.hex(' ') if resp else 'なし'}")

        time.sleep(1)
        print(f"  ポートクローズ前 BT接続: {is_connected()}")

except Exception as e:
    print(f"エラー: {e}")

time.sleep(1)
print(f"\n[end] ポートクローズ後 BT接続: {is_connected()}")

# blueutil で接続してからシリアルポートを開く
print("\n\n--- blueutil接続 → シリアルポート ---")
subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
time.sleep(3)
print(f"blueutil接続後 BT: {is_connected()}")

try:
    with serial.Serial(PORT, 9600, timeout=2) as s:
        print(f"  シリアルオープン後 BT: {is_connected()}")
        time.sleep(1)

        # フレームコマンド送信
        frame_status_on = bytes([0x1B, 0x7B, 0x05, 0x49, 0x05, 0x00, 0x4E, 0x7D])
        print(f"  STATUS_ON送信: {frame_status_on.hex(' ')}")
        s.write(frame_status_on)
        s.flush()
        time.sleep(2)
        print(f"  送信後 BT: {is_connected()}")

        resp = s.read(200)
        if resp:
            print(f"  応答 ({len(resp)}バイト): {resp.hex(' ')}")
        else:
            print("  応答なし")

except Exception as e:
    print(f"エラー: {e}")

print(f"\n[final] BT接続: {is_connected()}")
