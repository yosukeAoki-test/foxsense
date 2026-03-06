#!/opt/homebrew/bin/python3.11
"""
IOBluetooth (pyobjc) で RFCOMM チャンネル6に直接接続して通信テスト
/dev/cu より確実にデータが届くか確認
"""
import objc
import time
import subprocess
from Foundation import NSRunLoop, NSDate, NSObject

objc.loadBundle('IOBluetooth',
                bundle_path='/System/Library/Frameworks/IOBluetooth.framework',
                module_globals=globals())

MAC = '74:d5:c6:6c:9a:96'
RFCOMM_CHANNEL = 6

received_data = []

def frame(cmd, *params):
    data = bytes([cmd]) + bytes(params)
    chk = sum(data) % 256
    length = len(data) + 2
    return bytes([0x1B, 0x7B, length]) + data + bytes([chk, 0x7D])

STATUS_OFF = frame(0x49, 0x00, 0x00)  # 1B 7B 05 49 00 00 49 7D
STATUS_ON  = frame(0x49, 0x05, 0x00)  # 1B 7B 05 49 05 00 4E 7D
TAPE_FEED  = frame(0x2B, 0x00)         # 1B 7B 04 2B 00 2B 7D

class RFCOMMDelegate(NSObject):
    def rfcommChannelData_data_length_(self, channel, data, length):
        import ctypes
        buf = (ctypes.c_uint8 * length).from_address(ctypes.cast(data, ctypes.c_void_p).value)
        raw = bytes(buf)
        print(f"[受信] {len(raw)}バイト: {raw.hex(' ')}")
        print(f"       ASCII: {repr(raw)}")
        received_data.append(raw)

    def rfcommChannelClosed_(self, channel):
        print("[INFO] RFCOMM チャンネル closed")

    def rfcommChannelOpenComplete_status_(self, channel, error):
        print(f"[INFO] RFCOMM open complete, error={error}")

    def rfcommChannelWriteComplete_refcon_status_(self, channel, refcon, status):
        print(f"[INFO] write complete, status={status}")

print("=== BT接続確認 ===")
r = subprocess.run(['blueutil', '--is-connected', MAC], capture_output=True)
connected = r.stdout.strip() == b'1'
print(f"BT: {connected}")
if not connected:
    subprocess.run(['blueutil', '--connect', MAC], capture_output=True)
    time.sleep(2)

print(f"\n=== IOBluetooth RFCOMM 直接接続テスト ===")
device = IOBluetoothDevice.deviceWithAddressString_(MAC)
if device is None:
    print("デバイスが見つかりません")
    exit(1)

print(f"デバイス: {device.getNameOrAddress()}")
print(f"接続状態: {device.isConnected()}")

if not device.isConnected():
    result = device.openConnection()
    print(f"openConnection: {result}")
    time.sleep(2)

# RFCOMMチャンネルをオープン
delegate = RFCOMMDelegate.alloc().init()

print(f"\nRFCOMM チャンネル {RFCOMM_CHANNEL} をオープン中...")
channel = objc.nil
result, channel = device.openRFCOMMChannelSync_withChannelID_delegate_(
    objc.nil, RFCOMM_CHANNEL, delegate
)
print(f"openRFCOMM: result={result}, channel={channel}")

if result != 0 or channel is None or channel == objc.nil:
    print("RFCOMM オープン失敗")
    exit(1)

print(f"チャンネルID: {channel.getChannelID()}")
print(f"MTU: {channel.getMTU()}")

# ループを回して応答を待つ関数
def run_loop(sec):
    NSRunLoop.currentRunLoop().runUntilDate_(
        NSDate.dateWithTimeIntervalSinceNow_(sec)
    )

# 少し待ってから自発応答を確認
print("\n=== 自発応答待ち (3秒) ===")
run_loop(3.0)
print(f"自発応答: {len(received_data)}件")

# STATUS_OFF を送信
print(f"\n=== STATUS_OFF 送信: {STATUS_OFF.hex(' ')} ===")
received_data.clear()
ns_data = bytes(STATUS_OFF)
result = channel.writeSync_length_(ns_data, len(ns_data))
print(f"writeSync result: {result}")
run_loop(5.0)
print(f"応答: {len(received_data)}件")

# STATUS_ON を送信
print(f"\n=== STATUS_ON 送信: {STATUS_ON.hex(' ')} ===")
received_data.clear()
result = channel.writeSync_length_(bytes(STATUS_ON), len(STATUS_ON))
print(f"writeSync result: {result}")
run_loop(5.0)
print(f"応答: {len(received_data)}件")

# テープフィード
print(f"\n=== TAPE_FEED 送信: {TAPE_FEED.hex(' ')} ===")
received_data.clear()
result = channel.writeSync_length_(bytes(STATUS_ON), len(STATUS_ON))  # まずON
run_loop(0.5)
result = channel.writeSync_length_(bytes(TAPE_FEED), len(TAPE_FEED))
print(f"writeSync result: {result}")
run_loop(5.0)
print(f"応答: {len(received_data)}件")

channel.closeChannel()
print("\n完了")
