#!/usr/bin/swift
// TEPRA SR-R2500P RFCOMM直接接続テスト (Swift版)
// IOBluetoothを直接使用してRFCOMM ch6に接続

import Foundation
import IOBluetooth

let MAC = "74:d5:c6:6c:9a:96"
let RFCOMM_CHANNEL: BluetoothRFCOMMChannelID = 6

// フレーム生成
func frame(_ cmd: UInt8, _ params: UInt8...) -> Data {
    var data = Data([cmd]) + Data(params)
    let chk = UInt8(data.reduce(0, { (Int($0) + Int($1)) % 256 }))
    return Data([0x1B, 0x7B, UInt8(data.count + 2)]) + data + Data([chk, 0x7D])
}

let STATUS_OFF = frame(0x49, 0x00, 0x00)
let STATUS_ON  = frame(0x49, 0x05, 0x00)
let TAPE_FEED  = frame(0x2B, 0x00)

print("STATUS_OFF: \(STATUS_OFF.map { String(format: "%02x", $0) }.joined(separator: " "))")
print("STATUS_ON:  \(STATUS_ON.map  { String(format: "%02x", $0) }.joined(separator: " "))")

// デリゲートクラス
class RFCOMMDelegate: NSObject, IOBluetoothRFCOMMChannelDelegate {
    var receivedData = Data()
    var received = false

    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!, data dataPointer: UnsafeMutableRawPointer!, length dataLength: Int) {
        let data = Data(bytes: dataPointer, count: dataLength)
        receivedData += data
        received = true
        let hex = data.map { String(format: "%02x", $0) }.joined(separator: " ")
        print("[受信] \(dataLength)バイト: \(hex)")
    }

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        print("[INFO] チャンネルクローズ")
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        print("[INFO] オープン完了 status=\(error)")
    }

    func rfcommChannelWriteComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, refcon: UnsafeMutableRawPointer!, status error: IOReturn) {
        print("[INFO] 書き込み完了 status=\(error)")
    }
}

// デバイス取得
guard let device = IOBluetoothDevice(addressString: MAC) else {
    print("デバイスが見つかりません")
    exit(1)
}
print("デバイス: \(device.nameOrAddress ?? "unknown"), 接続=\(device.isConnected())")

// 接続
if !device.isConnected() {
    print("接続中...")
    let r = device.openConnection()
    print("openConnection: \(r)")
    Thread.sleep(forTimeInterval: 2.0)
}
print("接続後: \(device.isConnected())")

// RFCOMMチャンネルオープン
let delegate = RFCOMMDelegate()
var channel: IOBluetoothRFCOMMChannel? = nil

print("\nRFCOMM ch\(RFCOMM_CHANNEL) オープン...")
let result = device.openRFCOMMChannelSync(&channel, withChannelID: RFCOMM_CHANNEL, delegate: delegate)
print("result=\(result), channel=\(String(describing: channel))")

if result != kIOReturnSuccess || channel == nil {
    print("オープン失敗 - 全チャンネル試す")
    for ch: BluetoothRFCOMMChannelID in [1, 2, 3, 4, 5, 7, 8, 9] {
        var ch2: IOBluetoothRFCOMMChannel? = nil
        let r2 = device.openRFCOMMChannelSync(&ch2, withChannelID: ch, delegate: delegate)
        print("  ch\(ch): result=\(r2), channel=\(String(describing: ch2))")
        if r2 == kIOReturnSuccess && ch2 != nil {
            channel = ch2
            print("→ ch\(ch) 成功!")
            break
        }
    }
}

guard let rfcommChannel = channel else {
    print("全チャンネル失敗")
    exit(1)
}

print("チャンネルID: \(rfcommChannel.getID()), MTU: \(rfcommChannel.getMTU())")

// Run loop ヘルパー
func runLoop(_ sec: TimeInterval) {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: sec))
}

// 自発応答待ち
print("\n=== 自発応答待ち 3秒 ===")
runLoop(3.0)
print("自発応答: \(delegate.receivedData.count)バイト")

// STATUS_OFF 送信
print("\n=== STATUS_OFF 送信 ===")
delegate.receivedData = Data()
delegate.received = false
var statusOffBytes = [UInt8](STATUS_OFF)
let writeResult = statusOffBytes.withUnsafeMutableBytes { ptr in
    rfcommChannel.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
}
print("writeSync: \(writeResult)")
runLoop(5.0)
print("応答: \(delegate.receivedData.count)バイト")
if delegate.receivedData.count > 0 {
    print("  HEX: \(delegate.receivedData.map { String(format: "%02x", $0) }.joined(separator: " "))")
}

// STATUS_ON 送信
print("\n=== STATUS_ON 送信 ===")
delegate.receivedData = Data()
delegate.received = false
var statusOnBytes = [UInt8](STATUS_ON)
let writeResult2 = statusOnBytes.withUnsafeMutableBytes { ptr in
    rfcommChannel.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
}
print("writeSync: \(writeResult2)")
runLoop(5.0)
print("応答: \(delegate.receivedData.count)バイト")

// TAPE_FEED テスト
print("\n=== TAPE_FEED 送信 ===")
var tapeFeedBytes = [UInt8](TAPE_FEED)
statusOnBytes.withUnsafeMutableBytes { ptr in
    let _ = rfcommChannel.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
}
runLoop(0.5)
let writeResult3 = tapeFeedBytes.withUnsafeMutableBytes { ptr in
    rfcommChannel.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
}
print("writeSync: \(writeResult3)")
runLoop(5.0)

rfcommChannel.close()
print("\n完了")
