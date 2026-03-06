#!/usr/bin/swift
// 印刷ワーカー: RFCOMM ch6 経由でTEPRA SR-R2500Pに印刷
// run_print.sh から呼ばれる (blueutil disconnect→connect済み)
// 使用法: swift print_worker.swift <text> <tapeMm>

import Foundation
import IOBluetooth
import CoreGraphics
import CoreText

setvbuf(stdout, nil, _IONBF, 0)
setvbuf(stderr, nil, _IONBF, 0)

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: print_worker.swift <text> <tapeMm>\n", stderr)
    exit(1)
}
let printText = CommandLine.arguments[1]
let tapeMm = Int(CommandLine.arguments[2]) ?? 12

// =============================================================================
// TEPRAプロトコル
// =============================================================================

func makeFrame(_ cmd: UInt8, _ params: UInt8...) -> Data {
    let body = Data([cmd]) + Data(params)
    let sum = UInt8(body.reduce(0, { (Int($0) + Int($1)) & 0xFF }))
    return Data([0x1B, 0x7B, UInt8(body.count + 2)]) + body + Data([sum, 0x7D])
}

let STATUS_OFF = makeFrame(0x49, 0x00, 0x00)

let TW_TO_WIDTH: [Int: Int] = [0: 0, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 12, 11: 1]
let WIDTH_TO_PIXELS: [Int: Int] = [1: 32, 2: 52, 3: 54, 4: 72, 5: 108, 6: 128, 7: 192, 12: 252]
let TAPEMM_TO_PIXELS: [Int: Int] = [4: 32, 6: 52, 9: 54, 12: 72, 18: 108, 24: 128, 36: 192]

func makeJobEnvironmentCommand() -> Data {
    var d = Data()
    d += Data([0x1B, 0x7B, 0x03, 0x40, 0x40, 0x7D])
    d += Data([0x1B, 0x7B, 0x07, 0x7B, 0x00, 0x00, 0x53, 0x54, 0x22, 0x7D])
    d += Data([0x1B, 0x7B, 0x07, 0x43, 0x01, 0x00, 0x00, 0x00, 0x44, 0x7D])
    d += Data([0x1B, 0x7B, 0x04, 0x44, 0x00, 0x44, 0x7D])
    d += Data([0x1B, 0x7B, 0x03, 0x47, 0x47, 0x7D])
    return d
}

func makePageEnvironmentCommand(labelRows: Int) -> Data {
    let l0 = UInt8(labelRows & 0xFF)
    let l1 = UInt8((labelRows >> 8) & 0xFF)
    let l2 = UInt8((labelRows >> 16) & 0xFF)
    let l3 = UInt8((labelRows >> 24) & 0xFF)
    let sumL = UInt8((0x4C + Int(l0) + Int(l1) + Int(l2) + Int(l3)) & 0xFF)
    var d = Data()
    d += Data([0x1B, 0x7B, 0x07, 0x4C, l0, l1, l2, l3, sumL, 0x7D])
    d += Data([0x1B, 0x7B, 0x05, 0x54, 0x00, 0x00, 0x54, 0x7D])
    d += Data([0x1B, 0x7B, 0x03, 0x79, 0x79, 0x7D])
    return d
}

func makeRasterHeader(pixelCount: Int) -> Data {
    let nL = UInt8(pixelCount & 0xFF)
    let nH = UInt8((pixelCount >> 8) & 0xFF)
    return Data([0x1B, 0x2E, 0x00, 0x00, 0x00, 0x01, nL, nH])
}

let SEND_AND_CUT = Data([0x1B, 0x7B, 0x04, 0x2B, 0x01, 0x2C, 0x7D])

// =============================================================================
// テキスト→ラスター変換
// =============================================================================

func renderTextToRaster(text: String, tapePixels: Int) -> [[UInt8]] {
    let fontSize = CGFloat(tapePixels) * 0.80
    let font = CTFontCreateWithName("HiraKakuProN-W6" as CFString, fontSize, nil)
    let attrStr = NSAttributedString(
        string: text,
        attributes: [
            kCTFontAttributeName as NSAttributedString.Key: font,
            kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(gray: 0, alpha: 1),
        ]
    )
    let line = CTLineCreateWithAttributedString(attrStr)
    var ascent: CGFloat = 0
    var descent: CGFloat = 0
    var leading: CGFloat = 0
    let textWidth = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)

    let dotsPerMM = 180.0 / 25.4
    let margin = Int(dotsPerMM * 2)
    let canvasWidth = Int(ceil(textWidth)) + 1 + margin * 2
    let canvasHeight = tapePixels

    guard canvasWidth > 0, canvasHeight > 0 else { return [] }

    let bytesPerRow = (canvasWidth + 7) / 8 * 8
    var pixels = [UInt8](repeating: 0xFF, count: bytesPerRow * canvasHeight)

    let colorSpace = CGColorSpaceCreateDeviceGray()
    guard let ctx = CGContext(
        data: &pixels, width: canvasWidth, height: canvasHeight,
        bitsPerComponent: 8, bytesPerRow: bytesPerRow,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else { return [] }

    ctx.setFillColor(gray: 1.0, alpha: 1.0)
    ctx.fill(CGRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight))

    let textHeightTotal = ascent + descent
    let baselineY = (CGFloat(canvasHeight) - textHeightTotal) / 2 + descent
    ctx.textPosition = CGPoint(x: CGFloat(margin), y: baselineY)
    CTLineDraw(line, ctx)

    let rasterBytesPerRow = (canvasHeight + 7) / 8
    var rasterRows: [[UInt8]] = []
    for col in 0..<canvasWidth {
        var rowBytes = [UInt8](repeating: 0x00, count: rasterBytesPerRow)
        for row in 0..<canvasHeight {
            let y = canvasHeight - 1 - row
            let pixelVal = pixels[y * bytesPerRow + col]
            if pixelVal < 128 {
                let byteIdx = row / 8
                let bitIdx = 7 - (row % 8)
                rowBytes[byteIdx] |= UInt8(1 << bitIdx)
            }
        }
        rasterRows.append(rowBytes)
    }
    return rasterRows
}

