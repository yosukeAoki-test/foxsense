#pragma once
/**
 * ir_control.h
 * 三菱霧ヶ峰 エアコン IRリモコン信号生成・送信
 *
 * 解析済みプロトコル (全モード実機キャプチャ確認済み):
 *   - 24バイト × 3フレーム送信
 *   - キャリア周波数: 38kHz
 *   - ヘッダー: mark=4400µs, space=2170µs
 *   - ビットmark: 580µs
 *   - bit0 space: 520µs, bit1 space: 1620µs
 *   - フレーム間隔: 45ms
 *
 * byte12 温度エンコード:
 *   COOL: bits[5:3]=(int(temp)-16), bit[2]=0.5°Cフラグ, bit[6]=toggle, bit[0]=1 (shift=3)
 *   HEAT/DRY: bits[5:2]=(int(temp)-16), bit[6]=toggle, bit[0]=1 (shift=2)
 *   FAN: 0x20固定 (toggle=0) / 0x60 (toggle=1)
 *
 * チェックサム (byte22-23, little-endian uint16):
 *   COOL: int(temp*8) + (toggle ? 340 : 276)
 *   HEAT: byte12 + 315
 *   DRY:  byte12 + byte13 + 347
 *   FAN:  toggle=0 → 0x01D4 / toggle=1 → 0x0214
 */

#include <Arduino.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include "config.h"

// ─── モード定義 ────────────────────────────────────────────
enum class AcMode : uint8_t {
    COOL = 0,   // 冷房
    HEAT = 1,   // 暖房
    DRY  = 2,   // 除湿
    FAN  = 3,   // 送風
    OFF  = 4,   // 停止 (実機キャプチャ: byte[10]=0x00, checksum=0x0239固定)
};

// ─── IRコントローラ ────────────────────────────────────────
class IrController {
public:
    IrController() : _ir(IR_TX_PIN) {}

    void begin() {
        _ir.begin();
    }

    // エアコン設定を送信
    // tempC: 20.0〜27.5 (0.5°Cステップ)、FAN時は無視
    void send(AcMode mode, float tempC) {
        uint8_t pkt[24];
        // toggle 0 → 1 → 0 の3フレーム送信
        for (uint8_t tog = 0; tog < 3; tog++) {
            buildPacket(pkt, mode, tempC, tog & 1);
            sendFrame(pkt);
            if (tog < 2) delay(45);  // フレーム間隔
        }
    }

private:
    IRsend _ir;

