/**
 * FoxSenseChild - TWELITE DIP MWX子機アプリ v1.0
 *
 * 配線:
 *   TWELITE DIP          BME280
 *   VCC  (pin 28) ────── VCC
 *   GND  (pin 12) ────── GND
 *   DIO5 (pin  4) ────── SDA   ← I2C SDA (MWX Wire固定)
 *   DIO6 (pin  5) ────── SCL   ← I2C SCL (MWX Wire固定)
 *                        SDO ── GND  (I2C addr: 0x76)
 *
 * 動作フロー:
 *   1. 100ms スリープ → 起床 → 200ms 受信待機
 *   2. 親機から "FSWK" 受信 → BME280 測定開始
 *   3. 変換完了 (15ms) → "FSDT" パケットを親機へ送信
 *   4. 送信完了 → スリープに戻る
 *
 * 送信ペイロード:
 *   "FSDT" (4B) | tempX100 (uint16) | humidX100 (uint16)
 *   | presX10 (uint16) | vccMv (uint16)  計12バイト
 */

#include <TWELITE>
#include <NWK_SIMPLE>
#include <SM_SIMPLE>

// ===== アプリケーション設定 =====
const uint32_t APP_ID    = 0x67F56A23;  // 親機と同一 App ID
const uint8_t  CHANNEL   = 18;
const uint8_t  LID_CHILD = 0xFE;        // 0xFE = 匿名子機

// ===== タイミング設定 =====
const uint32_t LISTEN_WINDOW_MS  = 200;  // 起床後の受信待機時間 (ms)
const uint32_t SLEEP_DURATION_MS = 100;  // スリープ時間 (ms)
const uint32_t BME280_CONV_MS    = 15;   // BME280 変換待機時間 (ms)
const uint32_t TX_TIMEOUT_MS     = 300;  // 送信完了タイムアウト (ms)

// ===== BME280 =====
const uint8_t BME280_ADDR = 0x76;  // SDO=GND

// キャリブレーションデータ
struct {
    uint16_t T1; int16_t T2, T3;
    uint16_t P1; int16_t P2, P3, P4, P5, P6, P7, P8, P9;
    uint8_t  H1; int16_t H2; uint8_t H3;
    int16_t  H4, H5; int8_t H6;
    int32_t  t_fine;
    bool     calibrated;
} s_bme;

// ===== 状態機械 =====
enum class STATE : uint8_t {
    LISTEN = 0,
    SENSOR_START,
    SENSOR_WAIT,
    TX,
    TX_WAIT,
    GO_SLEEP,
};
SM_SIMPLE<STATE> step;

// ===== 共有変数 =====
static bool     s_triggered  = false;
static uint32_t s_wakeTime   = 0;
static uint16_t s_tempX100   = 0;
static uint16_t s_humidX100  = 0;
static uint16_t s_presX10    = 0;
static uint16_t s_vccMv      = 3300;  // デフォルト 3300mV

// ===== BME280 I2C ヘルパー =====
static bool bme_read_regs(uint8_t reg, uint8_t* buf, int len) {
    // レジスタアドレス書き込み
    if (auto&& wrt = Wire.get_writer(BME280_ADDR)) {
        wrt << reg;
    } else {
        return false;
    }
    // データ読み出し
    if (auto&& rdr = Wire.get_reader(BME280_ADDR, len)) {
        for (int i = 0; i < len; i++) {
            rdr >> buf[i];
        }
        return true;
    }
    return false;
}

static bool bme_write_reg(uint8_t reg, uint8_t val) {
    if (auto&& wrt = Wire.get_writer(BME280_ADDR)) {
        wrt << reg << val;
        return true;
    }
    return false;
}

