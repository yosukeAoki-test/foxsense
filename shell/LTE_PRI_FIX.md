# EM7430 LTE接続問題の修正手順

## 問題の概要

Sierra Wireless EM7430がネットワークに接続できない場合、PRI（Preferred Roaming Information）設定が原因の可能性がある。

### 症状
- `ProviderNotVisible` エラー
- `NotRegistered` エラー
- RSSI = 99 (信号なし)
- AT!コマンドがすべてERROR（CARMD-EVファームウェア）

## 診断手順

### 1. 現在のPRI設定を確認

```bash
# ModemManagerを停止
sudo systemctl stop ModemManager

# 保存されているファームウェアイメージを一覧表示
sudo qmicli -d /dev/cdc-wdm0 --dms-list-stored-images --device-open-mbim
```

出力例:
```
[pri0] Build ID: '02.24.05.06_DOCOMO'
[pri1] Build ID: '02.24.05.06_GENERIC'
[pri2] Build ID: '02.24.05.06_KDDI'      ← [CURRENT] これが問題！
[pri3] Build ID: '02.24.05.06_TELSTRA'
```

**KDDI PRIがアクティブな場合、ドコモ系SIM（SORACOM等）では接続不可**

## 修正手順

### 2. DOCOMO PRIに切り替え

```bash
# DOCOMO PRI (pri0) を選択
sudo qmicli -d /dev/cdc-wdm0 --dms-select-stored-image=modem0,pri0 --device-open-mbim
```

### 3. モデムをリセット

```bash
# オフラインにしてリセット
sudo qmicli -d /dev/cdc-wdm0 --dms-set-operating-mode=offline --device-open-mbim
sleep 2
sudo qmicli -d /dev/cdc-wdm0 --dms-set-operating-mode=reset --device-open-mbim
```

### 4. リセット後の確認（15秒待機）

```bash
sleep 15

# Operating modeが'online'であることを確認
sudo qmicli -d /dev/cdc-wdm0 --dms-get-operating-mode --device-open-mbim
# → Mode: 'online' であればOK

# 信号強度を確認
sudo qmicli -d /dev/cdc-wdm0 --nas-get-signal-strength --device-open-mbim

# ネットワーク登録を確認
sudo qmicli -d /dev/cdc-wdm0 --nas-get-serving-system --device-open-mbim
# → Provider name: 'NTT DOCOMO' であればOK
```

## LTE接続手順

### 5. mbim-proxyを起動（接続を維持するため）

```bash
sudo pkill mbim-proxy 2>/dev/null
nohup sudo mbim-proxy > /dev/null 2>&1 &
sleep 2
```

### 6. SORACOM APNで接続

```bash
sudo mbimcli -d /dev/cdc-wdm0 -p --connect="apn=soracom.io,auth=chap,username=sora,password=sora,ip-type=ipv4"
```

成功時の出力:
```
[/dev/cdc-wdm0] Successfully connected
Activation state: 'activated'
IP [0]: '10.x.x.x/30'
Gateway: '10.x.x.x'
DNS [0]: '100.127.0.53'
DNS [1]: '100.127.1.53'
```

### 7. wwan0インターフェースを設定

```bash
# 取得したIPアドレスで設定（例: 10.251.157.246/30, GW: 10.251.157.245）
sudo ip addr flush dev wwan0
sudo ip addr add 10.251.157.246/30 dev wwan0
sudo ip link set wwan0 up
sudo ip route add default via 10.251.157.245 dev wwan0 metric 50
```

### 8. 接続テスト

```bash
ping -c 3 -I wwan0 8.8.8.8
```

## 自動化スクリプト

上記の手順は `em7430_pri_fix.sh` として自動化されています。

```bash
sudo /root/agri-iot/shell/em7430_pri_fix.sh
```

## 注意事項

- PRI切り替えは永続的（再起動後も維持される）
- KDDI SIMを使用する場合はKDDI PRIに戻す必要あり
- mbim-proxyを使用しないと接続がすぐに切断される
- AT!コマンド（AT!SELRAT, AT!BAND等）はCARMD-EVファームウェアでは使用不可

## 対応SIM/キャリア別PRI

| SIM/キャリア | 使用するPRI |
|-------------|------------|
| SORACOM (ドコモ回線) | DOCOMO |
| IIJmio (ドコモ回線) | DOCOMO |
| 楽天モバイル | GENERIC |
| au/UQ mobile | KDDI |
| SoftBank/Y!mobile | GENERIC |

## トラブルシューティング

### Operating modeが'offline'になる場合
PRI/modemの組み合わせが不正。別のPRIを試す。

### 接続後すぐに切断される場合
mbim-proxyを使用する。または接続後すぐにIP設定を行う。

### QMIコマンドがタイムアウトする場合
```bash
sudo pkill -9 mbimcli
sudo pkill -9 qmicli
sleep 2
# 再試行
```
