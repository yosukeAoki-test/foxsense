#!/opt/homebrew/bin/python3.11
"""
King Jim TEPRA プロトコルテスト (hikalium/sr5900p より逆算)
フレーム形式: 1B 7B [len] [payload...] [checksum] 7D
ラスタ:      1B 2E 00 00 00 01 [h_lo h_hi] [pixel_bytes...]
終端:        0C + 1B 7B 03 40 40 7D
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'

def bt_connect():
    subprocess.run(['blueutil','--connect', MAC], capture_output=True)
    time.sleep(2)

def frame(payload: bytes) -> bytes:
    """1B 7B [len] payload... checksum 7D"""
    chk = sum(payload) & 0xFF
    length = len(payload) + 2  # checksum + 7D
    return bytes([0x1B, 0x7B, length]) + payload + bytes([chk, 0x7D])

def raster_col(column: bytes) -> bytes:
    """1B 2E 00 00 00 01 [h_lo h_hi] column_bytes"""
    h = len(column)
    return bytes([0x1B, 0x2E, 0x00, 0x00, 0x00, 0x01,
                  h & 0xFF, (h >> 8) & 0xFF]) + column

def build_job(label_cols, tape_h=128):
    """
    label_cols: list of bytes, each = one column of pixel data (bit-packed)
    tape_h: print head dots (128 for 18mm)
    """
    buf = bytearray()

    # ---- 初期化 ----
    buf += frame(b'\x40')                        # @  (init)
    buf += frame(b'\x7b\x00\x00\x53\x54')        # {  (unknown setup)
    buf += frame(b'\x43\x02\x02\x01\x01')        # C  (quality)
    buf += frame(b'\x44\x05')                    # D  (?)
    buf += frame(b'\x47')                        # G  (go?)

    # ---- ラスタデータ ----
    for col in label_cols:
        buf += raster_col(col)

    # ---- 終端 ----
    buf += b'\x0c'
    buf += frame(b'\x40')

    return bytes(buf)

def make_all_black_col(tape_h=128):
    row_bytes = (tape_h + 7) // 8
    return bytes([0xFF] * row_bytes)

def make_test_pattern(tape_h=128):
    """横縞テストパターン: 上半分黒、下半分白"""
    row_bytes = (tape_h + 7) // 8
    mid = row_bytes // 2
    return bytes([0xFF] * mid + [0x00] * (row_bytes - mid))

# ---- テスト実行 ----
bt_connect()
print("BT connected")

with serial.Serial('/dev/cu.SR-R2500P', 9600, timeout=2,
                   rtscts=False, dsrdtr=False) as ser:

    print("\n=== Test A: init + 全黒20列 + 終端 ===")
    cols = [make_all_black_col()] * 20
    job = build_job(cols)
    print(f"  Job: {len(job)} bytes")
    print(f"  First 32: {job[:32].hex()}")
    ser.write(job)
    ser.flush()
    time.sleep(3)
    resp = ser.read(256)
    print(f"  Response: {resp.hex() if resp else 'none'}")

    time.sleep(2)

    print("\n=== Test B: init のみ + 終端 ===")
    buf = frame(b'\x40') + b'\x0c' + frame(b'\x40')
    ser.write(buf)
    ser.flush()
    time.sleep(2)
    resp = ser.read(256)
    print(f"  Response: {resp.hex() if resp else 'none'}")

    time.sleep(2)

    print("\n=== Test C: 0x0C だけ ===")
    ser.write(b'\x0c')
    ser.flush()
    time.sleep(2)
    resp = ser.read(256)
    print(f"  Response: {resp.hex() if resp else 'none'}")

print("\nDone. → テープは動きましたか？")
