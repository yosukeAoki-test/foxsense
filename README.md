# FoxSense - IoT Temperature & Humidity Monitoring System

XIAO ESP32C3 + BME280 + LSM100A Sigfoxを使用した温度湿度監視システム

## 🌟 Features

- **高精度センサー測定**: BME280による温度・湿度・気圧の測定
- **Sigfox通信**: LSM100Aモジュールを使用したグローバルIoTネットワーク通信
- **省電力運用**: Sigfoxの制限に配慮した10分間隔での送信
- **リアルタイム監視**: シリアルモニターでのリアルタイムデータ表示
- **ペイロード解析**: 12バイトのSigfoxペイロードによる効率的なデータ転送

## 🔧 Hardware Requirements

### マイコン
- **XIAO ESP32C3** (Seeed Studio)

### センサー
- **BME280** - 温度・湿度・気圧センサー

### 通信モジュール
- **LSM100A** - Sigfox通信モジュール (SEONGJI INDUSTRIAL)

## 📋 Pin Configuration

### BME280 (I2C)
```
BME280  →  XIAO ESP32C3
VCC     →  3V3
GND     →  GND
SDA     →  D4 (GPIO6)
SCL     →  D5 (GPIO7)
```

### LSM100A (UART)
```
LSM100A  →  XIAO ESP32C3
VDD      →  3V3
GND      →  GND
PA2(TX)  →  D7 (GPIO20)
PA3(RX)  →  TX (GPIO21)
NRST     →  D0 (GPIO2)
```

## 🚀 Quick Start

### 1. Development Environment Setup
```bash
# PlatformIO CLI install
pip install platformio

# Clone repository
git clone <repository-url>
cd foxsense
```

### 2. Build & Upload
```bash
# Build project
pio run

# Upload to device
pio run -t upload

# Monitor serial output
pio device monitor
```

### 3. Configuration
- **Test Mode**: `USE_TEST_MODE = true` (30秒間隔)
- **Production Mode**: `USE_TEST_MODE = false` (10分間隔)

## 📊 Data Format

### Sigfox Payload (12 bytes)
```
例: 0BEF0C53270C
├─ 0BEF (温度) = 3055 → 30.55°C
├─ 0C53 (湿度) = 3155 → 31.55%
└─ 270C (気圧) = 9996 → 999.6hPa
```

### Serial Output
```
=== センサーデータ ===
温度: 30.55 °C
湿度: 31.55 %
気圧: 999.6 hPa

=== ペイロード詳細 ===
温度: 0BEF (3055) = 30.55°C
湿度: 0C53 (3155) = 31.55%
気圧: 270C (9996) = 999.6hPa

送信ペイロード: 0BEF0C53270C
```

## 🌐 Sigfox Integration

### Backend Callback Configuration
```json
{
  "device": "{device}",
  "time": {time},
  "temperature": {customData#temperature},
  "humidity": {customData#humidity}, 
  "pressure": {customData#pressure},
  "data": "{data}",
  "rssi": {rssi},
  "snr": {snr}
}
```

### Payload Config
```
temperature::uint:16:little-endian humidity::uint:16:little-endian pressure::uint:16:little-endian
```

## 📈 Transmission Limits

- **Daily**: 140 messages max
- **Production**: 10-minute intervals (144 messages/day)
- **Payload**: 12 bytes max
- **Regional**: RC3C (Japan/Korea)

## 🛠 Dependencies

```ini
lib_deps = 
    adafruit/Adafruit BME280 Library@^2.2.2
    adafruit/Adafruit Unified Sensor@^1.1.9
```

## 🔍 Troubleshooting

### BME280 Issues
- Check I2C connections (SDA/SCL)
- Verify I2C address (0x76 or 0x77)
- Check power supply (3.3V)

### LSM100A Issues
- Verify UART connections (TX/RX crossed)
- Check reset pin connection
- Confirm Sigfox mode: `AT+MODE=0`
- Test with: `AT+VER`

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📞 Support

For questions and support, please open an issue in the repository.

---

**Built with ❤️ for IoT monitoring applications**