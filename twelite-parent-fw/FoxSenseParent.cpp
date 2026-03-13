/**
 * FoxSense 親機 TWELITE ファームウェア (MWX版)
 * TWELITE DIP (ESP32のUART2に接続)
 *
 * 動作:
 *   子機からの NWK_SIMPLE パケットを受信し、
 *   バイナリフレームを UART で ESP32 に転送する。
 *
 * UART出力フォーマット (ESP32 → このファームウェアへの送信は不要):
 *   [0xA5][0x04][CHILD_ID_4][TEMP_I16_2][HUMID_I16_2][PRES_U16_2][LQI_1][BAT_U16_2][CHKSUM][0x5A]
 *   合計: 17バイト
 *
 *   CHILD_ID : 子機のTWELITE長アドレス (uint32_t, big-endian)
 *   TEMP     : 温度 × 100 (int16_t, 例: 2550 = 25.50°C)
 *   HUMID    : 湿度 × 100 (int16_t, 例: 5500 = 55.00%)
 *   PRES     : 気圧 × 10  (uint16_t, 例: 10133 = 1013.3hPa)
 *   LQI      : 受信強度指標 (uint8_t, TWELITE LQI)
 *   BAT      : 子機 VCC電圧mV (uint16_t, 例: 3300 = 3300mV)
 *   CHKSUM   : bytes[1]~[15] の XOR
 *
 * ネットワーク設定:
 *   APP_ID, CH は子機と同じ値を設定すること
 *   デフォルト: APP_ID=0x46534E53("FSNS"), CH=13
 *   DIO12をGNDに接続するとインタラクティブモードで起動
 */

#include <TWELITE>
#include <NWK_SIMPLE>
#include <STG_STD>

// ============================================================
// ネットワーク設定
// ============================================================
const uint32_t DEF_APPID   = 0x46534E53;  // "FSNS" - 子機と一致させること
const uint8_t  DEF_CHANNEL = 13;
const char     APP_NAME[]  = "FoxSense Parent";

uint32_t APP_ID  = DEF_APPID;
uint8_t  CHANNEL = DEF_CHANNEL;

// ============================================================
// チェックサム計算 (bytes[1]..bytes[n-1] の XOR)
// ============================================================
static uint8_t calc_checksum(const uint8_t* buf, int len) {
    uint8_t cs = 0;
    for (int i = 1; i < len; i++) cs ^= buf[i];
    return cs;
}

// ============================================================
// setup() - コールドブート時に1回実行
// ============================================================
void setup() {
    auto&& set = the_twelite.settings.use<STG_STD>();
    set << SETTINGS::appname(APP_NAME)
        << SETTINGS::appid_default(DEF_APPID);

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
        the_twelite.begin();
        return;
    }

    set.reload();
    APP_ID  = set.u32appid();
    CHANNEL = set.u8ch();

    // 親機は常時受信
    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle();  // 常時受信モード

    // NWK_SIMPLE: LID=0x00 (親機)
    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(0x00);

    the_twelite.begin();

    Serial << "--- " << APP_NAME << " ---" << crlf;
    Serial << format("APP_ID=%08X CH=%d", APP_ID, CHANNEL) << crlf;
}

// ============================================================
// loop() - 親機は常時待機するだけ
// ============================================================
void loop() {}

// ============================================================
// on_rx_packet() - 子機パケット受信時に呼ばれる
// ============================================================
void on_rx_packet(packet_rx& rx, bool_t& b_handled) {
    auto pay = rx.get_payload();

    // ペイロード最小チェック: [FSv3(4)][DevID(4)][T(2)][H(2)][P(2)][V(2)] = 16バイト
    if (pay.size() < 16) return;

    // FOURCC確認 "FSv3"
    if (pay[0] != 'F' || pay[1] != 'S' || pay[2] != 'v' || pay[3] != '3') return;

    // ペイロードパース
    uint32_t child_id  = 0;
    int16_t  temp_raw  = 0;
    int16_t  humid_raw = 0;
    uint16_t pres_raw  = 0;
    uint16_t vcc_raw   = 0;

    auto np = pay.begin() + 4;  // FOURCC の次から
    expand_bytes(np, pay.end()
        , child_id
        , temp_raw
        , humid_raw
        , pres_raw
        , vcc_raw
    );

    uint8_t lqi = rx.get_lqi();

    // ESP32向け UART フレーム構築 (17バイト)
    // [0xA5][0x04][CHILD_ID_4][TEMP_2][HUMID_2][PRES_2][LQI_1][BAT_2][CHKSUM][0x5A]
    uint8_t frame[17];
    frame[0]  = 0xA5;
    frame[1]  = 0x04;  // MWX データ識別子
    frame[2]  = (child_id >> 24) & 0xFF;
    frame[3]  = (child_id >> 16) & 0xFF;
    frame[4]  = (child_id >>  8) & 0xFF;
    frame[5]  =  child_id        & 0xFF;
    frame[6]  = (uint8_t)((temp_raw  >> 8) & 0xFF);
    frame[7]  = (uint8_t)( temp_raw        & 0xFF);
    frame[8]  = (uint8_t)((humid_raw >> 8) & 0xFF);
    frame[9]  = (uint8_t)( humid_raw       & 0xFF);
    frame[10] = (uint8_t)((pres_raw  >> 8) & 0xFF);
    frame[11] = (uint8_t)( pres_raw        & 0xFF);
    frame[12] = lqi;
    frame[13] = (uint8_t)((vcc_raw   >> 8) & 0xFF);
    frame[14] = (uint8_t)( vcc_raw         & 0xFF);
    frame[15] = calc_checksum(frame, 15);  // bytes[1]..bytes[14] の XOR
    frame[16] = 0x5A;

    Serial.write(frame, 17);

    b_handled = true;
}
