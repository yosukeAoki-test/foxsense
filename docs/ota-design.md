# FoxSense One OTA 設計書（LTE経由・サーバ主導）

最終更新: 2026-07-09（本セッションのLTE経路修正・実機検証を反映）

> **実装前提の更新 (2026-07-09)**
> 本OTAが依存する親機モデムのTCP経路(CAOPEN/CARECV/CACLOSE, PDP活性化, PSM)を修正し、
> LTE送信のサーバDB到達までE2Eで実機検証済み。**OTAのダウンロード土台は整った**。
> 修正の要点（詳細は git log / `docs/power-budget.md` 前後のコミット）：
> 1. **CNCFG(APNマッピング)復活** — `AT+CNCFG=0,1,"soracom.io"` が削除されており PDP activation が
>    タイムアウトしていた。OTAダウンロードもこのPDPに乗るので**必須**。
> 2. **登録済み時のCFUN=1,1高速パスを無効化** → 4月まで動作していたフル初期化(CFUN=0→CGDCONT→CNCFG→
>    CFUN=1→登録→connectNetwork)に統一。
> 3. **CAOPEN堅牢化** — 全スロットクローズ+バッファ排出+CASTATE確認+リトライ。keep-alive残socketで
>    CAOPENが空応答(モデム無応答)になる問題に対応。
> 4. **PSMをサイクル途中で有効化しない** — 接続確立〜送信の間(LoRa収集窓)にモデムがPSMスリープし
>    UART無応答(CASTATE/CAOPEN空)になっていた。§4.3の`AT+CPSMS=0`はこの理由で正しい。
>
> → **performOta() は §4.3 の素朴なCAOPENではなく、この堅牢化した送信経路(`sendRawHTTPTCP`相当:
>    全スロットクローズ+リトライ+CASTATE)を再利用すること。**

## 1. 目的とスコープ

親機（LILYGO T-SIM7080G-S3 / ESP32-S3）を **現地に行かず・有線接続なしで** ファーム更新できるようにする。
WiFiは非搭載のため、**SIM7080G（SORACOM Cat-M1/NB-IoT）経由でサーバからファームバイナリをダウンロード**して書き換える。

更新の発火はサーバ主導：デバイスが既存の `GET /api/devices/config/:deviceId` の延長で「自分のバージョン」を申告し、サーバが「新しい版がある」と返したら更新を実行する。

### スコープ外（今回やらない）
- WiFi APモードでの現地更新（将来オプション）
- 子機（TWELITE）のOTA
- 差分（delta）OTA

---

## 2. 全体フロー

```
            ┌─────────── 通常の10分サイクル ───────────┐
 起床 → センサ収集 → データ送信 → [configフェッチ周期なら] ──┐
                                                            │
                                  GET /config?...&fw=10000  │
                                                            ▼
                              サーバ: device.fwCode(10000) < latest(10100)?
                                                            │
                         ┌──── No（最新）─────────────────┘
                         │                          Yes → レスポンスに firmware{} を同梱
                         ▼                                  │
                      そのままスリープ                       ▼
                                          ┌─ 事前条件チェック ─┐
                                          │ battery > 50%      │  NG → 今回は見送り
                                          │ 受信品質OK (RSSI)  │      （次サイクルで再評価）
                                          │ PSM一時無効化      │
                                          └────────┬──────────┘
                                                   ▼
                          CAOPEN(TCP:80) → GET firmware.bin（HTTP/1.1）
                                                   ▼
                     CARECV 1460Bずつ受信 → Update.write() で ota_1 へ書込
                                                   ▼
                            全受信 → MD5照合 → Update.end(true)
                                                   ▼
                       次回ブートを ota_1 に設定（pending） → esp_restart()
                                                   ▼
                  新ファーム起動 → 初回サーバ通信成功で「確定」(mark valid)
                                                   ▼
                  次のconfigフェッチで fw=10100 を申告 → サーバ側で更新完了を記録
```

---

## 3. パーティション変更（最初に1回だけ有線焼き直しが必要）

現状 `platformio.ini` に `board_build.partitions` の指定がなく、**OTA用の2面構成になっていない**。OTAには `otadata` + `ota_0`/`ota_1` を持つレイアウトが必須。

### 変更内容
`platformio.ini` に追記：
```ini
board_build.partitions = default_16MB.csv
```

