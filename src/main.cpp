/**
 * FoxSense One - 親機ファームウェア (v2: デバイス分離対応)
 * LILYGO T-SIM7080G-S3 + TWELITE DIP（親機）+ BME280
 *
 * システム構成:
 * - 親機: ESP32-S3 + SIM7080G(LTE) + TWELITE DIP + BME280
 * - 子機: TWELITE DIP + BME280（複数台）
 *
 * v2動作フロー:
 * 1. ディープスリープから起床
 * 2. ハードウェア初期化（BME280, TWELITE）
 * 3. モデム初期化・LTE接続
 * 4. サーバーから設定取得（登録子機リスト + parentIdHash）
 * 5. ペアリング待ちの子機がいる場合 → ペアリングモード実行
 * 6. v2起床信号送信（parentIdHash入り）
 * 7. 親機センサーデータ取得
 * 8. 子機データ収集（parentIdHash検証付き）
 * 9. 全データをサーバー送信
 * 10. ディープスリープへ
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <HardwareSerial.h>
#include <time.h>
#include <sys/time.h>
#include "esp_sleep.h"
#define XPOWERS_CHIP_AXP2101
#include "XPowersLib.h"
#include "config.h"
#include "ca_cert.h"
#include "ir_control.h"

// ディープスリープ間隔
#define MEASUREMENT_INTERVAL_MIN 10  // 本番10分間隔
#define NTP_SYNC_INTERVAL_SEC (24 * 60 * 60)  // 24時間
#define SKIP_BATTERY_CHECK true

// 子機データ構造体
struct ChildData {
    uint32_t deviceId;      // 子機ID
    float temperature;      // 温度
    float humidity;         // 湿度
    float pressure;         // 気圧 (hPa, v3以降)
    int8_t rssi;            // 電波強度
    uint8_t battery;        // バッテリーレベル (0-100%)
    uint16_t vccMv;         // VCC電圧 mV (MWX子機のみ、0=未取得)
    bool received;          // データ受信済みフラグ
    unsigned long timestamp;// 受信時刻
    uint8_t logicalId;      // 論理ID
    bool needsPairing;      // ペアリング必要フラグ
};

// RTCメモリに保存するデータ（ディープスリープ後も保持）
RTC_DATA_ATTR uint32_t bootCount = 0;
RTC_DATA_ATTR time_t lastNtpSyncTime = 0;
RTC_DATA_ATTR bool ntpSynced = false;
RTC_DATA_ATTR int consecutiveFailures = 0;
RTC_DATA_ATTR bool modemNeedsReset = false;  // SHCONN失敗時: 次回CFUN=1,1でHTTPモジュール再初期化

// v2: RTCキャッシュ変数（サーバー設定）
RTC_DATA_ATTR uint32_t cachedParentIdHash = 0;
RTC_DATA_ATTR uint32_t cachedChildIds[MAX_CHILD_DEVICES] = {0};
RTC_DATA_ATTR uint8_t cachedChildLogicalIds[MAX_CHILD_DEVICES] = {0};
RTC_DATA_ATTR uint8_t cachedChildCount = 0;
RTC_DATA_ATTR uint32_t lastConfigFetch = 0;       // 最後に設定取得したブート回数
RTC_DATA_ATTR bool configFetched = false;          // 設定取得済みフラグ
RTC_DATA_ATTR bool caCertUploaded = false;         // CA証明書アップロード済みフラグ

// 子機データ配列
ChildData childDataList[MAX_CHILD_DEVICES];
int activeChildCount = 0;
bool hasPendingChildren = false;  // ペアリング待ち子機の存在フラグ

// ペアリング待ち子機情報（サーバーから取得）
struct PendingChild {
    uint32_t deviceId;
    uint8_t logicalId;
    char deviceIdHex[9];  // "a1b2c3d4\0"
};
PendingChild pendingChildren[MAX_CHILD_DEVICES];
int pendingChildCount = 0;

// センサー・通信オブジェクト
Adafruit_BME280 bme;
XPowersPMU PMU;
HardwareSerial modemSerial(1);   // SIM7080G
HardwareSerial tweliteSerial(2); // TWELITE
IrController irCtrl;             // IR送信コントローラ (ACプロトタイプモード用)

// ACコマンド構造体
struct AcCommandPending {
    bool found;
    int id;
    AcMode mode;
    float tempC;
};

// モデム状態
struct ModemState {
    bool isInitialized = false;
    bool isConnected = false;
    int signalStrength = 0;
    String ipAddress = "";
} modemState;

// 親機センサーデータ
struct ParentData {
    float temperature;
    float humidity;
    float pressure;    // 気圧 (hPa)
    int batteryLevel;
    int vbusMv = 0;    // VBUS電圧 mV (USB/安定化電源給電時)
} parentData;

// 関数プロトタイプ
bool readParentSensors();
bool initModem();
bool powerOnModem();
void powerOffModem();
bool connectNetwork();
bool syncNTP();
bool sendAllDataToServer();
String sendATCommand(const String& cmd, unsigned long timeout = 10000);
void goToDeepSleep(uint64_t sleepTimeSec);
bool initPMU();
int getSignalStrength();
void printCurrentTime();
String getTimestamp();
uint64_t calculateSleepDuration();

// TWELITE関数
void initTwelite();
void sendWakeSignalV2(uint32_t parentIdHash);
void sendMWXWakeTrigger();
bool collectChildData();
void parseChildPacketV2(uint8_t* buffer, int length);
bool isAllChildDataReceived();

// v2新規関数
bool sendRawHTTPTCP(const String& method, const String& path, const String& host, const String& body);
uint8_t computeChecksum(uint8_t* buffer, int length);
bool uploadCACert();
bool fetchConfigFromServer();
void sendPairingCommand(uint32_t parentIdHash, uint32_t targetChildId, uint8_t logicalId);
bool waitForPairingResponse(uint32_t targetChildId);
bool reportPairingResult(const char* childDeviceIdHex, const char* status);
void executePairingMode();
uint32_t computeParentIdHashLocal(const char* deviceId);

// ACプロトタイプモード用関数
AcCommandPending fetchPendingAcCommand();
bool ackAcCommand(int cmdId);

/**
 * parentIdHashをローカルで計算（SHA-256の先頭4バイト相当）
 * サーバーから取得したハッシュを使用するが、フォールバック用
 * 注意: 簡易FNV-1aハッシュを使用。サーバーではSHA-256を使用するため
 *       必ずサーバーから取得した値を使うこと
 */
uint32_t computeParentIdHashLocal(const char* deviceId) {
    // FNV-1a hash（サーバーのSHA-256とは異なる。フォールバック専用）
    uint32_t hash = 2166136261u;
    while (*deviceId) {
        hash ^= (uint8_t)*deviceId++;
        hash *= 16777619u;
    }
    return hash;
}

/**
 * 親機BME280センサー多サンプリング読み取り
 * ラズパイ report.sh の手法を移植:
 *  - ウォームアップ読み捨て1回
 *  - 5回測定 → 温度で挿入ソート → 中央値採用（外れ値に強い）
 *  - 失敗時はI2C再初期化リトライ（最大1回）
 */
bool readParentSensors() {
    const int NUM_SAMPLES = 3;
    float temps[NUM_SAMPLES], humids[NUM_SAMPLES], presses[NUM_SAMPLES];
    int validCount = 0;

    // ウォームアップ（最初の1回は捨てる）
    bme.readTemperature();
    delay(50);

    for (int i = 0; i < NUM_SAMPLES; i++) {
        float t = bme.readTemperature();
        float h = bme.readHumidity();
        float p = bme.readPressure() / 100.0f;  // Pa → hPa

        if (!isnan(t) && t >= -40.0f && t <= 85.0f &&
            !isnan(h) && h >= 0.0f  && h <= 100.0f &&
            !isnan(p) && p >= 300.0f && p <= 1100.0f) {
            // 挿入ソート（温度基準）
            int j = validCount - 1;
            while (j >= 0 && temps[j] > t) {
                temps[j+1]   = temps[j];
                humids[j+1]  = humids[j];
                presses[j+1] = presses[j];
                j--;
            }
            temps[j+1]   = t;
            humids[j+1]  = h;
            presses[j+1] = p;
            validCount++;
        }
        if (i < NUM_SAMPLES - 1) delay(50);
    }

    if (validCount == 0) {
        // リトライ: BME280再初期化
        Serial.println("[SENSOR] BME280 read failed, reinit I2C...");
        Wire.end();
        delay(300);
        Wire.begin(BME280_SDA_PIN, BME280_SCL_PIN);
        if (!bme.begin(0x76) && !bme.begin(0x77)) {
            Serial.println("[ERROR] BME280 reinit failed");
            parentData.temperature = 0;
            parentData.humidity    = 0;
            parentData.pressure    = 0;
            return false;
        }
        delay(300);
        float t = bme.readTemperature();
        float h = bme.readHumidity();
        float p = bme.readPressure() / 100.0f;
        parentData.temperature = (!isnan(t) && t >= -40 && t <= 85) ? t : 0;
        parentData.humidity    = (!isnan(h) && h >= 0 && h <= 100)  ? h : 0;
        parentData.pressure    = (!isnan(p) && p >= 300 && p <= 1100) ? p : 0;
        return parentData.temperature != 0;
    }

    // 中央値採用
    int mid = validCount / 2;
    parentData.temperature = temps[mid];
    parentData.humidity    = humids[mid];
    parentData.pressure    = presses[mid];
    return true;
}

/**
 * XORチェックサム計算
 * buffer[1]からbuffer[length-1]までのXOR
 */
uint8_t computeChecksum(uint8_t* buffer, int length) {
    uint8_t checksum = 0;
    for (int i = 1; i < length; i++) {
        checksum ^= buffer[i];
    }
    return checksum;
}

