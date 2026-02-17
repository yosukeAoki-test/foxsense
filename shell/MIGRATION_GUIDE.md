# agri-iot → agri-iot2 移行ガイドライン

## 概要

agri-iot2は、agri-iotの大幅な機能強化版です。主な変更点：
- **LTE接続の統合管理**（EM7430/AK-020/Quectel対応）
- **WiFi/LTE自動切り替え機能**
- **センサー読み取りの安定性向上**
- **リレー制御の強化**

---

## 1. 事前準備

### 1.1 現在の環境確認

```bash
# デバイスにSSHログイン後
cd /root/agri-iot/shell

# 現在のcronジョブ確認
crontab -l

# 実行中のサービス確認
systemctl list-units --type=service | grep -E "mist|relay|observe|rainfall"

# 使用中のモデム確認
lsusb | grep -iE "sierra|quectel|abit"
```

### 1.2 バックアップ

```bash
# 既存コードのバックアップ
cp -r /root/agri-iot /root/agri-iot.backup.$(date +%Y%m%d)

# 設定ファイルのバックアップ
cp /etc/ppp/peers/soracom* /root/backup/ 2>/dev/null
cp /etc/wvdial.conf /root/backup/ 2>/dev/null
```

---

## 2. 削除された機能（要確認）

以下の機能はagri-iot2で削除されています：

| 機能 | 削除ファイル | 対応 |
|------|-------------|------|
| CO2センサー | co2.py, co2.sh | サーバーAPI経由に移行、または手動復元 |
| 降雨センサー | rainfall.py, rainfall_conf.py | 同上 |
| 監視サービス | observe.sh, observe.service | network_monitor.shで代替 |

**確認事項：**
- [ ] CO2センサーを使用していますか？ → 使用中なら手動でファイル復元が必要
- [ ] 降雨センサーを使用していますか？ → 同上

---

## 3. 移行手順

### Step 1: 新コードのデプロイ

```bash
# Macから実行（または直接デバイスでgit clone）
cd /Users/aoki_dog/agri-iot2/shell
./mac_pack_send.sh pi@<デバイスIP>

# または手動でscp
scp -r /Users/aoki_dog/agri-iot2/shell/* pi@<デバイスIP>:/tmp/agri-iot2/
```

### Step 2: デバイス上でのインストール

```bash
# デバイスにSSH接続
ssh pi@<デバイスIP>

# 新ディレクトリ作成
sudo mkdir -p /root/agri-iot2/shell

# ファイルコピー
sudo cp -r /tmp/agri-iot2/* /root/agri-iot2/shell/
sudo chmod +x /root/agri-iot2/shell/*.sh
sudo chmod +x /root/agri-iot2/shell/*.py

# 設定ファイルを旧環境からコピー
sudo cp /root/agri-iot/shell/conf.txt /root/agri-iot2/shell/
sudo cp /root/agri-iot/shell/mist_conf.py /root/agri-iot2/shell/
```

### Step 3: LTE関連スクリプトのインストール

```bash
# 実行スクリプトを/usr/local/binにコピー
sudo cp /root/agri-iot2/shell/detect_modem.sh /usr/local/bin/
sudo cp /root/agri-iot2/shell/network_mode.sh /usr/local/bin/
sudo cp /root/agri-iot2/shell/network-startup.sh /usr/local/bin/
sudo cp /root/agri-iot2/shell/mbim_connect_stable.sh /usr/local/bin/
sudo cp /root/agri-iot2/shell/ppp_connect.sh /usr/local/bin/
sudo cp /root/agri-iot2/shell/soracom-ip-setup.sh /usr/local/bin/

sudo chmod +x /usr/local/bin/*.sh
```

### Step 4: モデム別設定

#### EM7430 / AK-020 (MBIM) の場合

```bash
# udevルール設定（ModemManager競合防止）
sudo cp /root/agri-iot2/shell/99-em7430-modemmanager-ignore.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules

# MBIM設定ファイル
sudo cp /root/agri-iot2/shell/mbim-network.conf /etc/

# ModemManager無効化
sudo systemctl stop ModemManager
sudo systemctl disable ModemManager
```

#### Quectel (PPP) の場合

```bash
# wvdial設定確認
cat /etc/wvdial.conf

# chap-secrets設定
sudo grep "sora" /etc/ppp/chap-secrets || \
  echo "sora * sora" | sudo tee -a /etc/ppp/chap-secrets
```

### Step 5: Systemdサービス設定

```bash
# サービスファイルコピー
sudo cp /root/agri-iot2/shell/network-startup.service /etc/systemd/system/
sudo cp /root/agri-iot2/shell/lte-connect.service /etc/systemd/system/

# サービス有効化
sudo systemctl daemon-reload
sudo systemctl enable network-startup.service

# 旧サービス無効化（該当する場合）
sudo systemctl disable observe.service 2>/dev/null
sudo systemctl disable rainfall.service 2>/dev/null
```