    // ─── パケット生成 ───────────────────────────────────────
    void buildPacket(uint8_t* p, AcMode mode, float tempC, uint8_t toggle) {
        // Byte 0-10: 固定ヘッダー
        const uint8_t hdr[] = {0x23,0xCB,0x26,0x01,0x00,0x8F,0x2C,0x9B,0x04,0x00,0x80};
        memcpy(p, hdr, 11);

        // OFFは固定パケット (実機キャプチャ確認済み)
        if (mode == AcMode::OFF) {
            p[10] = 0x00;                    // byte[10]: 0x80→0x00 が電源OFFフラグ
            p[11] = 0x60;                    // COOL (最後に使ったモードを記憶)
            p[12] = 0x25;                    // 温度固定 (トグルなし)
            p[13] = 0x18;
            // byte[14-19]: 他モードと同じ固定値 (未初期化ゴミ値を防ぐ)
            const uint8_t mid[] = {0x00,0x03,0x00,0x00,0x00,0x40};
            memcpy(p + 14, mid, 6);
            p[20] = 0x08;
            p[21] = 0x00;
            p[22] = 0x39; p[23] = 0x02;     // checksum = 0x0239 固定
            return;
        }

        // Byte 11: モード
        switch (mode) {
            case AcMode::COOL: p[11] = 0x60; break;
            case AcMode::HEAT: p[11] = 0x20; break;
            case AcMode::DRY:  p[11] = 0x40; break;
            case AcMode::FAN:  p[11] = 0xE0; break;
            default: break;
        }

        // Byte 12: 温度 + トグルビット(bit6)
        // COOL: bits[5:3]=(int(temp)-16), bit[2]=0.5°Cフラグ, bit[0]=1固定  (shift=3, 実機4点確認)
        // HEAT/DRY: bits[5:2]=(int(temp)-16), bit[0]=1固定  (shift=2, 実機6点確認)
        if (mode == AcMode::FAN) {
            p[12] = 0x20 | (toggle << 6);
        } else if (mode == AcMode::COOL) {
            int ti    = (int)tempC;
            uint8_t h = ((tempC - ti) >= 0.5f) ? 0x04 : 0x00;
            p[12] = (uint8_t)(((ti - 16) << 3) | h | 0x01 | (toggle << 6));
        } else {
            // HEAT / DRY: 0.5°Cステップなし、シフト2
            int ti = (int)tempC;
            p[12] = (uint8_t)(((ti - 16) << 2) | 0x01 | (toggle << 6));
        }

        // Byte 13: モード別設定
        switch (mode) {
            case AcMode::COOL: p[13] = 0x18; break;
            case AcMode::HEAT: p[13] = 0x00; break;
            case AcMode::DRY:  p[13] = 0x08; break;
            case AcMode::FAN:  p[13] = 0xC0; break;
            default: break;
        }

        // Byte 14-19: 固定
        const uint8_t mid[] = {0x00,0x03,0x00,0x00,0x00,0x40};
        memcpy(p + 14, mid, 6);

        // Byte 20: モード別フラグ (全モード実機確認済み)
        switch (mode) {
            case AcMode::COOL: p[20] = 0x08; break;
            case AcMode::HEAT: p[20] = 0x08; break;
            case AcMode::DRY:  p[20] = 0x08; break;
            case AcMode::FAN:  p[20] = 0x00; break;
            default: break;
        }

        // Byte 21: 固定
        p[21] = 0x00;

        // Byte 22-23: チェックサム (実機確認済み)
        //   COOL: val16 = int(temp*8) + (toggle ? 340 : 276)   7点確認
        //   HEAT: val16 = p[12] + 315                           6点確認
        //   DRY:  val16 = p[12] + p[13] + 347                  5点確認
        //   FAN:  固定 (toggle=0→0x01D4, toggle=1→0x0214)
        if (mode == AcMode::FAN) {
            uint16_t v = toggle ? 0x0214 : 0x01D4;
            p[22] = v & 0xFF;
            p[23] = v >> 8;
        } else if (mode == AcMode::COOL) {
            uint16_t v = (uint16_t)((int)(tempC * 8) + (toggle ? 340 : 276));
            p[22] = v & 0xFF;
            p[23] = v >> 8;
        } else if (mode == AcMode::HEAT) {
            uint16_t v = (uint16_t)(p[12] + 315);
            p[22] = v & 0xFF;
            p[23] = v >> 8;
        } else {  // DRY
            uint16_t v = (uint16_t)(p[12] + p[13] + 347);
            p[22] = v & 0xFF;
            p[23] = v >> 8;
        }
    }

    // ─── 1フレーム送信 ─────────────────────────────────────
    // rawデータ: mark/spaceを交互に配置 (µs単位、markから始まる)
    void sendFrame(const uint8_t* pkt) {
        // パルス数: 2(ヘッダー) + 24bytes*8bits*2 + 1(末尾mark) = 387
        const uint16_t HDR_MARK  = 4400;
        const uint16_t HDR_SPACE = 2170;
        const uint16_t BIT_MARK  =  580;
        const uint16_t ONE_SPACE = 1620;
        const uint16_t ZRO_SPACE =  520;
        const uint16_t END_MARK  =  580;

        uint16_t raw[387];
        int idx = 0;

        raw[idx++] = HDR_MARK;
        raw[idx++] = HDR_SPACE;

        for (int byte_i = 0; byte_i < 24; byte_i++) {
            for (int bit_i = 0; bit_i < 8; bit_i++) {
                raw[idx++] = BIT_MARK;
                raw[idx++] = (pkt[byte_i] >> bit_i) & 1 ? ONE_SPACE : ZRO_SPACE;
            }
        }
        raw[idx++] = END_MARK;

        _ir.sendRaw(raw, idx, 38);  // 38kHz
    }
};
