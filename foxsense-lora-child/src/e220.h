#ifndef E220_H
#define E220_H

// =====================================================================
// E220-900T22S(JP) (CLEALINK/EBYTE 技適920MHz LoRa) ドライバ  ※親機・子機共用
// ---------------------------------------------------------------------
// - UART接続。M0/M1でモード切替(HIGH,HIGH=設定, LOW,LOW=通常/透過)
// - 設定モード/通常モードとも UART 9600 8N1（REG0のUART速度も9600に設定）
// - 透過モード: 送信=UARTへ生バイト書込 / 受信=UARTから生バイト。
//   → 0xA5..0x5A フレームは本ドライバ内でフレーミングして送受する。
// - RSSIバイト有効時(親機)、受信データ末尾に1バイト付与: dBm = raw - 256
//
// レジスタ(C0 00 08 で 00h..07h 一括書込):
//   00h ADDH, 01h ADDL,
//   02h REG0: UART[7:5] | SF[4:2] | BW[1:0]
//   03h REG1: subpacket[7:6] | RSSInoise[5] | power[1:0]
//   04h REG2: channel,
//   05h REG3: RSSIbyte[7] | txmethod[6](0=透過) | worcycle[2:0]
//   06h CRYPT_H, 07h CRYPT_L
//   UART: 011=9600 / SF7=010 / BW125=00 → REG0=0x68
//   power: 00=22dBm,01=13,10=7,11=0 / RSSIbyte parent=1(0x80) child=0
// 参考: github.com/nihinihikun/E220-900T22S-JP_Arduino
// =====================================================================

#include <Arduino.h>

struct E220Config {
    uint16_t address;    // ADDH/ADDL（透過モードでは全ノード同一・同一chで通信）
    uint8_t  sf;         // 5..11 (通常7)
    uint16_t bw;         // 125/250/500 (500はuint8_tに収まらないため16bit)
    uint8_t  channel;    // REG2 (親子で一致必須)
    uint8_t  powerDbm;   // 22/13/7/0
    bool     rssiByte;   // 受信データ末尾にRSSI付与（親機=true, 子機=false）
};

class E220 {
public:
    E220(Stream& serial, int m0Pin, int m1Pin, int auxPin = -1)
        : _s(serial), _m0(m0Pin), _m1(m1Pin), _aux(auxPin), _rssiByte(false) {}

    // 設定モードでレジスタ書込 → 通常(透過)モードへ
    bool begin(const E220Config& cfg) {
        _rssiByte = cfg.rssiByte;
        pinMode(_m0, OUTPUT);
        pinMode(_m1, OUTPUT);
        if (_aux >= 0) pinMode(_aux, INPUT);

        configMode();                 // M0=1,M1=1
        drain();

        // 8バイトのレジスタ設定を組み立て
        uint8_t reg0 = (uartBits(9600) << 5) | (sfBits(cfg.sf) << 2) | bwBits(cfg.bw);
        uint8_t reg1 = (0x00 << 6) | (0 << 5) | powerBits(cfg.powerDbm);  // subpacket200,RSSInoise off
        uint8_t reg3 = (cfg.rssiByte ? 0x80 : 0x00) | 0x00 | 0x00;        // txmethod=透過(0),wor0
        uint8_t data[8] = {
            (uint8_t)(cfg.address >> 8), (uint8_t)(cfg.address & 0xFF),
            reg0, reg1, cfg.channel, reg3, 0x00, 0x00
        };
        bool ok = writeRegisters(0x00, 8, data);

        normalMode();                 // M0=0,M1=0
        drain();
        return ok;
    }

    // 透過モードで payload(0xA5フレーム)を送信
    bool send(const uint8_t* data, uint8_t len) {
        _s.write(data, len);
        _s.flush();
        waitAuxOrDelay(120);          // 送信完了待ち
        return true;
    }

