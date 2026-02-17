/**
 * FoxSense 子機ファームウェア (v2: デバイス分離対応)
 * TWELITE DIP + BME280
 *
 * 状態遷移:
 * FACTORY_DEFAULT（未ペアリング）
 *   → ペアリング要求受信 & 自分のデバイスID一致
 * PAIRED（運用中）
 *   → スリープ → 起床信号待ち → 親機IDハッシュ検証
 *   → 一致: BME280データ取得 → データ送信 → スリープ
 *   → 不一致: 無視 → スリープ
 *
 * EEPROM保存データ:
 * [0x00] マジックバイト: 0xF5（設定済み）/ 0xFF（未設定）
 * [0x01-0x04] 親機IDハッシュ（4バイト）
 * [0x05] 自分のLogical ID
 * [0x06] チェックサム
 */

#include <Arduino.h>
#include <Wire.h>
#include <EEPROM.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include "config.h"

// デバイス状態
enum DeviceState {
    STATE_FACTORY_DEFAULT,  // 未ペアリング
    STATE_PAIRED            // 運用中
};

// グローバル変数
Adafruit_BME280 bme;
DeviceState deviceState = STATE_FACTORY_DEFAULT;
uint32_t pairedParentIdHash = 0;    // ペアリング済み親機IDハッシュ
uint8_t myLogicalId = 0;            // 自分の論理ID
uint32_t myDeviceId = 0;            // 自分のデバイスID（TWELITEシリアル下位4バイト）

// 関数プロトタイプ
void loadEepromConfig();
void saveEepromConfig(uint32_t parentIdHash, uint8_t logicalId);
uint8_t computeEepromChecksum();
uint8_t computePacketChecksum(uint8_t* buffer, int length);
uint32_t getDeviceId();
void listenForWakeSignal();
void handleWakeSignal(uint32_t parentIdHash);
void handlePairingRequest(uint8_t* buffer, int length);
void sendDataResponse(uint32_t parentIdHash);
void sendPairingResponse(uint32_t parentIdHash, uint8_t status);
uint8_t readBatteryPercent();
void enterSleep();
int8_t estimateRssi();

/**
 * デバイスID取得（TWELITEシリアル番号下位4バイト）
 * 注意: 実際のTWELITE DIPではSDKのAPIでシリアル番号を取得する
 *       Arduino互換環境ではシミュレーション値を使用
 */
uint32_t getDeviceId() {
    // TWELITE DIP固有のシリアル番号取得
    // 実機では TWELITE SDK の sToCoNet_AppContext.u32SerialNumber を使用
    // Arduino互換環境ではEEPROM等から読み出すか、コンパイル時に設定

    // フォールバック: EEPROM末尾にデバイスIDを保存している想定
    // 実際の運用ではTWELITEの物理シリアル番号を使用する
    uint32_t id = 0;
    // EEPROM[0x10-0x13]にデバイスIDが保存されている想定
    id |= ((uint32_t)EEPROM.read(0x10) << 24);
    id |= ((uint32_t)EEPROM.read(0x11) << 16);
    id |= ((uint32_t)EEPROM.read(0x12) << 8);
    id |= (uint32_t)EEPROM.read(0x13);

    // 全0xFFの場合はMACアドレスベースのIDを生成
    if (id == 0xFFFFFFFF || id == 0x00000000) {
        // ダミーID（実機では使用しない）
        // 実運用ではTWELITEシリアル番号が自動的に使われる
        id = 0xDEADBEEF;
    }

    return id;
}

void setup() {
    Serial.begin(115200);
    delay(100);

    Serial.println("\n[FoxSense Child v2]");

    // LED初期化
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    // BME280初期化
    Wire.begin();
    if (!bme.begin(BME280_I2C_ADDR)) {
        // 代替アドレスも試す
        if (!bme.begin(0x77)) {
            Serial.println("[WARN] BME280 not found");
        }
    }

    // デバイスID取得
    myDeviceId = getDeviceId();
    Serial.print("[INFO] Device ID: 0x");
    Serial.println(myDeviceId, HEX);

    // EEPROM設定読み込み
    loadEepromConfig();

    if (deviceState == STATE_PAIRED) {
        Serial.print("[INFO] Paired with parent hash: 0x");
        Serial.println(pairedParentIdHash, HEX);
        Serial.print("[INFO] Logical ID: ");
        Serial.println(myLogicalId);
    } else {
        Serial.println("[INFO] Factory default - waiting for pairing");
    }
}

void loop() {
    // 受信窓口を開いて起床信号/ペアリング要求を待つ
    listenForWakeSignal();

    // スリープ
    enterSleep();
}

