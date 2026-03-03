#!/opt/homebrew/bin/python3.11
"""
IOBluetooth フレームワーク経由でテプラのSDP情報を取得
"""
import objc
import time
from Foundation import NSRunLoop, NSDate

# IOBluetooth をロード
objc.loadBundle('IOBluetooth',
    bundle_path='/System/Library/Frameworks/IOBluetooth.framework',
    module_globals=globals())

TARGET = "74:d5:c6:6c:9a:96"

print(f"Looking up device {TARGET} ...")

device = IOBluetoothDevice.deviceWithAddressString_(TARGET)
if not device:
    print("Device not found in paired list")
    exit(1)

print(f"Name:    {device.name()}")
print(f"Address: {device.addressString()}")
print(f"Connected: {device.isConnected()}")
print(f"CoD: {hex(device.classOfDevice())}")

print("\nOpening connection...")
result = device.openConnection()
print(f"openConnection result: {result}")

# 少し待つ
for _ in range(10):
    NSRunLoop.mainRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.3))
    if device.isConnected():
        break

print(f"Connected: {device.isConnected()}")

print("\nQuerying SDP records...")
result = device.performSDPQuery_(None)
print(f"SDP query result: {result}")

for _ in range(20):
    NSRunLoop.mainRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.2))

records = device.services()
if not records:
    print("No SDP records found")
else:
    print(f"\nFound {len(records)} SDP record(s):\n")
    for i, rec in enumerate(records):
        print(f"--- Record {i} ---")
        try: print(f"  Service Name: {rec.getServiceName()}")
        except: pass

        # RFCOMM channel
        ch_ref = objc.nil
        result = rec.getRFCOMMChannelID_(None)
        try:
            ch = objc.nil
            ok, ch = rec.getRFCOMMChannelID_(ch)
            print(f"  RFCOMM Chan:  {ch}  (ok={ok})")
        except Exception as e:
            print(f"  RFCOMM:  {e}")

        # 全アトリビュートをダンプ
        try:
            attrs = rec.attributes()
            if attrs:
                for k, v in attrs.items():
                    print(f"  attr[{k}] = {v}")
        except Exception as e:
            print(f"  attrs error: {e}")
        print()
