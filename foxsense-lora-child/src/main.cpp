/**
 * FoxSense 子機ファームウェア (LoRa版 / 方式B: 子機起点プッシュ)
 * Seeed XIAO ESP32-C3 + E220-900T22S(JP)(LoRa/技適) + FS304-SHT3x(防水温湿度)
 *
 * 電力最適化のため「子機起点プッシュ + deep-sleep」方式:
 *   deep-sleepで20分毎に起床 → 測定 → 親機へDATA送信 → DATA_ACK待ち(リトライ)
 *     → ACK有り: 20分 deep-sleep
 *     → ACK無し: 短いsleep(RESYNC)で親の受信窓を探索(ハント)
 *   deep-sleep中はE220もMode3(深いスリープ2µA)に落とす。
 *
 * 未ペアリング時(commissioning)は短周期でペアリング要求を待ち受ける。
 *
 * 0xA5フレーム・parentIdHash・ペアリング・logicalIDは親機と共通。
 * 永続化(NVS): paired / parentIdHash / logicalId。
 */

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_SHT31.h>
#include "esp_mac.h"
#include "esp_sleep.h"
#include "driver/gpio.h"
#include "config.h"
#include "e220.h"

enum DeviceState { STATE_FACTORY_DEFAULT, STATE_PAIRED };

// グローバル
Adafruit_SHT31 sht = Adafruit_SHT31();
E220 lora(Serial1, LORA_M0_PIN, LORA_M1_PIN, LORA_AUX_PIN);
Preferences prefs;

DeviceState deviceState = STATE_FACTORY_DEFAULT;
uint32_t pairedParentIdHash = 0;
uint8_t  myLogicalId = 0;
RTC_DATA_ATTR uint16_t g_huntCount = 0;   // 連続ハント回数(deep-sleep間保持,ハント上限用)
uint32_t myDeviceId = 0;
bool     shtOk = false;

// プロトタイプ
uint32_t getDeviceId();
void loadConfig();
void saveConfig(uint32_t parentIdHash, uint8_t logicalId);
uint8_t computePacketChecksum(uint8_t* buffer, int length);
bool runPushCycle();
bool waitForDataAck(uint32_t parentIdHash, uint32_t timeoutMs);
bool listenForPairing(uint32_t windowMs);
void handlePairingRequest(uint8_t* buffer, int length);
void buildDataFrame(uint8_t* pkt, uint32_t parentIdHash, float t, float h, uint8_t battery);
void sendPairingResponse(uint32_t parentIdHash, uint8_t status);
bool readSHT3x(float& t, float& h);
uint8_t readBatteryPercent();
void deepSleep(uint32_t sec);
void releaseGpioHolds();

/** デバイスID = ESP32-C3 efuse MAC 下位4バイト（一意・自動採番） */
uint32_t getDeviceId() {
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);
    return ((uint32_t)mac[2] << 24) | ((uint32_t)mac[3] << 16) |
           ((uint32_t)mac[4] << 8)  | (uint32_t)mac[5];
}

void setup() {
    Serial.begin(115200);   // USB CDC (デバッグ)
    delay(50);
    Serial.println("\n[FoxSense LoRa Child / push mode]");

#ifdef BATT_CAL
    // 【電池ADC校正・ログ方式】-DBATT_CAL でビルド時のみ有効。
    // 起動毎にA0を測定しNVS(battcal)へ追記。電源を切替え再投入する度に1件記録。
    // 毎起動で全ログをシリアルにダンプ(後でUSB接続して読める)。
    // 手順: 2.8V →(電源OFF/ON)→ 3.0V →(OFF/ON)→ 3.3V の3回。
    // ※分圧入力(電池+ノード)にその電圧を入れること。本番readBatteryPercintと同じADC経路。
    pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, HIGH);
#ifdef BATT_CAL_CLEAR
    { Preferences pc; pc.begin("battcal", false); pc.clear(); pc.end(); }
    Serial.println("[CAL] === log CLEARED ===");