/**
 * EEPROM設定読み込み
 */
void loadEepromConfig() {
    uint8_t magic = EEPROM.read(EEPROM_MAGIC_ADDR);

    if (magic == EEPROM_MAGIC_VALUE) {
        // チェックサム検証
        uint8_t savedChecksum = EEPROM.read(EEPROM_CHECKSUM_ADDR);
        uint8_t calcChecksum = computeEepromChecksum();

        if (savedChecksum == calcChecksum) {
            // 親機IDハッシュ読み込み
            pairedParentIdHash = 0;
            pairedParentIdHash |= ((uint32_t)EEPROM.read(EEPROM_HASH_ADDR) << 24);
            pairedParentIdHash |= ((uint32_t)EEPROM.read(EEPROM_HASH_ADDR + 1) << 16);
            pairedParentIdHash |= ((uint32_t)EEPROM.read(EEPROM_HASH_ADDR + 2) << 8);
            pairedParentIdHash |= (uint32_t)EEPROM.read(EEPROM_HASH_ADDR + 3);

            myLogicalId = EEPROM.read(EEPROM_LOGICAL_ID_ADDR);
            deviceState = STATE_PAIRED;
        } else {
            Serial.println("[WARN] EEPROM checksum mismatch, resetting");
            deviceState = STATE_FACTORY_DEFAULT;
        }
    } else {
        deviceState = STATE_FACTORY_DEFAULT;
    }
}

/**
 * EEPROM設定保存
 */
void saveEepromConfig(uint32_t parentIdHash, uint8_t logicalId) {
    EEPROM.write(EEPROM_MAGIC_ADDR, EEPROM_MAGIC_VALUE);

    // 親機IDハッシュ保存（big-endian）
    EEPROM.write(EEPROM_HASH_ADDR, (parentIdHash >> 24) & 0xFF);
    EEPROM.write(EEPROM_HASH_ADDR + 1, (parentIdHash >> 16) & 0xFF);
    EEPROM.write(EEPROM_HASH_ADDR + 2, (parentIdHash >> 8) & 0xFF);
    EEPROM.write(EEPROM_HASH_ADDR + 3, parentIdHash & 0xFF);

    EEPROM.write(EEPROM_LOGICAL_ID_ADDR, logicalId);

    // チェックサム計算・保存
    uint8_t checksum = computeEepromChecksum();
    EEPROM.write(EEPROM_CHECKSUM_ADDR, checksum);

    pairedParentIdHash = parentIdHash;
    myLogicalId = logicalId;
    deviceState = STATE_PAIRED;

    Serial.print("[EEPROM] Saved parent hash: 0x");
    Serial.println(parentIdHash, HEX);
}

/**
 * EEPROMチェックサム計算
 * MAGIC〜LOGICAL_IDまでのXOR
 */
uint8_t computeEepromChecksum() {
    uint8_t checksum = 0;
    for (int i = EEPROM_MAGIC_ADDR; i <= EEPROM_LOGICAL_ID_ADDR; i++) {
        checksum ^= EEPROM.read(i);
    }
    return checksum;
}

/**
 * パケットチェックサム計算（XOR）
 * buffer[1]からbuffer[length-1]までのXOR
 */
uint8_t computePacketChecksum(uint8_t* buffer, int length) {
    uint8_t checksum = 0;
    for (int i = 1; i < length; i++) {
        checksum ^= buffer[i];
    }
    return checksum;
}

/**
 * 起床信号/ペアリング要求の受信待ち
 */