// =============================================================================
// RFCOMM デリゲート
// =============================================================================

class RFCOMMDelegate: NSObject, IOBluetoothRFCOMMChannelDelegate {
    var buf = Data()
    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!,
                            data ptr: UnsafeMutableRawPointer!, length len: Int) {
        buf += Data(bytes: ptr, count: len)
    }
    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        if error == kIOReturnSuccess {
            print("[Worker] RFCOMM ch6 オープン完了")
        } else {
            print("[Worker] RFCOMM ch6 オープン失敗 status=\(error)")
        }
    }
}

func runLoop(_ sec: TimeInterval) {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: sec))
}

// =============================================================================
// メイン
// =============================================================================

let MAC = "74:d5:c6:6c:9a:96"
let RFCOMM_CHANNEL: BluetoothRFCOMMChannelID = 6

print("[Worker] 印刷開始: \"\(printText)\" tape=\(tapeMm)mm")

guard let device = IOBluetoothDevice(addressString: MAC) else {
    fputs("[Worker] デバイスが見つかりません\n", stderr)
    exit(1)
}
print("[Worker] 接続状態: \(device.isConnected())")

let delegate = RFCOMMDelegate()
var channel: IOBluetoothRFCOMMChannel? = nil
let openResult = device.openRFCOMMChannelSync(&channel, withChannelID: RFCOMM_CHANNEL, delegate: delegate)

guard openResult == kIOReturnSuccess, let rfcomm = channel else {
    fputs("[Worker] RFCOMM ch\(RFCOMM_CHANNEL) オープン失敗 (status=\(openResult))\n", stderr)
    exit(1)
}
print("[Worker] RFCOMM ch6 OK MTU=\(rfcomm.getMTU())")

func send(_ data: Data) {
    var bytes = [UInt8](data)
    bytes.withUnsafeMutableBytes { ptr in
        _ = rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
    }
}

// テープ幅検出
delegate.buf = Data()
send(STATUS_OFF)
runLoop(3.0)

var tapePixels = TAPEMM_TO_PIXELS[tapeMm] ?? 72
if delegate.buf.count >= 17 {
    let twRaw = Int(delegate.buf[16])
    let widthOrdinal = TW_TO_WIDTH[twRaw] ?? -1
    if let pixels = WIDTH_TO_PIXELS[widthOrdinal] {
        tapePixels = pixels
        print("[Worker] テープ幅検出: TW=\(twRaw) → \(pixels)px")
    }
}
let tapeBytesPerRow = (tapePixels + 7) / 8

// ラスター化
print("[Worker] ラスター化: \"\(printText)\" (\(tapePixels)px)")
let rasterRows = renderTextToRaster(text: printText, tapePixels: tapePixels)
guard !rasterRows.isEmpty else {
    fputs("[Worker] ラスター変換失敗\n", stderr)
    rfcomm.close()
    exit(1)
}
print("[Worker] ラスター行数: \(rasterRows.count)")

// カッター位置までの余白行数（SR-R2500P: 約212行 = 約30mm）
let cutterFeedRows = 212
let totalRows = rasterRows.count + cutterFeedRows

// 印刷
send(makeJobEnvironmentCommand())
runLoop(1.0)
send(makePageEnvironmentCommand(labelRows: totalRows))
runLoop(0.5)

let rasterHeader = makeRasterHeader(pixelCount: tapePixels)
for (i, rowBytes) in rasterRows.enumerated() {
    var lineData = rasterHeader
    let needed = tapeBytesPerRow
    if rowBytes.count >= needed {
        lineData += Data(rowBytes.prefix(needed))
    } else {
        lineData += Data(rowBytes) + Data(repeating: 0x00, count: needed - rowBytes.count)
    }
    send(lineData)
    if i % 100 == 0 { runLoop(0.02) }
}

// テキスト後に空白行でカッター位置まで送る
let blankRow = Data(repeating: 0x00, count: tapeBytesPerRow)
for i in 0..<cutterFeedRows {
    var lineData = rasterHeader
    lineData += blankRow
    send(lineData)
    if i % 100 == 0 { runLoop(0.02) }
}
runLoop(2.0)

send(SEND_AND_CUT)
runLoop(8.0)

rfcomm.close()
print("[Worker] 印刷完了")
exit(0)
