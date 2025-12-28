#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <HardwareSerial.h>
#include "config.h"  // 設定ファイル読み込み

#define BME_SCK 7
#define BME_MISO 9
#define BME_MOSI 10
#define BME_CS 8

Adafruit_BME280 bme;
HardwareSerial sigfoxSerial(1);

// 設定ファイルから読み込み
const String DEVICE_ID = String(DEVICE_SIGFOX_ID);

// 動作設定
const unsigned long SEND_INTERVAL = SEND_INTERVAL_MINUTES * 60000; // 分→ミリ秒変換
const unsigned long TEST_INTERVAL = TEST_INTERVAL_SECONDS * 1000;   // 秒→ミリ秒変換
const bool USE_TEST_MODE_VAL = USE_TEST_MODE;

bool initSigfoxModule();
void sendSigfoxData(float temp, float batteryVoltage, int batteryLevel);
String waitForResponse(unsigned long timeout);
void resetLSM100A();
float readBatteryVoltage();
int calculateBatteryLevel(float voltage);
bool checkSigfoxConnection();
void printDeviceInfo();

void setup() {
  Serial.begin(115200);
  delay(2000); // シリアル接続安定化のための待機
  
  Serial.println("🌿 FoxSense One ESP32C3 + BME280 + Sigfox 温度監視システム");
  Serial.println("📱 電源: ニッケル水素電池3本直列 (4.2V満充電)");
  Serial.println("🔗 Sigfox通信: LSM100A モジュール");
  Serial.println("🆔 設定済みデバイスID: " + DEVICE_ID);
  
  // BME280初期化
  Wire.begin(BME280_SDA_PIN, BME280_SCL_PIN); // SDA=GPIO6(D4), SCL=GPIO7(D5)
  if (!bme.begin(0x76) && !bme.begin(0x77)) {
    Serial.println("❌ BME280センサーが見つかりません");
    while (1) {
      Serial.println("⚠️  BME280接続確認: SDA=D4(GPIO6), SCL=D5(GPIO7), VCC=3.3V, GND=GND");
      delay(5000);
    }
  }
  Serial.println("✅ BME280センサー初期化完了");
  
  // A0バッテリー電圧測定ピン設定（分圧回路 減衰比1/2）
  pinMode(BATTERY_PIN, INPUT);
  
  // Sigfox LSM100A初期化
  pinMode(SIGFOX_RESET_PIN, OUTPUT);
  
  // ピン情報を表示
  Serial.printf("🔌 ピン設定: TX=GPIO%d, RX=GPIO%d, RST=GPIO%d\n", 
                SIGFOX_TX_PIN, SIGFOX_RX_PIN, SIGFOX_RESET_PIN);
  Serial.println("🔌 物理接続: XIAO_TX(D10) → LSM100A_RX, XIAO_RX(D9) → LSM100A_TX");
  
  resetLSM100A();
  sigfoxSerial.begin(SIGFOX_BAUD_RATE, SERIAL_8N1, SIGFOX_RX_PIN, SIGFOX_TX_PIN);
  delay(2000);
  
  if (initSigfoxModule()) {
    Serial.println("✅ Sigfox LSM100A 初期化成功");
    printDeviceInfo();
  } else {
    Serial.println("❌ Sigfox LSM100A 初期化失敗");
    Serial.println("⚠️  接続確認:");
    Serial.println("   1. XIAO TX(D10/GPIO21) → LSM100A RX");
    Serial.println("   2. XIAO RX(D9/GPIO20) → LSM100A TX");
    Serial.println("   3. XIAO A1(GPIO2) → LSM100A RST");
    Serial.println("   4. VCC=3.3V, GND=GND");
    Serial.println("🔧 トラブルシューティング:");
    Serial.println("   - TX/RXが逆になっていないか確認");
    Serial.println("   - LSM100Aに3.3Vが供給されているか確認");
    Serial.println("   - ジャンパ線の接触不良を確認");
  }
  
  Serial.println("🎉 FoxSense One システム初期化完了");
  Serial.printf("⏰ データ送信間隔: %s\n", USE_TEST_MODE_VAL ? "30秒 (テストモード)" : "10分 (本番モード)");
}