    // RF受信 payload(0xA5..0x5Aフレーム)を1件取得
    // 戻り値: payload長(>0), 0=タイムアウト, -1=フレーム異常
    // rssiOut: rssiByte有効時に受信RSSI(dBm)を格納
    int recv(uint8_t* out, uint8_t maxLen, int16_t* rssiOut, uint32_t timeoutMs) {
        uint32_t t0 = millis();
        while (millis() - t0 < timeoutMs) {
            int b = readByte(timeoutMs);
            if (b < 0) return 0;
            if (b != 0xA5) continue;              // ヘッダ検出

            if (maxLen < 4) return -1;
            out[0] = 0xA5;
            int ver = readByte(300); if (ver < 0) return -1; out[1] = (uint8_t)ver;
            int cmd = readByte(300); if (cmd < 0) return -1; out[2] = (uint8_t)cmd;

            int L = frameLen((uint8_t)ver, (uint8_t)cmd);
            if (L < 4 || L > maxLen) return -1;
            for (int i = 3; i < L; i++) {
                int x = readByte(300); if (x < 0) return -1;
                out[i] = (uint8_t)x;
            }
            if (out[L - 1] != 0x5A) return -1;    // フッタ不一致

            if (_rssiByte) {                       // 末尾のRSSIバイトを回収
                delay(10);                         // E220のRSSI算出待ち
                int r = readByte(300);
                if (r >= 0 && rssiOut) *rssiOut = (int16_t)(r - 256);
            }
            return L;
        }
        return 0;
    }

    // ディープスリープ用: M0=1,M1=1 に固定(E220も低消費モードへ)
    void enterConfigModePins() { configMode(); }

private:
    Stream& _s;
    int _m0, _m1, _aux;
    bool _rssiByte;

    void configMode() { digitalWrite(_m0, HIGH); digitalWrite(_m1, HIGH); delay(50); waitAuxOrDelay(50); }
    void normalMode() { digitalWrite(_m0, LOW);  digitalWrite(_m1, LOW);  delay(50); waitAuxOrDelay(50); }
    void drain()      { while (_s.available()) _s.read(); }

    void waitAuxOrDelay(uint32_t ms) {
        if (_aux < 0) { delay(ms); return; }
        uint32_t t0 = millis();
        while (digitalRead(_aux) == LOW && millis() - t0 < ms) delay(1);
        delay(2);
    }

    int readByte(uint32_t timeoutMs) {
        uint32_t t0 = millis();
        while (millis() - t0 < timeoutMs) {
            if (_s.available()) return _s.read();
        }
        return -1;
    }

    // C0 <addr> <len> <data...> でレジスタ書込、C1応答を回収
    bool writeRegisters(uint8_t addr, uint8_t len, const uint8_t* data) {
        uint8_t hdr[3] = {0xC0, addr, len};
        _s.write(hdr, 3);
        _s.write(data, len);
        _s.flush();
        delay(500);
        // 応答(C1 ...)を読み捨て（先頭C1確認）
        bool sawC1 = false;
        uint32_t t0 = millis();
        while (millis() - t0 < 500) {
            int b = readByte(200);
            if (b < 0) break;
            if (b == 0xC1) sawC1 = true;
        }
        return sawC1;
    }

    // フレーム全長(ヘッダ〜フッタ)をコマンドから決定
    static int frameLen(uint8_t ver, uint8_t cmd) {
        switch (cmd) {
            case 0x01: return 13;                 // WAKE
            case 0x02: return (ver == 0x03) ? 21 : 19;  // DATA (v3/v2)
            case 0x10: return 14;                 // PAIR
            case 0x11: return 14;                 // PAIR_ACK
            case 0x12: return 14;                 // DATA_ACK
            default:   return -1;
        }
    }

    static uint8_t uartBits(uint32_t b) {
        switch (b) { case 1200:return 0; case 2400:return 1; case 4800:return 2;
            case 9600:return 3; case 19200:return 4; case 38400:return 5;
            case 57600:return 6; case 115200:return 7; default:return 3; }
    }
    static uint8_t sfBits(uint8_t sf) { return (sf >= 5 && sf <= 11) ? (uint8_t)(sf - 5) : 2; } // 010=SF7
    static uint8_t bwBits(uint16_t bw) { return (bw == 250) ? 1 : (bw == 500) ? 2 : 0; }
    static uint8_t powerBits(uint8_t p){ return (p == 13) ? 1 : (p == 7) ? 2 : (p == 0) ? 3 : 0; } // 00=22dBm
};

#endif // E220_H
