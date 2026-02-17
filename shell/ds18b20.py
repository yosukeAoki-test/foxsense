# -*- coding: utf-8 -*-
from w1thermsensor import W1ThermSensor

def main():
    # 初期化
    ds18b20_sensor = W1ThermSensor()

    # 温度の表示
    temperature = ds18b20_sensor.get_temperature()
    print("{0:.2f}".format(temperature))
    return

if __name__ == "__main__":
    main()