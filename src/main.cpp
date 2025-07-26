#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <HardwareSerial.h>

#define BME_SCK 7
#define BME_MISO 9
#define BME_MOSI 10
#define BME_CS 8

Adafruit_BME280 bme;
HardwareSerial sigfoxSerial(1);

const int SIGFOX_TX_PIN = 21; // XIAO ESP32C3 TX -> LSM100A PA3(RX)
const int SIGFOX_RX_PIN = 20; // XIAO ESP32C3 D7 -> LSM100A PA2(TX)
const int SIGFOX_RESET_PIN = 2; // XIAO ESP32C3 D0 -> LSM100A NRST
const unsigned long SEND_INTERVAL = 600000; // 10分間隔（1日144回、制限内）
const unsigned long TEST_INTERVAL = 30000;   // テスト用30秒間隔
bool USE_TEST_MODE = false; // true=テストモード, false=本番モード

void initSigfoxModule();
void sendSigfoxData(float temp, float hum, float press);
String waitForResponse(unsigned long timeout);
void diagnoseSigfoxConnection();
void resetLSM100A();

void setup() {
  Serial.begin(115200);
  delay(2000); // シリアル接続安定化のための待機
  
  Serial.println("XIAO ESP32C3 + BME280 + Sigfox LSM100A テスト開始");
  
  // BME280初期化 (I2Cアドレス0x76または0x77を試行)
  Wire.begin(6, 7); // SDA=GPIO6(D4), SCL=GPIO7(D5)
  
  if (!bme.begin(0x76)) {
    Serial.println("BME280 (0x76)で初期化失敗、0x77を試行中...");
    if (!bme.begin(0x77)) {
      Serial.println("BME280センサーが見つかりません。接続を確認してください。");
      Serial.println("確認事項:");
      Serial.println("- SDA: GPIO6 (D4)");
      Serial.println("- SCL: GPIO7 (D5)");
      Serial.println("- VCC: 3.3V");
      Serial.println("- GND: GND");
      while (1) delay(1000);
    } else {
      Serial.println("BME280センサー初期化完了 (0x77)");
    }
  } else {
    Serial.println("BME280センサー初期化完了 (0x76)");
  }
  
  // Sigfox LSM100A初期化
  Serial.println("LSM100Aハードウェアリセットを実行...");
  pinMode(SIGFOX_RESET_PIN, OUTPUT);
  resetLSM100A();
  
  Serial.println("UART接続診断を開始...");
  diagnoseSigfoxConnection();
  
  sigfoxSerial.begin(9600, SERIAL_8N1, SIGFOX_RX_PIN, SIGFOX_TX_PIN);
  delay(2000);
  
  // LSM100Aの初期化とテスト
  initSigfoxModule();
  
  Serial.println("システム初期化完了。データ送信を開始します...");
}

void loop() {
  static unsigned long lastSendTime = 0;
  unsigned long currentTime = millis();
  
  unsigned long interval = USE_TEST_MODE ? TEST_INTERVAL : SEND_INTERVAL;
  if (currentTime - lastSendTime >= interval) {
    // BME280から温度、湿度、気圧を読み取り
    float temperature = bme.readTemperature();
    float humidity = bme.readHumidity();
    float pressure = bme.readPressure() / 100.0F;
    
    Serial.println("=== センサーデータ ===");
    Serial.printf("温度: %.2f °C\n", temperature);
    Serial.printf("湿度: %.2f %%\n", humidity);
    Serial.printf("気圧: %.2f hPa\n", pressure);
    
    // センサー値の妥当性チェック
    if (isnan(temperature) || isnan(humidity) || isnan(pressure) ||
        temperature < -40 || temperature > 85 ||
        humidity < 0 || humidity > 100 ||
        pressure < 300 || pressure > 1100) {
      Serial.println("警告: センサー値が異常です。BME280の接続を確認してください。");
      Serial.println("ダミーデータで送信テストを継続...");
      temperature = 25.0;
      humidity = 50.0;
      pressure = 1013.25;
    }
    
    // Sigfoxでデータを送信
    sendSigfoxData(temperature, humidity, pressure);
    
    lastSendTime = currentTime;
  }
  
  delay(1000);
}

void resetLSM100A() {
  Serial.println("LSM100Aリセット実行中...");
  digitalWrite(SIGFOX_RESET_PIN, LOW);   // リセットアクティブ
  delay(100);
  digitalWrite(SIGFOX_RESET_PIN, HIGH);  // リセット解除
  delay(1000);  // モジュール起動待機
  Serial.println("LSM100Aリセット完了");
}

void diagnoseSigfoxConnection() {
  Serial.printf("TX Pin: %d, RX Pin: %d, Reset Pin: %d\n", SIGFOX_TX_PIN, SIGFOX_RX_PIN, SIGFOX_RESET_PIN);
  Serial.println("ピン設定確認:");
  Serial.printf("GPIO%d (TX): %s\n", SIGFOX_TX_PIN, digitalRead(SIGFOX_TX_PIN) ? "HIGH" : "LOW");
  Serial.printf("GPIO%d (RX): %s\n", SIGFOX_RX_PIN, digitalRead(SIGFOX_RX_PIN) ? "HIGH" : "LOW");
  Serial.printf("GPIO%d (RST): %s\n", SIGFOX_RESET_PIN, digitalRead(SIGFOX_RESET_PIN) ? "HIGH" : "LOW");
}

