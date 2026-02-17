# agri-iot2 デプロイ・運用ガイド

## 概要

このガイドは、agri-iot2システムのデプロイから運用までを統合的に説明します。

### 対応モデム
| モデム | 接続方式 | USB ID |
|--------|----------|--------|
| EM7430 (Sierra Wireless) | MBIM | 1199:907d |
| AK-020 (Soracomドングル) | MBIM | 15eb:7d0e |
| Quectel EC25 | PPP | 2c7c:0125 |

### 対応SIM
| SIM | APN | 認証 |
|-----|-----|------|
| Soracom Air | soracom.io | CHAP (sora/sora) |
| meeq | meeq.io | なし |

---

## 1. 前提条件

### 1.1 ハードウェア
- Raspberry Pi（3B+/4推奨）
- LTEモデム（上記のいずれか）
- SIM（アクティブ化済み）

### 1.2 必要パッケージ

```bash
sudo apt update
sudo apt install -y \
    libmbim-utils \
    libqmi-utils \
    usb-modeswitch \
    usb-modeswitch-data \
    ppp \
    net-tools \
    python3-pip \
    python3-rpi.gpio

pip3 install requests pytz Adafruit_DHT pyserial
```

**注意**: `libmbim-utils`がインストールできない場合:
```bash
sudo sed -i 's/buster/bullseye/g' /etc/apt/sources.list
sudo apt update
sudo apt install -y libmbim-utils
```

### 1.3 ModemManager無効化（必須）

```bash
sudo systemctl stop ModemManager
sudo systemctl disable ModemManager
sudo systemctl mask ModemManager
```

### 1.4 SSHアクセスとroot権限

**SSHアクセス**:
```bash
# piユーザーでログイン
ssh pi@192.168.3.XXX
# パスワード: Serena22#
```

**重要**: アプリケーションファイルは`/root/agri-iot/shell/`に配置されるため、ファイル操作にはsudo/root権限が必要です。

```bash
# ファイル確認（sudo必須）
sudo ls -la /root/agri-iot/shell/

# conf.txt編集（sudo必須）
sudo nano /root/agri-iot/shell/conf.txt

# スクリプト実行（sudo必須）
sudo /root/agri-iot/shell/network_mode.sh connect
```

### 1.5 センサー電源GPIO設定（必須・BME280/DHT系）

**重要**: センサー電源をGPIOで制御しているデバイスでは、起動時にGPIOがOFFの状態でカーネルドライバ(bmp280等)が先にプローブし、BME280をBMP280として誤認識して湿度が取得できなくなる問題があります。

```bash
# /boot/config.txt に追加（sensor_power_gpioに対応するGPIOピンを指定）
# GPIO17をOutput/HIGHに設定（カーネルより先にファームウェアレベルで実行される）
echo "gpio=17=op,dh" | sudo tee -a /boot/config.txt
```

**確認方法**:
```bash
grep "gpio=17=op,dh" /boot/config.txt
```

**この設定がない場合の症状**:
- BME280の温度は取れるが湿度がI/Oエラー
- dmesgに `bmp280 1-0076: reading humidity skipped` が出力
- ドライバ再ロード(`rmmod bme280_i2c && modprobe bme280_i2c`)で一時復旧するが再起動で再発

**対象デバイス**: sensor_power_gpioを使用する全デバイス（BME280, DHT11/DHT22, DS18B20等）

### 1.6 dhcpcd.conf設定（必須・LTE安定化）

**重要**: この設定がないと、dhcpcdがwwan0にリンクローカルアドレス(169.254.x.x)を自動割り当てし、LTE通信が不安定になります。

```bash
# /etc/dhcpcd.conf に追加
cat >> /etc/dhcpcd.conf << 'EOF'

# LTE wwan0インターフェースをdhcpcdから除外（必須）
denyinterfaces wwan0

# DNS設定を保護（LTEスクリプトが管理）
nohook resolv.conf
EOF

sudo systemctl restart dhcpcd
```

