/**
 * FoxSense 子機ファームウェア (MWX版 v2)
 * TWELITE DIP + BME280 (ATmega328P不要)
 *
 * 動作サイクル (電池寿命優先設計):
 *   スリープ(15s) → 起床 → 50ms受信待機
 *     → 親機起床信号("FSW1")受信: BME280計測×3中央値 → 送信 → スリープ
 *     → タイムアウト(信号なし):                                  スリープ
 *
 * 消費電力:
 *   平均電流 ≈ 15.6mA × 50ms/15s + 0.7µA ≈ 52µA
 *   電池寿命 (単4×2本): 室温 約3.5年 / 冬季(0°C) 約2年
 *
 * ペイロード構成 (16バイト):
 *   [FSv3(4)][CHILD_ID_4][TEMP_I16_2][HUMID_I16_2][PRES_U16_2][VCC_U16_2]
 *   TEMP  : °C × 100 (int16_t)
 *   HUMID : % × 100  (int16_t)
 *   PRES  : hPa × 10 (uint16_t)
 *   VCC   : mV       (uint16_t, 例: 3100 = 3.1V)
 *
 * ネットワーク設定:
 *   APP_ID/CH は STG_STD で変更可能
 *   デフォルト: APP_ID=0x46534E53("FSNS"), CH=13
 *   DIO12 → GND でインタラクティブモード起動
 *
 * デバイスID:
 *   the_twelite.get_addr_long() = TWELITE DIPハードウェアシリアル (8桁16進)
 *   → WebシステムにそのままデバイスIDとして登録する
 */

#include <TWELITE>
#include <NWK_SIMPLE>
#include <SNS_BME280>
#include <STG_STD>

// ============================================================
// ネットワーク設定
// ============================================================
const uint32_t DEF_APPID   = 0x46534E53;  // "FSNS"
const uint8_t  DEF_CHANNEL = 13;
const char     APP_NAME[]  = "FoxSense Child";
const uint8_t  FOURCC_DATA[] = "FSv3";    // データパケット識別子
const uint8_t  FOURCC_WAKE[] = "FSW1";    // 起床信号識別子

uint32_t APP_ID  = DEF_APPID;
uint8_t  CHANNEL = DEF_CHANNEL;

// ============================================================
// タイミング設定
// ============================================================
static const uint32_t SLEEP_MS        = 15000;  // スリープ時間
static const uint32_t LISTEN_TIMEOUT  = 50;     // 受信窓 [ms]

// ============================================================
// 状態機械
// ============================================================
enum class E_STATE : uint8_t {
    INIT         = 0,
    LISTEN,         // 起床信号待機 (50ms)
    SAMPLE_START,   // BME280計測開始
    SAMPLE_WAIT,    // 計測完了待ち
    SAMPLE_RECORD,  // 結果記録
    TX,             // 送信要求
    TX_WAIT,        // 送信完了待ち
    SLEEP,          // スリープ
    SETTING_MODE,   // インタラクティブモード
    ERROR
};
E_STATE eState = E_STATE::INIT;

// ============================================================
// センサー
// ============================================================
SNS_BME280 sns_bme280;
bool b_found_bme280 = false;

// 3サンプル中央値バッファ
static const int N_SAMPLES = 3;
int16_t  buf_temp [N_SAMPLES];
int16_t  buf_humid[N_SAMPLES];
uint16_t buf_pres [N_SAMPLES];
int      sample_count = 0;

// 採用値
int16_t  result_temp  = 0;
int16_t  result_humid = 0;
uint16_t result_pres  = 0;
uint16_t result_vcc   = 0;

// 起床信号フラグ (on_rx_packet → loop)
volatile bool wake_received = false;

// 受信窓タイマー
uint32_t listen_start_ms = 0;

// TX管理
uint8_t  u8txid     = 0;
uint32_t u32tick_tx = 0;

