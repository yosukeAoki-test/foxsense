#!/usr/bin/swift
// TEPRA SR-R2500P 印刷テスト
// リバースエンジニアリングによりlibTepraPrint.soから解析したプロトコルを実装
//
// 解析結果:
//   makeJobEnvironmentCommand  → 39バイト (JobEnv)
//   makePageEnvironmentCommand → 24バイト (commandLevel=5, PriorityPrintSetting=1)
//   makeRasterCommand          → 1B 2E 00 00 00 01 [nL] [nH] + ceil(px/8)バイト
//   SEND_AND_CUT               → 1b 7b 04 2b 01 2c 7d

import Foundation
import IOBluetooth

// =============================================================================
// 設定
// =============================================================================

let MAC = "74:d5:c6:6c:9a:96"
let RFCOMM_CHANNEL: BluetoothRFCOMMChannelID = 6

// TW raw code → PrintCoreTapeWidth ordinal (tapeWidthFromLWStatusTWCode 解析結果)
let TW_TO_WIDTH: [Int: Int] = [
    0: 0,   // None
    1: 2,   // 6mm
    2: 3,   // 9mm
    3: 4,   // 12mm
    4: 5,   // 18mm
    5: 6,   // 24mm
    6: 7,   // 36mm
    7: 12,  // NewA50mm
    11: 1,  // 4mm
]

// PrintCoreTapeWidth ordinal → 180 DPI ピクセル数 (PrintableSizeTable[][0])
let WIDTH_TO_PIXELS: [Int: Int] = [
    1: 32,   // 4mm
    2: 52,   // 6mm
    3: 54,   // 9mm
    4: 72,   // 12mm  ← ステータス TW=3 の場合
    5: 108,  // 18mm
    6: 128,  // 24mm
    7: 192,  // 36mm
    12: 252, // NewA50mm (参考)
]

// =============================================================================
// フレームプロトコル
// =============================================================================

/// 基本フレーム: 1B 7B [LEN] [CMD] [params...] [SUM] 7D
/// LEN = n_params + 3 (CMD + SUM + フレーム長バイト自体を含む)
/// SUM = (CMD + all_params) & 0xFF
func makeFrame(_ cmd: UInt8, _ params: UInt8...) -> Data {
    let body = Data([cmd]) + Data(params)
    let sum = UInt8(body.reduce(0, { (Int($0) + Int($1)) & 0xFF }))
    return Data([0x1B, 0x7B, UInt8(body.count + 2)]) + body + Data([sum, 0x7D])
}

// ステータスコマンド (frame(0x49, ...))
let STATUS_OFF = makeFrame(0x49, 0x00, 0x00)  // 1b 7b 05 49 00 00 49 7d
let STATUS_ON  = makeFrame(0x49, 0x05, 0x00)  // 1b 7b 05 49 05 00 4e 7d

/// makeJobEnvironmentCommand デフォルト出力 (39バイト)
/// libTepraPrint.so 0x3c800 の解析結果
/// data[0x00..0x0f]: 0x1b550 から読み込んだ 16バイト定数
/// data[0x10..0x19]: frame(0x43=TapeCut, 0,0,0,0) = 10バイト
/// data[0x1a..0x20]: frame(0x44=Density, 0) = 7バイト
/// data[0x21..0x26]: frame(0x47='G') = 6バイト
func makeJobEnvironmentCommand() -> Data {
    var d = Data()
    // 0x1b550 の 16バイト定数: PRINT_END + job init
    d += Data([0x1B, 0x7B, 0x03, 0x40, 0x40, 0x7D])          // frame(0x40) PRINT_END
    d += Data([0x1B, 0x7B, 0x07, 0x7B, 0x00, 0x00, 0x53, 0x54, 0x22, 0x7D])  // frame(0x7b,0,0,0x53,0x54)
    // makeCommand(0x43=TapeCut, p0=0x01=EachLabel/cut-enabled)
    d += Data([0x1B, 0x7B, 0x07, 0x43, 0x01, 0x00, 0x00, 0x00, 0x44, 0x7D])  // frame(0x43,1,0,0,0)
    // makeCommand(0x44=Density, defaults=0)
    d += Data([0x1B, 0x7B, 0x04, 0x44, 0x00, 0x44, 0x7D])    // frame(0x44,0)
    // frame(0x47='G')
    d += Data([0x1B, 0x7B, 0x03, 0x47, 0x47, 0x7D])          // frame(0x47)
    return d  // 39バイト
}