**確認方法**:
```bash
grep -E "denyinterfaces|nohook" /etc/dhcpcd.conf
```

**この設定がない場合の症状**:
- wwan0に169.254.x.xアドレスが付与される
- LTE IPはあるがping失敗
- ソースルーティングが正しく設定されない

---

## 2. ファイル分類

### 2.1 コアスクリプト（必須）

| ファイル | 配置先 | 説明 |
|----------|--------|------|
| `cronjob.sh` | `/root/agri-iot/shell/` | cron定期実行 |
| `report.sh` | `/root/agri-iot/shell/` | センサーデータ取得・送信 |
| `conf.txt` | `/root/agri-iot/shell/` | **端末設定（個別編集必須）** |

### 2.2 LTE/ネットワークスクリプト

| ファイル | 配置先 | 説明 |
|----------|--------|------|
| `network_mode.sh` | `/root/agri-iot/shell/` + `/usr/local/bin/` | モデム自動検出・接続統合 |
| `mbim_connect_stable.sh` | `/root/agri-iot/shell/` + `/usr/local/bin/` | MBIM安定版接続 |
| `ppp_connect.sh` | `/root/agri-iot/shell/` | PPP接続（Quectel用） |
| `detect_modem.sh` | `/root/agri-iot/shell/` | モデム検出 |

### 2.3 センサースクリプト

| ファイル | センサー | 取得項目 |
|----------|----------|----------|
| `am2301bhumi.py` | AM2301b/DHT22 | 湿度 |
| `am2301btemp.py` | AM2301b/DHT22 | 温度 |
| `ds18b20.py` | DS18B20 | 温度 |
| `soil_sensor_temp.py` | WD5 | 土壌温度 |
| `soil_sensor_vwc.py` | WD5 | 土壌水分 |

### 2.4 ミスト/リレー（オプション）

| ファイル | 説明 |
|----------|------|
| `mist.py`, `mist.sh` | ミスト制御 |
| `relay.py`, `relay.sh` | リレー制御 |
| `relay_demo.py`, `relay_demo.service` | リレーデモ |

### 2.5 デバイス固有設定（個別編集必須）

| ファイル | 説明 |
|----------|------|
| `conf.txt` | 端末ID、URL、センサー電源GPIO |
| `mist_conf.py` | ミスト設定（使用時のみ） |
| `relay_conf.py` | リレー設定（使用時のみ） |

**端末IDのフォールバック動作:**
- `mist.py`: `mist_conf.py`がない場合、`conf.txt`の`terminal_id`を使用
- `relay.py`: `relay_conf.py`がない場合、`conf.txt`の`terminal_id`を使用

#### conf.txt 必須項目

```bash
url="https://app.nougubako.jp"    # サーバーURL
terminal_id=XXX                    # 端末ID（デバイス固有）
sensor_power_gpio=17               # センサー電源GPIO
rotate=180                         # カメラ回転角度
```

#### 既存デバイス更新時の注意（重要）

既にデプロイ済みのデバイスにスクリプトを更新する場合:

| 項目 | 対応 |
|------|------|
| `terminal_id` | **変更しない** - デバイス固有のID |
| `url` | **変更しない** - 本番/ステージング環境が異なる |
| `rotate` | **変更しない** - カメラ画像角度（デバイス設置状況による） |
| `conf.txt` | **上書きしない** - 既存設定を維持 |
| `mist_conf.py` | **上書きしない** - 既存設定を維持 |
| `relay_conf.py` | **上書きしない** - 既存設定を維持 |

**更新対象**: LTEスクリプト（`network_mode.sh`, `mbim_connect_stable.sh`等）のみ

---

## 3. デプロイ方法

### 3.1 ファイル転送（フルデプロイ）