### Step 6: Cronジョブ更新

```bash
# 現在のcronを確認
crontab -l

# 新しいcronjob.shのパスに更新
# 例: /root/agri-iot/shell/cronjob.sh → /root/agri-iot2/shell/cronjob.sh
crontab -e
```

**cronエントリ例：**
```cron
*/5 * * * * /root/agri-iot2/shell/cronjob.sh >> /var/log/cronjob.log 2>&1
```

---

## 4. 設定ファイルの変更点

### 4.1 conf.txt

変更不要（互換性あり）。必要に応じて以下を追加：

```bash
# センサー電源制御GPIO（オプション）
sensor_power_gpio=17
```

### 4.2 relay_conf.py（新規作成が必要）

agri-iot2のrelay.pyは`relay_conf.py`を使用します：

```python
# /root/agri-iot2/shell/relay_conf.py
url = "https://app.nougubako.jp"
terminal_id = 1234  # 実際のIDに変更
temperature_gpio = 4
relay_gpios = [26]
```

### 4.3 mbim-network.conf

```bash
# /etc/mbim-network.conf
APN=soracom.io
PROXY=no
```

---

## 5. 動作確認

### 5.1 モデム検出テスト

```bash
sudo /usr/local/bin/detect_modem.sh verbose
# 期待出力: em7430 / ak020 / quectel
```

### 5.2 LTE接続テスト

```bash
# 接続
sudo /usr/local/bin/network_mode.sh connect

# 確認
ip addr show wwan0  # MBIM
# または
ip addr show ppp0   # PPP

# ping確認
ping -c 3 8.8.8.8
```

### 5.3 センサー読み取りテスト

```bash
cd /root/agri-iot2/shell
sudo ./report.sh
```

### 5.4 リレーテスト

```bash
# デモモード（ネットワーク不要）
sudo python3 /root/agri-iot2/shell/relay_demo.py --gpio 26 --interval 5 --duration 2

# 本番モード
sudo python3 /root/agri-iot2/shell/relay.py
```

---

## 6. トラブルシューティング

### 6.1 LTE接続できない

```bash
# ログ確認
cat /var/log/network_mode.log
cat /tmp/mbim_connect_stable.log

# モデム状態確認
sudo mbimcli -d /dev/cdc-wdm0 --query-device-caps
sudo mbimcli -d /dev/cdc-wdm0 --query-signal-state
```

### 6.2 センサー読み取りエラー

```bash
# IIOデバイス確認
ls -la /sys/bus/iio/devices/

# センサードライバ確認
dmesg | grep -i bme280
dmesg | grep -i dht
```

### 6.3 リレーが動作しない

```bash
# GPIO状態確認
cat /sys/class/gpio/gpio26/value

# 手動テスト
echo 26 | sudo tee /sys/class/gpio/export
echo out | sudo tee /sys/class/gpio/gpio26/direction
echo 1 | sudo tee /sys/class/gpio/gpio26/value
sleep 2
echo 0 | sudo tee /sys/class/gpio/gpio26/value
```

---

## 7. ロールバック手順

問題が発生した場合：

```bash
# cronを旧バージョンに戻す
crontab -e
# /root/agri-iot2/shell/cronjob.sh → /root/agri-iot/shell/cronjob.sh

# サービス無効化
sudo systemctl disable network-startup.service
sudo systemctl disable lte-connect.service

# 旧環境復元
sudo cp -r /root/agri-iot.backup.* /root/agri-iot
```

---

## 8. 移行チェックリスト

### 事前準備
- [ ] 現在の環境確認完了
- [ ] バックアップ作成完了
- [ ] 削除機能の影響確認（CO2/降雨センサー）

### インストール
- [ ] 新コードデプロイ完了
- [ ] LTEスクリプト配置完了
- [ ] モデム別設定完了
- [ ] udevルール設定完了（EM7430/AK-020の場合）

### 設定
- [ ] conf.txt確認/更新
- [ ] relay_conf.py作成（relay使用時）
- [ ] mbim-network.conf設定（MBIM使用時）
- [ ] Systemdサービス有効化
- [ ] Cronジョブ更新

### 動作確認
- [ ] モデム検出テスト成功
- [ ] LTE接続テスト成功
- [ ] センサー読み取りテスト成功
- [ ] リレーテスト成功（該当する場合）
- [ ] 24時間運用テスト完了

---

## 9. 参考ドキュメント

- `LTE_SETUP_GUIDE.md` - LTE設定の詳細
- `MBIM_STABILIZATION_GUIDE.md` - MBIM接続安定化
- `LTE_PRI_FIX.md` - EM7430 PRIファームウェア修正

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-16 | 初版作成 |