`default_16MB.csv`（espressif32同梱）のレイアウト：
| name     | type | subtype  | offset    | size     |
|----------|------|----------|-----------|----------|
| nvs      | data | nvs      | 0x9000    | 0x5000   |
| otadata  | data | ota      | 0xe000    | 0x2000   |
| app0     | app  | ota_0    | 0x10000   | 0x640000 (6.5MB) |
| app1     | app  | ota_1    | 0x650000  | 0x640000 (6.5MB) |
| spiffs   | data | spiffs   | 0xc90000  | 0x360000 |
| coredump | data | coredump | 0xff0000  | 0x10000  |

- アプリ領域が **片面6.5MB** あるので現行ファーム（数百KB〜）は余裕。
- `nvs` のオフセットは 0x9000 のまま → **保存済み設定/NVSは消えない**。
- RTCメモリ（`RTC_DATA_ATTR` のキャッシュ群）は flash 外なので影響なし。ただし**この焼き直し時はディープスリープ電源が一旦切れる**ため RTC キャッシュはリセットされる（=次回 config フェッチが走る、問題なし）。

> ⚠️ このパーティション変更を反映する **最初の書き込みだけは USB 有線**で行う必要がある。以降はOTAで更新可能。

---

## 4. ファーム側設計

### 4.1 バージョン定義（`src/config.h`）
```c
// ファームウェアバージョン（OTA比較用）
#define FIRMWARE_VERSION      "1.0.0"   // 人間可読・ログ/レポート用
#define FIRMWARE_VERSION_CODE 10000     // 比較用の単調増加整数 (M*10000 + m*100 + p)
```
- サーバへは `FIRMWARE_VERSION_CODE`（整数）を送り、大小比較で判定する（文字列semver比較を避ける）。

### 4.2 config フェッチへのバージョン申告
`fetchConfigFromServer()` のGETパスにクエリを1つ追加するだけ：
```c
String configPath = String(SERVER_CONFIG_PATH) + DEVICE_ID
                  + "?secret=" + DEVICE_SECRET
                  + "&fw=" + String(FIRMWARE_VERSION_CODE);
```
レスポンスJSONに `firmware` フィールドがあれば OTA 候補（§5.3 参照）。`firmware == null` なら最新。

### 4.3 OTA 実行関数（新規 `performOta()`）
配置：センサ送信・config取得が終わった後、`goToSleep()` の直前に呼ぶ（センサ送信を遅延させない）。

```c
#include <Update.h>

// 事前条件
bool otaPreconditionsOk(int batteryPct, int rssi) {
    if (batteryPct >= 0 && batteryPct < 50) return false; // 書込中の電断防止
    if (rssi != 99 && rssi < 10)            return false; // 受信弱すぎ → 失敗濃厚
    return true;
}

bool performOta(const char* host, const String& path,
                uint32_t size, const String& md5hex) {
    // 1. PSM/eDRX を一時無効化（ダウンロード中にスリープさせない）
    sendATCommand("AT+CPSMS=0", 2000);

    // 2. Update 開始（書込先は自動で非アクティブ面 = ota_1）
    if (!Update.begin(size)) { Serial.println("[OTA] begin fail"); return false; }
    Update.setMD5(md5hex.c_str());      // end() 時に自動でMD5検証

    // 3. TCP接続（※堅牢版を使う。本セッションで sendRawHTTPTCP に入れた対策を流用）
    //    - 全スロットクローズ(CACLOSE 0..2) + 受信バッファ排出 + delay
    //    - CAOPEN は "+CAOPEN: 0,0" が返るまで最大3回リトライ（keep-alive残socket対策）
    //    - 直前に AT+CASTATE? でソケット状態をログ（詰まり診断用）
    String cst = sendATCommand("AT+CASTATE?", 2000);
    for (int cid = 0; cid <= 2; cid++) sendATCommand("AT+CACLOSE=" + String(cid), 1500);
    while (modemSerial.available()) modemSerial.read();
    delay(1500);
    String r; bool opened = false;
    for (int a = 0; a < 3 && !opened; a++) {
        r = sendATCommand(String("AT+CAOPEN=0,0,\"TCP\",\"") + host + "\",80", 20000);
        if (r.indexOf("+CAOPEN: 0,0") >= 0) { opened = true; break; }
        sendATCommand("AT+CACLOSE=0", 2000); delay(2000);
    }
    if (!opened) { Update.abort(); return false; }
    int clientID = 0;  // CAOPEN=0要求 → 通常clientID=0（+CAOPEN URCから確認）

    // 4. HTTP/1.1 GET（keep-alive）
    String req = "GET " + path + " HTTP/1.1\r\nHost: " + host
               + "\r\nConnection: keep-alive\r\n\r\n";
    sendATCommand("AT+CASEND=" + String(clientID) + "," + String(req.length()), 5000);
    modemSerial.print(req);

    // 5. ヘッダをスキップしつつ本文を CARECV 1460B 単位で Update.write()
    //    （既存 fetchConfig の CARECV ループを土台に、文字列蓄積ではなく
    //     ヘッダ終端 \r\n\r\n 以降の生バイトをそのまま Update.write へ流す）
    uint32_t written = 0;
    bool headerDone = false;
    /* ... CARECV ループ: chunk からヘッダ終端検出後の本文を Update.write(buf,len);
           written += len; written >= size で打ち切り ... */

    sendATCommand("AT+CACLOSE=" + String(clientID), 3000);

    // 6. 検証 & 確定
    if (written != size)        { Update.abort(); return false; }
    if (!Update.end(true))      { Serial.printf("[OTA] end err %d\n", Update.getError()); return false; }

    Serial.println("[OTA] success → reboot");
    delay(500);
    esp_restart();   // 戻らない
    return true;
}
```