```bash
DEVICE_IP="192.168.3.XXX"
PASSWORD="Serena22#"
SCRIPT_DIR="/Users/aoki_dog/agri-iot2/shell"

# LTE/ネットワークスクリプト
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
    $SCRIPT_DIR/network_mode.sh \
    $SCRIPT_DIR/mbim_connect_stable.sh \
    $SCRIPT_DIR/mbim_connect.sh \
    $SCRIPT_DIR/ppp_connect.sh \
    $SCRIPT_DIR/detect_modem.sh \
    $SCRIPT_DIR/soracom-ip-setup.sh \
    pi@$DEVICE_IP:/tmp/

# センサースクリプト
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
    $SCRIPT_DIR/am2301bhumi.py \
    $SCRIPT_DIR/am2301btemp.py \
    $SCRIPT_DIR/ds18b20.py \
    $SCRIPT_DIR/soil_sensor_temp.py \
    $SCRIPT_DIR/soil_sensor_vwc.py \
    pi@$DEVICE_IP:/tmp/

# コアスクリプト
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
    $SCRIPT_DIR/cronjob.sh \
    $SCRIPT_DIR/report.sh \
    $SCRIPT_DIR/update.sh \
    pi@$DEVICE_IP:/tmp/

# ミスト/リレースクリプト（使用する場合）
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
    $SCRIPT_DIR/mist.py \
    $SCRIPT_DIR/mist.sh \
    $SCRIPT_DIR/relay.py \
    $SCRIPT_DIR/relay.sh \
    $SCRIPT_DIR/relay_demo.py \
    pi@$DEVICE_IP:/tmp/
```

### 3.2 インストール

```bash
sshpass -p "$PASSWORD" ssh pi@$DEVICE_IP << 'REMOTE'
sudo mkdir -p /root/agri-iot/shell

# 全スクリプトをagri-iot/shellへコピー
sudo cp /tmp/*.sh /tmp/*.py /root/agri-iot/shell/

# /usr/local/bin へコピー（システムパスで実行可能にする）
sudo cp /tmp/network_mode.sh /usr/local/bin/
sudo cp /tmp/mbim_connect_stable.sh /usr/local/bin/
sudo cp /tmp/soracom-ip-setup.sh /usr/local/bin/

# 実行権限付与
sudo chmod +x /root/agri-iot/shell/*.sh
sudo chmod +x /root/agri-iot/shell/*.py
sudo chmod +x /usr/local/bin/*.sh

echo "インストール完了: $(hostname)"
REMOTE
```

### 3.3 端末ID設定（新規デプロイのみ）

**既存デバイスへの更新時は実行しない**

```bash
# 新規デプロイ時のみ: conf.txtの端末ID編集
sshpass -p "$PASSWORD" ssh pi@$DEVICE_IP \
    "sudo sed -i 's/terminal_id=.*/terminal_id=XXX/' /root/agri-iot/shell/conf.txt"
```

### 3.4 既存デバイスへのスクリプト更新

既存デバイスにLTEスクリプトのみを更新する場合:

```bash
# LTEスクリプトのみ転送・更新（conf.txt等は触らない）
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no \
    $SCRIPT_DIR/network_mode.sh \
    $SCRIPT_DIR/mbim_connect_stable.sh \
    pi@$DEVICE_IP:/tmp/

sshpass -p "$PASSWORD" ssh pi@$DEVICE_IP << 'REMOTE'
sudo cp /tmp/network_mode.sh /root/agri-iot/shell/
sudo cp /tmp/mbim_connect_stable.sh /root/agri-iot/shell/
sudo cp /tmp/network_mode.sh /usr/local/bin/
sudo cp /tmp/mbim_connect_stable.sh /usr/local/bin/
sudo chmod +x /root/agri-iot/shell/*.sh /usr/local/bin/*.sh
echo "LTEスクリプト更新完了: $(hostname)"
REMOTE
```

---

## 4. APN設定

### 4.1 Soracom Air

```bash
# /etc/mbim-network.conf
APN=soracom.io
APN_USER=sora
APN_PASS=sora
APN_AUTH=CHAP
```

### 4.2 meeq

