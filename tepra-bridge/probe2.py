#!/opt/homebrew/bin/python3.11
"""
接続確認バリエーション:
- /dev/cu vs /dev/tty
- DTR/RTS オン/オフ
- 簡単なフィード/ビープコマンド
"""
import serial, time, sys

PORTS  = ["/dev/cu.SR-R2500P", "/dev/tty.SR-R2500P"]
BAUDS  = [9600, 115200]

def try_port(port, baud, dtr=False, rts=False):
    print(f"\n--- {port}  baud={baud}  DTR={dtr}  RTS={rts} ---")
    try:
        with serial.Serial(port, baud, timeout=0.5,
                           rtscts=False, dsrdtr=False) as ser:
            ser.dtr = dtr
            ser.rts = rts
            time.sleep(0.3)

            # 接続直後に来るデータ
            data = ser.read(256)
            print(f"  open: {data.hex() if data else '(none)'}")

            # NULL 10 byte
            ser.write(b'\x00' * 10)
            time.sleep(0.5)
            data = ser.read(256)
            print(f"  null10: {data.hex() if data else '(none)'}")

            # ESC @ (init)
            ser.write(b'\x1b\x40')
            time.sleep(0.5)
            data = ser.read(256)
            print(f"  ESC@: {data.hex() if data else '(none)'}")

            # 0x0C (Form Feed)
            ser.write(b'\x0c')
            time.sleep(0.5)
            data = ser.read(256)
            print(f"  FF: {data.hex() if data else '(none)'}")

            # テプラ特有？0x1B 0x69 0x53（Brother ステータス）
            ser.write(b'\x1b\x69\x53')
            time.sleep(0.5)
            data = ser.read(256)
            print(f"  status: {data.hex() if data else '(none)'}")

    except Exception as e:
        print(f"  ERROR: {e}")

for port in PORTS:
    for baud in BAUDS:
        for dtr in [False, True]:
            try_port(port, baud, dtr=dtr, rts=dtr)
        time.sleep(1)

print("\nDone.")
