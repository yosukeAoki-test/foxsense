#!/usr/bin/swift
// TEPRA Web印刷ブリッジ
// VPS上のAPIからジョブをポーリングし、TEPRAで印刷する
//
// 使用法:
//   swift bridge.swift [API_BASE_URL] [BRIDGE_SECRET]
//   例: swift bridge.swift https://smart-agri-vision.net/api my-secret
//
// 環境変数でも設定可能:
//   FOXSENSE_API_URL   - APIのベースURL
//   BRIDGE_SECRET      - ブリッジ認証シークレット

import Foundation

// =============================================================================
// 設定
// =============================================================================

let POLL_INTERVAL: TimeInterval = 3.0

// stdout バッファリング無効化 (ファイルリダイレクト時に即時フラッシュ)
setvbuf(stdout, nil, _IONBF, 0)
setvbuf(stderr, nil, _IONBF, 0)

let API_BASE = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : (ProcessInfo.processInfo.environment["FOXSENSE_API_URL"] ?? "http://localhost:3001/api")

let BRIDGE_SECRET = CommandLine.arguments.count > 2
    ? CommandLine.arguments[2]
    : (ProcessInfo.processInfo.environment["BRIDGE_SECRET"] ?? "dev-bridge-secret")

// =============================================================================
// 印刷実行 (run_print.sh 経由)
// =============================================================================

func printJob(text: String, tapeMm: Int) throws {
    let dir = URL(fileURLWithPath: #file).deletingLastPathComponent().path
    let scriptPath = "\(dir)/run_print.sh"

    print("[Bridge] run_print起動: \"\(text)\" tape=\(tapeMm)mm")
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [scriptPath, text, String(tapeMm)]

    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe

    try p.run()

    // 出力をリアルタイムで中継
    pipe.fileHandleForReading.readabilityHandler = { fh in
        let data = fh.availableData
        if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
            print(str, terminator: "")
        }
    }

    p.waitUntilExit()
    pipe.fileHandleForReading.readabilityHandler = nil

    guard p.terminationStatus == 0 else {
        throw NSError(domain: "TEPRA", code: 10,
            userInfo: [NSLocalizedDescriptionKey: "print_worker失敗 (exit=\(p.terminationStatus))"])
    }
    print("[Bridge] 印刷完了")
}

// =============================================================================
// APIクライアント
// =============================================================================

func apiGet(path: String) -> [String: Any]? {
    let urlStr = "\(API_BASE)/print/\(path)?secret=\(BRIDGE_SECRET)"
    guard let url = URL(string: urlStr) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: 10)
    req.httpMethod = "GET"
    var result: [String: Any]? = nil
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { data, _, _ in
        if let data = data {
            result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        }
        sem.signal()
    }.resume()
    sem.wait()
    return result
}

func apiPost(path: String) {
    let urlStr = "\(API_BASE)/print/\(path)?secret=\(BRIDGE_SECRET)"
    guard let url = URL(string: urlStr) else { return }
    var req = URLRequest(url: url, timeoutInterval: 5)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [:] as [String: Any])
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
    sem.wait()
}

func apiPatch(path: String, body: [String: Any]) {
    let urlStr = "\(API_BASE)/print/\(path)?secret=\(BRIDGE_SECRET)"
    guard let url = URL(string: urlStr) else { return }
    var req = URLRequest(url: url, timeoutInterval: 10)
    req.httpMethod = "PATCH"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
    sem.wait()
}

// =============================================================================
// メインポーリングループ
// =============================================================================

print("[Bridge] 起動 API=\(API_BASE)")
print("[Bridge] ポーリング開始 (間隔 \(Int(POLL_INTERVAL))秒)")

while true {
    apiPost(path: "heartbeat")

    if let resp = apiGet(path: "jobs/pending"),
       let data = resp["data"] as? [String: Any],
       let jobId = data["id"] as? String,
       let text = data["text"] as? String {

        let tapeMm = (data["tapeMm"] as? Int) ?? 12
        print("[Bridge] ジョブ取得: id=\(jobId) text=\"\(text)\" tape=\(tapeMm)mm")

        do {
            try printJob(text: text, tapeMm: tapeMm)
            apiPatch(path: "jobs/\(jobId)", body: ["status": "done"])
            print("[Bridge] ジョブ完了: \(jobId)")
        } catch {
            print("[Bridge] 印刷エラー: \(error.localizedDescription)")
            apiPatch(path: "jobs/\(jobId)", body: ["status": "failed", "error": error.localizedDescription])
        }
    }

    Thread.sleep(forTimeInterval: POLL_INTERVAL)
}