// ============================================================
// ヘルパー: int16_t 中央値（挿入ソート、in-place）
// ============================================================
static int16_t median_i16(int16_t* a, int n) {
    for (int i = 1; i < n; i++) {
        int16_t k = a[i]; int j = i - 1;
        while (j >= 0 && a[j] > k) { a[j+1] = a[j]; j--; }
        a[j+1] = k;
    }
    return a[n / 2];
}

static uint16_t median_u16(uint16_t* a, int n) {
    for (int i = 1; i < n; i++) {
        uint16_t k = a[i]; int j = i - 1;
        while (j >= 0 && a[j] > k) { a[j+1] = a[j]; j--; }
        a[j+1] = k;
    }
    return a[n / 2];
}

// ============================================================
// setup() - コールドブート時に1回実行
// ============================================================
void setup() {
    auto&& set = the_twelite.settings.use<STG_STD>();
    set << SETTINGS::appname(APP_NAME)
        << SETTINGS::appid_default(DEF_APPID);
    set.hide_items(
        E_STGSTD_SETID::POWER_N_RETRY, E_STGSTD_SETID::OPTBITS,
        E_STGSTD_SETID::OPT_DWORD2,   E_STGSTD_SETID::OPT_DWORD3,
        E_STGSTD_SETID::OPT_DWORD4,   E_STGSTD_SETID::ENC_MODE,
        E_STGSTD_SETID::ENC_KEY_STRING
    );

    // DIO12 → GND: インタラクティブモード
    pinMode(PIN_DIGITAL::DIO12, PIN_MODE::INPUT_PULLUP);
    if (digitalRead(PIN_DIGITAL::DIO12) == LOW) {
        set << SETTINGS::open_at_start();
        eState = E_STATE::SETTING_MODE;
        the_twelite.begin();
        return;
    }

    set.reload();
    APP_ID  = set.u32appid();
    CHANNEL = set.u8ch();

    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle();  // 起床信号受信のためRX常時有効

    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(0xFE);  // 子機

    Wire.begin(WIRE_CONF::WIRE_100KHZ);
    Analogue.setup();

    // BME280検出 (0x76 → 0x77)
    sns_bme280.setup();
    if (!sns_bme280.probe()) {
        delayMicroseconds(100);
        sns_bme280.setup(0x77);
        if (sns_bme280.probe()) b_found_bme280 = true;
    } else {
        b_found_bme280 = true;
    }

    the_twelite.begin();

    Serial << "--- " << APP_NAME << " ---" << crlf;
    Serial << format("APP_ID=%08X CH=%d", APP_ID, CHANNEL) << crlf;
    Serial << format("DevID=%08X", the_twelite.get_addr_long()) << crlf;
    Serial << (b_found_bme280 ? "BME280: OK" : "BME280: NOT FOUND") << crlf;
}

// ============================================================
// wakeup() - スリープから復帰するたびに実行
// ============================================================
void wakeup() {
    Wire.begin(WIRE_CONF::WIRE_100KHZ);
    wake_received = false;
    sample_count  = 0;
    result_temp = result_humid = 0;
    result_pres = result_vcc  = 0;
    eState = E_STATE::INIT;
}

// ============================================================
// on_rx_packet() - RF受信コールバック
// ============================================================
void on_rx_packet(packet_rx& rx, bool_t& b_handled) {
    auto pay = rx.get_payload();
    if (pay.size() < 4) return;
    // "FSW1" = 起床信号
    if (pay[0] == 'F' && pay[1] == 'S' && pay[2] == 'W' && pay[3] == '1') {
        wake_received = true;
        b_handled = true;
    }
}