void loop() {
  static unsigned long lastSendTime = 0;
  static bool firstRun = true;
  unsigned long currentTime = millis();
  
  unsigned long interval = USE_TEST_MODE_VAL ? TEST_INTERVAL : SEND_INTERVAL;
  
  // 初回は即座に送信、2回目以降は間隔を守る
  if (firstRun || (currentTime - lastSendTime >= interval)) {
    firstRun = false;
    // 温度測定
    float temperature = bme.readTemperature();
    
    // バッテリー監視
    float batteryVoltage = readBatteryVoltage();
    int batteryLevel = calculateBatteryLevel(batteryVoltage);
    
    Serial.println("\n=== 🌡️ FoxSense One センサーデータ ===");
    Serial.printf("🌡️  温度: %.2f°C\n", temperature);
    Serial.printf("🔋 バッテリー電圧: %.3fV (分圧回路測定値)\n", batteryVoltage);
    Serial.printf("📊 バッテリーレベル: %d%%\n", batteryLevel);
    
    // バッテリー警告（ニッケル水素3本直列・分圧回路での測定値基準）
    bool emergencyLowBattery = false;
    if (batteryVoltage < 1.50 && batteryVoltage > 0.1) {
      Serial.println("🚨 緊急警告: バッテリー電圧低下！即充電必要！");
      Serial.println("⚠️  放電終止電圧(1.0V/本)に達しています。過放電防止のため即充電必要");
      emergencyLowBattery = true;
      
      // 緊急時：システム保護モード
      if (batteryVoltage < 1.0) {
        Serial.println("🛑 システム保護: 極低電圧のため動作停止");
        Serial.println("🔌 即座にバッテリーを充電または交換してください");
        while(1) {
          delay(10000); // 10秒待機後にリセット
          ESP.restart();
        }
      }
    } else if (batteryVoltage < 1.65 && batteryVoltage > 0.1) {
      Serial.println("⚠️  注意: バッテリー残量低下。充電を推奨します");
      Serial.println("📱 電池残量20%以下です。早めの充電をお勧めします");
    }
    
    // データ妥当性チェック
    if (isnan(temperature) || temperature < -40 || temperature > 85) {
      Serial.println("⚠️  警告: 温度センサー値異常、ダミーデータ(25.0°C)で継続");
      temperature = 25.0;
    }
    
    // 緊急低電圧時はSigfox送信をスキップ（電力消費抑制）
    if (emergencyLowBattery) {
      Serial.println("⚡ 緊急節電: バッテリー電圧低下のためSigfox送信をスキップ");
      Serial.println("🔌 バッテリーを充電後、正常動作に復帰します");
    } else {
      // Sigfox接続確認
      Serial.println("🔗 Sigfox接続確認中...");
      if (checkSigfoxConnection()) {
        Serial.println("✅ Sigfox接続OK");
        // Sigfoxでデータ送信（温度 + バッテリー情報）
        sendSigfoxData(temperature, batteryVoltage, batteryLevel);
      } else {
        Serial.println("❌ Sigfox接続エラー。直接送信を試行します");
        // 接続確認をスキップして直接データ送信を試行
        Serial.println("🚀 直接データ送信テスト...");
        sendSigfoxData(temperature, batteryVoltage, batteryLevel);
      }
    }
    
    lastSendTime = currentTime;
    
    // 次回送信まで待機メッセージ表示（本番モードのみ）
    if (!USE_TEST_MODE_VAL) {
      Serial.printf("⏰ 次回送信まで %d分待機中...\n", SEND_INTERVAL_MINUTES);
    }
  }
  
  delay(USE_TEST_MODE_VAL ? 1000 : 10000);  // 本番モードは10秒間隔でチェック
}

float readBatteryVoltage() {
  // A0ピンで分圧回路（減衰比1/2）を使った電圧測定
  uint32_t totalVoltage = 0;
  for(int i = 0; i < 16; i++) {
    totalVoltage += analogReadMilliVolts(BATTERY_PIN);  // 補正付きADC
    delay(1);
  }
  float voltage = totalVoltage / 16 / 1000.0;  // mV -> V (分圧回路の測定値そのまま)
  
  // バッテリー未接続判定
  if (voltage < 0.1) {  // 100mV未満は未接続と判定
    Serial.println("⚠️  警告: バッテリー未接続");
    return 0.0;  // 未接続時は0を返す
  }
  
  // 実際の電池電圧は分圧回路により1/2になっている
  float actualVoltage = voltage * BATTERY_VOLTAGE_DIVIDER_RATIO;  // 実電圧に補正
  Serial.printf("🔌 A0測定値: %.3fV → 実電圧: %.3fV (%.3fV/本)\n", 
                voltage, actualVoltage, actualVoltage / 3.0);
  return voltage; // 分圧回路の測定値を返す（サーバー側で補正）
}

