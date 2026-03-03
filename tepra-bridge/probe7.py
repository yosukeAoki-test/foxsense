#!/opt/homebrew/bin/python3.11
"""
APK解析で判明したコマンドでテスト
AccessManagerBluetooth2 (SR-R2500P) プロトコル:
  フレーム: 1B 7B [LEN] [CMD] [params...] [SUM] 7D
  SUM = (CMD + params) % 256

ステータス要求 OFF: 1B 7B 05 49 00 00 49 7D
ステータス要求 ON:  1B 7B 05 49 05 00 4E 7D
テープフィード:     1B 7B 04 2B 00 2B 7D
テープカット:       1B 7B 04 2B 01 2C 7D
印刷終了:          1B 7B 03 40 40 7D
リセット:          1B 7B 03 21 21 7D
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'
PORT = '/dev/cu.SR-R2500P'

def bt_connect():
    r = subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
    time.sleep(2)
    r2 = subprocess.run(['blueutil', '--is-connected', MAC], capture_output=True)
    return r2.stdout.strip() == b'1'

def frame(cmd, *params):
    """ESC { [LEN] [CMD] [params...] [SUM] } フレームを生成
    LEN = len(CMD + params + SUM + 7D) = len(data) + 2
    """
    data = bytes([cmd]) + bytes(params)
    chk = sum(data) % 256
    length = len(data) + 2  # data + checksum + 7D
    return bytes([0x1B, 0x7B, length]) + data + bytes([chk, 0x7D])

# 既知コマンド
STATUS_OFF  = frame(0x49, 0x00, 0x00)  # 1B 7B 05 49 00 00 49 7D
STATUS_ON   = frame(0x49, 0x05, 0x00)  # 1B 7B 05 49 05 00 4E 7D
TAPE_FEED   = frame(0x2B, 0x00)         # 1B 7B 04 2B 00 2B 7D
TAPE_CUT    = frame(0x2B, 0x01)         # 1B 7B 04 2B 01 2C 7D
PRINT_END   = frame(0x40)               # 1B 7B 03 40 40 7D
RESET       = frame(0x21)               # 1B 7B 03 21 21 7D

def verify():
    # フレーム検証
    expected = {
        'STATUS_OFF': bytes([0x1B,0x7B,0x05,0x49,0x00,0x00,0x49,0x7D]),
        'STATUS_ON':  bytes([0x1B,0x7B,0x05,0x49,0x05,0x00,0x4E,0x7D]),
        'TAPE_FEED':  bytes([0x1B,0x7B,0x04,0x2B,0x00,0x2B,0x7D]),
        'TAPE_CUT':   bytes([0x1B,0x7B,0x04,0x2B,0x01,0x2C,0x7D]),
        'PRINT_END':  bytes([0x1B,0x7B,0x03,0x40,0x40,0x7D]),
        'RESET':      bytes([0x1B,0x7B,0x03,0x21,0x21,0x7D]),
    }
    actual = {
        'STATUS_OFF': STATUS_OFF,
        'STATUS_ON':  STATUS_ON,
        'TAPE_FEED':  TAPE_FEED,
        'TAPE_CUT':   TAPE_CUT,
        'PRINT_END':  PRINT_END,
        'RESET':      RESET,
    }
    print("=== フレーム検証 ===")
    ok = True
    for name, exp in expected.items():
        act = actual[name]
        status = "OK" if act == exp else "NG"
        if act != exp:
            ok = False
        print(f"  {name}: {status}  {act.hex(' ')}  (expected: {exp.hex(' ')})")
    return ok

def test_status():
    """ステータス要求を送ってプリンターの応答を確認"""
    print("\n=== BT接続 ===")
    connected = bt_connect()
    print(f"BT: {connected}")
    if not connected:
        print("BT接続失敗")
        return

    time.sleep(1)
    print(f"\n=== ステータス要求テスト ===")
    try:
        with serial.Serial(PORT, 9600, timeout=3) as s:
            s.reset_input_buffer()
            print(f"ポート開通")

            # STATUS_OFF を送信
            print(f"送信: STATUS_OFF = {STATUS_OFF.hex(' ')}")
            s.write(STATUS_OFF)
            s.flush()
            time.sleep(0.5)

            # 応答を読む
            resp = s.read(200)
            if resp:
                print(f"応答 ({len(resp)}バイト): {resp.hex(' ')}")
                print(f"  ASCII: {repr(resp)}")
            else:
                print("応答なし（タイムアウト）")

            # STATUS_ON を送信
            print(f"\n送信: STATUS_ON = {STATUS_ON.hex(' ')}")
            s.write(STATUS_ON)
            s.flush()
            time.sleep(1)

            resp = s.read(200)
            if resp:
                print(f"応答 ({len(resp)}バイト): {resp.hex(' ')}")
                print(f"  ASCII: {repr(resp)}")
            else:
                print("応答なし（タイムアウト）")

    except Exception as e:
        print(f"エラー: {e}")

    # テープフィードテスト
    print(f"\n=== テープフィードテスト ===")
    try:
        with serial.Serial(PORT, 9600, timeout=3) as s:
            s.reset_input_buffer()
            # STATUS_ONにしてからフィード
            print(f"送信: STATUS_ON")
            s.write(STATUS_ON)
            s.flush()
            time.sleep(0.5)

            print(f"送信: TAPE_FEED = {TAPE_FEED.hex(' ')}")
            s.write(TAPE_FEED)
            s.flush()
            time.sleep(2)

            resp = s.read(200)
            if resp:
                print(f"応答: {resp.hex(' ')}")
            else:
                print("応答なし")

            # リセット
            s.write(STATUS_OFF)
            s.flush()
    except Exception as e:
        print(f"エラー: {e}")

if __name__ == '__main__':
    verify()
    test_status()