// ===== BME280 初期化 (キャリブレーション読み出し + 設定) =====
static bool bme_init() {
    // Chip ID 確認
    uint8_t id = 0;
    if (!bme_read_regs(0xD0, &id, 1) || id != 0x60) {
        Serial << format("BME280 ID=0x%02X (expected 0x60)", id) << mwx::crlf;
        return false;
    }

    // 気温・気圧キャリブレーション (0x88..0x9F: 24バイト)
    uint8_t c[24];
    if (!bme_read_regs(0x88, c, 24)) return false;
    s_bme.T1 = (uint16_t)((c[1]<<8)|c[0]);
    s_bme.T2 = (int16_t)((c[3]<<8)|c[2]);
    s_bme.T3 = (int16_t)((c[5]<<8)|c[4]);
    s_bme.P1 = (uint16_t)((c[7]<<8)|c[6]);
    s_bme.P2 = (int16_t)((c[9]<<8)|c[8]);
    s_bme.P3 = (int16_t)((c[11]<<8)|c[10]);
    s_bme.P4 = (int16_t)((c[13]<<8)|c[12]);
    s_bme.P5 = (int16_t)((c[15]<<8)|c[14]);
    s_bme.P6 = (int16_t)((c[17]<<8)|c[16]);
    s_bme.P7 = (int16_t)((c[19]<<8)|c[18]);
    s_bme.P8 = (int16_t)((c[21]<<8)|c[20]);
    s_bme.P9 = (int16_t)((c[23]<<8)|c[22]);

    // 湿度キャリブレーション
    bme_read_regs(0xA1, &s_bme.H1, 1);
    uint8_t h[7];
    bme_read_regs(0xE1, h, 7);
    s_bme.H2 = (int16_t)((h[1]<<8)|h[0]);
    s_bme.H3 = h[2];
    s_bme.H4 = (int16_t)(((int16_t)h[3]<<4)|(h[4]&0x0F));
    s_bme.H5 = (int16_t)(((int16_t)h[5]<<4)|(h[4]>>4));
    s_bme.H6 = (int8_t)h[6];

    // センサー設定
    bme_write_reg(0xF2, 0x01);  // ctrl_hum: 湿度 oversampling x1
    bme_write_reg(0xF5, 0x00);  // config: standby最短・フィルタなし

    s_bme.calibrated = true;
    return true;
}

// ===== BME280 Forced Mode 起動 =====
static void bme_trigger() {
    // ctrl_meas: 気温x1, 気圧x1, Forced mode (0x25)
    bme_write_reg(0xF4, 0x25);
}

// ===== BME280 データ読み出し + 補正 (Bosch 整数式) =====
static bool bme_read_data() {
    // ステータス確認 (measuring bit)
    uint8_t status = 0;
    bme_read_regs(0xF3, &status, 1);
    if (status & 0x08) return false;  // まだ変換中

    // RAWデータ読み出し (0xF7..0xFE: 8バイト)
    uint8_t d[8];
    if (!bme_read_regs(0xF7, d, 8)) return false;

    int32_t adc_P = ((int32_t)d[0]<<12)|((int32_t)d[1]<<4)|(d[2]>>4);
    int32_t adc_T = ((int32_t)d[3]<<12)|((int32_t)d[4]<<4)|(d[5]>>4);
    int32_t adc_H = ((int32_t)d[6]<<8)|(int32_t)d[7];

    // --- 気温補正 (Bosch integer, 0.01°C単位) ---
    int32_t v1 = (((adc_T>>3) - ((int32_t)s_bme.T1<<1)) * s_bme.T2) >> 11;
    int32_t v2 = (((((adc_T>>4) - (int32_t)s_bme.T1) *
                    ((adc_T>>4) - (int32_t)s_bme.T1)) >> 12) * s_bme.T3) >> 14;
    s_bme.t_fine = v1 + v2;
    int32_t T = (s_bme.t_fine * 5 + 128) >> 8;  // 0.01°C
    s_tempX100 = (uint16_t)(int16_t)T;

    // --- 湿度補正 (0.01 %RH単位) ---
    int32_t hv = s_bme.t_fine - 76800;
    hv = (((((adc_H<<14) - ((int32_t)s_bme.H4<<20) - ((int32_t)s_bme.H5 * hv))
            + 16384) >> 15) *
          (((((((hv * (int32_t)s_bme.H6) >> 10) *
               (((hv * (int32_t)s_bme.H3) >> 11) + 32768)) >> 10)
             + 2097152) * s_bme.H2 + 8192) >> 14));
    hv -= (((((hv>>15) * (hv>>15)) >> 7) * (int32_t)s_bme.H1) >> 4);
    if (hv < 0) hv = 0;
    if (hv > 419430400) hv = 419430400;
    // Q22.10 → 0.01 %RH
    s_humidX100 = (uint16_t)(int16_t)((hv >> 12) * 100 / 1024);

    // --- 気圧補正 (Bosch 32bit integer, Q24.8 Pa) ---
    int32_t pv1 = ((int32_t)s_bme.t_fine >> 1) - 64000;
    int32_t pv2 = (((pv1>>2) * (pv1>>2)) >> 11) * (int32_t)s_bme.P6;
    pv2 = pv2 + ((pv1 * (int32_t)s_bme.P5) << 1);
    pv2 = (pv2>>2) + ((int32_t)s_bme.P4 << 16);
    pv1 = (((s_bme.P3 * (((pv1>>2)*(pv1>>2))>>13))>>3)
           + (((int32_t)s_bme.P2 * pv1) >> 1)) >> 18;
    pv1 = ((32768 + pv1) * (int32_t)s_bme.P1) >> 15;

    uint32_t p = 0;
    if (pv1 != 0) {
        p = (uint32_t)(1048576 - adc_P);
        p = ((p - (uint32_t)(pv2 >> 12)) * 3125);
        if (p < 0x80000000UL) {
            p = (p << 1) / (uint32_t)pv1;
        } else {
            p = (p / (uint32_t)pv1) * 2;
        }
        pv1 = ((int32_t)s_bme.P9 * (int32_t)(((p>>3)*(p>>3))>>13)) >> 12;
        pv2 = ((int32_t)(p>>2) * (int32_t)s_bme.P8) >> 13;
        p = (uint32_t)((int32_t)p + ((pv1 + pv2 + (int32_t)s_bme.P7) >> 4));
        // p は Pa * 256 (Q24.8)
        p >>= 8;  // → Pa
    }
    // 0.1 hPa単位: Pa / 10
    s_presX10 = (uint16_t)(p / 10);

    return true;
}

