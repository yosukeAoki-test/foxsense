# -*- coding: utf-8 -*-
import smbus
import time

# i2cバスの番号
i2c = smbus.SMBus(1)

# デバイスアドレス
addr = 0x38

# デバイスの状態確認
status = i2c.read_byte_data(addr, 0x71)
if status != 0x18:
    # 初期化指示
    i2c.write_i2c_block_data(addr, 0xBE, [0x08, 0x00])

    time.sleep(0.1)

    status = i2c.read_byte_data(addr, 0x71)
    
    if status != 0x18:
        print("Device initialization failed.")
        exit()

# 計測指示
i2c.write_i2c_block_data(addr, 0xAC, [0x33, 0x00])

# 計測までは80ms以上おく必要がある．
time.sleep(0.2)

# 計測状態確認
status = i2c.read_byte_data(addr, 0x71)

# statusのBit[7]が0なら計測完了
if format(status, '08b')[0] != "0":
    print("計測未完")
    exit()

# 測定結果を読み取り
block = i2c.read_i2c_block_data(addr,0,8)

# 読み取り結果から温度湿度を計算
hum = int(block[1] << 12 | block[2] << 4 | block[3] >> 4) * 100
hum = int(hum >> 20)

print(hum)