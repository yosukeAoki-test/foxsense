/**
 * FoxSenseParent - TWELITE DIP MWX親機アプリ v1.0
 *
 * 接続: VCC / GND / RXD(pin7) / TXD(pin8) のみ使用
 *       M1~M3 配線不要 (カスタムアプリのため)
 *
 * 動作フロー:
 *   1. ESP32から起床トリガー [0xA5][0x01][0x01][0x5A] を受信
 *   2. 15秒間、無線で子機に "FSWK" ブロードキャスト (400ms間隔)
 *   3. 子機から "FSDT" パケット受信
 *   4. 17バイトMWXフォーマットでESP32に転送
 *      [0xA5][0x04][ID_4][TEMP_2][HUMID_2][PRES_2][LQI][VCC_2][CHKSUM][0x5A]
 */

#include <TWELITE>
#include <NWK_SIMPLE>

// ===== アプリケーション設定 =====
const uint32_t APP_ID      = 0x67F56A23;  // FoxSense専用 App ID
const uint8_t  CHANNEL     = 18;          // 使用チャンネル
const uint8_t  LID_PARENT  = 0x00;        // 親機論理ID

// ===== タイミング設定 =====
const uint32_t WAKE_BROADCAST_DURATION_MS = 15000;  // 起床ブロードキャスト期間 (ms)
const uint32_t WAKE_BROADCAST_INTERVAL_MS = 400;    // ブロードキャスト送信間隔 (ms)

// ===== シリアル受信バッファ =====
static uint8_t s_rxBuf[8];
static int     s_rxIdx = 0;

// ===== 状態管理 =====
static bool     s_broadcasting      = false;
static uint32_t s_broadcastStartMs  = 0;
static uint32_t s_lastBroadcastMs   = 0;

// ===== 起床ブロードキャスト送信 =====
static void sendWakeBroadcast() {
    if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
        pkt << tx_addr(0xFF)           // 全子機ブロードキャスト
            << tx_retry(0x1)           // 1回リトライ
            << tx_packet_delay(0, 50, 20);
        pack_bytes(pkt.get_payload(), make_pair("FSWK", 4));
        pkt.transmit();
    }
}

// ===== MWXフォーマット17バイトでESP32に送信 =====
// [0xA5][0x04][ID_4][TEMP_2][HUMID_2][PRES_2][LQI][VCC_2][CHKSUM][0x5A]
static void sendToESP32(uint32_t childId, int16_t tempX100, int16_t humidX100,
                         uint16_t presX10, uint8_t lqi, uint16_t vccMv) {
    uint8_t pkt[17];
    pkt[0]  = 0xA5;
    pkt[1]  = 0x04;  // MWX識別バージョン
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
    // チェックサム: bytes[1..14] の XOR
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
        << TWENET::rx_when_idle();  // 受信回路常時オープン

    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(LID_PARENT);  // 0x00 = 親機

    the_twelite.begin();

    Serial << "--- FoxSenseParent v1.0 ---" << mwx::crlf
           << "AppID=0x67F56A23 Ch=" << int(CHANNEL) << mwx::crlf
           << "Waiting for ESP32 trigger [A5 01 01 5A]..." << mwx::crlf;
}

// ===== loop =====
void loop() {
    // ESP32トリガー検出: [0xA5][0x01][0x01][0x5A]
    while (Serial.available()) {
        uint8_t b = (uint8_t)Serial.read();

        // ヘッダー0xA5待ち
        if (s_rxIdx == 0 && b != 0xA5) {
            continue;
        }

        s_rxBuf[s_rxIdx++] = b;

        if (s_rxIdx >= 4) {
            if (s_rxBuf[0] == 0xA5 && s_rxBuf[1] == 0x01 &&
                s_rxBuf[2] == 0x01 && s_rxBuf[3] == 0x5A) {
                // トリガー確認 → ブロードキャスト開始
                s_broadcasting     = true;
                s_broadcastStartMs = millis();
                s_lastBroadcastMs  = 0;
                Serial << "Trigger OK! Broadcasting WAKE for 15s" << mwx::crlf;
            }
            s_rxIdx = 0;
        }
    }

    // 起床ブロードキャスト
    if (s_broadcasting) {
        uint32_t now = millis();

        if (now - s_broadcastStartMs >= WAKE_BROADCAST_DURATION_MS) {
            // 15秒経過 → 終了
            s_broadcasting = false;
            Serial << "Wake broadcast done." << mwx::crlf;
        } else if (now - s_lastBroadcastMs >= WAKE_BROADCAST_INTERVAL_MS) {
            sendWakeBroadcast();
            s_lastBroadcastMs = now;
        }
    }
}

// ===== 子機パケット受信 =====
// 子機送信形式: "FSDT" + tempX100(int16) + humidX100(int16) + presX10(uint16) + vccMv(uint16)
void on_rx_packet(packet_rx& rx, bool_t &handled) {
    auto&& payload = rx.get_payload();

    // 最低12バイト必要: "FSDT"(4) + temp(2) + humid(2) + pres(2) + vcc(2)
    if (payload.size() < 12) return;

    // "FSDT" 識別子確認
    if (payload[0] != 'F' || payload[1] != 'S' ||
        payload[2] != 'D' || payload[3] != 'T') {
        return;
    }

    uint32_t childId   = rx.get_addr_src_long();
    // big-endian 読み出し (expand_bytes の代わりに直接アクセス)
    int16_t  tempX100  = (int16_t)(((uint16_t)payload[4] << 8) | (uint16_t)payload[5]);
    int16_t  humidX100 = (int16_t)(((uint16_t)payload[6] << 8) | (uint16_t)payload[7]);
    uint16_t presX10   = ((uint16_t)payload[8]  << 8) | (uint16_t)payload[9];
    uint16_t vccMv     = ((uint16_t)payload[10] << 8) | (uint16_t)payload[11];
    uint8_t  lqi       = rx.get_lqi();

    Serial << format("RX child 0x%08X T=%d H=%d P=%d VCC=%d LQI=%d",
                     childId, (int)tempX100, (int)humidX100,
                     (int)presX10, (int)vccMv, (int)lqi) << mwx::crlf;

    sendToESP32(childId, tempX100, humidX100, presX10, lqi, vccMv);

    handled = true;
}

/* Copyright (C) 2025 geoAlpine LLC. All Rights Reserved. */
