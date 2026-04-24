/**
 * FoxSenseChild - TWELITE DIP MWX子機アプリ v1.2
 *
 * 配線:
 *   TWELITE DIP          AHT21B
 *   VCC  (pin 28) ────── VCC
 *   GND  (pin  1) ────── GND
 *   DIO15 (pin 19) ────── SDA   ← I2C SDA (MWX Wire固定)
 *   DIO14 (pin  2) ────── SCL   ← I2C SCL (MWX Wire固定)
 *                        (I2C addr: 0x38 固定)
 *
 * 動作フロー:
 *   1. スリープ → 起床 → 200ms 受信待機
 *   2. 親機から "FSWK" 受信 → AHT21B 測定開始
 *   3. 変換完了 (80ms) → "FSDT" パケットを親機へ送信
 *   4. 送信完了 → スリープに戻る
 *
 *   ペアリング:
 *   1. 親機からペアパケット受信 (ペイロード: 0xA5 0x10 HASH_4 CHILD_ID_4 LOGICAL_ID)
 *   2. CHILD_ID_4 が自分のHW IDと一致するか確認
 *   3. 一致したらPair ACKを親機へ送信 (ペイロード: 0xA5 0x11 HASH_4 MY_ID_4 0x01)
 *
 * 送信ペイロード (データ):
 *   "FSDT" (4B) | tempX100 (uint16) | humidX100 (uint16)
 *   | presX10 (uint16=0) | vccMv (uint16)  計12バイト
 */

#include <TWELITE>
#include <NWK_SIMPLE>
#include <SM_SIMPLE>

// ===== アプリケーション設定 =====
const uint32_t APP_ID    = 0x67F56A23;
const uint8_t  CHANNEL   = 18;
const uint8_t  LID_CHILD = 0xFE;

// ===== タイミング設定 =====
const uint32_t LISTEN_WINDOW_MS  = 200;
const uint32_t SLEEP_DURATION_MS = 14800;  // 親機の15秒ブロードキャスト窓に合わせた最大値
const uint32_t AHT21B_CONV_MS   = 80;
const uint32_t TX_TIMEOUT_MS     = 300;

// ===== AHT21B =====
const uint8_t AHT21B_ADDR = 0x38;

static bool s_aht_initialized = false;

// ===== 状態機械 =====
enum class STATE : uint8_t {
    LISTEN = 0,
    SENSOR_START,
    SENSOR_WAIT,
    TX,
    TX_WAIT,
    PAIR_ACK_TX,
    GO_SLEEP,
};
SM_SIMPLE<STATE> step;

// ===== 共有変数 =====
static bool     s_triggered       = false;
static uint32_t s_wakeTime        = 0;
static uint16_t s_tempX100        = 0;
static uint16_t s_humidX100       = 0;
static uint16_t s_presX10         = 0;
static uint16_t s_vccMv           = 3300;

// ペアリング
static bool     s_pair_requested  = false;
static uint32_t s_pair_hash       = 0;

// ===== AHT21B 初期化 =====
static bool aht_init() {
    if (auto&& wrt = Wire.get_writer(AHT21B_ADDR)) {
        wrt << (uint8_t)0xBE << (uint8_t)0x08 << (uint8_t)0x00;
    } else {
        Serial << "AHT21B init failed!" << mwx::crlf;
        return false;
    }
    delay(10);
    s_aht_initialized = true;
    return true;
}

// ===== AHT21B 測定トリガー =====
static void aht_trigger() {
    if (auto&& wrt = Wire.get_writer(AHT21B_ADDR)) {
        wrt << (uint8_t)0xAC << (uint8_t)0x33 << (uint8_t)0x00;
    }
}

