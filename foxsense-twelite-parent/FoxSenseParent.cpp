/**
 * FoxSenseParent - TWELITE DIP MWX親機アプリ v1.1
 *
 * 接続: VCC(pin28) / GND(pin1) / RXD(pin3) / TXD(pin10) / DIO0(pin23) のみ使用
 *
 * 動作フロー:
 *   1. ESP32から起床トリガー [0xA5][0x01][0x01][0x5A] を受信
 *   2. 15秒間、無線で子機に "FSWK" ブロードキャスト (400ms間隔)
 *   3. 子機から "FSDT" パケット受信
 *   4. 17バイトMWXフォーマットでESP32に転送
 *      [0xA5][0x04][ID_4][TEMP_2][HUMID_2][PRES_2][LQI][VCC_2][CHKSUM][0x5A]
 *
 *   ペアリング:
 *   1. ESP32からペアコマンド [0xA5][0x03][0x10][HASH_4][CHILD_ID_4][LOGICAL_ID][CHKSUM][0x5A] (14バイト)
 *   2. 子機に無線でブロードキャスト (ペイロード: 0xA5 0x10 HASH_4 CHILD_ID_4 LOGICAL_ID)
 *   3. 子機からPair ACK受信 (ペイロード: 0xA5 0x11 HASH_4 CHILD_ID_4 STATUS)
 *   4. [0xA5][0x03][0x11][HASH_4][CHILD_ID_4][STATUS][CHKSUM][0x5A] (14バイト) でESP32に転送
 */

#include <TWELITE>
#include <NWK_SIMPLE>

// ===== アプリケーション設定 =====
const uint32_t APP_ID      = 0x67F56A23;
const uint8_t  CHANNEL     = 18;
const uint8_t  LID_PARENT  = 0x00;

// ===== タイミング設定 =====
const uint32_t WAKE_BROADCAST_DURATION_MS = 15000;
const uint32_t WAKE_BROADCAST_INTERVAL_MS = 400;
const uint32_t PAIR_BROADCAST_INTERVAL_MS = 300;
const int      PAIR_BROADCAST_MAX         = 8;   // 最大ブロードキャスト回数

// ===== スリープ設定 =====
// DIO0 (pin23) = ESP32の TWELITE_WAKE_PIN に配線
// HIGH になったら起床してUARTコマンドを待つ
static const uint8_t WAKE_DIO = 0;  // DIO0

// ===== シリアル受信バッファ =====
static uint8_t s_rxBuf[16];
static int     s_rxIdx     = 0;
static int     s_rxExpected = 0;  // 期待パケット長 (0=未決定)

// ===== 起床ブロードキャスト状態 =====
static bool     s_broadcasting     = false;
static uint32_t s_broadcastStartMs = 0;
static uint32_t s_lastBroadcastMs  = 0;

// ===== ペアリング状態 =====
static bool     s_hasPairCmd           = false;
static uint8_t  s_pairCmd[14];
static int      s_pairBroadcastCount   = 0;
static uint32_t s_lastPairBroadcastMs  = 0;

// ===== 起床ブロードキャスト送信 =====
static void sendWakeBroadcast() {
    if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
        pkt << tx_addr(0xFF)
            << tx_retry(0x1)
            << tx_packet_delay(0, 50, 20);
        pack_bytes(pkt.get_payload(), make_pair("FSWK", 4));
        pkt.transmit();
    }
}

// ===== ペアコマンドを無線ブロードキャスト =====
// ペイロード: [0xA5][0x10][HASH_4][CHILD_ID_4][LOGICAL_ID] = 11バイト
static void sendPairBroadcast() {
    // s_pairCmd: [0xA5][0x03][0x10][HASH_4][CHILD_ID_4][LOGICAL_ID][CHKSUM][0x5A]
    //  index:      0     1     2    3..6    7..10        11          12      13
    if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
        pkt << tx_addr(0xFF)
            << tx_retry(0x2)
            << tx_packet_delay(0, 50, 10);
        pack_bytes(pkt.get_payload(),
            (uint8_t)0xA5, (uint8_t)0x10,
            s_pairCmd[3], s_pairCmd[4], s_pairCmd[5], s_pairCmd[6],   // HASH_4
            s_pairCmd[7], s_pairCmd[8], s_pairCmd[9], s_pairCmd[10],  // CHILD_ID_4
            s_pairCmd[11]                                               // LOGICAL_ID
        );
        pkt.transmit();
    }
}