#endif
    analogReadMilliVolts(BATTERY_PIN); delay(200);        // warm-up + settle
    uint32_t racc = 0;
    for (int i = 0; i < 32; i++) { racc += analogReadMilliVolts(BATTERY_PIN); delay(3); }
    uint32_t raw = racc / 32;

    // 有効な測定(分圧に電圧あり)のみ記録。USB起動等でA0≈0(<300mV)なら記録しない=stale混入防止。
    if (raw > 300) {
        Preferences pc; pc.begin("battcal", false);
        int nlog = pc.getInt("n", 0);
        char ckey[8]; snprintf(ckey, sizeof(ckey), "v%d", nlog);
        pc.putUInt(ckey, raw);
        pc.putInt("n", nlog + 1);
        pc.end();
    }
    // 以降ループで全ログを繰り返し表示(native USBの起動直後取りこぼし対策=いつ接続しても読める)
    while (true) {
        Preferences pr; pr.begin("battcal", true);
        int cnt = pr.getInt("n", 0);
        Serial.printf("\n[CAL] ===== log %d entries (今回の測定 A0=%u mV) =====\n", cnt, raw);
        for (int i = 0; i < cnt; i++) {
            char k[8]; snprintf(k, sizeof(k), "v%d", i);
            uint32_t v = pr.getUInt(k, 0);
            Serial.printf("[CAL] #%d  A0=%u mV  x2=%u mV\n", i, v, v * 2);
        }
        pr.end();
        Serial.println("[CAL] ===== 電源OFF/ONで次の電圧を記録 =====");
        delay(2000);
    }
#endif

    // 前回deep-sleepで保持したM0/M1ホールドを解除（E220再設定のため）
    releaseGpioHolds();

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH);  // XIAO C3 LEDはアクティブLow → HIGH=消灯

    // E220 (Serial1) 初期化（透過モード, 子機はRSSIバイト不要）
    Serial1.begin(LORA_BAUD_RATE, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
    E220Config cfg;
    cfg.address  = LORA_ADDR;
    cfg.sf       = LORA_SF;
    cfg.bw       = LORA_BW;
    cfg.channel  = LORA_CHANNEL;
    cfg.powerDbm = LORA_POWER;
    cfg.rssiByte = false;
    if (lora.begin(cfg)) Serial.println("[OK] E220 init");
    else                 Serial.println("[ERROR] E220 init failed");

    // SHT3x (FS304) I2C初期化。長ケーブル対策で低クロック
    Wire.begin(SHT3X_SDA_PIN, SHT3X_SCL_PIN);
    Wire.setClock(SHT3X_I2C_CLOCK);
    shtOk = sht.begin(SHT3X_I2C_ADDR) || sht.begin(0x45);
    if (!shtOk) Serial.println("[WARN] SHT3x not found");

    myDeviceId = getDeviceId();
    Serial.printf("[INFO] Device ID: 0x%08X\n", myDeviceId);

    loadConfig();

    if (deviceState == STATE_PAIRED) {
        Serial.printf("[INFO] Paired hash:0x%08X LID:%u\n", pairedParentIdHash, myLogicalId);
        // 測定 → 送信 → ACK待ち（リトライ）
        bool acked = runPushCycle();
        // 【ハント上限(電池保護)】ACK有り:通常間隔でsleep+カウンタ解除。
        // ACK無し:MAX_HUNT回まで短sleepでハント(親の窓を掃引)、超えたら通常間隔の
        // 省電力バックオフに落とす。BACKOFF回後にカウンタ解除しハント再挑戦。
        if (acked) {
            g_huntCount = 0;
            deepSleep(SEND_INTERVAL_SEC);
        } else {
            g_huntCount++;
            if (g_huntCount <= MAX_HUNT) {
                deepSleep(RESYNC_INTERVAL_SEC);               // ハント継続(短sleep)
            } else {
                if (g_huntCount >= MAX_HUNT + HUNT_BACKOFF_CYCLES) g_huntCount = 0;
                Serial.printf("[HUNT] cap reached -> backoff sleep (n=%u)\n", g_huntCount);
                deepSleep(SEND_INTERVAL_SEC);                 // 省電力バックオフ(通常間隔)
            }
        }
    } else {
        Serial.println("[INFO] Factory default - listening for pairing");
        bool paired = listenForPairing(FACTORY_LISTEN_MS);
        deepSleep(paired ? SEND_INTERVAL_SEC : FACTORY_SLEEP_SEC);
    }
}

