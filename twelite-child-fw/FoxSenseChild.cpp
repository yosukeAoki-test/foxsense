/**
 * FoxSense 子機ファームウェア (MWX版)
 * TWELITE DIP + BME280 (ATmega328P不要)
 *
 * 動作:
 *   スリープ(9s) → 起床 → BME280を3回測定(中央値) → 親機(LID=0)へ送信 → スリープ
 *
 * パケット構成 (ペイロード 16バイト):
 *   [FSv3(4)][CHILD_ID_4][TEMP_I16_2][HUMID_I16_2][PRES_U16_2][BAT_U16_2]
 *   TEMP  : °C × 100 (int16_t, 例: 2550 = 25.50°C)
 *   HUMID : % × 100  (int16_t, 例: 5500 = 55.00%)
 *   PRES  : hPa × 10 (uint16_t, 例: 10133 = 1013.3hPa)
 *   BAT   : VCC電圧mV (uint16_t, 例: 3300 = 3300mV)
 *
 * ネットワーク設定:
 *   APP_ID, CH は STG_STD (インタラクティブモード) で設定可能
 *   デフォルト: APP_ID=0x46534E53("FSNS"), CH=13
 *   DIO12をGNDに接続するとインタラクティブモードで起動
 *
 * デバイスID:
 *   the_twelite.get_addr_long() = TWELITE DIPハードウェアシリアル番号
 *   Webシステムへの登録は 8桁16進数(例: "83AB1234")で行う
 */

#include <TWELITE>
#include <NWK_SIMPLE>
#include <SNS_BME280>
#include <STG_STD>

// ============================================================
// ネットワーク設定
// ============================================================
const uint32_t DEF_APPID  = 0x46534E53;  // "FSNS"
const uint8_t  DEF_CHANNEL = 13;
const char     APP_NAME[]  = "FoxSense Child";
const uint8_t  FOURCC[]    = "FSv3";     // 4バイト識別子

uint32_t APP_ID  = DEF_APPID;
uint8_t  CHANNEL = DEF_CHANNEL;

// ============================================================
// 状態機械
// ============================================================
enum class E_STATE : uint8_t {
    INIT         = 0,
    SAMPLE_START,   // BME280計測開始
    SAMPLE_WAIT,    // 計測完了待ち
    SAMPLE_RECORD,  // 結果記録
    TX,             // 送信要求
    TX_WAIT,        // 送信完了待ち
    SLEEP,          // スリープ
    SETTING_MODE,   // インタラクティブモード
    ERROR           // エラー→リセット
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

// ============================================================
// TX管理
// ============================================================
uint8_t  u8txid     = 0;
uint32_t u32tick_tx = 0;

// ============================================================
// ヘルパー: int16_t 配列の中央値（挿入ソート）
// ============================================================
static int16_t median_i16(int16_t* arr, int n) {
    for (int i = 1; i < n; i++) {
        int16_t key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key) { arr[j + 1] = arr[j]; j--; }
        arr[j + 1] = key;
    }
    return arr[n / 2];
}

// ============================================================
// ヘルパー: uint16_t 配列の中央値（挿入ソート）
// ============================================================
static uint16_t median_u16(uint16_t* arr, int n) {
    for (int i = 1; i < n; i++) {
        uint16_t key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key) { arr[j + 1] = arr[j]; j--; }
        arr[j + 1] = key;
    }
    return arr[n / 2];
}

// ============================================================
// setup() - コールドブート時に1回実行
// ============================================================
void setup() {
    // STG_STD: EEPROMに保存した設定を読み込む
    auto&& set = the_twelite.settings.use<STG_STD>();
    set << SETTINGS::appname(APP_NAME)
        << SETTINGS::appid_default(DEF_APPID);

    // 不要な設定項目を非表示
    set.hide_items(
        E_STGSTD_SETID::POWER_N_RETRY,
        E_STGSTD_SETID::OPTBITS,
        E_STGSTD_SETID::OPT_DWORD2,
        E_STGSTD_SETID::OPT_DWORD3,
        E_STGSTD_SETID::OPT_DWORD4,
        E_STGSTD_SETID::ENC_MODE,
        E_STGSTD_SETID::ENC_KEY_STRING
    );

    // DIO12をGNDに接続: インタラクティブモード起動
    pinMode(PIN_DIGITAL::DIO12, PIN_MODE::INPUT_PULLUP);
    if (digitalRead(PIN_DIGITAL::DIO12) == LOW) {
        set << SETTINGS::open_at_start();
        eState = E_STATE::SETTING_MODE;
        the_twelite.begin();
        return;
    }

    // EEPROM設定反映
    set.reload();
    APP_ID  = set.u32appid();
    CHANNEL = set.u8ch();

    // TWELITE設定 (子機はRX不要 → 省電力)
    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle(false);

    // NWK_SIMPLE: LID=0xFE (ID未割当て子機)
    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(0xFE);

    // I2C / ADC 初期化
    Wire.begin(WIRE_CONF::WIRE_100KHZ);
    Analogue.setup();

    // BME280検出 (0x76 → 0x77 の順)
    sns_bme280.setup();
    if (!sns_bme280.probe()) {
        delayMicroseconds(100);
        sns_bme280.setup(0x77);
        if (sns_bme280.probe()) b_found_bme280 = true;
    } else {
        b_found_bme280 = true;
    }

    the_twelite.begin();

    // 起動ログ
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
    sample_count = 0;
    result_temp  = 0;
    result_humid = 0;
    result_pres  = 0;
    result_vcc   = 0;
    eState = E_STATE::INIT;
}