void listenForWakeSignal() {
    unsigned long startTime = millis();
    uint8_t buffer[32];
    int bufferIndex = 0;
    unsigned long listenTimeout = (deviceState == STATE_FACTORY_DEFAULT)
                                  ? WAKE_LISTEN_TIMEOUT_MS
                                  : LISTEN_DURATION_MS;

    while (millis() - startTime < listenTimeout) {
        while (Serial.available()) {
            uint8_t b = Serial.read();

            // ヘッダー検出
            if (bufferIndex == 0 && b != TWELITE_HEADER) {
                continue;
            }

            buffer[bufferIndex++] = b;

            // フッター検出
            if (b == TWELITE_FOOTER && bufferIndex >= 7) {
                uint8_t version = buffer[1];
                uint8_t cmd = buffer[2];

                if (version == PROTOCOL_VERSION) {
                    switch (cmd) {
                        case TWELITE_CMD_WAKE:
                            // v2起床信号: [0xA5][VER][CMD][HASH_4][TS_4][CHECKSUM][0x5A] = 13 bytes
                            if (bufferIndex >= 13) {
                                // チェックサム検証
                                uint8_t expectedCs = computePacketChecksum(buffer, bufferIndex - 2);
                                if (buffer[bufferIndex - 2] == expectedCs) {
                                    uint32_t parentHash = ((uint32_t)buffer[3] << 24) |
                                                          ((uint32_t)buffer[4] << 16) |
                                                          ((uint32_t)buffer[5] << 8) |
                                                          (uint32_t)buffer[6];
                                    handleWakeSignal(parentHash);
                                    return;  // 処理完了
                                }
                            }
                            break;

                        case TWELITE_CMD_PAIR:
                            // ペアリング要求: [0xA5][VER][CMD][HASH_4][CHILD_ID_4][LOGICAL_ID][CHECKSUM][0x5A] = 14 bytes
                            if (bufferIndex >= 14) {
                                handlePairingRequest(buffer, bufferIndex);
                                return;
                            }
                            break;
                    }
                }

                bufferIndex = 0;  // リセットして次のパケットを待つ
            }

            // バッファオーバーフロー防止
            if (bufferIndex >= sizeof(buffer)) {
                bufferIndex = 0;
            }
        }
        delay(1);
    }
}

/**
 * 起床信号処理
 */
void handleWakeSignal(uint32_t parentIdHash) {
    if (deviceState != STATE_PAIRED) {
        Serial.println("[WAKE] Not paired, ignoring");
        return;
    }

    // 親機IDハッシュ検証
    if (parentIdHash != pairedParentIdHash) {
        Serial.print("[WAKE] Hash mismatch: got 0x");
        Serial.print(parentIdHash, HEX);
        Serial.print(", expected 0x");
        Serial.println(pairedParentIdHash, HEX);
        return;  // 自分の親機ではない → 無視
    }

    Serial.println("[WAKE] Valid wake signal from my parent");
    digitalWrite(LED_PIN, HIGH);

    // BME280データ取得
    delay(SENSOR_WARMUP_MS);
    sendDataResponse(parentIdHash);

    digitalWrite(LED_PIN, LOW);
}

/**
 * ペアリング要求処理
 * フォーマット: [0xA5][VER][CMD_PAIR][PARENT_HASH_4][TARGET_CHILD_ID_4][LOGICAL_ID][CHECKSUM][0x5A]
 */
void handlePairingRequest(uint8_t* buffer, int length) {
    // チェックサム検証
    uint8_t expectedCs = computePacketChecksum(buffer, length - 2);
    if (buffer[length - 2] != expectedCs) {
        Serial.println("[PAIR] Checksum mismatch");
        return;
    }

    // 親機IDハッシュ取得
    uint32_t parentHash = ((uint32_t)buffer[3] << 24) |
                          ((uint32_t)buffer[4] << 16) |
                          ((uint32_t)buffer[5] << 8) |
                          (uint32_t)buffer[6];

    // ターゲット子機ID取得
    uint32_t targetChildId = ((uint32_t)buffer[7] << 24) |
                             ((uint32_t)buffer[8] << 16) |
                             ((uint32_t)buffer[9] << 8) |
                             (uint32_t)buffer[10];

    uint8_t logicalId = buffer[11];

    Serial.print("[PAIR] Request for child 0x");
    Serial.print(targetChildId, HEX);
    Serial.print(", my ID: 0x");
    Serial.println(myDeviceId, HEX);

    // 自分宛てか確認
    if (targetChildId != myDeviceId) {
        Serial.println("[PAIR] Not for me, ignoring");
        return;
    }

    // ペアリング実行: 親機IDハッシュをEEPROMに保存
    Serial.print("[PAIR] Pairing with parent hash: 0x");
    Serial.println(parentHash, HEX);

    saveEepromConfig(parentHash, logicalId);

    // ペアリング応答送信（成功: 0x01）
    sendPairingResponse(parentHash, 0x01);

    Serial.println("[PAIR] Pairing complete!");
}

/**
 * データ応答パケット送信（v2）
 * フォーマット: [0xA5][VER][CMD_DATA][PARENT_HASH_4][CHILD_ID_4][TEMP_2][HUMID_2][RSSI][BATTERY][CHECKSUM][0x5A]
 * 合計: 19バイト
 */