/// makePageEnvironmentCommand (commandLevel=5, PriorityPrintSetting=1)
/// libTepraPrint.so 0x3d858 + 0x3dd20 の解析結果
/// - 'L' frame: label長 (4バイトLE, テープ縦方向のドット数)
/// - 'T' frame: マージン (2バイトLE, 通常0)
/// - 'y' frame: PriorityPrintSetting=1 の場合のみ (6バイト固定)
/// 合計 24バイト
func makePageEnvironmentCommand(labelRows: Int, margin: Int = 0) -> Data {
    // 'L' frame (10バイト): label length 4バイトLE
    let l0 = UInt8(labelRows & 0xFF)
    let l1 = UInt8((labelRows >> 8) & 0xFF)
    let l2 = UInt8((labelRows >> 16) & 0xFF)
    let l3 = UInt8((labelRows >> 24) & 0xFF)
    let sumL = UInt8((0x4C + Int(l0) + Int(l1) + Int(l2) + Int(l3)) & 0xFF)

    // 'T' frame (8バイト): margin 2バイトLE
    let p0 = UInt8(margin & 0xFF)
    let p1 = UInt8((margin >> 8) & 0xFF)
    let sumT = UInt8((0x54 + Int(p0) + Int(p1)) & 0xFF)

    var d = Data()
    d += Data([0x1B, 0x7B, 0x07, 0x4C, l0, l1, l2, l3, sumL, 0x7D])  // 'L'
    d += Data([0x1B, 0x7B, 0x05, 0x54, p0, p1, sumT, 0x7D])            // 'T'
    d += Data([0x1B, 0x7B, 0x03, 0x79, 0x79, 0x7D])                    // 'y' priority
    return d  // 24バイト
}

/// makeRasterCommand: ESC . 形式のラスターヘッダ
/// PrintController.java: {27, 46, 0, 0, 0, 1, nL, nH}
/// pixelCount = 1行あたりのピクセル数 (横方向)
func makeRasterHeader(pixelCount: Int) -> Data {
    let nL = UInt8(pixelCount & 0xFF)
    let nH = UInt8((pixelCount >> 8) & 0xFF)
    return Data([0x1B, 0x2E, 0x00, 0x00, 0x00, 0x01, nL, nH])
}

// OPERATION_SEND_AND_CUT (PrintController.java定数)
let SEND_AND_CUT = Data([0x1B, 0x7B, 0x04, 0x2B, 0x01, 0x2C, 0x7D])

// =============================================================================
// ヘルパー
// =============================================================================

func hexStr(_ d: Data) -> String {
    d.map { String(format: "%02x", $0) }.joined(separator: " ")
}

func runLoop(_ sec: TimeInterval) {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: sec))
}

// =============================================================================
// デリゲート
// =============================================================================

class RFCOMMDelegate: NSObject, IOBluetoothRFCOMMChannelDelegate {
    var buf = Data()

    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!,
                            data ptr: UnsafeMutableRawPointer!,
                            length len: Int) {
        let d = Data(bytes: ptr, count: len)
        buf += d
        print("[受信 \(buf.count)バイト] \(hexStr(d))")
    }

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        print("[INFO] チャンネルクローズ")
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        if error == kIOReturnSuccess {
            print("[INFO] チャンネルオープン完了")
        } else {
            print("[ERROR] チャンネルオープン失敗 status=\(error)")
        }
    }
}

// =============================================================================
// RFCOMM接続
// =============================================================================

guard let device = IOBluetoothDevice(addressString: MAC) else {
    print("デバイスが見つかりません: \(MAC)"); exit(1)
}
print("デバイス: \(device.nameOrAddress ?? "unknown"), 接続=\(device.isConnected())")

if !device.isConnected() {
    print("接続中...")
    device.openConnection()
    runLoop(2.0)
}
print("接続状態: \(device.isConnected())")

let delegate = RFCOMMDelegate()
var channel: IOBluetoothRFCOMMChannel? = nil
let openResult = device.openRFCOMMChannelSync(&channel, withChannelID: RFCOMM_CHANNEL, delegate: delegate)

guard openResult == kIOReturnSuccess, let rfcomm = channel else {
    print("RFCOMM ch\(RFCOMM_CHANNEL) オープン失敗: \(openResult)"); exit(1)
}
print("RFCOMM ch\(rfcomm.getID()) オープン OK, MTU=\(rfcomm.getMTU())")

// 送信ヘルパー
func send(_ data: Data, label: String) {
    print("\n[送信 \(data.count)バイト] \(label)")
    print("  \(hexStr(data))")
    var bytes = [UInt8](data)
    let r = bytes.withUnsafeMutableBytes { ptr in
        rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
    }
    if r != kIOReturnSuccess { print("  !! writeSync エラー: \(r)") }
}

// 接続直後の自発応答を確認
print("\n=== 自発応答待ち 2秒 ===")
runLoop(2.0)
if delegate.buf.count > 0 {
    print("自発受信: \(delegate.buf.count)バイト")
}

// =============================================================================
// Step 1: ステータス確認 → テープ幅取得
// =============================================================================

print("\n=== Step 1: STATUS_OFF でテープ確認 ===")
delegate.buf = Data()
send(STATUS_OFF, label: "STATUS_OFF")
runLoop(3.0)

var tapePixels = 72  // デフォルト: 12mm tape at 180 DPI
var tapeBytesPerRow = 9

