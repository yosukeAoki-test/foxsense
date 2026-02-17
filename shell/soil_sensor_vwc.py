import serial
import time
import datetime
from pytz import timezone

# シリアル設定
portName = "/dev/ttyUSB0"
waitTime = 0.5
scanTime = 14

addressList = []  # 探索したアドレスリスト
typeList = []  # 探索したタイプリスト
debug_mode = False  # デバッグモードの設定

# 現在のUTC時刻を文字列で返す
def now_utc_str():
    return datetime.datetime.now(timezone('UTC')).strftime("%Y-%m-%d %H:%M:%S")

# 製品名から数値を割り当てる
def product_to_number(product):
    if product == "5WT":
        return 2
    elif product == "5WET":
        return 3
    elif product == "5WTA":
        return 5
    else:
        return 0

# デバイスをスキャンする
def scan_device(sdi):
    address = 0
    while address < 10:
        try:
            sdi.reset_input_buffer()
            sdi.reset_output_buffer()
            sdi.sendBreak(0.02)
            time.sleep(0.02)
            request = str(address) + "I!"
            sdi.write(request.encode())
            if debug_mode:
                print(request)
            time.sleep(waitTime)
            response = sdi.readline()
            if debug_mode:
                print(response)
            length = len(response)
            if length == 34:
                sdi_ver = response[5:7].decode('Shift_JIS')
                company = response[7:15].decode('Shift_JIS').strip()
                product = response[15:21].decode('Shift_JIS').strip()
                version = response[21:24].decode('Shift_JIS')
                option = response[24:length-2].decode('Shift_JIS').strip()
                if debug_mode:
                    print("sdi_ver:" + sdi_ver)
                    print("company:" + company)
                    print("product:" + product)
                    print("version:" + version)
                    print("option :" + option)
                if response[4:5].decode('Shift_JIS') != str(address):
                    address += 1
                    continue
                if sdi_ver != "13":
                    address += 1
                    continue
                addressList.append(address)
                typeList.append(product_to_number(product))
            address += 1
        except KeyboardInterrupt:
            if debug_mode:
                print("Measurement has been cancelled.")
            break

# 測定を行う
def measure(sdi, address, type):
    sdi.reset_input_buffer()
    sdi.reset_output_buffer()
    sdi.sendBreak(0.02)
    time.sleep(0.02)
    request = str(address) + "M!"
    sdi.write(request.encode())
    if debug_mode:
        print(request)
    time.sleep(waitTime)
    response = sdi.readline()
    if debug_mode:
        print(response)
    response = response.rstrip()
    resAddress = response[4:5].decode('Shift_JIS')
    resInterval = response[5:8].decode('Shift_JIS')
    resItemCount = response[8:9].decode('Shift_JIS')
    if str(address) != resAddress or str(type) != resItemCount:
        if debug_mode:
            print("Request failed: Address or item count error.")
        return
    time.sleep(int(resInterval))
    dummyRead = sdi.readline()
    sdi.reset_input_buffer()
    sdi.reset_output_buffer()
    sdi.sendBreak(0.02)
    time.sleep(0.02)
    request = str(address) + "D0!"
    sdi.write(request.encode())
    time.sleep(waitTime)
    measured = sdi.readline()
    if debug_mode:
        print(measured)
    measured = measured.rstrip().decode('Shift_JIS')
    replaced = measured.replace('+',',').replace('-',',-')
    data = replaced.split(',')
    # ARP 5WET センサーのデータ形式: data[1]=VWC, data[2]=EC, data[3]=Temperature
    # 例: 0D0!0+34.1+0.33+17.5
    #     data[1]=34.1 (VWC %), data[2]=0.33 (EC mS/cm), data[3]=17.5 (温度 ℃)
    if len(data) >= 3:
        # data[1]が土壌水分量（VWC %）
        print(data[1])

# メイン関数
def main():
    try:
        sdi = serial.Serial(
            port = portName,
            baudrate = 1200,
            bytesize = serial.SEVENBITS,
            parity = serial.PARITY_EVEN,
            stopbits = serial.STOPBITS_ONE,
            timeout = 0,
            write_timeout = 0)
        sdi.reset_input_buffer()
        sdi.reset_output_buffer()
        addressList.clear()
        typeList.clear()
        sdi.setRTS(True)
        time.sleep(0.05)
        scan_device(sdi)
        for i in range(len(addressList)):
            measure(sdi, addressList[i], typeList[i])
        sdi.setRTS(False)
        sdi.close()
    except KeyboardInterrupt:
        if debug_mode:
            print("Measurement has been cancelled.")
    except Exception as e:
        if debug_mode:
            print(f"Error: {str(e)}")

if __name__ == '__main__':
    main()
