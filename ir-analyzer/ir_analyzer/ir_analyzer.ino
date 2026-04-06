/*
 * ATTiny85 IR Signal Analyzer v2
 * - ビットをオンザフライでデコードしバイト保存 → RAM節約
 * - END_GAP 40ms → フレーム間ギャップを跨がずに捕捉
 * - フレームを最大4つまで連続表示
 *
 * Board  : ATtiny85 (ATTinyCore), 8 MHz Internal
 * 接続   : OSRB38C9AA OUT→PB2(pin7), TX→PB3(pin2)→USB-serial RX
 */

#define IR_BIT      PB2
#define TX_BIT      PB3
#define BAUD_US     104     // 9600bps @ 8MHz
#define POLL_US     4       // ポーリング間隔
#define END_GAP_US  40000UL // 40ms gap → 信号終了
#define MAX_BYTES   24      // 最大24バイト (192ビット)
#define BIT_THR     1000    // 1000µs以上のspaceは bit=1

// ─── UART ────────────────────────────────────────────────
static void txChar(char c) {
  cli();
  PORTB &= ~(1 << TX_BIT);
  delayMicroseconds(BAUD_US);
  for (uint8_t i = 0; i < 8; i++) {
    if ((c >> i) & 1) PORTB |=  (1 << TX_BIT);
    else              PORTB &= ~(1 << TX_BIT);
    delayMicroseconds(BAUD_US);
  }
  PORTB |= (1 << TX_BIT);
  delayMicroseconds(BAUD_US);
  sei();
}

static void txStr(const char *s) { while (*s) txChar(*s++); }

static void txHex(uint8_t v) {
  const char *h = "0123456789ABCDEF";
  txChar(h[v >> 4]);
  txChar(h[v & 0xF]);
}

static void txUInt(uint16_t v) {
  if (v == 0) { txChar('0'); return; }
  char buf[6]; int8_t i = 5;
  buf[i] = '\0';
  while (v) { buf[--i] = '0' + (v % 10); v /= 10; }
  txStr(buf + i);
}

// ─── Setup ───────────────────────────────────────────────
void setup() {
  DDRB  |=  (1 << TX_BIT); PORTB |=  (1 << TX_BIT);
  DDRB  &= ~(1 << IR_BIT); PORTB &= ~(1 << IR_BIT);
  delay(200);
  txStr("=== IR Analyzer v2 ===\r\nリモコンのボタンを押してください...\r\n\r\n");
}

// ─── 1フレームキャプチャ・デコード ───────────────────────
// 戻り値: 取得バイト数 (0=タイムアウト/ノイズ)
static uint8_t captureFrame(uint8_t *out, uint16_t *hdrLow, uint16_t *hdrHigh) {
  // LOW立ち下がりエッジ待ち
  while (PINB & (1 << IR_BIT));

  // LOW幅計測 (ヘッダーのマーク)
  uint16_t w = 0;
  while (!(PINB & (1 << IR_BIT))) {
    delayMicroseconds(POLL_US); w += POLL_US;
    if (w > 30000) return 0;
  }
  *hdrLow = w;

  // HIGH幅計測 (ヘッダーのスペース)
  w = 0;
  while (PINB & (1 << IR_BIT)) {
    delayMicroseconds(POLL_US); w += POLL_US;
    if (w >= END_GAP_US) return 0; // ヘッダーなし
  }
  *hdrHigh = w;

  // ビットデコードループ
  uint8_t byteCount = 0, bitPos = 0;
  uint8_t cur = 0;

  while (byteCount < MAX_BYTES) {
    // LOW幅 (マーク) - 値は使わないが計測は必要
    w = 0;
    while (!(PINB & (1 << IR_BIT))) {
      delayMicroseconds(POLL_US); w += POLL_US;
      if (w > 10000) goto done;
    }

    // HIGH幅 (スペース) → ビット判定
    w = 0;
    while (PINB & (1 << IR_BIT)) {
      delayMicroseconds(POLL_US); w += POLL_US;
      if (w >= END_GAP_US) goto done;
    }

    // ビット格納 (LSB first)
    if (w > BIT_THR) cur |= (1 << bitPos);
    if (++bitPos == 8) {
      out[byteCount++] = cur;
      cur = 0; bitPos = 0;
    }
  }

done:
  // 残りビットがあればフラッシュ
  if (bitPos > 0 && byteCount < MAX_BYTES)
    out[byteCount++] = cur;
  return byteCount;
}

// ─── Main ────────────────────────────────────────────────
void loop() {
  uint8_t data[MAX_BYTES];
  uint16_t hLow, hHigh;
  uint8_t n = captureFrame(data, &hLow, &hHigh);

  if (n == 0) { delay(50); return; }

  txStr("--- Frame: ");
  txUInt(n);
  txStr("B  Hdr L:");
  txUInt(hLow);
  txStr(" H:");
  txUInt(hHigh);
  txStr(" ---\r\n");

  for (uint8_t i = 0; i < n; i++) {
    txHex(data[i]);
    txChar(' ');
  }
  txStr("\r\n--- End ---\r\n\r\n");

  delay(100);
}