ポイント：
- **`Update.write()` には文字列ではなく生バイト（`uint8_t*`）を渡す**。既存 config 取得は `String` に貯めているが、OTA本文は ~1MB あるため `String` に貯めず逐次書き込む（メモリ枯渇防止）。CARECV のレスポンスから `+CARECV: <len>,` の直後 `len` バイトをそのまま `Update.write` へ。
- `Update.setMD5()` を使えば **MD5照合は Update ライブラリが自動実行**（自前のハッシュ計算不要）。MD5は完全性チェック用途で十分（信頼済みサーバ＋secret認証前提）。
- CARECV最大は **1460**（2048不可。`memory/feedback_sim7080g_carecv.md` 既知事項）。
- 本文長は `Content-Length` ヘッダ＝サーバの `size` と一致を確認。

### 4.4 ロールバック（ブートループ保護）
Arduino frameworkの既定bootloaderはIDFの自動ロールバックを必ずしも有効化しないため、**ソフト的ガード**を入れる：

```c
RTC_DATA_ATTR uint8_t otaPendingBoots = 0;   // 新ファーム未確定で起動した回数
```
- OTA直後の新ファーム：`setup()` の早い段階で `otaPendingBoots++`。
- **初回サーバ通信が成功**したら「確定」：`esp_ota_mark_app_valid_cancel_rollback()` を呼び `otaPendingBoots = 0`。
- 起動しても `otaPendingBoots >= 3`（＝サーバに到達できないまま3回起動＝新ファーム不良の疑い）なら
  `esp_ota_set_boot_partition(前の面)` で旧ファームへ戻して `esp_restart()`。
- これで「新ファームが通信不能でブートループ」を自動回復できる。

> 将来 esp-idf framework へ移行するなら、bootloaderの `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` を使う本格ロールバックに置き換え可能。

### 4.5 安全策
- **バッテリ < 50% では実行しない**（書込中の電断はブリック要因）。
- OTAは**センサ送信完了後**に実行（データ欠損を防ぐ）。
- ダウンロード失敗（途中切断・MD5不一致）は `Update.abort()` し、**旧ファームのまま**スリープ。次サイクルで再試行（自動）。
- タイムアウト（例: 全体180秒）を設け、超えたら中断。

---

## 5. API 側設計（`foxsense-api`）

### 5.1 Prisma スキーマ追加

新モデル `Firmware`：
```prisma
model Firmware {
  id          String   @id @default(uuid())
  board       String   @default("foxsense-one") // 機種識別（将来複数機種対応）
  channel     String   @default("stable")       // stable / beta
  version     String                             // "1.0.1"（表示用）
  versionCode Int                                // 10001（比較用）
  fileName    String                             // "foxsense-one-1.0.1.bin"
  size        Int                                // バイト数（Content-Length）
  md5         String                             // 小文字hex 32桁
  notes       String?                            // 変更内容メモ
  isActive    Boolean  @default(true)            // 配信ON/OFF
  createdAt   DateTime @default(now())

  @@index([board, channel, isActive])
}
```