void setup() {
    // シリアル初期化
    Serial.begin(115200);
    delay(50);

    bootCount++;

    Serial.println("\n=============================================");
    Serial.println("  FoxSense One - Parent Node (v2)");
    Serial.println("  LILYGO T-SIM7080G-S3 + TWELITE");
    Serial.println("=============================================");
    Serial.printf("Boot count: %d\n", bootCount);
    Serial.printf("Device ID: %s (Parent)\n", DEVICE_ID);
    Serial.printf("Protocol: v%d\n", PROTOCOL_VERSION);

    // 起床理由を確認
    esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
    switch (wakeup_reason) {
        case ESP_SLEEP_WAKEUP_TIMER:
            Serial.println("Wakeup: Timer (scheduled)");
            break;
        default:
            Serial.println("Wakeup: Power on / Reset");
            ntpSynced = false;
            lastNtpSyncTime = 0;
            configFetched = false;   // 電源オン時は設定を再取得
            caCertUploaded = false;  // 電源オン時はCA証明書を再アップロード
            break;
    }

    // ピン初期化 (PWRKEY はアイドル=LOW, アクティブ=HIGH)
    pinMode(MODEM_PWRKEY_PIN, OUTPUT);
    pinMode(MODEM_DTR_PIN, OUTPUT);
    digitalWrite(MODEM_PWRKEY_PIN, LOW);  // アイドル状態
    digitalWrite(MODEM_DTR_PIN, LOW);

    // BME280初期化（Wire0, SDA=IO2/CAM_SDA, SCL=IO1/CAM_SCK）
    // カメラ搭載時はこのピンが競合するため配線変更が必要
    Wire.begin(BME280_SDA_PIN, BME280_SCL_PIN);
    bool bmeOk = bme.begin(0x76) || bme.begin(0x77);
    if (!bmeOk) {
        Serial.println("[WARN] BME280 not found on parent");
    } else {
        Serial.println("[OK] BME280 initialized (parent)");
    }

    // バッテリー電圧確認 (AXP2101 PMU)
    if (initPMU()) {
        parentData.batteryLevel = PMU.isBatteryConnect() ? PMU.getBatteryPercent() : 0;
        parentData.vbusMv = (int)PMU.getVbusVoltage();
        Serial.printf("[INFO] Battery: %dmV (%d%%) charging=%d VBUS=%dmV\n",
                      PMU.getBattVoltage(), parentData.batteryLevel, PMU.isCharging(), parentData.vbusMv);
    } else {
        Serial.println("[WARN] PMU (AXP2101) not found, battery unknown");
        parentData.batteryLevel = 0;
    }

    // 低バッテリー時は長めにスリープ
    if (parentData.batteryLevel > 0 && parentData.batteryLevel < BATTERY_LOW_WARN_THRESHOLD) {
        Serial.println("[WARN] Low battery! Extending sleep duration...");
        goToDeepSleep(MEASUREMENT_INTERVAL_MIN * 60 * 3);
        return;
    }

    // TWELITE初期化
    initTwelite();

    // モデムシリアル初期化
    modemSerial.begin(MODEM_BAUD_RATE, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
    delay(100);

    // モデム初期化
    Serial.println("\n[MODEM] Initializing...");
    if (!initModem()) {
        Serial.println("[ERROR] Modem init failed");
        consecutiveFailures++;

        // モデム失敗時でもキャッシュがあれば子機データ収集は試行
        if (configFetched && cachedParentIdHash != 0) {
            Serial.println("[INFO] Using cached config for child data collection");
            // 子機データ初期化（キャッシュから）
            activeChildCount = cachedChildCount;
            for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
                childDataList[i].deviceId = cachedChildIds[i];
                childDataList[i].logicalId = cachedChildLogicalIds[i];
                childDataList[i].received = false;
                childDataList[i].temperature = 0;
                childDataList[i].humidity = 0;
                childDataList[i].pressure = 0;
                childDataList[i].vccMv = 0;
                childDataList[i].needsPairing = false;
            }

            sendMWXWakeTrigger();

            readParentSensors();

            if (activeChildCount > 0) {
                collectChildData();
            }
            // データはサーバー送信できないため、次回送信に期待
        }

        if (consecutiveFailures >= 5) {
            goToDeepSleep(MEASUREMENT_INTERVAL_MIN * 60 * 6);
        } else {
            goToDeepSleep(MEASUREMENT_INTERVAL_MIN * 60);
        }
        return;
    }
    modemState.isInitialized = true;

    // CA証明書をモデムファイルシステムにアップロード (電源オン初回のみ)
    if (!uploadCACert()) {
        Serial.println("[SSL] CA cert upload failed, falling back to no-verify mode");
    }

    // NTP同期
    time_t now;
    time(&now);
    bool needNtpSync = !ntpSynced || (lastNtpSyncTime == 0) ||
                       (now - lastNtpSyncTime >= NTP_SYNC_INTERVAL_SEC);

    if (needNtpSync) {
        Serial.println("\n[NTP] Time synchronization...");
        if (syncNTP()) {
            ntpSynced = true;
            time(&lastNtpSyncTime);
            printCurrentTime();
        }
    }

    // ★ サーバーから設定取得
    bool needConfigFetch = !configFetched ||
                           (bootCount - lastConfigFetch >= CONFIG_FETCH_INTERVAL);

    if (needConfigFetch) {
        Serial.println("\n[CONFIG] Fetching device config from server...");
        if (fetchConfigFromServer()) {
            lastConfigFetch = bootCount;
            configFetched = true;
            Serial.printf("[CONFIG] parentIdHash: 0x%08X, children: %d\n",
                          cachedParentIdHash, cachedChildCount);
        } else {
            Serial.println("[WARN] Config fetch failed, using cached values");
            if (!configFetched) {
                // キャッシュもない場合はローカルハッシュ使用
                cachedParentIdHash = computeParentIdHashLocal(DEVICE_ID);
                Serial.printf("[WARN] Using local hash fallback: 0x%08X\n", cachedParentIdHash);
            }
        }
    } else {
        Serial.printf("[CONFIG] Using cached config (fetched at boot %d)\n", lastConfigFetch);
    }

    // 子機データ初期化（サーバー/キャッシュから）
    activeChildCount = 0;

    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        childDataList[i].deviceId = cachedChildIds[i];
        childDataList[i].logicalId = cachedChildLogicalIds[i];
        childDataList[i].received = false;
        childDataList[i].temperature = 0;
        childDataList[i].humidity = 0;
        childDataList[i].vccMv = 0;
        childDataList[i].needsPairing = false;

        if (cachedChildIds[i] != 0x00000000) {
            activeChildCount++;
        }
    }

    Serial.printf("[TWELITE] Active children: %d\n", activeChildCount);

    // 親機TWELITEに起床信号ブロードキャストを指示（15秒間送信）
    // ※ ペアリングより先に送り、子機を起こしてから対話する
    sendMWXWakeTrigger();

    // ペアリングモード実行（PENDING子機がある場合）
    // 起床トリガー送信後500ms待って子機が受信窓に入るのを待つ
    if (hasPendingChildren && pendingChildCount > 0) {
        delay(500);
        executePairingMode();
    }

    // 親機のセンサーデータ取得（5サンプル中央値フィルタ）
    Serial.println("\n[SENSOR] Reading parent BME280 (5-sample median)...");
    if (!readParentSensors()) {
        Serial.println("[WARN] Parent sensor read failed, using zeros");
    }
    Serial.printf("  Parent Temp: %.2f C\n", parentData.temperature);
    Serial.printf("  Parent Humidity: %.2f %%\n", parentData.humidity);
    Serial.printf("  Parent Pressure: %.1f hPa\n", parentData.pressure);

    // 子機データ収集（タイムアウトまで待機）
    // activeChildCount==0でも未登録子機のIDを検出するため常に受信待機
    Serial.println("\n[TWELITE] Collecting data from children (v2)...");
    bool allReceived = collectChildData();

    // ブロードキャスト完了 → TWELITE_WAKE_PIN をLOWに戻して親機TWELITEをスリープさせる
    digitalWrite(TWELITE_WAKE_PIN, LOW);

    if (activeChildCount > 0 && !allReceived) {
        Serial.println("[WARN] Not all children responded");
    }

    // 全データをサーバーに送信
    Serial.println("\n[HTTP] Sending all data to server...");
    if (sendAllDataToServer()) {
        Serial.println("[OK] All data sent successfully");
        consecutiveFailures = 0;
    } else {
        Serial.println("[ERROR] Data send failed");
        consecutiveFailures++;
    }

    // ACコマンドをチェックして実行（最大10分遅延）
    irCtrl.begin();
    AcCommandPending acCmd = fetchPendingAcCommand();
    if (acCmd.found) {
        Serial.printf("[AC] Executing: mode=%d tempC=%.1f\n", (int)acCmd.mode, acCmd.tempC);
        irCtrl.send(acCmd.mode, acCmd.tempC);
        ackAcCommand(acCmd.id);
    }

    // モデムはOFFにしない: DC3がディープスリープ中も保持され
    // 次回起動時に既にCat-M1登録済み状態を維持できるため

    // 次の定時までのスリープ時間を計算
    uint64_t sleepDuration = calculateSleepDuration();
    Serial.printf("\n[SLEEP] Going to deep sleep for %llu seconds...\n", sleepDuration);
    goToDeepSleep(sleepDuration);
}

void loop() {
    // ディープスリープ使用時はloop()は実行されない
}

// ===== TWELITE関連関数 =====

/**
 * TWELITE初期化
 */
void initTwelite() {
    tweliteSerial.setRxBufferSize(1024);
    tweliteSerial.begin(TWELITE_BAUD_RATE, SERIAL_8N1, TWELITE_RX_PIN, TWELITE_TX_PIN);
    delay(100);

    // 親機TWELITE スリープ解除ピン (TWELITE DIO0 に配線)
    pinMode(TWELITE_WAKE_PIN, OUTPUT);
    digitalWrite(TWELITE_WAKE_PIN, LOW);

    // TWELITEリセット（オプション）
    #ifdef TWELITE_RST_PIN
    pinMode(TWELITE_RST_PIN, OUTPUT);
    digitalWrite(TWELITE_RST_PIN, LOW);
    delay(10);
    digitalWrite(TWELITE_RST_PIN, HIGH);
    delay(100);
    #endif

    Serial.println("[OK] TWELITE initialized");
}

/**
 * MWX親機TWELITEに起床信号ブロードキャスト開始を指示
 * フォーマット: [0xA5][0x01][0x01][0x5A] (4バイト)
 * 親機TWELITEが15秒間起床パケットを送信 → 子機が50ms窓で確実に受信
 */
