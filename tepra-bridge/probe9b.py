#!/opt/homebrew/bin/python3.11
"""
IOBluetooth で RFCOMM チャンネル6 に直接 writeSync
delegate なし版（クラッシュ回避）
"""
import objc
import time
import subprocess
from Foundation import NSRunLoop, NSDate

objc.loadBundle('IOBluetooth',
                bundle_path='/System/Library/Frameworks/IOBluetooth.framework',
                module_globals=globals())

MAC = '74:d5:c6:6c:9a:96'
RFCOMM_CHANNEL = 6

def frame(cmd, *params):
    data = bytes([cmd]) + bytes(params)
    chk = sum(data) % 256
    return bytes([0x1B, 0x7B, len(data) + 2]) + data + bytes([chk, 0x7D])

STATUS_OFF = frame(0x49, 0x00, 0x00)
STATUS_ON  = frame(0x49, 0x05, 0x00)
TAPE_FEED  = frame(0x2B, 0x00)

def run_loop(sec):
    NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(sec))

# デバイス取得
device = IOBluetoothDevice.deviceWithAddressString_(MAC)
print(f"デバイス: {device.getNameOrAddress()}, 接続={device.isConnected()}")

if not device.isConnected():
    print("接続中...")
    device.openConnection()
    run_loop(2)

# RFCOMM チャンネルをオープン（delegate = None）
print(f"\nRFCOMM ch{RFCOMM_CHANNEL} オープン...")
result, channel = device.openRFCOMMChannelSync_withChannelID_delegate_(
    None, RFCOMM_CHANNEL, None
)
print(f"result={result}, channel={channel}")

if result != 0 or channel is None:
    print("オープン失敗 → 別チャンネルも試す")
    for ch in [1, 2, 3, 4, 5, 7]:
        r2, ch2 = device.openRFCOMMChannelSync_withChannelID_delegate_(None, ch, None)
        print(f"  ch{ch}: result={r2}, channel={ch2}")
        if r2 == 0 and ch2 is not None:
            channel = ch2
            print(f"  → ch{ch} で成功!")
            break
    if channel is None:
        print("全チャンネル失敗")
        exit(1)

print(f"チャンネルID: {channel.getChannelID()}, MTU: {channel.getMTU()}")

# STATUS_OFF を送信
print(f"\nSTATUS_OFF 送信: {STATUS_OFF.hex(' ')}")
result = channel.writeSync_length_(bytes(STATUS_OFF), len(STATUS_OFF))
print(f"writeSync: {result}")
run_loop(3)

# STATUS_ON を送信
print(f"\nSTATUS_ON 送信: {STATUS_ON.hex(' ')}")
result = channel.writeSync_length_(bytes(STATUS_ON), len(STATUS_ON))
print(f"writeSync: {result}")
run_loop(3)

# TAPE_FEED を送信
print(f"\nTAPE_FEED 送信: {TAPE_FEED.hex(' ')}")
result = channel.writeSync_length_(bytes(STATUS_ON), len(STATUS_ON))
run_loop(0.3)
result = channel.writeSync_length_(bytes(TAPE_FEED), len(TAPE_FEED))
print(f"writeSync: {result}")
run_loop(5)

channel.closeChannel()
print("\n完了 - テープは動きましたか？")