int calculateBatteryLevel(float voltage) {
  // バッテリー未接続チェック
  if (voltage < 0.1) {
    return 0;  // 未接続時は0%
  }
  
  // ニッケル水素電池3本直列（分圧回路 1/2）でのバッテリーレベル判定
  // 実電圧 4.2V(1.4V/本) → 分圧回路測定値 2.1V が満充電
  if (voltage >= BATTERY_FULL_VOLTAGE) return 100;  // 満充電 (1.4V/本)
  if (voltage >= 2.05) return 95;   // 95% (1.37V/本)
  if (voltage >= 2.00) return 90;   // 90% (1.33V/本)
  if (voltage >= 1.95) return 80;   // 80% (1.30V/本)
  if (voltage >= 1.90) return 70;   // 70% (1.27V/本)
  if (voltage >= 1.85) return 60;   // 60% (1.23V/本)
  if (voltage >= 1.80) return 50;   // 50% (1.20V/本)
  if (voltage >= 1.75) return 40;   // 40% (1.17V/本)
  if (voltage >= 1.70) return 30;   // 30% (1.13V/本)
  if (voltage >= 1.65) return 20;   // 20% (1.10V/本) ⚠️充電推奨
  if (voltage >= 1.55) return 10;   // 10% (1.03V/本) ⚠️早急に充電必要
  if (voltage >= 1.50) return 5;    // 5% (1.00V/本) 放電終止電圧
  return 2;  // 2% (1.0V/本以下) ⚠️過放電防止・即充電必要
}

void resetLSM100A() {
  Serial.println("🔄 LSM100A 強化リセット実行中...");
  
  // 3回の強力なリセットを試行
  for (int attempt = 0; attempt < 3; attempt++) {
    Serial.printf("  リセット試行 %d/3\n", attempt + 1);
    
    // 電源リセットシミュレーション
    digitalWrite(SIGFOX_RESET_PIN, HIGH);  // 通常状態
    delay(200);
    digitalWrite(SIGFOX_RESET_PIN, LOW);   // リセットアクティブ
    delay(1000);  // 1秒間のリセット
    digitalWrite(SIGFOX_RESET_PIN, HIGH);  // リセット解除
    delay(5000);  // 5秒間の起動待機
    
    // 簡単な応答テスト
    while (sigfoxSerial.available()) sigfoxSerial.read();
    sigfoxSerial.print("AT\r\n");
    delay(500);
    String testResp = waitForResponse(3000);
    
    Serial.printf("  AT応答テスト: '%s'\n", testResp.c_str());
    if (testResp.indexOf("OK") >= 0 || testResp.length() > 0) {
      Serial.println("✅ LSM100Aリセット成功");
      return;
    }
    
    Serial.printf("  試行%d失敗、再試行中...\n", attempt + 1);
  }
  
  Serial.println("⚠️  LSM100A強化リセット完了（応答なし）");
}

bool initSigfoxModule() {
  Serial.println("🔧 Sigfox LSM100A モジュール初期化中...");
  
  // LSM100Aのデフォルトは9600bps、他の可能性も試行
  int baudRates[] = {9600, 115200, 57600, 19200, 38400};
  
  for (int i = 0; i < 5; i++) {
    Serial.printf("📡 ボーレート %d で接続テスト中...\n", baudRates[i]);
    sigfoxSerial.end();
    sigfoxSerial.begin(baudRates[i], SERIAL_8N1, SIGFOX_RX_PIN, SIGFOX_TX_PIN);
    delay(2000);  // 起動待機時間を延長
    
    // バッファクリア
    while (sigfoxSerial.available()) sigfoxSerial.read();
    
    // 複数回ATコマンドを試行
    for (int retry = 0; retry < 5; retry++) {
      sigfoxSerial.print("AT\r\n");
      String response = waitForResponse(2000);
      Serial.printf("  応答[%d]: '%s'\n", retry, response.c_str());
      
      if (response.indexOf("OK") >= 0) {
        Serial.printf("✅ ボーレート %d で通信成功\n", baudRates[i]);
        
        // 正しいボーレートを保存
        if (baudRates[i] != SIGFOX_BAUD_RATE) {
          Serial.printf("⚠️  注意: config.hのボーレートを %d に変更してください\n", baudRates[i]);
        }
        
        // LSM100AをSigfoxモードに設定
        Serial.println("🔧 Sigfoxモードに切り替え中...");
        sigfoxSerial.print("AT+MODE=0\r\n");
        String modeResponse = waitForResponse(SIGFOX_INIT_TIMEOUT);
        Serial.println("📱 モード切り替え応答: " + modeResponse);
        
        // RCZ3(日本)設定を確認・設定
        Serial.println("🌏 日本(RCZ3)設定中...");
        sigfoxSerial.print("AT$RC=1\r\n");  // RC1 = 日本
        String rczSet = waitForResponse(SIGFOX_INIT_TIMEOUT);
        Serial.println("📡 RCZ設定応答: " + rczSet);
        
        // 設定確認
        sigfoxSerial.print("AT$RC?\r\n");
        String rcz = waitForResponse(SIGFOX_INIT_TIMEOUT);
        Serial.println("🔍 現在のRCZ: " + rcz);
        
        // デバイスID確認
        Serial.println("🆔 デバイス情報確認中...");
        sigfoxSerial.print("AT$ID\r\n");
        String deviceId = waitForResponse(SIGFOX_INIT_TIMEOUT);
        Serial.println("📱 Device ID: " + deviceId);
        
        return true;
      }
    }
  }
  
  Serial.println("❌ 全てのボーレートで通信失敗");
  return false;
}