// ===== AHT21B データ読み出し =====
static bool aht_read_data() {
    uint8_t d[6] = {};
    if (auto&& rdr = Wire.get_reader(AHT21B_ADDR, 6)) {
        for (int i = 0; i < 6; i++) rdr >> d[i];
    } else { return false; }

    if (d[0] & 0x80) return false;  // busy

    uint32_t raw_H = ((uint32_t)d[1] << 12) | ((uint32_t)d[2] << 4) | (d[3] >> 4);
    uint32_t raw_T = ((uint32_t)(d[3] & 0x0F) << 16) | ((uint32_t)d[4] << 8) | d[5];

    // RH×100 = raw_H * 10000 / 1048576 = raw_H * 625 / 65536
    s_humidX100 = (uint16_t)((uint32_t)raw_H * 625 / 65536);
    // T×100 = raw_T * 20000 / 1048576 - 5000 = raw_T * 625 / 32768 - 5000
    s_tempX100  = (uint16_t)(int16_t)((int32_t)((uint32_t)raw_T * 625 / 32768) - 5000);
    s_presX10   = 0;

    return true;
}

// ===== setup =====
void setup() {
    step.setup();
    s_aht_initialized = false;

    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle();

    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(LID_CHILD);

    Wire.begin();
    Analogue.begin(pack_bits(PIN_ANALOGUE::VCC));
    the_twelite.begin();

    Serial << "--- FoxSenseChild v1.2 (AHT21B) ---" << mwx::crlf
           << "AppID=0x67F56A23 Ch=" << int(CHANNEL) << mwx::crlf
           << format("HWADDR:%08X", the_twelite.get_hw_serial()) << mwx::crlf
           << "Listening for FSWK/PAIR..." << mwx::crlf;
}

// ===== begin =====
void begin() {
    s_wakeTime        = millis();
    s_triggered       = false;
    s_pair_requested  = false;
    step.next(STATE::LISTEN);
}

// ===== wakeup =====
void wakeup() {
    s_wakeTime        = millis();
    s_triggered       = false;
    s_pair_requested  = false;
    Wire.begin();
    Analogue.begin(pack_bits(PIN_ANALOGUE::VCC));
    step.on_sleep(false);
}

