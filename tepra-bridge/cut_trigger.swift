#!/usr/bin/swift
// カットトリガー: 最小ダミージョブを送信して前ジョブのカットを確定させる
// 次の実ジョブの開始と同じシーケンスを再現する
// run_print.sh から呼ばれる (blueutil disconnect→connect 済み)

import Foundation
import IOBluetooth

setvbuf(stdout, nil, _IONBF, 0)
setvbuf(stderr, nil, _IONBF, 0)

let MAC = "74:d5:c6:6c:9a:96"
let RFCOMM_CHANNEL: BluetoothRFCOMMChannelID = 6

func makeFrame(_ cmd: UInt8, _ params: UInt8...) -> Data {
    let body = Data([cmd]) + Data(params)
    let sum = UInt8(body.reduce(0, { (Int($0) + Int($1)) & 0xFF }))
    return Data([0x1B, 0x7B, UInt8(body.count + 2)]) + body + Data([sum, 0x7D])
}

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

class CutDelegate: NSObject, IOBluetoothRFCOMMChannelDelegate {
    var buf = Data()
    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!,
                           data ptr: UnsafeMutableRawPointer!, length len: Int) {
        buf += Data(bytes: ptr, count: len)
    }
    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        print("[Cut] RFCOMM ch6 \(error == kIOReturnSuccess ? "OK" : "FAIL(\(error))")")
    }
}

func runLoop(_ sec: TimeInterval) {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: sec))
}

guard let device = IOBluetoothDevice(addressString: MAC) else {
    fputs("[Cut] デバイスが見つかりません\n", stderr)
    exit(1)
}

print("[Cut] 接続状態: \(device.isConnected())")
let delegate = CutDelegate()
var channel: IOBluetoothRFCOMMChannel? = nil
let result = device.openRFCOMMChannelSync(&channel, withChannelID: RFCOMM_CHANNEL, delegate: delegate)

guard result == kIOReturnSuccess, let rfcomm = channel else {
    fputs("[Cut] RFCOMM オープン失敗 (status=\(result))\n", stderr)
    exit(1)
}

func send(_ data: Data) {
    var bytes = [UInt8](data)
    bytes.withUnsafeMutableBytes { ptr in
        _ = rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
    }
}

// 前のジョブのカットをトリガーするため、次のジョブと同じシーケンスを送信
// 1. JobEnvironmentCommand (0x40=PRINT_END が前ジョブのカットをトリガー)
// 2. PageEnvironmentCommand (1行のダミーラベル)
// 3. 1行の空白ラスターデータ
// 4. SEND_AND_CUT (ダミーの cut を予約 → 次の実ジョブ開始時に空白テープが切れる)

let tapePixels = 72  // 12mm tape
let tapeBytesPerRow = (tapePixels + 7) / 8

// STATUS_OFF を最初に送る (print_worker.swift と同じシーケンス)
let STATUS_OFF = makeFrame(0x49, 0x00, 0x00)
print("[Cut] STATUS_OFF 送信...")
send(STATUS_OFF)
runLoop(3.0)
print("[Cut] STATUS応答: \(delegate.buf.count)バイト")

print("[Cut] ダミージョブ送信でカット確定...")
send(makeJobEnvironmentCommand())  // ← 前ジョブのカットがここでトリガーされるはず
runLoop(1.0)

send(makePageEnvironmentCommand(labelRows: 1))
runLoop(0.3)

// 1行の空白ラスター
let rasterHeader = makeRasterHeader(pixelCount: tapePixels)
let blankRow = Data(repeating: 0x00, count: tapeBytesPerRow)
send(rasterHeader + blankRow)
runLoop(0.5)

send(SEND_AND_CUT)
runLoop(5.0)

rfcomm.close()
print("[Cut] 完了")
exit(0)
