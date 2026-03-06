#!/usr/bin/swift
// カット → テープ3cm送り → カット テスト

import Foundation
import IOBluetooth

let MAC = "74:d5:c6:6c:9a:96"
let RFCOMM_CHANNEL: BluetoothRFCOMMChannelID = 6

func makeFrame(_ cmd: UInt8, _ params: UInt8...) -> Data {
    let body = Data([cmd]) + Data(params)
    let sum = UInt8(body.reduce(0, { (Int($0) + Int($1)) & 0xFF }))
    return Data([0x1B, 0x7B, UInt8(body.count + 2)]) + body + Data([sum, 0x7D])
}

let STATUS_OFF  = makeFrame(0x49, 0x00, 0x00)
let SEND_AND_CUT = Data([0x1B, 0x7B, 0x04, 0x2B, 0x01, 0x2C, 0x7D])

func makeJobEnv() -> Data {
    var d = Data()
    d += Data([0x1B, 0x7B, 0x03, 0x40, 0x40, 0x7D])
    d += Data([0x1B, 0x7B, 0x07, 0x7B, 0x00, 0x00, 0x53, 0x54, 0x22, 0x7D])
    d += Data([0x1B, 0x7B, 0x07, 0x43, 0x01, 0x00, 0x00, 0x00, 0x44, 0x7D])  // TapeCut=EachLabel
    d += Data([0x1B, 0x7B, 0x04, 0x44, 0x00, 0x44, 0x7D])
    d += Data([0x1B, 0x7B, 0x03, 0x47, 0x47, 0x7D])
    return d
}

func makePageEnv(labelRows: Int) -> Data {
    let l0=UInt8(labelRows&0xFF); let l1=UInt8((labelRows>>8)&0xFF)
    let l2=UInt8((labelRows>>16)&0xFF); let l3=UInt8((labelRows>>24)&0xFF)
    let sumL=UInt8((0x4C+Int(l0)+Int(l1)+Int(l2)+Int(l3))&0xFF)
    var d = Data()
    d += Data([0x1B,0x7B,0x07,0x4C,l0,l1,l2,l3,sumL,0x7D])
    d += Data([0x1B,0x7B,0x05,0x54,0x00,0x00,0x54,0x7D])
    d += Data([0x1B,0x7B,0x03,0x79,0x79,0x7D])
    return d
}

func makeRasterHeader(pixelCount: Int) -> Data {
    return Data([0x1B,0x2E,0x00,0x00,0x00,0x01,UInt8(pixelCount&0xFF),UInt8((pixelCount>>8)&0xFF)])
}

func hexStr(_ d: Data) -> String { d.map { String(format:"%02x",$0) }.joined(separator:" ") }
func runLoop(_ sec: TimeInterval) { RunLoop.current.run(until: Date(timeIntervalSinceNow: sec)) }

class Delegate: NSObject, IOBluetoothRFCOMMChannelDelegate {
    var buf = Data()
    func rfcommChannelData(_ ch: IOBluetoothRFCOMMChannel!, data ptr: UnsafeMutableRawPointer!, length len: Int) {
        buf += Data(bytes: ptr, count: len)
    }
    func rfcommChannelOpenComplete(_ ch: IOBluetoothRFCOMMChannel!, status e: IOReturn) {
        print("[INFO] オープン完了 status=\(e)")
    }
}

// MARK: - 接続

guard let device = IOBluetoothDevice(addressString: MAC) else { print("デバイスなし"); exit(1) }
if !device.isConnected() { device.openConnection(); runLoop(2.0) }
print("接続: \(device.isConnected())")

let delegate = Delegate()
var channel: IOBluetoothRFCOMMChannel? = nil
let r = device.openRFCOMMChannelSync(&channel, withChannelID: RFCOMM_CHANNEL, delegate: delegate)
guard r == kIOReturnSuccess, let rfcomm = channel else { print("ch6オープン失敗: \(r)"); exit(1) }
print("RFCOMM ch6 OK, MTU=\(rfcomm.getMTU())")
runLoop(1.0)

func send(_ data: Data, label: String = "") {
    var bytes = [UInt8](data)
    let _ = bytes.withUnsafeMutableBytes { ptr in rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count)) }
    if !label.isEmpty { print("[送信] \(label)") }
}

// 送信後1秒待ってST確認
func checkST() {
    delegate.buf = Data()
    send(STATUS_OFF)
    runLoop(1.0)
    if delegate.buf.count >= 15 {
        print("  ST=0x\(String(format:"%02x", delegate.buf[14]))")
    }
}

// 白紙ラスター n行送信してSEND_AND_CUT → カット
func feedAndCut(rows: Int, pixelCount: Int = 72, label: String) {
    print("\n--- \(label) (\(rows)行) ---")
    send(makeJobEnv(), label: "JobEnv")
    runLoop(0.3)
    send(makePageEnv(labelRows: rows), label: "PageEnv")
    runLoop(0.2)

    let header = makeRasterHeader(pixelCount: pixelCount)
    let bytesPerRow = (pixelCount + 7) / 8
    let blankRow = Data(repeating: 0x00, count: bytesPerRow)  // 白紙 = カット/送りのみ

    for row in 0..<rows {
        var line = Data()
        line += header
        line += blankRow
        var bytes = [UInt8](line)
        let _ = bytes.withUnsafeMutableBytes { ptr in rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count)) }
        if row % 50 == 0 { runLoop(0.02) }
    }
    print("  ラスター送信完了")

    send(SEND_AND_CUT, label: "SEND_AND_CUT")
    runLoop(5.0)
    print("  完了")
}

// =============================================================================
// メイン: カット → 3cm送り → カット
// =============================================================================

// 1. カット (旧バッファを完全クリアするため212行blank送り → カット)
let CUT_ONLY_ROWS = 212
feedAndCut(rows: CUT_ONLY_ROWS, label: "カット (最小送り)")

// 2. 3cm 白紙送り → カット
let FEED_3CM_MM = 30
let FEED_3CM_ROWS = Int(Double(FEED_3CM_MM) * 180.0 / 25.4)  // ≈ 212行
feedAndCut(rows: FEED_3CM_ROWS, label: "3cm 白紙送り → カット")

rfcomm.close()
print("\n=== 完了 ===")