void sendMWXWakeTrigger() {
    // DIO0 をHIGHにして親機TWELITEをスリープから起こす
    digitalWrite(TWELITE_WAKE_PIN, HIGH);
    delay(10);  // TWELITE起床待ち (JN5169 wakeup ~1ms + margin)

    uint8_t cmd[4] = {0xA5, 0x01, 0x01, 0x5A};
    tweliteSerial.write(cmd, 4);
    Serial.println("[TWELITE] MWX wake trigger sent (15s broadcast)");

    // 親機の初期応答をバッファから読み捨て（バッファオーバーフロー防止）
    delay(500);
    while (tweliteSerial.available()) tweliteSerial.read();
    // ブロードキャスト終了後にLOWに戻す（親機TWELITEがスリープに入れるよう）
    // 15秒後に下げる: collectChildData完了のタイミングでLOWにする
}

/**
 * v2起床信号送信（parentIdHash入り、旧ATmega子機向け互換）
 * フォーマット: [0xA5][VERSION][CMD_WAKE][PARENT_ID_HASH_4bytes][TIMESTAMP_4bytes][CHECKSUM][0x5A]
 * 合計: 13バイト
 */
void sendWakeSignalV2(uint32_t parentIdHash) {
    uint8_t packet[13];
    uint32_t ts = millis();

    packet[0] = TWELITE_HEADER;
    packet[1] = PROTOCOL_VERSION;
    packet[2] = TWELITE_CMD_WAKE;
    // parentIdHash (big-endian)
    packet[3] = (parentIdHash >> 24) & 0xFF;
    packet[4] = (parentIdHash >> 16) & 0xFF;
    packet[5] = (parentIdHash >> 8) & 0xFF;
    packet[6] = parentIdHash & 0xFF;
    // timestamp (big-endian)
    packet[7] = (ts >> 24) & 0xFF;
    packet[8] = (ts >> 16) & 0xFF;
    packet[9] = (ts >> 8) & 0xFF;
    packet[10] = ts & 0xFF;
    // checksum (XOR of bytes 1..10)
    packet[11] = computeChecksum(packet, 11);
    packet[12] = TWELITE_FOOTER;

    // 複数回送信（確実性のため）
    for (int i = 0; i < 3; i++) {
        tweliteSerial.write(packet, 13);
        delay(WAKE_SIGNAL_INTERVAL);
    }

    Serial.printf("[TWELITE] v2 Wake signal sent (hash: 0x%08X, ts: %lu)\n", parentIdHash, ts);
}

/**
 * 子機からデータを収集（v2: parentIdHash検証付き）
 */
bool collectChildData() {
    unsigned long startTime = millis();
    uint8_t buffer[64];
    int bufferIndex = 0;

    while (millis() - startTime < CHILD_RESPONSE_TIMEOUT) {
        while (tweliteSerial.available()) {
            uint8_t b = tweliteSerial.read();

            // ヘッダー検出
            if (bufferIndex == 0 && b != TWELITE_HEADER) {
                continue;
            }

            buffer[bufferIndex++] = b;

            // フッター検出 → パケット解析 (MWX=17B, v3=21B, v2=19B)
            if (b == TWELITE_FOOTER && bufferIndex >= 17) {
                parseChildPacketV2(buffer, bufferIndex);
                bufferIndex = 0;

                // 全子機からデータ受信完了チェック
                if (isAllChildDataReceived()) {
                    Serial.println("[TWELITE] All child data received!");
                    return true;
                }
            }

            // バッファオーバーフロー防止
            if (bufferIndex >= sizeof(buffer)) {
                bufferIndex = 0;
            }
        }
        delay(10);
    }

    return isAllChildDataReceived();
}

/**
 * 子機パケット解析（v3/v2/v1後方互換）
 * MWX (17バイト): [0xA5][0x04][ID_4][TEMP_2][HUMID_2][PRES_2][LQI][BAT_2][CHKSUM][0x5A]
 * v3  (21バイト): [0xA5][0x03][CMD_DATA][HASH_4][ID_4][TEMP_2][HUMID_2][PRES_2][RSSI][BAT][CHKSUM][0x5A]
 * v2  (19バイト): [0xA5][0x02][CMD_DATA][HASH_4][ID_4][TEMP_2][HUMID_2][RSSI][BAT][CHKSUM][0x5A]
 */
void parseChildPacketV2(uint8_t* buffer, int length) {
    uint8_t pktVer = buffer[1];

    // MWXパケット (FoxSenseParent TWELITE から): 17バイト
    if (length >= 17 && pktVer == 0x04) {
        // チェックサム検証: bytes[1]..bytes[15] の XOR
        uint8_t cs = 0;
        for (int i = 1; i <= 14; i++) cs ^= buffer[i];
        if (buffer[15] != cs) {
            Serial.println("[TWELITE] MWX checksum mismatch");
            return;
        }
        uint32_t deviceId  = ((uint32_t)buffer[2] << 24) | ((uint32_t)buffer[3] << 16) |
                             ((uint32_t)buffer[4] << 8)  | (uint32_t)buffer[5];
        float temperature  = (int16_t)((buffer[6]  << 8) | buffer[7])  / 100.0f;
        float humidity     = (int16_t)((buffer[8]  << 8) | buffer[9])  / 100.0f;
        float pressure     = ((uint16_t)((buffer[10] << 8) | buffer[11])) / 10.0f;
        uint8_t lqi        = buffer[12];
        uint16_t vcc_mv    = (buffer[13] << 8) | buffer[14];
        // LQI → 近似RSSI(dBm): LQI=0→-100dBm, LQI=255→-30dBm
        int8_t  rssi       = (int8_t)((int)lqi * 70 / 255 - 100);
        // VCC(mV) → バッテリー%(2200mV=0%, 3300mV=100%)
        int bat_pct = (int)(vcc_mv - 2200) * 100 / 1100;
        uint8_t battery    = (uint8_t)(bat_pct < 0 ? 0 : bat_pct > 100 ? 100 : bat_pct);

        Serial.printf("[TWELITE] MWX from 0x%08X: %.2fC %.2f%% %.1fhPa LQI:%d VCC:%dmV Bat:%d%%\n",
                      deviceId, temperature, humidity, pressure, lqi, vcc_mv, battery);

        for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
            if (childDataList[i].deviceId == deviceId) {
                childDataList[i].temperature = temperature;
                childDataList[i].humidity    = humidity;
                childDataList[i].pressure    = pressure;
                childDataList[i].rssi        = rssi;
                childDataList[i].battery     = battery;
                childDataList[i].vccMv       = vcc_mv;
                childDataList[i].received    = true;
                childDataList[i].timestamp   = millis();
                break;
            }
        }
        return;
    }

    // v3パケット: 21バイト（気圧あり）
    if (length >= 21 && pktVer == 0x03 && buffer[2] == TWELITE_CMD_DATA) {
        uint8_t expectedChecksum = computeChecksum(buffer, length - 2);
        if (buffer[length - 2] != expectedChecksum) {
            Serial.println("[TWELITE] v3 checksum mismatch");
            return;
        }
        uint32_t receivedHash = ((uint32_t)buffer[3] << 24) | ((uint32_t)buffer[4] << 16) |
                                ((uint32_t)buffer[5] << 8)  | (uint32_t)buffer[6];
        if (receivedHash != cachedParentIdHash) {
            Serial.printf("[TWELITE] v3 hash mismatch: 0x%08X vs 0x%08X\n", receivedHash, cachedParentIdHash);
            return;
        }
        uint32_t deviceId = ((uint32_t)buffer[7] << 24) | ((uint32_t)buffer[8] << 16) |
                            ((uint32_t)buffer[9] << 8)  | (uint32_t)buffer[10];
        float temperature = (int16_t)((buffer[11] << 8) | buffer[12]) / 100.0f;
        float humidity    = (int16_t)((buffer[13] << 8) | buffer[14]) / 100.0f;
        float pressure    = ((uint16_t)((buffer[15] << 8) | buffer[16])) / 10.0f;  // ×10 decode
        int8_t rssi       = (int8_t)buffer[17];
        uint8_t battery   = buffer[18];

        Serial.printf("[TWELITE] v3 from 0x%08X: %.2fC %.2f%% %.1fhPa RSSI:%d Bat:%d%%\n",
                      deviceId, temperature, humidity, pressure, rssi, battery);

        for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
            if (childDataList[i].deviceId == deviceId) {
                childDataList[i].temperature = temperature;
                childDataList[i].humidity    = humidity;
                childDataList[i].pressure    = pressure;
                childDataList[i].rssi        = rssi;
                childDataList[i].battery     = battery;
                childDataList[i].received    = true;
                childDataList[i].timestamp   = millis();
                break;
            }
        }
        return;
    }

    // v2パケット: 19バイト（後方互換）
    if (length >= 19 && pktVer == 0x02 && buffer[2] == TWELITE_CMD_DATA) {
        uint8_t expectedChecksum = computeChecksum(buffer, length - 2);
        if (buffer[length - 2] != expectedChecksum) {
            Serial.println("[TWELITE] v2 checksum mismatch");
            return;
        }
        uint32_t receivedHash = ((uint32_t)buffer[3] << 24) | ((uint32_t)buffer[4] << 16) |
                                ((uint32_t)buffer[5] << 8)  | (uint32_t)buffer[6];
        if (receivedHash != cachedParentIdHash) {
            Serial.printf("[TWELITE] v2 hash mismatch: 0x%08X vs 0x%08X\n", receivedHash, cachedParentIdHash);
            return;
        }
        uint32_t deviceId = ((uint32_t)buffer[7] << 24) | ((uint32_t)buffer[8] << 16) |
                            ((uint32_t)buffer[9] << 8)  | (uint32_t)buffer[10];
        float temperature = (int16_t)((buffer[11] << 8) | buffer[12]) / 100.0f;
        float humidity    = (int16_t)((buffer[13] << 8) | buffer[14]) / 100.0f;
        int8_t rssi       = (int8_t)buffer[15];
        uint8_t battery   = buffer[16];

        Serial.printf("[TWELITE] v2 from 0x%08X: %.2fC %.2f%% RSSI:%d Bat:%d%%\n",
                      deviceId, temperature, humidity, rssi, battery);

        for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
            if (childDataList[i].deviceId == deviceId) {
                childDataList[i].temperature = temperature;
                childDataList[i].humidity    = humidity;
                childDataList[i].pressure    = 0;  // v2には気圧なし
                childDataList[i].rssi        = rssi;
                childDataList[i].battery     = battery;
                childDataList[i].received    = true;
                childDataList[i].timestamp   = millis();
                break;
            }
        }
        return;
    }

}