```bash
# /etc/mbim-network.conf
APN=meeq.io
```

### 4.3 設定コマンド

```bash
# Soracom
echo 'APN=soracom.io
APN_USER=sora
APN_PASS=sora
APN_AUTH=CHAP' | sudo tee /etc/mbim-network.conf

# meeq
echo 'APN=meeq.io' | sudo tee /etc/mbim-network.conf
```

---

## 5. MBIM接続の安定化

### 5.1 最重要ポイント

**MBIMセッションは接続後1-2秒でdeactivatedになる可能性があります。**

| 問題 | 対策 |
|------|------|
| セッションがすぐ切れる | 即座にIP設定を実行 |
| IPはあるがping失敗 | ソースルーティング設定 |
| 状態確認でセッション切断 | `--query-connection-state`を避ける |

### 5.2 推奨接続シーケンス

```bash
# 1. プロセスクリーンアップ
sudo pkill -9 mbimcli
sudo pkill -9 qmicli
sudo rm -f /tmp/mbim-network-state-*

# 2. USBリセット（問題時のみ）
sudo usbreset 1199:907d
sleep 4

# 3. MBIM接続
sudo mbim-network /dev/cdc-wdm0 start

# 4. 即座にIP設定（遅延なし）
sudo /usr/local/bin/soracom-ip-setup.sh

# 5. 接続確認
ping -c 2 -I wwan0 8.8.8.8
```

### 5.3 スクリプトでの接続

```bash
# 推奨（USBリセット付き）
sudo /usr/local/bin/mbim_connect_stable.sh reset-connect

# 通常
sudo /root/agri-iot/shell/network_mode.sh connect
```

### 5.4 ソースルーティング（WiFi併用時）

WiFiとLTEを同時使用する場合、wwan0の/32アドレスでは戻りパケットがWiFi経由になる問題があります。

`mbim_connect_stable.sh`は自動的に以下を設定：
```bash
ip rule add from <wwan_ip> table 100
ip route add default dev wwan0 table 100
```

### 5.5 WiFiチェック（過剰アクセス防止）

WiFi健全時はLTE接続をスキップして、モデムへの過剰アクセスを防止：

```bash
check_wifi_health() {
    local wifi_operstate=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)
    if [ "$wifi_operstate" != "up" ]; then return 1; fi
    if ! ip addr show wlan0 | grep -q "inet "; then return 1; fi
    if ! ping -c 1 -W 2 192.168.3.1 >/dev/null 2>&1; then return 1; fi
    return 0
}
```

---

## 6. PRI設定（EM7430）

### 6.1 PRI確認

```bash
sudo qmicli -d /dev/cdc-wdm0 --dms-list-stored-images --device-open-mbim
```

### 6.2 PRI切り替え

```bash
# DOCOMO PRIに切り替え（SORACOM用）
sudo qmicli -d /dev/cdc-wdm0 --dms-select-stored-image=modem0,pri0 --device-open-mbim
sudo qmicli -d /dev/cdc-wdm0 --dms-set-operating-mode=reset --device-open-mbim
sleep 15
```

### 6.3 キャリア別PRI

| SIM/キャリア | 使用PRI |
|-------------|---------|
| SORACOM (ドコモ回線) | DOCOMO (pri0) |
| IIJmio (ドコモ回線) | DOCOMO (pri0) |
| 楽天モバイル | GENERIC (pri1) |
| au/UQ mobile | KDDI (pri2) |

---

## 7. crontab設定

```cron
# 毎時0分: 写真 + 全センサー + LTE + 更新
00 * * * * /root/agri-iot/shell/cronjob.sh -p -a -b -c -u >> /tmp/cron.log 2>&1

# 毎時10,20,30,40,50分: センサー + LTE
10-50/10 * * * * /root/agri-iot/shell/cronjob.sh -a -b -c >> /tmp/cron.log 2>&1
```

**重要**: `-c`フラグがないとWiFi障害時のLTE自動切り替えが動作しません。

