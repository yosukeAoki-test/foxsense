/**
 * FoxSense One - 親機ファームウェア
 * LILYGO T-SIM7080G-S3 + TWELITE DIP（親機）+ BME280
 *
 * システム構成:
 * - 親機: ESP32-S3 + SIM7080G(LTE) + TWELITE DIP + BME280
 * - 子機: TWELITE DIP + BME280（複数台）
 *
 * 動作フロー:
 * 1. 10分毎にディープスリープから起床
 * 2. TWELITE経由で子機に起床信号を送信
 * 3. 自身のBME280データを取得
 * 4. 全子機からのデータ受信を待機
 * 5. 全データ揃ったらLTEでサーバー送信
 * 6. ディープスリープへ
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

// TWELITEプロトコル定義
#define TWELITE_CMD_WAKE    0x01    // 起床コマンド
#define TWELITE_CMD_DATA    0x02    // データ応答
#define TWELITE_CMD_ACK     0x03    // 確認応答
#define TWELITE_HEADER      0xA5    // パケットヘッダー
#define TWELITE_FOOTER      0x5A    // パケットフッター

// 子機データ構造体
struct ChildData {
    uint32_t deviceId;      // 子機ID
    float temperature;      // 温度
    float humidity;         // 湿度
    int8_t rssi;            // 電波強度
    uint8_t battery;        // バッテリーレベル
    bool received;          // データ受信済みフラグ
    unsigned long timestamp;// 受信時刻
};

// RTCメモリに保存するデータ（ディープスリープ後も保持）
RTC_DATA_ATTR uint32_t bootCount = 0;
RTC_DATA_ATTR time_t lastNtpSyncTime = 0;
RTC_DATA_ATTR bool ntpSynced = false;
RTC_DATA_ATTR int consecutiveFailures = 0;

// 登録済み子機リスト
const uint32_t registeredChildren[MAX_CHILD_DEVICES] = {
    CHILD_ID_1, CHILD_ID_2, CHILD_ID_3, CHILD_ID_4,
    CHILD_ID_5, CHILD_ID_6, CHILD_ID_7, CHILD_ID_8
};

// 子機データ配列
ChildData childDataList[MAX_CHILD_DEVICES];
int activeChildCount = 0;

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
void sendWakeSignal();
bool collectChildData();
void parseChildPacket(uint8_t* buffer, int length);
bool isAllChildDataReceived();
int countActiveChildren();

void setup() {
    // シリアル初期化
    Serial.begin(115200);
    delay(1000);

    bootCount++;

    Serial.println("\n=============================================");
    Serial.println("  FoxSense One - Parent Node");
    Serial.println("  LILYGO T-SIM7080G-S3 + TWELITE");
    Serial.println("=============================================");
    Serial.printf("Boot count: %d\n", bootCount);
    Serial.printf("Device ID: %s (Parent)\n", DEVICE_ID);

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
            break;
    }

    // 子機データ初期化
    activeChildCount = countActiveChildren();
    Serial.printf("[TWELITE] Active children: %d\n", activeChildCount);

    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        childDataList[i].deviceId = registeredChildren[i];
        childDataList[i].received = false;
        childDataList[i].temperature = 0;
        childDataList[i].humidity = 0;
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

    // 子機に起床信号送信
    Serial.println("\n[TWELITE] Sending wake signal to children...");
    sendWakeSignal();

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
        Serial.println("\n[TWELITE] Collecting data from children...");
        bool allReceived = collectChildData();

        if (!allReceived) {
            Serial.println("[WARN] Not all children responded");
        }
    }

    // モデムシリアル初期化
    modemSerial.begin(MODEM_BAUD_RATE, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
    delay(500);

    // モデム初期化
    Serial.println("\n[MODEM] Initializing...");
    if (!initModem()) {
        Serial.println("[ERROR] Modem init failed");
        consecutiveFailures++;
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
    Serial.printf("\n[SLEEP] Going to deep sleep for %llu seconds (next: XX:%02d:00)...\n",
                  sleepDuration, (int)((sleepDuration / 60 + (millis() / 1000 / 60)) % 60));
    goToDeepSleep(sleepDuration);
}

void loop() {
    // ディープスリープ使用時はloop()は実行されない
}

// ===== TWELITE関連関数 =====

/**
 * アクティブな子機数をカウント
 */
int countActiveChildren() {
    int count = 0;
    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        if (registeredChildren[i] != 0x00000000) {
            count++;
        }
    }
    return count;
}

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
 * 子機に起床信号を送信
 */
