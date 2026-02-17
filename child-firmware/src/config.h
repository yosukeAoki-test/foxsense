#ifndef CHILD_CONFIG_H
#define CHILD_CONFIG_H

// ===== FoxSense 子機設定 =====
// TWELITE DIP + BME280

// デバイス識別（TWELITEシリアル番号下位4バイトから自動取得）
// ファームウェアレベルでは設定不要（TWELITE内蔵シリアル使用）

// プロトコルバージョン（親機と一致必須）
#define PROTOCOL_VERSION 0x02

// TWELITEプロトコルコマンド定義
#define TWELITE_HEADER      0xA5
#define TWELITE_FOOTER      0x5A
#define TWELITE_CMD_WAKE    0x01
#define TWELITE_CMD_DATA    0x02
#define TWELITE_CMD_ACK     0x03
#define TWELITE_CMD_PAIR    0x10
#define TWELITE_CMD_PAIR_ACK 0x11

// BME280 I2Cアドレス
#define BME280_I2C_ADDR 0x76

// EEPROM保存アドレス
#define EEPROM_MAGIC_ADDR     0x00     // マジックバイト
#define EEPROM_HASH_ADDR      0x01     // 親機IDハッシュ（4バイト）
#define EEPROM_LOGICAL_ID_ADDR 0x05    // 自分のLogical ID
#define EEPROM_CHECKSUM_ADDR  0x06     // チェックサム
#define EEPROM_MAGIC_VALUE    0xF5     // 設定済みマジック値

// 間欠受信設定
#define SLEEP_DURATION_MS 9000         // スリープ時間（ms）
#define LISTEN_DURATION_MS 1000        // 受信窓口時間（ms）
#define WAKE_LISTEN_TIMEOUT_MS 5000    // 起床信号待ちタイムアウト（ms）

// センサー読み取り設定
#define SENSOR_WARMUP_MS 100           // BME280ウォームアップ時間

// バッテリー設定
#define BATTERY_PIN A0
#define BATTERY_FULL_MV 3300           // 満充電時の電圧 (mV)
#define BATTERY_EMPTY_MV 2200          // 空の時の電圧 (mV)

// LED設定（デバッグ用、オプション）
#define LED_PIN 13

#endif // CHILD_CONFIG_H