// ============================================================
// loop()
// ============================================================
void loop() {
    bool next;
    do {
        next = false;
        switch (eState) {

        case E_STATE::SETTING_MODE:
            break;

        case E_STATE::INIT:
            Analogue.begin(pack_bits(PIN_ANALOGUE::VCC));
            listen_start_ms = millis();
            eState = E_STATE::LISTEN;
            break;

        // 起床信号待機: 50ms タイムアウト
        case E_STATE::LISTEN:
            if (wake_received) {
                next  = true;
                eState = E_STATE::SAMPLE_START;
            } else if (millis() - listen_start_ms >= LISTEN_TIMEOUT) {
                // 信号なし → 省電力スリープへ
                Serial << "no wake" << crlf;
                next  = true;
                eState = E_STATE::SLEEP;
            }
            break;

        // BME280 Forced Mode 計測開始
        case E_STATE::SAMPLE_START:
            if (b_found_bme280) sns_bme280.begin();
            eState = E_STATE::SAMPLE_WAIT;
            break;

        // 計測完了待ち
        case E_STATE::SAMPLE_WAIT:
            if (TickTimer.available()) {
                if (b_found_bme280) {
                    sns_bme280.process_ev(E_EVENT_TICK_TIMER);
                    if (sns_bme280.available()) { next = true; eState = E_STATE::SAMPLE_RECORD; }
                } else {
                    next = true; eState = E_STATE::SAMPLE_RECORD;
                }
            }
            break;

        // サンプル記録
        case E_STATE::SAMPLE_RECORD:
            if (b_found_bme280 && sns_bme280.available()) {
                buf_temp [sample_count] = (int16_t)sns_bme280.get_temp_cent();
                buf_humid[sample_count] = (int16_t)(sns_bme280.get_humid() * 100.0f);
                buf_pres [sample_count] = (uint16_t)(sns_bme280.get_press() * 10.0f);
            }
            sample_count++;

            if (sample_count < N_SAMPLES) {
                next = true; eState = E_STATE::SAMPLE_START;
            } else {
                if (b_found_bme280) {
                    result_temp  = median_i16(buf_temp,  N_SAMPLES);
                    result_humid = median_i16(buf_humid, N_SAMPLES);
                    result_pres  = median_u16(buf_pres,  N_SAMPLES);
                }
                if (Analogue.available()) result_vcc = Analogue.read(PIN_ANALOGUE::VCC);
                Serial << format("T=%d H=%d P=%d V=%d", result_temp, result_humid, result_pres, result_vcc) << crlf;
                next = true; eState = E_STATE::TX;
            }
            break;

        // 送信
        case E_STATE::TX:
            eState = E_STATE::ERROR;
            if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
                pkt << tx_addr(0x00)    // 親機 LID=0
                    << tx_retry(0x1)
                    << tx_packet_delay(0, 0, 2);
                // ペイロード: [FSv3(4)][DevID(4)][TEMP(2)][HUMID(2)][PRES(2)][VCC(2)]
                pack_bytes(pkt.get_payload()
                    , make_pair(FOURCC_DATA, 4)
                    , uint32_t(the_twelite.get_addr_long())
                    , result_temp
                    , result_humid
                    , result_pres
                    , result_vcc
                );
                MWX_APIRET ret = pkt.transmit();
                if (ret) {
                    u8txid     = ret.get_value() & 0xFF;
                    u32tick_tx = millis();
                    eState     = E_STATE::TX_WAIT;
                }
            }
            break;

        // 送信完了待ち
        case E_STATE::TX_WAIT:
            if (the_twelite.tx_status.is_complete(u8txid)) {
                next = true; eState = E_STATE::SLEEP;
            } else if (millis() - u32tick_tx > 3000) {
                next = true; eState = E_STATE::SLEEP;  // タイムアウトでも寝る
            }
            break;

        // スリープ
        case E_STATE::SLEEP:
            Serial.flush();
            the_twelite.sleep(SLEEP_MS);
            break;

        case E_STATE::ERROR:
            Serial << "!FATAL: reset" << crlf;
            Serial.flush();
            delay(100);
            the_twelite.reset_system();
            break;
        }
    } while (next);
}

void on_tx_comp(mwx::packet_ev_tx& ev, bool_t& b_handled) {
    (void)ev; (void)b_handled;
}
