#!/opt/homebrew/bin/python3.11
"""
データ到達確認テスト
- 0x0C (BT切断を引き起こした既知バイト) で到達確認
- 到達確認後に STATUS_ON / TAPE_FEED を試す
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'
PORT = '/dev/cu.SR-R2500P'

def frame(cmd, *params):
    data = bytes([cmd]) + bytes(params)
    chk = sum(data) % 256
    length = len(data) + 2
    return bytes([0x1B, 0x7B, length]) + data + bytes([chk, 0x7D])

STATUS_OFF = frame(0x49, 0x00, 0x00)
STATUS_ON  = frame(0x49, 0x05, 0x00)
TAPE_FEED  = frame(0x2B, 0x00)

def is_connected():
    r = subprocess.run(['blueutil', '--is-connected', MAC], capture_output=True)
    return r.stdout.strip() == b'1'

print("=== ステップ1: BT完全切断 ===")
subprocess.run(['blueutil', '--disconnect', MAC], capture_output=True)
time.sleep(2)
print(f"接続状態: {is_connected()}")

print("\n=== ステップ2: BT再接続 ===")
subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
time.sleep(3)
conn = is_connected()
print(f"接続状態: {conn}")
if not conn:
    print("接続失敗 - 終了")
    exit(1)

print("\n=== ステップ3: 0x0C 送信 (BT切断再現テスト) ===")
try:
    with serial.Serial(PORT, 9600, timeout=2) as s:
        s.reset_input_buffer()
        print("ポート開通")
        time.sleep(0.5)

        print("0x0C 送信...")
        s.write(bytes([0x0C]))
        s.flush()
        time.sleep(1)

        after = is_connected()
        print(f"送信後の接続状態: {after}")
        if not after:
            print("→ BT切断発生! データはプリンターに届いている!")
        else:
            print("→ 切断なし。データが届いていないか、プリンターが無視している")

        resp = s.read(200)
        if resp:
            print(f"応答: {resp.hex(' ')}")
        else:
            print("応答なし")

except Exception as e:
    print(f"シリアルエラー: {e}")
    print(f"接続状態: {is_connected()}")

print("\n=== ステップ4: 再接続して STATUS_ON + TAPE_FEED ===")
if not is_connected():
    print("再接続中...")
    subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
    time.sleep(3)
    print(f"接続状態: {is_connected()}")

try:
    with serial.Serial(PORT, 9600, timeout=5) as s:
        s.reset_input_buffer()
        time.sleep(0.5)

        print(f"STATUS_ON 送信: {STATUS_ON.hex(' ')}")
        s.write(STATUS_ON)
        s.flush()
        time.sleep(2)
        resp = s.read(200)
        if resp:
            print(f"応答 ({len(resp)}バイト): {resp.hex(' ')}")
            print(f"  ASCII: {repr(resp)}")
        else:
            print("応答なし")

        print(f"\nTAPE_FEED 送信: {TAPE_FEED.hex(' ')}")
        s.write(TAPE_FEED)
        s.flush()
        time.sleep(3)
        resp = s.read(200)
        if resp:
            print(f"応答: {resp.hex(' ')}")
        else:
            print("応答なし (テープは動きましたか?)")

        s.write(STATUS_OFF)
        s.flush()

except Exception as e:
    print(f"エラー: {e}")

print("\n=== 完了 ===")