---

## 8. デプロイ後検証（必須）

### 8.1 カメラテスト

#### ステップ1: カメラ検出確認

```bash
vcgencmd get_camera
```

| 出力 | 判定 |
|------|------|
| `supported=1 detected=1` | **OK** |
| `supported=1 detected=0` | **NG** - カメラ未接続/ケーブル問題 |
| `supported=0 detected=0` | **NG** - カメラ機能無効 |

#### ステップ2: 撮影テスト

```bash
# テスト撮影（回転なし）
raspistill -w 1024 -h 768 -o /tmp/test.jpg

# 回転指定で撮影（conf.txtのrotate値に合わせる）
raspistill -rot 180 -w 1024 -h 768 -o /tmp/test_rotated.jpg

# ファイル確認
ls -la /tmp/test*.jpg
```

#### ステップ3: 画像確認

```bash
# ファイルサイズ確認（正常なら100KB以上）
du -h /tmp/test.jpg

# ローカルにダウンロードして確認
scp pi@192.168.3.XXX:/tmp/test.jpg ./
```

#### トラブルシューティング

| 問題 | 原因 | 対策 |
|------|------|------|
| `detected=0` | ケーブル接続不良 | ケーブル再接続、コネクタ確認 |
| `mmal: Cannot read camera info` | カメラ初期化失敗 | `sudo reboot` |
| 撮影タイムアウト | カメラハング | `sudo vcdbg log msg` で確認 |
| 画像が暗い/白い | 露出問題 | `-ex auto` オプション追加 |
| 画像が上下逆 | rotate設定 | conf.txtの`rotate=180`確認 |

#### conf.txt のカメラ設定

```bash
# /root/agri-iot/shell/conf.txt
rotate=180    # カメラ画像の回転角度（0, 90, 180, 270）
```

**注意**: rotateはデバイスの設置状況に依存するため、既存デバイスでは変更しないこと。

---

### 8.2 温度・湿度センサーテスト

#### センサー種別の判定

**crontabのフラグでセンサー種別を判定**:
```bash
sudo crontab -l | grep cronjob
```

| フラグ | センサー種別 | 接続方式 | テスト方法 |
|--------|-------------|----------|-----------|
| `-a -b` | **AM2301b (AHT10/AHT20)** | I2C (0x38) | Pythonスクリプト |
| `-t -h` | DHT22/DHT11 | GPIO (IIO) | IIOデバイス |
| `-t -h` | **BME280** | I2C (0x76/0x77) | IIOデバイス（自動検出） |

#### AM2301b系センサー（-a -bフラグの場合）

```bash
# I2Cデバイス確認（0x38があればAM2301b系）
sudo i2cdetect -y 1

# Pythonスクリプトで読み取り
sudo python3 /root/agri-iot/shell/am2301btemp.py   # 温度
sudo python3 /root/agri-iot/shell/am2301bhumi.py   # 湿度
```

**注意**: AM2301b系はIIOデバイス(`/sys/bus/iio/devices/`)では読み取れません。

#### DHT22/DHT11センサー（-t -hフラグ、GPIO接続）

```bash
# IIOデバイス確認
ls /sys/bus/iio/devices/

# 温度取得
cat /sys/bus/iio/devices/iio:device0/in_temp_input

# 湿度取得
cat /sys/bus/iio/devices/iio:device0/in_humidityrelative_input
```

#### BME280センサー（-t -hフラグ、I2C接続）

```bash
# I2Cデバイス確認（0x76または0x77があればBME280）
sudo i2cdetect -y 1

# IIOデバイス経由で読み取り（report.shが自動検出）
cat /sys/bus/i2c/devices/*/iio:device*/in_temp_input
cat /sys/bus/i2c/devices/*/iio:device*/in_humidityrelative_input
```

**-t -hフラグの場合のセンサー判別**:
- `i2cdetect`で0x76/0x77 → BME280
- `i2cdetect`でI2Cデバイスなし → DHT22/DHT11（GPIO）