// ===== Pair ACKをESP32に転送 =====
// フォーマット: [0xA5][0x03][0x11][HASH_4][CHILD_ID_4][STATUS][CHKSUM][0x5A] = 14バイト
static void forwardPairAckToESP32(const uint8_t* payload, int len) {
    // payload: [0xA5][0x11][HASH_4][CHILD_ID_4][STATUS] = 11バイト
    if (len < 11) return;

    uint8_t ack[14];
    ack[0]  = 0xA5;
    ack[1]  = 0x03;   // PROTOCOL_VERSION
    ack[2]  = 0x11;   // CMD_PAIR_ACK
    ack[3]  = payload[2];   // HASH_4
    ack[4]  = payload[3];
    ack[5]  = payload[4];
    ack[6]  = payload[5];
    ack[7]  = payload[6];   // CHILD_ID_4
    ack[8]  = payload[7];
    ack[9]  = payload[8];
    ack[10] = payload[9];
    ack[11] = payload[10];  // STATUS

    uint8_t cs = 0;
    for (int i = 0; i < 12; i++) cs ^= ack[i];
    ack[12] = cs;
    ack[13] = 0x5A;

    for (int i = 0; i < 14; i++) Serial.write(ack[i]);
}

// ===== データパケットをESP32に転送 =====
// [0xA5][0x04][ID_4][TEMP_2][HUMID_2][PRES_2][LQI][VCC_2][CHKSUM][0x5A] = 17バイト
static void sendToESP32(uint32_t childId, int16_t tempX100, int16_t humidX100,
                         uint16_t presX10, uint8_t lqi, uint16_t vccMv) {
    uint8_t pkt[17];
    pkt[0]  = 0xA5;
    pkt[1]  = 0x04;
    pkt[2]  = (childId >> 24) & 0xFF;
    pkt[3]  = (childId >> 16) & 0xFF;
    pkt[4]  = (childId >>  8) & 0xFF;
    pkt[5]  =  childId        & 0xFF;
    pkt[6]  = (uint8_t)((uint16_t)tempX100  >> 8);
    pkt[7]  = (uint8_t)( (uint16_t)tempX100  & 0xFF);
    pkt[8]  = (uint8_t)((uint16_t)humidX100 >> 8);
    pkt[9]  = (uint8_t)( (uint16_t)humidX100 & 0xFF);
    pkt[10] = (uint8_t)(presX10 >> 8);
    pkt[11] = (uint8_t)(presX10  & 0xFF);
    pkt[12] = lqi;
    pkt[13] = (uint8_t)(vccMv >> 8);
    pkt[14] = (uint8_t)(vccMv  & 0xFF);
    uint8_t cs = 0;
    for (int i = 1; i <= 14; i++) cs ^= pkt[i];
    pkt[15] = cs;
    pkt[16] = 0x5A;
    for (int i = 0; i < 17; i++) Serial.write(pkt[i]);
}

// ===== setup =====
void setup() {
    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle();

    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(LID_PARENT);

    the_twelite.begin();

    Serial << "--- FoxSenseParent v1.1 ---" << mwx::crlf
           << "AppID=0x67F56A23 Ch=" << int(CHANNEL) << mwx::crlf
           << "Waiting for ESP32 trigger [A5 01 01 5A]..." << mwx::crlf;
}

