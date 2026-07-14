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

// バッテリー電圧ADC(分圧回路経由)。
// 【2026-07 電源変更】単三アルカリ2本直列＋TPS63020(3.3V)構成。
// TPS63020出力は常に3.3V固定なので、電池残量は「生の電池電圧(TPS入力側)」を
// 分圧してADC測定すること(レギュレータ後の3.3Vを測っても残量が分からない)。
#define BATTERY_PIN 2          // GPIO2 (A0) ※電池側(TPS入力)を470k:470k分圧+A0-GND間100nF
#define BATTERY_FULL_MV 3200   // 新品 2×1.6V
#define BATTERY_EMPTY_MV 1900  // 終止 2×0.95V (TPS63020入力下限1.8V手前)
// 電池電圧の個体校正オフセット(mV)。3点校正(2.8/3.0/3.3V)で全域-65mVと判明→+65で補正。
// ※この値はこの1台の実測。個体毎にADCオフセット/抵抗誤差が異なるので本来は台別。
#define BATTERY_CAL_OFFSET_MV 65

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
// 【2026-07 修正】ハント間隔は親機受信窓(60秒)より十分短くする。
// 90秒だとハント周期(≒101秒)>窓(60秒)となり送信の谷間に窓が入って外し続け、
// 位相ビートで数時間当たらないことがあった(実機で2時間ゼロを確認)。
// 20秒ならハント周期≒30秒で必ず窓内に送信が入り約1親機サイクルで収束する。
#define RESYNC_INTERVAL_SEC 20         // ACK取れず親の窓を探索(ハント)する時の短いsleep(秒)
#define FACTORY_LISTEN_MS 6000         // ペアリング要求の受信窓(ms)
#define FACTORY_SLEEP_SEC 12           // ペアリング待ちの短いsleep(秒)
#endif
#define ACK_WAIT_MS 2500               // 送信後にDATA_ACKを待つ時間(ms)
// 【明示同期】親ACK(16B)の「次窓まで秒」を使い、次窓の中央を狙って寝る。窓中央狙いで
// 前後±(窓幅/2)の自RC誤差/LTEオフセット誤差を吸収。毎サイクル親のNTP時計に再同期する
// ので誤差が累積しない。親窓幅=90s(CHILD_RESPONSE_TIMEOUT)に対し中央45sを狙う。
#define WINDOW_AIM_OFFSET_SEC 75       // 親窓open+75s(=150s窓の中央)を狙って起床。±75sの自RC
                                       // ドリフト(日中は温度で±60s程度)を窓幅150sで吸収する。
#define CHILD_WAKE_LATENCY_SEC 1       // 起床→初回TXまでの概算(起動+測定)を差し引く
#define TX_RETRY 3                     // 1起床あたりの送信リトライ回数
#define TDMA_BACKOFF_MS 250            // リトライ/衝突回避のバックオフ基準(ms)×logicalId
// 【2026-07 ハント上限(電池保護)】親機不在時にRESYNC間隔でハントし続けると
// 電池を著しく消費する(同期時0.2mA→ハント約9mA)。MAX_HUNT回ハントして親の窓に
// 当たらなければ(≒1親サイクル掃引しても不在)、通常間隔(SEND_INTERVAL)の省電力
// バックオフに落とす。BACKOFF回バックオフ後に再度ハースト再挑戦して復帰も図る。
#define MAX_HUNT 40                    // 連続ハント上限(RESYNC20s×40≒20分=約1親サイクル)
#define HUNT_BACKOFF_CYCLES 3          // 上限到達後、通常間隔でsleepする回数→その後ハント再開
#ifdef HUNT_TEST                       // テスト用: 上限到達を数分で確認
#undef MAX_HUNT
#undef HUNT_BACKOFF_CYCLES
#undef SEND_INTERVAL_SEC
#define MAX_HUNT 4
#define HUNT_BACKOFF_CYCLES 2
#define SEND_INTERVAL_SEC 60           // バックオフも短く(60s)して観察しやすく
#endif

// センサー
#define SENSOR_WARMUP_MS 50

// NVSキー
#define NVS_NAMESPACE "foxsense"

#endif // CHILD_CONFIG_H