/**
 * 全子機からデータ受信済みかチェック
 */
bool isAllChildDataReceived() {
    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        if (cachedChildIds[i] != 0x00000000 && !childDataList[i].received) {
            return false;
        }
    }
    return true;
}

// ===== SSL: CA証明書アップロード =====

/**
 * ISRG Root X1 CA証明書をSIM7080Gファイルシステムに書き込む
 * 電源オン時に1回だけ実行 (caCertUploaded RTCフラグで管理)
 */
bool uploadCACert() {
    if (caCertUploaded) return true;

    Serial.println("[SSL] Uploading CA cert to modem filesystem...");

    sendATCommand("AT+CFSINIT", 3000);

    // CFSWFILE: カスタマーエリア(3), ファイル名, 上書き(0), バイト数, タイムアウト(ms)
    String cmd = "AT+CFSWFILE=3,\"ca.pem\",0," + String(CA_CERT_LEN) + ",10000";
    while (modemSerial.available()) modemSerial.read();
    modemSerial.println(cmd);

    // "DOWNLOAD" プロンプト待ち (最大5秒)
    String prompt = "";
    unsigned long t = millis();
    while (millis() - t < 5000) {
        while (modemSerial.available()) prompt += (char)modemSerial.read();
        if (prompt.indexOf("DOWNLOAD") >= 0 || prompt.indexOf(">") >= 0) break;
        if (prompt.indexOf("ERROR") >= 0) break;
        delay(50);
    }
    Serial.printf("[SSL] CFSWFILE prompt: '%s'\n", prompt.substring(0, 20).c_str());

    if (prompt.indexOf("DOWNLOAD") < 0 && prompt.indexOf(">") < 0) {
        Serial.println("[SSL] CFSWFILE prompt not received");
        sendATCommand("AT+CFSTERM", 2000);
        return false;
    }

    // 証明書データ送信 (バイナリ書き込み)
    modemSerial.write((const uint8_t*)CA_CERT_PEM, CA_CERT_LEN);

    // OK 待ち (最大10秒)
    String result = "";
    t = millis();
    while (millis() - t < 10000) {
        while (modemSerial.available()) result += (char)modemSerial.read();
        if (result.indexOf("OK") >= 0 || result.indexOf("ERROR") >= 0) break;
        delay(100);
    }
    Serial.printf("[SSL] CFSWFILE result: '%s'\n", result.c_str());

    sendATCommand("AT+CFSTERM", 2000);

    if (result.indexOf("OK") >= 0) {
        caCertUploaded = true;
        Serial.printf("[SSL] CA cert uploaded (%d bytes)\n", CA_CERT_LEN);
        return true;
    }

    Serial.println("[SSL] CA cert upload failed");
    return false;
}

// ===== v2: サーバー設定取得 =====

/**
 * サーバーからデバイス設定を取得（GET /api/devices/config/:deviceId?secret=xxx）
 * レスポンスJSONをパースしてRTCキャッシュに保存
 */
bool fetchConfigFromServer() {
    // HTTPS GET リクエスト
    String configPath = String(SERVER_CONFIG_PATH) + DEVICE_ID + "?secret=" + DEVICE_SECRET;

    String r;
    // TCP接続 (HTTP port 80)
    sendATCommand("AT+CACLOSE=0", 1000);  // 念のため既存接続をクローズ
    r = sendATCommand("AT+CAOPEN=0,0,\"TCP\",\"" + String(SERVER_HOST) + "\",80", 20000);
    Serial.printf("[CONFIG] CAOPEN(TCP): '%s'\n", r.c_str());
    if (r.indexOf("OK") < 0) {
        Serial.println("[CONFIG] SSL connection failed");
        return false;
    }
    // +CAOPEN: <clientID>,0 からclientIDを取得
    int cfgClientID = 0;
    {
        int cidx = r.indexOf("+CAOPEN: ");
        if (cidx >= 0) {
            int ns = cidx + 9;
            int cm = r.indexOf(",", ns);
            if (cm > ns) cfgClientID = r.substring(ns, cm).toInt();
        }
    }
    Serial.printf("[CONFIG] clientID: %d\n", cfgClientID);
    delay(200);

    // GETリクエスト送信 (HTTP/1.1 + keep-alive)
    String httpReq = "GET " + configPath + " HTTP/1.1\r\n";
    httpReq += "Host: " + String(SERVER_HOST) + "\r\n";
    httpReq += "Connection: keep-alive\r\n\r\n";

    r = sendATCommand("AT+CASEND=" + String(cfgClientID) + "," + String(httpReq.length()), 5000);
    Serial.printf("[CONFIG] CASEND prompt: '%s'\n", r.c_str());
    modemSerial.print(httpReq);

    // +CADATAIND を待ってからCARECVで生HTTPデータを収集（複数チャンク対応）
    String httpData = "";
    int targetBodyLen = -1;
    int httpHeaderEnd  = -1;
    unsigned long t = millis();

    // 最初の +CADATAIND を待つ（最大10秒）
    {
        String waitBuf = "";
        while (millis() - t < 10000) {
            while (modemSerial.available()) waitBuf += (char)modemSerial.read();
            if (waitBuf.indexOf("+CADATAIND:") >= 0) break;
            if (waitBuf.indexOf("+CASTATE:") >= 0) break;
            delay(50);
        }
        Serial.printf("[CONFIG] waitBuf: '%s'\n", waitBuf.substring(0, 100).c_str());
    }

    // CARECVを繰り返してHTTPデータを収集（最大15秒、最大20回）
    for (int attempt = 0; attempt < 20 && millis() - t < 15000; attempt++) {
        modemSerial.print("AT+CARECV=" + String(cfgClientID) + ",1460\r\n");
        String chunk = "";
        unsigned long rt = millis();
        while (millis() - rt < 3000) {
            while (modemSerial.available()) chunk += (char)modemSerial.read();
            if (chunk.endsWith("\r\nOK\r\n") || chunk.indexOf("ERROR") >= 0) break;
            delay(10);
        }

        // +CARECV: <len>,<data> から生データを抽出
        int caIdx = chunk.indexOf("+CARECV:");
        if (caIdx >= 0) {
            int commaPos = chunk.indexOf(",", caIdx + 8);
            if (commaPos > 0) {
                int recvLen = chunk.substring(caIdx + 9, commaPos).toInt();
                if (recvLen > 0) {
                    httpData += chunk.substring(commaPos + 1, commaPos + 1 + recvLen);
                    Serial.printf("[CONFIG] CARECV got %d bytes, total httpData: %d\n", recvLen, httpData.length());
                } else {
                    // 0バイト → 少し待ってリトライ
                    delay(300);
                    continue;
                }
            }
        } else {
            delay(200);
            continue;
        }

        // Content-Length を取得（まだ未取得の場合）
        if (targetBodyLen < 0) {
            int clIdx = httpData.indexOf("Content-Length: ");
            int hdrEnd = httpData.indexOf("\r\n\r\n");
            if (clIdx >= 0 && hdrEnd > clIdx) {
                int clEnd = httpData.indexOf("\r\n", clIdx + 16);
                targetBodyLen = httpData.substring(clIdx + 16, clEnd).toInt();
                httpHeaderEnd = hdrEnd;
                Serial.printf("[CONFIG] Content-Length: %d\n", targetBodyLen);
            }
        }

        // ボディが揃ったか確認
        if (targetBodyLen > 0 && httpHeaderEnd >= 0) {
            int bodyAvail = (int)httpData.length() - httpHeaderEnd - 4;
            Serial.printf("[CONFIG] body avail: %d / %d\n", bodyAvail, targetBodyLen);
            if (bodyAvail >= targetBodyLen) break;
        }
    }

    String cfgResp = httpData;
    Serial.printf("[CONFIG] httpData total: %d bytes\n", httpData.length());

    String response = cfgResp;
    Serial.printf("[CONFIG] CARECV (first 200): '%s'\n", response.substring(0, 200).c_str());
    sendATCommand("AT+CACLOSE=" + String(cfgClientID), 3000);

    bool success = false;
    int bodyLen = 0;

    // 古いモデムバッファの残滓を除去してHTTPレスポンス先頭から解析
    int httpStart = response.indexOf("HTTP/");
    if (httpStart >= 0) {
        response = response.substring(httpStart);
    }

    if (response.indexOf("HTTP/") >= 0 && (response.indexOf(" 200") >= 0 || response.indexOf(" 201") >= 0)) {
        // HTTPヘッダーとボディを分離（HTTP/以降から\r\n\r\nを探す）
        int bodyStart = response.indexOf("\r\n\r\n");
        if (bodyStart >= 0) {
            // Content-Lengthで正確なボディ長を取得
            int contentLen = 0;
            int clIdx = response.indexOf("Content-Length: ");
            if (clIdx >= 0 && clIdx < bodyStart) {
                int clEnd = response.indexOf("\r\n", clIdx + 16);
                if (clEnd > 0) contentLen = response.substring(clIdx + 16, clEnd).toInt();
            }
            int bodyOffset = bodyStart + 4;
            if (contentLen > 0) {
                response = response.substring(bodyOffset, bodyOffset + contentLen);
            } else {
                response = response.substring(bodyOffset);
            }
        }
        bodyLen = response.length();
        success = bodyLen > 0;
        Serial.printf("[CONFIG] HTTP 200 OK, body: %d bytes\n", bodyLen);
    }

    if (success && bodyLen > 0) {

        // JSONパース（簡易パーサー）
        // レスポンス例: {"success":true,"data":{"deviceId":"foxsense-001","parentIdHash":2849513012,...}}
        Serial.println("[CONFIG] Response: " + response);

        // parentIdHash取得
        int hashIdx = response.indexOf("\"parentIdHash\":");
        if (hashIdx >= 0) {
            int hashStart = hashIdx + 15;
            int hashEnd = response.indexOf(",", hashStart);
            if (hashEnd < 0) hashEnd = response.indexOf("}", hashStart);
            if (hashEnd > hashStart) {
                String hashStr = response.substring(hashStart, hashEnd);
                hashStr.trim();
                cachedParentIdHash = (uint32_t)strtoul(hashStr.c_str(), NULL, 10);
                Serial.printf("[CONFIG] parentIdHash: 0x%08X\n", cachedParentIdHash);
            }
        }

        // 子機リストパース
        int childrenIdx = response.indexOf("\"children\":[");
        if (childrenIdx >= 0) {
            // 既存キャッシュクリア
            cachedChildCount = 0;
            pendingChildCount = 0;
            hasPendingChildren = false;
            for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
                cachedChildIds[i] = 0;
                cachedChildLogicalIds[i] = 0;
            }

            // 各子機エントリをパース
            int searchPos = childrenIdx + 12;
            int childIdx = 0;

            while (childIdx < MAX_CHILD_DEVICES) {
                int objStart = response.indexOf("{", searchPos);
                int objEnd = response.indexOf("}", objStart);
                if (objStart < 0 || objEnd < 0) break;

                String childObj = response.substring(objStart, objEnd + 1);

                // deviceIdNum取得
                int didIdx = childObj.indexOf("\"deviceIdNum\":");
                uint32_t childDeviceId = 0;
                if (didIdx >= 0) {
                    int didStart = didIdx + 14;
                    int didEnd = childObj.indexOf(",", didStart);
                    if (didEnd < 0) didEnd = childObj.indexOf("}", didStart);
                    String didStr = childObj.substring(didStart, didEnd);
                    didStr.trim();
                    childDeviceId = (uint32_t)strtoul(didStr.c_str(), NULL, 10);
                }

                // logicalId取得
                int lidIdx = childObj.indexOf("\"logicalId\":");
                uint8_t logicalId = childIdx;
                if (lidIdx >= 0) {
                    int lidStart = lidIdx + 12;
                    int lidEnd = childObj.indexOf(",", lidStart);
                    if (lidEnd < 0) lidEnd = childObj.indexOf("}", lidStart);
                    String lidStr = childObj.substring(lidStart, lidEnd);
                    lidStr.trim();
                    logicalId = (uint8_t)lidStr.toInt();
                }

                // pairingStatus取得
                int psIdx = childObj.indexOf("\"pairingStatus\":\"");
                String pairingStatus = "PAIRED";
                if (psIdx >= 0) {
                    int psStart = psIdx + 17;
                    int psEnd = childObj.indexOf("\"", psStart);
                    if (psEnd > psStart) {
                        pairingStatus = childObj.substring(psStart, psEnd);
                    }
                }

                // deviceId(hex文字列)取得
                int dhIdx = childObj.indexOf("\"deviceId\":\"");
                String deviceIdHex = "";
                if (dhIdx >= 0) {
                    int dhStart = dhIdx + 12;
                    int dhEnd = childObj.indexOf("\"", dhStart);
                    if (dhEnd > dhStart) {
                        deviceIdHex = childObj.substring(dhStart, dhEnd);
                    }
                }

                if (childDeviceId != 0) {
                    cachedChildIds[childIdx] = childDeviceId;
                    cachedChildLogicalIds[childIdx] = logicalId;
                    cachedChildCount++;

                    Serial.printf("[CONFIG] Child[%d]: 0x%08X (logical:%d, status:%s)\n",
                                  childIdx, childDeviceId, logicalId, pairingStatus.c_str());

                    // ペアリング待ち子機を記録
                    if (pairingStatus == "PENDING") {
                        hasPendingChildren = true;
                        if (pendingChildCount < MAX_CHILD_DEVICES) {
                            pendingChildren[pendingChildCount].deviceId = childDeviceId;
                            pendingChildren[pendingChildCount].logicalId = logicalId;
                            deviceIdHex.toCharArray(pendingChildren[pendingChildCount].deviceIdHex, 9);
                            pendingChildCount++;
                        }
                    }

                    childIdx++;
                }

                searchPos = objEnd + 1;
            }
        }
    }

    return success && cachedParentIdHash != 0;
}

