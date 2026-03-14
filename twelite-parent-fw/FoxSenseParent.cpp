/**
 * FoxSense 親機 TWELITE ファームウェア (MWX版 v2)
 * TWELITE DIP (ESP32 UART2 に接続)
 *
 * 動作:
 *   通常: 子機からの NWK_SIMPLE パケットを受信 → UART で ESP32 に転送
 *   トリガー受信時: 15秒間 "FSW1" ブロードキャスト → 子機を起こす
 *
 * ESP32 → TWELITE UART コマンド:
 *   [0xA5][0x01][0x01][0x5A] (4バイト) → 起床信号ブロードキャスト開始
 *
 * TWELITE → ESP32 UART 出力 (子機データ受信時):
 *   [0xA5][0x04][CHILD_ID_4][TEMP_I16_2][HUMID_I16_2][PRES_U16_2][LQI_1][VCC_U16_2][CHKSUM][0x5A]
 *   合計 17バイト
 *   TEMP  : °C × 100 (int16_t)
 *   HUMID : % × 100  (int16_t)
 *   PRES  : hPa × 10 (uint16_t)
 *   LQI   : 受信強度 (uint8_t, TWELITE LQI値)
 *   VCC   : 子機電圧 mV (uint16_t)
 *   CHKSUM: bytes[1]~[14] の XOR
 *
 * ネットワーク設定:
 *   APP_ID/CH は子機と同じ値にすること
 *   デフォルト: APP_ID=0x46534E53("FSNS"), CH=13
 *   DIO12 → GND でインタラクティブモード起動
 */

#include <TWELITE>
#include <NWK_SIMPLE>
#include <STG_STD>

// ============================================================
// ネットワーク設定
// ============================================================
const uint32_t DEF_APPID   = 0x46534E53;  // "FSNS" - 子機と一致
const uint8_t  DEF_CHANNEL = 13;
const char     APP_NAME[]  = "FoxSense Parent";
const uint8_t  FOURCC_WAKE[] = "FSW1";    // 起床信号 FOURCC

uint32_t APP_ID  = DEF_APPID;
uint8_t  CHANNEL = DEF_CHANNEL;

// ============================================================
// 起床信号ブロードキャスト設定
// ============================================================
static const uint32_t WAKE_DURATION_MS  = 15000;  // 送信継続時間
static const uint32_t WAKE_INTERVAL_MS  = 40;     // 送信間隔 (40ms → 50ms窓で確実に届く)

// ============================================================
// 状態機械
// ============================================================
enum class E_STATE : uint8_t { IDLE, TX_WAKE };
E_STATE eState = E_STATE::IDLE;

uint32_t wake_start_ms   = 0;
uint32_t last_wake_tx_ms = 0;
uint8_t  last_wake_txid  = 0;

// ============================================================
// UART コマンド受信バッファ
// ============================================================
static uint8_t uart_buf[4];
static int     uart_idx = 0;

// ============================================================
// チェックサム (bytes[1]..bytes[n-1] の XOR)
// ============================================================
static uint8_t calc_checksum(const uint8_t* buf, int len) {
    uint8_t cs = 0;
    for (int i = 1; i < len; i++) cs ^= buf[i];
    return cs;
}

// ============================================================
// setup()
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
        the_twelite.begin();
        return;
    }

    set.reload();
    APP_ID  = set.u32appid();
    CHANNEL = set.u8ch();

    the_twelite
        << TWENET::appid(APP_ID)
        << TWENET::channel(CHANNEL)
        << TWENET::rx_when_idle();  // 常時受信

    auto&& nwk = the_twelite.network.use<NWK_SIMPLE>();
    nwk << NWK_SIMPLE::logical_id(0x00);  // 親機

    the_twelite.begin();

    Serial << "--- " << APP_NAME << " ---" << crlf;
    Serial << format("APP_ID=%08X CH=%d", APP_ID, CHANNEL) << crlf;
}

// ============================================================
// loop() - UART コマンド受信 + 起床信号ブロードキャスト
// ============================================================
void loop() {
    // ── UART コマンド受信 ──────────────────────────────
    while (Serial.available()) {
        uint8_t b = Serial.read();
        if (uart_idx == 0 && b != 0xA5) continue;  // ヘッダー待ち
        uart_buf[uart_idx++] = b;
        if (uart_idx < 4) continue;
        uart_idx = 0;
        // [0xA5][0x01][0x01][0x5A] = 起床信号トリガー
        if (uart_buf[1] == 0x01 && uart_buf[2] == 0x01 && uart_buf[3] == 0x5A) {
            eState         = E_STATE::TX_WAKE;
            wake_start_ms  = millis();
            last_wake_tx_ms = 0;
        }
    }

    // ── 起床信号ブロードキャスト ──────────────────────
    if (eState == E_STATE::TX_WAKE) {
        if (millis() - wake_start_ms >= WAKE_DURATION_MS) {
            eState = E_STATE::IDLE;  // 15秒経過 → 停止
        } else if (millis() - last_wake_tx_ms >= WAKE_INTERVAL_MS) {
            if (auto&& pkt = the_twelite.network.use<NWK_SIMPLE>().prepare_tx_packet()) {
                pkt << tx_addr(0xFF)    // ブロードキャスト
                    << tx_retry(0x0)    // リトライなし (頻繁に送るので不要)
                    << tx_packet_delay(0, 0, 0);
                pack_bytes(pkt.get_payload(), make_pair(FOURCC_WAKE, 4));
                MWX_APIRET ret = pkt.transmit();
                if (ret) last_wake_txid = ret.get_value() & 0xFF;
            }
            last_wake_tx_ms = millis();
        }
    }
}

// ============================================================
// on_rx_packet() - 子機パケット受信 → ESP32 UART 転送
// ============================================================
void on_rx_packet(packet_rx& rx, bool_t& b_handled) {
    auto pay = rx.get_payload();

    // ペイロード最小チェック: [FSv3(4)][DevID(4)][T(2)][H(2)][P(2)][V(2)] = 16バイト
    if (pay.size() < 16) return;
    if (pay[0] != 'F' || pay[1] != 'S' || pay[2] != 'v' || pay[3] != '3') return;

    // パース
    uint32_t child_id  = 0;
    int16_t  temp_raw  = 0;
    int16_t  humid_raw = 0;
    uint16_t pres_raw  = 0;
    uint16_t vcc_raw   = 0;

    auto np = pay.begin() + 4;
    expand_bytes(np, pay.end(), child_id, temp_raw, humid_raw, pres_raw, vcc_raw);

    uint8_t lqi = rx.get_lqi();

    // ESP32向け 17バイトフレーム組み立て
    // [0xA5][0x04][CHILD_ID_4][TEMP_2][HUMID_2][PRES_2][LQI_1][VCC_2][CHKSUM][0x5A]
    uint8_t frame[17];
    frame[0]  = 0xA5;
    frame[1]  = 0x04;
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
    frame[15] = calc_checksum(frame, 15);  // bytes[1]~[14] の XOR
    frame[16] = 0x5A;

    Serial.write(frame, 17);
    b_handled = true;
}