void loop() { /* deep-sleep方式のため未使用 */ }

/** NVSから設定読み込み */
void loadConfig() {
    prefs.begin(NVS_NAMESPACE, true);
    bool paired = prefs.getBool("paired", false);
    if (paired) {
        pairedParentIdHash = prefs.getUInt("hash", 0);
        myLogicalId        = (uint8_t)prefs.getUChar("lid", 0);
        deviceState = (pairedParentIdHash != 0) ? STATE_PAIRED : STATE_FACTORY_DEFAULT;
    } else {
        deviceState = STATE_FACTORY_DEFAULT;
    }
    prefs.end();
}

/** NVSへ設定保存 */
void saveConfig(uint32_t parentIdHash, uint8_t logicalId) {
    prefs.begin(NVS_NAMESPACE, false);
    prefs.putBool("paired", true);
    prefs.putUInt("hash", parentIdHash);
    prefs.putUChar("lid", logicalId);
    prefs.end();

    pairedParentIdHash = parentIdHash;
    myLogicalId = logicalId;
    deviceState = STATE_PAIRED;
    Serial.printf("[NVS] Saved parent hash: 0x%08X\n", parentIdHash);
}

/** パケットチェックサム: buffer[1..length-1] のXOR（親機と共通） */
uint8_t computePacketChecksum(uint8_t* buffer, int length) {
    uint8_t checksum = 0;
    for (int i = 1; i < length; i++) checksum ^= buffer[i];
    return checksum;
}

/**
 * 送信サイクル: 測定→DATA送信→DATA_ACK待ち。ACK取れるまでリトライ。
 * 戻り値: true=ACK受信(親機が受信窓を開いていた), false=未ACK(ハントへ)
 */
bool runPushCycle() {
    float t = 0, h = 0;
    readSHT3x(t, h);
    uint8_t battery = readBatteryPercent();

    uint8_t pkt[21];
    buildDataFrame(pkt, pairedParentIdHash, t, h, battery);  // フレームは1度だけ作り再送する

    digitalWrite(LED_PIN, LOW);   // 送信中は点灯
    bool acked = false;
    for (int attempt = 0; attempt < TX_RETRY; attempt++) {
        lora.send(pkt, 21);
        Serial.printf("[DATA] tx %.2fC %.2f%% bat:%u%% (try %d)\n", t, h, battery, attempt + 1);
        if (waitForDataAck(pairedParentIdHash, ACK_WAIT_MS)) { acked = true; break; }
        // 衝突回避のバックオフ（logicalIDでずらす）
        delay(TDMA_BACKOFF_MS + (uint32_t)myLogicalId * TDMA_BACKOFF_MS);
    }
    digitalWrite(LED_PIN, HIGH);
    Serial.println(acked ? "[DATA] ACK received" : "[DATA] no ACK (will resync)");
    return acked;
}

/** DATA_ACK待ち: [A5][VER][0x12][HASH_4][CHILD_ID_4][STATUS][CS][5A] */
bool waitForDataAck(uint32_t parentIdHash, uint32_t timeoutMs) {
    uint8_t buf[64];
    uint32_t t0 = millis();
    while (millis() - t0 < timeoutMs) {
        int n = lora.recv(buf, sizeof(buf), nullptr, 300);
        if (n < 14 || buf[0] != TWELITE_HEADER) continue;
        if (buf[1] != PROTOCOL_VERSION || buf[2] != TWELITE_CMD_DATA_ACK) continue;
        if (buf[n - 2] != computePacketChecksum(buf, n - 2)) continue;
        uint32_t hash = ((uint32_t)buf[3] << 24) | ((uint32_t)buf[4] << 16) |
                        ((uint32_t)buf[5] << 8)  | (uint32_t)buf[6];
        uint32_t cid  = ((uint32_t)buf[7] << 24) | ((uint32_t)buf[8] << 16) |
                        ((uint32_t)buf[9] << 8)  | (uint32_t)buf[10];
        if (hash == parentIdHash && cid == myDeviceId && buf[11] == 0x01) return true;
    }
    return false;
}