bool checkSigfoxConnection() {
  // 詳細な接続確認
  Serial.print("  AT応答確認: ");
  while (sigfoxSerial.available()) sigfoxSerial.read(); // バッファクリア
  
  sigfoxSerial.print("AT\r\n");
  String response = waitForResponse(2000);
  Serial.println("'" + response + "'");
  
  bool isConnected = (response.indexOf("OK") >= 0);
  if (!isConnected) {
    Serial.println("  📊 詳細診断中...");
    
    // モード確認
    while (sigfoxSerial.available()) sigfoxSerial.read();
    sigfoxSerial.print("AT+MODE?\r\n");
    String modeResp = waitForResponse(1000);
    Serial.println("  現在モード: '" + modeResp + "'");
    
    // 強制的にSigfoxモードに設定
    while (sigfoxSerial.available()) sigfoxSerial.read();
    sigfoxSerial.print("AT+MODE=0\r\n");
    delay(1000);
    String setModeResp = waitForResponse(2000);
    Serial.println("  モード設定: '" + setModeResp + "'");
    
    // 再度AT確認
    while (sigfoxSerial.available()) sigfoxSerial.read();
    sigfoxSerial.print("AT\r\n");
    String retryResp = waitForResponse(2000);
    Serial.println("  再試行AT: '" + retryResp + "'");
    
    isConnected = (retryResp.indexOf("OK") >= 0);
  }
  
  return isConnected;
}

