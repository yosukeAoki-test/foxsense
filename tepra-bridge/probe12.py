#!/opt/homebrew/bin/python3.11
"""
接続直後の自発データ受信テスト + 長時間待機版
- STATUS_OFFを送って60秒待つ
- 受信スレッドで常時監視
"""
import serial, time, subprocess, threading

MAC = '74:D5:C6:6C:9A:96'
PORT = '/dev/cu.SR-R2500P'

received_all = []
stop_reading = False

def reader_thread(s):
    """バックグラウンドで常時受信"""
    while not stop_reading:
        try:
            d = s.read(1)
            if d:
                received_all.append(d)
                # ある程度たまったら表示
                if len(received_all) % 10 == 0 or True:
                    raw = b''.join(received_all)
                    print(f"\r[受信 {len(raw)}バイト] {raw.hex(' ')}", flush=True)
        except Exception:
            break

def is_connected():
    r = subprocess.run(['blueutil', '--is-connected', MAC], capture_output=True)
    return r.stdout.strip() == b'1'

STATUS_OFF = bytes([0x1B, 0x7B, 0x05, 0x49, 0x00, 0x00, 0x49, 0x7D])
STATUS_ON  = bytes([0x1B, 0x7B, 0x05, 0x49, 0x05, 0x00, 0x4E, 0x7D])

# BT接続
print("BT接続中...")
subprocess.run(['blueutil', '--disconnect', MAC], capture_output=True)
time.sleep(1)
subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
time.sleep(3)
print(f"BT: {is_connected()}")

print(f"\nシリアルポート {PORT} オープン...")
with serial.Serial(PORT, 9600, timeout=0.1,
                   rtscts=False, dsrdtr=False) as s:
    s.reset_input_buffer()
    s.reset_output_buffer()

    # 受信スレッド起動
    t = threading.Thread(target=reader_thread, args=(s,), daemon=True)
    t.start()

    print(f"接続直後 5秒間の自発受信待ち...")
    time.sleep(5)
    if received_all:
        print(f"\n自発受信あり: {b''.join(received_all).hex(' ')}")
    else:
        print("自発受信なし")

    print(f"\nSTATUS_OFF 送信: {STATUS_OFF.hex(' ')}")
    received_all.clear()
    s.write(STATUS_OFF)
    s.flush()
    print("60秒待機...")
    for i in range(60):
        time.sleep(1)
        if received_all:
            raw = b''.join(received_all)
            print(f"\n[{i+1}秒後] 受信 {len(raw)}バイト: {raw.hex(' ')}")
            print(f"ASCII: {repr(raw)}")
            break
        if (i+1) % 10 == 0:
            print(f"  {i+1}秒経過... まだ無応答")
    else:
        print("60秒間 応答なし")

    print(f"\nSTATUS_ON 送信: {STATUS_ON.hex(' ')}")
    received_all.clear()
    s.write(STATUS_ON)
    s.flush()
    print("30秒待機...")
    for i in range(30):
        time.sleep(1)
        if received_all:
            raw = b''.join(received_all)
            print(f"\n[{i+1}秒後] 受信 {len(raw)}バイト: {raw.hex(' ')}")
            break
        if (i+1) % 10 == 0:
            print(f"  {i+1}秒経過... まだ無応答")
    else:
        print("30秒間 応答なし")

    stop_reading = True

print(f"\n最終BT状態: {is_connected()}")
print("完了")