// ===== loop =====
void loop() {
    // ESP32コマンド受信
    while (Serial.available()) {
        uint8_t b = (uint8_t)Serial.read();

        if (s_rxIdx == 0) {
            if (b != 0xA5) continue;
            s_rxExpected = 0;
        }

        s_rxBuf[s_rxIdx++] = b;

        // 2バイト目でパケット種別を判定
        if (s_rxIdx == 2) {
            s_rxExpected = (s_rxBuf[1] == 0x01) ? 4 : 14;
        }

        if (s_rxExpected > 0 && s_rxIdx >= s_rxExpected) {
            if (s_rxExpected == 4 &&
                s_rxBuf[0] == 0xA5 && s_rxBuf[1] == 0x01 &&
                s_rxBuf[2] == 0x01 && s_rxBuf[3] == 0x5A) {
                // 起床トリガー
                s_broadcasting     = true;
                s_broadcastStartMs = millis();
                s_lastBroadcastMs  = 0;
                Serial << "Trigger OK! Broadcasting WAKE for 15s" << mwx::crlf;
            } else if (s_rxExpected == 14 &&
                       s_rxBuf[0] == 0xA5 && s_rxBuf[2] == 0x10 && s_rxBuf[13] == 0x5A) {
                // ペアコマンド: チェックサム検証 (XOR bytes[1..11] == s_rxBuf[12])
                uint8_t expectedCS = 0;
                for (int i = 1; i < 12; i++) expectedCS ^= s_rxBuf[i];
                if (s_rxBuf[12] != expectedCS) {
                    Serial << "Pair cmd checksum error, ignored." << mwx::crlf;
                } else {
                    for (int i = 0; i < 14; i++) s_pairCmd[i] = s_rxBuf[i];
                    s_hasPairCmd          = true;
                    s_pairBroadcastCount  = 0;
                    s_lastPairBroadcastMs = 0;
                    Serial << "Pair cmd received, broadcasting to children..." << mwx::crlf;
                }
            }
            s_rxIdx      = 0;
            s_rxExpected = 0;
        }

        if (s_rxIdx >= 16) { s_rxIdx = 0; s_rxExpected = 0; }
    }

    uint32_t now = millis();

    // 起床ブロードキャスト
    if (s_broadcasting) {
        if (now - s_broadcastStartMs >= WAKE_BROADCAST_DURATION_MS) {
            s_broadcasting = false;
            Serial << "Wake broadcast done." << mwx::crlf;
            // ブロードキャスト完了 → DIO0がLOWになるまで待ってスリープ
            // ESP32側がLOWに戻したことを確認してからスリープ
            uint32_t waitStart = millis();
            while (digitalRead(PIN_DIGITAL::DIO0) == HIGH) {
                if (millis() - waitStart > 3000) break;  // 3秒でタイムアウト
            }
            the_twelite.sleep(0, false, false,
                uint32_t(1UL << uint8_t(PIN_DIGITAL::DIO0)));
        } else if (now - s_lastBroadcastMs >= WAKE_BROADCAST_INTERVAL_MS) {
            sendWakeBroadcast();
            s_lastBroadcastMs = now;
        }
    }

    // ペアコマンドブロードキャスト
    if (s_hasPairCmd && s_pairBroadcastCount < PAIR_BROADCAST_MAX) {
        if (now - s_lastPairBroadcastMs >= PAIR_BROADCAST_INTERVAL_MS) {
            sendPairBroadcast();
            s_lastPairBroadcastMs = now;
            s_pairBroadcastCount++;
            if (s_pairBroadcastCount >= PAIR_BROADCAST_MAX) {
                s_hasPairCmd = false;
                Serial << "Pair broadcast done." << mwx::crlf;
            }
        }
    }
}

// ===== 無線受信コールバック =====
void on_rx_packet(packet_rx& rx, bool_t &handled) {
    auto&& payload = rx.get_payload();

    // Pair ACK: [0xA5][0x11][HASH_4][CHILD_ID_4][STATUS] = 11バイト
    if (payload.size() >= 11 && payload[0] == 0xA5 && payload[1] == 0x11) {
        Serial << "Pair ACK received from child!" << mwx::crlf;
        s_hasPairCmd = false;
        uint8_t buf[11];
        for (int i = 0; i < 11; i++) buf[i] = payload[i];
        forwardPairAckToESP32(buf, 11);
        handled = true;
        return;
    }

    // データパケット: "FSDT" + sensor data (12バイト以上)
    if (payload.size() < 12) return;
    if (payload[0] != 'F' || payload[1] != 'S' ||
        payload[2] != 'D' || payload[3] != 'T') return;

    uint32_t childId   = rx.get_addr_src_long();
    int16_t  tempX100  = (int16_t)(((uint16_t)payload[4] << 8) | (uint16_t)payload[5]);
    int16_t  humidX100 = (int16_t)(((uint16_t)payload[6] << 8) | (uint16_t)payload[7]);
    uint16_t presX10   = ((uint16_t)payload[8]  << 8) | (uint16_t)payload[9];
    uint16_t vccMv     = ((uint16_t)payload[10] << 8) | (uint16_t)payload[11];
    uint8_t  lqi       = rx.get_lqi();

    sendToESP32(childId, tempX100, humidX100, presX10, lqi, vccMv);
    handled = true;
}

/* Copyright (C) 2025 geoAlpine LLC. All Rights Reserved. */