`ParentDevice` に列追加（更新状況の可視化用）：
```prisma
  fwVersionCode    Int?      // デバイスが最後に申告した稼働中バージョン
  fwReportedAt     DateTime? // 申告日時
  targetFwCode     Int?      // 任意: 個体ごとにピン留め（段階展開・テスト機用）
```

> マイグレーション：`prisma migrate dev`（dev）/ 本番は `prisma migrate deploy`。SQLite dev では `db push` でも可。

### 5.2 バイナリの配信方法
**nginx静的配信を推奨**（API経由ストリーミングより軽い）。
- 置き場所例: `/var/www/foxsense/firmware/foxsense-one-1.0.1.bin`
- 公開URLパス: `http://foxsense.smart-agri-vision.net/firmware/foxsense-one-1.0.1.bin`
- デバイスは現状 **port 80 の生TCP HTTP** で取得しているので、nginxの80番で静的配信できれば改修最小。
- `Content-Length` を必ず返すこと（CARECVループの終端判定に使用）。Range対応は将来の再開ダウンロード用にあると尚良（v1は不要）。

> アップロードは管理UI or 手動rsync。md5/sizeは `md5 -q file.bin` と `wc -c` で算出してDB登録（または登録APIで自動算出）。

### 5.3 config レスポンス拡張（`getDeviceConfig`）
`devices.controller.js` の `getDeviceConfig` で `req.query.fw` を受け取り、service に渡す。
`getDeviceConfig(deviceId, secret, fwCode)` 内で最新版を引き、判定して同梱：

```js
// 稼働中バージョンを記録
if (fwCode != null) {
  await prisma.parentDevice.update({
    where: { deviceId },
    data: { fwVersionCode: Number(fwCode), fwReportedAt: new Date() },
  });
}

// 配信対象の最新版（個体ピン留め targetFwCode があれば優先）
const latest = await prisma.firmware.findFirst({
  where: { board: 'foxsense-one', channel: 'stable', isActive: true },
  orderBy: { versionCode: 'desc' },
});

let firmware = null;
const wantCode = device.targetFwCode ?? latest?.versionCode;
if (latest && fwCode != null && Number(fwCode) < wantCode) {
  firmware = {
    versionCode: latest.versionCode,
    version:     latest.version,
    url:         `/firmware/${latest.fileName}`,   // ホストはデバイス側で付与
    size:        latest.size,
    md5:         latest.md5,
  };
}
```

レスポンス（既存 `data` に同梱）：
```json
{
  "success": true,
  "data": {
    "deviceId": "6C265A30",
    "parentIdHash": ...,
    "children": [ ... ],
    "firmware": {
      "versionCode": 10001,
      "version": "1.0.1",
      "url": "/firmware/foxsense-one-1.0.1.bin",
      "size": 412345,
      "md5": "9f86d081884c7d659a2feaa0c55ad015"
    }
  }
}
```
`firmware` が無い/`null` のときデバイスは何もしない（＝最新）。

### 5.4 OTA結果レポート（任意・運用可視化用）
新エンドポイント（secret認証、JWT不要）：
```
POST /api/devices/config/:deviceId/firmware-result
body: { fromCode, toCode, status: "SUCCESS"|"FAILED", error? }
```
- `ParentDevice.fwVersionCode` 更新＋イベントログ（任意で `FirmwareEvent` テーブル）。
- 無くても §5.3 の `fw` 申告だけで「上がったか」は分かるので、**v1では省略可**。

---

## 6. データ通信量・コスト

- ファームサイズ ≈ 0.4〜1.3MB / 回。
- SORACOM Cat-M1 は従量課金 → **1更新あたり概ね数円〜十数円**。
- 更新は不定期（リリース時のみ）。`firmware.isActive` と `versionCode` でサーバが完全制御するので、**勝手に毎サイクル落とすことはない**（最新なら `firmware: null`）。
- 失敗時の再試行も「新版がある間」だけ。版を上げない限り無限ループにはならない。

---

## 7. セキュリティ / 完全性

- 取得は `secret` 認証済みの config 応答で得たURL＋md5に基づく。
- **MD5でバイナリ完全性を検証**（破損・途中切断を検出）。改ざん対策としては弱いが、配信元が自前サーバ・port80社内利用前提なら実用上十分。
- 強化したい場合の将来案：HTTPS(443)配信＋SHA256、署名検証（公開鍵をファーム同梱）。現行はport80生TCPのため一旦MD5で開始。