void printDeviceInfo() {
  Serial.println("📋 Sigfoxデバイス情報:");
  Serial.println("🔍 各種ATコマンドをテスト中...");
  
  // バッファクリア
  while (sigfoxSerial.available()) sigfoxSerial.read();
  delay(100);
  
  // 方法1: AT$ID (LSM100A公式コマンド)
  Serial.print("  AT$ID を試行: ");
  sigfoxSerial.print("AT$ID\r\n");
  delay(500);
  String response1 = waitForResponse(1000);
  Serial.println("'" + response1 + "'");
  
  // 方法2: AT$PAC (LSM100A PACコマンド)
  Serial.print("  AT$PAC を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  sigfoxSerial.print("AT$PAC\r\n");
  delay(500);
  String response2 = waitForResponse(1000);
  Serial.println("'" + response2 + "'");
  
  // 方法3: ATI (製品情報)
  Serial.print("  ATI を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  sigfoxSerial.print("ATI\r\n");
  delay(500);
  String response3 = waitForResponse(1000);
  Serial.println("'" + response3 + "'");
  
  // 方法4: AT+CGMI (製造元情報)
  Serial.print("  AT+CGMI を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  sigfoxSerial.print("AT+CGMI\r\n");
  delay(500);
  String response4 = waitForResponse(1000);
  Serial.println("'" + response4 + "'");
  
  // 方法5: AT+CGMM (モデル情報)
  Serial.print("  AT+CGMM を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  sigfoxSerial.print("AT+CGMM\r\n");
  delay(500);
  String response5 = waitForResponse(1000);
  Serial.println("'" + response5 + "'");
  
  // 追加診断: モード確認
  Serial.print("  AT+MODE? を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  sigfoxSerial.print("AT+MODE?\r\n");
  delay(500);
  String modeResponse = waitForResponse(1000);
  Serial.println("'" + modeResponse + "'");
  
  // Sigfoxモードに切り替えを試行
  Serial.print("  AT+MODE=0 を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  sigfoxSerial.print("AT+MODE=0\r\n");
  delay(1000);
  String modeSetResponse = waitForResponse(2000);
  Serial.println("'" + modeSetResponse + "'");
  
  // 再度デバイスID取得を試行（モード設定後）
  Serial.print("  モード設定後 AT+ID を試行: ");
  while (sigfoxSerial.available()) sigfoxSerial.read();
  delay(1000);  // モード切り替え後の安定化待機
  sigfoxSerial.print("AT+ID\r\n");
  delay(500);
  String idRetry = waitForResponse(2000);
  Serial.println("'" + idRetry + "'");
  
  // 16進数として解析を試行
  if (idRetry.length() > 0) {
    Serial.print("  16進数解析: ");
    for (int i = 0; i < idRetry.length(); i++) {
      Serial.printf("%02X ", (uint8_t)idRetry[i]);
    }
    Serial.println();
    
    // 8文字の16進数ID抽出を試行
    String extractedId = "";
    for (int i = 0; i < idRetry.length(); i++) {
      char c = idRetry[i];
      if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')) {
        extractedId += c;
        if (extractedId.length() >= 8) break;
      }
    }
    if (extractedId.length() >= 7) {
      Serial.println("  抽出されたID: " + extractedId);
    }
  }
  
  Serial.println("⚠️  注意: LSM100AがLoRaモードの可能性があります");
  Serial.println("📖 デバイスIDはSigfoxバックエンドで確認できます: 37C193D");
}

String waitForResponse(unsigned long timeout) {
  String response = "";
  unsigned long startTime = millis();
  bool foundEnd = false;
  
  while (millis() - startTime < timeout && !foundEnd) {
    while (sigfoxSerial.available()) {
      char c = sigfoxSerial.read();
      response += c;
      
      // LSM100Aは\r\nで終端
      if (response.length() >= 2) {
        int len = response.length();
        if (response[len-2] == '\r' && response[len-1] == '\n') {
          foundEnd = true;
          break;
        }
      }
    }
    delay(10);
  }
  
  // 改行文字を除去
  response.trim();
  
  // LSM100Aはエコーバックするので、コマンド部分を除去
  int idx = response.indexOf("\r");
  if (idx > 0) {
    response = response.substring(idx + 2);  // \r\nの後から
    response.trim();
  }
  
  return response;
}

void sendSigfoxData(float temp, float batteryVoltage, int batteryLevel) {
  Serial.println("\n📡 FoxSense One データ送信中...");
  
  // バッファクリア
  while (sigfoxSerial.available()) {
    sigfoxSerial.read();
  }
  
  // サーバー側の解析形式に合わせたペイロード作成
  // 8バイト構成: 温度(2) + バッテリーレベル(1) + バッテリー電圧(2) + 予備(3)
  int16_t temp_int = (int16_t)(temp * 100);           // 温度を100倍して整数化
  uint8_t battery_level = (uint8_t)batteryLevel;      // バッテリーレベル（0-100%）
  uint16_t battery_voltage = (uint16_t)(batteryVoltage * 100); // 電圧を100倍
  
  char payload[17]; // 8バイト = 16文字 + null終端
  sprintf(payload, "%04X%02X%04X000000", 
          (uint16_t)temp_int,       // 温度（2バイト）
          battery_level,            // バッテリーレベル（1バイト）
          battery_voltage           // バッテリー電圧（2バイト）
          // 残り3バイトは予備（000000）
  );
  
  Serial.printf("📦 送信ペイロード: %s\n", payload);
  Serial.println("📊 ペイロード詳細:");
  Serial.printf("  🌡️  温度: %04X = %.2f°C\n", (uint16_t)temp_int, temp_int/100.0);
  Serial.printf("  📊 バッテリーレベル: %02X = %d%%\n", battery_level, battery_level);
  Serial.printf("  🔋 バッテリー電圧: %04X = %.3fV\n", battery_voltage, battery_voltage/100.0);
  
  // Sigfox送信コマンド（AT$SFが正しい形式）
  String command = "AT$SF=" + String(payload);
  Serial.printf("📤 送信コマンド: %s\n", command.c_str());
  
  sigfoxSerial.print(command + "\r\n");
  
  // Sigfox送信は時間がかかるため45秒待機
  Serial.println("⏳ 送信中... (最大45秒)");
  String response = waitForResponse(SIGFOX_RESPONSE_TIMEOUT);
  
  Serial.printf("📨 応答: '%s'\n", response.c_str());
  
  if (response.indexOf("OK") >= 0) {
    Serial.println("🎉 FoxSense One データ送信成功!");
  } else if (response.indexOf("SENT") >= 0) {
    Serial.println("🎉 FoxSense One データ送信成功!");
  } else if (response.indexOf("ERROR") >= 0) {
    Serial.println("❌ 送信エラー: " + response);
  } else if (response.length() == 0) {
    Serial.println("⚠️  応答タイムアウト（送信は継続中の可能性あり）");
  } else {
    Serial.println("❓ 不明な応答: " + response);
  }
  
  Serial.println("✅ 送信処理完了\n");
}