// ===== v2: ペアリングモード =====

/**
 * ペアリングモード実行
 * PENDING状態の子機に対してペアリング要求を送信
 */
void executePairingMode() {
    Serial.printf("\n[PAIRING] Starting pairing mode (%d pending children)\n", pendingChildCount);

    for (int i = 0; i < pendingChildCount; i++) {
        Serial.printf("[PAIRING] Pairing child 0x%08X (logical:%d)...\n",
                      pendingChildren[i].deviceId, pendingChildren[i].logicalId);

        sendPairingCommand(cachedParentIdHash, pendingChildren[i].deviceId, pendingChildren[i].logicalId);

        // ペアリング応答待ち
        if (waitForPairingResponse(pendingChildren[i].deviceId)) {
            Serial.printf("[PAIRING] Child 0x%08X paired successfully!\n", pendingChildren[i].deviceId);
            reportPairingResult(pendingChildren[i].deviceIdHex, "PAIRED");
        } else {
            Serial.printf("[PAIRING] Child 0x%08X pairing timeout\n", pendingChildren[i].deviceId);
            reportPairingResult(pendingChildren[i].deviceIdHex, "FAILED");
        }
    }

    Serial.println("[PAIRING] Pairing mode complete");
}

/**
 * ペアリング要求パケット送信
 * フォーマット: [0xA5][VERSION][CMD_PAIR][PARENT_ID_HASH_4bytes][TARGET_CHILD_ID_4bytes][LOGICAL_ID][CHECKSUM][0x5A]
 * 合計: 14バイト
 */
void sendPairingCommand(uint32_t parentIdHash, uint32_t targetChildId, uint8_t logicalId) {
    uint8_t packet[14];

    packet[0] = TWELITE_HEADER;
    packet[1] = PROTOCOL_VERSION;
    packet[2] = TWELITE_CMD_PAIR;
    // parentIdHash
    packet[3] = (parentIdHash >> 24) & 0xFF;
    packet[4] = (parentIdHash >> 16) & 0xFF;
    packet[5] = (parentIdHash >> 8) & 0xFF;
    packet[6] = parentIdHash & 0xFF;
    // targetChildId
    packet[7] = (targetChildId >> 24) & 0xFF;
    packet[8] = (targetChildId >> 16) & 0xFF;
    packet[9] = (targetChildId >> 8) & 0xFF;
    packet[10] = targetChildId & 0xFF;
    // logicalId
    packet[11] = logicalId;
    // checksum
    packet[12] = computeChecksum(packet, 12);
    packet[13] = TWELITE_FOOTER;

    // 3回送信
    for (int i = 0; i < 3; i++) {
        tweliteSerial.write(packet, 14);
        delay(WAKE_SIGNAL_INTERVAL);
    }
}

/**
 * ペアリング応答待ち
 * フォーマット: [0xA5][VERSION][CMD_PAIR_ACK][PARENT_ID_HASH_4bytes][CHILD_ID_4bytes][STATUS][CHECKSUM][0x5A]
 * 合計: 14バイト
 */
bool waitForPairingResponse(uint32_t targetChildId) {
    unsigned long startTime = millis();
    uint8_t buffer[64];
    int bufferIndex = 0;

    while (millis() - startTime < PAIRING_RESPONSE_TIMEOUT) {
        while (tweliteSerial.available()) {
            uint8_t b = tweliteSerial.read();

            if (bufferIndex == 0 && b != TWELITE_HEADER) {
                continue;
            }

            buffer[bufferIndex++] = b;

            if (b == TWELITE_FOOTER && bufferIndex >= 14) {
                // ペアリング応答チェック
                if (buffer[1] == PROTOCOL_VERSION && buffer[2] == TWELITE_CMD_PAIR_ACK) {
                    // チェックサム検証
                    uint8_t expectedChecksum = computeChecksum(buffer, bufferIndex - 2);
                    if (buffer[bufferIndex - 2] != expectedChecksum) {
                        bufferIndex = 0;
                        continue;
                    }

                    // parentIdHash検証
                    uint32_t receivedHash = ((uint32_t)buffer[3] << 24) |
                                            ((uint32_t)buffer[4] << 16) |
                                            ((uint32_t)buffer[5] << 8) |
                                            (uint32_t)buffer[6];

                    uint32_t childId = ((uint32_t)buffer[7] << 24) |
                                       ((uint32_t)buffer[8] << 16) |
                                       ((uint32_t)buffer[9] << 8) |
                                       (uint32_t)buffer[10];

                    uint8_t status = buffer[11];

                    if (receivedHash == cachedParentIdHash && childId == targetChildId && status == 0x01) {
                        return true;  // ペアリング成功
                    }
                }
                bufferIndex = 0;
            }

            if (bufferIndex >= sizeof(buffer)) {
                bufferIndex = 0;
            }
        }
        delay(10);
    }

    return false;
}

/**
 * ペアリング結果をサーバーに報告
 */
bool reportPairingResult(const char* childDeviceIdHex, const char* status) {
    String pairingPath = String(SERVER_CONFIG_PATH) + DEVICE_ID + "/pairing-result";

    // JSONペイロード構築
    String payload = "{";
    payload += "\"childDeviceId\":\"" + String(childDeviceIdHex) + "\",";
    payload += "\"status\":\"" + String(status) + "\",";
    payload += "\"secret\":\"" + String(DEVICE_SECRET) + "\"";
    payload += "}";

    // 生TCP送信 (SHCONN は cid=0 問題で動作しないため回避)
    return sendRawHTTPTCP("POST", pairingPath, String(SERVER_HOST), payload);
}

// ===== モデム関連関数 =====