**センサー応答なし時**: センサー電源リセット
```bash
echo 0 > /sys/class/gpio/gpio17/value
sleep 2
echo 1 > /sys/class/gpio/gpio17/value
sleep 3
```

### 8.3 LTE通信テスト（最重要）

#### ステップ1: LTE接続

```bash
/root/agri-iot/shell/network_mode.sh connect
```

#### ステップ2: IPアドレス確認

```bash
ip addr show wwan0 | grep inet
```

| IPアドレス | 判定 |
|------------|------|
| `10.x.x.x` / `100.x.x.x` | **OK** - SORACOM/meeq IP |
| `169.254.x.x` | **NG** - リンクローカル（DHCP失敗） |
| IPなし | **NG** - 接続失敗 |

#### ステップ3: ping確認（最重要）

```bash
ping -c 2 -I wwan0 8.8.8.8
```

| 結果 | 判定 |
|------|------|
| `0% packet loss` | **OK** |
| `100% packet loss` | **NG** |

**IPがあってもpingが失敗する場合があります。必ずpingテストを実施してください。**

#### ステップ4: 切断

```bash
/root/agri-iot/shell/network_mode.sh disconnect
```

---

## 9. トラブルシューティング

### 9.1 センサー関連

| 問題 | 原因 | 対策 |
|------|------|------|
| センサー応答なし | 電源問題 | GPIO17でリセット |
| 接続タイムアウト | ドライバ問題 | `rmmod dht11 && modprobe dht11` |
| IIOデバイスなし | ドライバ未ロード | `/boot/config.txt`確認 |
| BME280湿度だけI/Oエラー | 起動時GPIO電源OFF | `/boot/config.txt`に`gpio=17=op,dh`追加、再起動 |
| `reading humidity skipped` | BME280がBMP280として誤認識 | ドライバ再ロード(`rmmod bme280_i2c && modprobe bme280_i2c`)で一時復旧、恒久対策は上記 |

### 9.2 LTE接続関連

| 問題 | 原因 | 対策 |
|------|------|------|
| mbimcliタイムアウト | プロセス競合 | `pkill -9 mbimcli` |
| 169.254.x.x IP | **dhcpcd設定不備** | `/etc/dhcpcd.conf`に`denyinterfaces wwan0`追加 |
| IPあるがping失敗 | ルーティング問題/169.254混在 | ソースルーティング確認、dhcpcd設定確認 |
| `NotInitialized` | SIM未初期化 | USBリセット後再試行 |
| `Failure` | SIM休止/APN誤り | SIM有効化、APN設定確認 |
| `RadioPowerOff` | ラジオ電源OFF | `mbimcli --set-radio-state=on` |

### 9.3 169.254.x.x問題（dhcpcd設定不備）

**症状**: wwan0に169.254.x.xとLTE IPが両方付与され、ping失敗

```bash
# 確認
ip addr show wwan0 | grep inet
# 問題がある場合の出力例:
#   inet 169.254.33.157/16  ← dhcpcdが付与（問題）
#   inet 10.232.65.220/32   ← LTE IP（正常）
```

**原因**: `/etc/dhcpcd.conf`に`denyinterfaces wwan0`がない

**修正**:
```bash
# dhcpcd.confに設定追加
sudo bash -c 'cat >> /etc/dhcpcd.conf << EOF

# LTE wwan0をdhcpcdから除外
denyinterfaces wwan0
nohook resolv.conf
EOF'

# dhcpcd再起動
sudo systemctl restart dhcpcd

# リンクローカルアドレス削除
sudo ip addr del 169.254.33.157/16 dev wwan0 2>/dev/null

# LTE再接続
sudo /root/agri-iot/shell/network_mode.sh connect
```

### 9.4 接続後すぐにdeactivated

```bash
# USBリセット付き接続
sudo /usr/local/bin/mbim_connect_stable.sh reset-connect
```

