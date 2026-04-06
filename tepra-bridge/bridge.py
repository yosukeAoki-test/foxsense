#!/opt/homebrew/bin/python3.11
"""
Tepra SR-R2500P Bridge Server
localhost:3333 でHTTPを待受し、/dev/cu.SR-R2500P にシリアル送信する。

Usage:
    pip3 install pyserial Pillow qrcode[pil]
    python3 bridge.py
"""

import io
import json
import logging
import os
import struct
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    import serial
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:
    print(f"Missing package: {e}")
    print("Run: pip3 install pyserial Pillow qrcode[pil]")
    sys.exit(1)

# ── 設定 ─────────────────────────────────────────────
PORT_DEVICE = "/dev/cu.SR-R2500P"
BAUD_RATE   = 9600      # BT SPP では実質不問だが一応設定
SERVER_PORT = 3333

# テープ幅別の印字ドット数 (180 DPI 相当)
TAPE_DOTS = {
    18: 128,
    12: 96,
    9:  64,
}

# システムフォントの候補（macOS）
FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
]

# ── ロガー ────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)


# ── ラベル画像生成 ────────────────────────────────────
def _best_font(size: int):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def generate_label_image(device_id: str, tape_mm: int = 18) -> Image.Image:
    """
    デバイスID + QRコードのラベル画像（1-bit）を生成する。
    画像の高さ = テープ幅 (ドット数)
    画像の幅   = QR + テキストの合計
    """
    tape_h = TAPE_DOTS.get(tape_mm, 128)
    margin = 4
    available_qr = tape_h - margin * 2
    BORDER = 4  # QR規格準拠: 最小4モジュールのクワイエットゾーン

    # box_size=1で仮生成してモジュール数を取得
    qr_tmp = qrcode.QRCode(version=None,
                            error_correction=qrcode.constants.ERROR_CORRECT_Q,
                            box_size=1, border=BORDER)
    qr_tmp.add_data(device_id)
    qr_tmp.make(fit=True)
    total_modules = qr_tmp.modules_count + BORDER * 2
    box_size = max(1, available_qr // total_modules)

    # 本番生成（整数倍・リサイズなし）
    qr = qrcode.QRCode(version=None,
                        error_correction=qrcode.constants.ERROR_CORRECT_Q,
                        box_size=box_size, border=BORDER)
    qr.add_data(device_id)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("L")
    qr_size = qr_img.size[0]

    # テキスト
    font_size = max(8, tape_h // 3)
    font = _best_font(font_size)

    # テキスト幅を計測
    tmp = Image.new("L", (1000, tape_h), 255)
    draw = ImageDraw.Draw(tmp)
    bbox = draw.textbbox((0, 0), device_id, font=font)
    text_w = bbox[2] - bbox[0] + 8
    text_h = bbox[3] - bbox[1]

    # ラベル画像を合成（QRを縦中央揃え）
    total_w = margin + qr_size + margin + text_w + margin
    label = Image.new("L", (total_w, tape_h), 255)
    qr_y = (tape_h - qr_size) // 2
    label.paste(qr_img, (margin, qr_y))

    draw = ImageDraw.Draw(label)
    text_x = margin + qr_size + margin
    text_y = (tape_h - text_h) // 2
    draw.text((text_x, text_y), device_id, fill=0, font=font)

    return label


# ── ラスターデータ変換 ────────────────────────────────
def image_to_raster(img: Image.Image, tape_mm: int = 18) -> bytes:
    """
    PIL画像を TEPRA/Brother PT 互換ラスターコマンドに変換する。

    画像の縦（height）= テープの幅方向
    画像の横（width） = テープの長さ方向（送り方向）

    ラスター1行 = テープ幅分のビット列 = 1列分のピクセル
    """
    bw = img.convert("1")  # 1bit
    width, height = bw.size

    # 1行あたりのバイト数（テープ幅方向）
    row_bytes = (height + 7) // 8

    buf = bytearray()

    # ── 初期化シーケンス ──
    # NULL padding（プリンタを確実にアイドル状態にする）
    buf += b'\x00' * 100

    # ESC @ : 初期化
    buf += b'\x1b\x40'

    # ESC i a 0x01 : ラスターモード切替
    buf += b'\x1b\x69\x61\x01'

    # ESC i z : メディア情報 (Brother PT 互換)
    # [0x84, 0x00, tape_mm, 0, 0, 0, 0, 0, 0, 0]
    tape_b = tape_mm & 0xFF
    buf += b'\x1b\x69\x7a'
    buf += bytes([0x84, 0x00, tape_b, 0x00,
                  0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

    # ESC i M 0x40 : 通常品質
    buf += b'\x1b\x69\x4d\x40'

    # ESC i K 0x08 : カット設定（印刷後カット）
    buf += b'\x1b\x69\x4b\x08'

    # ESC i d : マージン（先頭マージン = 14 dots, 2バイトLE）
    buf += b'\x1b\x69\x64' + struct.pack('<H', 14)

    # ── ラスターデータ ──
    for x in range(width):
        row_data = bytearray(row_bytes)
        for y in range(height):
            pixel = bw.getpixel((x, y))
            if pixel == 0:  # 黒ピクセル
                byte_idx = y // 8
                bit_idx  = 7 - (y % 8)
                row_data[byte_idx] |= (1 << bit_idx)

        # G 0x00 n_bytes data : ラスター行
        buf += bytes([0x47, 0x00, row_bytes]) + bytes(row_data)

    # ── 印刷 + カット ──
    buf += b'\x1a\x01'  # FF + 0x01

    return bytes(buf)


# ── シリアル送信 ──────────────────────────────────────
def send_to_printer(data: bytes) -> dict:
    if not os.path.exists(PORT_DEVICE):
        return {"ok": False, "error": f"{PORT_DEVICE} not found. Is Tepra paired & BT on?"}

    try:
        with serial.Serial(PORT_DEVICE, BAUD_RATE, timeout=10) as ser:
            ser.write(data)
            ser.flush()
            log.info(f"Sent {len(data)} bytes to {PORT_DEVICE}")
        return {"ok": True, "bytes": len(data)}
    except serial.SerialException as e:
        log.error(f"Serial error: {e}")
        return {"ok": False, "error": str(e)}
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ── HTTP サーバー ─────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log.info(format % args)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, body: dict):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    # GET /status
    def do_GET(self):
        if self.path == "/status":
            exists = os.path.exists(PORT_DEVICE)
            self._json(200, {
                "ok":      True,
                "device":  PORT_DEVICE,
                "present": exists,
            })
        elif self.path == "/preview":
            # デバッグ用：サンプルラベルをPNGで返す
            img = generate_label_image("AABBCCDD", 18)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            self.wfile.write(buf.getvalue())
        else:
            self._json(404, {"ok": False, "error": "Not found"})

    # POST /print
    def do_POST(self):
        if self.path != "/print":
            self._json(404, {"ok": False, "error": "Not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        try:
            req      = json.loads(raw)
            device_id = req.get("deviceId", "").strip().upper()
            tape_mm   = int(req.get("tapeMm", 18))

            if not device_id:
                self._json(400, {"ok": False, "error": "deviceId is required"})
                return

            log.info(f"Print: deviceId={device_id} tape={tape_mm}mm")

            img    = generate_label_image(device_id, tape_mm)
            raster = image_to_raster(img, tape_mm)
            result = send_to_printer(raster)

            self._json(200 if result["ok"] else 500, result)

        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "Invalid JSON"})
        except Exception as e:
            log.error(f"Error: {e}", exc_info=True)
            self._json(500, {"ok": False, "error": str(e)})


# ── エントリポイント ──────────────────────────────────
if __name__ == "__main__":
    log.info("=" * 50)
    log.info(f"Tepra Bridge Server starting on port {SERVER_PORT}")
    log.info(f"Serial device : {PORT_DEVICE}")
    log.info(f"Preview URL   : http://localhost:{SERVER_PORT}/preview")
    log.info(f"Status URL    : http://localhost:{SERVER_PORT}/status")
    log.info("=" * 50)

    if not os.path.exists(PORT_DEVICE):
        log.warning(f"⚠  {PORT_DEVICE} が見つかりません。テプラのBluetoothをオンにしてペアリングしてください。")

    server = HTTPServer(("localhost", SERVER_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