/** 未ペアリング時: ペアリング要求を受信窓で待つ。ペア成立でtrue */
bool listenForPairing(uint32_t windowMs) {
    uint8_t buf[64];
    uint32_t t0 = millis();
    while (millis() - t0 < windowMs) {
        int n = lora.recv(buf, sizeof(buf), nullptr, 300);
        if (n < 14 || buf[0] != TWELITE_HEADER) continue;
        if (buf[1] != PROTOCOL_VERSION || buf[2] != TWELITE_CMD_PAIR) continue;
        handlePairingRequest(buf, n);
        if (deviceState == STATE_PAIRED) return true;
    }
    return false;
}

/** ペアリング要求処理 */
void handlePairingRequest(uint8_t* buffer, int length) {
    if (buffer[length - 2] != computePacketChecksum(buffer, length - 2)) {
        Serial.println("[PAIR] Checksum mismatch");
        return;
    }
    uint32_t parentHash = ((uint32_t)buffer[3] << 24) | ((uint32_t)buffer[4] << 16) |
                          ((uint32_t)buffer[5] << 8)  | (uint32_t)buffer[6];
    uint32_t targetChildId = ((uint32_t)buffer[7] << 24) | ((uint32_t)buffer[8] << 16) |
                             ((uint32_t)buffer[9] << 8)  | (uint32_t)buffer[10];
    uint8_t logicalId = buffer[11];

    Serial.printf("[PAIR] Request for 0x%08X (me: 0x%08X)\n", targetChildId, myDeviceId);
    if (targetChildId != myDeviceId) return;

    saveConfig(parentHash, logicalId);
    delay(TDMA_BACKOFF_MS + (uint32_t)logicalId * TDMA_BACKOFF_MS);
    sendPairingResponse(parentHash, 0x01);
    Serial.println("[PAIR] Pairing complete!");
}

/**
 * v3データフレーム組み立て（SHT3xで温湿度、気圧=0）
 * [A5][03][02][HASH_4][ID_4][TEMP_2][HUMID_2][PRES_2=0][RSSI=0][BAT][CHKSUM][5A] = 21B
 */
void buildDataFrame(uint8_t* pkt, uint32_t parentIdHash, float t, float h, uint8_t battery) {
    int16_t  tempRaw  = (int16_t)(t * 100);
    int16_t  humidRaw = (int16_t)(h * 100);
    uint16_t presRaw  = 0;                 // FS304は気圧なし

    pkt[0]  = TWELITE_HEADER;
    pkt[1]  = PROTOCOL_VERSION;            // 0x03
    pkt[2]  = TWELITE_CMD_DATA;
    pkt[3]  = (parentIdHash >> 24) & 0xFF;
    pkt[4]  = (parentIdHash >> 16) & 0xFF;
    pkt[5]  = (parentIdHash >> 8)  & 0xFF;
    pkt[6]  = parentIdHash & 0xFF;
    pkt[7]  = (myDeviceId >> 24) & 0xFF;
    pkt[8]  = (myDeviceId >> 16) & 0xFF;
    pkt[9]  = (myDeviceId >> 8)  & 0xFF;
    pkt[10] = myDeviceId & 0xFF;
    pkt[11] = (tempRaw >> 8)  & 0xFF;
    pkt[12] = tempRaw & 0xFF;
    pkt[13] = (humidRaw >> 8) & 0xFF;
    pkt[14] = humidRaw & 0xFF;
    pkt[15] = (presRaw >> 8)  & 0xFF;
    pkt[16] = presRaw & 0xFF;
    pkt[17] = 0;                           // RSSIは親機側でE220から取得
    pkt[18] = battery;
    pkt[19] = computePacketChecksum(pkt, 19);
    pkt[20] = TWELITE_FOOTER;
}

