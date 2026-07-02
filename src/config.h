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


// ===== LoRa設定 (E220-900T22S(JP) / 技適920MHz) =====
// 旧TWELITEのUART配線(GPIO43/44)を流用してE220をUART接続する。
// GPIO43/44: USB CDC (IO19/IO20) が Serial を担うため UART0 は空き → E220 に転用
#define LORA_TX_PIN 43                     // ESP32 TX → E220 RXD
#define LORA_RX_PIN 44                     // ESP32 RX ← E220 TXD
#define LORA_BAUD_RATE 9600               // E220 UART速度(設定/通常とも9600固定)
#define LORA_M0_PIN 2                      // E220 M0 (旧TWELITE_WAKE_PIN流用)
#define LORA_M1_PIN 1                      // E220 M1 ※実機ヘッダの空きで要確認
#define LORA_AUX_PIN -1                    // E220 AUX (未使用: 遅延で代替。使うならGPIO割当)
#define IR_TX_PIN 47                       // IR LED 出力ピン (GPIO47)

// E220 RFパラメータ（親機・子機で一致必須）
#define LORA_CHANNEL     0                 // 無線ch (親子一致。JP版は技適band内)
#define LORA_SF          7                 // 拡散率 (5..11, まずSF7)
#define LORA_BW          125               // 帯域 kHz (125/250/500)
#define LORA_POWER       13                // 送信出力 dBm (22/13/7/0)
#define LORA_ADDR        0x0000            // アドレス(透過モードは全ノード同一)
#define LORA_WAKE_INTERVAL_MS 1000         // wakeフレーム送信間隔 (ms)

// 旧TWELITE互換エイリアス（0xA5フレーム処理・タイミング流用のため名称のみ残す）
#define TWELITE_TX_PIN LORA_TX_PIN
#define TWELITE_RX_PIN LORA_RX_PIN
#define TWELITE_BAUD_RATE LORA_BAUD_RATE

// 子機管理設定
#define MAX_CHILD_DEVICES 8                // 最大子機数
#define CHILD_RESPONSE_TIMEOUT 60000       // 子機受信窓 (ms) 子機起点プッシュを待つ窓
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
#define TWELITE_CMD_DATA_ACK 0x12          // データ受信ACK(子機起点プッシュ用)

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

// ===== ACコマンド設定 =====
// ACコマンドは10分サイクルの通常起床時にチェック・実行される（最大10分遅延）
#define AC_PROTOTYPE_MODE false            // 廃止: 常時起動ポーリングモード（省電力化のため無効）

#endif // CONFIG_H