// ===== setup =====
void setup() {
    step.setup();
    s_bme.calibrated = false;

    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle();  // 起動中は受信回路ON

    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(LID_CHILD);

    Wire.begin();

    // VCC計測開始 (ADC)
    Analogue.begin(pack_bits(PIN_ANALOGUE::VCC));

    the_twelite.begin();

    Serial << "--- FoxSenseChild v1.0 ---" << mwx::crlf
           << "AppID=0x67F56A23 Ch=" << int(CHANNEL) << mwx::crlf
           << "Listening for FSWK..." << mwx::crlf;
}

// ===== begin (初回起動後に1回呼ばれる) =====
void begin() {
    // 初回は LISTEN 状態から開始 (親機がすでに送信中かもしれないため)
    s_wakeTime = millis();
    s_triggered = false;
    step.next(STATE::LISTEN);
}

// ===== wakeup (スリープ後に呼ばれる) =====
void wakeup() {
    s_wakeTime = millis();
    s_triggered = false;
    Wire.begin();
    Analogue.begin(pack_bits(PIN_ANALOGUE::VCC));
    step.on_sleep(false);  // → STATE::LISTEN にリセット
}

// ===== loop =====
void loop() {
    do {
        switch (step.state()) {

        // --------------------------------------------------
        case STATE::LISTEN:
            // "FSWK" 受信待機
            if (s_triggered) {
                step.next(STATE::SENSOR_START);
            } else if (millis() - s_wakeTime >= LISTEN_WINDOW_MS) {
                // タイムアウト → スリープ
                step.next(STATE::GO_SLEEP);
            }
        break;

        // --------------------------------------------------
        case STATE::SENSOR_START: {
            // VCC取得 (ADC)
            if (Analogue.available()) {
                s_vccMv = Analogue.read(PIN_ANALOGUE::VCC);
            }
            // BME280 初期化 (キャリブレーション未読なら初回のみ実行)
            if (!s_bme.calibrated) {
                if (!bme_init()) {
                    Serial << "BME280 init failed!" << mwx::crlf;
                    step.next(STATE::GO_SLEEP);
                    break;
                }
            }
            bme_trigger();
            step.set_timeout(BME280_CONV_MS);
            step.next(STATE::SENSOR_WAIT);
        }
        break;

        // --------------------------------------------------
        case STATE::SENSOR_WAIT:
            if (step.is_timeout()) {
                if (!bme_read_data()) {
                    // 変換中ならもう少し待つ
                    step.set_timeout(5);
                } else {
                    Serial << format("T=%d H=%d P=%d VCC=%d",
                                     s_tempX100, s_humidX100, s_presX10, s_vccMv)
                           << mwx::crlf;
                    step.next(STATE::TX);
                }
            }
        break;

        // --------------------------------------------------
        case STATE::TX: {
            step.next(STATE::GO_SLEEP);  // デフォルト: エラー時スリープ

            if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
                pkt << tx_addr(0x00)        // 親機 (LID=0) 宛
                    << tx_retry(0x1)         // 1回リトライ
                    << tx_packet_delay(0, 50, 5);

                pack_bytes(pkt.get_payload()
                    , make_pair("FSDT", 4)   // 識別子
                    , s_tempX100             // 気温 × 100 (uint16)
                    , s_humidX100            // 湿度 × 100 (uint16)
                    , s_presX10              // 気圧 × 10  (uint16)
                    , s_vccMv                // VCC mV     (uint16)
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
        case STATE::GO_SLEEP:
            Serial.flush();
            s_triggered = false;
            step.on_sleep(false);           // 次の wakeup() 後は STATE::LISTEN から再開
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
    if (payload.size() >= 4 &&
        payload[0]=='F' && payload[1]=='S' &&
        payload[2]=='W' && payload[3]=='K') {
        s_triggered = true;
        handled = true;
    }
}

// ===== 送信完了コールバック =====
void on_tx_comp(mwx::packet_ev_tx& ev, bool_t& b_handled) {
    step.set_flag(ev.bStatus);
}

/* Copyright (C) 2025 geoAlpine LLC. All Rights Reserved. */
