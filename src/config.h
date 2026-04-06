#ifndef CONFIG_H
#define CONFIG_H

// ===== FoxSense One デバイス設定 =====
// LILYGO T-SIM7080G-S3 + BME280 LTE対応版
// SIM7080G: Cat-M1/NB-IoT モジュール

// デバイス識別
#define DEVICE_ID "6C265A30"               // デバイスID（サーバー登録済み）
#define DEVICE_SECRET "d1b03e43-0b3c-480d-8d4a-2fb753322d72"  // デバイスシークレット

// プロトコルバージョン
#define PROTOCOL_VERSION 0x03              // v3: 気圧センサー対応（v2後方互換）

// 動作モード設定
#define USE_TEST_MODE false                // true=30秒間隔テスト, false=10分間隔本番
#define SEND_INTERVAL_MINUTES 10           // 本番モード送信間隔 (分)
#define TEST_INTERVAL_SECONDS 30           // テストモード送信間隔 (秒)

// ===== ピン配置設定 (LILYGO T-SIM7080G-S3) =====

// BME280 I2Cピン（Wire0使用）
// IO45/IO46 はカメラ搭載時も空き → 配線変更不要
#define BME280_SDA_PIN 45                  // IO45 = P1 "IO45"
#define BME280_SCL_PIN 46                  // IO46 = P2 "IO46"

// SIM7080G モデムピン（オンボード固定）
#define MODEM_TX_PIN 5                     // ESP32 TX → SIM7080G RX
#define MODEM_RX_PIN 4                     // ESP32 RX ← SIM7080G TX
#define MODEM_PWRKEY_PIN 41                // SIM7080G 電源キー
#define MODEM_DTR_PIN 42                   // SIM7080G DTR
#define MODEM_RI_PIN 3                     // SIM7080G RI（着信表示）

// AXP2101 PMU (電源管理IC、Wire1 使用)
#define PMU_SDA_PIN 15                     // AXP2101 I2C SDA
#define PMU_SCL_PIN 7                      // AXP2101 I2C SCL
#define PMU_IRQ_PIN 6                      // AXP2101 割り込みピン


// ===== TWELITE設定 =====
// TWELITE DIP（親機）シリアル接続
// GPIO43/44: USB CDC (IO19/IO20) が Serial を担うため UART0 は空き → TWELITE に転用
#define TWELITE_TX_PIN 43                  // IO43 = P1 "TXD"
#define TWELITE_RX_PIN 44                  // IO44 = P1 "RXD"
#define TWELITE_BAUD_RATE 115200           // TWELITE通信速度
// TWELITE_RST_PIN は未使用（IO45/IO46 を BME280 に割り当てるため省略）
#define IR_TX_PIN 47                       // IR LED 出力ピン (GPIO47)

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

// ===== バッテリー監視設定 (AXP2101 PMU) =====
#define BATTERY_LOW_WARN_THRESHOLD 0       // 低バッテリー警告しきい値 (%) ※0=無効
#define BATTERY_LOW_SHUTDOWN_THRESHOLD 3   // 低バッテリーシャットダウンしきい値 (%)

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
#define SERVER_PATH "/api/sensors/ingest"             // データ送信APIエンドポイント（バルク）
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

// ===== ACプロトタイプモード設定 =====
// true=常時USB電源起動・ACコマンドポーリング (試作機専用)
// false=通常ディープスリープモード
#define AC_PROTOTYPE_MODE true
#define AC_POLL_INTERVAL_SEC 5             // ACコマンドポーリング間隔 (秒)
#define AC_DATA_SEND_INTERVAL_MIN 10       // センサーデータ送信間隔 (分)
#define AC_RECONNECT_FAIL_THRESHOLD 3      // データ送信連続失敗でモデム再接続するしきい値

#endif // CONFIG_H
