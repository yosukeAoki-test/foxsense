#!/usr/bin/env python3
# 印刷ワーカー: pyserial経由でTEPRA SR-R2500Pに印刷
# 使用法: python3 print_worker.py <text> <tapeMm>
# 終了コード: 0=成功, 1=失敗

import sys
import struct
import time
import serial
import subprocess

PORT = '/dev/cu.SR-R2500P'

# テープ幅 → ピクセル数
TAPEMM_TO_PIXELS = {
    4: 32, 6: 52, 9: 54, 12: 72, 18: 108, 24: 128, 36: 192,
}

def make_frame(cmd, *params):
    body = bytes([cmd]) + bytes(params)
    chk = sum(body) & 0xFF
    return bytes([0x1B, 0x7B, len(body) + 2]) + body + bytes([chk, 0x7D])

def make_job_env():
    d = b''
    d += bytes([0x1B, 0x7B, 0x03, 0x40, 0x40, 0x7D])
    d += bytes([0x1B, 0x7B, 0x07, 0x7B, 0x00, 0x00, 0x53, 0x54, 0x22, 0x7D])
    d += bytes([0x1B, 0x7B, 0x07, 0x43, 0x01, 0x00, 0x00, 0x00, 0x44, 0x7D])
    d += bytes([0x1B, 0x7B, 0x04, 0x44, 0x00, 0x44, 0x7D])
    d += bytes([0x1B, 0x7B, 0x03, 0x47, 0x47, 0x7D])
    return d

def make_page_env(label_rows):
    b = struct.pack('<I', label_rows)
    sum_l = (0x4C + b[0] + b[1] + b[2] + b[3]) & 0xFF
    d = b''
    d += bytes([0x1B, 0x7B, 0x07, 0x4C, b[0], b[1], b[2], b[3], sum_l, 0x7D])
    d += bytes([0x1B, 0x7B, 0x05, 0x54, 0x00, 0x00, 0x54, 0x7D])
    d += bytes([0x1B, 0x7B, 0x03, 0x79, 0x79, 0x7D])
    return d

def make_raster_header(pixel_count):
    return bytes([0x1B, 0x2E, 0x00, 0x00, 0x00, 0x01,
                  pixel_count & 0xFF, (pixel_count >> 8) & 0xFF])

SEND_AND_CUT = bytes([0x1B, 0x7B, 0x04, 0x2B, 0x01, 0x2C, 0x7D])

def render_text_to_raster(text, tape_pixels):
    try:
        import CoreText
        import Quartz
    except ImportError:
        pass

    # CoreGraphics/CoreText を subprocess で Swift を使って呼ぶ代わりに
    # Pillow で代替描画
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print('[Worker] Pillow未インストール: pip3 install Pillow', file=sys.stderr)
        sys.exit(1)

    font_size = int(tape_pixels * 0.80)
    font_candidates = [
        '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/Arial.ttf',
    ]
    font = None
    for path in font_candidates:
        try:
            font = ImageFont.truetype(path, font_size)
            break
        except Exception:
            pass
    if font is None:
        font = ImageFont.load_default()

    # テキスト幅計測
    tmp = Image.new('L', (10000, tape_pixels), 255)
    draw = ImageDraw.Draw(tmp)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    margin = int(180.0 / 25.4 * 2)
    canvas_w = text_w + margin * 2
    canvas_h = tape_pixels

    img = Image.new('L', (canvas_w, canvas_h), 255)
    draw = ImageDraw.Draw(img)
    text_y = (canvas_h - text_h) // 2
    draw.text((margin, text_y), text, fill=0, font=font)

    bw = img.convert('1')
    raster_bytes_per_row = (canvas_h + 7) // 8
    raster_rows = []
    for col in range(canvas_w):
        row_bytes = bytearray(raster_bytes_per_row)
        for row in range(canvas_h):
            pixel = bw.getpixel((col, row))
            if pixel == 0:
                byte_idx = row // 8
                bit_idx = 7 - (row % 8)
                row_bytes[byte_idx] |= (1 << bit_idx)
        raster_rows.append(bytes(row_bytes))
    return raster_rows


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: print_worker.py <text> <tapeMm>', file=sys.stderr)
        sys.exit(1)

    print_text = sys.argv[1]
    tape_mm = int(sys.argv[2])
    tape_pixels = TAPEMM_TO_PIXELS.get(tape_mm, 72)
    tape_bytes_per_row = (tape_pixels + 7) // 8

    print(f'[Worker] 印刷開始: "{print_text}" tape={tape_mm}mm')
    print(f'[Worker] テープ: {tape_mm}mm → {tape_pixels}px')

    # ラスター化
    print(f'[Worker] ラスター化...')
    raster_rows = render_text_to_raster(print_text, tape_pixels)
    print(f'[Worker] ラスター行数: {len(raster_rows)}')

    # シリアルポートオープン
    try:
        ser = serial.Serial(PORT, 9600, timeout=5, rtscts=False, dsrdtr=False)
    except serial.SerialException as e:
        print(f'[Worker] シリアルポートオープン失敗: {e}', file=sys.stderr)
        sys.exit(1)

    print(f'[Worker] シリアルポートオープン: {PORT}')
    ser.reset_input_buffer()
    ser.reset_output_buffer()

    # 印刷シーケンス
    ser.write(make_job_env())
    ser.flush()
    time.sleep(1.0)

    ser.write(make_page_env(len(raster_rows)))
    ser.flush()
    time.sleep(0.5)

    raster_header = make_raster_header(tape_pixels)
    all_raster = b''
    for i, row_bytes in enumerate(raster_rows):
        line = raster_header
        if len(row_bytes) >= tape_bytes_per_row:
            line += row_bytes[:tape_bytes_per_row]
        else:
            line += row_bytes + bytes(tape_bytes_per_row - len(row_bytes))
        all_raster += line

    ser.write(all_raster)
    ser.flush()
    print(f'[Worker] ラスターデータ送信完了')
    time.sleep(2.0)

    print(f'[Worker] SEND_AND_CUT送信...')
    ser.write(SEND_AND_CUT)
    ser.flush()

    # プリンタからの応答を確認
    time.sleep(1.0)
    response = ser.read(256)
    if response:
        print(f'[Worker] プリンタ応答: {response.hex(" ")}')
    else:
        print(f'[Worker] プリンタ応答なし')

    time.sleep(8.0)
    ser.close()
    print('[Worker] 完了')