if delegate.buf.count >= 17 {
    let twRaw = Int(delegate.buf[16])
    let widthOrdinal = TW_TO_WIDTH[twRaw] ?? -1
    let pixels = WIDTH_TO_PIXELS[widthOrdinal] ?? 72
    tapePixels = pixels
    tapeBytesPerRow = (pixels + 7) / 8
    print("TW raw=\(twRaw) → PrintCoreTapeWidth=\(widthOrdinal) → \(pixels)px/行, \(tapeBytesPerRow)バイト/行")
} else {
    print("ステータス応答なし、デフォルト \(tapePixels)px/行 を使用")
}

// =============================================================================
// Step 2: makeJobEnvironmentCommand
// =============================================================================

print("\n=== Step 2: JobEnvironmentCommand (39バイト) ===")
let jobEnv = makeJobEnvironmentCommand()
delegate.buf = Data()
send(jobEnv, label: "JobEnvironment")
runLoop(1.0)

// =============================================================================
// Step 3: makePageEnvironmentCommand
// =============================================================================

// テストラベル: 30mm長
let LABEL_MM = 30
let LABEL_ROWS = Int(Double(LABEL_MM) * 180.0 / 25.4)  // ≈ 213 rows

print("\n=== Step 3: PageEnvironmentCommand ===")
print("  ラベル: \(LABEL_MM)mm = \(LABEL_ROWS)行, 幅: \(tapePixels)px × \(tapeBytesPerRow)バイト")

let pageEnv = makePageEnvironmentCommand(labelRows: LABEL_ROWS, margin: 0)
delegate.buf = Data()
send(pageEnv, label: "PageEnvironment (labelRows=\(LABEL_ROWS))")
runLoop(0.5)

// =============================================================================
// Step 4: ラスターデータ
// =============================================================================

print("\n=== Step 4: ラスターデータ送信 (\(LABEL_ROWS)行) ===")

let rasterHeader = makeRasterHeader(pixelCount: tapePixels)

// テストパターン: 外枠1px + 内部チェック模様
for row in 0..<LABEL_ROWS {
    var lineData = Data()
    lineData += rasterHeader

    // ピクセルバイト生成 (1=黒, 0=白, MSB first)
    var pixelBytes = [UInt8](repeating: 0x00, count: tapeBytesPerRow)

    let isTopBottom = (row < 2 || row >= LABEL_ROWS - 2)

    for byteIdx in 0..<tapeBytesPerRow {
        var b: UInt8 = 0x00
        for bit in 0..<8 {
            let pixelX = byteIdx * 8 + bit
            if pixelX >= tapePixels { break }

            let isLeftRight = (pixelX < 2 || pixelX >= tapePixels - 2)
            let isCheckerboard = ((row / 4 + pixelX / 4) % 2 == 0)

            let isBlack: Bool
            if isTopBottom || isLeftRight {
                isBlack = true  // 外枠
            } else if row >= LABEL_ROWS / 4 && row < LABEL_ROWS * 3 / 4 {
                isBlack = isCheckerboard  // 中央部にチェック模様
            } else {
                isBlack = false
            }

            if isBlack {
                b |= UInt8(0x80 >> bit)  // MSB first
            }
        }
        pixelBytes[byteIdx] = b
    }

    lineData += Data(pixelBytes)

    var bytes = [UInt8](lineData)
    let r = bytes.withUnsafeMutableBytes { ptr in
        rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
    }
    if r != kIOReturnSuccess {
        print("  !! 行\(row) writeSync エラー: \(r)")
    }

    if row % 50 == 0 {
        print("  \(row)/\(LABEL_ROWS) 行送信完了")
        runLoop(0.05)  // 送信バッファに少し余裕を与える
    }
}

print("ラスターデータ送信完了 (\(LABEL_ROWS)行)")
runLoop(2.0)

// =============================================================================
// Step 5: STATUS確認 (ST値をログするのみ、待機なし)
// =============================================================================

print("\n=== Step 5: ラスター送信後STATUSチェック ===")
delegate.buf = Data()
var statusBytes = [UInt8](STATUS_OFF)
let _ = statusBytes.withUnsafeMutableBytes { ptr in
    rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
}
runLoop(1.0)
if delegate.buf.count >= 15 {
    let st = delegate.buf[14]
    print("  ST=\(st) (0x\(String(format:"%02x", st)))")
} else {
    print("  STATUS応答なし (\(delegate.buf.count)バイト)")
}

// =============================================================================
// Step 6: SEND_AND_CUT
// =============================================================================

print("\n=== Step 6: SEND_AND_CUT ===")
delegate.buf = Data()
send(SEND_AND_CUT, label: "SEND_AND_CUT")
runLoop(8.0)

if delegate.buf.count > 0 {
    print("応答: \(delegate.buf.count)バイト: \(hexStr(delegate.buf))")
} else {
    print("応答なし (カット実行中?)")
}

rfcomm.close()
print("\n=== 印刷テスト完了 ===")
print("テープが出てきたか確認してください")