// ============================================================
// loop() - イベント発生ごとに呼ばれる
// ============================================================
void loop() {
    bool next;
    do {
        next = false;
        switch (eState) {

        // インタラクティブモード中は何もしない
        case E_STATE::SETTING_MODE:
            break;

        // 計測サイクル開始
        case E_STATE::INIT:
            Analogue.begin(pack_bits(PIN_ANALOGUE::VCC));
            sample_count = 0;
            next  = true;
            eState = E_STATE::SAMPLE_START;
            break;

        // BME280 Forced Mode 計測開始
        case E_STATE::SAMPLE_START:
            if (b_found_bme280) {
                sns_bme280.begin();
            }
            eState = E_STATE::SAMPLE_WAIT;
            break;

        // 計測完了待ち (TickTimer = 1ms tick)
        case E_STATE::SAMPLE_WAIT:
            if (TickTimer.available()) {
                if (b_found_bme280) {
                    sns_bme280.process_ev(E_EVENT_TICK_TIMER);
                    if (sns_bme280.available()) {
                        next  = true;
                        eState = E_STATE::SAMPLE_RECORD;
                    }
                } else {
                    // センサーなし: ゼロ値で記録して次へ
                    next  = true;
                    eState = E_STATE::SAMPLE_RECORD;
                }
            }
            break;

        // サンプル記録
        case E_STATE::SAMPLE_RECORD:
            if (b_found_bme280 && sns_bme280.available()) {
                buf_temp [sample_count] = (int16_t)sns_bme280.get_temp_cent();
                buf_humid[sample_count] = (int16_t)(sns_bme280.get_humid() * 100.0f);
                buf_pres [sample_count] = (uint16_t)(sns_bme280.get_press() * 10.0f);
            } else {
                buf_temp [sample_count] = 0;
                buf_humid[sample_count] = 0;
                buf_pres [sample_count] = 0;
            }
            sample_count++;

            if (sample_count < N_SAMPLES) {
                // まだサンプルが足りない → 次のサンプル開始
                next  = true;
                eState = E_STATE::SAMPLE_START;
            } else {
                // 3サンプル揃った → 中央値採用
                if (b_found_bme280) {
                    result_temp  = median_i16(buf_temp,  N_SAMPLES);
                    result_humid = median_i16(buf_humid, N_SAMPLES);
                    result_pres  = median_u16(buf_pres,  N_SAMPLES);
                }
                if (Analogue.available()) {
                    result_vcc = Analogue.read(PIN_ANALOGUE::VCC);
                }
                Serial << format("T=%d H=%d P=%d VCC=%d",
                    result_temp, result_humid, result_pres, result_vcc) << crlf;
                next  = true;
                eState = E_STATE::TX;
            }
            break;

        // 送信要求
        case E_STATE::TX:
            eState = E_STATE::ERROR;  // 失敗した場合のデフォルト

            if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
                pkt << tx_addr(0x00)       // 親機 (LID=0) へ送信
                    << tx_retry(0x1)        // 1回リトライ (計2回送信)
                    << tx_packet_delay(0, 0, 2);

                // ペイロード: [FSv3(4)][DevID(4)][TEMP(2)][HUMID(2)][PRES(2)][BAT(2)]
                pack_bytes(pkt.get_payload()
                    , make_pair(FOURCC, 4)
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
                next  = true;
                eState = E_STATE::SLEEP;
            } else if (millis() - u32tick_tx > 3000) {
                // タイムアウト: スリープへ (データロストは許容)
                next  = true;
                eState = E_STATE::SLEEP;
            }
            break;

        // スリープ
        case E_STATE::SLEEP:
            Serial.flush();
            the_twelite.sleep(9000);  // 9秒スリープ
            break;

        // エラー → システムリセット
        case E_STATE::ERROR:
            Serial << "!FATAL: reset" << crlf;
            Serial.flush();
            delay(100);
            the_twelite.reset_system();
            break;
        }
    } while (next);
}

// TX完了コールバック (TX_WAIT でポーリングするため本体は空)
void on_tx_comp(mwx::packet_ev_tx& ev, bool_t& b_handled) {
    (void)ev; (void)b_handled;
}
