#!/usr/bin/swift
// 印刷ワーカー: RFCOMM ch6 経由でTEPRA SR-R2500Pに印刷
// run_print.sh から呼ばれる (blueutil disconnect→connect済み)
// 使用法: swift print_worker.swift <text> <tapeMm>

import Foundation
import IOBluetooth
import CoreGraphics
import CoreText
import CoreImage

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
// QRコード→ラスター変換
// =============================================================================

func renderQRToRaster(qrData: String, tapePixels: Int) -> [[UInt8]] {
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
        fputs("[Worker] CIQRCodeGenerator 非対応\n", stderr); return []
    }
    filter.setValue(Data(qrData.utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let rawCI = filter.outputImage else { return [] }

    // テープ高さに合わせてスケール（QRは正方形なので幅＝高さ）
    let scale = CGFloat(tapePixels) / rawCI.extent.width
    let scaledCI = rawCI.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let canvasW = Int(ceil(scaledCI.extent.width))
    let canvasH = tapePixels

    // RGBA8バッファへ描画
    let bpr = canvasW * 4
    var pixels = [UInt8](repeating: 0xFF, count: bpr * canvasH)
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: &pixels, width: canvasW, height: canvasH,
        bitsPerComponent: 8, bytesPerRow: bpr,
        space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return [] }

    ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: canvasW, height: canvasH))

    let ciCtx = CIContext(options: nil)
    guard let cgImg = ciCtx.createCGImage(scaledCI, from: scaledCI.extent) else { return [] }
    ctx.draw(cgImg, in: CGRect(x: 0, y: 0, width: canvasW, height: canvasH))

    // カラム主体のラスターに変換（テキストと同じ形式）
    let rasterBPR = (tapePixels + 7) / 8
    var rasterRows: [[UInt8]] = []
    for col in 0..<canvasW {
        var rowBytes = [UInt8](repeating: 0x00, count: rasterBPR)
        for row in 0..<tapePixels {
            let y = tapePixels - 1 - row
            let r = pixels[y * bpr + col * 4]
            if r < 128 {
                rowBytes[row / 8] |= UInt8(1 << (7 - (row % 8)))
            }
        }
        rasterRows.append(rowBytes)
    }
    return rasterRows
}

// =============================================================================
// 2行テキスト→ラスター変換（QRラベル用サイドテキスト）
// =============================================================================

func renderTwoLineTextToRaster(line1: String, line2: String, tapePixels: Int) -> [[UInt8]] {
    let halfH = CGFloat(tapePixels) / 2.0
    let fontSize = halfH * 0.70
    let font = CTFontCreateWithName("HiraKakuProN-W6" as CFString, fontSize, nil)

    func makeAttrStr(_ text: String) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            kCTFontAttributeName as NSAttributedString.Key: font,
            kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(gray: 0, alpha: 1),
        ])
    }

    let ctLine1 = CTLineCreateWithAttributedString(makeAttrStr(line1))
    let ctLine2 = CTLineCreateWithAttributedString(makeAttrStr(line2))

    var asc1: CGFloat = 0, desc1: CGFloat = 0, lead1: CGFloat = 0
    CTLineGetTypographicBounds(ctLine1, &asc1, &desc1, &lead1)
    var asc2: CGFloat = 0, desc2: CGFloat = 0, lead2: CGFloat = 0
    CTLineGetTypographicBounds(ctLine2, &asc2, &desc2, &lead2)

    // 固定幅キャンバス（テキストが収まるよう大きめ）
    let canvasW = 400
    let bpr = canvasW  // 1バイト/px グレースケール
    var pixels = [UInt8](repeating: 0xFF, count: bpr * tapePixels)

    let cs = CGColorSpaceCreateDeviceGray()
    guard let ctx = CGContext(
        data: &pixels, width: canvasW, height: tapePixels,
        bitsPerComponent: 8, bytesPerRow: bpr,
        space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else { return [] }
    ctx.setFillColor(gray: 1.0, alpha: 1.0)
    ctx.fill(CGRect(x: 0, y: 0, width: canvasW, height: tapePixels))

    // Line1: 上半分（CG座標: halfH〜tapePixels）
    let baseline1 = halfH + (halfH - (asc1 + desc1)) / 2.0 + desc1
    ctx.textPosition = CGPoint(x: 2, y: baseline1)
    CTLineDraw(ctLine1, ctx)

    // Line2: 下半分（CG座標: 0〜halfH）
    let baseline2 = (halfH - (asc2 + desc2)) / 2.0 + desc2
    ctx.textPosition = CGPoint(x: 2, y: baseline2)
    CTLineDraw(ctLine2, ctx)

    let rBPR = (tapePixels + 7) / 8
    var rasterRows: [[UInt8]] = []
    for col in 0..<canvasW {
        var rowBytes = [UInt8](repeating: 0x00, count: rBPR)
        for row in 0..<tapePixels {
            let y = tapePixels - 1 - row
            if pixels[y * bpr + col] < 128 {
                rowBytes[row / 8] |= UInt8(1 << (7 - (row % 8)))
            }
        }
        rasterRows.append(rowBytes)
    }
    // 末尾の空白列をトリム（余分なテープ送り防止）
    let blank = [UInt8](repeating: 0x00, count: rBPR)
    while rasterRows.last == blank { rasterRows.removeLast() }
    // 右マージン 8列
    rasterRows += [[UInt8]](repeating: blank, count: 8)
    print("[Worker] テキスト列数: \(rasterRows.count)")
    return rasterRows
}

