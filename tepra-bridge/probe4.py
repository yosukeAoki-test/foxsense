#!/opt/homebrew/bin/python3.11
"""
0x0C でBT切断されることに注目。
実際のラスターデータを送ってから 0x0C を試す。
→ テープが少しでも動けばプロトコルが当たっている
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'

def connect():
    subprocess.run(['blueutil','--connect', MAC], capture_output=True)
    time.sleep(2)

def is_connected():
    r = subprocess.run(['blueutil','--is-connected', MAC],
                       capture_output=True, text=True)
    return r.stdout.strip() == '1'

# テープ幅 18mm → 128ドット → 16バイト/行
TAPE_H    = 128
ROW_BYTES = TAPE_H // 8  # = 16

def solid_line():
    """全黒 1ライン"""
    return bytes([0xFF] * ROW_BYTES)

def empty_line():
    """全白 1ライン"""
    return bytes([0x00] * ROW_BYTES)

def raster_job(rows):
    """Brother PT 互換ラスタージョブ"""
    buf = bytearray()
    buf += b'\x00' * 100     # NULL padding
    buf += b'\x1b\x40'       # ESC @ init
    buf += b'\x1b\x69\x61\x01'  # raster mode
    for row in rows:
        buf += bytes([0x47, 0x00, ROW_BYTES]) + row
    buf += b'\x1a\x01'       # print + cut
    return bytes(buf)

# テスト1: 全黒 10ライン → 何かが見えるはず
rows_solid = [solid_line()] * 10 + [empty_line()] * 5

# テスト2: 単純な縞模様
rows_stripe = []
for i in range(30):
    if i % 4 < 2:
        rows_stripe.append(solid_line())
    else:
        rows_stripe.append(empty_line())

print("=== Test 1: 全黒10ライン ===")
connect()
print(f"BT: {is_connected()}")
with serial.Serial('/dev/cu.SR-R2500P', 9600, timeout=1,
                   rtscts=False, dsrdtr=False) as ser:
    job = raster_job(rows_solid)
    print(f"Sending {len(job)} bytes...")
    ser.write(job)
    ser.flush()
    time.sleep(3)
    resp = ser.read(256)
    print(f"Response: {resp.hex() if resp else 'none'}")
    print(f"BT after: {is_connected()}")

time.sleep(2)

# テスト3: 0x0C だけ（事前に何も送らない）
print("\n=== Test 2: 0x0C alone ===")
connect()
print(f"BT: {is_connected()}")
with serial.Serial('/dev/cu.SR-R2500P', 9600, timeout=1,
                   rtscts=False, dsrdtr=False) as ser:
    ser.write(b'\x0c')
    ser.flush()
    time.sleep(2)
    resp = ser.read(256)
    print(f"Response: {resp.hex() if resp else 'none'}")
    print(f"BT after: {is_connected()}")

time.sleep(2)

# テスト4: ラスターデータなしで print+cut だけ
print("\n=== Test 3: print+cut only (0x1A 0x01) ===")
connect()
print(f"BT: {is_connected()}")
with serial.Serial('/dev/cu.SR-R2500P', 9600, timeout=1,
                   rtscts=False, dsrdtr=False) as ser:
    buf = b'\x00' * 100 + b'\x1b\x40' + b'\x1b\x69\x61\x01' + b'\x1a\x01'
    ser.write(buf)
    ser.flush()
    time.sleep(3)
    resp = ser.read(256)
    print(f"Response: {resp.hex() if resp else 'none'}")
    print(f"BT after: {is_connected()}")

print("\nDone. → テープは動きましたか？")