### 9.5 30秒で接続が不安定

**原因**: cronで毎分LTE接続・切断を繰り返している

```bash
# 確認
dmesg -T | grep 'reset high-speed USB device'
sudo crontab -l | grep -E 'relay|cronjob'
```

**対策**: WiFiチェック追加済みスクリプトを使用

### 9.6 Provider not visible

**原因**: PRI設定の不一致

```bash
# DOCOMO PRIに切り替え
sudo qmicli -d /dev/cdc-wdm0 --dms-select-stored-image=modem0,pri0 --device-open-mbim
sudo qmicli -d /dev/cdc-wdm0 --dms-set-operating-mode=reset --device-open-mbim
```

### 9.7 libmbim-utilsインストール失敗

```bash
sudo sed -i 's/buster/bullseye/g' /etc/apt/sources.list
sudo apt update
sudo apt install -y libmbim-utils
```

---

## 10. 運用ベストプラクティス

### 10.1 推奨cron設定

```bash
# WiFi環境あり
00 * * * * /root/agri-iot/shell/cronjob.sh -p -a -b -c -u
10-50/10 * * * * /root/agri-iot/shell/cronjob.sh -a -b -c
```

### 10.2 LTE使用後のWiFi復帰

```bash
/root/agri-iot/shell/network_mode.sh disconnect
sudo ip link set wlan0 up
sleep 5
```

### 10.3 ログ確認

| ログファイル | 内容 |
|------------|------|
| `/tmp/cron.log` | cronjob実行ログ |
| `/tmp/mbim_connect_stable.log` | MBIM接続詳細 |
| `/var/log/network_mode.log` | network_mode.shログ |

```bash
# リアルタイム監視
tail -f /tmp/mbim_connect_stable.log
```

---

## 11. クイックリファレンス

### report.shオプション

| オプション | 説明 |
|-----------|------|
| `-p` | 写真撮影 |
| `-a` | AM2301b温度 |
| `-b` | AM2301b湿度 |
| `-d` | DS18B20温度 |
| `-e` | WD5土壌水分 |
| `-f` | WD5土壌温度 |
| `-c` | LTE接続・切断 |
| `-u` | 自動更新 |

### デプロイ後チェックリスト

- [ ] **カメラ検出** (`vcgencmd get_camera` → `detected=1`)
- [ ] **カメラ撮影テスト** (`raspistill -o /tmp/test.jpg`)
- [ ] センサー検出 (`ls /sys/bus/iio/devices/`)
- [ ] **温度取得テスト** (値が正常か確認)
- [ ] **湿度取得テスト** (値が正常か確認)
- [ ] **GPIO電源設定確認** (`grep "gpio=17=op,dh" /boot/config.txt`)
- [ ] **dhcpcd.conf設定確認** (`grep "denyinterfaces wwan0" /etc/dhcpcd.conf`)
- [ ] LTE接続テスト (`network_mode.sh connect`)
- [ ] **wwan0に169.254.x.xがないか確認** (`ip addr show wwan0`)
- [ ] **LTE ping確認** (`ping -c 2 -I wwan0 8.8.8.8`)
- [ ] **crontab確認** (`sudo crontab -l` → `-c`フラグあり、センサーフラグ確認)
- [ ] **conf.txt確認** (`terminal_id`設定、`rotate`角度、`sensor_power_gpio`確認)

### モデム検出

```bash
lsusb | grep -i "1199:907\|15eb:7d0e\|2c7c:0125"
ls -la /dev/cdc-wdm*
```

---

## 12. 診断情報収集

問題発生時は以下を収集:

```bash
# 診断実行
sudo /usr/local/bin/mbim_connect_stable.sh diagnose > /tmp/diag.txt

# ログ収集
tar czf /tmp/debug.tar.gz \
    /tmp/mbim_connect_stable.log \
    /var/log/network_mode.log \
    /tmp/cron.log \
    /tmp/diag.txt
```

---

最終更新: 2026-02-09
