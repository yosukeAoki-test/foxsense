# FoxSense One - Sigfox Integration Guide

## コールバック設定

### 現在の設定
```
URL: https://smart-agri-vision.net/foxsense-one/api/sigfox/callback
Method: POST
Content-Type: application/x-www-form-urlencoded

Parameters:
?device={device}&time={time}&data={data}&seqNumber={seqNumber}
```

### **✅ 設定は正しく動作します！**

## データフロー

1. **リアルタイム受信（推奨）**
   - SigfoxデバイスからのデータをHTTPコールバックで即座に受信
   - 自動的にDBに保存、アラート通知を送信

2. **定期同期（バックアップ）**
   - 5分間隔でSigfox APIから取得
   - 万一コールバックが失敗した場合の保険

## 実装済み機能

### セキュリティ
- ✅ CSRF保護除外設定済み
- ✅ レート制限（1000リクエスト/分）
- ✅ 入力値検証（デバイスID、時刻、データ形式）
- ✅ IPアドレスログ記録
- 🔧 IPホワイトリスト（必要に応じて有効化可能）

### データ処理
- ✅ 重複データ自動スキップ
- ✅ 温度データ解析（16bit符号付き整数、100倍値）
- ✅ バッテリーデータ解析（レベル、電圧）
- ✅ デバイス最終接続時刻更新
- ✅ 温度・バッテリーアラート通知

### ログ記録
- ✅ 全受信データをログ出力
- ✅ エラー詳細記録
- ✅ セキュリティイベント記録

## ペイロード形式

FoxSense Oneデバイスのペイロード構造：
```
8バイト（16文字）の16進数文字列
┌──────┬─────┬────────┬────────┐
│温度  │電池 │電池電圧│ 予備   │
│2byte │1byte│2byte   │3byte   │
└──────┴─────┴────────┴────────┘

例: "0BEF5C8352000000"
- 0BEF = 3055 → 30.55°C
- 5C = 92 → 92%
- 8352 = 33618 → 3.36V (分圧回路補正後)
```

## Sigfox Backend設定

1. **Device Type設定**
   ```
   Callback URL: https://smart-agri-vision.net/foxsense-one/api/sigfox/callback?device={device}&time={time}&data={data}&seqNumber={seqNumber}
   HTTP Method: POST
   Content Type: application/x-www-form-urlencoded
   ```

2. **推奨設定**
   ```
   Callback Type: DATA + UPLINK
   Callback Subtype: (空白でOK)
   Channel: URL
   Enabled: ✓
   Send duplicate: ✗ (重複無効)
   ```

## 動作確認

### ログ確認
```bash
# リアルタイムログ監視
ssh fox@210.131.217.236
tail -f /var/www/sav/foxsense-one/storage/logs/laravel.log

# コールバック受信ログを検索
grep "Sigfox callback received" /var/www/sav/foxsense-one/storage/logs/laravel.log
```

### 手動テスト
```bash
# curl でテスト送信
curl -X POST "https://smart-agri-vision.net/foxsense-one/api/sigfox/callback" \
  -d "device=ABCD1234&time=1640995200&data=0BEF5C8352000000&seqNumber=123"
```

### データベース確認
```sql
-- 最新の受信データ確認
SELECT d.device_name, td.temperature, td.battery_level, 
       FROM_UNIXTIME(td.sigfox_time) as received_at
FROM temperature_data td 
JOIN devices d ON td.device_id = d.id 
ORDER BY td.sigfox_time DESC 
LIMIT 10;
```

## トラブルシューティング

### よくある問題

1. **コールバックが受信されない**
   - Sigfox Backendの設定確認
   - HTTPSアクセス可能性確認
   - デバイス通信状態確認

2. **データが解析できない**
   - ペイロード形式の確認
   - 16進データの妥当性チェック
   - ログでparseエラー確認

3. **重複データ**
   - 時刻ベースの重複チェックが動作
   - 同一時刻の重複は自動スキップ

### 監視ポイント
- ✅ コールバック受信頻度
- ✅ データ解析成功率  
- ✅ アラート通知動作
- ✅ デバイス最終接続時刻