#!/opt/homebrew/bin/python3.11
"""
SR-R2500P 詳細プローブ
- 接続直後の自発応答を確認
- GetDeviceInfo コマンドを試す
- 全コマンドバリエーションをスキャン
"""
import serial, time, subprocess

MAC = '74:D5:C6:6C:9A:96'
PORT = '/dev/cu.SR-R2500P'

def bt_connect():
    subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
    time.sleep(2)
    r = subprocess.run(['blueutil', '--is-connected', MAC], capture_output=True)
    return r.stdout.strip() == b'1'

def frame(cmd, *params):
    data = bytes([cmd]) + bytes(params)
    chk = sum(data) % 256
    length = len(data) + 2
    return bytes([0x1B, 0x7B, length]) + data + bytes([chk, 0x7D])

def read_all(s, wait=3.0):
    """指定秒間、来たデータを全部収集"""
    buf = b''
    s.timeout = 0.1
    deadline = time.time() + wait
    while time.time() < deadline:
        chunk = s.read(4096)
        if chunk:
            buf += chunk
            deadline = time.time() + 0.5  # 最後のデータから0.5秒待つ
    return buf

print("=== BT接続 ===")
ok = bt_connect()
print(f"BT: {ok}")
if not ok:
    print("接続失敗")
    exit(1)

time.sleep(1)

# テスト1: 接続直後の自発応答
print("\n=== Test1: 接続直後の自発応答 ===")
with serial.Serial(PORT, 9600, timeout=0.1) as s:
    print("ポート開通 - 5秒間何も送らずに待機...")
    resp = read_all(s, 5.0)
    if resp:
        print(f"自発応答 ({len(resp)}バイト): {resp.hex(' ')}")
        print(f"  ASCII: {repr(resp)}")
    else:
        print("自発応答なし")

time.sleep(1)

# テスト2: STATUS_OFF 送信後の応答を長めに待つ
print("\n=== Test2: STATUS_OFF → 応答待ち(10秒) ===")
STATUS_OFF = frame(0x49, 0x00, 0x00)
with serial.Serial(PORT, 9600, timeout=0.1) as s:
    s.reset_input_buffer()
    print(f"送信: {STATUS_OFF.hex(' ')}")
    s.write(STATUS_OFF)
    s.flush()
    resp = read_all(s, 10.0)
    if resp:
        print(f"応答 ({len(resp)}バイト): {resp.hex(' ')}")
    else:
        print("応答なし")

time.sleep(1)

# テスト3: GetDeviceInfo コマンド (CommandLevel 5 向け)
# CMD=0x6F (確認済み: libTepraPrint.so に 1b 7b 05 6f があった)
print("\n=== Test3: GetDeviceInfo (CMD=0x6F) ===")
GET_INFO = frame(0x6F, 0x00, 0x00)
print(f"送信: {GET_INFO.hex(' ')}")
with serial.Serial(PORT, 9600, timeout=0.1) as s:
    s.reset_input_buffer()
    s.write(GET_INFO)
    s.flush()
    resp = read_all(s, 5.0)
    if resp:
        print(f"応答 ({len(resp)}バイト): {resp.hex(' ')}")
        print(f"  ASCII: {repr(resp)}")
    else:
        print("応答なし")

time.sleep(1)

# テスト4: 全CMD(0x00-0xFF)をブルートフォース（短い待ち）
print("\n=== Test4: CMDスキャン (反応があるコマンドを探す) ===")
print("送信して0.3秒以内に応答があったコマンドを記録...")
hits = []
with serial.Serial(PORT, 9600, timeout=0.05) as s:
    for cmd in range(0x00, 0x80):
        pkt = frame(cmd)
        s.reset_input_buffer()
        s.write(pkt)
        s.flush()
        resp = s.read(256)
        if resp:
            hits.append((cmd, resp))
            print(f"  CMD=0x{cmd:02X}: {resp.hex(' ')}")
        time.sleep(0.02)

if hits:
    print(f"\n応答があったコマンド: {[f'0x{c:02X}' for c,_ in hits]}")
else:
    print("CMDスキャン: 全コマンドで応答なし")
