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
#include "config.h"

// ディープスリープ間隔
#define MEASUREMENT_INTERVAL_MIN 10  // 10分間隔
#define NTP_SYNC_INTERVAL_SEC (24 * 60 * 60)  // 24時間

// 子機データ構造体
struct ChildData {
    uint32_t deviceId;      // 子機ID
    float temperature;      // 温度
    float humidity;         // 湿度
    int8_t rssi;            // 電波強度
    uint8_t battery;        // バッテリーレベル
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

// v2: RTCキャッシュ変数（サーバー設定）
RTC_DATA_ATTR uint32_t cachedParentIdHash = 0;
RTC_DATA_ATTR uint32_t cachedChildIds[MAX_CHILD_DEVICES] = {0};
RTC_DATA_ATTR uint8_t cachedChildLogicalIds[MAX_CHILD_DEVICES] = {0};
RTC_DATA_ATTR uint8_t cachedChildCount = 0;
RTC_DATA_ATTR uint32_t lastConfigFetch = 0;       // 最後に設定取得したブート回数
RTC_DATA_ATTR bool configFetched = false;          // 設定取得済みフラグ

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
HardwareSerial modemSerial(1);   // SIM7080G
HardwareSerial tweliteSerial(2); // TWELITE

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
    int batteryLevel;
} parentData;

// 関数プロトタイプ
bool initModem();
bool powerOnModem();
void powerOffModem();
bool connectNetwork();
bool syncNTP();
bool sendAllDataToServer();
String sendATCommand(const String& cmd, unsigned long timeout = 10000);
void goToDeepSleep(uint64_t sleepTimeSec);
float readBatteryVoltage();
int calculateBatteryLevel(float voltage);
int getSignalStrength();
void printCurrentTime();
String getTimestamp();
uint64_t calculateSleepDuration();

// TWELITE関数
void initTwelite();
void sendWakeSignalV2(uint32_t parentIdHash);
bool collectChildData();
void parseChildPacketV2(uint8_t* buffer, int length);
bool isAllChildDataReceived();