// ===== loop =====
void loop() {
    do {
        switch (step.state()) {

        // --------------------------------------------------
        case STATE::LISTEN:
            while (Serial.available()) {
                uint8_t c = (uint8_t)Serial.read();
                if (c == '?') {
                    Serial << format("HWADDR:%08X", the_twelite.get_hw_serial()) << mwx::crlf;
                }
            }
            if (s_pair_requested) {
                step.next(STATE::PAIR_ACK_TX);
            } else if (s_triggered) {
                step.next(STATE::SENSOR_START);
            } else if (millis() - s_wakeTime >= LISTEN_WINDOW_MS) {
                step.next(STATE::GO_SLEEP);
            }
        break;

        // --------------------------------------------------
        case STATE::SENSOR_START: {
            if (Analogue.available()) {
                s_vccMv = Analogue.read(PIN_ANALOGUE::VCC);
            }
            if (!s_aht_initialized) {
                if (!aht_init()) {
                    step.next(STATE::GO_SLEEP);
                    break;
                }
            }
            aht_trigger();
            step.set_timeout(AHT21B_CONV_MS);
            step.next(STATE::SENSOR_WAIT);
        }
        break;

        // --------------------------------------------------
        case STATE::SENSOR_WAIT:
            if (step.is_timeout()) {
                if (!aht_read_data()) {
                    step.set_timeout(5);
                } else {
                    Serial << format("T=%d H=%d VCC=%d",
                                     s_tempX100, s_humidX100, s_vccMv)
                           << mwx::crlf;
                    step.next(STATE::TX);
                }
            }
        break;

        // --------------------------------------------------
        case STATE::TX: {
            step.next(STATE::GO_SLEEP);

            if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
                pkt << tx_addr(0x00)
                    << tx_retry(0x1)
                    << tx_packet_delay(0, 50, 5);

                pack_bytes(pkt.get_payload()
                    , make_pair("FSDT", 4)
                    , s_tempX100
                    , s_humidX100
                    , s_presX10
                    , s_vccMv
                );

                MWX_APIRET ret = pkt.transmit();
                if (ret) {
                    step.clear_flag();
                    step.set_timeout(TX_TIMEOUT_MS);
                    step.next(STATE::TX_WAIT);
                } else {
                    Serial << "TX request failed" << mwx::crlf;
                }
            }
        }
        break;

        // --------------------------------------------------
        case STATE::TX_WAIT:
            if (step.is_flag_ready()) {
                Serial << "TX done." << mwx::crlf;
                step.next(STATE::GO_SLEEP);
            } else if (step.is_timeout()) {
                Serial << "TX timeout." << mwx::crlf;
                step.next(STATE::GO_SLEEP);
            }
        break;

        // --------------------------------------------------
        case STATE::PAIR_ACK_TX: {
            step.next(STATE::GO_SLEEP);

            uint32_t myId = the_twelite.get_hw_serial();

            Serial << format("Sending Pair ACK (hash=0x%08X myId=0x%08X)",
                             s_pair_hash, myId) << mwx::crlf;

            if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
                pkt << tx_addr(0x00)
                    << tx_retry(0x2)
                    << tx_packet_delay(0, 20, 5);

                pack_bytes(pkt.get_payload(),
                    (uint8_t)0xA5, (uint8_t)0x11,
                    (uint8_t)((s_pair_hash >> 24) & 0xFF),
                    (uint8_t)((s_pair_hash >> 16) & 0xFF),
                    (uint8_t)((s_pair_hash >>  8) & 0xFF),
                    (uint8_t)( s_pair_hash         & 0xFF),
                    (uint8_t)((myId >> 24) & 0xFF),
                    (uint8_t)((myId >> 16) & 0xFF),
                    (uint8_t)((myId >>  8) & 0xFF),
                    (uint8_t)( myId         & 0xFF),
                    (uint8_t)0x01
                );

                MWX_APIRET ret = pkt.transmit();
                if (ret) {
                    step.clear_flag();
                    step.set_timeout(TX_TIMEOUT_MS);
                    step.next(STATE::TX_WAIT);
                } else {
                    Serial << "Pair ACK TX failed" << mwx::crlf;
                }
            }
            s_pair_requested = false;
        }
        break;

        // --------------------------------------------------
        case STATE::GO_SLEEP:
            Serial.flush();
            s_triggered      = false;
            s_pair_requested = false;
            step.on_sleep(false);
            the_twelite.sleep(SLEEP_DURATION_MS, false);
        break;

        default:
            step.next(STATE::GO_SLEEP);
        break;
        }
    } while (step.b_more_loop());
}

// ===== 無線受信コールバック =====
void on_rx_packet(packet_rx& rx, bool_t& handled) {
    auto&& payload = rx.get_payload();

    if (payload.size() >= 11 && payload[0] == 0xA5 && payload[1] == 0x10) {
        uint32_t myId = the_twelite.get_hw_serial();
        uint32_t targetId = ((uint32_t)payload[6]  << 24) |
                            ((uint32_t)payload[7]  << 16) |
                            ((uint32_t)payload[8]  <<  8) |
                             (uint32_t)payload[9];
        if (targetId == myId) {
            s_pair_hash = ((uint32_t)payload[2] << 24) |
                          ((uint32_t)payload[3] << 16) |
                          ((uint32_t)payload[4] <<  8) |
                           (uint32_t)payload[5];
            s_pair_requested = true;
            Serial << format("Pair request! hash=0x%08X logicalId=%d",
                             s_pair_hash, (int)payload[10]) << mwx::crlf;
            handled = true;
        }
        return;
    }

    if (payload.size() >= 4 &&
        payload[0]=='F' && payload[1]=='S' &&
        payload[2]=='W' && payload[3]=='K') {
        Serial << "FSWK received!" << mwx::crlf;
        s_triggered = true;
        handled = true;
    }
}

// ===== 送信完了コールバック =====
void on_tx_comp(mwx::packet_ev_tx& ev, bool_t& b_handled) {
    step.set_flag(ev.bStatus);
}

/* Copyright (C) 2025 geoAlpine LLC. All Rights Reserved. */
