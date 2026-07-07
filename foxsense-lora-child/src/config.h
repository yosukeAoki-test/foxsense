#ifndef CHILD_CONFIG_H
#define CHILD_CONFIG_H

// ===== FoxSense 子機設定 (LoRa版) =====
// Seeed XIAO ESP32-C3 + E220-900T22S(JP)(LoRa) + FS304-SHT3x(防水温湿度)

// プロトコルバージョン（親機と一致必須）
#define PROTOCOL_VERSION 0x03  // v3: 温度/湿度/気圧(=0)

// 0xA5フレーム定数（親機と共通）
#define TWELITE_HEADER      0xA5
#define TWELITE_FOOTER      0x5A
#define TWELITE_CMD_WAKE    0x01
#define TWELITE_CMD_DATA    0x02
#define TWELITE_CMD_ACK     0x03
#define TWELITE_CMD_PAIR    0x10
#define TWELITE_CMD_PAIR_ACK 0x11
#define TWELITE_CMD_DATA_ACK 0x12

// ===== ピン配置 (XIAO ESP32-C3) =====
// E220 UART (Serial1)
#define LORA_TX_PIN 21         // ESP32-C3 TX → E220 RXD
#define LORA_RX_PIN 20         // ESP32-C3 RX ← E220 TXD
#define LORA_M0_PIN 3          // E220 M0
#define LORA_M1_PIN 4          // E220 M1
#define LORA_AUX_PIN -1        // E220 AUX (未使用: 遅延で代替)
#define LORA_BAUD_RATE 9600    // E220 UART(設定/通常とも9600固定)

// SHT3x (FS304) I2C。XIAO C3: SDA=GPIO6(D4), SCL=GPIO7(D5)
#define SHT3X_SDA_PIN 6
#define SHT3X_SCL_PIN 7
#define SHT3X_I2C_ADDR 0x44    // FS304-SHT3x デフォルト(0x45の個体もあり)
#define SHT3X_I2C_CLOCK 50000  // 150cmケーブル対策で低クロック(50kHz)

// バッテリー電圧ADC(分圧回路経由)。未使用なら固定値
#define BATTERY_PIN 2          // GPIO2 (A0)
#define BATTERY_FULL_MV 4200   // 満充電 (Li-ion想定)
#define BATTERY_EMPTY_MV 3200  // 空

// LED (XIAO C3 内蔵LED = GPIO8, アクティブLow)
#define LED_PIN 8

// ===== E220 RFパラメータ（親機と一致必須）=====
#define LORA_CHANNEL     0     // 親機と一致
#define LORA_SF          7     // 5..11
#define LORA_BW          125   // kHz
#define LORA_POWER       13    // dBm (22/13/7/0)
#define LORA_ADDR        0x0000 // 透過モードは全ノード同一

// ===== 方式B: 子機起点プッシュ + deep-sleep のタイミング =====
#ifdef TEST_PAIR
// 通信テスト用: ペア後すぐ短間隔送信・factoryは長時間listenで確実にペア成立
#define SEND_INTERVAL_SEC 30
#define RESYNC_INTERVAL_SEC 15
#define FACTORY_LISTEN_MS 300000       // 5分連続listen(親のペアバーストを確実に受信)
#define FACTORY_SLEEP_SEC 2
#else
#define SEND_INTERVAL_SEC 1200         // 通常の送信間隔(秒) = 20分（親機と同じ）
#define RESYNC_INTERVAL_SEC 90         // ACK取れず親の窓を探索(ハント)する時の短いsleep(秒)
#define FACTORY_LISTEN_MS 6000         // ペアリング要求の受信窓(ms)
#define FACTORY_SLEEP_SEC 12           // ペアリング待ちの短いsleep(秒)
#endif
#define ACK_WAIT_MS 2500               // 送信後にDATA_ACKを待つ時間(ms)
#define TX_RETRY 3                     // 1起床あたりの送信リトライ回数
#define TDMA_BACKOFF_MS 250            // リトライ/衝突回避のバックオフ基準(ms)×logicalId

// センサー
#define SENSOR_WARMUP_MS 50

// NVSキー
#define NVS_NAMESPACE "foxsense"

#endif // CHILD_CONFIG_H
