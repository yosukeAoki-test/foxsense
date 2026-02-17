#ifndef CONFIG_H
#define CONFIG_H

// ===== FoxSense One デバイス設定 =====
// LILYGO T-SIM7080G-S3 + BME280 LTE対応版
// SIM7080G: Cat-M1/NB-IoT モジュール

// デバイス識別
#define DEVICE_ID "foxsense-001"           // デバイスID（サーバー登録用）
#define DEVICE_SECRET "CHANGE_ME"          // デバイスシークレット（サーバー認証用）

// プロトコルバージョン
#define PROTOCOL_VERSION 0x02              // v2: parentIdHash対応

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
#define PAIRING_RESPONSE_TIMEOUT 10000     // ペアリング応答タイムアウト (ms)

// サーバー設定取得間隔（ブート回数ベース）
// 10分間隔 × 36回 = 約6時間ごとにサーバーから設定再取得
#define CONFIG_FETCH_INTERVAL 36

// TWELITEプロトコルコマンド定義
#define TWELITE_HEADER      0xA5           // パケットヘッダー
#define TWELITE_FOOTER      0x5A           // パケットフッター
#define TWELITE_CMD_WAKE    0x01           // 起床コマンド（v1互換）
#define TWELITE_CMD_DATA    0x02           // データ応答（v1互換）
#define TWELITE_CMD_ACK     0x03           // 確認応答
#define TWELITE_CMD_PAIR    0x10           // ペアリング要求
#define TWELITE_CMD_PAIR_ACK 0x11          // ペアリング応答

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
#define SERVER_HOST "foxsense.smart-agri-vision.net"  // データ送信先サーバー
#define SERVER_PORT 443                               // HTTPSポート
#define SERVER_PATH "/api/data"                       // データ送信APIエンドポイント
#define SERVER_CONFIG_PATH "/api/devices/config/"     // デバイス設定取得APIパス

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
