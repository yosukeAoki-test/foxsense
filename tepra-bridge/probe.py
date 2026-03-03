#!/opt/homebrew/bin/python3.11
"""
Tepra SR-R2500P プロトコル探索（高速版）
BT SPP ではボーレートは実質無関係なので 9600 のみで試す。
"""
import serial, time, sys

PORT    = "/dev/cu.SR-R2500P"
WAIT    = 0.3   # コマンド送信後の待ち時間(秒)

def probe(ser, label, cmd):
    ser.reset_input_buffer()
    ser.write(cmd)
    ser.flush()
    time.sleep(WAIT)
    resp = ser.read(256)
    mark = "★ HIT" if resp else "     "
    print(f"{mark} [{label}]  tx={cmd.hex()} | rx={resp.hex() if resp else '(none)'}")
    return resp

print(f"Connecting to {PORT} ...")
try:
    with serial.Serial(PORT, 9600, timeout=WAIT,
                       rtscts=False, dsrdtr=False) as ser:
        print("Connected.\n")

        # 自発データ
        time.sleep(0.5)
        spont = ser.read(256)
        if spont:
            print(f"★ Spontaneous: {spont.hex()}")
        else:
            print("  Spontaneous: (none)")

        print()

        # 初期化系
        probe(ser, "NULL x100",          b'\x00' * 100)
        probe(ser, "ESC @",              b'\x1b\x40')
        probe(ser, "Brother status",     b'\x1b\x69\x53')
        probe(ser, "Brother raster mode",b'\x1b\x69\x61\x01')

        # ENQ / ステータス問い合わせ系
        probe(ser, "ENQ 0x05",           b'\x05')
        probe(ser, "0x1B 0x31",          b'\x1b\x31')
        probe(ser, "0x1B 0x41",          b'\x1b\x41')
        probe(ser, "0x1B 0x53",          b'\x1b\x53')
        probe(ser, "0x02",               b'\x02')
        probe(ser, "0x0E",               b'\x0e')

        # TEPRA PRO 独自?
        probe(ser, "0x50 0x54 (PT)",     b'\x50\x54')
        probe(ser, "0xA5 0x01",          b'\xa5\x01')
        probe(ser, "0xA5 0x02",          b'\xa5\x02')
        probe(ser, "0xFE 0x01",          b'\xfe\x01')
        probe(ser, "0xFF 0x01",          b'\xff\x01')
        probe(ser, "ESC i J",            b'\x1b\x69\x4a')
        probe(ser, "ESC i R",            b'\x1b\x69\x52')
        probe(ser, "ESC i Z",            b'\x1b\x69\x5a')
        probe(ser, "ESC i v",            b'\x1b\x69\x76')  # version?

        # ASCII
        probe(ser, "HELLO\\r\\n",         b'HELLO\r\n')

        # 0x1A (print/SUB)
        probe(ser, "0x1A 0x01",          b'\x1a\x01')

        print("\nDone.")

except serial.SerialException as e:
    print(f"Error: {e}", file=sys.stderr)
