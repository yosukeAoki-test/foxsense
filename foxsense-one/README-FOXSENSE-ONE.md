# FoxSense One - 廉価版温度監視システム

FoxSense Oneは、温度データのみに特化したIoT監視システムです。Sigfoxネットワークを利用してセンサーデータをクラウドに蓄積し、Webインターフェースで監視できます。

## 🌟 特徴

- **温度データ特化**: 温度測定のみに絞った廉価版
- **Sigfox連携**: Sigfox APIからデータを定期取得
- **ユーザー認証**: メール・パスワードでのログインシステム
- **マルチデバイス対応**: 複数デバイスの一元管理
- **リアルタイム監視**: 温度異常の自動検知とアラート

## 🏗️ アーキテクチャ

```
[FoxSenseデバイス] → [Sigfoxクラウド] → [Sigfox API] → [Laravel App] → [MySQL DB] → [Webダッシュボード]
```

## 📊 データベース設計

### Users テーブル
- 標準Laravel認証機能

### Devices テーブル
- `sigfox_device_id`: SigfoxデバイスID (8文字)
- `device_name`: デバイス名
- `location`: 設置場所
- `temp_min/max`: 温度閾値
- `user_id`: 所有者
- `last_seen`: 最終データ受信時刻

### TemperatureData テーブル
- `device_id`: デバイス参照
- `sigfox_time`: Sigfox送信時刻
- `temperature`: 温度データ
- `rssi/snr`: 通信品質
- `raw_data`: 生データ

## 🚀 セットアップ

### 1. 環境構築
```bash
composer install
cp .env.example .env
php artisan key:generate
```

### 2. データベース設定
```bash
php artisan migrate
```

### 3. Sigfox API設定
`.env`に以下を追加:
```env
SIGFOX_USERNAME=your_username
SIGFOX_PASSWORD=your_password
```

### 4. 定期同期設定
`app/Console/Kernel.php`に以下を追加:
```php
$schedule->command('foxsense:sync')->everyFifteenMinutes();
```

## 🔧 使用方法

### Sigfoxデータ同期
```bash
# 全デバイスの同期
php artisan foxsense:sync

# 特定デバイスの同期
php artisan foxsense:sync --device=12345678
```

### デバイス登録
```php
use App\Models\Device;

Device::create([
    'sigfox_device_id' => '12345678',
    'device_name' => 'Office Temperature Sensor',
    'location' => 'Meeting Room A',
    'temp_min' => 18.0,
    'temp_max' => 28.0,
    'user_id' => 1,
]);
```

## 📡 Sigfox連携

### データ形式
- **ペイロード**: 温度データのみ（4バイト）
- **エンコード**: 16bit整数、100倍値
- **例**: `0BEF` → 3055 → 30.55°C

### API取得間隔
- **推奨**: 15分間隔
- **制限**: Sigfox API Rate Limit考慮

## 🎨 Webインターフェース

### ダッシュボード機能
- [ ] デバイス一覧表示
- [ ] リアルタイム温度表示
- [ ] 温度グラフ（時系列）
- [ ] アラート履歴
- [ ] デバイス設定

### 認証機能
- [ ] ユーザー登録・ログイン
- [ ] パスワードリセット
- [ ] デバイス所有権管理

## 📈 今後の拡張

### Phase 2
- [ ] メール通知機能
- [ ] CSVエクスポート
- [ ] APIエンドポイント

### Phase 3
- [ ] モバイルアプリ
- [ ] 他センサー対応（湿度・気圧）
- [ ] 機械学習による異常検知

## 🛠️ 開発

### テスト実行
```bash
php artisan test
```

### コードスタイル
```bash
./vendor/bin/pint
```

## 📞 サポート

技術的な質問やバグレポートは、GitHubのIssuesでお知らせください。

---

**FoxSense One** - シンプル・安価・効果的な温度監視ソリューション