void sendWakeSignal() {
    // TWELITEパケット構築
    // フォーマット: [HEADER][CMD][TIMESTAMP_4bytes][FOOTER]
    uint8_t packet[8];
    uint32_t ts = millis();

    packet[0] = TWELITE_HEADER;
    packet[1] = TWELITE_CMD_WAKE;
    packet[2] = (ts >> 24) & 0xFF;
    packet[3] = (ts >> 16) & 0xFF;
    packet[4] = (ts >> 8) & 0xFF;
    packet[5] = ts & 0xFF;
    packet[6] = TWELITE_FOOTER;

    // 複数回送信（確実性のため）
    for (int i = 0; i < 3; i++) {
        tweliteSerial.write(packet, 7);
        delay(WAKE_SIGNAL_INTERVAL);
    }

    Serial.printf("[TWELITE] Wake signal sent (timestamp: %lu)\n", ts);
}

/**
 * 子機からデータを収集
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
            if (b == TWELITE_FOOTER && bufferIndex >= 15) {
                parseChildPacket(buffer, bufferIndex);
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
 * 子機パケット解析
 * フォーマット: [HEADER][CMD][DEVICE_ID_4bytes][TEMP_2bytes][HUMID_2bytes][RSSI][BATTERY][FOOTER]
 */
void parseChildPacket(uint8_t* buffer, int length) {
    if (length < 15 || buffer[0] != TWELITE_HEADER || buffer[1] != TWELITE_CMD_DATA) {
        return;
    }

    // デバイスID取得
    uint32_t deviceId = ((uint32_t)buffer[2] << 24) |
                        ((uint32_t)buffer[3] << 16) |
                        ((uint32_t)buffer[4] << 8) |
                        (uint32_t)buffer[5];

    // 温度（x100で整数化されている）
    int16_t tempRaw = (buffer[6] << 8) | buffer[7];
    float temperature = tempRaw / 100.0;

    // 湿度（x100で整数化されている）
    int16_t humidRaw = (buffer[8] << 8) | buffer[9];
    float humidity = humidRaw / 100.0;

    int8_t rssi = (int8_t)buffer[10];
    uint8_t battery = buffer[11];

    Serial.printf("[TWELITE] Received from 0x%08X: %.2fC, %.2f%%, RSSI:%d, Bat:%d%%\n",
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
}

/**
 * 全子機からデータ受信済みかチェック
 */
bool isAllChildDataReceived() {
    for (int i = 0; i < MAX_CHILD_DEVICES; i++) {
        if (registeredChildren[i] != 0x00000000 && !childDataList[i].received) {
            return false;
        }
    }
    return true;
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

    String response = sendATCommand("AT+CPIN?", 5000);
    if (response.indexOf("READY") < 0) {
        Serial.println("[MODEM] SIM not ready");
        return false;
    }
    Serial.println("[MODEM] SIM ready");

    sendATCommand("AT+CFUN=1", 5000);
    delay(2000);
    sendATCommand("AT+CMNB=1", 3000);
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
    sendATCommand("AT+CNACT=0,0", 3000);
    delay(1000);

    String apnCmd = String("AT+CGDCONT=1,\"IP\",\"") + LTE_APN + "\"";
    sendATCommand(apnCmd, 3000);

    sendATCommand("AT+CNACT=0,1", 30000);
    delay(2000);

    String response = sendATCommand("AT+CNACT?", 5000);
    if (response.indexOf("+CNACT: 0,1") >= 0) {
        int start = response.indexOf("\"") + 1;
        int end = response.indexOf("\"", start);
        if (start > 0 && end > start) {
            modemState.ipAddress = response.substring(start, end);
            Serial.println("[MODEM] IP: " + modemState.ipAddress);
        }
        return true;
    }
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
        if (registeredChildren[i] != 0x00000000) {
            if (!first) payload += ",";
            first = false;

            payload += "{";
            payload += "\"device_id\":\"" + String(registeredChildren[i], HEX) + "\",";
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
            response.indexOf("+CNTP:") >= 0) {
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
 * 例: 現在10:03 → 次は10:10 → 7分後
 *     現在10:10 → 次は10:20 → 10分後
 */
uint64_t calculateSleepDuration() {
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);

    int currentMinute = timeinfo.tm_min;
    int currentSecond = timeinfo.tm_sec;

    // 次の10分刻みの分を計算
    int nextMinute = ((currentMinute / MEASUREMENT_INTERVAL_MIN) + 1) * MEASUREMENT_INTERVAL_MIN;

    // 次の定時までの秒数を計算
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

    Serial.printf("[SLEEP] Current: %02d:%02d:%02d, Next measurement at XX:%02d:00\n",
                  timeinfo.tm_hour, currentMinute, currentSecond, nextMinute % 60);

    // テストモードの場合は短い間隔
    if (USE_TEST_MODE) {
        return TEST_INTERVAL_SECONDS;
    }

    return (uint64_t)secondsToSleep;
}