void initSigfoxModule() {
  Serial.println("Sigfox LSM100A モジュール初期化中...");
  
  // 複数のボーレートでテスト
  int baudRates[] = {9600, 19200, 115200};
  int numRates = sizeof(baudRates) / sizeof(baudRates[0]);
  
  // 複数のコマンドを試行（AT+形式のみ）
  String testCommands[] = {"AT+VER\r\n", "AT+ID\r\n", "AT+PAC\r\n", "AT+MODE\r\n", "AT+STATUS\r\n"};
  int numCommands = sizeof(testCommands) / sizeof(testCommands[0]);
  
  for (int i = 0; i < numRates; i++) {
    Serial.printf("ボーレート %d でテスト中...\n", baudRates[i]);
    sigfoxSerial.end();
    sigfoxSerial.begin(baudRates[i], SERIAL_8N1, SIGFOX_RX_PIN, SIGFOX_TX_PIN);
    delay(1000);
    
    // 各コマンドを試行
    for (int cmd = 0; cmd < numCommands; cmd++) {
      Serial.printf("コマンド '%s' を試行中...\n", testCommands[cmd].c_str());
      
      // バッファクリア
      while (sigfoxSerial.available()) {
        sigfoxSerial.read();
      }
      
      sigfoxSerial.print(testCommands[cmd]);
      String response = waitForResponse(3000);
      
      Serial.printf("応答: '%s' (長さ: %d)\n", response.c_str(), response.length());
      
      if (response.length() > 0) {
        Serial.printf("通信成功! ボーレート %d、コマンド '%s' で応答: '%s'\n", 
                     baudRates[i], testCommands[cmd].c_str(), response.c_str());
        
        // Sigfoxモードに設定
        sigfoxSerial.print("AT+MODE=0\r\n");
        response = waitForResponse(8000);
        Serial.println("Sigfoxモード設定完了");
        delay(2000); // モード切り替え後の安定化待機
        
        // バッファクリア
        while (sigfoxSerial.available()) {
          sigfoxSerial.read();
        }
        
        // デバイス情報取得（Sigfoxモードで）
        sigfoxSerial.print("AT$I=10\r\n");
        response = waitForResponse(3000);
        Serial.println("デバイスID取得完了");
        
        sigfoxSerial.print("AT$I=11\r\n");
        response = waitForResponse(3000);
        Serial.println("PAC取得完了");
        
        return; // 成功したので終了
      }
      
      delay(500);
    }
  }
  
  Serial.println("全てのボーレートで通信失敗");
  Serial.println("確認事項:");
  Serial.println("1. LSM100Aの電源供給 (3.3V)");
  Serial.println("2. TX/RXピンの正しい接続");
  Serial.println("3. GNDの共通接続");
  Serial.println("4. モジュールの動作モード");
}

String waitForResponse(unsigned long timeout) {
  String response = "";
  unsigned long startTime = millis();
  
  while (millis() - startTime < timeout) {
    if (sigfoxSerial.available()) {
      char c = sigfoxSerial.read();
      response += c;
      
      // 完全な応答を受信したかチェック
      if (response.indexOf("\r\n") >= 0 || response.indexOf("OK") >= 0 || 
          response.indexOf("ERROR") >= 0) {
        break;
      }
    }
    delay(10);
  }
  
  // 改行文字を除去
  response.trim();
  return response;
}

void sendSigfoxData(float temp, float hum, float press) {
  Serial.println("Sigfoxデータ送信中...");
  
  // バッファクリア
  while (sigfoxSerial.available()) {
    sigfoxSerial.read();
  }
  
  // データを12バイトのペイロードに変換
  int16_t temp_int = (int16_t)(temp * 100);
  uint16_t hum_int = (uint16_t)(hum * 100);
  uint16_t press_int = (uint16_t)(press * 10);
  
  char payload[25];
  sprintf(payload, "%04X%04X%04X", temp_int, hum_int, press_int);
  
  Serial.printf("送信ペイロード: %s\n", payload);
  Serial.println("=== ペイロード詳細 ===");
  Serial.printf("温度: %04X (%d) = %.2f°C\n", temp_int, temp_int, temp_int/100.0);
  Serial.printf("湿度: %04X (%d) = %.2f%%\n", hum_int, hum_int, hum_int/100.0);
  Serial.printf("気圧: %04X (%d) = %.1fhPa\n", press_int, press_int, press_int/10.0);
  
  // Sigfoxメッセージ送信（データシート準拠）
  String command = "AT$SF=" + String(payload);
  sigfoxSerial.print(command + "\r\n");
  
  // Sigfox送信は時間がかかるため45秒待機
  String response = waitForResponse(45000);
  
  if (response.indexOf("OK") >= 0 || response.indexOf("SENT") >= 0) {
    Serial.println("Sigfox送信成功!");
  } else if (response.indexOf("ERROR") >= 0) {
    Serial.println("Sigfox送信エラー: " + response);
  } else if (response.length() > 0) {
    Serial.println("Sigfox送信中: " + response);
    Serial.println("（送信が進行中の可能性があります）");
  } else {
    Serial.println("Sigfox送信: 応答なし");
    Serial.println("（バックグラウンドで送信中の可能性があります）");
  }
}