void sendDataResponse(uint32_t parentIdHash) {
    float temperature = bme.readTemperature();
    float humidity = bme.readHumidity();

    // 異常値チェック
    if (isnan(temperature) || temperature < -40 || temperature > 85) {
        temperature = 0;
        humidity = 0;
    }

    int16_t tempRaw = (int16_t)(temperature * 100);
    int16_t humidRaw = (int16_t)(humidity * 100);
    int8_t rssi = estimateRssi();
    uint8_t battery = readBatteryPercent();

    uint8_t packet[19];
    packet[0] = TWELITE_HEADER;
    packet[1] = PROTOCOL_VERSION;
    packet[2] = TWELITE_CMD_DATA;
    // parentIdHash
    packet[3] = (parentIdHash >> 24) & 0xFF;
    packet[4] = (parentIdHash >> 16) & 0xFF;
    packet[5] = (parentIdHash >> 8) & 0xFF;
    packet[6] = parentIdHash & 0xFF;
    // myDeviceId
    packet[7] = (myDeviceId >> 24) & 0xFF;
    packet[8] = (myDeviceId >> 16) & 0xFF;
    packet[9] = (myDeviceId >> 8) & 0xFF;
    packet[10] = myDeviceId & 0xFF;
    // temperature
    packet[11] = (tempRaw >> 8) & 0xFF;
    packet[12] = tempRaw & 0xFF;
    // humidity
    packet[13] = (humidRaw >> 8) & 0xFF;
    packet[14] = humidRaw & 0xFF;
    // rssi & battery
    packet[15] = (uint8_t)rssi;
    packet[16] = battery;
    // checksum
    packet[17] = computePacketChecksum(packet, 17);
    packet[18] = TWELITE_FOOTER;

    Serial.write(packet, 19);

    // デバッグ出力（標準出力と兼用の場合はコメントアウト）
    // Serial.printf("[DATA] Sent: %.2fC, %.2f%%, RSSI:%d, Bat:%d%%\n",
    //              temperature, humidity, rssi, battery);
}

/**
 * ペアリング応答パケット送信
 * フォーマット: [0xA5][VER][CMD_PAIR_ACK][PARENT_HASH_4][CHILD_ID_4][STATUS][CHECKSUM][0x5A]
 * 合計: 14バイト
 */
void sendPairingResponse(uint32_t parentIdHash, uint8_t status) {
    uint8_t packet[14];

    packet[0] = TWELITE_HEADER;
    packet[1] = PROTOCOL_VERSION;
    packet[2] = TWELITE_CMD_PAIR_ACK;
    // parentIdHash
    packet[3] = (parentIdHash >> 24) & 0xFF;
    packet[4] = (parentIdHash >> 16) & 0xFF;
    packet[5] = (parentIdHash >> 8) & 0xFF;
    packet[6] = parentIdHash & 0xFF;
    // myDeviceId
    packet[7] = (myDeviceId >> 24) & 0xFF;
    packet[8] = (myDeviceId >> 16) & 0xFF;
    packet[9] = (myDeviceId >> 8) & 0xFF;
    packet[10] = myDeviceId & 0xFF;
    // status
    packet[11] = status;
    // checksum
    packet[12] = computePacketChecksum(packet, 12);
    packet[13] = TWELITE_FOOTER;

    Serial.write(packet, 14);
}

/**
 * バッテリー残量読み取り（0-100%）
 */
uint8_t readBatteryPercent() {
    int raw = analogRead(BATTERY_PIN);
    // ATmega328P: 10bit ADC, 3.3V reference
    float voltage = raw * 3.3 / 1023.0;
    float mv = voltage * 1000.0;

    if (mv >= BATTERY_FULL_MV) return 100;
    if (mv <= BATTERY_EMPTY_MV) return 0;

    return (uint8_t)(((mv - BATTERY_EMPTY_MV) / (BATTERY_FULL_MV - BATTERY_EMPTY_MV)) * 100);
}

/**
 * RSSI推定（TWELITE DIPでは直接取得が難しい場合がある）
 * 実際のTWELITE SDKではRSSI値が取得可能
 */
int8_t estimateRssi() {
    // TWELITE SDKでは受信パケットのRSSI値が取得可能
    // Arduino互換環境ではダミー値を返す
    return -70;  // デフォルト値（中程度の信号強度）
}

/**
 * 省電力スリープ
 * TWELITE DIPの間欠受信モードを使用
 */
void enterSleep() {
    // TWELITE DIPの省電力モード
    // 実際のTWELITE SDKでは vAHI_UartDisable() + vSleep() を使用
    // Arduino互換環境ではdelayで代替

    // ATmega328Pのパワーダウンモード（Watchdog Timer起床）
    // ライブラリ: avr/sleep.h, avr/wdt.h
    // 簡易実装ではdelayを使用
    delay(SLEEP_DURATION_MS);
}
