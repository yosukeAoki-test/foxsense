#!/opt/homebrew/bin/python3.11
"""
TEPRA プロトコル バリエーション探索
- テープ幅コード 0x04 (18mm) に変更
- ST フレームあり/なし
- 列数を最小に
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'

def bt_connect():
    subprocess.run(['blueutil','--connect', MAC], capture_output=True)
    time.sleep(2)

def bt_ok():
    r = subprocess.run(['blueutil','--is-connected', MAC],
                       capture_output=True, text=True)
    return r.stdout.strip() == '1'

def frame(payload: bytes) -> bytes:
    chk = sum(payload) & 0xFF
    length = len(payload) + 2  # chk + 7D
    return bytes([0x1B, 0x7B, length]) + payload + bytes([chk, 0x7D])

def raster_col(col_bytes: bytes) -> bytes:
    h = len(col_bytes)
    return bytes([0x1B, 0x2E, 0x00, 0x00, 0x00, 0x01,
                  h & 0xFF, (h >> 8) & 0xFF]) + col_bytes

TAPE_H = 128  # 18mm @ 180dpi
ROW_BYTES = TAPE_H // 8  # 16 bytes per column

BLACK_COL = bytes([0xFF] * ROW_BYTES)
WHITE_COL = bytes([0x00] * ROW_BYTES)

# テープ幅コード (SR5900P ステータスより)
TAPE_CODE = {
    6: 0x01, 9: 0x02, 12: 0x03, 18: 0x04, 24: 0x05, 36: 0x06
}

def send_and_check(ser, label, data):
    ser.reset_input_buffer()
    ser.write(data)
    ser.flush()
    time.sleep(3)
    resp = ser.read(256)
    bt = bt_ok()
    print(f"[{label}] {len(data)}B sent | BT={bt} | resp={resp.hex() if resp else 'none'}")
    return resp

bt_connect()
print(f"Connected: {bt_ok()}\n")

with serial.Serial('/dev/cu.SR-R2500P', 9600, timeout=2,
                   rtscts=False, dsrdtr=False) as ser:

    # ---- パターン1: ST フレームなし、テープ幅=18mm(0x04) ----
    buf  = frame(b'\x40')                  # @ init
    buf += frame(b'\x43\x02\x02\x01\x01') # C quality
    buf += frame(b'\x44\x04')             # D tape=18mm
    buf += frame(b'\x47')                 # G start
    buf += raster_col(BLACK_COL) * 10     # 10列 全黒
    buf += b'\x0c'
    buf += frame(b'\x40')
    send_and_check(ser, "no-ST tape=18mm", buf)
    time.sleep(2)

    # ---- パターン2: 元の通り(W24=0x05) ST フレームあり ----
    buf  = frame(b'\x40')
    buf += frame(b'\x7b\x00\x00\x53\x54')
    buf += frame(b'\x43\x02\x02\x01\x01')
    buf += frame(b'\x44\x05')             # D tape=24mm (元の値)
    buf += frame(b'\x47')
    buf += raster_col(BLACK_COL) * 10
    buf += b'\x0c'
    buf += frame(b'\x40')
    send_and_check(ser, "with-ST tape=24mm", buf)
    time.sleep(2)

    # ---- パターン3: init なしでいきなりラスタ ----
    buf = raster_col(BLACK_COL) * 5 + b'\x0c'
    send_and_check(ser, "no-init raster+FF", buf)
    time.sleep(2)

    # ---- パターン4: @ だけ（ウォームアップ的に） ----
    buf = frame(b'\x40')
    send_and_check(ser, "@ only", buf)
    time.sleep(2)

    # ---- パターン5: G コマンドだけ ----
    buf = frame(b'\x47')
    send_and_check(ser, "G only", buf)
    time.sleep(2)

    # ---- パターン6: テープ幅コードなしで C+G+ラスタ ----
    buf  = frame(b'\x40')
    buf += frame(b'\x43\x02\x02\x01\x01')
    buf += frame(b'\x47')
    buf += raster_col(BLACK_COL) * 10
    buf += b'\x0c'
    buf += frame(b'\x40')
    send_and_check(ser, "no-D cmd", buf)

print("\nDone.")
