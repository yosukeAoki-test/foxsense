#ifndef CONFIG_H
#define CONFIG_H

// ===== FoxSense One デバイス設定 =====
// LILYGO T-SIM7080G-S3 + BME280 LTE対応版
// SIM7080G: Cat-M1/NB-IoT モジュール

// デバイス識別
#define DEVICE_ID "foxsense-001"           // デバイスID（サーバー登録用）

// 動作モード設定
#define USE_TEST_MODE false                // true=30秒間隔テスト, false=10分間隔本番
#define SEND_INTERVAL_MINUTES 10           // 本番モード送信間隔 (分)
#define TEST_INTERVAL_SECONDS 30           // テストモード送信間隔 (秒)

// ===== ピン配置設定 (LILYGO T-SIM7080G-S3) =====

// BME280 I2Cピン
#define BME280_SDA_PIN 21                  // BME280 SDAピン (GPIO21)
#define BME280_SCL_PIN 22                  // BME280 SCLピン (GPIO22)

// SIM7080G モデムピン（オンボード固定）
#define MODEM_TX_PIN 5                     // ESP32 TX → SIM7080G RX
#define MODEM_RX_PIN 4                     // ESP32 RX ← SIM7080G TX
#define MODEM_PWRKEY_PIN 41                // SIM7080G 電源キー
#define MODEM_DTR_PIN 42                   // SIM7080G DTR
#define MODEM_RI_PIN 3                     // SIM7080G RI（着信表示）

// バッテリー監視ピン
#define BATTERY_PIN 35                     // バッテリー測定ピン（ADC対応ピン）

// LEDピン（オプション）
#define LED_PIN 12                         // ステータスLED

// ===== TWELITE設定 =====
// TWELITE DIP（親機）シリアル接続
#define TWELITE_TX_PIN 17                  // ESP32 TX → TWELITE RX
#define TWELITE_RX_PIN 16                  // ESP32 RX ← TWELITE TX
#define TWELITE_BAUD_RATE 115200           // TWELITE通信速度
#define TWELITE_RST_PIN 18                 // TWELITE リセットピン（オプション）

// 子機管理設定
#define MAX_CHILD_DEVICES 8                // 最大子機数
#define CHILD_RESPONSE_TIMEOUT 30000       // 子機応答タイムアウト (ms)
#define WAKE_SIGNAL_INTERVAL 100           // 起床信号送信間隔 (ms)

// 登録済み子機ID（0x00000000は未登録）
// TWELITEのシリアル番号下位4バイトを使用
#define CHILD_ID_1 0x00000000              // 子機1
#define CHILD_ID_2 0x00000000              // 子機2
#define CHILD_ID_3 0x00000000              // 子機3
#define CHILD_ID_4 0x00000000              // 子機4
#define CHILD_ID_5 0x00000000              // 子機5
#define CHILD_ID_6 0x00000000              // 子機6
#define CHILD_ID_7 0x00000000              // 子機7
#define CHILD_ID_8 0x00000000              // 子機8

// ===== バッテリー監視設定 =====
#define BATTERY_VOLTAGE_DIVIDER_RATIO 2.0  // 分圧回路比 (実電圧÷測定値)
#define BATTERY_FULL_VOLTAGE 2.1           // 満充電時の測定値 (V)
#define BATTERY_EMPTY_VOLTAGE 1.5          // 空の時の測定値 (V)
#define BATTERY_WARNING_VOLTAGE 1.65       // 警告レベル (V)

// ===== LTE通信設定 (SIM7080G) =====
#define MODEM_BAUD_RATE 115200             // SIM7080G通信速度
#define MODEM_INIT_TIMEOUT 60000           // モデム初期化タイムアウト (ms)
#define MODEM_RESPONSE_TIMEOUT 10000       // ATコマンド応答タイムアウト (ms)
#define MODEM_HTTP_TIMEOUT 60000           // HTTP通信タイムアウト (ms)

// APN設定 (SORACOM)
#define LTE_APN "soracom.io"               // APN名
#define LTE_APN_USER "sora"                // APNユーザー名
#define LTE_APN_PASS "sora"                // APNパスワード

// サーバー設定
#define SERVER_HOST "smart-agri-vision.net"   // データ送信先サーバー
#define SERVER_PORT 443                       // HTTPSポート
#define SERVER_PATH "/foxsense-one/api/data"  // APIエンドポイント

// ===== LTE自動復旧設定 =====
#define LTE_MAX_RETRY_COUNT 3              // 最大リトライ回数
#define LTE_RETRY_INTERVAL 10000           // リトライ間隔 (ms)
#define LTE_HEALTH_CHECK_INTERVAL 60000    // ヘルスチェック間隔 (ms)
#define LTE_FAILURE_THRESHOLD 3            // 復旧処理開始までの連続失敗回数

// ===== SIM7080G固有設定 =====
// SIM7080GはCat-M1/NB-IoTのみ対応（2G/3G/4G非対応）
// SIMカードは電源投入前に挿入必要
#define MODEM_NETWORK_MODE 38              // 38=LTE only, 51=GSM+LTE

#endif // CONFIG_H
