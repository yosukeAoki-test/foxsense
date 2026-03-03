#!/opt/homebrew/bin/python3.11
"""
テプラから何かバイトが来るか20秒間待つ。
実行中にテプラの電源ボタン・カバー開閉・ボタン押下を試してください。
"""
import serial, time, sys

PORT = "/dev/cu.SR-R2500P"

print(f"Listening on {PORT} for 20 seconds...")
print("→ テプラのボタンを押したりカバーを開閉してみてください\n")

with serial.Serial(PORT, 9600, timeout=0.1, rtscts=False, dsrdtr=False) as ser:
    end = time.time() + 20
    while time.time() < end:
        data = ser.read(256)
        if data:
            print(f"★ Received: {data.hex(' ')}  |  {data!r}")
        else:
            sys.stdout.write('.')
            sys.stdout.flush()

print("\n\nDone.")