// =============================================================================
// QR + テキスト複合ラベル→ラスター変換
// =============================================================================

func renderLabelToRaster(deviceId: String, imsi: String, tapePixels: Int) -> [[UInt8]] {
    let qrCols = renderQRToRaster(qrData: deviceId, tapePixels: tapePixels)
    let rBPR = (tapePixels + 7) / 8
    let gap = [[UInt8]](repeating: [UInt8](repeating: 0x00, count: rBPR), count: 6)
    let textCols = renderTwoLineTextToRaster(
        line1: "ID:\(deviceId)",
        line2: "IMSI:\(imsi.isEmpty ? "-" : imsi)",
        tapePixels: tapePixels
    )
    return qrCols + gap + textCols
}

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

// IOBluetooth XPC同期のためRunLoopを回す（サブプロセス起動直後は未同期）
print("[Worker] Bluetooth初期化待機...")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 3.0))

// pairedDevices() で確実にデバイスを取得
let paired = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []
print("[Worker] ペアリング済みデバイス数: \(paired.count)")
for d in paired {
    print("[Worker]   \(d.addressString ?? "?") \(d.name ?? "?")")
}

let device: IOBluetoothDevice
let macNorm = MAC.uppercased().replacingOccurrences(of: ":", with: "-")
if let found = paired.first(where: { ($0.addressString?.uppercased() ?? "") == macNorm }) {
    device = found
    print("[Worker] pairedDevices から取得: \(device.name ?? "?")")
} else {
    // フォールバック: addressString で生成
    guard let d = IOBluetoothDevice(addressString: MAC) else {
        fputs("[Worker] デバイスが見つかりません\n", stderr)
        exit(1)
    }
    device = d
    print("[Worker] addressString から取得 (フォールバック)")
}

print("[Worker] isConnected: \(device.isConnected())")
print("[Worker] isPaired: \(device.isPaired())")
print("[Worker] SDPサービス数: \((device.services as? [IOBluetoothSDPServiceRecord])?.count ?? 0)")

// isConnected が true になるまで最大15秒待機
if !device.isConnected() {
    print("[Worker] isConnected 待機中...")
    for i in 1...15 {
        runLoop(1.0)
        if device.isConnected() {
            print("[Worker] isConnected: true (\(i)秒後)")
            break
        }
        if i == 15 {
            print("[Worker] isConnected タイムアウト - そのまま続行")
        }
    }
}

let delegate = RFCOMMDelegate()
var rfcomm: IOBluetoothRFCOMMChannel? = nil

// RFCOMM open をリトライ（IOBluetooth の認識遅れ対策）
for attempt in 1...6 {
    var channel: IOBluetoothRFCOMMChannel? = nil
    let result = device.openRFCOMMChannelSync(&channel, withChannelID: RFCOMM_CHANNEL, delegate: delegate)
    print("[Worker] RFCOMM open attempt=\(attempt)/6 status=\(result) channel=\(channel != nil)")
    if result == kIOReturnSuccess, let ch = channel {
        rfcomm = ch
        print("[Worker] RFCOMM ch6 OK MTU=\(ch.getMTU()) isOpen=\(ch.isOpen())")
        break
    }
    if attempt < 6 { runLoop(3.0) }
}

guard let rfcomm else {
    fputs("[Worker] RFCOMM ch\(RFCOMM_CHANNEL) オープン失敗 - 全リトライ消費\n", stderr)
    exit(1)
}

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

// ラスター化（QRラベル or テキスト）
let isQR = printText.hasPrefix("QR:")
let isCut = printText == "CUT"
let renderTarget = isQR ? String(printText.dropFirst(3)) : printText
let rasterRows: [[UInt8]]
if isCut {
    // カットトリガー: 1列の空白ラスターのみ（テープ送り最小化）
    let rBPR = (tapePixels + 7) / 8
    rasterRows = [[UInt8](repeating: 0x00, count: rBPR)]
    print("[Worker] カットトリガーモード")
} else if isQR {
    // "DEVICEID" または "DEVICEID:IMSI" 形式
    let parts = renderTarget.split(separator: ":", maxSplits: 1)
    let deviceId = String(parts[0])
    let imsi = parts.count > 1 ? String(parts[1]) : ""
    print("[Worker] ラスター化: Label id=\(deviceId) imsi=\(imsi.isEmpty ? "なし" : imsi) (\(tapePixels)px)")
    rasterRows = renderLabelToRaster(deviceId: deviceId, imsi: imsi, tapePixels: tapePixels)
} else {
    print("[Worker] ラスター化: TEXT \"\(renderTarget)\" (\(tapePixels)px)")
    rasterRows = renderTextToRaster(text: renderTarget, tapePixels: tapePixels)
}
guard !rasterRows.isEmpty else {
    fputs("[Worker] ラスター変換失敗\n", stderr)
    rfcomm.close()
    exit(1)
}
print("[Worker] ラスター行数: \(rasterRows.count)")

let totalRows = rasterRows.count

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
runLoop(1.0)

// ラスター送信後にSTATUS_OFFを送ってからSEND_AND_CUT (print_test.swiftと同じシーケンス)
print("[Worker] STATUS_OFF送信 (カット前チェック)...")
delegate.buf = Data()
send(STATUS_OFF)
runLoop(1.5)
print("[Worker] STATUS応答: \(delegate.buf.count)バイト")

print("[Worker] SEND_AND_CUT送信...")
send(SEND_AND_CUT)
runLoop(6.0)

rfcomm.close()
print("[Worker] 印刷完了")
exit(0)
