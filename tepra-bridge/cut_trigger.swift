#!/usr/bin/swift
// カットトリガー: RFCOMM ch6 を開いて PRINT_END(0x40) を送信しカットを確定させる
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

class CutDelegate: NSObject, IOBluetoothRFCOMMChannelDelegate {
    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!,
                           data ptr: UnsafeMutableRawPointer!, length len: Int) {}
    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        if error == kIOReturnSuccess {
            print("[Cut] RFCOMM ch6 オープン完了")
        } else {
            print("[Cut] RFCOMM ch6 オープン失敗 status=\(error)")
        }
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

runLoop(0.5)

// makeJobEnvironmentCommand を送信してカットをトリガー
// 次のジョブの開始と同じコマンドシーケンス
func makeJobEnvironmentCommand() -> Data {
    var d = Data()
    d += Data([0x1B, 0x7B, 0x03, 0x40, 0x40, 0x7D])
    d += Data([0x1B, 0x7B, 0x07, 0x7B, 0x00, 0x00, 0x53, 0x54, 0x22, 0x7D])
    d += Data([0x1B, 0x7B, 0x07, 0x43, 0x01, 0x00, 0x00, 0x00, 0x44, 0x7D])
    d += Data([0x1B, 0x7B, 0x04, 0x44, 0x00, 0x44, 0x7D])
    d += Data([0x1B, 0x7B, 0x03, 0x47, 0x47, 0x7D])
    return d
}

let jobEnv = makeJobEnvironmentCommand()
var bytes = [UInt8](jobEnv)
bytes.withUnsafeMutableBytes { ptr in
    _ = rfcomm.writeSync(ptr.baseAddress!, length: UInt16(ptr.count))
}
print("[Cut] JobEnvironmentCommand 送信")

runLoop(5.0)
rfcomm.close()
print("[Cut] カット確定")
exit(0)