bool powerOnModem() {
    Serial.println("[MODEM] Powering on...");

    // バッテリー電圧確認 (SIM7080G は LiPo VBAT 必須)
    uint16_t battMv = PMU.getBattVoltage();
    Serial.printf("[MODEM] Battery: %dmV\n", battMv);
    if (battMv < 3000) {
        if (SKIP_BATTERY_CHECK) {
            Serial.println("[WARN] Battery low/missing, but SKIP_BATTERY_CHECK=true. Continuing...");
        } else {
            Serial.println("[ERROR] Battery voltage too low or not connected!");
            Serial.println("[ERROR] SIM7080G requires LiPo battery (>3.0V) on VBAT pin.");
            return false;
        }
    }

    // まず既に起動中か確認 (DC3がディープスリープ中も保持されモデムが動いている場合)
    // 複数回リトライ: 1回だけ試して失敗するとPWRKEYで動作中のモデムを切ってしまう
    Serial.println("[MODEM] Checking if already running (5 tries)...");
    auto tryATOnce = [&]() -> bool {
        while (modemSerial.available()) modemSerial.read();
        modemSerial.println("AT");
        String r = "";
        unsigned long t = millis();
        while (millis() - t < 1500) {
            while (modemSerial.available()) r += (char)modemSerial.read();
            delay(10);
        }
        Serial.printf("[MODEM] tryAT: '%s'\n", r.c_str());
        return r.indexOf("OK") >= 0;
    };

    for (int attempt = 0; attempt < 5; attempt++) {
        if (tryATOnce()) {
            Serial.println("[MODEM] Already running! Skipping PWRKEY.");
            return true;
        }
        delay(500);
    }

    // 起動していないのでPWRKEYで起動
    // PWRKEY シーケンス (LilyGo T-SIM7080G-S3 公式パターン)
    // LOW(idle) → HIGH(active,1s) → LOW(idle)
    Serial.println("[MODEM] Not running. PWRKEY: LOW→HIGH(1s)→LOW");
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
    delay(100);
    digitalWrite(MODEM_PWRKEY_PIN, HIGH);
    delay(1000);
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
    Serial.println("[MODEM] PWRKEY done, waiting 15s for boot...");
    delay(15000);

    // ATコマンド確認 (最大15回)
    Serial.println("[MODEM] Trying AT commands...");
    for (int i = 0; i < 15; i++) {
        while (modemSerial.available()) modemSerial.read();
        modemSerial.println("AT");
        delay(500);
        String response = "";
        unsigned long t = millis();
        while (millis() - t < 1000) {
            while (modemSerial.available()) response += (char)modemSerial.read();
            delay(10);
        }
        response.trim();
        Serial.printf("[AT #%d] '%s'\n", i + 1, response.c_str());
        if (response.indexOf("OK") >= 0) {
            Serial.println("[MODEM] AT OK!");
            return true;
        }
        delay(500);
    }

    // PWRKEYで起動に失敗した場合、もう1回PWRKEY試行
    Serial.println("[MODEM] First boot attempt failed, trying PWRKEY again...");
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
    delay(100);
    digitalWrite(MODEM_PWRKEY_PIN, HIGH);
    delay(1000);
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
    Serial.println("[MODEM] Second PWRKEY done, waiting 15s...");
    delay(15000);
    for (int i = 0; i < 10; i++) {
        while (modemSerial.available()) modemSerial.read();
        modemSerial.println("AT");
        delay(500);
        String response = "";
        unsigned long t = millis();
        while (millis() - t < 1000) {
            while (modemSerial.available()) response += (char)modemSerial.read();
            delay(10);
        }
        response.trim();
        Serial.printf("[AT2 #%d] '%s'\n", i + 1, response.c_str());
        if (response.indexOf("OK") >= 0) {
            Serial.println("[MODEM] AT OK (2nd attempt)!");
            return true;
        }
        delay(500);
    }

    Serial.println("[MODEM] No AT response.");
    return false;
}

void powerOffModem() {
    sendATCommand("AT+CPOWD=1", 3000);
    delay(2000);
}

bool initModem() {
    while (modemSerial.available()) modemSerial.read();

    if (!powerOnModem()) {
        return false;
    }
    Serial.println("[MODEM] AT OK");

    sendATCommand("ATE0", 1000);
    sendATCommand("AT+CMEE=2", 1000);  // 詳細エラーコード有効化

    String response = sendATCommand("AT+CPIN?", 5000);
    if (response.indexOf("READY") < 0) {
        Serial.println("[MODEM] SIM not ready");
        return false;
    }
    Serial.println("[MODEM] SIM ready");

    // HTTPモジュール不調フラグ: CFUN=1,1 でモデムをソフトリセット
    if (modemNeedsReset) {
        Serial.println("[MODEM] HTTPモジュール再初期化のためCFUN=1,1ソフトリセット...");
        sendATCommand("AT+CFUN=1,1", 5000);
        delay(20000);  // モデム再起動待ち
        // リセット後は通常フローで再登録
        modemNeedsReset = false;
        Serial.println("[MODEM] CFUN=1,1 done, re-initializing...");
        // CPINが準備できるまで待つ
        for (int i = 0; i < 15; i++) {
            String cpin = sendATCommand("AT+CPIN?", 3000);
            if (cpin.indexOf("READY") >= 0) break;
            delay(2000);
        }
    }

    // Cat-M1登録済みかを CFUN=0 の前に確認
    // 登録済みかつモデムリセット不要なら CFUN=0/1 リセットをスキップ
    String cpsiEarly = sendATCommand("AT+CPSI?", 3000);
    Serial.printf("[MODEM] Early CPSI: %s\n", cpsiEarly.c_str());

    if (cpsiEarly.indexOf("LTE CAT-M1,Online") >= 0 || cpsiEarly.indexOf("NB-IOT,Online") >= 0) {
        // Cat-M1登録済みでも CFUN=1,1 でTCP/HTTPスタックを再初期化 (deep sleepで失われる)
        Serial.println("[MODEM] Already on Cat-M1 - CFUN=1,1 to reinitialize TCP stack...");
        sendATCommand("AT+CFUN=1,1", 5000);
        delay(20000);
        // SIM準備を待つ
        for (int i = 0; i < 15; i++) {
            String cpin = sendATCommand("AT+CPIN?", 3000);
            if (cpin.indexOf("READY") >= 0) {
                Serial.println("[MODEM] SIM ready after CFUN=1,1");
                break;
            }
            delay(2000);
        }
        // ネットワーク再登録待ち
        Serial.println("[MODEM] Waiting for re-registration...");
        for (int i = 0; i < 30; i++) {
            String cpsiNew = sendATCommand("AT+CPSI?", 2000);
            if (cpsiNew.indexOf("LTE CAT-M1,Online") >= 0 || cpsiNew.indexOf("NB-IOT,Online") >= 0) {
                Serial.printf("[MODEM] Re-registered: %s\n", cpsiNew.substring(0, 40).c_str());
                break;
            }
            delay(2000);
        }
        modemState.signalStrength = getSignalStrength();
        if (!connectNetwork()) {
            return false;
        }
        modemState.isConnected = true;
        return true;
    }

    // SIM情報取得
    String imsi = sendATCommand("AT+CIMI", 3000);
    Serial.printf("[MODEM] IMSI: %s\n", imsi.c_str());
    String iccid = sendATCommand("AT+CCID", 3000);
    Serial.printf("[MODEM] ICCID: %s\n", iccid.c_str());

    // ラジオオフ→設定変更→オン の順で確実に設定
    sendATCommand("AT+CFUN=0", 8000);
    delay(2000);

    // APN設定 (SORACOM) - シンプルな構成
    String apnCmd = String("AT+CGDCONT=1,\"IP\",\"") + LTE_APN + "\"";
    sendATCommand(apnCmd, 3000);

    // LTE only + Cat-M1 only (plan-D は Cat-M1 対応、NB-IoT非対応)
    sendATCommand("AT+CNMP=38", 3000);   // LTE only
    sendATCommand("AT+CMNB=1", 3000);   // Cat-M1 only

    sendATCommand("AT+CFUN=1", 8000);
    delay(3000);

    // CFUN=1後にオペレーター自動選択 (ラジオON後でないと有効にならない)
    sendATCommand("AT+COPS=0", 5000);
    delay(2000);

    // 接続前の診断情報
    String csq = sendATCommand("AT+CSQ", 2000);
    Serial.printf("[MODEM] Signal: %s\n", csq.c_str());
    String cpsiNow = sendATCommand("AT+CPSI?", 3000);
    Serial.printf("[MODEM] Network state: %s\n", cpsiNow.c_str());

    // 既に登録済みか確認
    if (cpsiNow.indexOf("LTE CAT-M1,Online") >= 0 || cpsiNow.indexOf("NB-IOT,Online") >= 0) {
        Serial.println("[MODEM] Registered on Cat-M1/NB-IoT!");
        modemState.signalStrength = getSignalStrength();
        if (!connectNetwork()) {
            return false;
        }
        modemState.isConnected = true;
        return true;
    }

    Serial.println("[MODEM] Waiting for network registration...");
    bool registered = false;
    for (int i = 0; i < 60; i++) {
        response = sendATCommand("AT+CEREG?", 2000);
        if (i < 5 || i % 10 == 0) {
            Serial.printf("[NET #%d] CEREG: '%s'\n", i, response.c_str());
        }
        if (response.indexOf(",1") >= 0 || response.indexOf(",5") >= 0) {
            registered = true;
            break;
        }
        if (response.indexOf(",3") >= 0) {
            Serial.println("[NET] Registration DENIED!");
            break;
        }
        // CPSI でも確認
        String cpsi = sendATCommand("AT+CPSI?", 2000);
        if (cpsi.indexOf("LTE CAT-M1,Online") >= 0 || cpsi.indexOf("NB-IOT,Online") >= 0) {
            Serial.printf("[NET] CPSI registered: %s\n", cpsi.c_str());
            registered = true;
            break;
        }
        delay(1000);
    }

    if (!registered) {
        return false;
    }
    Serial.println("[MODEM] Network registered");

    modemState.signalStrength = getSignalStrength();

    if (!connectNetwork()) {
        return false;
    }

    modemState.isConnected = true;
    return true;
}