// v2新規関数
uint8_t computeChecksum(uint8_t* buffer, int length);
bool fetchConfigFromServer();
void sendPairingCommand(uint32_t parentIdHash, uint32_t targetChildId, uint8_t logicalId);
bool waitForPairingResponse(uint32_t targetChildId);
bool reportPairingResult(const char* childDeviceIdHex, const char* status);
void executePairingMode();
uint32_t computeParentIdHashLocal(const char* deviceId);

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
    delay(1000);

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
            configFetched = false;  // 電源オン時は設定を再取得
            break;
    }

    // ピン初期化
    pinMode(MODEM_PWRKEY_PIN, OUTPUT);
    pinMode(MODEM_DTR_PIN, OUTPUT);
    digitalWrite(MODEM_PWRKEY_PIN, HIGH);
    digitalWrite(MODEM_DTR_PIN, LOW);

    // BME280初期化（親機センサー）
    Wire.begin(BME280_SDA_PIN, BME280_SCL_PIN);
    bool bmeOk = bme.begin(0x76) || bme.begin(0x77);
    if (!bmeOk) {
        Serial.println("[WARN] BME280 not found on parent");
    } else {
        Serial.println("[OK] BME280 initialized (parent)");
    }

    // バッテリー電圧確認
    pinMode(BATTERY_PIN, INPUT);
    float batteryVoltage = readBatteryVoltage();
    parentData.batteryLevel = calculateBatteryLevel(batteryVoltage);
    Serial.printf("[INFO] Battery: %.2fV (%d%%)\n", batteryVoltage, parentData.batteryLevel);

    // 低バッテリー時は長めにスリープ
    if (parentData.batteryLevel < 10 && parentData.batteryLevel > 0) {
        Serial.println("[WARN] Low battery! Extending sleep duration...");
        goToDeepSleep(MEASUREMENT_INTERVAL_MIN * 60 * 3);
        return;
    }

    // TWELITE初期化
    initTwelite();

    // モデムシリアル初期化
    modemSerial.begin(MODEM_BAUD_RATE, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
    delay(500);

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
                childDataList[i].needsPairing = false;
            }

            sendWakeSignalV2(cachedParentIdHash);

            parentData.temperature = bme.readTemperature();
            parentData.humidity = bme.readHumidity();

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
    hasPendingChildren = false;
    pendingChildCount = 0;

    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        childDataList[i].deviceId = cachedChildIds[i];
        childDataList[i].logicalId = cachedChildLogicalIds[i];
        childDataList[i].received = false;
        childDataList[i].temperature = 0;
        childDataList[i].humidity = 0;
        childDataList[i].needsPairing = false;

        if (cachedChildIds[i] != 0x00000000) {
            activeChildCount++;
        }
    }

    Serial.printf("[TWELITE] Active children: %d\n", activeChildCount);

    // ペアリングモード実行（PENDING子機がある場合）
    if (hasPendingChildren && pendingChildCount > 0) {
        executePairingMode();
    }

    // v2起床信号送信
    Serial.println("\n[TWELITE] Sending v2 wake signal...");
    sendWakeSignalV2(cachedParentIdHash);

    // 親機のセンサーデータ取得
    Serial.println("\n[SENSOR] Reading parent BME280...");
    parentData.temperature = bme.readTemperature();
    parentData.humidity = bme.readHumidity();

    if (isnan(parentData.temperature) || parentData.temperature < -40 || parentData.temperature > 85) {
        Serial.println("[WARN] Invalid parent sensor data");
        parentData.temperature = 0;
        parentData.humidity = 0;
    }

    Serial.printf("  Parent Temp: %.2f C\n", parentData.temperature);
    Serial.printf("  Parent Humidity: %.2f %%\n", parentData.humidity);

    // 子機データ収集（タイムアウトまで待機）
    if (activeChildCount > 0) {
        Serial.println("\n[TWELITE] Collecting data from children (v2)...");
        bool allReceived = collectChildData();

        if (!allReceived) {
            Serial.println("[WARN] Not all children responded");
        }
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

    // モデム電源オフ
    Serial.println("\n[MODEM] Powering off...");
    powerOffModem();

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
    tweliteSerial.begin(TWELITE_BAUD_RATE, SERIAL_8N1, TWELITE_RX_PIN, TWELITE_TX_PIN);
    delay(100);

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
 * v2起床信号送信（parentIdHash入り）
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

            // フッター検出 → パケット解析
            if (b == TWELITE_FOOTER && bufferIndex >= 13) {
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
 * v2子機パケット解析（parentIdHash検証付き）
 * フォーマット: [0xA5][VERSION][CMD_DATA][PARENT_ID_HASH_4bytes][CHILD_ID_4bytes][TEMP_2bytes][HUMID_2bytes][RSSI][BATTERY][CHECKSUM][0x5A]
 * 合計: 19バイト
 */
void parseChildPacketV2(uint8_t* buffer, int length) {
    // v2パケット: 最低19バイト
    if (length >= 19 && buffer[1] == PROTOCOL_VERSION && buffer[2] == TWELITE_CMD_DATA) {
        // チェックサム検証
        uint8_t expectedChecksum = computeChecksum(buffer, length - 2);
        if (buffer[length - 2] != expectedChecksum) {
            Serial.println("[TWELITE] v2 checksum mismatch, ignoring packet");
            return;
        }

        // parentIdHash検証
        uint32_t receivedHash = ((uint32_t)buffer[3] << 24) |
                                ((uint32_t)buffer[4] << 16) |
                                ((uint32_t)buffer[5] << 8) |
                                (uint32_t)buffer[6];

        if (receivedHash != cachedParentIdHash) {
            Serial.printf("[TWELITE] v2 parentIdHash mismatch: received 0x%08X, expected 0x%08X\n",
                          receivedHash, cachedParentIdHash);
            return;
        }

        // 子機ID取得
        uint32_t deviceId = ((uint32_t)buffer[7] << 24) |
                            ((uint32_t)buffer[8] << 16) |
                            ((uint32_t)buffer[9] << 8) |
                            (uint32_t)buffer[10];

        // センサーデータ取得
        int16_t tempRaw = (buffer[11] << 8) | buffer[12];
        float temperature = tempRaw / 100.0;
        int16_t humidRaw = (buffer[13] << 8) | buffer[14];
        float humidity = humidRaw / 100.0;
        int8_t rssi = (int8_t)buffer[15];
        uint8_t battery = buffer[16];

        Serial.printf("[TWELITE] v2 Received from 0x%08X: %.2fC, %.2f%%, RSSI:%d, Bat:%d%%\n",
                      deviceId, temperature, humidity, rssi, battery);

        // 該当する子機データを更新
        for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
            if (childDataList[i].deviceId == deviceId) {
                childDataList[i].temperature = temperature;
                childDataList[i].humidity = humidity;
                childDataList[i].rssi = rssi;
                childDataList[i].battery = battery;
                childDataList[i].received = true;
                childDataList[i].timestamp = millis();
                break;
            }
        }
        return;
    }

    // v1パケット互換（後方互換性）
    if (length >= 12 && buffer[1] == TWELITE_CMD_DATA) {
        uint32_t deviceId = ((uint32_t)buffer[2] << 24) |
                            ((uint32_t)buffer[3] << 16) |
                            ((uint32_t)buffer[4] << 8) |
                            (uint32_t)buffer[5];

        int16_t tempRaw = (buffer[6] << 8) | buffer[7];
        float temperature = tempRaw / 100.0;
        int16_t humidRaw = (buffer[8] << 8) | buffer[9];
        float humidity = humidRaw / 100.0;
        int8_t rssi = (int8_t)buffer[10];
        uint8_t battery = buffer[11];

        Serial.printf("[TWELITE] v1 Received from 0x%08X: %.2fC, %.2f%%, RSSI:%d, Bat:%d%%\n",
                      deviceId, temperature, humidity, rssi, battery);

        for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
            if (childDataList[i].deviceId == deviceId) {
                childDataList[i].temperature = temperature;
                childDataList[i].humidity = humidity;
                childDataList[i].rssi = rssi;
                childDataList[i].battery = battery;
                childDataList[i].received = true;
                childDataList[i].timestamp = millis();
                break;
            }
        }
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

// ===== v2: サーバー設定取得 =====

/**
 * サーバーからデバイス設定を取得（GET /api/devices/config/:deviceId?secret=xxx）
 * レスポンスJSONをパースしてRTCキャッシュに保存
 */
bool fetchConfigFromServer() {
    // HTTP GET リクエスト
    String configPath = String(SERVER_CONFIG_PATH) + DEVICE_ID + "?secret=" + DEVICE_SECRET;
    String url = String("https://") + SERVER_HOST + configPath;

    sendATCommand("AT+SHDISC", 2000);
    delay(500);

    sendATCommand("AT+SHCONF=\"URL\",\"" + url + "\"", 3000);
    sendATCommand("AT+SHCONF=\"BODYLEN\",2048", 2000);
    sendATCommand("AT+SHCONF=\"HEADERLEN\",350", 2000);
    sendATCommand("AT+CSSLCFG=\"sslversion\",0,3", 2000);
    sendATCommand("AT+SHSSL=1,\"\"", 2000);

    String response = sendATCommand("AT+SHCONN", 30000);
    if (response.indexOf("OK") < 0) {
        Serial.println("[CONFIG] Connection failed");
        return false;
    }

    response = sendATCommand("AT+SHSTATE?", 3000);
    if (response.indexOf("+SHSTATE: 1") < 0) {
        sendATCommand("AT+SHDISC", 2000);
        return false;
    }

    sendATCommand("AT+SHCHEAD", 2000);
    sendATCommand("AT+SHAHEAD=\"Accept\",\"application/json\"", 2000);

    // GET リクエスト (method 1 = GET)
    response = sendATCommand("AT+SHREQ=\"" + configPath + "\",1", 60000);

    bool success = false;
    int bodyLen = 0;

    if (response.indexOf("+SHREQ:") >= 0) {
        // レスポンスからステータスコードとボディ長を取得
        int idx = response.indexOf(",");
        if (idx > 0) {
            int idx2 = response.indexOf(",", idx + 1);
            if (idx2 > idx) {
                String statusCode = response.substring(idx + 1, idx2);
                statusCode.trim();
                String bodyLenStr = response.substring(idx2 + 1);
                bodyLenStr.trim();
                bodyLen = bodyLenStr.toInt();
                Serial.printf("[CONFIG] HTTP Status: %s, Body: %d bytes\n", statusCode.c_str(), bodyLen);
                if (statusCode == "200" && bodyLen > 0) {
                    success = true;
                }
            }
        }
    }

    if (success && bodyLen > 0) {
        // ボディ読み取り
        String readCmd = "AT+SHREAD=0," + String(bodyLen);
        response = sendATCommand(readCmd, 10000);

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

    sendATCommand("AT+SHDISC", 2000);
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

    sendATCommand("AT+SHDISC", 2000);
    delay(500);

    String url = String("https://") + SERVER_HOST + pairingPath;
    sendATCommand("AT+SHCONF=\"URL\",\"" + url + "\"", 3000);
    sendATCommand("AT+SHCONF=\"BODYLEN\",1024", 2000);
    sendATCommand("AT+SHCONF=\"HEADERLEN\",350", 2000);
    sendATCommand("AT+CSSLCFG=\"sslversion\",0,3", 2000);
    sendATCommand("AT+SHSSL=1,\"\"", 2000);

    String response = sendATCommand("AT+SHCONN", 30000);
    if (response.indexOf("OK") < 0) {
        return false;
    }

    response = sendATCommand("AT+SHSTATE?", 3000);
    if (response.indexOf("+SHSTATE: 1") < 0) {
        sendATCommand("AT+SHDISC", 2000);
        return false;
    }

    sendATCommand("AT+SHCHEAD", 2000);
    sendATCommand("AT+SHAHEAD=\"Content-Type\",\"application/json\"", 2000);

    sendATCommand("AT+SHBOD=" + String(payload.length()) + ",10000", 3000);
    delay(100);
    modemSerial.print(payload);
    delay(1000);

    response = sendATCommand("AT+SHREQ=\"" + pairingPath + "\",3", 60000);

    bool success = false;
    if (response.indexOf("+SHREQ:") >= 0) {
        int idx = response.indexOf(",");
        if (idx > 0) {
            int idx2 = response.indexOf(",", idx + 1);
            if (idx2 > idx) {
                String statusCode = response.substring(idx + 1, idx2);
                statusCode.trim();
                success = (statusCode == "200");
            }
        }
    }

    sendATCommand("AT+SHDISC", 2000);
    return success;
}

// ===== モデム関連関数 =====

bool powerOnModem() {
    Serial.println("[MODEM] Powering on...");
    digitalWrite(MODEM_PWRKEY_PIN, LOW);
    delay(1000);
    digitalWrite(MODEM_PWRKEY_PIN, HIGH);
    delay(5000);

    for (int i = 0; i < 15; i++) {
        String response = sendATCommand("AT", 1000);
        if (response.indexOf("OK") >= 0) {
            return true;
        }
        delay(1000);
    }
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

    // APN設定はラジオ有効化前に行う（shell参考: at_only_lte_connect.sh）
    String apnCmd = String("AT+CGDCONT=1,\"IP\",\"") + LTE_APN + "\"";
    sendATCommand(apnCmd, 3000);
    // SIM7080G固有: アプリケーション層コンテキストにAPNをマッピング
    String cncfgCmd = String("AT+CNCFG=0,1,\"") + LTE_APN + "\"";
    sendATCommand(cncfgCmd, 3000);

    sendATCommand("AT+CFUN=1", 5000);
    delay(2000);
    // Cat-M1 + NB-IoT 両対応（1=NB-IoTのみ では接続できない場合がある）
    sendATCommand("AT+CMNB=3", 3000);
    sendATCommand("AT+COPS=0", 10000);

    Serial.println("[MODEM] Waiting for network...");
    bool registered = false;
    for (int i = 0; i < 60; i++) {
        response = sendATCommand("AT+CEREG?", 2000);
        if (response.indexOf(",1") >= 0 || response.indexOf(",5") >= 0) {
            registered = true;
            break;
        }
        response = sendATCommand("AT+CGREG?", 2000);
        if (response.indexOf(",1") >= 0 || response.indexOf(",5") >= 0) {
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

    // 既存の接続をクリア
    sendATCommand("AT+CNACT=0,0", 5000);
    delay(1000);

    // PDP Context有効化要求（AT+CNACT=0,1はOKを即返し、接続は非同期で確立）
    String response = sendATCommand("AT+CNACT=0,1", 5000);
    if (response.indexOf("ERROR") >= 0) {
        Serial.println("[MODEM] CNACT activate failed");
        return false;
    }

    // 接続確立まで最大30秒ポーリング（shell参考: AT+CGACT後のAT+CGCONTRDP=1確認）
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
 * 全データ（親機+子機）をサーバーに送信
 */
bool sendAllDataToServer() {
    String timestamp = getTimestamp();

    // JSONペイロード構築
    String payload = "{";
    payload += "\"parent_id\":\"" + String(DEVICE_ID) + "\",";
    payload += "\"timestamp\":\"" + timestamp + "\",";
    payload += "\"boot_count\":" + String(bootCount) + ",";

    // 親機データ
    payload += "\"parent\":{";
    payload += "\"temperature\":" + String(parentData.temperature, 2) + ",";
    payload += "\"humidity\":" + String(parentData.humidity, 2) + ",";
    payload += "\"battery\":" + String(parentData.batteryLevel) + ",";
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
            payload += "\"rssi\":" + String(childDataList[i].rssi) + ",";
            payload += "\"battery\":" + String(childDataList[i].battery) + ",";
            payload += "\"received\":" + String(childDataList[i].received ? "true" : "false");
            payload += "}";
        }
    }
    payload += "]";
    payload += "}";

    Serial.println("[HTTP] Payload length: " + String(payload.length()));
    Serial.println("[HTTP] Payload: " + payload);

    // HTTP送信
    sendATCommand("AT+SHDISC", 2000);
    delay(500);

    String url = String("https://") + SERVER_HOST + SERVER_PATH;
    sendATCommand("AT+SHCONF=\"URL\",\"" + url + "\"", 3000);
    sendATCommand("AT+SHCONF=\"BODYLEN\",2048", 2000);
    sendATCommand("AT+SHCONF=\"HEADERLEN\",350", 2000);
    sendATCommand("AT+CSSLCFG=\"sslversion\",0,3", 2000);
    sendATCommand("AT+SHSSL=1,\"\"", 2000);

    String response = sendATCommand("AT+SHCONN", 30000);
    if (response.indexOf("OK") < 0) {
        return false;
    }

    response = sendATCommand("AT+SHSTATE?", 3000);
    if (response.indexOf("+SHSTATE: 1") < 0) {
        sendATCommand("AT+SHDISC", 2000);
        return false;
    }

    sendATCommand("AT+SHCHEAD", 2000);
    sendATCommand("AT+SHAHEAD=\"Content-Type\",\"application/json\"", 2000);

    sendATCommand("AT+SHBOD=" + String(payload.length()) + ",10000", 3000);
    delay(100);
    modemSerial.print(payload);
    delay(1000);

    response = sendATCommand("AT+SHREQ=\"" + String(SERVER_PATH) + "\",3", 60000);

    bool success = false;
    if (response.indexOf("+SHREQ:") >= 0) {
        int idx = response.indexOf(",");
        if (idx > 0) {
            int idx2 = response.indexOf(",", idx + 1);
            if (idx2 > idx) {
                String statusCode = response.substring(idx + 1, idx2);
                statusCode.trim();
                Serial.println("[HTTP] Status: " + statusCode);
                if (statusCode == "200" || statusCode == "201") {
                    success = true;
                }
            }
        }
    }

    sendATCommand("AT+SHDISC", 2000);
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
            response.indexOf("+APP PDP:") >= 0) {  // SIM7080G PDP非同期通知
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
    gpio_deep_sleep_hold_en();
    esp_sleep_enable_timer_wakeup(sleepTimeSec * 1000000ULL);
    Serial.println("[SLEEP] Entering deep sleep...");
    delay(100);
    esp_deep_sleep_start();
}

float readBatteryVoltage() {
    uint32_t totalVoltage = 0;
    for (int i = 0; i < 16; i++) {
        totalVoltage += analogReadMilliVolts(BATTERY_PIN);
        delay(1);
    }
    float voltage = totalVoltage / 16 / 1000.0;
    return voltage < 0.1 ? 0.0 : voltage;
}

int calculateBatteryLevel(float voltage) {
    if (voltage < 0.1) return 0;
    if (voltage >= BATTERY_FULL_VOLTAGE) return 100;
    if (voltage >= 2.05) return 95;
    if (voltage >= 2.00) return 90;
    if (voltage >= 1.95) return 80;
    if (voltage >= 1.90) return 70;
    if (voltage >= 1.85) return 60;
    if (voltage >= 1.80) return 50;
    if (voltage >= 1.75) return 40;
    if (voltage >= 1.70) return 30;
    if (voltage >= 1.65) return 20;
    if (voltage >= 1.55) return 10;
    if (voltage >= 1.50) return 5;
    return 2;
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
