#!/opt/homebrew/bin/python3.11
"""
blueutil で接続を維持しながらシリアル通信テスト
"""
import serial, time, subprocess

def bt_connect():
    r = subprocess.run(['blueutil', '--connect', '74:D5:C6:6C:9A:96'],
                       capture_output=True)
    time.sleep(2)
    r2 = subprocess.run(['blueutil', '--is-connected', '74:D5:C6:6C:9A:96'],
                        capture_output=True, text=True)
    print(f"BT connected: {r2.stdout.strip()}")

def bt_status():
    r = subprocess.run(['blueutil', '--is-connected', '74:D5:C6:6C:9A:96'],
                       capture_output=True, text=True)
    return r.stdout.strip() == '1'

print("Connecting via blueutil...")
bt_connect()

print("\nOpening serial port...")
with serial.Serial('/dev/cu.SR-R2500P', 9600, timeout=1,
                   rtscts=False, dsrdtr=False) as ser:
    print(f"Serial open. BT connected: {bt_status()}")

    # 自発データを待つ
    time.sleep(1)
    d = ser.read(256)
    print(f"Spontaneous: {d.hex() if d else 'none'}")

    cmds = [
        ("NULL x10",       b'\x00' * 10),
        ("ESC @",          b'\x1b\x40'),
        ("Brother status", b'\x1b\x69\x53'),
        ("0x02 ENQ",       b'\x02'),
        ("0x05",           b'\x05'),
        ("FF 0x0C",        b'\x0c'),
        ("0x1A 0x01",      b'\x1a\x01'),
        ("0x50 0x54",      b'\x50\x54'),
    ]

    for label, cmd in cmds:
        ser.reset_input_buffer()
        ser.write(cmd)
        ser.flush()
        time.sleep(0.8)
        resp = ser.read(256)
        bt_ok = bt_status()
        print(f"  [{label}] BT={bt_ok}  tx={cmd.hex()} | rx={resp.hex() if resp else 'none'}")

print("\nDone.")