/** ペアリング応答送信: [A5][03][11][HASH_4][ID_4][STATUS][CS][5A] = 14B */
void sendPairingResponse(uint32_t parentIdHash, uint8_t status) {
    uint8_t packet[14];
    packet[0] = TWELITE_HEADER;
    packet[1] = PROTOCOL_VERSION;
    packet[2] = TWELITE_CMD_PAIR_ACK;
    packet[3] = (parentIdHash >> 24) & 0xFF;
    packet[4] = (parentIdHash >> 16) & 0xFF;
    packet[5] = (parentIdHash >> 8) & 0xFF;
    packet[6] = parentIdHash & 0xFF;
    packet[7] = (myDeviceId >> 24) & 0xFF;
    packet[8] = (myDeviceId >> 16) & 0xFF;
    packet[9] = (myDeviceId >> 8) & 0xFF;
    packet[10] = myDeviceId & 0xFF;
    packet[11] = status;
    packet[12] = computePacketChecksum(packet, 12);
    packet[13] = TWELITE_FOOTER;
    lora.send(packet, 14);
}

/** SHT3xを3回測定し中央値を採用（外れ値排除） */
bool readSHT3x(float& t, float& h) {
    if (!shtOk) { t = 0; h = 0; return false; }
    delay(SENSOR_WARMUP_MS);
    float temps[3], humids[3];
    int valid = 0;
    for (int i = 0; i < 3; i++) {
        float tt = sht.readTemperature();
        float hh = sht.readHumidity();
        if (!isnan(tt) && tt >= -40 && tt <= 125 &&
            !isnan(hh) && hh >= 0   && hh <= 100) {
            int j = valid - 1;
            while (j >= 0 && temps[j] > tt) { temps[j+1]=temps[j]; humids[j+1]=humids[j]; j--; }
            temps[j+1] = tt; humids[j+1] = hh; valid++;
        }
        if (i < 2) delay(50);
    }
    if (valid == 0) { t = 0; h = 0; return false; }
    int mid = valid / 2;
    t = temps[mid]; h = humids[mid];
    return true;
}

/** バッテリー残量(0-100%)。分圧回路の係数は要調整 */
uint8_t readBatteryPercent() {
    // 電池側(TPS63020入力)を 470k:470k=2:1 で分圧しGPIO2で測定。
    // 高インピーダンス分圧(テブナン235k)のため A0-GND間に100nF必須。
    // ADCのS&H充電を安定させるため 捨て読み＋settle＋平均 で読む。
    analogReadMilliVolts(BATTERY_PIN);           // 捨て読み(S&H充電)
    delay(5);
    uint32_t sum = 0;
    for (int i = 0; i < 8; i++) { sum += analogReadMilliVolts(BATTERY_PIN); delay(2); }
    // 2:1分圧 → ×2で電池電圧復元。3点校正(2.8/3.0/3.3V)で全域-65mV(ゲイン≒1.0の
    // ほぼ純オフセット=ADCオフセット)と判明→ +65mVで補正(残差±3mV)。※個体校正値。
    uint32_t mv = (sum / 8) * 2 + BATTERY_CAL_OFFSET_MV;
    if (mv >= BATTERY_FULL_MV)  return 100;
    if (mv <= BATTERY_EMPTY_MV) return 0;
    return (uint8_t)(((mv - BATTERY_EMPTY_MV) * 100) / (BATTERY_FULL_MV - BATTERY_EMPTY_MV));
}

/** deep-sleep前にホールドしたGPIOを解除（起床後の再設定用） */
void releaseGpioHolds() {
    gpio_hold_dis((gpio_num_t)LORA_M0_PIN);
    gpio_hold_dis((gpio_num_t)LORA_M1_PIN);
    gpio_deep_sleep_hold_dis();
}

/**
 * deep-sleep: E220をMode3(深いスリープ2µA)に固定してからC3をdeep-sleep。
 * M0=M1=HIGHをホールドしてsleep中も保持する。
 */
void deepSleep(uint32_t sec) {
    Serial.printf("[SLEEP] deep sleep %u s\n", sec);
    Serial.flush();
    pinMode(LORA_M0_PIN, OUTPUT); digitalWrite(LORA_M0_PIN, HIGH);
    pinMode(LORA_M1_PIN, OUTPUT); digitalWrite(LORA_M1_PIN, HIGH);
    gpio_hold_en((gpio_num_t)LORA_M0_PIN);
    gpio_hold_en((gpio_num_t)LORA_M1_PIN);
    gpio_deep_sleep_hold_en();
    esp_sleep_enable_timer_wakeup((uint64_t)sec * 1000000ULL);
    esp_deep_sleep_start();
}