bool connectNetwork() {
    Serial.println("[MODEM] Connecting...");

    // CNACT=0 でコンテキスト0を使用 (CGDCONT=1がpdpidx=0に対応)
    sendATCommand("AT+CNACT=0,0", 5000);
    delay(1000);

    // PDP Context有効化要求
    String response = sendATCommand("AT+CNACT=0,1", 5000);
    if (response.indexOf("ERROR") >= 0) {
        Serial.println("[MODEM] CNACT activate failed");
        return false;
    }

    // 接続確立まで最大30秒ポーリング
    Serial.println("[MODEM] Waiting for PDP context activation...");
    unsigned long waitStart = millis();
    while (millis() - waitStart < 30000) {
        delay(3000);
        response = sendATCommand("AT+CNACT?", 5000);
        if (response.indexOf("+CNACT: 0,1") >= 0) {
            int start = response.indexOf("\"") + 1;
            int end = response.indexOf("\"", start);
            if (start > 0 && end > start) {
                modemState.ipAddress = response.substring(start, end);
                if (modemState.ipAddress.length() > 0 && modemState.ipAddress != "0.0.0.0") {
                    Serial.println("[MODEM] IP: " + modemState.ipAddress);
                    // 3GPP標準PDP context も有効化 (CAOPEN/SHCONN に必要)
                    String cgact = sendATCommand("AT+CGACT=1,1", 10000);
                    Serial.printf("[MODEM] CGACT=1,1: '%s'\n", cgact.c_str());
                    String cgactQ = sendATCommand("AT+CGACT?", 3000);
                    Serial.printf("[MODEM] CGACT?: '%s'\n", cgactQ.c_str());
#if !AC_PROTOTYPE_MODE
                    // PSM有効化: ディープスリープ中にSIM7080Gを低消費電力状態へ移行
                    // T3412=20分 (00110100: 1min単位×20), T3324=0秒 (すぐPSMへ)
                    String psmResp = sendATCommand("AT+CPSMS=1,,,\"00110100\",\"00000000\"", 3000);
                    Serial.printf("[MODEM] PSM: '%s'\n", psmResp.c_str());
#endif
                    return true;
                }
            }
        }
        Serial.print(".");
    }

    Serial.println("\n[MODEM] PDP context activation timeout");
    return false;
}

bool syncNTP() {
    sendATCommand("AT+CNTP=\"pool.ntp.org\",36", 3000);
    sendATCommand("AT+CNTP", 30000);
    delay(3000);

    String response = sendATCommand("AT+CCLK?", 3000);
    if (response.indexOf("+CCLK:") >= 0) {
        int start = response.indexOf("\"") + 1;
        int end = response.indexOf("\"", start);
        if (start > 0 && end > start) {
            String timeStr = response.substring(start, end);
            int year = 2000 + timeStr.substring(0, 2).toInt();
            int month = timeStr.substring(3, 5).toInt();
            int day = timeStr.substring(6, 8).toInt();
            int hour = timeStr.substring(9, 11).toInt();
            int minute = timeStr.substring(12, 14).toInt();
            int second = timeStr.substring(15, 17).toInt();

            struct tm timeinfo;
            timeinfo.tm_year = year - 1900;
            timeinfo.tm_mon = month - 1;
            timeinfo.tm_mday = day;
            timeinfo.tm_hour = hour;
            timeinfo.tm_min = minute;
            timeinfo.tm_sec = second;
            timeinfo.tm_isdst = 0;

            time_t t = mktime(&timeinfo);
            struct timeval tv = { .tv_sec = t, .tv_usec = 0 };
            settimeofday(&tv, NULL);
            return true;
        }
    }
    return false;
}

/**
 * 生TCP (AT+CAOPEN) でHTTPリクエストを送信
 */
bool sendRawHTTPTCP(const String& method, const String& path,
                    const String& host, const String& body) {
    // TCP接続 (HTTP port 80)
    sendATCommand("AT+CACLOSE=0", 1000);  // 念のため既存接続をクローズ
    String r = sendATCommand("AT+CAOPEN=0,0,\"TCP\",\"" + host + "\",80", 20000);
    Serial.printf("[TCP] CAOPEN: '%s'\n", r.c_str());
    if (r.indexOf("OK") < 0) {
        return false;
    }
    // +CAOPEN: <clientID>,0 からclientIDを取得 (モデムが割り当て)
    int clientID = 0;
    int idx = r.indexOf("+CAOPEN: ");
    if (idx >= 0) {
        int numStart = idx + 9;
        int comma = r.indexOf(",", numStart);
        if (comma > numStart) clientID = r.substring(numStart, comma).toInt();
    }
    Serial.printf("[TCP] Assigned clientID: %d\n", clientID);
    delay(200);

    // HTTPリクエスト構築 (HTTP/1.1 + keep-alive)
    // HTTP/1.0+Connection:close はサーバーが応答後即FINを送り、
    // +CADATAINDと+CASTATEが同時到着してCARECVが間に合わない問題を回避
    String httpReq = method + " " + path + " HTTP/1.1\r\n";
    httpReq += "Host: " + host + "\r\n";
    httpReq += "Connection: keep-alive\r\n";
    if (body.length() > 0) {
        httpReq += "Content-Type: application/json\r\n";
        httpReq += "Content-Length: " + String(body.length()) + "\r\n";
    }
    httpReq += "\r\n";
    httpReq += body;

    Serial.printf("[TCP] Sending HTTP %s, %d bytes\n", method.c_str(), httpReq.length());

    // CASEND: データ送信 (">" プロンプト後にデータ送信)
    r = sendATCommand("AT+CASEND=" + String(clientID) + "," + String(httpReq.length()), 5000);
    Serial.printf("[TCP] CASEND prompt: '%s'\n", r.c_str());
    modemSerial.print(httpReq);

    // +CADATAIND 受信後すぐにCARECVを呼ぶ (接続がcloseされる前に)
    // sendATCommandはbufferをクリアするのでここでは使わず直接読み書きする
    String sBuf = "";
    String httpResp = "";
    unsigned long t = millis();
    while (millis() - t < 12000) {
        while (modemSerial.available()) sBuf += (char)modemSerial.read();

        if (sBuf.indexOf("+CADATAIND:") >= 0) {
            // AT+CARECV=<clientID>,<datalen> datalen上限=1460
            modemSerial.print("AT+CARECV=" + String(clientID) + ",1460\r\n");
            unsigned long rt = millis();
            while (millis() - rt < 5000) {
                while (modemSerial.available()) httpResp += (char)modemSerial.read();
                if (httpResp.indexOf("ERROR") >= 0 || (httpResp.length() > 6 && httpResp.endsWith("\r\nOK\r\n"))) break;
                delay(10);
            }
            Serial.printf("[TCP] CARECV resp: '%s'\n", httpResp.substring(0, 200).c_str());
            break;
        }
        if (sBuf.indexOf("+CASTATE:") >= 0) {
            Serial.printf("[TCP] State changed (too late): '%s'\n", sBuf.c_str());
            break;
        }
        delay(50);
    }
    Serial.printf("[TCP] sBuf: '%s'\n", sBuf.substring(0, 100).c_str());
    r = httpResp;

    sendATCommand("AT+CACLOSE=" + String(clientID), 3000);

    bool success = r.indexOf(" 200") >= 0 || r.indexOf(" 201") >= 0 || r.indexOf(" 204") >= 0;
    if (success) modemNeedsReset = false;
    return success;
}

/**
 * 全データ（親機+子機）をサーバーに送信
 */
bool sendAllDataToServer() {
    String timestamp = getTimestamp();

    // JSONペイロード構築
    String payload = "{";
    payload += "\"parent_id\":\"" + String(DEVICE_ID) + "\",";
    payload += "\"secret\":\"" + String(DEVICE_SECRET) + "\",";
    payload += "\"timestamp\":\"" + timestamp + "\",";
    payload += "\"boot_count\":" + String(bootCount) + ",";

    // 親機データ
    payload += "\"parent\":{";
    payload += "\"temperature\":" + String(parentData.temperature, 2) + ",";
    payload += "\"humidity\":" + String(parentData.humidity, 2) + ",";
    payload += "\"pressure\":" + String(parentData.pressure, 1) + ",";
    payload += "\"battery\":" + String(parentData.batteryLevel) + ",";
    // VBUS電圧を送信直前に再取得（ディープスリープ復帰直後は0になるため）
    int vbusMvNow = (int)PMU.getVbusVoltage();
    payload += "\"vbus_mv\":" + String(vbusMvNow) + ",";
    payload += "\"signal\":" + String(modemState.signalStrength);
    payload += "},";

    // 子機データ配列
    payload += "\"children\":[";
    bool first = true;
    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        if (cachedChildIds[i] != 0x00000000) {
            if (!first) payload += ",";
            first = false;

            // デバイスIDを8桁16進数文字列に変換
            char hexId[9];
            snprintf(hexId, sizeof(hexId), "%08x", cachedChildIds[i]);

            payload += "{";
            payload += "\"device_id\":\"" + String(hexId) + "\",";
            payload += "\"temperature\":" + String(childDataList[i].temperature, 2) + ",";
            payload += "\"humidity\":" + String(childDataList[i].humidity, 2) + ",";
            payload += "\"pressure\":" + String(childDataList[i].pressure, 1) + ",";
            payload += "\"rssi\":" + String(childDataList[i].rssi) + ",";
            payload += "\"battery\":" + String(childDataList[i].battery) + ",";
            if (childDataList[i].vccMv > 0) {
                payload += "\"voltage\":" + String(childDataList[i].vccMv) + ",";
            }
            payload += "\"received\":" + String(childDataList[i].received ? "true" : "false");
            payload += "}";
        }
    }
    payload += "]";
    payload += "}";

    Serial.println("[HTTP] Payload length: " + String(payload.length()));
    Serial.println("[HTTP] Payload: " + payload);

    // 生TCP HTTP送信 (SHCONN は cid=0 をデフォルト使用で失敗するため回避)
    bool success = sendRawHTTPTCP("POST", String(SERVER_PATH), String(SERVER_HOST), payload);
    if (success) {
        Serial.println("[HTTP] Data sent successfully");
    } else {
        Serial.println("[HTTP] Data send failed");
        modemNeedsReset = true;
    }
    return success;
}

String sendATCommand(const String& cmd, unsigned long timeout) {
    while (modemSerial.available()) modemSerial.read();
    modemSerial.println(cmd);

    String response = "";
    unsigned long startTime = millis();

    while (millis() - startTime < timeout) {
        while (modemSerial.available()) {
            char c = modemSerial.read();
            response += c;
        }
        if (response.indexOf("OK") >= 0 || response.indexOf("ERROR") >= 0 ||
            response.indexOf("+SHREQ:") >= 0 || response.indexOf(">") >= 0 ||
            response.indexOf("+CNTP:") >= 0 || response.indexOf("+SHREAD:") >= 0 ||
            response.indexOf("+APP PDP:") >= 0 ||  // SIM7080G PDP非同期通知
            response.indexOf("+CAURC:") >= 0) {    // TCP/UDP非同期通知
            break;
        }
        delay(10);
    }

    response.trim();
    return response;
}