---

## 8. 段階的ロールアウト手順（運用）

1. `targetFwCode` を**テスト機1台だけ**に設定して新版を配信 → OTA成功・稼働を確認。
2. 問題なければ `Firmware.isActive=true` の最新版として全機公開（`targetFwCode` 未設定機は自動で追従）。
3. 不具合発覚時は `isActive=false` に落とすか、旧版の `versionCode` を上げ直して**ダウングレード配信**で巻き戻し。

---

## 9. 実装タスク分解

### ファーム（`src/`）
- [ ] `platformio.ini`: `board_build.partitions = default_16MB.csv` 追加 → **有線で1回フラッシュ**
- [ ] `config.h`: `FIRMWARE_VERSION` / `FIRMWARE_VERSION_CODE` 追加
- [ ] `fetchConfigFromServer()`: GETに `&fw=` 付与、レスポンスJSONの `firmware` をパース（RTC不要、ローカル変数でOK）
- [ ] `performOta()` 新規実装（`Update.h` 使用、CARECV→`Update.write` 逐次、MD5検証）
- [ ] メインループ：センサ送信・config取得後、`firmware`あり＆事前条件OKなら `performOta()` 呼び出し
- [ ] ロールバックガード（`otaPendingBoots` / `esp_ota_mark_app_valid_cancel_rollback`）
- [ ] PSM一時無効化（`AT+CPSMS=0`）→ OTA後は通常スリープへ

### API（`foxsense-api/`）
- [ ] Prisma: `Firmware` モデル＋`ParentDevice` に `fwVersionCode/fwReportedAt/targetFwCode` 追加 → migrate
- [ ] `getDeviceConfig`: `fw` クエリ受領・バージョン記録・`firmware` 同梱ロジック
- [ ] nginx: `/firmware/` 静的配信設定（`Content-Length` 付与確認）
- [ ] （任意）`POST /config/:deviceId/firmware-result` ＋ファーム登録/一覧の管理API
- [ ] （任意）管理UIにファームアップロード＆配信トグル

### 検証
- [ ] テスト機で v1.0.0 → v1.0.1 のOTA往復（成功パス）
- [ ] 途中切断・MD5不一致で旧版維持されること
- [ ] 不良ファーム投入時に `otaPendingBoots` ロールバックが働くこと
- [ ] バッテリ<50%で見送りされること

---

## 10. 既知の注意点（このプロジェクト固有）

- CARECV の最大datalenは **1460**（2048不可）。`memory/feedback_sim7080g_carecv.md` 参照。
- HTTP/1.1 keep-alive を使う（HTTP/1.0だとバッファ解放レースの既知問題）。
- `+CAOPEN` の clientID はモデム割当で要求値と異なる場合あり → レスポンスからパースして使う。
- 読み取りループの終端は `response.endsWith("\r\nOK\r\n")` で判定（`indexOf("OK")` 不可）。
- パーティション変更後の**初回だけ有線フラッシュ必須**。これを忘れるとOTA面が無く失敗する。
- **【2026-07 追記】CNCFG(APNマッピング) が無いと PDP activation がタイムアウトし、OTAのTCP接続以前に失敗する**。connectNetworkでCNCFGを毎回投入すること。
- **【2026-07 追記】PSMをOTAダウンロード中に有効化しない**。接続確立〜受信の間にモデムがPSMスリープしUART無応答になる。performOta冒頭の `AT+CPSMS=0` は必須。
- **【2026-07 追記】CAOPENは空応答(モデム無応答)で失敗することがある**（keep-alive残socket / スロット詰まり）。全スロットクローズ+バッファ排出+リトライで対応（§4.3）。
- **【2026-07 追記・初回有線フラッシュの実務】** 親機S3のJTAG(`upload_protocol=esp-builtin`)は不安定でUSBが落ちることがある。**`upload_protocol=esptool` で直接焼く**のが確実。deep-sleep機はポート出現検知→即esptoolのリトライループ。**esptool連続リセットでE220/USB-JTAGがスタックした場合はUSB完全電源リセット(抜き差し)で復帰**（ESPリセットでは戻らない）。子機C3は `esptool --no-stub`（stub版はネイティブUSBで途中切断）。
