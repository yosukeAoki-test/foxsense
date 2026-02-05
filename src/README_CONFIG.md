# FoxSense One デバイス側設定ファイル説明

## 設定ファイルの使い方

### config.h の編集

各デバイスに合わせて `/src/config.h` を編集してください。

```cpp
// ===== FoxSense One デバイス設定 =====

// Sigfoxデバイス設定
#define DEVICE_SIGFOX_ID "037C193D"        // ← ここを実際のデバイスIDに変更
```

## 主要設定項目

### 1. デバイス識別設定
| 設定項目 | 説明 | 例 |
|---------|------|-----|
| `DEVICE_SIGFOX_ID` | LSM100AのSigfox ID (8文字16進数) | "037C193D" |

**注意**: デバイス名・設置場所はサーバー側のWeb管理画面でのみ管理します。

### 2. 動作モード設定
| 設定項目 | 説明 | 推奨値 |
|---------|------|-------|
| `USE_TEST_MODE` | テストモード有効/無効 | false (本番), true (テスト) |
| `SEND_INTERVAL_MINUTES` | 本番モード送信間隔 (分) | 10 |
| `TEST_INTERVAL_SECONDS` | テストモード送信間隔 (秒) | 30 |

## デバイス固有設定の手順

### 1. デバイスIDの確認
```
1. XIAO ESP32C3 + LSM100Aを接続
2. シリアルモニターで起動ログを確認
3. "LSM100A Device ID: XXXXXXXX" の値をメモ
```

### 2. config.h の編集
```cpp
// 取得したIDに書き換え
#define DEVICE_SIGFOX_ID "037C193D"  // ← 実際のID
```

### 3. Webシステムでの登録
```
1. https://smart-agri-vision.net/foxsense-one/ にアクセス
2. デバイス管理画面でデバイス追加
3. 同じSigfox ID "037C193D" を入力
4. デバイス名・設置場所を入力（サーバー側管理用）
```

## ファイル構成

```
foxsense/
├── src/
│   ├── config.h              ← デバイス設定ファイル
│   ├── main.cpp              ← メインプログラム
│   └── README_CONFIG.md      ← このファイル
├── platformio.ini
└── ...

foxsense-one/                 ← Webシステム側（Laravel）
├── app/
├── resources/
└── ...
```

## トラブルシューティング

### よくあるエラー

**❌ デバイスID不一致エラー**
```
⚠️ デバイスID照合: 不一致！
   設定値: 037C193D
   実際値: 12AB34CD
   config.h内のDEVICE_SIGFOX_IDを修正してください
```
→ `/src/config.h` の `DEVICE_SIGFOX_ID` を実際値に修正

**❌ Webシステムでデバイスが見つからない**
```
Device not found for callback
```
→ Webシステムのデバイス管理でSigfox IDが正しく登録されているか確認

### 設定確認方法

シリアルモニター起動時に以下が表示されます：
```
🆔 設定済みデバイスID: 037C193D
✅ デバイスID照合: 一致しています
```

## 注意事項

- **config.h はデバイスごとに個別設定が必要**
- **デバイス名・設置場所はサーバー側でのみ管理**（ハードウェア側には不要）
- Sigfox IDの重複登録は不可
- テストモードは短期間のみ使用（通信制限回避）

## 複数デバイス管理

デバイスごとに設定ファイルを作成：
```
foxsense-device-01/src/config.h  → DEVICE_SIGFOX_ID "037C193D"
foxsense-device-02/src/config.h  → DEVICE_SIGFOX_ID "12AB34EF"  
foxsense-device-03/src/config.h  → DEVICE_SIGFOX_ID "56CD78GH"
```

各デバイスのIDをそれぞれの設定ファイルに記載し、個別にビルド・書き込みを行います。