void goToDeepSleep(uint64_t sleepTimeSec) {
    Serial.flush();
    gpio_hold_en((gpio_num_t)MODEM_PWRKEY_PIN);
    gpio_hold_en((gpio_num_t)TWELITE_WAKE_PIN);  // LOW保持: 親機TWELITEをスリープ中も眠らせる
    gpio_deep_sleep_hold_en();
    esp_sleep_enable_timer_wakeup(sleepTimeSec * 1000000ULL);
    Serial.println("[SLEEP] Entering deep sleep...");
    delay(100);
    esp_deep_sleep_start();
}

bool initPMU() {
    Wire1.begin(PMU_SDA_PIN, PMU_SCL_PIN);
    if (!PMU.begin(Wire1, AXP2101_SLAVE_ADDRESS, PMU_SDA_PIN, PMU_SCL_PIN)) {
        return false;
    }
    // PMU電源レール状態診断
    Serial.printf("[PMU] DC1=%s(%umV) DC2=%s(%umV) DC3=%s(%umV)\n",
        PMU.isEnableDC1()?"ON":"OFF", PMU.getDC1Voltage(),
        PMU.isEnableDC2()?"ON":"OFF", PMU.getDC2Voltage(),
        PMU.isEnableDC3()?"ON":"OFF", PMU.getDC3Voltage());
    Serial.printf("[PMU] ALDO1=%s(%umV) ALDO2=%s(%umV) ALDO3=%s(%umV) ALDO4=%s(%umV)\n",
        PMU.isEnableALDO1()?"ON":"OFF", PMU.getALDO1Voltage(),
        PMU.isEnableALDO2()?"ON":"OFF", PMU.getALDO2Voltage(),
        PMU.isEnableALDO3()?"ON":"OFF", PMU.getALDO3Voltage(),
        PMU.isEnableALDO4()?"ON":"OFF", PMU.getALDO4Voltage());
    Serial.printf("[PMU] BLDO1=%s(%umV) BLDO2=%s(%umV)\n",
        PMU.isEnableBLDO1()?"ON":"OFF", PMU.getBLDO1Voltage(),
        PMU.isEnableBLDO2()?"ON":"OFF", PMU.getBLDO2Voltage());
    // SIM7080G電源を有効化 (DC3 + ALDO4 + BLDO2 全試行)
    PMU.setDC3Voltage(3400);
    PMU.enableDC3();
    PMU.setALDO4Voltage(3300);
    PMU.enableALDO4();
    PMU.setBLDO2Voltage(3300);
    PMU.enableBLDO2();
    delay(500);
    // 有効化後の実際の状態を再確認
    Serial.printf("[PMU] After enable: DC3=%s(%umV) ALDO4=%s(%umV) BLDO2=%s(%umV)\n",
        PMU.isEnableDC3()?"ON":"OFF", PMU.getDC3Voltage(),
        PMU.isEnableALDO4()?"ON":"OFF", PMU.getALDO4Voltage(),
        PMU.isEnableBLDO2()?"ON":"OFF", PMU.getBLDO2Voltage());
    Serial.printf("[PMU] VBUS=%umV BattConn=%d\n",
        PMU.getVbusVoltage(), PMU.isBatteryConnect());
    delay(1500);  // モデム電源安定待ち (合計2秒)
    PMU.disableTSPinMeasure();        // 充電正常動作に必須
    PMU.enableBattDetection();
    PMU.enableBattVoltageMeasure();
    PMU.setLowBatWarnThreshold(BATTERY_LOW_WARN_THRESHOLD);
    PMU.setLowBatShutdownThreshold(BATTERY_LOW_SHUTDOWN_THRESHOLD);
    return true;
}

int getSignalStrength() {
    String response = sendATCommand("AT+CSQ", 2000);
    int idx = response.indexOf("+CSQ:");
    if (idx >= 0) {
        int start = idx + 6;
        int end = response.indexOf(",", start);
        if (end > start) {
            String rssi = response.substring(start, end);
            rssi.trim();
            return rssi.toInt();
        }
    }
    return 0;
}

void printCurrentTime() {
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);
    char buf[64];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S JST", &timeinfo);
    Serial.printf("[TIME] Current: %s\n", buf);
}

String getTimestamp() {
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+09:00", &timeinfo);
    return String(buf);
}

/**
 * 次の定時（10分刻み）までのスリープ時間を計算
 */
uint64_t calculateSleepDuration() {
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);

    int currentMinute = timeinfo.tm_min;
    int currentSecond = timeinfo.tm_sec;

    int nextMinute = ((currentMinute / MEASUREMENT_INTERVAL_MIN) + 1) * MEASUREMENT_INTERVAL_MIN;

    int minutesToSleep = nextMinute - currentMinute;
    if (minutesToSleep <= 0) {
        minutesToSleep += MEASUREMENT_INTERVAL_MIN;
    }

    int secondsToSleep = (minutesToSleep * 60) - currentSecond;

    // 少し早めに起きて処理時間を確保（30秒前）
    secondsToSleep -= 30;
    if (secondsToSleep < 60) {
        secondsToSleep += MEASUREMENT_INTERVAL_MIN * 60;
    }

    // 負値ガード: uint64_tへのキャスト前に最低値を保証
    if (secondsToSleep <= 0) {
        secondsToSleep = MEASUREMENT_INTERVAL_MIN * 60;
    }

    Serial.printf("[SLEEP] Current: %02d:%02d:%02d, Next measurement at XX:%02d:00\n",
                  timeinfo.tm_hour, currentMinute, currentSecond, nextMinute % 60);

    // テストモードの場合は短い間隔
    if (USE_TEST_MODE) {
        return TEST_INTERVAL_SECONDS;
    }

    return (uint64_t)secondsToSleep;
}

/**
 * サーバーから未実行のACコマンドを1件取得
 * GET /api/devices/:deviceId/ac-command?secret=xxx
 * 成功時: {"id":1,"mode":"COOL","tempC":25.0}
 * 未実行なし: {"pending":false}
 */
AcCommandPending fetchPendingAcCommand() {
    AcCommandPending result = {false, 0, AcMode::COOL, 25.0f};

    String path = "/api/devices/" + String(DEVICE_ID) + "/ac-command?secret=" + String(DEVICE_SECRET);

    // TCP接続 (HTTP port 80)
    sendATCommand("AT+CACLOSE=0", 1000);
    String r = sendATCommand("AT+CAOPEN=0,0,\"TCP\",\"" + String(SERVER_HOST) + "\",80", 20000);
    if (r.indexOf("OK") < 0) {
        Serial.println("[AC] CAOPEN failed");
        return result;
    }
    int clientID = 0;
    {
        int idx = r.indexOf("+CAOPEN: ");
        if (idx >= 0) {
            int ns = idx + 9;
            int cm = r.indexOf(",", ns);
            if (cm > ns) clientID = r.substring(ns, cm).toInt();
        }
    }
    delay(200);

    String httpReq = "GET " + path + " HTTP/1.1\r\n";
    httpReq += "Host: " + String(SERVER_HOST) + "\r\n";
    httpReq += "Connection: keep-alive\r\n\r\n";

    r = sendATCommand("AT+CASEND=" + String(clientID) + "," + String(httpReq.length()), 5000);
    modemSerial.print(httpReq);

    // +CADATAIND を待ってからCARECVで受信
    String sBuf = "";
    String httpResp = "";
    unsigned long t = millis();
    while (millis() - t < 10000) {
        while (modemSerial.available()) sBuf += (char)modemSerial.read();
        if (sBuf.indexOf("+CADATAIND:") >= 0) {
            modemSerial.print("AT+CARECV=" + String(clientID) + ",1460\r\n");
            unsigned long rt = millis();
            while (millis() - rt < 5000) {
                while (modemSerial.available()) httpResp += (char)modemSerial.read();
                if (httpResp.endsWith("\r\nOK\r\n") || httpResp.indexOf("ERROR") >= 0) break;
                delay(10);
            }
            break;
        }
        if (sBuf.indexOf("+CASTATE:") >= 0) break;
        delay(50);
    }
    sendATCommand("AT+CACLOSE=" + String(clientID), 3000);

    // HTTP 200以外は無視
    if (httpResp.indexOf(" 200") < 0) return result;

    // JSONボディ抽出 (ヘッダー後の部分)
    int bodyStart = httpResp.indexOf("\r\n\r\n");
    if (bodyStart < 0) return result;
    String body = httpResp.substring(bodyStart + 4);

    // {"pending":false} チェック
    if (body.indexOf("\"pending\":false") >= 0) return result;

    // id
    int idIdx = body.indexOf("\"id\":");
    if (idIdx < 0) return result;
    result.id = body.substring(idIdx + 5).toInt();

    // mode
    int modeIdx = body.indexOf("\"mode\":\"");
    if (modeIdx < 0) return result;
    String modeStr = body.substring(modeIdx + 8, modeIdx + 12);
    if      (modeStr.startsWith("COOL")) result.mode = AcMode::COOL;
    else if (modeStr.startsWith("HEAT")) result.mode = AcMode::HEAT;
    else if (modeStr.startsWith("DRY"))  result.mode = AcMode::DRY;
    else if (modeStr.startsWith("FAN"))  result.mode = AcMode::FAN;
    else if (modeStr.startsWith("OFF"))  result.mode = AcMode::OFF;
    else return result;

    // tempC
    int tempIdx = body.indexOf("\"tempC\":");
    if (tempIdx >= 0) {
        result.tempC = body.substring(tempIdx + 8).toFloat();
    }

    result.found = true;
    return result;
}

/**
 * ACコマンド実行完了をサーバーに通知
 * POST /api/devices/:deviceId/ac-ack
 * Body: {"id":<cmdId>,"secret":"...","status":"done"}
 */
bool ackAcCommand(int cmdId) {
    String path = "/api/devices/" + String(DEVICE_ID) + "/ac-ack";
    String body = "{\"id\":" + String(cmdId) + ",\"secret\":\"" + String(DEVICE_SECRET) + "\",\"status\":\"done\"}";
    bool ok = sendRawHTTPTCP("POST", path, String(SERVER_HOST), body);
    Serial.printf("[AC] ACK cmd %d: %s\n", cmdId, ok ? "OK" : "FAIL");
    return ok;
}
